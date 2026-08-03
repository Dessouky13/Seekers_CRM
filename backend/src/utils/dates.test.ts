import { describe, it, expect } from "vitest";
import {
  cairoDate, cairoToday, cairoMonth, cairoDaysAgo, CAIRO_TZ,
  addCalendarDays, addCalendarMonths,
} from "./dates";

// These tests are the regression guard for the "three date conventions" bug.
//
// Every assertion below is chosen so that `toISOString().slice(0, 10)` — the
// implementation this module replaced — produces a DIFFERENT answer. If anyone
// reverts cairoToday() to UTC, these fail rather than drifting quietly.

describe("cairoToday — the UTC regression guard", () => {
  it("returns the Cairo day, not the UTC day, just after local midnight in winter (UTC+2)", () => {
    // 2026-01-14T22:30:00Z is 2026-01-15 00:30 in Cairo. UTC still says the 14th.
    const instant = new Date("2026-01-14T22:30:00Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-01-14"); // what the bug did
    expect(cairoToday(instant)).toBe("2026-01-15");                // what Cairo means
  });

  it("returns the Cairo day, not the UTC day, just after local midnight on DST (UTC+3)", () => {
    // 2026-07-14T21:30:00Z is 2026-07-15 00:30 in Cairo (DST). UTC still says the 14th.
    const instant = new Date("2026-07-14T21:30:00Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-07-14");
    expect(cairoToday(instant)).toBe("2026-07-15");
  });

  it("rolls the MONTH forward at Cairo midnight — the QuickAdd expense-misfiling case", () => {
    // 2026-07-31T22:00:00Z is 2026-08-01 00:00 Cairo. Under UTC this expense would
    // have been filed into July's P&L, across a reporting boundary.
    const instant = new Date("2026-07-31T22:00:00Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-07-31");
    expect(cairoToday(instant)).toBe("2026-08-01");
    expect(cairoMonth(instant)).toBe("2026-08");
  });

  it("rolls the YEAR forward at Cairo midnight", () => {
    const instant = new Date("2026-12-31T22:15:00Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(cairoToday(instant)).toBe("2027-01-01");
  });

  it("agrees with UTC during the rest of the day, so nothing else shifts", () => {
    const instant = new Date("2026-05-20T09:00:00Z"); // 12:00 Cairo
    expect(cairoToday(instant)).toBe("2026-05-20");
    expect(cairoToday(instant)).toBe(instant.toISOString().slice(0, 10));
  });

  it("emits strict YYYY-MM-DD, never a locale-flavoured string", () => {
    expect(cairoToday(new Date("2026-03-05T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is genuinely timezone-driven, not a coincidence of the host clock", () => {
    // Same instant, three zones, three different calendar days.
    const instant = new Date("2026-07-14T21:30:00Z");
    expect(cairoDate(instant, "UTC")).toBe("2026-07-14");
    expect(cairoDate(instant, CAIRO_TZ)).toBe("2026-07-15");
    expect(cairoDate(instant, "Pacific/Kiritimati")).toBe("2026-07-15");
    expect(cairoDate(instant, "America/Los_Angeles")).toBe("2026-07-14");
  });
});

describe("cairoDaysAgo", () => {
  it("counts back in Cairo days, not UTC days", () => {
    // 00:30 Cairo on the 15th; 7 days back is the 8th in Cairo but the 7th in UTC.
    const instant = new Date("2026-07-14T21:30:00Z");
    expect(cairoDaysAgo(7, instant)).toBe("2026-07-08");
    expect(new Date(instant.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)).toBe("2026-07-07");
  });

  it("returns today for 0", () => {
    const instant = new Date("2026-07-14T21:30:00Z");
    expect(cairoDaysAgo(0, instant)).toBe(cairoToday(instant));
  });

  it("crosses a month boundary backwards", () => {
    expect(cairoDaysAgo(14, new Date("2026-08-04T09:00:00Z"))).toBe("2026-07-21");
  });
});

// ── Calendar arithmetic (invoice due dates, retainer months) ──────────
// These shift a day the caller has ALREADY decided, so unlike cairoToday()
// they must be immune to the host timezone rather than driven by Cairo's.

describe("addCalendarDays", () => {
  it("adds the standard 14-day invoice term", () => {
    expect(addCalendarDays("2026-08-03", 14)).toBe("2026-08-17");
  });

  it("crosses month and year boundaries", () => {
    expect(addCalendarDays("2026-08-25", 14)).toBe("2026-09-08");
    expect(addCalendarDays("2026-12-28", 14)).toBe("2027-01-11");
  });

  it("handles leap day and zero/negative shifts", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");   // 2028 is a leap year
    expect(addCalendarDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addCalendarDays("2026-08-03", 0)).toBe("2026-08-03");
    expect(addCalendarDays("2026-08-03", -3)).toBe("2026-07-31");
  });

  it("does not shift when a DST change falls inside the range", () => {
    // Cairo moves its clocks in late April; a day-count must still be a day count.
    expect(addCalendarDays("2026-04-20", 14)).toBe("2026-05-04");
  });
});

describe("addCalendarMonths", () => {
  it("keeps the same day of month for a retainer series", () => {
    expect(addCalendarMonths("2026-08-03", 1)).toBe("2026-09-03");
    expect(addCalendarMonths("2026-08-03", 6)).toBe("2027-02-03");
  });

  it("clamps to the end of a short month instead of overflowing", () => {
    // The bug this guards: naive arithmetic turns 31 Jan + 1 month into
    // 3 March, which skips February's invoice entirely.
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addCalendarMonths("2028-01-31", 1)).toBe("2028-02-29");   // leap year
    expect(addCalendarMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(addCalendarMonths("2026-05-31", 1)).toBe("2026-06-30");
  });

  it("does not compound the clamp — each step is measured from the anchor", () => {
    expect(addCalendarMonths("2026-01-31", 2)).toBe("2026-03-31");
  });

  it("crosses the year boundary", () => {
    expect(addCalendarMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addCalendarMonths("2026-12-31", 1)).toBe("2027-01-31");
  });
});
