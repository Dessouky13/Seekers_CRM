import { describe, it, expect } from "vitest";
import {
  dailyCapFor, releaseCount, spreadGapSeconds, slotsRemainingToday,
  nextStageAfterSpamReject, nextSpreadSlot,
  effectiveDailyCap, releaseCountNow, isWithinSendWindow,
  MIN_GAP_SECONDS, MAX_GAP_SECONDS,
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

describe("releaseCount", () => {
  it("spreads the remaining allowance across the remaining slots", () => {
    expect(releaseCount({ capRemaining: 20, slotsRemaining: 4 })).toBe(5);
  });

  it("releases everything in the final slot", () => {
    expect(releaseCount({ capRemaining: 7, slotsRemaining: 1 })).toBe(7);
  });

  it("rounds down so the cap is never exceeded", () => {
    expect(releaseCount({ capRemaining: 7, slotsRemaining: 4 })).toBe(1);
  });

  it("still releases one when the allowance is thinner than the slots", () => {
    // Rounding down to 0 would stall sending entirely for the rest of the day.
    expect(releaseCount({ capRemaining: 2, slotsRemaining: 8 })).toBe(1);
  });

  it("releases nothing once the cap is used up", () => {
    expect(releaseCount({ capRemaining: 0, slotsRemaining: 5 })).toBe(0);
    expect(releaseCount({ capRemaining: -3, slotsRemaining: 5 })).toBe(0);
  });

  it("releases nothing when there are no slots left", () => {
    expect(releaseCount({ capRemaining: 10, slotsRemaining: 0 })).toBe(0);
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

  it("releases a normal in-window allowance spread across the remaining slots", () => {
    // active cap 40, 8 slots, nothing sent yet -> floor(40/8) = 5. This is the
    // exact "5 released at once" scenario the per-message spread delay exists
    // to space out — the count itself is correct; outreach.ts is responsible
    // for not firing all 5 back-to-back.
    expect(releaseCountNow({
      stage: "active", storedCap: 0, cleanWeeks: 0, sentToday: 0, now: insideWindow,
    })).toBe(5);
  });

  it("honours a stored cap override in the release decision, not just the stage default", () => {
    // stored cap 8 (not the active default of 40), 8 slots, nothing sent ->
    // floor(8/8) = 1. Proves storedCap wins over dailyCapFor("active", ...).
    expect(releaseCountNow({
      stage: "active", storedCap: 8, cleanWeeks: 0, sentToday: 0, now: insideWindow,
    })).toBe(1);
  });
});
