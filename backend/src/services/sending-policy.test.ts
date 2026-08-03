import { describe, it, expect, afterEach } from "vitest";
import {
  dailyCapFor, releaseBudget, windowProgress, spreadGapSeconds, slotsRemainingToday,
  nextStageAfterSpamReject, nextSpreadSlot,
  effectiveDailyCap, releaseCountNow, isWithinSendWindow,
  sweepIntervalMinutes, configuredSenderAddress,
  MIN_GAP_SECONDS, MAX_GAP_SECONDS, ACTIVE_CEILING,
  SEND_WINDOW_START_HOUR, SEND_WINDOW_END_HOUR,
} from "./sending-policy";

describe("dailyCapFor", () => {
  it("starts at 5 a day in recovery", () => {
    // The domain is already burned by 871 sends, so recovery is the START state,
    // not a punishment reached later.
    expect(dailyCapFor("recovery", 0)).toBe(5);
    expect(dailyCapFor("recovery", 8)).toBe(5);
  });

  it("ramps warmup by 5 per clean week from a base of 10", () => {
    expect(dailyCapFor("warmup", 0)).toBe(10);
    expect(dailyCapFor("warmup", 1)).toBe(15);
    expect(dailyCapFor("warmup", 2)).toBe(20);
  });

  it("never lets warmup exceed the active ceiling", () => {
    expect(dailyCapFor("warmup", 100)).toBe(40);
  });

  it("caps active sending at 40 a day", () => {
    expect(dailyCapFor("active", 0)).toBe(40);
    expect(dailyCapFor("active", 50)).toBe(40);
  });
});

describe("releaseBudget", () => {
  it("releases pro-rata against how far through the window we are", () => {
    // Half way through the window, at most half the cap may have gone out.
    expect(releaseBudget({ cap: 40, sentToday: 0, progress: 0.5 })).toBe(20);
    expect(releaseBudget({ cap: 40, sentToday: 15, progress: 0.5 })).toBe(5);
  });

  it("releases nothing when the pro-rata target is already met", () => {
    expect(releaseBudget({ cap: 40, sentToday: 20, progress: 0.5 })).toBe(0);
    // Ahead of schedule (e.g. after a catch-up flush) must not go negative.
    expect(releaseBudget({ cap: 40, sentToday: 30, progress: 0.5 })).toBe(0);
  });

  it("flushes the whole remaining allowance at the end of the window", () => {
    // progress 1 is what the last tick inside the window sees, and it is what
    // guarantees a thin allowance is never left unsent — the property the old
    // never-floor-to-zero hack was trying (and failing) to protect.
    expect(releaseBudget({ cap: 5, sentToday: 1, progress: 1 })).toBe(4);
  });

  it("never exceeds the cap however high the progress or low the sent count", () => {
    expect(releaseBudget({ cap: 5, sentToday: 0, progress: 9 })).toBe(5);
  });

  it("releases nothing when there is no cap", () => {
    expect(releaseBudget({ cap: 0, sentToday: 0, progress: 1 })).toBe(0);
    expect(releaseBudget({ cap: -3, sentToday: 0, progress: 1 })).toBe(0);
  });
});

describe("windowProgress", () => {
  // Cairo is UTC+3 in August 2026 (Egypt DST) — the convention every fixture
  // in this file uses.
  const cairo = (h: number, m = 0) =>
    new Date(Date.UTC(2026, 7, 3, h - 3, m, 0));

  it("is zero outside the window", () => {
    expect(windowProgress(cairo(6), 5)).toBe(0);
    expect(windowProgress(cairo(18), 5)).toBe(0);
  });

  it("is one sweep's worth at the moment the window opens", () => {
    // Deliberately NOT 0: measuring to `now` would make the first tick of every
    // day release nothing at all.
    expect(windowProgress(cairo(9), 5)).toBeCloseTo(5 / 480, 6);
  });

  it("reaches exactly 1 on the last tick inside the window", () => {
    // 16:55 with a 5-minute sweep is the final tick — it must see a full window
    // so it flushes the remaining allowance instead of stranding it.
    expect(windowProgress(cairo(16, 55), 5)).toBe(1);
  });

  it("tracks the middle of the window", () => {
    expect(windowProgress(cairo(13), 5)).toBeCloseTo(245 / 480, 6);
  });
});

describe("spreadGapSeconds", () => {
  it("stays inside the configured bounds", () => {
    expect(spreadGapSeconds(() => 0)).toBe(MIN_GAP_SECONDS);
    expect(spreadGapSeconds(() => 0.999)).toBeLessThanOrEqual(MAX_GAP_SECONDS);
    expect(spreadGapSeconds(() => 0.5)).toBeGreaterThan(MIN_GAP_SECONDS);
  });
});

describe("nextSpreadSlot", () => {
  it("adds the gap to the given instant", () => {
    const from = new Date("2026-08-03T09:00:00Z");
    expect(nextSpreadSlot(from, 120).getTime() - from.getTime()).toBe(120_000);
  });
});

describe("slotsRemainingToday", () => {
  it("counts whole hours left in the Cairo send window", () => {
    // 09:00 Cairo = 06:00 UTC in summer (UTC+3).
    const nineCairo = new Date("2026-08-03T06:00:00Z");
    expect(slotsRemainingToday(nineCairo)).toBe(SEND_WINDOW_END_HOUR - SEND_WINDOW_START_HOUR);
  });

  it("returns 0 before the window opens", () => {
    const sixCairo = new Date("2026-08-03T03:00:00Z");
    expect(slotsRemainingToday(sixCairo)).toBe(0);
  });

  it("returns 0 after the window closes", () => {
    const eighteenCairo = new Date("2026-08-03T15:00:00Z");
    expect(slotsRemainingToday(eighteenCairo)).toBe(0);
  });
});

describe("isWithinSendWindow", () => {
  // Cairo is UTC+3 in August 2026 (Egypt DST) — same convention as
  // slotsRemainingToday's fixtures above.
  it("is true in the middle of the window", () => {
    const noonCairo = new Date("2026-08-03T09:00:00Z"); // 12:00 Cairo
    expect(isWithinSendWindow(noonCairo)).toBe(true);
  });

  it("is false before the window opens", () => {
    const sixCairo = new Date("2026-08-03T03:00:00Z"); // 06:00 Cairo
    expect(isWithinSendWindow(sixCairo)).toBe(false);
  });

  it("is true exactly at the 09:00 open boundary", () => {
    const nineCairo = new Date("2026-08-03T06:00:00Z"); // 09:00 Cairo
    expect(isWithinSendWindow(nineCairo)).toBe(true);
  });

  it("is false exactly at the 17:00 close boundary", () => {
    // The close boundary is exclusive: a batch still running AT 17:00 must
    // stop, not squeeze in one more send because the hour number still
    // matches. This boundary was never asserted before this test.
    const seventeenCairo = new Date("2026-08-03T14:00:00Z"); // 17:00 Cairo
    expect(isWithinSendWindow(seventeenCairo)).toBe(false);
  });

  it("is false after the window closes", () => {
    const eighteenCairo = new Date("2026-08-03T15:00:00Z"); // 18:00 Cairo
    expect(isWithinSendWindow(eighteenCairo)).toBe(false);
  });
});

describe("nextStageAfterSpamReject", () => {
  it("drops straight to recovery", () => {
    expect(nextStageAfterSpamReject()).toBe("recovery");
  });
});

describe("effectiveDailyCap", () => {
  it("a positive stored cap overrides the stage default", () => {
    expect(effectiveDailyCap("recovery", 12, 0)).toBe(12);
    expect(effectiveDailyCap("active", 3, 0)).toBe(3);
  });

  it("a stored cap of 0 falls back to the stage (warmup-ramp) default", () => {
    expect(effectiveDailyCap("recovery", 0, 0)).toBe(5);
    expect(effectiveDailyCap("warmup", 0, 2)).toBe(20);
  });

  it("clamps a stored override to the active ceiling", () => {
    // mailboxes.daily_cap is writable over the network by POST /mailboxes/health,
    // whose Zod schema accepts any non-negative integer. Unclamped, one stray
    // value in an n8n payload silently replaced the whole warmup ramp — a domain
    // already carrying 30 provider spam rejections could be put back to thousands
    // of sends a day by a config typo. An override may only ever LOWER the cap.
    expect(effectiveDailyCap("recovery", 5000, 0)).toBe(40);
    expect(effectiveDailyCap("active", 5000, 0)).toBe(40);
    expect(ACTIVE_CEILING).toBe(40);
  });

  it("still lets an override lower the cap below the stage default", () => {
    expect(effectiveDailyCap("active", 12, 0)).toBe(12);
  });
});

describe("configuredSenderAddress", () => {
  const original = process.env.EMAIL_FROM;
  afterEach(() => {
    if (original === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = original;
  });

  it("canonicalises the mixed-case address production actually uses", () => {
    // This exact value is what ships in backend/.env. Seeded verbatim it created
    // a second mailboxes row the moment n8n posted the lowercased form, and the
    // enforced daily cap then came from whichever row a LIMIT 1 returned.
    process.env.EMAIL_FROM = "Team@seekersai.org";
    expect(configuredSenderAddress()).toBe("team@seekersai.org");
  });

  it("trims surrounding whitespace", () => {
    process.env.EMAIL_FROM = "  Team@Seekersai.ORG \n";
    expect(configuredSenderAddress()).toBe("team@seekersai.org");
  });

  it("falls back to the default sender when unset or blank", () => {
    delete process.env.EMAIL_FROM;
    expect(configuredSenderAddress()).toBe("team@seekersai.org");
    process.env.EMAIL_FROM = "   ";
    expect(configuredSenderAddress()).toBe("team@seekersai.org");
  });
});

describe("sweepIntervalMinutes", () => {
  const original = process.env.OUTREACH_SWEEP_MINUTES;
  afterEach(() => {
    if (original === undefined) delete process.env.OUTREACH_SWEEP_MINUTES;
    else process.env.OUTREACH_SWEEP_MINUTES = original;
  });

  it("defaults to 5 minutes", () => {
    delete process.env.OUTREACH_SWEEP_MINUTES;
    expect(sweepIntervalMinutes()).toBe(5);
  });

  it("rejects junk and non-positive values rather than dividing by them", () => {
    process.env.OUTREACH_SWEEP_MINUTES = "0";
    expect(sweepIntervalMinutes()).toBe(5);
    process.env.OUTREACH_SWEEP_MINUTES = "banana";
    expect(sweepIntervalMinutes()).toBe(5);
  });

  it("honours a configured interval", () => {
    process.env.OUTREACH_SWEEP_MINUTES = "15";
    expect(sweepIntervalMinutes()).toBe(15);
  });
});

describe("releaseCountNow", () => {
  // Same fixtures as slotsRemainingToday's own tests: Cairo is UTC+3 in
  // August 2026 (Egypt DST).
  const insideWindow  = new Date("2026-08-03T06:00:00Z"); // 09:00 Cairo — window just opened, 8 slots left
  const outsideWindow = new Date("2026-08-03T03:00:00Z"); // 06:00 Cairo — before the window opens

  it("returns 0 outside the send window regardless of cap or sentToday", () => {
    expect(releaseCountNow({
      stage: "active", storedCap: 0, cleanWeeks: 0, sentToday: 0, now: outsideWindow,
    })).toBe(0);
  });

  it("returns 0 once today's cap is already used up", () => {
    expect(releaseCountNow({
      stage: "recovery", storedCap: 0, cleanWeeks: 0, sentToday: 5, now: insideWindow,
    })).toBe(0);
  });

  it("releases only this tick's share at the top of the window, not the hour's", () => {
    // This assertion used to read `.toBe(5)`, which was the bug written down as
    // a test: hour-granular slots meant the first tick of the day was handed
    // floor(40/8) = 5 sends, and because the same arithmetic ran again five
    // minutes later the whole cap drained in the morning. One tick's pro-rata
    // share of 40 across an 8-hour window with a 5-minute sweep is 1.
    expect(releaseCountNow({
      stage: "active", storedCap: 0, cleanWeeks: 0, sentToday: 0, now: insideWindow,
      sweepMinutes: 5,
    })).toBe(1);
  });

  it("honours a stored cap override in the release decision, not just the stage default", () => {
    // stored cap 8 (not the active default of 40). Proves storedCap wins over
    // dailyCapFor("active", ...) — one send at the top of the window, not five.
    expect(releaseCountNow({
      stage: "active", storedCap: 8, cleanWeeks: 0, sentToday: 0, now: insideWindow,
      sweepMinutes: 5,
    })).toBe(1);
  });

  it("clamps a remotely-set cap override before releasing anything", () => {
    // A 5000 override must not turn into a 5000-a-day release schedule.
    let sent = 0;
    for (const m of ticksAcross(5)) {
      sent += releaseCountNow({
        stage: "recovery", storedCap: 5000, cleanWeeks: 0,
        sentToday: sent, now: cairoAt(m), sweepMinutes: 5,
      });
    }
    expect(sent).toBe(ACTIVE_CEILING);
  });
});

// ── The spread the design promises actually happening ─────
//
// 09:00 Cairo on Monday 2026-08-03, in UTC (Cairo is UTC+3 under Egypt DST).
const cairoAt = (minutesAfterOpen: number) =>
  new Date(Date.UTC(2026, 7, 3, SEND_WINDOW_START_HOUR - 3, minutesAfterOpen, 0));

const WINDOW_MINUTES = (SEND_WINDOW_END_HOUR - SEND_WINDOW_START_HOUR) * 60;

/** Every sweep instant inside one day's window, as minutes after open. */
function ticksAcross(sweepMinutes: number): number[] {
  const out: number[] = [];
  for (let m = 0; m < WINDOW_MINUTES; m += sweepMinutes) out.push(m);
  return out;
}

/** Replay a whole day of sweeps, returning the minute of each release. */
function simulateDay(opts: {
  stage: "recovery" | "warmup" | "active";
  storedCap?: number;
  sweepMinutes: number;
}): { total: number; atMinutes: number[] } {
  let sent = 0;
  const atMinutes: number[] = [];
  for (const m of ticksAcross(opts.sweepMinutes)) {
    const n = releaseCountNow({
      stage:        opts.stage,
      storedCap:    opts.storedCap ?? 0,
      cleanWeeks:   0,
      sentToday:    sent,
      now:          cairoAt(m),
      sweepMinutes: opts.sweepMinutes,
    });
    for (let i = 0; i < n; i++) atMinutes.push(m);
    sent += n;
  }
  return { total: sent, atMinutes };
}

describe("release schedule across a whole day", () => {
  it("spreads the recovery cap across the window instead of dumping it into the first half hour", () => {
    // THE regression this replaces. slotsRemainingToday counts whole HOURS, but
    // the sweep runs every 5 minutes, so the old
    // `max(1, floor(capRemaining / slotsRemaining))` was consulted ~12x per
    // "slot" and handed out one send on every tick until the day was spent:
    // max(1, floor(5/8)) = 1, five times over, so all five left between 09:00
    // and 09:25. The window and the 90-240s gap were both decorative.
    const { total, atMinutes } = simulateDay({ stage: "recovery", sweepMinutes: 5 });

    expect(total).toBe(5);                                  // the cap, exactly
    expect(atMinutes.filter((m) => m < 30)).toHaveLength(1); // not 5
    // Spread over the window, not clustered: the last release is in the
    // afternoon and consecutive releases are hours apart.
    expect(atMinutes[atMinutes.length - 1]).toBeGreaterThan(WINDOW_MINUTES / 2);
    const distinctHours = new Set(atMinutes.map((m) => Math.floor(m / 60)));
    expect(distinctHours.size).toBe(5);
  });

  it("releases the full allowance and never more, at every stage", () => {
    // The anti-stall guarantee, restated: pro-rata releases 0 on most ticks, so
    // it must still be provable that nothing is left unsent at close.
    expect(simulateDay({ stage: "recovery", sweepMinutes: 5 }).total).toBe(5);
    expect(simulateDay({ stage: "warmup",   sweepMinutes: 5 }).total).toBe(10);
    expect(simulateDay({ stage: "active",   sweepMinutes: 5 }).total).toBe(40);
  });

  it("still spends the whole allowance on a coarse sweep interval", () => {
    // Why the budget is measured to the END of the current tick: at a 60-minute
    // sweep, measuring to `now` would leave an hour's worth of allowance unsent
    // every single day, because the 17:00 tick is already outside the window.
    expect(simulateDay({ stage: "active", sweepMinutes: 60 }).total).toBe(40);
    expect(simulateDay({ stage: "recovery", sweepMinutes: 60 }).total).toBe(5);
  });

  it("keeps the daily cap even when the scheduler starts late in the day", () => {
    // Catching up must not exceed the cap: a first tick at 16:00 may flush the
    // whole allowance, but not a send more.
    let sent = 0;
    for (let m = 420; m < WINDOW_MINUTES; m += 5) {
      sent += releaseCountNow({
        stage: "active", storedCap: 0, cleanWeeks: 0,
        sentToday: sent, now: cairoAt(m), sweepMinutes: 5,
      });
    }
    expect(sent).toBe(40);
  });
});
