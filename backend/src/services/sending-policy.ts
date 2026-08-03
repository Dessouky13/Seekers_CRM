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
/**
 * The hard ceiling on sends per mailbox per day. Exported because it is not
 * merely the `active`-stage default — it is the maximum this policy will ever
 * allow from ANY source, including a stored override (see effectiveDailyCap).
 */
export const ACTIVE_CEILING = 40;

const CAIRO_TZ = "Africa/Cairo";

/**
 * How often the scheduler sweep actually runs, in minutes.
 *
 * Read here rather than in the scheduler because the sweep interval is
 * load-bearing for the release budget: `releaseCountNow` has to know how many
 * more times it will be called before the window shuts, or it cannot spread a
 * day's allowance across it. index.ts drives setInterval from this same
 * function so the two can never disagree — a mismatch would either bunch every
 * send into the morning or leave part of the allowance unsent.
 */
export function sweepIntervalMinutes(): number {
  const raw = Number(process.env.OUTREACH_SWEEP_MINUTES ?? 5);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

const DEFAULT_SENDER = "team@seekersai.org";

/**
 * The canonical form of the configured sender address: trimmed and lowercased.
 *
 * Lives in this DB-free module so it is unit-testable, and so the scheduler, the
 * boot seed and the deliverability panel can all key off ONE definition of
 * "which mailbox are we". They previously did not: the boot seed inserted
 * process.env.EMAIL_FROM verbatim — production is `EMAIL_FROM=Team@seekersai.org`
 * — while POST /mailboxes/health inserted the lowercased form, and the unique
 * index is on raw text. So the first health post from n8n created a SECOND row
 * for the same physical mailbox, and from then on the daily cap being enforced
 * and the daily cap being displayed could come from different rows.
 *
 * Used for LOOKUP and storage only. The SMTP envelope-from keeps whatever
 * EMAIL_FROM literally says (see services/email.ts): the local part of an
 * address is case-sensitive per RFC 5321, so it is not ours to rewrite on the
 * wire — but it is ours to canonicalise as a database key.
 */
export function configuredSenderAddress(): string {
  return (process.env.EMAIL_FROM ?? "").trim().toLowerCase() || DEFAULT_SENDER;
}

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

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * How far through today's send window we will be by the time the NEXT sweep
 * fires. 0 before the window opens, 1 from the last tick inside it onward.
 *
 * Measured to the END of the current tick, not to `now`, for two reasons:
 *   - at 09:00 exactly the elapsed fraction is 0, so a budget derived from it
 *     would release nothing and waste the first tick of every day;
 *   - the last tick inside the window must see a fraction of 1 so it flushes
 *     whatever allowance is left. Measuring to `now` instead would strand a
 *     slice of the daily allowance unsent every single day — one sweep
 *     interval's worth, which at a coarse sweep is a large slice.
 */
export function windowProgress(now: Date, sweepMinutes: number): number {
  const windowMinutes = (SEND_WINDOW_END_HOUR - SEND_WINDOW_START_HOUR) * 60;
  const elapsed       = cairoMinutesSinceWindowOpen(now);
  if (elapsed == null) return 0;
  return clamp01((elapsed + Math.max(1, sweepMinutes)) / windowMinutes);
}

/**
 * How many sends may be released now, given how far through the window we are.
 *
 * Pro-rata against elapsed TIME, not "allowance divided by remaining slots".
 *
 * The previous formula was `max(1, floor(capRemaining / slotsRemaining))` with
 * slots counted in whole HOURS, while the sweep runs every 5 minutes — so it
 * was consulted ~12x per "slot" and the `max(1, ...)` floor meant it handed out
 * one send on every single tick until the day's allowance was gone. At the
 * recovery cap that emptied the entire day into the first 25 minutes: the exact
 * bulk-shaped burst the window exists to prevent, and it also meant the
 * batch-internal 90-240s spread never ran, because each release was a batch of
 * one.
 *
 * Expressing the budget as a cumulative target ("by 40% through the window, at
 * most 40% of the cap should have gone out") fixes both: releases land across
 * the whole window, and the allowance is still guaranteed to be fully
 * releasable, because the target reaches `cap` exactly when the window ends.
 * That guarantee replaces the old never-floor-to-zero hack — releasing 0 on a
 * given tick is now correct and expected, and cannot stall the day.
 */
export function releaseBudget(input: {
  cap: number;
  sentToday: number;
  /** 0..1, from windowProgress. */
  progress: number;
}): number {
  const { cap, sentToday } = input;
  if (cap <= 0) return 0;
  const target = Math.ceil(cap * clamp01(input.progress));
  return Math.max(0, Math.min(cap, target) - Math.max(0, sentToday));
}

/** Randomised gap, so sends do not land on a detectable fixed rhythm. */
export function spreadGapSeconds(rand: () => number = Math.random): number {
  return Math.round(MIN_GAP_SECONDS + rand() * (MAX_GAP_SECONDS - MIN_GAP_SECONDS));
}

export function nextSpreadSlot(from: Date, gapSeconds: number): Date {
  return new Date(from.getTime() + gapSeconds * 1000);
}

/** Cairo-local hour (0-23) for `now`. Factored out so the timezone arithmetic
 *  exists in exactly one place — slotsRemainingToday, isWithinSendWindow and
 *  windowProgress all need "what time is it in Cairo right now" and must never
 *  drift apart on how they compute it. */
function cairoHourOf(now: Date): number {
  return cairoClock(now).hour;
}

function cairoClock(now: Date): { hour: number; minute: number } {
  const parts = now.toLocaleString("en-US", {
    timeZone: CAIRO_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  });
  // "HH:MM" — en-US with hour12:false renders midnight as "24:00" in some ICU
  // versions, so fold 24 back to 0 rather than trusting the range.
  const [h, m] = parts.split(":").map(Number);
  return { hour: (h ?? 0) % 24, minute: m ?? 0 };
}

/**
 * Minutes since the Cairo send window opened, or null when outside it.
 * The minute-level resolution windowProgress needs; the window is 8 hours long
 * and the sweep runs every few minutes, so whole hours are far too coarse to
 * shape a release schedule from.
 */
function cairoMinutesSinceWindowOpen(now: Date): number | null {
  const { hour, minute } = cairoClock(now);
  if (hour < SEND_WINDOW_START_HOUR) return null;
  if (hour >= SEND_WINDOW_END_HOUR)  return null;
  return (hour - SEND_WINDOW_START_HOUR) * 60 + minute;
}

/**
 * Whole hours left in today's Cairo send window. 0 outside it.
 *
 * DISPLAY ONLY (the deliverability panel's `slots_left`). The release decision
 * deliberately no longer uses this: hour granularity against a five-minute
 * sweep is what let a whole day's allowance leave in the first half hour. See
 * releaseBudget / windowProgress for the arithmetic that actually governs
 * sending.
 */
export function slotsRemainingToday(now: Date): number {
  const hour = cairoHourOf(now);
  if (hour < SEND_WINDOW_START_HOUR) return 0;
  if (hour >= SEND_WINDOW_END_HOUR)  return 0;
  return SEND_WINDOW_END_HOUR - hour;
}

/**
 * Is `now` inside the Cairo send window? The window is the hard stop on a
 * batch that takes hours: the cap decides how much may go, this decides
 * whether it still may.
 *
 * Still needed even now that releaseBudget spreads releases across the window
 * rather than dumping the remainder into the final slot: the last tick inside
 * the window flushes whatever allowance is left, and the scheduler's
 * per-message spread delay (90-240s) can stretch that flush past 17:00. The
 * release decision made at the top of a tick is therefore not enough — the
 * scheduler must re-check this on every iteration of a batch.
 */
export function isWithinSendWindow(now: Date): boolean {
  const hour = cairoHourOf(now);
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;
}

/**
 * A spam rejection means the provider is actively refusing us. Continuing at the
 * same rate makes it worse, so drop to the floor immediately and let the ramp
 * earn the volume back.
 */
export function nextStageAfterSpamReject(): WarmupStage {
  return "recovery";
}

/**
 * The daily cap actually in force. An explicit stored override (> 0) wins over
 * the stage default; 0 (or missing) means "not configured — fall back to the
 * stage/warmup-ramp default."
 *
 * The override is CLAMPED to ACTIVE_CEILING, and that clamp is the point.
 * mailboxes.daily_cap is writable over the network by POST /mailboxes/health,
 * which n8n calls on a schedule with an api key; its Zod schema accepts any
 * non-negative integer. Unclamped, one stray `daily_cap` in that payload
 * silently replaced the entire warmup ramp with an arbitrary number — a
 * mailbox already carrying 30 provider spam rejections could be put back to
 * thousands of sends a day by a config typo, with nothing in the product
 * showing that the ramp had been bypassed. An override may only ever LOWER the
 * ceiling, never raise it.
 */
export function effectiveDailyCap(stage: WarmupStage, storedCap: number, cleanWeeks: number): number {
  if (storedCap > 0) return Math.min(storedCap, ACTIVE_CEILING);
  return dailyCapFor(stage, cleanWeeks);
}

/**
 * The single release decision the scheduler tick needs on every call: how many
 * sends may go out right now. Zero whenever the Cairo window is closed OR
 * today's pro-rata budget is already spent — and folding all of it into one
 * pure function means every branch is unit-testable without a DB.
 */
export function releaseCountNow(input: {
  stage:      WarmupStage;
  storedCap:  number;
  cleanWeeks: number;
  sentToday:  number;
  now:        Date;
  /** Defaults to the configured sweep interval; injectable for tests. */
  sweepMinutes?: number;
}): number {
  if (!isWithinSendWindow(input.now)) return 0;
  const cap = effectiveDailyCap(input.stage, input.storedCap, input.cleanWeeks);
  return releaseBudget({
    cap,
    sentToday: input.sentToday,
    progress:  windowProgress(input.now, input.sweepMinutes ?? sweepIntervalMinutes()),
  });
}
