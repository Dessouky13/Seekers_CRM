// Sprint 3 — CRM / Leads endpoints
import { Hono } from "hono";
import { z } from "zod";
import { eq, and, not, inArray, ilike, or, sql, gte, desc, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { leads, leadActivities, leadStrikes, profiles, events } from "../db/schema";
import { authMiddleware, adminOnly, forcedAssigneeId, canAccessOwned, isAdmin } from "../middleware/auth";
import {
  createLeadSchema, updateLeadSchema, createLeadActivitySchema,
  crmInsightsQuerySchema, bulkUpdateLeadsSchema, bulkCommentLeadsSchema,
  createLeadStrikeSchema,
} from "../utils/validators";
import { orChat } from "../services/openrouter";
import { fireEventAsync } from "../services/webhooks";
import { phoneFields } from "../services/phone";
import {
  resolveBulkScope, bulkLeadWhereTerms, buildBulkLeadPatch, assertBulkPatchAllowed,
} from "../services/bulk-leads";
import {
  STRIKE_LIMIT, normalizeStrikeLimitAction, strikeActivity, strikeLimitEffects,
} from "../services/lead-strikes";
import { getCompanySettings } from "../services/documents";
import { cairoToday, cairoDaysAgo } from "../utils/dates";
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
  // assignee_id is normally a profile uuid. The literal "unassigned" is the one
  // non-uuid value accepted, because "which leads has nobody picked up?" is the
  // question the filter exists to answer and a null cannot be matched with eq().
  // Handled before the uuid branch: passing it through to eq() would send the
  // string to Postgres and fail on the uuid cast rather than filter anything.
  if (q.assignee_id === "unassigned") {
    conditions.push(isNull(leads.assigneeId));
  } else if (q.assignee_id) {
    conditions.push(eq(leads.assigneeId, q.assignee_id));
  }
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

  // Archived leads (strike limit reached under the "archive" policy) are hidden
  // by DEFAULT — that hiding is the only thing that makes "archive" different
  // from "close lost". `?archived=only` is what stops archiving being a one-way
  // door: without a way to list them, an archived lead would be unreachable
  // except by remembering its id.
  if (q.archived === "only")          conditions.push(sql`${leads.archivedAt} IS NOT NULL`);
  else if (q.archived !== "include")  conditions.push(isNull(leads.archivedAt));

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
      // Correlated subquery rather than a LEFT JOIN + GROUP BY: the join would
      // have to group by every column of `leads` (30 of them) and the count is
      // one index-only lookup on idx_lead_strikes_lead per row. Kept out of the
      // frontend as a computed field so the dot indicator never has to fetch
      // per-lead history to draw three dots.
      strikeCount:  sql<number>`(SELECT COUNT(*)::int FROM lead_strikes ls WHERE ls.lead_id = ${leads.id})`,
    })
    .from(leads)
    .leftJoin(profiles, eq(leads.assigneeId, profiles.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${leads.updatedAt} DESC`)
    .limit(limit);

  return c.json(rows.map(({ lead, assigneeName, strikeCount }) => ({
    ...lead,
    assignee_name: assigneeName,
    strikeCount:   Number(strikeCount ?? 0),
    strikeLimit:   STRIKE_LIMIT,
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
      // CURRENT_DATE is the *session* timezone's date, which on a UTC VPS is
      // yesterday for the first hours of the Cairo day. Anchor it explicitly.
      sql`(${leads.lastActivity} IS NULL
           OR ${leads.lastActivity} <= (NOW() AT TIME ZONE 'Africa/Cairo')::date - INTERVAL '2 days')`,
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
  const [activities, strikes, settings] = await Promise.all([
    db
      .select()
      .from(leadActivities)
      .where(eq(leadActivities.leadId, id))
      .orderBy(desc(leadActivities.date), desc(leadActivities.createdAt)),
    leadStrikeHistory(id),
    // The policy travels with the lead. /company-settings is admin-gated as a
    // module, so a member could not read it — and the UI needs to be able to say
    // "the next strike will close this lead" before they tap.
    getCompanySettings(),
  ]);

  return c.json({
    ...row.lead,
    assignee_name:      row.assigneeName,
    activities,
    strikes,
    strikeCount:        strikes.length,
    strikeLimit:        STRIKE_LIMIT,
    strikeLimitAction:  normalizeStrikeLimitAction(settings.strikeLimitAction),
  });
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
      // `!== undefined` rather than `||`: null is a real value here (clear the
      // follow-up), and `body.follow_up_at || existing.followUpAt` would
      // silently ignore every attempt to clear one.
      followUpAt:   body.follow_up_at   !== undefined ? body.follow_up_at   : existing.followUpAt,
      followUpNote: body.follow_up_note !== undefined ? (body.follow_up_note || null) : existing.followUpNote,
      // Archive / restore. `new Date()` is an instant, not a calendar day, so
      // there is no Cairo-day question here — unlike every `date` column above.
      archivedAt:   body.archived === undefined
                      ? existing.archivedAt
                      : (body.archived ? (existing.archivedAt ?? new Date()) : null),
      lastActivity: stageChanged ? cairoToday() : existing.lastActivity,
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

// ── Bulk edit + bulk comment ──────────────────────────────
//
// Both mutate many rows from one request, so both are built the same way and
// both carry the same three-layer guard against an unfiltered statement:
//
//   1. Zod `.min(1)` on `ids` (utils/validators.ts) — the wire.
//   2. resolveBulkScope()    (services/bulk-leads.ts) — refuses again without
//      depending on Zod, and pins members to their own leads.
//   3. `conditions.length === 0` below — the last line before the statement is
//      built, because `where(undefined)` makes Drizzle omit the clause entirely
//      and that is how 735 leads were deleted in one request.
//
// Layer 3 looks redundant next to 1 and 2. It is not: the two earlier layers are
// about the INPUT, and this one is about the STATEMENT. It is the only one that
// still holds if a future field is added to the plan and forgotten here.

/**
 * Turn a resolved scope into Drizzle conditions, or refuse.
 *
 * Returns `null` when no WHERE term resolved. Every caller must treat `null` as
 * a hard 400 and must not build a statement.
 */
function bulkLeadConditions(scope: { ids: string[]; forcedAssigneeId: string | null }) {
  const conditions = bulkLeadWhereTerms(scope).map((term) =>
    term.kind === "id_in"
      ? inArray(leads.id, term.ids)
      : eq(leads.assigneeId, term.assigneeId),
  );
  return conditions.length === 0 ? null : conditions;
}

const REFUSED_UNFILTERED = {
  error: "Refusing to run a bulk update with no WHERE condition. " +
         "This would have matched every lead in the database.",
} as const;

// POST /crm/leads/bulk-update — apply the same field changes to many leads.
// Not admin-only: a member may already PATCH their own leads one at a time, and
// row scoping means this reaches exactly the same set. Reassignment is the one
// field a member cannot touch (assertBulkPatchAllowed).
crm.post("/leads/bulk-update", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = bulkUpdateLeadsSchema.parse(await c.req.json());

  const allowed = assertBulkPatchAllowed(body.patch, user);
  if (!allowed.ok) return c.json({ error: "Forbidden", message: allowed.error }, allowed.status);

  const scope = resolveBulkScope({ ids: body.ids, user });
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);

  const patch = buildBulkLeadPatch(body.patch);
  // An empty `.set()` is either a syntax error or a pointless updated_at bump,
  // and either way the request asked for nothing. Zod's refine already catches
  // `patch: {}`; this catches a patch whose only key was a blank stage.
  if (patch.changed.length === 0) {
    return c.json({ error: "Choose at least one field to change" }, 400);
  }

  const conditions = bulkLeadConditions(scope);
  if (!conditions) return c.json(REFUSED_UNFILTERED, 400);

  // The exact rows this will touch, resolved BEFORE the write. Doubles as the
  // dry-run answer and as the per-lead activity list for a stage move — a
  // member's request may name leads they do not own, and those must be reported
  // as "not yours", not silently counted.
  const targets = await db
    .select({ id: leads.id, stage: leads.stage })
    .from(leads)
    .where(and(...conditions));

  if (body.dry_run) {
    return c.json({
      updated:      0,
      would_update: targets.length,
      skipped:      body.ids.length - targets.length,
      fields:       patch.changed,
    });
  }

  if (targets.length === 0) {
    return c.json({ updated: 0, skipped: body.ids.length, fields: patch.changed });
  }

  const updated = await db
    .update(leads)
    .set({
      ...patch.columns,
      // A stage move IS activity on the lead — same rule the single-lead PATCH
      // follows. cairoToday(), never toISOString(): between Cairo midnight and
      // 02:00 the UTC day is still yesterday, which would backdate the move and
      // immediately make the lead look stale.
      ...(patch.stageChanged ? { lastActivity: cairoToday() } : {}),
      updatedAt: new Date(),
    } as never)
    .where(and(...conditions))
    .returning({ id: leads.id });

  // One activity per lead, so each lead's own timeline explains itself. The
  // single-lead PATCH writes the identically-worded row; a bulk move must not be
  // the one path that leaves the history silent.
  // Leads already in the target stage are skipped: "Stage moved to contacted" on
  // a lead that was already contacted is a lie, and selecting a whole column in
  // the kanban would have written one per lead.
  const moved = patch.stageChanged
    ? targets.filter((t) => t.stage !== patch.columns.stage)
    : [];
  // `values([])` is a runtime error in Drizzle, not a no-op.
  if (moved.length > 0) {
    const label = String(patch.columns.stage).replace(/_/g, " ");
    await db.insert(leadActivities).values(
      moved.map((t) => ({
        leadId:      t.id,
        type:        "note" as const,
        description: `Stage moved to ${label}`,
        date:        cairoToday(),
        createdBy:   user.id,
      })),
    );
  }

  // Audit trail. A single request that rewrote 200 leads should be visible after
  // the fact, for the same reason bulk-delete records itself.
  await db.insert(events).values({
    leadId: null,
    type:   "leads_bulk_updated",
    source: "crm",
    payload: {
      by:     user.id,
      count:  updated.length,
      fields: patch.changed,
      patch:  patch.columns,
    },
  });

  return c.json({
    updated: updated.length,
    skipped: body.ids.length - updated.length,
    fields:  patch.changed,
  });
});

// POST /crm/leads/bulk-comment — the same comment on many leads, as one
// activity per lead. Deliberately not a single shared note: the timeline is
// per-lead, and a lead whose history pointed at a batch record somewhere else
// would be unreadable six months later.
crm.post("/leads/bulk-comment", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = bulkCommentLeadsSchema.parse(await c.req.json());

  const scope = resolveBulkScope({ ids: body.ids, user });
  if (!scope.ok) return c.json({ error: scope.error }, scope.status);

  const conditions = bulkLeadConditions(scope);
  if (!conditions) return c.json(REFUSED_UNFILTERED, 400);

  // Resolve the real, scoped set first: activities are inserted by lead id, so
  // without this a member could write onto somebody else's lead by id alone.
  const targets = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(...conditions));

  if (targets.length === 0) {
    return c.json({ commented: 0, skipped: body.ids.length });
  }

  // A comment logged at 22:00 Cairo belongs to that evening, not to tomorrow.
  const date = body.date ?? cairoToday();

  const inserted = await db
    .insert(leadActivities)
    .values(targets.map((t) => ({
      leadId:      t.id,
      type:        body.type ?? ("note" as const),
      description: body.description,
      date,
      createdBy:   user.id,
    })))
    .returning({ id: leadActivities.id });

  // Logging activity moves last_activity, exactly as the single-lead endpoint
  // does — otherwise commenting on 50 leads would leave all 50 still flagged as
  // going quiet.
  await db
    .update(leads)
    .set({ lastActivity: date, updatedAt: new Date() })
    .where(and(...conditions));

  return c.json({ commented: inserted.length, skipped: body.ids.length - inserted.length });
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

  const [lead] = await db
    .select({ id: leads.id, assigneeId: leads.assigneeId, followUpAt: leads.followUpAt })
    .from(leads).where(eq(leads.id, leadId)).limit(1);
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
      // An activity logged at 22:00 Cairo belongs to that evening, not to tomorrow.
      date:        body.date ?? cairoToday(),
      createdBy:   user.id,
    })
    .returning();

  // Logging the activity IS keeping the promise, so the follow-up clears
  // itself. Without this, doing the thing you scheduled left the reminder
  // standing and the lead kept raising a "follow-up overdue" card until
  // somebody remembered to go and clear it by hand.
  //
  // Only clears a follow-up that has actually come due (`<= activity.date`).
  // A note logged on Tuesday against a follow-up booked for Thursday is
  // progress, not the promise — that one must survive.
  const clearsFollowUp =
    lead.followUpAt !== null && lead.followUpAt <= activity.date;

  await db
    .update(leads)
    .set({
      lastActivity: activity.date,
      ...(clearsFollowUp ? { followUpAt: null, followUpNote: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(leads.id, leadId));

  return c.json(activity, 201);
});

// ── Manual contact strikes ────────────────────────────────
//
// Three hand-made attempts to reach a lead, then a configurable decision. The
// COUNT is always derived from the rows — there is no counter column to drift.
// All the decisions (which activity type a strike may claim, whether the limit is
// reached, what reaching it writes) live in services/lead-strikes.ts so they are
// unit-testable without a database.

/** The strikes for one lead, newest first, with the person who recorded each. */
async function leadStrikeHistory(leadId: string) {
  return db
    .select({
      id:        leadStrikes.id,
      leadId:    leadStrikes.leadId,
      channel:   leadStrikes.channel,
      note:      leadStrikes.note,
      date:      leadStrikes.date,
      createdBy: leadStrikes.createdBy,
      createdAt: leadStrikes.createdAt,
      by_name:   profiles.name,
    })
    .from(leadStrikes)
    .leftJoin(profiles, eq(leadStrikes.createdBy, profiles.id))
    .where(eq(leadStrikes.leadId, leadId))
    .orderBy(desc(leadStrikes.createdAt));
}

// POST /crm/leads/:id/strikes — record one manual contact attempt.
crm.post("/leads/:id/strikes", authMiddleware, async (c) => {
  const leadId = c.req.param("id");
  const user   = c.get("user");
  const body   = createLeadStrikeSchema.parse(await c.req.json().catch(() => ({})));

  const [lead] = await db
    .select({ id: leads.id, assigneeId: leads.assigneeId, stage: leads.stage })
    .from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return c.json({ error: "Lead not found" }, 404);
  // 404 not 403, so a member cannot probe which lead ids exist — same as the
  // single-lead GET and PATCH above.
  if (!canAccessOwned(user, lead.assigneeId)) {
    return c.json({ error: "Lead not found" }, 404);
  }

  const [strike] = await db
    .insert(leadStrikes)
    .values({
      leadId,
      channel: body.channel ?? null,
      note:    body.note?.trim() || null,
      // A WhatsApp sent at 23:30 Cairo belongs to that evening. cairoToday(),
      // never toISOString().slice(0, 10) — that is the UTC day.
      date:    body.date ?? cairoToday(),
      createdBy: user.id,
    })
    .returning();

  // Counted from the rows, after the insert, so the number in the response and
  // the number in the history can never disagree.
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(leadStrikes)
    .where(eq(leadStrikes.leadId, leadId));
  const strikeCount = Number(count);

  const timeline = [{
    leadId,
    ...strikeActivity({ count: strikeCount, channel: body.channel, note: body.note }),
    date:      strike.date,
    createdBy: user.id,
  }];

  // The policy is read per request rather than cached: it is one indexed row on a
  // single-row table, and an admin changing it in Settings must take effect on
  // the very next strike rather than after a restart.
  const action  = normalizeStrikeLimitAction((await getCompanySettings()).strikeLimitAction);
  const effects = strikeLimitEffects({ count: strikeCount, action, now: new Date() });

  if (effects.activity) {
    timeline.push({ leadId, ...effects.activity, date: strike.date, createdBy: user.id });
  }

  await db.insert(leadActivities).values(timeline);

  await db
    .update(leads)
    .set({
      ...effects.patch,
      lastActivity: strike.date,
      updatedAt:    new Date(),
    })
    .where(eq(leads.id, leadId));

  if (effects.reached && lead.stage !== "closed_lost") {
    fireEventAsync("lead.stage_changed", {
      lead_id:      leadId,
      from_stage:   lead.stage,
      to_stage:     "closed_lost",
      reason:       `strike_limit_${effects.applied}`,
      strike_count: strikeCount,
    });
  }

  return c.json({
    strike,
    strike_count:  strikeCount,
    strike_limit:  STRIKE_LIMIT,
    limit_action:  action,
    limit_applied: effects.applied,
    strikes:       await leadStrikeHistory(leadId),
  }, 201);
});

// DELETE /crm/leads/:leadId/strikes/:strikeId — undo a strike recorded in error.
//
// Deliberately available: the count is derived, so removing the row is the only
// correct way to fix a mis-tap, and without this a stray strike would be
// permanent. It does NOT reverse an automatic close/archive — that is a stage
// change the user can see and undo themselves, and silently reopening a lead
// because a strike was deleted would be a surprise.
crm.delete("/leads/:leadId/strikes/:strikeId", authMiddleware, async (c) => {
  const leadId = c.req.param("leadId");

  const [lead] = await db
    .select({ assigneeId: leads.assigneeId })
    .from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return c.json({ error: "Strike not found" }, 404);
  if (!canAccessOwned(c.get("user"), lead.assigneeId)) {
    return c.json({ error: "Strike not found" }, 404);
  }

  const [deleted] = await db
    .delete(leadStrikes)
    .where(and(
      eq(leadStrikes.id,     c.req.param("strikeId")),
      eq(leadStrikes.leadId, leadId),
    ))
    .returning({ id: leadStrikes.id });
  if (!deleted) return c.json({ error: "Strike not found" }, 404);

  return c.json({
    strike_count: (await leadStrikeHistory(leadId)).length,
    strike_limit: STRIKE_LIMIT,
  });
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
  const to = parsed.to ?? cairoToday();

  const defaultFrom = (() => {
    if (parsed.period === "weekly")  return cairoDaysAgo(7);
    if (parsed.period === "monthly") return cairoDaysAgo(30);
    return cairoDaysAgo(14);
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
      // updated_at is a timestamptz — a bare ::date would bucket it by the session
      // timezone, so the same lead could fall in or out of the range depending on
      // which connection ran the query.
      sql`(${leads.updatedAt} AT TIME ZONE 'Africa/Cairo')::date >= ${from}`,
      sql`(${leads.updatedAt} AT TIME ZONE 'Africa/Cairo')::date <= ${to}`,
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
