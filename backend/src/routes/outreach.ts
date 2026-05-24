// Outreach automation routes:
//  - POST /outreach/leads/ingest        (API-key auth, no JWT — for n8n/Apollo/etc.)
//  - GET/POST/PATCH/DELETE /outreach/sequences
//  - GET/POST/DELETE /outreach/sequences/:id/steps
//  - POST /outreach/enroll
//  - GET /outreach/enrollments
//  - POST /outreach/enrollments/:id/pause | /resume | /cancel
//  - POST /outreach/scheduler/tick      (admin: trigger sweep manually)
import { Hono } from "hono";
import { z } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  outreachSequences, outreachSteps, outreachEnrollments, outreachSends,
  leads, leadActivities,
} from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { createMiddleware } from "hono/factory";
import {
  enrollLead, processDueSends, autoEnrollIfMatchingCategory, handleReply,
} from "../services/outreach";
import type { AppEnv } from "../types";

const outreach = new Hono<AppEnv>();

// ── API-key middleware (for ingestion) ────────────────────
const apiKeyAuth = createMiddleware(async (c, next) => {
  const expected = process.env.AUTOMATION_API_KEY;
  if (!expected || expected.startsWith("replace-")) {
    return c.json({ error: "Ingestion is not configured (AUTOMATION_API_KEY missing)" }, 503);
  }
  const provided = c.req.header("X-API-Key") ?? c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== expected) return c.json({ error: "Invalid API key" }, 401);
  await next();
});

// ── INGEST: POST /outreach/leads/ingest ───────────────────
// Designed for n8n, Apollo, Instantly, etc. Idempotent by email (case-insensitive).
const ingestSchema = z.object({
  name:        z.string().min(1).max(200),
  company:     z.string().min(1).max(200),
  email:       z.string().email().optional().nullable(),
  phone:       z.string().max(50).optional().nullable(),
  source:      z.string().max(100).optional().nullable(),
  category:    z.string().max(100).optional().nullable(),
  deal_value:  z.number().nonnegative().optional(),
  notes:       z.string().max(4000).optional().nullable(),
  // n8n flexibility: any extra fields will be ignored
}).passthrough();

outreach.post("/leads/ingest", apiKeyAuth, async (c) => {
  const body = ingestSchema.parse(await c.req.json());
  const emailLower = body.email?.toLowerCase().trim() || null;

  // Dedupe by lowercased email (if provided) or by exact company+name
  let existing: { id: string } | undefined;
  if (emailLower) {
    [existing] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(sql`LOWER(${leads.email}) = ${emailLower}`)
      .limit(1);
  } else {
    [existing] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.name, body.name), eq(leads.company, body.company)))
      .limit(1);
  }

  if (existing) {
    // Patch source/category if missing, but keep existing data
    await db.update(leads).set({
      source:   sql`COALESCE(${leads.source},   ${body.source   ?? null})`,
      category: sql`COALESCE(${leads.category}, ${body.category ?? null})`,
      phone:    sql`COALESCE(${leads.phone},    ${body.phone    ?? null})`,
      updatedAt: new Date(),
    }).where(eq(leads.id, existing.id));

    return c.json({ id: existing.id, created: false, deduped: true });
  }

  // Create fresh lead
  const [lead] = await db.insert(leads).values({
    name:      body.name,
    company:   body.company,
    email:     emailLower,
    phone:     body.phone    ?? null,
    source:    body.source   ?? null,
    category:  body.category ?? null,
    dealValue: body.deal_value != null ? String(body.deal_value) : "0",
    notes:     body.notes    ?? null,
  }).returning();

  // Initial activity for traceability
  await db.insert(leadActivities).values({
    leadId:      lead.id,
    type:        "form",
    description: `Ingested via API from source: ${body.source ?? "unknown"}`,
  });

  // Auto-enroll if matching active sequence exists
  await autoEnrollIfMatchingCategory(lead.id, lead.category);

  return c.json({ id: lead.id, created: true, deduped: false }, 201);
});

// ── SEQUENCES CRUD (JWT auth) ─────────────────────────────
const sequenceSchema = z.object({
  name:                    z.string().min(1).max(200),
  description:             z.string().max(2000).optional().nullable(),
  category:                z.string().max(100).optional().nullable(),
  is_active:               z.boolean().optional(),
  auto_enroll_on_category: z.boolean().optional(),
});

outreach.get("/sequences", authMiddleware, async (c) => {
  const rows = await db
    .select({
      sequence: outreachSequences,
      stepCount: sql<number>`(SELECT COUNT(*)::int FROM ${outreachSteps} WHERE ${outreachSteps.sequenceId} = ${outreachSequences.id})`,
      activeEnrollments: sql<number>`(SELECT COUNT(*)::int FROM ${outreachEnrollments} WHERE ${outreachEnrollments.sequenceId} = ${outreachSequences.id} AND ${outreachEnrollments.status} = 'active')`,
    })
    .from(outreachSequences)
    .orderBy(desc(outreachSequences.updatedAt));
  return c.json(rows.map(({ sequence, stepCount, activeEnrollments }) => ({
    ...sequence,
    step_count:         Number(stepCount),
    active_enrollments: Number(activeEnrollments),
  })));
});

outreach.get("/sequences/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");
  const [seq] = await db.select().from(outreachSequences).where(eq(outreachSequences.id, id)).limit(1);
  if (!seq) return c.json({ error: "Not found" }, 404);
  const steps = await db.select().from(outreachSteps).where(eq(outreachSteps.sequenceId, id)).orderBy(outreachSteps.position);
  return c.json({ ...seq, steps });
});

outreach.post("/sequences", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = sequenceSchema.parse(await c.req.json());
  const [created] = await db.insert(outreachSequences).values({
    name:                  body.name,
    description:           body.description ?? null,
    category:              body.category    ?? null,
    isActive:              body.is_active ?? true,
    autoEnrollOnCategory:  body.auto_enroll_on_category ?? false,
    createdBy:             user.id,
  }).returning();
  return c.json(created, 201);
});

outreach.patch("/sequences/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");
  const body = sequenceSchema.partial().parse(await c.req.json());
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined)                    patch.name = body.name;
  if (body.description !== undefined)             patch.description = body.description;
  if (body.category !== undefined)                patch.category = body.category;
  if (body.is_active !== undefined)               patch.isActive = body.is_active;
  if (body.auto_enroll_on_category !== undefined) patch.autoEnrollOnCategory = body.auto_enroll_on_category;
  const [updated] = await db.update(outreachSequences).set(patch).where(eq(outreachSequences.id, id)).returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

outreach.delete("/sequences/:id", authMiddleware, adminOnly, async (c) => {
  const [del] = await db.delete(outreachSequences).where(eq(outreachSequences.id, c.req.param("id"))).returning({ id: outreachSequences.id });
  if (!del) return c.json({ error: "Not found" }, 404);
  return new Response(null, { status: 204 });
});

// ── STEPS ─────────────────────────────────────────────────
const stepSchema = z.object({
  day_offset:       z.number().int().min(0).max(365),
  channel:          z.enum(["email", "linkedin", "note"]).default("email"),
  subject_template: z.string().max(300).optional().nullable(),
  body_template:    z.string().max(8000).optional().nullable(),
  agent_id:         z.string().max(100).optional().nullable(),
});

outreach.post("/sequences/:id/steps", authMiddleware, async (c) => {
  const sequenceId = c.req.param("id");
  const body = stepSchema.parse(await c.req.json());

  // Auto-assign position to next free slot
  const [{ maxPos }] = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(${outreachSteps.position}), -1)::int` })
    .from(outreachSteps)
    .where(eq(outreachSteps.sequenceId, sequenceId));
  const position = Number(maxPos) + 1;

  const [step] = await db.insert(outreachSteps).values({
    sequenceId,
    position,
    dayOffset:       body.day_offset,
    channel:         body.channel,
    subjectTemplate: body.subject_template ?? null,
    bodyTemplate:    body.body_template    ?? null,
    agentId:         body.agent_id         ?? null,
  }).returning();
  return c.json(step, 201);
});

outreach.patch("/sequences/:sid/steps/:stepId", authMiddleware, async (c) => {
  const body = stepSchema.partial().parse(await c.req.json());
  const patch: Record<string, unknown> = {};
  if (body.day_offset !== undefined)       patch.dayOffset       = body.day_offset;
  if (body.channel !== undefined)          patch.channel         = body.channel;
  if (body.subject_template !== undefined) patch.subjectTemplate = body.subject_template;
  if (body.body_template !== undefined)    patch.bodyTemplate    = body.body_template;
  if (body.agent_id !== undefined)         patch.agentId         = body.agent_id;
  const [updated] = await db.update(outreachSteps).set(patch).where(eq(outreachSteps.id, c.req.param("stepId"))).returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

outreach.delete("/sequences/:sid/steps/:stepId", authMiddleware, async (c) => {
  const [del] = await db.delete(outreachSteps).where(eq(outreachSteps.id, c.req.param("stepId"))).returning({ id: outreachSteps.id });
  if (!del) return c.json({ error: "Not found" }, 404);
  return new Response(null, { status: 204 });
});

// ── ENROLLMENT ────────────────────────────────────────────
outreach.post("/enroll", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = z.object({
    lead_id:     z.string().uuid(),
    sequence_id: z.string().uuid(),
  }).parse(await c.req.json());

  try {
    const result = await enrollLead({
      leadId:     body.lead_id,
      sequenceId: body.sequence_id,
      enrolledBy: user.id,
    });
    return c.json(result, result.alreadyEnrolled ? 200 : 201);
  } catch (err: any) {
    return c.json({ error: err?.message ?? "Enrollment failed" }, 400);
  }
});

outreach.get("/enrollments", authMiddleware, async (c) => {
  const q = c.req.query() as Record<string, string>;
  const conditions = [];
  if (q.status)   conditions.push(eq(outreachEnrollments.status, q.status as any));
  if (q.lead_id)  conditions.push(eq(outreachEnrollments.leadId, q.lead_id));

  const rows = await db
    .select({
      enrollment: outreachEnrollments,
      leadName:   leads.name,
      leadCompany: leads.company,
      leadEmail:   leads.email,
      sequenceName: outreachSequences.name,
    })
    .from(outreachEnrollments)
    .leftJoin(leads, eq(outreachEnrollments.leadId, leads.id))
    .leftJoin(outreachSequences, eq(outreachEnrollments.sequenceId, outreachSequences.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(outreachEnrollments.enrolledAt))
    .limit(100);

  return c.json(rows.map(({ enrollment, leadName, leadCompany, leadEmail, sequenceName }) => ({
    ...enrollment,
    lead_name:     leadName,
    lead_company:  leadCompany,
    lead_email:    leadEmail,
    sequence_name: sequenceName,
  })));
});

outreach.post("/enrollments/:id/pause", authMiddleware, async (c) => {
  const reason = c.req.query("reason") ?? "manual";
  const [updated] = await db.update(outreachEnrollments)
    .set({ status: "paused", pausedReason: reason })
    .where(eq(outreachEnrollments.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

outreach.post("/enrollments/:id/resume", authMiddleware, async (c) => {
  const [updated] = await db.update(outreachEnrollments)
    .set({ status: "active", pausedReason: null })
    .where(eq(outreachEnrollments.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

outreach.post("/enrollments/:id/cancel", authMiddleware, async (c) => {
  const [updated] = await db.update(outreachEnrollments)
    .set({ status: "completed", completedAt: new Date(), nextSendAt: null, pausedReason: "cancelled" })
    .where(eq(outreachEnrollments.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

// ── SENDS history (per enrollment) ────────────────────────
outreach.get("/enrollments/:id/sends", authMiddleware, async (c) => {
  const rows = await db
    .select()
    .from(outreachSends)
    .where(eq(outreachSends.enrollmentId, c.req.param("id")))
    .orderBy(desc(outreachSends.sentAt));
  return c.json(rows);
});

// ── Manual scheduler tick (admin only — for debugging) ────
outreach.post("/scheduler/tick", authMiddleware, adminOnly, async (c) => {
  const result = await processDueSends(50);
  return c.json(result);
});

// ── REPLY WEBHOOK (API-key auth) ──────────────────────────
// Called by n8n IMAP/Gmail trigger or Brevo inbound webhook when a lead replies.
const replySchema = z.object({
  from_email:   z.string().email(),
  subject:      z.string().max(500).optional().nullable(),
  body_preview: z.string().max(2000).optional().nullable(),
}).passthrough();

outreach.post("/webhooks/reply", apiKeyAuth, async (c) => {
  const body = replySchema.parse(await c.req.json());
  try {
    const result = await handleReply({
      fromEmail:   body.from_email,
      subject:     body.subject ?? null,
      bodyPreview: body.body_preview ?? null,
    });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err?.message ?? "Reply handling failed" }, 400);
  }
});

// ── ANALYTICS ─────────────────────────────────────────────
outreach.get("/analytics", authMiddleware, async (c) => {
  // Overall enrollment counts by status
  const byStatus = await db
    .select({
      status: outreachEnrollments.status,
      count:  sql<number>`COUNT(*)::int`,
    })
    .from(outreachEnrollments)
    .groupBy(outreachEnrollments.status);

  // Sends over last 30 days (one row per day)
  const sendsByDay = await db
    .select({
      day:   sql<string>`DATE(${outreachSends.sentAt})::text`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(outreachSends)
    .where(sql`${outreachSends.sentAt} > NOW() - INTERVAL '30 days'`)
    .groupBy(sql`DATE(${outreachSends.sentAt})`)
    .orderBy(sql`DATE(${outreachSends.sentAt}) DESC`);

  // Per-sequence stats: enrolled / replied / completed / sends
  const perSequence = await db
    .select({
      sequenceId:   outreachSequences.id,
      sequenceName: outreachSequences.name,
      category:     outreachSequences.category,
      isActive:     outreachSequences.isActive,
      enrolled:     sql<number>`(SELECT COUNT(*)::int FROM ${outreachEnrollments} WHERE ${outreachEnrollments.sequenceId} = ${outreachSequences.id})`,
      active:       sql<number>`(SELECT COUNT(*)::int FROM ${outreachEnrollments} WHERE ${outreachEnrollments.sequenceId} = ${outreachSequences.id} AND ${outreachEnrollments.status} = 'active')`,
      replied:      sql<number>`(SELECT COUNT(*)::int FROM ${outreachEnrollments} WHERE ${outreachEnrollments.sequenceId} = ${outreachSequences.id} AND ${outreachEnrollments.status} = 'replied')`,
      completed:    sql<number>`(SELECT COUNT(*)::int FROM ${outreachEnrollments} WHERE ${outreachEnrollments.sequenceId} = ${outreachSequences.id} AND ${outreachEnrollments.status} = 'completed')`,
      sends:        sql<number>`(SELECT COUNT(*)::int FROM ${outreachSends} s JOIN ${outreachEnrollments} e ON s.enrollment_id = e.id WHERE e.sequence_id = ${outreachSequences.id})`,
    })
    .from(outreachSequences)
    .orderBy(desc(outreachSequences.updatedAt));

  // Totals
  const total = byStatus.reduce((acc, s) => acc + Number(s.count), 0);
  const replied = Number(byStatus.find((s) => s.status === "replied")?.count ?? 0);
  const sent30d = sendsByDay.reduce((acc, d) => acc + Number(d.count), 0);

  return c.json({
    totals: {
      enrollments_total:     total,
      replied,
      reply_rate:            total > 0 ? Math.round((replied / total) * 100) : 0,
      sends_last_30_days:    sent30d,
    },
    by_status: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
    sends_by_day: sendsByDay.map((r) => ({ day: r.day, count: Number(r.count) })).reverse(),
    per_sequence: perSequence.map((r) => ({
      sequence_id:   r.sequenceId,
      sequence_name: r.sequenceName,
      category:      r.category,
      is_active:     r.isActive,
      enrolled:      Number(r.enrolled),
      active:        Number(r.active),
      replied:       Number(r.replied),
      completed:     Number(r.completed),
      sends:         Number(r.sends),
      reply_rate:    Number(r.enrolled) > 0 ? Math.round((Number(r.replied) / Number(r.enrolled)) * 100) : 0,
    })),
  });
});

export default outreach;
