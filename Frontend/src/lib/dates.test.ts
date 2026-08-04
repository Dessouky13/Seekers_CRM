import { describe, it, expect } from "vitest";
import { cairoDate, cairoToday, addCalendarDays, CAIRO_TZ } from "./dates";

// Regression guard: every case below is one where `toISOString().slice(0, 10)`
// — the implementation this replaced — gives a different, wrong answer. If
// anyone reverts cairoToday() to UTC, these fail instead of drifting quietly.

describe("cairoToday — the UTC regression guard", () => {
  it("returns the Cairo day just after local midnight in winter (UTC+2)", () => {
    const instant = new Date("2026-01-14T22:30:00Z"); // 00:30 Cairo on the 15th
    expect(instant.toISOString().slice(0, 10)).toBe("2026-01-14"); // what the bug did
    expect(cairoToday(instant)).toBe("2026-01-15");
  });

  it("returns the Cairo day just after local midnight on DST (UTC+3)", () => {
    const instant = new Date("2026-07-14T21:30:00Z"); // 00:30 Cairo on the 15th
    expect(instant.toISOString().slice(0, 10)).toBe("2026-07-14");
    expect(cairoToday(instant)).toBe("2026-07-15");
  });

  it("does not misfile a QuickAdd expense into the previous month", () => {
    // 00:00 Cairo on 1 August. The UTC day is still 31 July, which put the
    // expense in the wrong P&L period.
    const instant = new Date("2026-07-31T22:00:00Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-07-31");
    expect(cairoToday(instant)).toBe("2026-08-01");
  });

  it("agrees with UTC during the rest of the day", () => {
    const instant = new Date("2026-05-20T09:00:00Z");
    expect(cairoToday(instant)).toBe("2026-05-20");
  });

  it("emits strict YYYY-MM-DD, which is what <input type=\"date\"> requires", () => {
    expect(cairoToday(new Date("2026-03-05T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is genuinely timezone-driven, not a coincidence of the host clock", () => {
    const instant = new Date("2026-07-14T21:30:00Z");
    expect(cairoDate(instant, "UTC")).toBe("2026-07-14");
    expect(cairoDate(instant, CAIRO_TZ)).toBe("2026-07-15");
    expect(cairoDate(instant, "America/Los_Angeles")).toBe("2026-07-14");
  });
});

describe("addCalendarDays", () => {
  it("shifts by whole days", () => {
    expect(addCalendarDays("2026-08-04", 1)).toBe("2026-08-05");
    expect(addCalendarDays("2026-08-04", 7)).toBe("2026-08-11");
    expect(addCalendarDays("2026-08-04", 0)).toBe("2026-08-04");
  });

  it("crosses month and year ends", () => {
    // What Today's "next week" button does on the 30th.
    expect(addCalendarDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addCalendarDays("2026-12-29", 7)).toBe("2027-01-05");
  });

  it("handles a leap day", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2028-02-28", 2)).toBe("2028-03-01");
  });

  it("goes backwards too", () => {
    expect(addCalendarDays("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("is not shifted by the host timezone", () => {
    // The whole point of anchoring at UTC midnight: this must hold whether the
    // machine running it is in Cairo, UTC or Los Angeles.
    expect(addCalendarDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addCalendarDays("2026-10-30", 1)).toBe("2026-10-31");
  });
});
