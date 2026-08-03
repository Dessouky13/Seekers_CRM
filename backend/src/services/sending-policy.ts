// How much may be sent, and when.
//
// Pure arithmetic, no DB, so the rules are testable in isolation. Existing
// behaviour put every due send in one batch at noon Cairo — which is itself a
// bulk-sender signal, and produced 30 outright rejections from the mailbox
// provider's own outbound filter.
//
// The provider is unchanged by explicit decision, so the only lever available is
// volume and shape: send less, spread it out, and back off automatically the
// moment a spam rejection appears.

export type WarmupStage = "recovery" | "warmup" | "active";

/** Cairo-local hours during which sending is allowed. */
export const SEND_WINDOW_START_HOUR = 9;
export const SEND_WINDOW_END_HOUR   = 17;

export const MIN_GAP_SECONDS = 90;
export const MAX_GAP_SECONDS = 240;

const RECOVERY_CAP   = 5;
const WARMUP_BASE    = 10;
const WARMUP_STEP    = 5;
const ACTIVE_CEILING = 40;

const CAIRO_TZ = "Africa/Cairo";

/**
 * Daily cap for a stage.
 *
 * `recovery` is the STARTING stage, not a penalty: 871 sends have already gone
 * out from this domain and 30 were rejected as spam, so the sender begins in the
 * hole rather than fresh.
 */
export function dailyCapFor(stage: WarmupStage, cleanWeeks: number): number {
  if (stage === "recovery") return RECOVERY_CAP;
  if (stage === "active")   return ACTIVE_CEILING;
  return Math.min(ACTIVE_CEILING, WARMUP_BASE + WARMUP_STEP * Math.max(0, cleanWeeks));
}

/**
 * How many to release on this tick.
 *
 * Floors, so the daily cap can never be exceeded — but never floors to zero
 * while allowance and slots both remain, or a thin allowance spread over many
 * slots would stall sending for the whole day.
 */
export function releaseCount(input: { capRemaining: number; slotsRemaining: number }): number {
  const { capRemaining, slotsRemaining } = input;
  if (capRemaining <= 0 || slotsRemaining <= 0) return 0;
  return Math.max(1, Math.floor(capRemaining / slotsRemaining));
}

/** Randomised gap, so sends do not land on a detectable fixed rhythm. */
export function spreadGapSeconds(rand: () => number = Math.random): number {
  return Math.round(MIN_GAP_SECONDS + rand() * (MAX_GAP_SECONDS - MIN_GAP_SECONDS));
}

export function nextSpreadSlot(from: Date, gapSeconds: number): Date {
  return new Date(from.getTime() + gapSeconds * 1000);
}

/** Whole hours left in today's Cairo send window. 0 outside it. */
export function slotsRemainingToday(now: Date): number {
  const hour = Number(
    now.toLocaleString("en-US", { timeZone: CAIRO_TZ, hour: "2-digit", hour12: false }),
  );
  if (hour < SEND_WINDOW_START_HOUR) return 0;
  if (hour >= SEND_WINDOW_END_HOUR)  return 0;
  return SEND_WINDOW_END_HOUR - hour;
}

/**
 * A spam rejection means the provider is actively refusing us. Continuing at the
 * same rate makes it worse, so drop to the floor immediately and let the ramp
 * earn the volume back.
 */
export function nextStageAfterSpamReject(): WarmupStage {
  return "recovery";
}
