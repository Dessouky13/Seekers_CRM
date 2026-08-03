// ── Calendar dates, in the only timezone this business has ──────────────
//
// Seekers is a Cairo agency. Every `date` column in this schema (leads.last_activity,
// lead_activities.date, transactions.date, tasks.due_date) stores a *calendar day as
// the team experiences it*, not an instant. There is no other reading: a call logged
// at 21:00 Cairo belongs to that evening, and an expense entered at 00:30 belongs to
// that morning.
//
// The codebase previously computed those days three different ways:
//
//   1. `new Date().toISOString().slice(0, 10)`  — the UTC day.
//   2. `AT TIME ZONE 'Africa/Cairo'` in SQL     — correct, but only in one place.
//   3. a bare `::date` cast                     — silently depends on the session TZ.
//
// (1) is simply wrong here. Cairo is UTC+2 in winter and UTC+3 on DST, so between
// local midnight and 02:00-03:00 the UTC day is still *yesterday*. Anything written
// in that window lands on the previous calendar day: an evening call logged against
// the wrong date, and — via QuickAdd — an expense misfiled into the previous month
// on the 1st, which moves money between P&L periods.
//
// This module is the single answer. Use `cairoToday()` wherever a `date` column or a
// day-string is produced in TypeScript; use `AT TIME ZONE 'Africa/Cairo'` wherever the
// day is derived in SQL. Never `toISOString().slice(0, 10)`.

/**
 * The agency's timezone. Overridable only so a test can prove the helper is
 * genuinely timezone-driven rather than accidentally matching the host clock.
 */
export const CAIRO_TZ = "Africa/Cairo";

/**
 * `YYYY-MM-DD` for the given instant in a given zone.
 *
 * `en-CA` is used because it is the one widely-supported locale whose short date
 * format IS ISO 8601 — this avoids hand-rolling padding and avoids `toISOString`,
 * which is UTC by definition and is the bug this module exists to prevent.
 */
export function cairoDate(instant: Date = new Date(), tz: string = CAIRO_TZ): string {
  return instant.toLocaleDateString("en-CA", { timeZone: tz });
}

/** Today's calendar date in Cairo, as `YYYY-MM-DD`. The default for every date column. */
export function cairoToday(now: Date = new Date()): string {
  return cairoDate(now);
}

/** The current calendar month in Cairo, as `YYYY-MM`. */
export function cairoMonth(now: Date = new Date()): string {
  return cairoToday(now).slice(0, 7);
}

/**
 * The Cairo calendar date `days` days before `now`.
 *
 * Subtracting in UTC milliseconds and *then* converting is deliberate: it is the
 * shift-by-24h-then-ask-the-clock behaviour every caller here wants ("7 days ago"),
 * and it stays correct across the DST boundary because the conversion, not the
 * arithmetic, decides the calendar day.
 */
export function cairoDaysAgo(days: number, now: Date = new Date()): string {
  return cairoDate(new Date(now.getTime() - days * 86_400_000));
}

// ── Calendar arithmetic on a date that is already known ─────────────────
//
// These take a `YYYY-MM-DD` string and return one. They are NOT "what is today"
// — the caller has already decided the anchor day (usually with cairoToday()),
// and these only shift it. They anchor at UTC midnight and read the UTC fields
// back, so no timezone can move the result: "2026-08-03" + 14 days is
// "2026-08-17" wherever the server runs. That is the one case where
// `toISOString().slice(0, 10)` is not the bug this module exists to prevent.

/** Invoice due dates: `addCalendarDays("2026-08-03", 14)` → `"2026-08-17"`. */
export function addCalendarDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The next month of a retainer: same day-of-month, CLAMPED to the end of a
 * short month. 31 Jan + 1 month is 28/29 Feb — naive arithmetic produces
 * 2 or 3 March and silently skips February's invoice.
 */
export function addCalendarMonths(isoDate: string, months: number): string {
  const d   = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);                                  // avoid overflow while shifting
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}
