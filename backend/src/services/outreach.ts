// Outreach service: template rendering, scheduler tick, send orchestration.
import { and, eq, lte, sql, asc, isNull, or } from "drizzle-orm";
import { db } from "../db/client";
import {
  outreachSequences, outreachSteps, outreachEnrollments, outreachSends,
  leads, leadActivities,
} from "../db/schema";
import { sendOutreachEmail } from "./email";
import { findAgent, runAgent } from "./agents";

// Mustache-lite template renderer. Supports {{name}}, {{company}}, etc.
// Missing keys render as empty string. Whitespace inside braces is ignored.
export function renderTemplate(tpl: string, vars: Record<string, string | null | undefined>): string {
  return tpl.replace(/\{\{\s*([\w_.]+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

// Build the variables available to templates for a given lead.
function buildLeadVars(lead: typeof leads.$inferSelect): Record<string, string> {
  return {
    name:        lead.name,
    first_name:  lead.name.split(/\s+/)[0] ?? lead.name,
    company:     lead.company,
    email:       lead.email ?? "",
    category:    lead.category ?? "",
    niche:       lead.category ?? "",
    source:      lead.source ?? "",
  };
}

// Find a step's actual due date for an enrollment based on its day_offset.
function computeNextSendAt(enrolledAt: Date, dayOffset: number): Date {
  const d = new Date(enrolledAt.getTime());
  d.setDate(d.getDate() + dayOffset);
  return d;
}

// ── Enrollment ────────────────────────────────────────────
export interface EnrollOptions {
  leadId:      string;
  sequenceId:  string;
  enrolledBy?: string | null;
}

export async function enrollLead(opts: EnrollOptions) {
  // Check sequence + first step exist
  const [seq] = await db.select().from(outreachSequences).where(eq(outreachSequences.id, opts.sequenceId)).limit(1);
  if (!seq)              throw new Error("Sequence not found");
  if (!seq.isActive)     throw new Error("Sequence is inactive");

  const steps = await db.select().from(outreachSteps).where(eq(outreachSteps.sequenceId, opts.sequenceId)).orderBy(asc(outreachSteps.position));
  if (steps.length === 0) throw new Error("Sequence has no steps");

  // Dedupe: skip if already enrolled
  const [existing] = await db
    .select({ id: outreachEnrollments.id, status: outreachEnrollments.status })
    .from(outreachEnrollments)
    .where(and(
      eq(outreachEnrollments.leadId, opts.leadId),
      eq(outreachEnrollments.sequenceId, opts.sequenceId),
    ))
    .limit(1);

  if (existing) {
    return { enrollment: { id: existing.id, status: existing.status }, alreadyEnrolled: true };
  }

  const now = new Date();
  const nextSendAt = computeNextSendAt(now, steps[0].dayOffset);

  const [enrollment] = await db
    .insert(outreachEnrollments)
    .values({
      leadId:      opts.leadId,
      sequenceId:  opts.sequenceId,
      currentStep: 0,
      status:      "active",
      enrolledAt:  now,
      nextSendAt,
      enrolledBy:  opts.enrolledBy ?? null,
    })
    .returning();

  return { enrollment, alreadyEnrolled: false };
}

// ── Scheduler tick: find due enrollments, send next step ──
export async function processDueSends(limit = 20): Promise<{ processed: number; sent: number; failed: number }> {
  const now = new Date();
  const due = await db
    .select()
    .from(outreachEnrollments)
    .where(and(
      eq(outreachEnrollments.status, "active"),
      lte(outreachEnrollments.nextSendAt, now),
    ))
    .limit(limit);

  let sent = 0;
  let failed = 0;

  for (const enrollment of due) {
    try {
      await processSingleSend(enrollment);
      sent++;
    } catch (err: any) {
      failed++;
      // Mark this enrollment as failed if a single send errored — but don't crash the sweep
      await db
        .update(outreachEnrollments)
        .set({ status: "failed", pausedReason: String(err?.message ?? err).slice(0, 500) })
        .where(eq(outreachEnrollments.id, enrollment.id));
    }
  }

  return { processed: due.length, sent, failed };
}

async function processSingleSend(enrollment: typeof outreachEnrollments.$inferSelect) {
  // Get lead and step
  const [lead] = await db.select().from(leads).where(eq(leads.id, enrollment.leadId)).limit(1);
  if (!lead)        throw new Error("Lead vanished");
  if (!lead.email)  throw new Error("Lead has no email");

  // If lead has reached closed_won/closed_lost, finish enrollment
  if (lead.stage === "closed_won" || lead.stage === "closed_lost") {
    await db.update(outreachEnrollments)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(outreachEnrollments.id, enrollment.id));
    return;
  }

  const steps = await db
    .select()
    .from(outreachSteps)
    .where(eq(outreachSteps.sequenceId, enrollment.sequenceId))
    .orderBy(asc(outreachSteps.position));

  const step = steps[enrollment.currentStep];
  if (!step) {
    // No more steps — mark complete
    await db.update(outreachEnrollments)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(outreachEnrollments.id, enrollment.id));
    return;
  }

  // Skip non-email steps for now (they show up as suggestions in activity timeline but don't send)
  if (step.channel !== "email") {
    await advanceStep(enrollment, steps);
    return;
  }

  const vars = buildLeadVars(lead);

  // Resolve subject + body
  const subject = renderTemplate(step.subjectTemplate ?? "Following up — {{company}}", vars);

  let body: string;
  if (step.agentId) {
    // Use AI agent to generate body for this specific lead
    const agent = findAgent(step.agentId);
    if (!agent || agent.scope !== "lead") {
      body = renderTemplate(step.bodyTemplate ?? "(no template configured)", vars);
    } else {
      const run = await runAgent({ agentId: step.agentId, contextId: lead.id, userId: null });
      body = run.output || renderTemplate(step.bodyTemplate ?? "", vars);
    }
  } else {
    body = renderTemplate(step.bodyTemplate ?? "(no body template)", vars);
  }

  // Send
  const result = await sendOutreachEmail({ to: lead.email, subject, body });

  // Persist send
  await db.insert(outreachSends).values({
    enrollmentId: enrollment.id,
    stepId:       step.id,
    channel:      "email",
    subject,
    body,
    status:       "sent",
    messageId:    result.messageId,
  });

  // Log to lead activity timeline
  await db.insert(leadActivities).values({
    leadId:      lead.id,
    type:        "email",
    description: `[Sequence] ${subject}\n\n${body}`.slice(0, 4000),
  });

  // Update lead.lastActivity
  await db.update(leads)
    .set({ lastActivity: new Date().toISOString().slice(0, 10), updatedAt: new Date() })
    .where(eq(leads.id, lead.id));

  await advanceStep(enrollment, steps);
}

async function advanceStep(
  enrollment: typeof outreachEnrollments.$inferSelect,
  steps: (typeof outreachSteps.$inferSelect)[],
) {
  const nextStepIdx = enrollment.currentStep + 1;
  if (nextStepIdx >= steps.length) {
    await db.update(outreachEnrollments)
      .set({
        status:               "completed",
        currentStep:          nextStepIdx,
        lastStepCompletedAt:  new Date(),
        completedAt:          new Date(),
        nextSendAt:           null,
      })
      .where(eq(outreachEnrollments.id, enrollment.id));
  } else {
    const nextStep = steps[nextStepIdx];
    await db.update(outreachEnrollments)
      .set({
        currentStep:          nextStepIdx,
        lastStepCompletedAt:  new Date(),
        nextSendAt:           computeNextSendAt(enrollment.enrolledAt, nextStep.dayOffset),
      })
      .where(eq(outreachEnrollments.id, enrollment.id));
  }
}

// ── Auto-enroll a freshly created lead ────────────────────
export async function autoEnrollIfMatchingCategory(leadId: string, category: string | null) {
  if (!category) return;
  const matches = await db
    .select()
    .from(outreachSequences)
    .where(and(
      eq(outreachSequences.isActive, true),
      eq(outreachSequences.autoEnrollOnCategory, true),
      eq(outreachSequences.category, category),
    ));

  for (const seq of matches) {
    try { await enrollLead({ leadId, sequenceId: seq.id }); }
    catch { /* swallow — won't kill ingestion */ }
  }
}
