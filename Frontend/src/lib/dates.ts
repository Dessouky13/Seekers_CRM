// ── Calendar dates, in the only timezone this business has ──────────────
//
// Mirror of `backend/src/utils/dates.ts`. Read that file for the full reasoning;
// the short version is that Seekers is a Cairo agency, every `date` field in the
// API is a calendar day as the team experiences it, and
// `new Date().toISOString().slice(0, 10)` is the UTC day, which between local
// midnight and 02:00-03:00 is *yesterday*.
//
// The frontend matters here more than the backend does, because the browser is
// where the value is chosen. `QuickAdd`'s expense form and `LeadDetailSheet`'s
// activity form both default a `<input type="date">` from this value; someone
// entering an expense at 00:30 on the 1st was silently filing it into the
// previous month's P&L, and an evening call was logged against the wrong day.
//
// Note this is NOT "the user's local day" — a phone left on a European timezone
// must still book work against the Cairo day the office runs on, so that the
// value the browser sends matches the day the backend would have derived.

export const CAIRO_TZ = "Africa/Cairo";

/**
 * `YYYY-MM-DD` for the given instant in a given zone.
 *
 * `en-CA` is the one broadly-supported locale whose short date format IS
 * ISO 8601, which avoids both hand-rolled padding and `toISOString` (UTC by
 * definition — the bug this module exists to prevent).
 */
export function cairoDate(instant: Date = new Date(), tz: string = CAIRO_TZ): string {
  return instant.toLocaleDateString("en-CA", { timeZone: tz });
}

/**
 * Today's calendar date in Cairo, as `YYYY-MM-DD`.
 *
 * Use this for every `<input type="date">` default and every client-side
 * comparison against a date the API returned. Never `toISOString().slice(0, 10)`.
 */
export function cairoToday(now: Date = new Date()): string {
  return cairoDate(now);
}

/**
 * Shift a `YYYY-MM-DD` by whole calendar days: `addCalendarDays("2026-08-30", 3)`
 * is `"2026-09-02"`. Mirror of the backend helper of the same name.
 *
 * This is NOT "what day is it" — the caller has already decided the anchor
 * (normally with `cairoToday()`); this only moves it. Anchoring at UTC midnight
 * and reading the UTC fields back means no timezone can shift the result, which
 * is the one place `toISOString().slice(0, 10)` is correct rather than the bug
 * this module exists to prevent.
 *
 * Used by Today's snooze buttons: "next week" has to land on the same weekday
 * seven days out, including across a month end or a DST change.
 */
export function addCalendarDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
