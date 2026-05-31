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
import { eq, and, desc, sql, inArray } from "drizzle-orm";
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
import { fireEventAsync } from "../services/webhooks";
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

// ── BULK INGEST (authMiddleware — for in-app CSV import) ──────────
const bulkIngestSchema = z.object({
  leads: z.array(ingestSchemaInline()).min(1).max(500),
});

function ingestSchemaInline() {
  return z.object({
    name:        z.string().min(1).max(200),
    company:     z.string().min(1).max(200),
    email:       z.string().email().optional().nullable(),
    phone:       z.string().max(50).optional().nullable(),
    source:      z.string().max(100).optional().nullable(),
    category:    z.string().max(100).optional().nullable(),
    deal_value:  z.number().nonnegative().optional(),
    notes:       z.string().max(4000).optional().nullable(),
  }).passthrough();
}

outreach.post("/leads/ingest-bulk", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = bulkIngestSchema.parse(await c.req.json());

  let created = 0, deduped = 0, errors = 0;
  const created_ids: string[] = [];
  const errorRows: { index: number; error: string }[] = [];

  for (let i = 0; i < body.leads.length; i++) {
    const lead = body.leads[i];
    try {
      const emailLower = lead.email?.toLowerCase().trim() || null;
      let existing: { id: string } | undefined;
      if (emailLower) {
        [existing] = await db.select({ id: leads.id }).from(leads)
          .where(sql`LOWER(${leads.email}) = ${emailLower}`).limit(1);
      } else {
        [existing] = await db.select({ id: leads.id }).from(leads)
          .where(and(eq(leads.name, lead.name), eq(leads.company, lead.company))).limit(1);
      }

      if (existing) {
        await db.update(leads).set({
          source:    sql`COALESCE(${leads.source},   ${lead.source   ?? null})`,
          category:  sql`COALESCE(${leads.category}, ${lead.category ?? null})`,
          phone:     sql`COALESCE(${leads.phone},    ${lead.phone    ?? null})`,
          updatedAt: new Date(),
        }).where(eq(leads.id, existing.id));
        deduped++;
        continue;
      }

      const [newLead] = await db.insert(leads).values({
        name:      lead.name,
        company:   lead.company,
        email:     emailLower,
        phone:     lead.phone    ?? null,
        source:    lead.source   ?? "csv-import",
        category:  lead.category ?? null,
        dealValue: lead.deal_value != null ? String(lead.deal_value) : "0",
        notes:     lead.notes    ?? null,
        assigneeId: user.id,
      }).returning({ id: leads.id });

      await db.insert(leadActivities).values({
        leadId:      newLead.id,
        type:        "form",
        description: `CSV import by ${user.name}`,
      });

      await autoEnrollIfMatchingCategory(newLead.id, lead.category ?? null);

      created_ids.push(newLead.id);
      created++;
    } catch (err: any) {
      errors++;
      errorRows.push({ index: i, error: String(err?.message ?? err).slice(0, 200) });
    }
  }

  return c.json({
    total:        body.leads.length,
    created,
    deduped,
    errors,
    created_ids,
    error_rows:   errorRows,
  });
});

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

  // Fire lead.created event for webhooks (Slack ping, WhatsApp alert, etc.)
  fireEventAsync("lead.created", {
    lead_id:  lead.id,
    name:     lead.name,
    company:  lead.company,
    email:    lead.email,
    source:   lead.source,
    category: lead.category,
  });

  return c.json({ id: lead.id, created: true, deduped: false }, 201);
});

// ── SEQUENCES CRUD (JWT auth) ─────────────────────────────
const sequenceSchema = z.object({
  name:                    z.string().min(1).max(200),
  description:             z.string().max(2000).optional().nullable(),
  category:                z.string().max(100).optional().nullable(),
  is_active:               z.boolean().optional(),
  auto_enroll_on_category: z.boolean().optional(),
  auto_enroll_all:         z.boolean().optional(),
});

outreach.get("/sequences", authMiddleware, async (c) => {
  // Fetch sequences + step counts + active enrollment counts in parallel.
  // (Previously did this with correlated subqueries in one query, but those were
  // returning 0 incorrectly — separate aggregates merged in JS is simpler and
  // more reliable.)
  const [sequences, stepRows, enrollRows] = await Promise.all([
    db.select().from(outreachSequences).orderBy(desc(outreachSequences.updatedAt)),
    db.select({
        sequenceId: outreachSteps.sequenceId,
        count:      sql<number>`COUNT(*)::int`,
      })
      .from(outreachSteps)
      .groupBy(outreachSteps.sequenceId),
    db.select({
        sequenceId: outreachEnrollments.sequenceId,
        count:      sql<number>`COUNT(*)::int`,
      })
      .from(outreachEnrollments)
      .where(eq(outreachEnrollments.status, "active"))
      .groupBy(outreachEnrollments.sequenceId),
  ]);

  const stepMap   = new Map(stepRows.map((r)   => [r.sequenceId, Number(r.count)]));
  const enrollMap = new Map(enrollRows.map((r) => [r.sequenceId, Number(r.count)]));

  return c.json(sequences.map((seq) => ({
    ...seq,
    step_count:         stepMap.get(seq.id)   ?? 0,
    active_enrollments: enrollMap.get(seq.id) ?? 0,
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
    autoEnrollAll:         body.auto_enroll_all ?? false,
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
  if (body.auto_enroll_all !== undefined)          patch.autoEnrollAll = body.auto_enroll_all;
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

// POST /outreach/enroll-bulk — enroll many leads in one sequence
const enrollBulkSchema = z.object({
  lead_ids:    z.array(z.string().uuid()).min(1).max(500),
  sequence_id: z.string().uuid(),
});

outreach.post("/enroll-bulk", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = enrollBulkSchema.parse(await c.req.json());

  let enrolled = 0, alreadyEnrolled = 0, errors = 0;
  const errorRows: { lead_id: string; error: string }[] = [];

  for (const leadId of body.lead_ids) {
    try {
      const res = await enrollLead({
        leadId,
        sequenceId: body.sequence_id,
        enrolledBy: user.id,
      });
      if (res.alreadyEnrolled) alreadyEnrolled++;
      else enrolled++;
    } catch (err: any) {
      errors++;
      errorRows.push({ lead_id: leadId, error: String(err?.message ?? err).slice(0, 200) });
    }
  }

  return c.json({
    total: body.lead_ids.length,
    enrolled,
    already_enrolled: alreadyEnrolled,
    errors,
    error_rows: errorRows,
  });
});

outreach.get("/enrollments", authMiddleware, async (c) => {
  const q = c.req.query() as Record<string, string>;
  const conditions = [];
  if (q.status)   conditions.push(eq(outreachEnrollments.status, q.status as any));
  if (q.lead_id)  conditions.push(eq(outreachEnrollments.leadId, q.lead_id));

  // Explicit column selection — avoids drizzle's whole-table expansion which
  // can emit unqualified column refs and cause "id is ambiguous" with joins.
  const rows = await db
    .select({
      id:                  outreachEnrollments.id,
      leadId:              outreachEnrollments.leadId,
      sequenceId:          outreachEnrollments.sequenceId,
      currentStep:         outreachEnrollments.currentStep,
      status:              outreachEnrollments.status,
      enrolledAt:          outreachEnrollments.enrolledAt,
      nextSendAt:          outreachEnrollments.nextSendAt,
      lastStepCompletedAt: outreachEnrollments.lastStepCompletedAt,
      completedAt:         outreachEnrollments.completedAt,
      pausedReason:        outreachEnrollments.pausedReason,
      enrolledBy:          outreachEnrollments.enrolledBy,
      lead_name:           leads.name,
      lead_company:        leads.company,
      lead_email:          leads.email,
      sequence_name:       outreachSequences.name,
    })
    .from(outreachEnrollments)
    .leftJoin(leads,             eq(outreachEnrollments.leadId,     leads.id))
    .leftJoin(outreachSequences, eq(outreachEnrollments.sequenceId, outreachSequences.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(outreachEnrollments.enrolledAt))
    .limit(100);

  return c.json(rows);
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

// DELETE /outreach/enrollments/:id — hard-delete enrollment + cascade its sends
// Use for cleanup of test/erroneous enrollments (cancel is for production runs).
outreach.delete("/enrollments/:id", authMiddleware, adminOnly, async (c) => {
  const [deleted] = await db
    .delete(outreachEnrollments)
    .where(eq(outreachEnrollments.id, c.req.param("id")))
    .returning({ id: outreachEnrollments.id });
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return new Response(null, { status: 204 });
});

// POST /outreach/sends/purge — admin cleanup: delete sends matching filters
// Useful for nuking test send records that clutter analytics.
// Body: { enrollment_ids?: string[], lead_ids?: string[], before_date?: "YYYY-MM-DD", confirm: "DELETE_SENDS" }
const purgeSendsSchema = z.object({
  enrollment_ids: z.array(z.string().uuid()).optional(),
  lead_ids:       z.array(z.string().uuid()).optional(),
  before_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  confirm:        z.literal("DELETE_SENDS"),
});

outreach.post("/sends/purge", authMiddleware, adminOnly, async (c) => {
  const body = purgeSendsSchema.parse(await c.req.json());

  if (!body.enrollment_ids && !body.lead_ids && !body.before_date) {
    return c.json({ error: "Provide at least one filter (enrollment_ids, lead_ids, or before_date)" }, 400);
  }

  // Resolve lead_ids → enrollment_ids (one query)
  let enrollmentIds: string[] = body.enrollment_ids ?? [];
  if (body.lead_ids && body.lead_ids.length > 0) {
    const rows = await db
      .select({ id: outreachEnrollments.id })
      .from(outreachEnrollments)
      .where(inArray(outreachEnrollments.leadId, body.lead_ids));
    enrollmentIds = [...enrollmentIds, ...rows.map((r) => r.id)];
  }

  const conditions = [];
  if (enrollmentIds.length > 0) conditions.push(inArray(outreachSends.enrollmentId, enrollmentIds));
  if (body.before_date)         conditions.push(sql`${outreachSends.sentAt} < ${body.before_date}::date`);

  if (conditions.length === 0) {
    return c.json({ deleted: 0, note: "No matching filter rows" });
  }

  const deleted = await db
    .delete(outreachSends)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
    .returning({ id: outreachSends.id });

  return c.json({ deleted: deleted.length });
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

  // Per-sequence stats — separate aggregate queries merged in JS.
  // (Correlated subqueries were emitting "column reference id is ambiguous"
  // errors in production, same root cause as the /sequences endpoint.)
  const [sequences, enrollByStatusPerSeq, sendsPerSeq] = await Promise.all([
    db.select({
      id:       outreachSequences.id,
      name:     outreachSequences.name,
      category: outreachSequences.category,
      isActive: outreachSequences.isActive,
      updatedAt: outreachSequences.updatedAt,
    }).from(outreachSequences).orderBy(desc(outreachSequences.updatedAt)),
    db.select({
      sequenceId: outreachEnrollments.sequenceId,
      status:     outreachEnrollments.status,
      count:      sql<number>`COUNT(*)::int`,
    }).from(outreachEnrollments).groupBy(outreachEnrollments.sequenceId, outreachEnrollments.status),
    // Sends per sequence: join sends → enrollments to bridge sequence_id
    db.select({
      sequenceId: outreachEnrollments.sequenceId,
      count:      sql<number>`COUNT(${outreachSends.id})::int`,
    })
    .from(outreachSends)
    .innerJoin(outreachEnrollments, eq(outreachSends.enrollmentId, outreachEnrollments.id))
    .groupBy(outreachEnrollments.sequenceId),
  ]);

  // Build a status → count map per sequence
  const statsBySeq = new Map<string, { enrolled: number; active: number; replied: number; completed: number; failed: number; sends: number }>();
  for (const seq of sequences) {
    statsBySeq.set(seq.id, { enrolled: 0, active: 0, replied: 0, completed: 0, failed: 0, sends: 0 });
  }
  for (const row of enrollByStatusPerSeq) {
    const entry = statsBySeq.get(row.sequenceId);
    if (!entry) continue;
    const n = Number(row.count);
    entry.enrolled += n;
    if (row.status === "active")    entry.active    += n;
    if (row.status === "replied")   entry.replied   += n;
    if (row.status === "completed") entry.completed += n;
    if (row.status === "failed")    entry.failed    += n;
  }
  for (const row of sendsPerSeq) {
    const entry = statsBySeq.get(row.sequenceId);
    if (entry) entry.sends = Number(row.count);
  }

  const perSequence = sequences.map((seq) => {
    const s = statsBySeq.get(seq.id)!;
    return {
      sequence_id:   seq.id,
      sequence_name: seq.name,
      category:      seq.category,
      is_active:     seq.isActive,
      enrolled:      s.enrolled,
      active:        s.active,
      replied:       s.replied,
      completed:     s.completed,
      sends:         s.sends,
      reply_rate:    s.enrolled > 0 ? Math.round((s.replied / s.enrolled) * 100) : 0,
    };
  });

  // Totals
  const total = byStatus.reduce((acc, s) => acc + Number(s.count), 0);
  const replied = Number(byStatus.find((s) => s.status === "replied")?.count ?? 0);
  const sent30d = sendsByDay.reduce((acc, d) => acc + Number(d.count), 0);

  return c.json({
    totals: {
      enrollments_total:  total,
      replied,
      reply_rate:         total > 0 ? Math.round((replied / total) * 100) : 0,
      sends_last_30_days: sent30d,
    },
    by_status:    byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
    sends_by_day: sendsByDay.map((r) => ({ day: r.day, count: Number(r.count) })).reverse(),
    per_sequence: perSequence,
  });
});

export default outreach;
