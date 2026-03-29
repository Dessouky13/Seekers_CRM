// Sprint 3 — CRM / Leads endpoints
import { Hono } from "hono";
import { eq, and, ne, not, inArray, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { leads, leadActivities, profiles } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import {
  createLeadSchema, updateLeadSchema, createLeadActivitySchema,
} from "../utils/validators";
import type { AppEnv } from "../types";

const crm = new Hono<AppEnv>();

// GET /crm/leads
crm.get("/leads", authMiddleware, async (c) => {
  const q = c.req.query() as Record<string, string>;

  const conditions = [];
  if (q.stage)       conditions.push(eq(leads.stage, q.stage as any));
  if (q.assignee_id) conditions.push(eq(leads.assigneeId, q.assignee_id));
  if (q.category)    conditions.push(eq(leads.category, q.category));
  if (q.search) {
    conditions.push(
      or(
        ilike(leads.name,    `%${q.search}%`),
        ilike(leads.company, `%${q.search}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      lead:         leads,
      assigneeName: profiles.name,
    })
    .from(leads)
    .leftJoin(profiles, eq(leads.assigneeId, profiles.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${leads.updatedAt} DESC`);

  return c.json(rows.map(({ lead, assigneeName }) => ({
    ...lead,
    assignee_name: assigneeName,
  })));
});

// POST /crm/leads
crm.post("/leads", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = createLeadSchema.parse(await c.req.json());

  const [lead] = await db
    .insert(leads)
    .values({
      name:       body.name,
      company:    body.company,
      email:      body.email    || null,
      phone:      body.phone    || null,
      source:     body.source   || null,
      category:   body.category || null,
      dealValue:  body.deal_value ? String(body.deal_value) : "0",
      assigneeId: body.assignee_id ?? user.id,
      notes:      body.notes    ?? null,
    })
    .returning();

  // Auto-create initial activity
  await db.insert(leadActivities).values({
    leadId:      lead.id,
    type:        "note",
    description: "Lead created",
    createdBy:   user.id,
  });

  return c.json(lead, 201);
});

// GET /crm/stale-leads — leads not updated in 2+ days (active only)
crm.get("/stale-leads", authMiddleware, async (c) => {
  const rows = await db
    .select({
      lead:         leads,
      assigneeName: profiles.name,
    })
    .from(leads)
    .leftJoin(profiles, eq(leads.assigneeId, profiles.id))
    .where(and(
      not(inArray(leads.stage, ["closed_won", "closed_lost"])),
      sql`(${leads.lastActivity} IS NULL OR ${leads.lastActivity}::date <= CURRENT_DATE - INTERVAL '2 days')`,
    ))
    .orderBy(sql`${leads.lastActivity} ASC NULLS FIRST`);

  return c.json(rows.map(({ lead, assigneeName }) => ({
    ...lead,
    assignee_name: assigneeName,
  })));
});

// GET /crm/leads/:id — with activities
crm.get("/leads/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");

  const [row] = await db
    .select({ lead: leads, assigneeName: profiles.name })
    .from(leads)
    .leftJoin(profiles, eq(leads.assigneeId, profiles.id))
    .where(eq(leads.id, id))
    .limit(1);

  if (!row) return c.json({ error: "Lead not found" }, 404);

  const activities = await db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.leadId, id))
    .orderBy(leadActivities.date);

  return c.json({ ...row.lead, assignee_name: row.assigneeName, activities });
});

// PATCH /crm/leads/:id — auto-activity on stage change
crm.patch("/leads/:id", authMiddleware, async (c) => {
  const id      = c.req.param("id");
  const user    = c.get("user");
  const body    = updateLeadSchema.parse(await c.req.json());

  const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!existing) return c.json({ error: "Lead not found" }, 404);

  const stageChanged = body.stage && body.stage !== existing.stage;

  const [updated] = await db
    .update(leads)
    .set({
      name:         body.name        ?? existing.name,
      company:      body.company     ?? existing.company,
      email:        body.email       !== undefined ? (body.email || null) : existing.email,
      phone:        body.phone       !== undefined ? (body.phone || null) : existing.phone,
      source:       body.source      !== undefined ? (body.source || null) : existing.source,
      category:     body.category    !== undefined ? (body.category || null) : existing.category,
      dealValue:    body.deal_value  !== undefined ? String(body.deal_value) : existing.dealValue,
      stage:        (body.stage      ?? existing.stage) as any,
      assigneeId:   body.assignee_id !== undefined ? (body.assignee_id || null) : existing.assigneeId,
      notes:        body.notes       !== undefined ? (body.notes || null) : existing.notes,
      lastActivity: stageChanged ? new Date().toISOString().slice(0, 10) : existing.lastActivity,
      updatedAt:    new Date(),
    })
    .where(eq(leads.id, id))
    .returning();

  if (stageChanged) {
    await db.insert(leadActivities).values({
      leadId:      id,
      type:        "note",
      description: `Stage moved to ${body.stage!.replace(/_/g, " ")}`,
      createdBy:   user.id,
    });
  }

  return c.json(updated);
});

// DELETE /crm/leads/:id — admin only
crm.delete("/leads/:id", authMiddleware, adminOnly, async (c) => {
  const [deleted] = await db
    .delete(leads)
    .where(eq(leads.id, c.req.param("id")))
    .returning({ id: leads.id });

  if (!deleted) return c.json({ error: "Lead not found" }, 404);
  return new Response(null, { status: 204 });
});

// POST /crm/leads/:id/activities
crm.post("/leads/:id/activities", authMiddleware, async (c) => {
  const leadId = c.req.param("id");
  const user   = c.get("user");
  const body   = createLeadActivitySchema.parse(await c.req.json());

  const [lead] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return c.json({ error: "Lead not found" }, 404);

  const [activity] = await db
    .insert(leadActivities)
    .values({
      leadId,
      type:        body.type,
      description: body.description,
      date:        body.date ?? new Date().toISOString().slice(0, 10),
      createdBy:   user.id,
    })
    .returning();

  await db
    .update(leads)
    .set({ lastActivity: activity.date, updatedAt: new Date() })
    .where(eq(leads.id, leadId));

  return c.json(activity, 201);
});

// GET /crm/categories — distinct categories in use
crm.get("/categories", authMiddleware, async (c) => {
  const rows = await db
    .selectDistinct({ category: leads.category })
    .from(leads)
    .where(sql`${leads.category} IS NOT NULL`);
  return c.json(rows.map((r) => r.category).filter(Boolean));
});

// GET /crm/pipeline-summary
crm.get("/pipeline-summary", authMiddleware, async (c) => {
  const STAGE_LABELS: Record<string, string> = {
    new_lead:       "New Lead",
    contacted:      "Contacted",
    call_scheduled: "Call Scheduled",
    proposal_sent:  "Proposal Sent",
    negotiation:    "Negotiation",
    closed_won:     "Closed Won",
    closed_lost:    "Closed Lost",
  };

  const rows = await db
    .select({
      stage:       leads.stage,
      count:       sql<number>`COUNT(*)::int`,
      total_value: sql<number>`SUM(deal_value::numeric)`,
    })
    .from(leads)
    .groupBy(leads.stage)
    .orderBy(leads.stage);

  return c.json(
    rows.map((r) => ({
      stage:       r.stage,
      stage_label: STAGE_LABELS[r.stage] ?? r.stage,
      count:       r.count,
      total_value: Number(r.total_value ?? 0),
    })),
  );
});

export default crm;
