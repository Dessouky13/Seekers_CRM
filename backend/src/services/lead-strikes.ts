// Manual contact strikes — the pure decisions.
//
// A "strike" is one hand-made attempt to reach a lead: a WhatsApp message, a
// call, a chase email. Three of them without a result is the point at which the
// team stops spending time on that lead, and this file owns what that means:
//
//   strikeActivity()      — the timeline entry a strike becomes, including which
//                           `lead_activities.type` it may legitimately claim.
//   strikeLimitEffects()  — whether the limit has been reached and, if so, what
//                           to write to the lead.
//
// Pure (no DB, no clock) because the enforcement point — POST
// /crm/leads/:id/strikes in routes/crm.ts — hits the database and cannot be unit
// tested here. Extracting the decisions is what makes them testable; see
// lead-strikes.test.ts. Same reasoning, and same shape, as manual-touch.ts.

/**
 * Three strikes. Not configurable: the whole feature is "three attempts then a
 * decision", the dot indicator draws exactly three positions, and a settable
 * limit would need the UI to be data-driven for no benefit anybody asked for.
 */
export const STRIKE_LIMIT = 3;

/** How the human made contact. Mirrors `lead_strikes.channel`. */
export type StrikeChannel = "whatsapp" | "call" | "email" | "meeting" | "other";

/** What to do with a lead that has taken its third strike. */
export type StrikeLimitAction = "close_lost" | "archive";

/**
 * The safer of the two options, and the default in the database.
 *
 * `close_lost` moves the lead to the pipeline stage that already means "this is
 * over" — it stays visible, searchable, reportable and reversible with a single
 * stage change, and every active-work surface (Today's queue, stale leads) already
 * excludes closed stages, so the lead genuinely stops costing anyone attention.
 * `archive` additionally hides the lead from the leads list, which is a real loss
 * of visibility, so it has to be chosen deliberately in Settings rather than
 * arriving as a default nobody picked.
 */
export const DEFAULT_STRIKE_LIMIT_ACTION: StrikeLimitAction = "close_lost";

/**
 * Coerce whatever is in `company_settings.strike_limit_action` to a known action.
 *
 * The column is plain `text` (constrained by the Drizzle enum, not by a database
 * CHECK — same as every other enum in this schema), so a hand-written UPDATE or a
 * future value from a newer build can put an unrecognised string there. Falling
 * back to the SAFE action means the worst case of a bad value is "the lead was
 * closed instead of archived", never "the lead vanished".
 */
export function normalizeStrikeLimitAction(raw: unknown): StrikeLimitAction {
  return raw === "archive" ? "archive" : DEFAULT_STRIKE_LIMIT_ACTION;
}

/**
 * The `lead_activities.type` a strike on this channel may claim.
 *
 * Deliberately conservative, for the reason spelled out in manual-touch.ts: the
 * `call` type asserts that a phone call actually happened, and `email` that a mail
 * went out. A WhatsApp message is neither, and a strike with no recorded channel
 * says nothing about how contact was attempted — both are `note`. Getting this
 * wrong would corrupt /crm/insights, which counts email/call/meeting/form rows as
 * outreach volume and would start reporting phone calls nobody made.
 */
export function strikeActivityType(
  channel: StrikeChannel | null | undefined,
): "call" | "email" | "meeting" | "note" {
  if (channel === "call")    return "call";
  if (channel === "email")   return "email";
  if (channel === "meeting") return "meeting";
  return "note";
}

/** The `lead_activities.type` values a bulk comment may carry. */
export type BulkCommentType = "email" | "call" | "meeting" | "form" | "note";

/**
 * The strike channel implied by a bulk comment's activity type.
 *
 * Bulk comment is where the team records "I contacted these five" — and until
 * this existed, doing so moved `last_activity` and wrote a timeline row but
 * left the strike dots empty, so five hand-made attempts counted as none and
 * the three-strike policy never fired for anything done in bulk.
 *
 * `form` maps to "other", not to itself: a form submission is something the
 * LEAD did, so it is not one of our contact attempts, and there is no channel
 * to claim. `note` likewise — a note records that something happened without
 * saying how. Both then resolve through strikeActivityType() to a plain
 * `note` activity, which is the conservative direction this file argues for
 * everywhere else: never assert a phone call that may not have happened.
 */
export function strikeChannelForCommentType(
  type: BulkCommentType | null | undefined,
): StrikeChannel {
  if (type === "email")   return "email";
  if (type === "call")    return "call";
  if (type === "meeting") return "meeting";
  return "other";
}

const CHANNEL_LABELS: Record<StrikeChannel, string> = {
  whatsapp: "WhatsApp",
  call:     "Call",
  email:    "Email",
  meeting:  "Meeting",
  other:    "Contact",
};

export interface StrikeActivity {
  type:        "call" | "email" | "meeting" | "note";
  description: string;
}

/**
 * The timeline entry for a strike.
 *
 * Strikes are written into `lead_activities` as well as `lead_strikes` rather
 * than being merged into the timeline at render time. Two reasons: the timeline
 * is the one place people already look for "what happened to this lead", and
 * every other automatic event in this CRM (stage moves, "Lead created",
 * "Converted to client") is recorded the same way — a strike that behaved
 * differently would be the odd one out in both the API and the UI.
 *
 * `count` is the strike's own position (1-based), so the description carries the
 * running total the reader wants: "Strike 2/3", not just "strike".
 */
export function strikeActivity(input: {
  count:    number;
  channel?: StrikeChannel | null;
  note?:    string | null;
}): StrikeActivity {
  const label  = input.channel ? CHANNEL_LABELS[input.channel] : "Contact";
  const note   = input.note?.trim();
  const suffix = note ? ` — ${note}` : "";
  return {
    type:        strikeActivityType(input.channel),
    description: `Strike ${input.count}/${STRIKE_LIMIT} · ${label} attempt${suffix}`,
  };
}

export interface StrikeLimitEffects {
  /** True once the lead has as many strikes as the limit allows. */
  reached: boolean;
  /** The action that was applied, or null when the limit is not yet reached. */
  applied: StrikeLimitAction | null;
  /** Columns to write to `leads`. Empty when nothing is to be done. */
  patch: { stage?: "closed_lost"; archivedAt?: Date };
  /** A second timeline entry explaining the automatic change, or null. */
  activity: StrikeActivity | null;
}

/**
 * What reaching the strike limit does to the lead.
 *
 * Fires on `count >= STRIKE_LIMIT` rather than `count === STRIKE_LIMIT` on
 * purpose. Reaching the limit is a STATE, not an edge: a lead that was reopened
 * (stage moved back out of closed_lost, or un-archived) and then chased again
 * would slip past an equality check for ever, sitting at four or five strikes
 * with none of them counting. Both actions are idempotent — re-closing a
 * closed lead and re-stamping an archived one are both no-ops in effect — so
 * there is no cost to re-applying.
 *
 * `now` is injected rather than read from the clock so the caller controls the
 * timestamp and this stays testable. Note it is a timestamptz (an instant),
 * NOT a calendar day: `archived_at` records when the lead was shelved, and
 * unlike `date` columns there is no Cairo-day question to get wrong.
 */
export function strikeLimitEffects(input: {
  count:  number;
  action: StrikeLimitAction;
  now:    Date;
}): StrikeLimitEffects {
  if (input.count < STRIKE_LIMIT) {
    return { reached: false, applied: null, patch: {}, activity: null };
  }

  if (input.action === "archive") {
    return {
      reached: true,
      applied: "archive",
      // Archived leads are also closed_lost. Without the stage move an archived
      // lead would still be counted as live pipeline value in
      // /crm/pipeline-summary and would still raise cards in Today's queue,
      // which both key off the stage — so "archived" would have hidden the lead
      // from the humans while leaving it in every number and every reminder.
      patch:    { stage: "closed_lost", archivedAt: input.now },
      activity: {
        type:        "note",
        description: `Archived automatically after ${STRIKE_LIMIT} contact attempts with no response`,
      },
    };
  }

  return {
    reached: true,
    applied: "close_lost",
    patch:   { stage: "closed_lost" },
    activity: {
      type:        "note",
      description: `Closed lost automatically after ${STRIKE_LIMIT} contact attempts with no response`,
    },
  };
}
