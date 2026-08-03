import { describe, it, expect } from "vitest";
import { cairoDate, cairoToday, CAIRO_TZ } from "./dates";

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
