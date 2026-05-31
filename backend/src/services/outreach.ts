// Outreach service: template rendering, scheduler tick, send orchestration.
import { and, eq, lte, sql, asc, isNull, or } from "drizzle-orm";
import { db } from "../db/client";
import {
  outreachSequences, outreachSteps, outreachEnrollments, outreachSends,
  leads, leadActivities, profiles,
} from "../db/schema";
import { sendOutreachEmail, buildDefaultSignature } from "./email";
import { findAgent, runAgent } from "./agents";
import { fireEventAsync } from "./webhooks";

// Mustache-lite template renderer. Supports {{name}}, {{company}}, etc.
// Missing keys render as empty string. Whitespace inside braces is ignored.
export function renderTemplate(tpl: string, vars: Record<string, string | null | undefined>): string {
  return tpl.replace(/\{\{\s*([\w_.]+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

// Parse an AI-agent output that may begin with "Subject: ..." on the first line.
// Returns { subject, body }. If no Subject: prefix, subject is null and body is the full output.
export function parseSubjectAndBody(output: string): { subject: string | null; body: string } {
  const trimmed = output.replace(/^\s+/, "");
  const m = trimmed.match(/^Subject:\s*([^\n\r]+)[\r\n]+([\s\S]*)$/i);
  if (m) {
    return {
      subject: m[1].trim().slice(0, 200),
      body:    m[2].trim(),
    };
  }
  // Sometimes models wrap output in ```markdown blocks — strip them.
  const stripped = trimmed.replace(/^```\w*\s*|\s*```$/g, "").trim();
  const m2 = stripped.match(/^Subject:\s*([^\n\r]+)[\r\n]+([\s\S]*)$/i);
  if (m2) return { subject: m2[1].trim().slice(0, 200), body: m2[2].trim() };
  return { subject: null, body: trimmed };
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
// Snaps every send to 12:00 PM Cairo (Africa/Cairo) and skips Egyptian
// weekend (Friday + Saturday) by pushing forward to Sunday.
const CAIRO_TZ = "Africa/Cairo";

function computeNextSendAt(enrolledAt: Date, dayOffset: number): Date {
  // Step 1 — add the requested day offset
  const base = new Date(enrolledAt.getTime() + dayOffset * 86_400_000);

  // Step 2 — extract the Cairo-local date components (handles DST automatically)
  const cairoDateStr = base.toLocaleDateString("en-CA", { timeZone: CAIRO_TZ }); // "YYYY-MM-DD"
  const [y, m, d] = cairoDateStr.split("-").map(Number);

  // Step 3 — find the UTC instant that corresponds to 12:00 Cairo on that date.
  // Use noon UTC as an anchor, observe what Cairo says, then shift to land at 12.
  const noonUtc   = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const cairoHour = Number(noonUtc.toLocaleString("en-US", { timeZone: CAIRO_TZ, hour: "2-digit", hour12: false }));
  let sendAt      = new Date(noonUtc.getTime() + (12 - cairoHour) * 3_600_000);

  // Step 4 — if for any reason this lands in the past (dayOffset=0 enrolled
  // after noon Cairo), push to next-day noon Cairo.
  if (sendAt.getTime() <= enrolledAt.getTime()) {
    sendAt = new Date(sendAt.getTime() + 86_400_000);
  }

  // Step 5 — skip the Egyptian weekend (Friday + Saturday).
  // Push Fri → Sun (+2 days), Sat → Sun (+1 day).
  let weekday = sendAt.toLocaleString("en-US", { timeZone: CAIRO_TZ, weekday: "short" });
  while (weekday === "Fri" || weekday === "Sat") {
    sendAt  = new Date(sendAt.getTime() + 86_400_000);
    weekday = sendAt.toLocaleString("en-US", { timeZone: CAIRO_TZ, weekday: "short" });
  }

  return sendAt;
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

  // Dedupe: only block re-enrollment if there's an ACTIVE or PAUSED enrollment.
  // Completed/failed/replied enrollments are historical — we allow re-enrolling.
  const [existing] = await db
    .select({ id: outreachEnrollments.id, status: outreachEnrollments.status })
    .from(outreachEnrollments)
    .where(and(
      eq(outreachEnrollments.leadId, opts.leadId),
      eq(outreachEnrollments.sequenceId, opts.sequenceId),
      or(
        eq(outreachEnrollments.status, "active"),
        eq(outreachEnrollments.status, "paused"),
      )!,
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

  // Resolve subject + body. If an agent is set, it produces both; otherwise we use templates.
  const fallbackSubject = renderTemplate(step.subjectTemplate ?? "Following up — {{company}}", vars);
  let subject: string;
  let body:    string;

  if (step.agentId) {
    const agent = findAgent(step.agentId);
    if (!agent || agent.scope !== "lead") {
      subject = fallbackSubject;
      body    = renderTemplate(step.bodyTemplate ?? "(no template configured)", vars);
    } else {
      const run = await runAgent({ agentId: step.agentId, contextId: lead.id, userId: null });
      const parsed = parseSubjectAndBody(run.output);
      subject = parsed.subject ?? fallbackSubject;
      body    = parsed.body   || renderTemplate(step.bodyTemplate ?? "", vars);
    }
  } else {
    subject = fallbackSubject;
    body    = renderTemplate(step.bodyTemplate ?? "(no body template)", vars);
  }

  // Resolve sender signature: prefer lead.assignee's signature, fall back to default
  let signatureHtml: string;
  let fromName: string | undefined;
  if (lead.assigneeId) {
    const [assignee] = await db
      .select({ name: profiles.name, title: profiles.title, email: profiles.email, signature: profiles.signature })
      .from(profiles)
      .where(eq(profiles.id, lead.assigneeId))
      .limit(1);
    if (assignee) {
      fromName = assignee.name;
      signatureHtml = assignee.signature?.trim() || buildDefaultSignature({
        name:  assignee.name,
        title: assignee.title,
        email: assignee.email,
      });
    } else {
      signatureHtml = buildDefaultSignature({});
    }
  } else {
    signatureHtml = buildDefaultSignature({});
  }

  // Send
  const result = await sendOutreachEmail({ to: lead.email, subject, body, fromName, signatureHtml });

  // Fire webhook for outreach.sent
  fireEventAsync("outreach.sent", {
    lead_id:      lead.id,
    lead_name:    lead.name,
    lead_company: lead.company,
    lead_email:   lead.email,
    sequence_id:  enrollment.sequenceId,
    step_index:   enrollment.currentStep,
    subject,
    sent_at:      new Date().toISOString(),
  });

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

// ── Handle a detected reply from a lead ──────────────────
// Triggered by webhook from n8n (IMAP/Gmail) or Brevo inbound parsing.
// Looks up the lead by email and pauses all active enrollments for them.
export async function handleReply(opts: {
  fromEmail:    string;
  subject?:     string | null;
  bodyPreview?: string | null;
}) {
  const emailLower = opts.fromEmail.toLowerCase().trim();
  if (!emailLower) throw new Error("from_email required");

  // Find lead by email (case-insensitive)
  const [lead] = await db
    .select()
    .from(leads)
    .where(sql`LOWER(${leads.email}) = ${emailLower}`)
    .limit(1);

  if (!lead) {
    return { matched: false, leadId: null, pausedCount: 0 };
  }

  // Pause all active or paused enrollments for this lead
  const updated = await db
    .update(outreachEnrollments)
    .set({
      status:       "replied",
      pausedReason: "Reply received",
      completedAt:  new Date(),
      nextSendAt:   null,
    })
    .where(and(
      eq(outreachEnrollments.leadId, lead.id),
      or(
        eq(outreachEnrollments.status, "active"),
        eq(outreachEnrollments.status, "paused"),
      )!,
    ))
    .returning({ id: outreachEnrollments.id });

  // Add a reply activity to the lead timeline
  const preview = (opts.bodyPreview ?? "").slice(0, 500).trim();
  await db.insert(leadActivities).values({
    leadId:      lead.id,
    type:        "email",
    description: `[Reply received]${opts.subject ? ` ${opts.subject}` : ""}${preview ? `\n\n${preview}` : ""}`.slice(0, 4000),
  });

  // Move stage forward if still in early stages
  const earlyStages = ["new_lead", "contacted"];
  if (earlyStages.includes(lead.stage)) {
    await db.update(leads)
      .set({
        stage:        "contacted",
        lastActivity: new Date().toISOString().slice(0, 10),
        updatedAt:    new Date(),
      })
      .where(eq(leads.id, lead.id));
  } else {
    await db.update(leads)
      .set({ lastActivity: new Date().toISOString().slice(0, 10), updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
  }

  // Fire lead.replied event for any subscribed webhook (Slack, WhatsApp, etc.)
  fireEventAsync("lead.replied", {
    lead_id:      lead.id,
    lead_name:    lead.name,
    lead_company: lead.company,
    lead_email:   lead.email,
    subject:      opts.subject,
    body_preview: opts.bodyPreview,
    paused_count: updated.length,
  });

  return { matched: true, leadId: lead.id, pausedCount: updated.length };
}

// ── Auto-enroll a freshly created lead ────────────────────
// Combines two auto-enroll behaviours:
//   1. Sequences marked autoEnrollAll → enroll EVERY new lead regardless of category.
//   2. Sequences marked autoEnrollOnCategory with matching category → enroll only matches.
// enrollLead() is dedup-safe so a lead can never be double-enrolled in the same sequence.
export async function autoEnrollIfMatchingCategory(leadId: string, category: string | null) {
  const matches = await db
    .select()
    .from(outreachSequences)
    .where(and(
      eq(outreachSequences.isActive, true),
      or(
        eq(outreachSequences.autoEnrollAll, true),
        category
          ? and(eq(outreachSequences.autoEnrollOnCategory, true), eq(outreachSequences.category, category))
          : sql`false`,
      )!,
    ));

  for (const seq of matches) {
    try { await enrollLead({ leadId, sequenceId: seq.id }); }
    catch { /* swallow — won't kill ingestion */ }
  }
}
