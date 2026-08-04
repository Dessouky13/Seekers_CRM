// Import-side parsing for bulk lead import: pasted blocks (tab-separated,
// straight out of Google Sheets/Excel), CSV files, and .xlsx workbooks. Text
// parsing is hand-rolled rather than pulled from a library — the shapes we need
// are simple, and mirroring `csv.ts`'s escaping rules (RFC-4180 quoting, doubled
// inner quotes) in reverse keeps import and export symmetric, tested the same
// way.
//
// XLSX is the exception: a .xlsx is a zip of XML parts, which is not something
// to hand-roll. `read-excel-file/browser` unzips it and hands back a plain
// 2-D array of cell values, and `sheetRowsToTable` below folds that into the
// SAME `ParsedTable` the text path produces. One shape out means the mapping,
// preview, validation and import steps are identical for all three inputs —
// there is no second code path that can disagree about what row 3 contained.
//
// Pure: no DOM, no fetch, nothing but data in, data out — so it's testable
// exactly as written, with the same rigor as the dedupe decision on the
// backend (lead-import.ts). The one impure part (reading the File) lives in the
// panel; everything here takes values that have already been read.

export type Delimiter = "," | "\t" | ";";

/**
 * Pick the delimiter from the first non-blank line of `text`.
 *
 * Tab wins whenever present at all — a paste from Sheets/Excel is
 * tab-separated even when individual cells contain commas (a company name
 * like "Smith, Jones & Co" must not be misread as three columns). Otherwise
 * whichever of comma/semicolon appears more often wins (semicolon is the
 * default list separator in many European CSV exports).
 */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r\n|\r|\n/).find((l) => l.trim().length > 0) ?? "";
  const counts = countUnquoted(firstLine);
  if (counts["\t"] > 0) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

/** Count delimiter candidates in a single line, ignoring anything inside a quoted field. */
function countUnquoted(line: string): Record<Delimiter, number> {
  const counts: Record<Delimiter, number> = { ",": 0, "\t": 0, ";": 0 };
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === "," || ch === "\t" || ch === ";")) {
      counts[ch as Delimiter]++;
    }
  }
  return counts;
}

export interface ParsedTable {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Parse delimited text into a header row + data rows.
 *
 * Handles RFC-4180-style quoting: a field wrapped in `"..."` may contain the
 * delimiter, a newline, or a doubled `""` as a literal quote. Rows that are
 * entirely blank (no non-whitespace in any cell) are dropped, so trailing
 * blank lines from a paste don't show up as empty preview rows.
 */
export function parseDelimited(text: string, delimiter?: Delimiter): ParsedTable {
  const delim = delimiter ?? detectDelimiter(text);
  const table = tokenize(text, delim);
  if (table.length === 0) return { headers: [], rows: [] };

  const headers = table[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (const rawRow of table.slice(1)) {
    if (rawRow.every((cell) => cell.trim() === "")) continue; // fully blank row
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (rawRow[i] ?? "").trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

// ── XLSX ─────────────────────────────────────────────────────────────────

/**
 * Cell values as `read-excel-file` returns them: strings, numbers, booleans,
 * `Date` objects for date-formatted cells, and `null` for empty cells.
 *
 * The functions below take `unknown` rather than this type on purpose.
 * read-excel-file@9.3.5 declares its cell union as `string | number | boolean |
 * typeof Date` — `typeof Date` is the Date *constructor*, not a Date instance,
 * so its own `SheetData` is not assignable to an accurate cell type. Narrowing
 * at runtime is both correct and immune to that being fixed or changed upstream.
 */
export type SheetCell = string | number | boolean | Date | null | undefined;

/**
 * Stringify one spreadsheet cell the way the CSV path would have delivered it.
 *
 * Three cases matter for real lead sheets:
 *   • Numbers. A phone column typed as a number arrives as `201001234567`, and
 *     `String()` on a large one can yield exponential notation ("2.01e+11"),
 *     which destroys the number. Integers are formatted with `toFixed(0)` to
 *     force positional notation.
 *   • Dates. A "last contacted" column comes back as a `Date`; the ISO date part
 *     is the only form the rest of the app can read.
 *   • null/undefined empty cells become "", matching how a missing CSV field is
 *     already handled in `parseDelimited`.
 */
export function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) {
    // The UTC date part: read-excel-file builds these at UTC midnight from the
    // sheet's serial number, so reading the UTC fields returns the day the sheet
    // actually shows. Converting through a local timezone would shift it.
    return cell.toISOString().slice(0, 10);
  }
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return "";
    if (!Number.isInteger(cell)) return String(cell);
    // `toFixed(0)` is positional only below 1e21 — at or above it, toFixed falls
    // back to exponential exactly like String() does. No E.164 number reaches
    // 1e21 (15 digits is the maximum), but a mis-typed cell can, and BigInt
    // closes the whole class rather than the part that seemed likely.
    return Math.abs(cell) < 1e21 ? cell.toFixed(0) : BigInt(cell).toString();
  }
  if (typeof cell === "boolean") return cell ? "true" : "false";
  return String(cell);
}

/**
 * Fold a sheet's raw 2-D cell array into the same `{ headers, rows }` shape
 * `parseDelimited` returns.
 *
 * Matches the text path's behaviour deliberately:
 *   • the first row is the header row, trimmed;
 *   • wholly-blank rows are dropped (an exported sheet routinely has hundreds of
 *     formatted-but-empty trailing rows, and they would otherwise show up as
 *     empty preview rows and empty leads);
 *   • short rows are padded, so a row that ends early doesn't shift columns.
 *
 * Leading blank rows are skipped before the header is taken — a sheet with a
 * title row above the table is common enough that treating "" as the header
 * names would silently map every column to nothing.
 */
export function sheetRowsToTable(sheet: readonly unknown[][]): ParsedTable {
  const nonBlank = sheet.filter((r) => r.some((c) => cellToString(c).trim() !== ""));
  if (nonBlank.length === 0) return { headers: [], rows: [] };

  const headers = nonBlank[0].map((c) => cellToString(c).trim());
  const rows: Record<string, string>[] = [];
  for (const raw of nonBlank.slice(1)) {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cellToString(raw[i]).trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

/**
 * Which parser a picked file needs, by extension.
 *
 * Extension rather than MIME type on purpose: browsers report .xlsx
 * inconsistently (Chrome sends the long
 * `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, some
 * Windows setups send `application/octet-stream`, and a file dragged from a zip
 * viewer can arrive with an empty `type`), so MIME sniffing rejects valid files.
 */
export function importFileKind(fileName: string): "spreadsheet" | "text" {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ext === "xlsx" || ext === "xls" || ext === "xlsm" ? "spreadsheet" : "text";
}

/** Tokenize the whole text into rows of raw (untrimmed) field strings. */
function tokenize(text: string, delimiter: Delimiter): string[][] {
  // Strip a leading BOM (Excel-exported CSVs commonly carry one).
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const table: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { pushField(); table.push(row); row = []; };

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delimiter) { pushField(); i++; continue; }
    if (ch === "\r") { i++; continue; } // normalise CRLF -> LF, drop bare CR
    if (ch === "\n") { pushRow(); i++; continue; }
    field += ch; i++;
  }
  // Final field/row, if the text didn't end on a newline.
  if (field.length > 0 || row.length > 0) pushRow();

  // Drop a wholly-empty trailing row produced by a trailing newline.
  while (table.length > 0 && table[table.length - 1].every((c) => c === "")) {
    table.pop();
  }
  return table;
}
