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
import { authMiddleware, adminOnly, isAdmin } from "../middleware/auth";
import { createMiddleware } from "hono/factory";
import { isEmailCapableAgent } from "../services/agents";
import {
  enrollLead, processDueSends, autoEnrollIfMatchingCategory, handleReply,
  getAutoEnrollCandidates,
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

// ── Dual auth: accept JWT (logged-in CRM users) OR API-key (n8n, scripts) ──
// Tries the API key first (X-API-Key header). If present and matches → ok.
// Otherwise falls back to the JWT middleware which expects Authorization: Bearer <jwt>.
// Used on read endpoints we want exposed to external automation, like /analytics.
const jwtOrApiKey = createMiddleware(async (c, next) => {
  const apiKeyHeader = c.req.header("X-API-Key");
  const expected = process.env.AUTOMATION_API_KEY;
  if (apiKeyHeader && expected && !expected.startsWith("replace-") && apiKeyHeader === expected) {
    c.set("isAutomation", true);
    return next();
  }
  // Fall through to JWT auth
  return authMiddleware(c, next);
});

// ── Admin-or-automation: for company-wide analytics ───────
// n8n (API key) keeps working; human callers must be admins. Members must not
// see aggregates that span other people's leads.
const adminOrApiKey = createMiddleware(async (c, next) => {
  if (c.get("isAutomation")) return next();
  const user = c.get("user");
  if (!user || user.role !== "admin") {
    return c.json({ error: "Forbidden", message: "Admin access required" }, 403);
  }
  await next();
});

// ── INGEST: POST /outreach/leads/ingest ───────────────────
// Designed for n8n, Apollo, Instantly, etc. Idempotent by email (case-insensitive).
//
// Permissive intake: a lead is accepted if ANY one of name/company/email/phone
// is present. Missing name falls back to company (and vice versa) so DB notNull
// constraints are satisfied. Long category/source strings are truncated, not
// rejected — Firecrawl in particular returns verbose AI-generated category
// descriptions. Empty-string email is normalised to null instead of failing
// .email() validation. Goal: capture every lead the scrapers can find, even
// if all we got was a phone or a Facebook page — those still convert manually.
const emailField = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().email().nullable().optional(),
);
const truncated = (max: number) =>
  z.preprocess(
    (v) => (v == null ? null : typeof v === "string" ? v.slice(0, max) : v),
    z.string().max(max).nullable().optional(),
  );

const ingestSchema = z.object({
  name:        truncated(200),
  company:     truncated(200),
  email:       emailField,
  phone:       truncated(100),
  source:      truncated(500),
  category:    truncated(500),
  deal_value:  z.number().nonnegative().optional(),
  notes:       truncated(8000),
  // n8n flexibility: any extra fields will be ignored
}).passthrough().refine(
  (d) => !!(d.name || d.company || d.email || d.phone),
  { message: "Lead must have at least one of: name, company, email, or phone" },
);

// ── BULK INGEST (authMiddleware — for in-app CSV import) ──────────
const bulkIngestSchema = z.object({
  leads: z.array(ingestSchemaInline()).min(1).max(500),
});

function ingestSchemaInline() {
  return z.object({
    name:        truncated(200),
    company:     truncated(200),
    email:       emailField,
    phone:       truncated(100),
    source:      truncated(500),
    category:    truncated(500),
    deal_value:  z.number().nonnegative().optional(),
    notes:       truncated(8000),
  }).passthrough().refine(
    (d) => !!(d.name || d.company || d.email || d.phone),
    { message: "Lead must have at least one of: name, company, email, or phone" },
  );
}

// Resolve required NOT NULL fields when only one of name/company was supplied.
function fillNameCompany(name: string | null | undefined, company: string | null | undefined): { name: string; company: string } {
  const n = name?.trim();
  const c = company?.trim();
  if (n && c) return { name: n,            company: c };
  if (n)      return { name: n,            company: n };
  if (c)      return { name: c,            company: c };
  return       { name: "(unknown)",        company: "(unknown)" };
}

/** Dedupe key for leads with no email. JSON so a name containing the separator
 *  cannot collide with a different name/company split. */
const pairKey = (name: string, company: string) => JSON.stringify([name, company]);

outreach.post("/leads/ingest-bulk", authMiddleware, adminOnly, async (c) => {
  const user = c.get("user");
  const body = bulkIngestSchema.parse(await c.req.json());

  let created = 0, deduped = 0, errors = 0;
  const created_ids: string[] = [];
  const errorRows: { index: number; error: string }[] = [];

  // Batched, because this ran one dedupe SELECT, one INSERT, one activity
  // INSERT and a full auto-enrol lookup per row. At the 500-row cap that was
  // roughly 2,500 serial round trips for a single CSV import, which is minutes
  // of latency on a real VPS rather than the sub-second it should be.

  // 1. Normalise every row up front so dedupe keys are consistent.
  const rows = body.leads.map((lead, index) => {
    const { name, company } = fillNameCompany(lead.name, lead.company);
    return { index, lead, name, company, emailLower: lead.email?.toLowerCase().trim() || null };
  });

  // 2. Two lookups for the whole batch instead of one per row.
  const emails    = [...new Set(rows.map((r) => r.emailLower).filter((e): e is string => !!e))];
  const pairRows  = rows.filter((r) => !r.emailLower);

  const [byEmailRows, byPairRows] = await Promise.all([
    // An explicit IN list rather than `= ANY($1)`: Drizzle binds a JS array as
    // a single scalar parameter, which Postgres then rejects as a malformed
    // array literal.
    emails.length
      ? db.select({ id: leads.id, email: sql<string>`LOWER(${leads.email})` })
          .from(leads)
          .where(sql`LOWER(${leads.email}) IN (${sql.join(emails.map((e) => sql`${e}`), sql`, `)})`)
      : Promise.resolve([] as { id: string; email: string }[]),
    pairRows.length
      ? db.select({ id: leads.id, name: leads.name, company: leads.company })
          .from(leads)
          .where(sql`(${leads.name}, ${leads.company}) IN (${sql.join(
            pairRows.map((r) => sql`(${r.name}, ${r.company})`), sql`, `)})`)
      : Promise.resolve([] as { id: string; name: string; company: string }[]),
  ]);

  const existingByEmail = new Map(byEmailRows.map((r) => [r.email, r.id]));
  const existingByPair  = new Map(byPairRows.map((r) => [pairKey(r.name, r.company), r.id]));

  // 3. Split into updates and inserts. A duplicate *within* the payload is
  //    treated as a dedupe too, so one CSV containing the same lead twice does
  //    not create two records.
  const seenInBatch = new Set<string>();
  const toUpdate: { id: string; row: typeof rows[number] }[] = [];
  const toInsert: typeof rows = [];

  for (const r of rows) {
    const key = r.emailLower ?? pairKey(r.name, r.company);
    const existingId = r.emailLower
      ? existingByEmail.get(r.emailLower)
      : existingByPair.get(key);

    if (existingId) { toUpdate.push({ id: existingId, row: r }); continue; }
    if (seenInBatch.has(key)) { deduped++; continue; }
    seenInBatch.add(key);
    toInsert.push(r);
  }

  // 4. Fill blanks on the rows we already had. COALESCE keeps existing values;
  //    the incoming row only supplies what is currently missing.
  for (const u of toUpdate) {
    try {
      await db.update(leads).set({
        source:    sql`COALESCE(${leads.source},   ${u.row.lead.source   ?? null})`,
        category:  sql`COALESCE(${leads.category}, ${u.row.lead.category ?? null})`,
        phone:     sql`COALESCE(${leads.phone},    ${u.row.lead.phone    ?? null})`,
        updatedAt: new Date(),
      }).where(eq(leads.id, u.id));
      deduped++;
    } catch (err: any) {
      errors++;
      errorRows.push({ index: u.row.index, error: String(err?.message ?? err).slice(0, 200) });
    }
  }

  // 5. One insert for every new lead, one for all their activity rows.
  if (toInsert.length) {
    try {
      const inserted = await db.insert(leads).values(toInsert.map((r) => ({
        name:       r.name,
        company:    r.company,
        email:      r.emailLower,
        phone:      r.lead.phone    ?? null,
        source:     r.lead.source   ?? "csv-import",
        category:   r.lead.category ?? null,
        dealValue:  r.lead.deal_value != null ? String(r.lead.deal_value) : "0",
        notes:      r.lead.notes    ?? null,
        assigneeId: user.id,
      }))).returning({ id: leads.id });

      created_ids.push(...inserted.map((l) => l.id));
      created = inserted.length;

      await db.insert(leadActivities).values(inserted.map((l) => ({
        leadId:      l.id,
        type:        "form" as const,
        description: `CSV import by ${user.name}`,
      })));

      // 6. Auto-enrol with the candidate sequences fetched once for the batch.
      //    Kept per-lead because the ranking and the never-enrol-twice guard
      //    are what stopped a repeat of the 142-lead double-email incident.
      const candidates = await getAutoEnrollCandidates();
      if (candidates.length) {
        for (const [i, l] of inserted.entries()) {
          await autoEnrollIfMatchingCategory(l.id, toInsert[i].lead.category ?? null, candidates);
        }
      }
    } catch (err: any) {
      // A batch insert is all-or-nothing, so report it against the whole group
      // rather than silently claiming success for rows that never landed.
      errors += toInsert.length;
      errorRows.push({ index: toInsert[0].index, error: `batch insert failed: ${String(err?.message ?? err).slice(0, 160)}` });
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
  const { name, company } = fillNameCompany(body.name, body.company);
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
      .where(and(eq(leads.name, name), eq(leads.company, company)))
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
    name,
    company,
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

// ── Member scoping for outreach ───────────────────────────
// Members may enroll/track THEIR OWN leads in existing sequences, but may not
// author sequences or view company-wide analytics. Sequence + step mutation
// and all analytics endpoints are admin-only (applied at their definitions).

// Verify the caller may act on this lead (admin: any; member: only own leads).
async function mayUseLead(user: { id: string; role?: string }, leadId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const [l] = await db.select({ assigneeId: leads.assigneeId }).from(leads).where(eq(leads.id, leadId)).limit(1);
  return !!l && l.assigneeId === user.id;
}

// Same, but resolved through an enrollment → its lead.
async function mayUseEnrollment(user: { id: string; role?: string }, enrollmentId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const [row] = await db
    .select({ assigneeId: leads.assigneeId })
    .from(outreachEnrollments)
    .innerJoin(leads, eq(outreachEnrollments.leadId, leads.id))
    .where(eq(outreachEnrollments.id, enrollmentId))
    .limit(1);
  return !!row && row.assigneeId === user.id;
}

// ── SEQUENCES CRUD (JWT auth) ─────────────────────────────
const sequenceSchema = z.object({
  name:                    z.string().min(1).max(200),
  description:             z.string().max(2000).optional().nullable(),
  category:                z.string().max(100).optional().nullable(),
  is_active:               z.boolean().optional(),
  auto_enroll_on_category: z.boolean().optional(),
  auto_enroll_all:         z.boolean().optional(),
});

// Steps supplied inline when creating a sequence from a template. Declared here
// rather than reusing stepSchema (defined further down) because creation needs
// it before that point; kept structurally identical.
const seedStepsSchema = z.array(z.object({
  day_offset:       z.number().int().min(0).max(365),
  channel:          z.enum(["email", "linkedin", "note"]).default("email"),
  subject_template: z.string().max(300).optional().nullable(),
  body_template:    z.string().max(8000).optional().nullable(),
  agent_id:         z.string().max(100).optional().nullable(),
})).max(20).default([]);

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

  // active_enrollments is on the list response but was missing here, so the
  // editor header rendered "· active" with no number, and — worse — its delete
  // confirmation compared `undefined > 0` and therefore always claimed no leads
  // were enrolled, on a sequence that might have had hundreds.
  const [steps, [counts]] = await Promise.all([
    db.select().from(outreachSteps)
      .where(eq(outreachSteps.sequenceId, id))
      .orderBy(outreachSteps.position),
    db.select({
      active: sql<number>`COUNT(*) FILTER (WHERE ${outreachEnrollments.status} = 'active')::int`,
      total:  sql<number>`COUNT(*)::int`,
    })
      .from(outreachEnrollments)
      .where(eq(outreachEnrollments.sequenceId, id)),
  ]);

  return c.json({
    ...seq,
    steps,
    step_count:         steps.length,
    active_enrollments: Number(counts?.active ?? 0),
    total_enrollments:  Number(counts?.total  ?? 0),
  });
});

outreach.post("/sequences", authMiddleware, adminOnly, async (c) => {
  const user = c.get("user");
  const raw  = await c.req.json();
  const body = sequenceSchema.parse(raw);

  // Optional inline steps. Creating a usable sequence previously meant one
  // request for the sequence and one per step, each behind its own dialog —
  // four round trips before anything could send. Accepting the steps up front
  // lets the UI offer a starter template as a single action, and makes the
  // whole thing atomic: no more half-built sequences left behind by a failed
  // second request.
  const steps = seedStepsSchema.parse(raw.steps ?? []);

  for (const s of steps) {
    const err = validateEmailStepAgent(s.channel, s.agent_id);
    if (err) return c.json({ error: err }, 400);
  }

  const created = await db.transaction(async (tx) => {
    const [seq] = await tx.insert(outreachSequences).values({
      name:                  body.name,
      description:           body.description ?? null,
      category:              body.category    ?? null,
      isActive:              body.is_active ?? true,
      autoEnrollOnCategory:  body.auto_enroll_on_category ?? false,
      autoEnrollAll:         body.auto_enroll_all ?? false,
      createdBy:             user.id,
    }).returning();

    if (steps.length) {
      await tx.insert(outreachSteps).values(steps.map((s, i) => ({
        sequenceId:      seq.id,
        position:        i,
        dayOffset:       s.day_offset,
        channel:         s.channel,
        subjectTemplate: s.subject_template ?? null,
        bodyTemplate:    s.body_template    ?? null,
        agentId:         s.agent_id         ?? null,
      })));
    }
    return seq;
  });

  return c.json({ ...created, step_count: steps.length }, 201);
});

outreach.patch("/sequences/:id", authMiddleware, adminOnly, async (c) => {
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

// Guard: an EMAIL step's agent must be email-capable. Brief / enrichment /
// proposal agents produce internal documents and would be sent verbatim to a
// prospect — reject them here so the bad config never reaches the scheduler.
function validateEmailStepAgent(channel: string | undefined, agentId: string | null | undefined): string | null {
  if (channel === "email" && agentId && !isEmailCapableAgent(agentId)) {
    return `Agent '${agentId}' does not write emails — it produces an internal document. Use the "Outreach Drafter" agent (or a body template) for email steps.`;
  }
  return null;
}

outreach.post("/sequences/:id/steps", authMiddleware, adminOnly, async (c) => {
  const sequenceId = c.req.param("id");
  const body = stepSchema.parse(await c.req.json());

  const agentErr = validateEmailStepAgent(body.channel, body.agent_id);
  if (agentErr) return c.json({ error: agentErr }, 400);

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

outreach.patch("/sequences/:sid/steps/:stepId", authMiddleware, adminOnly, async (c) => {
  const body = stepSchema.partial().parse(await c.req.json());

  // Resolve the effective channel (may be unchanged) to validate the agent against.
  let effectiveChannel = body.channel;
  if (body.agent_id !== undefined && effectiveChannel === undefined) {
    const [cur] = await db.select({ channel: outreachSteps.channel }).from(outreachSteps).where(eq(outreachSteps.id, c.req.param("stepId"))).limit(1);
    effectiveChannel = cur?.channel;
  }
  if (body.agent_id !== undefined || body.channel !== undefined) {
    const agentErr = validateEmailStepAgent(effectiveChannel, body.agent_id);
    if (agentErr) return c.json({ error: agentErr }, 400);
  }

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

// ── PUT /sequences/:id/steps/reorder ──────────────────────
// Reassigns step positions from a client-supplied order, for drag-and-drop.
//
// Day offsets are rewritten to preserve the *gaps* between steps rather than
// their absolute values. Dragging step 3 (day 7) above step 2 (day 3) and
// keeping the original numbers would leave the sequence sending day 7 before
// day 3, which the scheduler reads as "both are overdue" and fires back to
// back. Preserving gaps keeps the cadence the user designed.
outreach.put("/sequences/:id/steps/reorder", authMiddleware, adminOnly, async (c) => {
  const sequenceId = c.req.param("id");
  const { order } = z.object({ order: z.array(z.string().uuid()).min(1).max(50) })
    .parse(await c.req.json());

  const existing = await db.select().from(outreachSteps)
    .where(eq(outreachSteps.sequenceId, sequenceId))
    .orderBy(outreachSteps.position);

  // Reject a partial or foreign list outright — silently ignoring unknown ids
  // would leave stored positions inconsistent with what is on screen.
  const known = new Set(existing.map((s) => s.id));
  if (order.length !== existing.length || !order.every((id) => known.has(id))) {
    return c.json({
      error: "Order must list every step in this sequence exactly once",
      expected: existing.length,
      received: order.length,
    }, 400);
  }

  // The gaps, in the order they were originally authored.
  const sortedOffsets = existing.map((s) => s.dayOffset).sort((a, b) => a - b);
  const gaps = sortedOffsets.map((v, i) => (i === 0 ? v : v - sortedOffsets[i - 1]));

  const updated = await db.transaction(async (tx) => {
    let running = 0;
    const out = [];
    for (const [i, id] of order.entries()) {
      running = i === 0 ? gaps[0] : running + gaps[i];
      const [row] = await tx.update(outreachSteps)
        .set({ position: i, dayOffset: running })
        .where(eq(outreachSteps.id, id))
        .returning();
      out.push(row);
    }
    await tx.update(outreachSequences)
      .set({ updatedAt: new Date() })
      .where(eq(outreachSequences.id, sequenceId));
    return out;
  });

  return c.json(updated);
});

outreach.delete("/sequences/:sid/steps/:stepId", authMiddleware, adminOnly, async (c) => {
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

  // Members may only enroll their OWN leads.
  if (!(await mayUseLead(user, body.lead_id))) {
    return c.json({ error: "Lead not found" }, 404);
  }

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
      // Members may only bulk-enroll their OWN leads; others are skipped.
      if (!(await mayUseLead(user, leadId))) {
        errors++;
        errorRows.push({ lead_id: leadId, error: "Not your lead" });
        continue;
      }
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
  if (q.status)       conditions.push(eq(outreachEnrollments.status, q.status as any));
  if (q.lead_id)      conditions.push(eq(outreachEnrollments.leadId, q.lead_id));
  if (q.sequence_id)  conditions.push(eq(outreachEnrollments.sequenceId, q.sequence_id));

  // Members only see enrollments for THEIR leads (join filter on leads.assignee).
  const me = c.get("user");
  if (!isAdmin(me)) conditions.push(eq(leads.assigneeId, me.id));

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
  if (!(await mayUseEnrollment(c.get("user"), c.req.param("id")))) return c.json({ error: "Not found" }, 404);
  const reason = c.req.query("reason") ?? "manual";
  const [updated] = await db.update(outreachEnrollments)
    .set({ status: "paused", pausedReason: reason })
    .where(eq(outreachEnrollments.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

outreach.post("/enrollments/:id/resume", authMiddleware, async (c) => {
  if (!(await mayUseEnrollment(c.get("user"), c.req.param("id")))) return c.json({ error: "Not found" }, 404);
  const [updated] = await db.update(outreachEnrollments)
    .set({ status: "active", pausedReason: null })
    .where(eq(outreachEnrollments.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

outreach.post("/enrollments/:id/cancel", authMiddleware, async (c) => {
  if (!(await mayUseEnrollment(c.get("user"), c.req.param("id")))) return c.json({ error: "Not found" }, 404);
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
  if (!(await mayUseEnrollment(c.get("user"), c.req.param("id")))) return c.json({ error: "Not found" }, 404);
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
outreach.get("/analytics", jwtOrApiKey, adminOrApiKey, async (c) => {
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

  // ── EXTRA: by_niche, by_source, by_step, pipeline + stale leads ─────
  // Built with parallel aggregate queries merged in JS (same pattern as above).
  const STALE_THRESHOLD_DAYS = 7;
  const staleCutoffStr = new Date(Date.now() - STALE_THRESHOLD_DAYS * 86400_000).toISOString().slice(0, 10);

  const [
    leadsByNiche,      // category → { leads_total, pipeline_value }
    enrollByNiche,     // category → { enrolled, replied }
    sendsByNiche,      // category → sends
    leadsBySource,     // source → leads_total
    enrollBySource,    // source → { enrolled, replied }
    sendsBySource,     // source → sends
    sendsByStep,       // step.position → sends
    pipelineRow,       // total pipeline value of active leads
    staleRow,          // count of stale active leads
    activeLeadsRow,    // count of leads not in closed_won/closed_lost
  ] = await Promise.all([
    db.select({
      category:        leads.category,
      leads_total:     sql<number>`COUNT(*)::int`,
      pipeline_value:  sql<number>`COALESCE(SUM(${leads.dealValue}::numeric), 0)`,
    })
    .from(leads)
    .where(sql`${leads.category} IS NOT NULL`)
    .groupBy(leads.category),

    db.select({
      category: leads.category,
      enrolled: sql<number>`COUNT(*)::int`,
      replied:  sql<number>`COUNT(CASE WHEN ${outreachEnrollments.status} = 'replied' THEN 1 END)::int`,
    })
    .from(outreachEnrollments)
    .innerJoin(leads, eq(outreachEnrollments.leadId, leads.id))
    .where(sql`${leads.category} IS NOT NULL`)
    .groupBy(leads.category),

    db.select({
      category: leads.category,
      sends:    sql<number>`COUNT(*)::int`,
    })
    .from(outreachSends)
    .innerJoin(outreachEnrollments, eq(outreachSends.enrollmentId, outreachEnrollments.id))
    .innerJoin(leads, eq(outreachEnrollments.leadId, leads.id))
    .where(sql`${leads.category} IS NOT NULL`)
    .groupBy(leads.category),

    db.select({
      source:      leads.source,
      leads_total: sql<number>`COUNT(*)::int`,
    })
    .from(leads)
    .groupBy(leads.source),

    db.select({
      source:   leads.source,
      enrolled: sql<number>`COUNT(*)::int`,
      replied:  sql<number>`COUNT(CASE WHEN ${outreachEnrollments.status} = 'replied' THEN 1 END)::int`,
    })
    .from(outreachEnrollments)
    .innerJoin(leads, eq(outreachEnrollments.leadId, leads.id))
    .groupBy(leads.source),

    db.select({
      source: leads.source,
      sends:  sql<number>`COUNT(*)::int`,
    })
    .from(outreachSends)
    .innerJoin(outreachEnrollments, eq(outreachSends.enrollmentId, outreachEnrollments.id))
    .innerJoin(leads, eq(outreachEnrollments.leadId, leads.id))
    .groupBy(leads.source),

    db.select({
      position: outreachSteps.position,
      sends:    sql<number>`COUNT(${outreachSends.id})::int`,
    })
    .from(outreachSteps)
    .leftJoin(outreachSends, eq(outreachSends.stepId, outreachSteps.id))
    .groupBy(outreachSteps.position)
    .orderBy(outreachSteps.position),

    db.select({
      pipeline_value: sql<number>`COALESCE(SUM(${leads.dealValue}::numeric), 0)`,
      active_count:   sql<number>`COUNT(*)::int`,
    })
    .from(leads)
    .where(sql`${leads.stage} NOT IN ('closed_won','closed_lost')`),

    db.select({
      stale_count: sql<number>`COUNT(*)::int`,
    })
    .from(leads)
    .where(sql`${leads.stage} NOT IN ('closed_won','closed_lost') AND (${leads.lastActivity} IS NULL OR ${leads.lastActivity} < ${staleCutoffStr})`),

    db.select({
      count: sql<number>`COUNT(*)::int`,
    })
    .from(leads)
    .where(sql`${leads.stage} NOT IN ('closed_won','closed_lost')`),
  ]);

  // Build by_niche array
  type NicheRow = { category: string; leads_total: number; pipeline_value: number; enrolled: number; replied: number; sends: number };
  const nicheMap = new Map<string, NicheRow>();
  for (const r of leadsByNiche) {
    if (!r.category) continue;
    nicheMap.set(r.category, {
      category: r.category,
      leads_total: Number(r.leads_total),
      pipeline_value: Number(r.pipeline_value),
      enrolled: 0, replied: 0, sends: 0,
    });
  }
  for (const r of enrollByNiche) {
    if (!r.category) continue;
    const e = nicheMap.get(r.category) ?? {
      category: r.category, leads_total: 0, pipeline_value: 0, enrolled: 0, replied: 0, sends: 0,
    };
    e.enrolled = Number(r.enrolled);
    e.replied  = Number(r.replied);
    nicheMap.set(r.category, e);
  }
  for (const r of sendsByNiche) {
    if (!r.category) continue;
    const e = nicheMap.get(r.category);
    if (e) e.sends = Number(r.sends);
  }
  const by_niche = Array.from(nicheMap.values())
    .map((r) => ({
      ...r,
      reply_rate: r.enrolled > 0 ? Math.round((r.replied / r.enrolled) * 100) : 0,
    }))
    .sort((a, b) => b.reply_rate - a.reply_rate || b.enrolled - a.enrolled);

  // Best-performing niche (min 3 enrolled to be statistically meaningful)
  const best_niche = by_niche.find((n) => n.enrolled >= 3 && n.replied > 0) ?? null;

  // by_source — same shape, ignore null sources
  type SourceRow = { source: string; leads_total: number; enrolled: number; replied: number; sends: number };
  const sourceMap = new Map<string, SourceRow>();
  for (const r of leadsBySource) {
    const src = r.source ?? "(unknown)";
    sourceMap.set(src, { source: src, leads_total: Number(r.leads_total), enrolled: 0, replied: 0, sends: 0 });
  }
  for (const r of enrollBySource) {
    const src = r.source ?? "(unknown)";
    const e = sourceMap.get(src) ?? { source: src, leads_total: 0, enrolled: 0, replied: 0, sends: 0 };
    e.enrolled = Number(r.enrolled);
    e.replied  = Number(r.replied);
    sourceMap.set(src, e);
  }
  for (const r of sendsBySource) {
    const src = r.source ?? "(unknown)";
    const e = sourceMap.get(src);
    if (e) e.sends = Number(r.sends);
  }
  const by_source = Array.from(sourceMap.values())
    .map((r) => ({
      ...r,
      reply_rate: r.enrolled > 0 ? Math.round((r.replied / r.enrolled) * 100) : 0,
    }))
    .sort((a, b) => b.leads_total - a.leads_total);

  const by_step = sendsByStep.map((r) => ({
    position: Number(r.position),
    label:    `Step ${Number(r.position) + 1}`,
    sends:    Number(r.sends),
  }));

  // Totals
  const total = byStatus.reduce((acc, s) => acc + Number(s.count), 0);
  const replied = Number(byStatus.find((s) => s.status === "replied")?.count ?? 0);
  const sent30d = sendsByDay.reduce((acc, d) => acc + Number(d.count), 0);
  const activeLeads = Number(activeLeadsRow[0]?.count ?? 0);
  const staleLeads  = Number(staleRow[0]?.stale_count ?? 0);
  const pipelineValue = Number(pipelineRow[0]?.pipeline_value ?? 0);

  return c.json({
    totals: {
      enrollments_total:    total,
      replied,
      reply_rate:           total > 0 ? Math.round((replied / total) * 100) : 0,
      sends_last_30_days:   sent30d,
      active_leads:         activeLeads,
      stale_leads:          staleLeads,
      pipeline_value:       pipelineValue,
    },
    by_status:    byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
    sends_by_day: sendsByDay.map((r) => ({ day: r.day, count: Number(r.count) })).reverse(),
    per_sequence: perSequence,
    by_niche,
    by_source,
    by_step,
    best_niche,
  });
});

// ── PER-SEQUENCE ANALYTICS ────────────────────────────────
// GET /outreach/analytics/sequence/:id — deep dive into ONE sequence:
// step-by-step funnel (sent / failed / retention), status breakdown,
// sends over the last 30 days, reply + completion rates, recent failures.
outreach.get("/analytics/sequence/:id", jwtOrApiKey, adminOrApiKey, async (c) => {
  const id = c.req.param("id");

  const [seq] = await db.select().from(outreachSequences).where(eq(outreachSequences.id, id)).limit(1);
  if (!seq) return c.json({ error: "Sequence not found" }, 404);

  const [
    stepConfig,        // step definitions for this sequence
    statusRows,        // enrollment status breakdown
    sendsPerStep,      // sends per step position, split by status
    sendsByDay,        // sent emails per day, last 30d
    recentFailures,    // most recent failed sends with lead context
  ] = await Promise.all([
    db.select({
      id:        outreachSteps.id,
      position:  outreachSteps.position,
      dayOffset: outreachSteps.dayOffset,
      channel:   outreachSteps.channel,
      agentId:   outreachSteps.agentId,
      subject:   outreachSteps.subjectTemplate,
    }).from(outreachSteps).where(eq(outreachSteps.sequenceId, id)).orderBy(outreachSteps.position),

    db.select({
      status: outreachEnrollments.status,
      count:  sql<number>`COUNT(*)::int`,
    }).from(outreachEnrollments).where(eq(outreachEnrollments.sequenceId, id)).groupBy(outreachEnrollments.status),

    db.select({
      position: outreachSteps.position,
      status:   outreachSends.status,
      count:    sql<number>`COUNT(${outreachSends.id})::int`,
    })
    .from(outreachSends)
    .innerJoin(outreachSteps, eq(outreachSends.stepId, outreachSteps.id))
    .where(eq(outreachSteps.sequenceId, id))
    .groupBy(outreachSteps.position, outreachSends.status),

    db.select({
      day:   sql<string>`DATE(${outreachSends.sentAt})::text`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(outreachSends)
    .innerJoin(outreachEnrollments, eq(outreachSends.enrollmentId, outreachEnrollments.id))
    .where(and(
      eq(outreachEnrollments.sequenceId, id),
      eq(outreachSends.status, "sent"),
      sql`${outreachSends.sentAt} > NOW() - INTERVAL '30 days'`,
    ))
    .groupBy(sql`DATE(${outreachSends.sentAt})`)
    .orderBy(sql`DATE(${outreachSends.sentAt})`),

    // Failures, surfaced from the enrollment itself (status='failed') so this
    // also captures enrollments that died before per-send failure logging
    // existed — their reason lives in paused_reason. Going forward, the same
    // reason is also written to outreach_sends.error.
    db.select({
      lead_name:    leads.name,
      lead_company: leads.company,
      lead_email:   leads.email,
      error:        outreachEnrollments.pausedReason,
      sent_at:      outreachEnrollments.lastStepCompletedAt,
      enrolled_at:  outreachEnrollments.enrolledAt,
    })
    .from(outreachEnrollments)
    .innerJoin(leads, eq(outreachEnrollments.leadId, leads.id))
    .where(and(eq(outreachEnrollments.sequenceId, id), eq(outreachEnrollments.status, "failed")))
    .orderBy(desc(outreachEnrollments.enrolledAt))
    .limit(10),
  ]);

  // Status breakdown → totals
  const statusMap = new Map(statusRows.map((r) => [r.status, Number(r.count)]));
  const enrolled  = statusRows.reduce((a, r) => a + Number(r.count), 0);
  const active    = statusMap.get("active")    ?? 0;
  const paused    = statusMap.get("paused")    ?? 0;
  const completed = statusMap.get("completed") ?? 0;
  const replied   = statusMap.get("replied")   ?? 0;
  const failed    = statusMap.get("failed")    ?? 0;

  // Sent / failed counts per step position
  const sentByPos   = new Map<number, number>();
  const failedByPos = new Map<number, number>();
  for (const r of sendsPerStep) {
    const pos = Number(r.position);
    if (r.status === "sent")   sentByPos.set(pos,   Number(r.count));
    if (r.status === "failed") failedByPos.set(pos, Number(r.count));
  }

  // Funnel: retention is measured against step 0's sent count (the baseline).
  const baseline = sentByPos.get(0) ?? 0;
  const funnel = stepConfig.map((st) => {
    const pos    = Number(st.position);
    const sent   = sentByPos.get(pos)   ?? 0;
    const fail   = failedByPos.get(pos) ?? 0;
    return {
      position:      pos,
      label:         `Step ${pos + 1}`,
      day_offset:    Number(st.dayOffset),
      channel:       st.channel,
      has_agent:     !!st.agentId,
      subject:       st.subject,
      sent,
      failed:        fail,
      retention_pct: baseline > 0 ? Math.round((sent / baseline) * 100) : 0,
    };
  });

  const totalSends  = Array.from(sentByPos.values()).reduce((a, n) => a + n, 0);
  const totalFailed = Array.from(failedByPos.values()).reduce((a, n) => a + n, 0);

  return c.json({
    sequence: {
      id:          seq.id,
      name:        seq.name,
      description: seq.description,
      category:    seq.category,
      is_active:   seq.isActive,
      step_count:  stepConfig.length,
    },
    totals: {
      enrolled,
      active,
      paused,
      completed,
      replied,
      failed,
      sends:           totalSends,
      sends_failed:    totalFailed,
      reply_rate:      enrolled > 0 ? Math.round((replied / enrolled) * 100) : 0,
      completion_rate: enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0,
    },
    by_status:    statusRows.map((r) => ({ status: r.status, count: Number(r.count) })),
    funnel,
    sends_by_day: sendsByDay.map((r) => ({ day: r.day, count: Number(r.count) })),
    recent_failures: recentFailures.map((r) => ({
      lead_name:    r.lead_name,
      lead_company: r.lead_company,
      lead_email:   r.lead_email,
      error:        r.error,
      sent_at:      r.sent_at ?? r.enrolled_at,
    })),
  });
});

export default outreach;
