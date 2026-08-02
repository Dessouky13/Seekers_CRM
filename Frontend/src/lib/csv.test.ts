import { describe, it, expect } from "vitest";
import { toCsv, timestampedName, type CsvColumn } from "./csv";

interface Row { name: string; amount: number | null; note?: string | null }

const cols: CsvColumn<Row>[] = [
  { header: "Name",   value: (r) => r.name },
  { header: "Amount", value: (r) => r.amount },
  { header: "Note",   value: (r) => r.note },
];

describe("toCsv", () => {
  it("writes a header row and CRLF line endings", () => {
    const out = toCsv([{ name: "Acme", amount: 10, note: "hi" }], cols);
    expect(out).toBe("Name,Amount,Note\r\nAcme,10,hi");
  });

  it("quotes fields containing a comma, quote or newline", () => {
    const out = toCsv([{ name: 'Ali, "Bo"', amount: 1, note: "a\nb" }], cols);
    expect(out).toContain('"Ali, ""Bo"""');
    expect(out).toContain('"a\nb"');
  });

  it("leaves numbers unquoted so spreadsheets treat them as numeric", () => {
    expect(toCsv([{ name: "x", amount: 1234.5, note: null }], cols)).toContain(",1234.5,");
  });

  it("renders null/undefined as an empty field, not the string 'null'", () => {
    const out = toCsv([{ name: "x", amount: null, note: undefined }], cols);
    expect(out).toBe("Name,Amount,Note\r\nx,,");
  });

  // Lead names and notes arrive from scrapers, so they are attacker-controlled.
  // Excel/Sheets execute a leading = + - or @ as a formula.
  it("neutralises formula injection", () => {
    for (const payload of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      const out = toCsv([{ name: payload, amount: 0, note: null }], cols);
      expect(out.split("\r\n")[1].startsWith("'")).toBe(true);
    }
  });

  it("still quotes an injection payload that also contains a comma", () => {
    const out = toCsv([{ name: "=cmd(),x", amount: 0, note: null }], cols);
    expect(out).toContain(`"'=cmd(),x"`);
  });

  it("handles an empty row set — header only", () => {
    expect(toCsv([], cols)).toBe("Name,Amount,Note");
  });
});

describe("timestampedName", () => {
  it("appends an ISO date and .csv", () => {
    expect(timestampedName("leads")).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
