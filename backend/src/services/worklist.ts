// Worklist — database side.
//
// Collects the six sources of "something needs a human" and hands them to the
// pure ranker in worklist-ranking.ts. Keeping the SQL here and the scoring
// there is what lets the scoring be tested without a database.
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { leads } from "../db/schema";
import { isAdmin } from "../middleware/auth";
import { manualTouchRow, type ManualTouchQueryRow } from "./manual-touch";
import { rankWorklist, type WorklistInputs, type WorklistAction } from "./worklist-ranking";

export * from "./worklist-ranking";

const STALE_DAYS  = Number(process.env.WORKLIST_STALE_DAYS ?? 7);
const HOT_VIEWS   = Number(process.env.WORKLIST_HOT_VIEWS ?? 3);
/**
 * "This lead is still in play." Every query below that touches a lead must
 * carry it — a closed-won or closed-lost lead is finished, and asking someone
 * to chase it is noise at best and embarrassing at worst.
 *
 * Written against the `l` alias every query below uses, NOT against the Drizzle
 * `leads` table object. It previously interpolated `${leads.stage}`, which
 * renders `"leads"."stage"` — invalid SQL inside these alias-based queries — and
 * as a result the constant was referenced by nothing at all while all five
 * queries spelled the predicate out by hand. One of them (manual touches) then
 * simply forgot to, which is what let a closed lead raise a manual-touch card.
 */
const ACTIVE_ONLY = sql`l.stage NOT IN ('closed_won','closed_lost')`;

/**
 * Collect everything the ranker needs for one user.
 *
 * Members only ever see their own leads and tasks — the same server-side
 * scoping the rest of the API uses, so dropping a query param can't widen it.
 * Two of the six sources (blocked sequences, unassigned leads) are
 * company-level problems and are admin-only.
 */
export async function fetchWorklist(
  user: { id: string; role?: string },
): Promise<WorklistInputs> {
  const admin = isAdmin(user);
  const mine  = admin ? sql`TRUE` : sql`l.assignee_id = ${user.id}`;
  const empty = Promise.resolve({ rows: [] as any[] });

  /**
   * Task scoping, which is deliberately NOT the same as `mine`.
   *
   * Leads are the company's; tasks are a person's. An admin can pick up any
   * lead and message them, so `mine` widens to everything for an admin. Nobody
   * can do somebody else's task, so an admin's *personal* queue showing one is
   * pure noise with an "Open task" button that leads nowhere useful. Measured
   * on this database: the admin's queue carried seven overdue tasks, two of
   * them assigned to a member.
   *
   * Orphans are the exception and the reason this isn't simply
   * `t.assignee_id = user.id` for everyone: a task with no assignee is nobody's
   * and would otherwise appear in no queue at all. It surfaces to admins, whose
   * job it is to hand it out.
   */
  const myTasks = admin
    ? sql`(t.assignee_id = ${user.id} OR t.assignee_id IS NULL)`
    : sql`t.assignee_id = ${user.id}`;

  const [replies, hotLeads, blocked, dueTasks, staleLeads, unassigned, manualTouches, followUps] = await Promise.all([
    // A reply needs a human until a human actually does something about it.
    // "Something" = any activity logged BY A PERSON (created_by IS NOT NULL —
    // the sequencer and the inbox poller both write with a null author) after
    // the reply landed. That makes the queue self-clearing through normal use
    // instead of needing its own "mark as done" button to fall out of sync.
    db.execute(sql`
      SELECT l.id, l.name, l.company, l.deal_value, e.completed_at AS replied_at,
             (SELECT a.description FROM lead_activities a
               WHERE a.lead_id = l.id AND a.type = 'email'
               ORDER BY a.created_at DESC LIMIT 1) AS preview
        FROM outreach_enrollments e
        JOIN leads l ON l.id = e.lead_id
       WHERE e.status = 'replied'
         AND e.completed_at IS NOT NULL
         AND ${ACTIVE_ONLY}
         AND ${mine}
         AND NOT EXISTS (
           SELECT 1 FROM lead_activities a
            WHERE a.lead_id = l.id
              AND a.created_by IS NOT NULL
              AND a.created_at > e.completed_at)
       ORDER BY e.completed_at DESC
       LIMIT 50`),

    db.execute(sql`
      SELECT l.id, l.name, l.company, l.deal_value,
             au.views, au.slug, au.updated_at AS last_view_at
        FROM audits au
        JOIN leads l ON l.id = au.lead_id
       WHERE au.views >= ${HOT_VIEWS}
         AND ${ACTIVE_ONLY}
         AND ${mine}
       ORDER BY au.views DESC
       LIMIT 50`),

    admin
      ? db.execute(sql`
          SELECT MIN(e.id::text) AS enrollment_id, s.name AS sequence_name,
                 MIN(e.paused_reason) AS reason, COUNT(*)::int AS lead_count,
                 MIN(e.enrolled_at) AS since
            FROM outreach_enrollments e
            LEFT JOIN outreach_sequences s ON s.id = e.sequence_id
           WHERE e.status IN ('paused','failed')
             AND e.paused_reason IS NOT NULL
             AND e.paused_reason <> 'cancelled'
           GROUP BY s.name, e.paused_reason
           ORDER BY COUNT(*) DESC
           LIMIT 20`)
      : empty,

    // CURRENT_DATE, not a TypeScript day-string: this database runs with
    // TimeZone = Africa/Cairo, so CURRENT_DATE already is the Cairo calendar
    // day the team means by "due today".
    db.execute(sql`
      SELECT t.id, t.title, t.due_date, t.priority, p.name AS project_name
        FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.status <> 'done' AND t.due_date IS NOT NULL
         AND t.due_date <= CURRENT_DATE
         AND ${myTasks}
       ORDER BY t.due_date ASC LIMIT 50`),

    // Ownerless leads are deliberately excluded here — they come back as
    // `unassigned_lead` instead. A lead with no owner isn't a follow-up
    // problem, it's an ownership problem, and "chase this" is the wrong
    // instruction when there is nobody to do the chasing. Keeping the two
    // sets disjoint also means the deduper never has to choose between them.
    db.execute(sql`
      SELECT l.id, l.name, l.company, l.deal_value, l.stage, l.last_activity
        FROM leads l
       WHERE ${ACTIVE_ONLY}
         AND l.assignee_id IS NOT NULL
         AND ${mine}
         AND (l.last_activity IS NULL
              OR l.last_activity < CURRENT_DATE - (${STALE_DAYS} || ' days')::interval)
         -- A follow-up already scheduled for a future day is a decision, and
         -- this card exists to catch leads nobody has decided about. Without
         -- this clause, booking "call them Thursday" changed nothing: the lead
         -- kept raising a "nothing for 9 days" card every day until Thursday,
         -- and the only way to quieten it was Today's client-side Skip, which
         -- forgets on reload. A follow-up that is due or overdue is NOT
         -- excluded — it comes back as the higher-ranked follow_up_due card,
         -- and the deduper keeps just that one.
         AND (l.follow_up_at IS NULL OR l.follow_up_at <= CURRENT_DATE)
       ORDER BY l.deal_value DESC NULLS LAST
       LIMIT 50`),

    admin
      ? db.execute(sql`
          SELECT l.id, l.name, l.company, l.deal_value, l.created_at
            FROM leads l
           WHERE l.assignee_id IS NULL
             AND ${ACTIVE_ONLY}
           ORDER BY l.created_at DESC LIMIT 50`)
      : empty,

    // Enrollments blocked on a human, with the step's message already rendered
    // so the card can show what to say without a second round trip. `since` is
    // when the enrollment arrived at this step (last advance, or enrollment
    // itself if it's the first step) — that's what "blocked for three days"
    // means, not when it was enrolled in the sequence.
    //
    // Deliberately a THIN query: it selects the raw routing facts
    // (phone_type, whatsapp_status) and decides nothing with them. Whether a
    // whatsapp step may actually be presented as WhatsApp is decided by
    // services/channels.ts:manualTouchRouting below — that file is the single
    // authority on channel eligibility, and duplicating its landline/
    // whatsapp_status rules in SQL is how the two would drift.
    db.execute(sql`
      SELECT e.id                                            AS "enrollmentId",
             l.id                                             AS "leadId",
             l.name                                           AS "leadName",
             l.company                                        AS "leadCompany",
             l.phone_e164                                     AS "phoneE164",
             l.phone_type                                     AS "phoneType",
             l.whatsapp_status                                AS "whatsappStatus",
             l.deal_value                                     AS "dealValue",
             s.channel                                        AS channel,
             s.body_template                                  AS message,
             COALESCE(e.last_step_completed_at, e.enrolled_at) AS since
        FROM outreach_enrollments e
        JOIN leads l          ON l.id = e.lead_id
        JOIN outreach_steps s ON s.sequence_id = e.sequence_id
                             AND s.position    = e.current_step
       WHERE e.status = 'awaiting_action'
         AND ${ACTIVE_ONLY}
         AND ${mine}
       ORDER BY e.enrolled_at
       LIMIT 50`),

    // Follow-ups whose day has come. Scoped with `mine` like every other
    // lead-based source (an admin oversees the whole pipeline and can action
    // any lead), unlike tasks — see the myTasks comment above for why those
    // two differ.
    db.execute(sql`
      SELECT l.id, l.name, l.company, l.deal_value, l.stage,
             l.follow_up_at, l.follow_up_note
        FROM leads l
       WHERE l.follow_up_at IS NOT NULL
         AND l.follow_up_at <= CURRENT_DATE
         AND ${ACTIVE_ONLY}
         AND ${mine}
       ORDER BY l.follow_up_at ASC
       LIMIT 50`),
  ]);

  const num  = (v: unknown) => Number(v ?? 0);
  const date = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

  return {
    now: new Date(),
    replies: (replies.rows as any[]).map((r) => ({
      leadId: r.id, name: r.name, company: r.company,
      dealValue: num(r.deal_value), repliedAt: date(r.replied_at),
      preview: cleanPreview(r.preview),
    })),
    hotLeads: (hotLeads.rows as any[]).map((r) => ({
      leadId: r.id, name: r.name, company: r.company, dealValue: num(r.deal_value),
      views: num(r.views), slug: r.slug, lastViewAt: date(r.last_view_at),
    })),
    blocked: (blocked.rows as any[]).map((r) => ({
      enrollmentId: r.enrollment_id, sequenceName: r.sequence_name,
      reason: r.reason, leadCount: num(r.lead_count), since: date(r.since),
    })),
    dueTasks: (dueTasks.rows as any[]).map((r) => ({
      taskId: r.id, title: r.title, dueDate: String(r.due_date).slice(0, 10),
      priority: r.priority, projectName: r.project_name,
    })),
    staleLeads: (staleLeads.rows as any[]).map((r) => ({
      leadId: r.id, name: r.name, company: r.company, dealValue: num(r.deal_value),
      stage: r.stage, lastActivity: r.last_activity ? date(r.last_activity) : null,
    })),
    unassigned: (unassigned.rows as any[]).map((r) => ({
      leadId: r.id, name: r.name, company: r.company,
      dealValue: num(r.deal_value), createdAt: date(r.created_at),
    })),
    followUps: (followUps.rows as any[]).map((r) => ({
      leadId: r.id, name: r.name, company: r.company, dealValue: num(r.deal_value),
      stage: r.stage, dueDate: String(r.follow_up_at).slice(0, 10),
      note: r.follow_up_note ?? null,
    })),
    // Route every manual touch through channels.ts before it becomes a card.
    // manualTouchRow is where the "WhatsApp must never target a landline"
    // guarantee is enforced: a whatsapp step on a landline, or on a number a
    // human has already marked as having no WhatsApp, is downgraded to a call
    // there, so no wa.me link can ever be built for it downstream. The card is
    // downgraded rather than dropped on purpose — dropping it would leave the
    // enrollment sitting in awaiting_action with nothing in the product able to
    // clear it.
    //
    // The mapping is a pure function in manual-touch.ts rather than inline here
    // ONLY so that it has a test: this function queries the database and the
    // test suite has no database, so while the downgrade lived in this file it
    // could be deleted without failing anything.
    manualTouches: (manualTouches.rows as unknown as ManualTouchQueryRow[]).map(manualTouchRow),
  };
}

/** Strip our own markers and collapse the reply to one short line. */
function cleanPreview(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw
    .replace(/^\[Reply received\]\s*/i, "")
    .replace(/^\[Sequence\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || null;
}

export async function getWorklist(
  user: { id: string; role?: string },
): Promise<WorklistAction[]> {
  return rankWorklist(await fetchWorklist(user));
}
