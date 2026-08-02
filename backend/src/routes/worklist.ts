// The Daily Loop — one ranked list of what needs a human, plus the supply-side
// health of the pipeline that feeds it.
//
//   GET /worklist                → per-user ranked actions (everyone)
//   GET /worklist/pipeline-health → supply metrics + runway (admin only)
//
// Deliberately NOT registered under ADMIN_ONLY_MODULES: the whole point is that
// a member opens the app and is told what to do. Scoping happens per-row inside
// fetchWorklist, not by blocking the route.
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { getWorklist } from "../services/worklist";
import type { AppEnv } from "../types";

const worklist = new Hono<AppEnv>();

// How many items the Today screen shows before "show everything". Five is a
// deliberate product decision: a list that always looks finishable gets worked,
// a list of 60 gets ignored.
const FOCUS_COUNT = 5;

worklist.get("/", authMiddleware, async (c) => {
  const actions = await getWorklist(c.get("user"));

  const counts = {
    total:   actions.length,
    now:     actions.filter((a) => a.urgency === "now").length,
    today:   actions.filter((a) => a.urgency === "today").length,
    week:    actions.filter((a) => a.urgency === "week").length,
    replies: actions.filter((a) => a.type === "reply_waiting").length,
  };

  return c.json({
    focus:   actions.slice(0, FOCUS_COUNT),
    rest:    actions.slice(FOCUS_COUNT),
    counts,
    // Surfaced so the UI can say "you're clear" rather than render an empty box.
    all_clear: actions.length === 0,
  });
});

// ── Supply health ─────────────────────────────────────────
//
// The headline is `runway_days`: at the current send rate, how long until we
// run out of leads we have never contacted. That is the number that turns
// "we don't have enough leads" into a dated, ownable problem.
worklist.get("/pipeline-health", authMiddleware, adminOnly, async (c) => {
  const [supply, flow] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) FILTER (
          WHERE created_at > NOW() - INTERVAL '7 days')::int          AS new_7d,
        COUNT(*) FILTER (
          WHERE stage NOT IN ('closed_won','closed_lost'))::int       AS active,
        COUNT(*) FILTER (
          WHERE tech_fingerprint IS NOT NULL)::int                    AS enriched,
        COUNT(*)::int                                                 AS total,
        -- "Sendable but never touched" is the real fuel gauge: an active lead
        -- with an address that has never been emailed by the sequencer.
        COUNT(*) FILTER (
          WHERE stage NOT IN ('closed_won','closed_lost')
            AND email IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM outreach_enrollments e
                JOIN outreach_sends s ON s.enrollment_id = e.id
               WHERE e.lead_id = leads.id AND s.status = 'sent'))::int AS uncontacted
      FROM leads`),

    db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM outreach_sends
          WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '7 days')::int AS sent_7d,
        (SELECT COUNT(*) FROM outreach_enrollments
          WHERE status = 'replied'
            AND completed_at > NOW() - INTERVAL '7 days')::int                AS replies_7d`),
  ]);

  const s = (supply.rows[0] ?? {}) as Record<string, unknown>;
  const f = (flow.rows[0]   ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => Number(v ?? 0);

  const uncontacted = n(s.uncontacted);
  const sent7d      = n(f.sent_7d);
  const sendRate    = sent7d / 7;

  // No sending at all means runway is undefined, not infinite — say so rather
  // than printing a reassuring number nobody should trust.
  const runwayDays = sendRate > 0 ? Math.floor(uncontacted / sendRate) : null;
  const threshold  = Number(process.env.SUPPLY_RUNWAY_WARN_DAYS ?? 7);
  const starving   = runwayDays !== null && runwayDays < threshold;

  const total    = n(s.total);
  const enriched = n(s.enriched);
  const replies  = n(f.replies_7d);

  return c.json({
    new_leads_7d:    n(s.new_7d),
    active_leads:    n(s.active),
    total_leads:     total,
    enriched_pct:    total > 0 ? Math.round((enriched / total) * 100) : 0,
    uncontacted,
    sent_7d:         sent7d,
    replies_7d:      replies,
    reply_rate_pct:  sent7d > 0 ? Math.round((replies / sent7d) * 1000) / 10 : 0,
    send_rate_day:   Math.round(sendRate * 10) / 10,
    runway_days:     runwayDays,
    starving,
    // Pre-written so the UI, the WhatsApp digest and the alert all say the
    // same thing rather than each inventing their own phrasing.
    headline: runwayDays === null
      ? "Nothing has been sent in the last 7 days — the machine is idle."
      : starving
        ? `At ${Math.round(sendRate)} sends/day you run out of un-contacted leads in ${runwayDays} days. Sourcing needs to top up.`
        : `${runwayDays} days of leads left at the current send rate.`,
  });
});

export default worklist;
