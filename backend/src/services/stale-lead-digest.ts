// The pure half of the stale-lead digest: what it says, and what makes two
// digests "the same one".
//
// Split out from notifications.ts for the same reason sending-policy.ts is split
// out of outreach.ts — the wording and the dedupe key are the parts that decide
// whether the bell is usable, so they need to be testable without a database.
//
// Background: this replaced a notification PER STALE LEAD, written in its own
// transaction, on a sweep that runs every 10 minutes. 719 stale leads × 144
// sweeps ≈ 103,000 transactions a day, producing 719 rows nobody reads — and
// because the old dedupe key was `lead-no-response:{leadId}:{day}`, a fresh set
// every single day, forever. Measured here: 738 rows, 736 of them on one day.
//
// One person can act on this exactly one way — open their queue and work it —
// so one notification per person per day is the right granularity.

export type StaleLeadGroup = {
  userId: string;
  staleCount: number;
  /** A few lead names, oldest first, purely to make the body concrete. */
  sample: string[];
};

/**
 * Dedupe key: one digest per user per Cairo day.
 *
 * Nothing in it varies with a lead. That is the whole fix — the old key did,
 * which is why 719 stale leads produced 719 notifications.
 */
export function staleLeadDigestKey(userId: string, day: string): string {
  return `lead-no-response-digest:${userId}:${day}`;
}

/**
 * The digest text.
 *
 * The link goes to /today rather than /crm because Today is this app's per-user
 * queue: it already ranks stale leads by value and age, and it is the only
 * surface where "these need you" is scoped to the person being notified. /crm
 * would drop them into all 600 leads with no filter applied.
 */
export function buildStaleLeadDigest(group: StaleLeadGroup, hoursWithoutReply: number) {
  const n = group.staleCount;
  // Clamp against the count so a sample longer than the count (impossible from
  // the query, but cheap to not depend on) can never render "and -1 more".
  const named = group.sample.slice(0, Math.min(3, n));
  const rest = Math.max(0, n - named.length);

  return {
    title: n === 1 ? "1 lead has gone quiet" : `${n} leads have gone quiet`,
    body:
      (named.length > 0 ? `${named.join(", ")}${rest > 0 ? ` and ${rest} more` : ""} — ` : "") +
      `no reply in ${hoursWithoutReply}+ hours.`,
    link: "/today",
  };
}
