// Sprint 3 — CRM / Leads endpoints
import { Hono } from "hono";
import { z } from "zod";
import { eq, and, not, inArray, ilike, or, sql, gte, desc } from "drizzle-orm";
import { db } from "../db/client";
import { leads, leadActivities, profiles, events } from "../db/schema";
import { authMiddleware, adminOnly, forcedAssigneeId, canAccessOwned, isAdmin } from "../middleware/auth";
import {
  createLeadSchema, updateLeadSchema, createLeadActivitySchema,
  crmInsightsQuerySchema,
} from "../utils/validators";
import { orChat } from "../services/openrouter";
import { fireEventAsync } from "../services/webhooks";
import { phoneFields } from "../services/phone";
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

  // "Unreachable" means every channel is dead: no usable number, and no email
  // or an email we must never use. Such a lead cannot be enrolled at all
  // (services/outreach.ts:assertReachable refuses it), and without this filter
  // it is invisible — indistinguishable from one simply waiting its turn.
  //
  // MUST stay in step with services/channels.ts, which is the authority on
  // channel eligibility; this is only its SQL projection so the filter can run
  // in the database. In particular the phone half is `phone_e164 IS NULL`
  // ALONE. It used to also treat `whatsapp_status = 'no'` as killing the phone
  // channel, which contradicted channels.ts:callState — a landline, or a mobile
  // a human has confirmed has no WhatsApp, is still perfectly callable, and this
  // is an agency that makes calls. The two files disagreed about the very same
  // lead: one called it unreachable while the other happily routed it to a call.
  // channels.ts is authoritative, so the whatsapp_status term is gone.
  //
  // email_status is nullable (most leads are "unknown", i.e. NULL). A bare
  // `email_status = 'bounced'` is NULL — not FALSE — for those rows, which
  // under three-valued logic makes the whole AND/OR chain NULL instead of
  // FALSE. WHERE excludes NULL, so both this filter and its `NOT` negation
  // would silently drop those leads and reachable+unreachable < total.
  // coalesce() forces a real boolean so the predicate and its negation are
  // exact complements for every row.
  const UNREACHABLE = sql`(
    ${leads.phoneE164} IS NULL
    AND (
      -- blank/whitespace-only counts as no address, same as channels.ts:emailState
      coalesce(trim(${leads.email}), '') = ''
      OR coalesce(${leads.emailStatus}, '') = 'bounced'
      OR EXISTS (SELECT 1 FROM suppressions s WHERE s.address = lower(trim(${leads.email})))
    )
  )`;

  if (q.reachability === "unreachable") conditions.push(UNREACHABLE);
  if (q.reachability === "reachable")   conditions.push(sql`NOT ${UNREACHABLE}`);

  // Members only ever see their OWN leads. Enforced server-side and applied
  // last so it cannot be widened by a client-supplied assignee_id filter.
  const forced = forcedAssigneeId(c.get("user"));
  if (forced) conditions.push(eq(leads.assigneeId, forced));
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
      ...phoneFields(body.phone),
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
  const forcedStale = forcedAssigneeId(c.get("user"));
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
      ...(forcedStale ? [eq(leads.assigneeId, forcedStale)] : []),
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

  // Members may only open leads assigned to them. Return 404 (not 403) so a
  // member can't probe which lead ids exist.
  if (!canAccessOwned(c.get("user"), row.lead.assigneeId)) {
    return c.json({ error: "Lead not found" }, 404);
  }

  // Newest first. Ordering by `date` alone (a DATE column) left same-day
  // entries in arbitrary order, so a freshly logged call could appear above or
  // below the reply it followed; createdAt is the real tiebreaker.
  const activities = await db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.leadId, id))
    .orderBy(desc(leadActivities.date), desc(leadActivities.createdAt));

  return c.json({ ...row.lead, assignee_name: row.assigneeName, activities });
});

// PATCH /crm/leads/:id — auto-activity on stage change
crm.patch("/leads/:id", authMiddleware, async (c) => {
  const id      = c.req.param("id");
  const user    = c.get("user");
  const body    = updateLeadSchema.parse(await c.req.json());

  const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!existing) return c.json({ error: "Lead not found" }, 404);
  if (!canAccessOwned(user, existing.assigneeId)) {
    return c.json({ error: "Lead not found" }, 404);
  }
  // Members cannot reassign a lead away from (or to) someone else.
  if (!isAdmin(user) && body.assignee_id && body.assignee_id !== user.id) {
    return c.json({ error: "Forbidden", message: "You cannot reassign leads" }, 403);
  }

  const stageChanged = body.stage && body.stage !== existing.stage;

  // Only recompute phone_e164/phone_type when phone is actually part of this
  // request — otherwise every unrelated PATCH (e.g. a stage move) would waste
  // work re-deriving them from unchanged state. But when phone IS present,
  // even as "" to clear it, all three columns must move together or a cleared
  // lead keeps a ghost E.164 that no longer matches its (now blank) phone.
  //
  // Changing the number also retires what we had learned about the OLD one.
  // whatsapp_status records a human's observation about a specific number
  // ("I opened this chat and there was nothing there"), so carrying it across an
  // edit would apply one number's finding to a different number — suppressing
  // WhatsApp on a freshly entered mobile that nobody has ever tried. Reset to
  // "unknown" so it is re-learned, exactly as the wrong_number outcome does.
  const phoneChanged = body.phone !== undefined
    && phoneFields(body.phone).phoneE164 !== existing.phoneE164;

  const phoneUpdate = body.phone !== undefined
    ? {
        ...phoneFields(body.phone),
        ...(phoneChanged ? { whatsappStatus: "unknown" as const } : {}),
      }
    : { phone: existing.phone, phoneE164: existing.phoneE164, phoneType: existing.phoneType };

  const [updated] = await db
    .update(leads)
    .set({
      name:         body.name        ?? existing.name,
      company:      body.company     ?? existing.company,
      email:        body.email       !== undefined ? (body.email || null) : existing.email,
      ...phoneUpdate,
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

    // Fire webhook for stage change (and lead.assigned if it was an assignment change too)
    fireEventAsync("lead.stage_changed", {
      lead_id:     updated.id,
      lead_name:   updated.name,
      lead_company: updated.company,
      from_stage:  existing.stage,
      to_stage:    updated.stage,
      assignee_id: updated.assigneeId,
      deal_value:  Number(updated.dealValue ?? 0),
    });
  }

  return c.json(updated);
});

// POST /crm/leads/bulk-delete — admin only, requires explicit confirmation phrase
// Body: { keep_sources?: string[], delete_sources?: string[], confirm: "DELETE_LEADS" }
// Returns: { deleted: number, preview: { id, name, company, source }[] (first 20) }
// Cascades to lead_activities + outreach_enrollments + outreach_sends via FK ON DELETE CASCADE.
const bulkDeleteSchema = z.object({
  // Explicit selection from the UI (tick boxes). Capped — a runaway client
  // should not be able to ask for the whole table in one call.
  ids:            z.array(z.string().uuid()).max(1000).optional(),
  // .min(1): an EMPTY array must not be accepted. `![]` is false in JS, so an
  // empty array slipped past the "did you provide a filter?" guard below while
  // contributing no SQL condition — which produced an unfiltered DELETE. See the
  // defence-in-depth check at the filter-mode branch.
  keep_sources:   z.array(z.string().min(1)).min(1).optional(),
  delete_sources: z.array(z.string().min(1)).min(1).optional(),
  dry_run:        z.boolean().optional(),
  confirm:        z.literal("DELETE_LEADS"),
});

crm.post("/leads/bulk-delete", authMiddleware, adminOnly, async (c) => {
  const body = bulkDeleteSchema.parse(await c.req.json());

  // ── Selection mode: delete exactly the ticked rows ──
  // This is a hard delete that cascades to activities, enrollments and sends.
  // There is no undo, so the contract is: you always get an exact count and a
  // preview first (dry_run), and every execution is written to the events log.
  if (body.ids && body.ids.length > 0) {
    const rows = await db
      .select({ id: leads.id, name: leads.name, company: leads.company, source: leads.source })
      .from(leads)
      .where(inArray(leads.id, body.ids));

    if (body.dry_run) {
      return c.json({ deleted: 0, would_delete: rows.length, preview: rows.slice(0, 50) });
    }

    const deleted = await db
      .delete(leads)
      .where(inArray(leads.id, body.ids))
      .returning({ id: leads.id, name: leads.name, company: leads.company });

    // Audit trail. The rows themselves are gone; this at least records who
    // removed what and when, which is the minimum after the task-cleanup
    // incident showed how invisible silent deletion is.
    if (deleted.length > 0) {
      await db.insert(events).values({
        leadId: null,
        type:   "leads_bulk_deleted",
        source: "crm",
        payload: {
          by:      c.get("user").id,
          count:   deleted.length,
          mode:    "selection",
          deleted: deleted.slice(0, 200),
        },
      });
    }

    return c.json({ deleted: deleted.length, mode: "selection" });
  }

  // ── Filter mode: delete by source ──
  // At least one of keep_sources / delete_sources is required.
  if (!body.keep_sources && !body.delete_sources) {
    return c.json({ error: "Provide ids, keep_sources, or delete_sources" }, 400);
  }

  const conditions = [];
  if (body.keep_sources && body.keep_sources.length > 0) {
    // Delete leads whose source is NOT in the keep list (NULL also gets deleted)
    conditions.push(sql`(${leads.source} IS NULL OR ${leads.source} NOT IN (${sql.join(body.keep_sources.map((s) => sql`${s}`), sql`, `)}))`);
  }
  if (body.delete_sources && body.delete_sources.length > 0) {
    conditions.push(sql`${leads.source} IN (${sql.join(body.delete_sources.map((s) => sql`${s}`), sql`, `)})`);
  }
  // Defence in depth. The Zod `.min(1)` above already rejects an empty array,
  // but this is the last line before an irreversible DELETE that cascades to
  // lead_activities, outreach_enrollments and outreach_sends, so it does not
  // rely on validation alone. If `conditions` were ever empty, `where` would be
  // `undefined`, Drizzle would omit the clause entirely, and this would delete
  // EVERY lead in the database. Never build the statement in that state.
  if (conditions.length === 0) {
    return c.json({
      error: "Refusing to delete: no source filter resolved to a condition. " +
             "Provide a non-empty keep_sources or delete_sources.",
    }, 400);
  }

  const where = conditions.length > 1 ? sql`(${conditions[0]}) AND (${conditions[1]})` : conditions[0];

  // True total count (uncapped) + 50-row preview + per-source breakdown
  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(leads)
    .where(where);

  const preview = await db
    .select({ id: leads.id, name: leads.name, company: leads.company, source: leads.source })
    .from(leads)
    .where(where)
    .limit(50);

  const breakdown = await db
    .select({
      source: leads.source,
      count:  sql<number>`COUNT(*)::int`,
    })
    .from(leads)
    .where(where)
    .groupBy(leads.source);

  if (body.dry_run) {
    return c.json({
      deleted:      0,
      would_delete: Number(total),
      by_source:    breakdown.map((r) => ({ source: r.source ?? "(null)", count: Number(r.count) })),
      preview,
    });
  }

  // Execute
  const deleted = await db.delete(leads).where(where).returning({ id: leads.id });

  if (deleted.length > 0) {
    await db.insert(events).values({
      leadId: null,
      type:   "leads_bulk_deleted",
      source: "crm",
      payload: {
        by:    c.get("user").id,
        count: deleted.length,
        mode:  "source_filter",
        keep_sources:   body.keep_sources   ?? null,
        delete_sources: body.delete_sources ?? null,
      },
    });
  }

  return c.json({
    deleted:   deleted.length,
    by_source: breakdown.map((r) => ({ source: r.source ?? "(null)", count: Number(r.count) })),
  });
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

  const [lead] = await db.select({ id: leads.id, assigneeId: leads.assigneeId }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return c.json({ error: "Lead not found" }, 404);
  if (!canAccessOwned(user, lead.assigneeId)) {
    return c.json({ error: "Lead not found" }, 404);
  }

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

// DELETE /crm/leads/:leadId/activities/:activityId — remove an activity from the timeline
crm.delete("/leads/:leadId/activities/:activityId", authMiddleware, async (c) => {
  const leadId = c.req.param("leadId");

  // Members may only touch activities on their own leads.
  const [lead] = await db.select({ assigneeId: leads.assigneeId }).from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return c.json({ error: "Activity not found" }, 404);
  if (!canAccessOwned(c.get("user"), lead.assigneeId)) {
    return c.json({ error: "Activity not found" }, 404);
  }

  const [deleted] = await db
    .delete(leadActivities)
    .where(and(
      eq(leadActivities.id,     c.req.param("activityId")),
      eq(leadActivities.leadId, leadId),
    ))
    .returning({ id: leadActivities.id });
  if (!deleted) return c.json({ error: "Activity not found" }, 404);
  return new Response(null, { status: 204 });
});

// GET /crm/categories — distinct categories in use (scoped to caller's leads)
crm.get("/categories", authMiddleware, async (c) => {
  const forcedCat = forcedAssigneeId(c.get("user"));
  const rows = await db
    .selectDistinct({ category: leads.category })
    .from(leads)
    .where(and(
      sql`${leads.category} IS NOT NULL`,
      ...(forcedCat ? [eq(leads.assigneeId, forcedCat)] : []),
    ));
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

  // Members see pipeline numbers for their OWN leads only.
  const forcedPipe = forcedAssigneeId(c.get("user"));
  const rows = await db
    .select({
      stage:       leads.stage,
      count:       sql<number>`COUNT(*)::int`,
      total_value: sql<number>`SUM(deal_value::numeric)`,
    })
    .from(leads)
    .where(forcedPipe ? eq(leads.assigneeId, forcedPipe) : undefined)
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

// GET /crm/insights — outreach analytics + optional AI summary (admin-only:
// aggregates across the whole pipeline, not just the caller's leads)
crm.get("/insights", authMiddleware, adminOnly, async (c) => {
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

  if (parsed.include_ai === "true" && process.env.OPENROUTER_API_KEY) {
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
      // OpenRouter — same key that powers the agents. Cheap + fast (gemini-2.0-flash).
      // Wrapped in try/catch so any upstream failure (key revoked, rate limit) degrades
      // gracefully to message_summary=null instead of breaking the whole response.
      try {
        const result = await orChat({
          temperature: 0.3,
          max_tokens:  500,
          messages: [
            {
              role: "system",
              content: "You are a CRM outreach analyst. Return concise operational output only. Output a 1-2 sentence summary, then a blank line, then exactly 3 short numbered suggestions for improving outreach messages. No preamble.",
            },
            {
              role: "user",
              content: `Summarize the team's recent outreach quality. Then give 3 practical message-improvement suggestions.\n\nOutreach notes:\n${sampleMessages.map((m) => `- ${m.description?.slice(0, 280) ?? ""}`).join("\n")}`,
            },
          ],
        });

        const raw = result.output ?? "";
        // Split into summary (first paragraph) + suggestions (subsequent numbered lines)
        const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
        const numbered = lines.filter((l) => /^[\-\*\d]/.test(l));
        const summaryLines = lines.filter((l) => !/^[\-\*\d]/.test(l));
        messageSummary = summaryLines.join(" ").trim() || null;
        suggestions = numbered
          .map((line) => line.replace(/^[\-\*\d.)\s]+/, "").trim())
          .filter(Boolean)
          .slice(0, 3);
      } catch (err: any) {
        console.warn("[crm/insights] AI summary skipped:", err?.message ?? err);
        messageSummary = null;
        suggestions = [];
      }
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
