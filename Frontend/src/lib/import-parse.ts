// Import-side parsing for bulk lead import: pasted blocks (tab-separated,
// straight out of Google Sheets/Excel) and CSV files. Hand-rolled rather than
// pulled from a library — the shapes we need are simple, and mirroring
// `csv.ts`'s escaping rules (RFC-4180 quoting, doubled inner quotes) in
// reverse keeps import and export symmetric, tested the same way.
//
// Pure: no DOM, no fetch, nothing but strings in, data out — so it's testable
// exactly as written, with the same rigor as the dedupe decision on the
// backend (lead-import.ts).

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
