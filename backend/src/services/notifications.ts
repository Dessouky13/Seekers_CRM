import { and, eq, inArray, not, sql } from "drizzle-orm";
import { db } from "../db/client";
import { notifications, notificationEvents, leads } from "../db/schema";
import { cairoToday } from "../utils/dates";
import {
  buildStaleLeadDigest, staleLeadDigestKey, type StaleLeadGroup,
} from "./stale-lead-digest";

export { buildStaleLeadDigest, staleLeadDigestKey, type StaleLeadGroup };

export type NotificationPayload = {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
};

export async function createNotification(payload: NotificationPayload) {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      link: payload.link ?? null,
    })
    .returning();

  return row;
}

export async function createUniqueNotification(eventKey: string, payload: NotificationPayload) {
  return db.transaction(async (tx) => {
    const [existingEvent] = await tx
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(and(
        eq(notificationEvents.userId, payload.userId),
        eq(notificationEvents.eventKey, eventKey),
      ))
      .limit(1);

    if (existingEvent) return null;

    const [created] = await tx
      .insert(notifications)
      .values({
        userId: payload.userId,
        type: payload.type,
        title: payload.title,
        body: payload.body ?? null,
        link: payload.link ?? null,
      })
      .returning();

    await tx.insert(notificationEvents).values({
      userId: payload.userId,
      eventKey,
    });

    return created;
  });
}

export async function notifyTaskAssigned(args: {
  taskId: string;
  assigneeId: string;
  taskTitle: string;
  assignedByName: string;
}) {
  const eventKey = `task-assigned:${args.taskId}:${args.assigneeId}`;
  return createUniqueNotification(eventKey, {
    userId: args.assigneeId,
    type: "task_assigned",
    title: "New task assigned",
    body: `${args.assignedByName} assigned you: ${args.taskTitle}`,
    link: `/tasks?task=${args.taskId}`,
  });
}

// ── Stale-lead digest ─────────────────────────────────────────────────────
//
// This used to be one notification PER STALE LEAD, each written in its own
// `createUniqueNotification` transaction, on a sweep that runs every 10 minutes.
// The arithmetic is what makes it a bug rather than a wart: 719 stale leads
// locally × 144 sweeps a day ≈ 103,000 transactions a day to produce, at best,
// 719 rows nobody reads. The old dedupe key was scoped to the lead AND the day,
// so it also minted a brand-new notification for every stale lead EVERY day,
// forever. Measured on this database: 738 `lead_no_response` rows, 736 of them
// created on a single day, and a `notification_events` table growing ~700
// rows/day with no pruning. The bell was unusable — which means the ONE
// notification that mattered (a reply came in) was buried under 700 that did not.
//
// The wording and the dedupe key live in stale-lead-digest.ts so they can be
// unit-tested without a database; this file owns the queries.

/** Notification `type` for the digest. Also what the refresh path matches on. */
export const STALE_LEAD_DIGEST_TYPE = "lead_no_response";

export type StaleLeadSweepResult = {
  /** Distinct people who have at least one stale lead. */
  users: number;
  /** Total stale leads across everyone — the number the OLD path created a row for. */
  staleLeads: number;
  /** Digest notifications inserted by this sweep. */
  created: number;
  /** Existing digests whose count moved since the last sweep today. */
  refreshed: number;
};

export async function runStaleLeadNotificationSweep(
  hoursWithoutReply = 48,
  now = new Date(),
): Promise<StaleLeadSweepResult> {
  const intervalExpr = `${hoursWithoutReply} hours`;

  // ONE aggregate query instead of one row per lead. The work this sweep does is
  // now proportional to the size of the team (3), not to the size of the pipeline
  // (600+), which is the property that actually needed fixing.
  const groups = await db
    .select({
      userId: sql<string>`${leads.assigneeId}`,
      staleCount: sql<number>`COUNT(*)::int`,
      sample: sql<string[]>`(ARRAY_AGG(${leads.name} ORDER BY ${leads.lastActivity} ASC NULLS FIRST))[1:3]`,
    })
    .from(leads)
    .where(and(
      not(inArray(leads.stage, ["closed_won", "closed_lost"])),
      sql`${leads.assigneeId} IS NOT NULL`,
      // Cairo, matching every other calendar-day comparison in the codebase.
      sql`(${leads.lastActivity} IS NULL
           OR ${leads.lastActivity} <= ((NOW() AT TIME ZONE 'Africa/Cairo') - (${intervalExpr})::interval)::date)`,
    ))
    .groupBy(leads.assigneeId);

  const staleLeads = groups.reduce((sum, g) => sum + g.staleCount, 0);

  if (groups.length === 0) {
    await pruneNotificationHistory(now);
    return { users: 0, staleLeads: 0, created: 0, refreshed: 0 };
  }

  const today = cairoToday(now);
  const keys = groups.map((g) => staleLeadDigestKey(g.userId, today));

  const alreadyDigested = new Set(
    (await db
      .select({ eventKey: notificationEvents.eventKey })
      .from(notificationEvents)
      .where(inArray(notificationEvents.eventKey, keys)))
      .map((r) => r.eventKey),
  );

  const fresh = groups.filter((g) => !alreadyDigested.has(staleLeadDigestKey(g.userId, today)));

  // One batched insert for the notifications and one for the dedupe events,
  // inside a single transaction — rather than a transaction per lead.
  let created = 0;
  if (fresh.length > 0) {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(notifications)
        .values(fresh.map((g) => {
          const digest = buildStaleLeadDigest(g, hoursWithoutReply);
          return {
            userId: g.userId,
            type: STALE_LEAD_DIGEST_TYPE,
            title: digest.title,
            body: digest.body,
            link: digest.link,
          };
        }))
        .returning({ id: notifications.id });

      await tx
        .insert(notificationEvents)
        .values(fresh.map((g) => ({
          userId: g.userId,
          eventKey: staleLeadDigestKey(g.userId, today),
        })));

      created = inserted.length;
    });
  }

  // Keep today's digest honest as more leads go quiet through the day, instead of
  // creating a second row. `IS DISTINCT FROM` makes an unchanged count a no-op, so
  // the steady state is a handful of zero-row updates per sweep — bounded by team
  // size, not by lead count.
  //
  // The predicate matches on the digest's own link as well as its type, and both
  // come from buildStaleLeadDigest rather than being spelled out here. Without the
  // link, this matched any lead_no_response row created today — which, on a
  // database still holding rows from the old per-lead path, meant rewriting those
  // instead. Caught by running this sweep against the real local database.
  let refreshed = 0;
  for (const group of groups) {
    if (fresh.includes(group)) continue;
    const digest = buildStaleLeadDigest(group, hoursWithoutReply);
    const updated = await db
      .update(notifications)
      .set({ title: digest.title, body: digest.body })
      .where(and(
        eq(notifications.userId, group.userId),
        eq(notifications.type, STALE_LEAD_DIGEST_TYPE),
        eq(notifications.link, digest.link),
        sql`(${notifications.createdAt} AT TIME ZONE 'Africa/Cairo')::date = ${today}`,
        sql`${notifications.title} IS DISTINCT FROM ${digest.title}`,
      ))
      .returning({ id: notifications.id });
    refreshed += updated.length;
  }

  await pruneNotificationHistory(now);

  return { users: groups.length, staleLeads, created, refreshed };
}

// ── Pruning ───────────────────────────────────────────────────────────────
//
// Neither table had any retention, so both grew forever — `notification_events`
// at roughly 700 rows a day.
//
// Three rules, deliberately different from each other:
//
//   1. Superseded stale-lead digests are deleted regardless of read state.
//      A digest is a restatement of the current situation, not a record of an
//      event: once today's exists, yesterday's "12 leads have gone quiet" is
//      strictly worse information about the same leads, and the leads themselves
//      are still in the pipeline. Nothing is lost by removing it. This is also
//      what clears the 738-row backlog the old per-lead path left behind, at the
//      root rather than by a one-off manual DELETE.
//
//   2. READ notifications age out after 60 days. Ordinary.
//
//   3. UNREAD non-digest notifications are never deleted, however old. "A reply
//      came in" is a record of something that happened; deleting it unread would
//      silently destroy the one thing the person had not got to.

const EVENT_RETENTION_DAYS = Number(process.env.NOTIFICATION_EVENT_RETENTION_DAYS ?? 60);
const READ_RETENTION_DAYS = Number(process.env.NOTIFICATION_READ_RETENTION_DAYS ?? 60);

/** Once per Cairo day is plenty; the sweep itself runs every 10 minutes. */
let lastPruneDay: string | null = null;

/** Test seam — lets a test re-run the once-per-day prune. */
export function __resetPruneGuard() { lastPruneDay = null; }

export async function pruneNotificationHistory(now = new Date()): Promise<{
  events: number; read: number; supersededDigests: number;
}> {
  const today = cairoToday(now);
  if (lastPruneDay === today) return { events: 0, read: 0, supersededDigests: 0 };
  lastPruneDay = today;

  // (1) Digests from a previous Cairo day.
  const superseded = await db
    .delete(notifications)
    .where(and(
      eq(notifications.type, STALE_LEAD_DIGEST_TYPE),
      sql`(${notifications.createdAt} AT TIME ZONE 'Africa/Cairo')::date < ${today}`,
    ))
    .returning({ id: notifications.id });

  // (2) Dedupe bookkeeping past its usefulness.
  const events = EVENT_RETENTION_DAYS > 0
    ? await db
        .delete(notificationEvents)
        .where(sql`${notificationEvents.createdAt} < NOW() - (${`${EVENT_RETENTION_DAYS} days`})::interval`)
        .returning({ id: notificationEvents.id })
    : [];

  // (3) Read notifications, of any type.
  const read = READ_RETENTION_DAYS > 0
    ? await db
        .delete(notifications)
        .where(and(
          eq(notifications.read, true),
          sql`${notifications.createdAt} < NOW() - (${`${READ_RETENTION_DAYS} days`})::interval`,
        ))
        .returning({ id: notifications.id })
    : [];

  return { events: events.length, read: read.length, supersededDigests: superseded.length };
}
