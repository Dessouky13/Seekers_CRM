// Sprint 3 — CRM / Leads endpoints
import { Hono } from "hono";
import { eq, and, not, inArray, ilike, or, sql, gte } from "drizzle-orm";
import { db } from "../db/client";
import { leads, leadActivities, profiles } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import {
  createLeadSchema, updateLeadSchema, createLeadActivitySchema,
  crmInsightsQuerySchema,
} from "../utils/validators";
import { getOpenAIClient } from "../services/openai";
import type { AppEnv } from "../types";

const crm = new Hono<AppEnv>();

// GET /crm/leads
crm.get("/leads", authMiddleware, async (c) => {
  const q = c.req.query() as Record<string, string>;
  const rawLimit = Number(q.limit ?? 50);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 50;
  const search = q.search?.trim();

  const conditions = [];
  if (q.stage)       conditions.push(eq(leads.stage, q.stage as any));
  if (q.assignee_id) conditions.push(eq(leads.assigneeId, q.assignee_id));
  if (q.category)    conditions.push(eq(leads.category, q.category));
  if (search) {
    conditions.push(
      or(
        ilike(leads.name,    `%${search}%`),
        ilike(leads.company, `%${search}%`),
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
    .orderBy(sql`${leads.updatedAt} DESC`)
    .limit(limit);

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

// GET /crm/insights — outreach analytics + optional AI summary
crm.get("/insights", authMiddleware, async (c) => {
  const parsed = crmInsightsQuerySchema.parse(c.req.query());
  const to = parsed.to ?? new Date().toISOString().slice(0, 10);

  const defaultFrom = (() => {
    const now = new Date();
    if (parsed.period === "weekly") {
      now.setDate(now.getDate() - 7);
    } else if (parsed.period === "monthly") {
      now.setDate(now.getDate() - 30);
    } else {
      now.setDate(now.getDate() - 14);
    }
    return now.toISOString().slice(0, 10);
  })();

  const from = parsed.from ?? defaultFrom;

  const outreachPerDay = await db
    .select({
      date: leadActivities.date,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(leadActivities)
    .where(and(
      gte(leadActivities.date, from),
      sql`${leadActivities.date} <= ${to}`,
      inArray(leadActivities.type, ["email", "call", "meeting", "form"]),
    ))
    .groupBy(leadActivities.date)
    .orderBy(leadActivities.date);

  const nichesContacted = await db
    .select({
      niche: leads.category,
      count: sql<number>`COUNT(DISTINCT ${leads.id})::int`,
    })
    .from(leads)
    .leftJoin(leadActivities, eq(leadActivities.leadId, leads.id))
    .where(and(
      sql`${leads.category} IS NOT NULL`,
      gte(leadActivities.date, from),
      sql`${leadActivities.date} <= ${to}`,
      inArray(leadActivities.type, ["email", "call", "meeting", "form"]),
    ))
    .groupBy(leads.category)
    .orderBy(sql`COUNT(DISTINCT ${leads.id}) DESC`);

  const [{ sent_count }] = await db
    .select({ sent_count: sql<number>`COUNT(*)::int` })
    .from(leadActivities)
    .where(and(
      gte(leadActivities.date, from),
      sql`${leadActivities.date} <= ${to}`,
      inArray(leadActivities.type, ["email", "call", "form"]),
    ));

  const [{ replied_count }] = await db
    .select({ replied_count: sql<number>`COUNT(*)::int` })
    .from(leads)
    .where(and(
      inArray(leads.stage, ["call_scheduled", "proposal_sent", "negotiation", "closed_won"]),
      sql`${leads.updatedAt}::date >= ${from}`,
      sql`${leads.updatedAt}::date <= ${to}`,
    ));

  const sent = Number(sent_count ?? 0);
  const replied = Number(replied_count ?? 0);
  const responseRate = sent > 0 ? Math.min(100, Math.round((replied / sent) * 100)) : 0;

  let messageSummary: string | null = null;
  let suggestions: string[] = [];

  if (parsed.include_ai === "true" && process.env.OPENAI_API_KEY) {
    const sampleMessages = await db
      .select({ description: leadActivities.description })
      .from(leadActivities)
      .where(and(
        gte(leadActivities.date, from),
        sql`${leadActivities.date} <= ${to}`,
        inArray(leadActivities.type, ["email", "call", "meeting", "form"]),
      ))
      .orderBy(sql`${leadActivities.createdAt} DESC`)
      .limit(50);

    if (sampleMessages.length > 0) {
      const openai = getOpenAIClient();
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: "You are a CRM outreach analyst. Return concise operational output only.",
          },
          {
            role: "user",
            content: `Summarize outreach quality and provide 3 practical message-improvement suggestions.\n\nOutreach notes:\n${sampleMessages.map((m) => `- ${m.description}`).join("\n")}`,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? "";
      messageSummary = raw || null;
      suggestions = raw
        .split("\n")
        .map((line) => line.replace(/^[-\d.)\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 3);
    }
  }

  return c.json({
    period: { from, to, granularity: parsed.period ?? "daily" },
    outreach_per_day: outreachPerDay,
    niches_contacted: nichesContacted
      .filter((row) => row.niche)
      .map((row) => ({ niche: row.niche, count: row.count })),
    message_summary: messageSummary,
    suggestions,
    response_rate: {
      sent,
      replied,
      percentage: responseRate,
    },
  });
});

export default crm;
