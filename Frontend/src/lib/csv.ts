// CSV export helpers.
//
// Everything here runs in the browser against data the page has already
// fetched — there is no export endpoint, and deliberately so: reusing the
// normal role-scoped API responses means an export can never reveal a row the
// user could not already see on screen.

/** A column definition: the header text and how to pull the value from a row. */
export interface CsvColumn<T> {
  header: string;
  value:  (row: T) => string | number | null | undefined;
}

/**
 * Escape one field for RFC-4180.
 *
 * Two things matter beyond quoting:
 *  - A value starting with = + - or @ is executed as a formula by Excel and
 *    Sheets ("CSV injection"). Lead names and notes are attacker-controlled in
 *    our case — they arrive from scrapers — so those get a leading apostrophe.
 *  - Numbers are left unquoted so spreadsheets treat them as numbers.
 */
function escapeField(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : "";

  let s = String(raw);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  // Quote if it contains a delimiter, quote or newline; double any inner quotes.
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build an RFC-4180 CSV string from rows + column definitions. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeField(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => escapeField(c.value(r))).join(","));
  // CRLF is what the spec says and what Excel is happiest with.
  return [head, ...body].join("\r\n");
}

/**
 * Trigger a download of `content` as `filename`.
 * The BOM matters: without it Excel renders UTF-8 as mojibake, and a lot of
 * our lead data is Arabic.
 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(["﻿", content], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick — revoking synchronously can cancel the download
  // in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `leads-2026-08-03.csv` */
export function timestampedName(base: string): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/** Convenience: build and download in one call. */
export function exportCsv<T>(base: string, rows: T[], columns: CsvColumn<T>[]): void {
  downloadCsv(timestampedName(base), toCsv(rows, columns));
}
