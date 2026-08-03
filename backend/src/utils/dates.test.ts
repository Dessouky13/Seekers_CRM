import { describe, it, expect } from "vitest";
import { cairoDate, cairoToday, cairoMonth, cairoDaysAgo, CAIRO_TZ } from "./dates";

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
