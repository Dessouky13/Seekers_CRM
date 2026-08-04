import { describe, it, expect } from "vitest";
import {
  detectDelimiter, parseDelimited, cellToString, sheetRowsToTable, importFileKind,
} from "./import-parse";

describe("detectDelimiter", () => {
  it("picks tab when the line contains any tabs, even alongside commas", () => {
    // A pasted company name containing a comma must not fool tab-paste detection.
    expect(detectDelimiter("Name\tCompany\tNotes\nJane\tSmith, Jones & Co\thi")).toBe("\t");
  });

  it("picks comma when there are no tabs and commas outnumber semicolons", () => {
    expect(detectDelimiter("name,company,email\nJane,Acme,jane@acme.com")).toBe(",");
  });

  it("picks semicolon when semicolons outnumber commas", () => {
    expect(detectDelimiter("name;company;email\nJane;Acme;jane@acme.com")).toBe(";");
  });

  it("ignores delimiter characters inside quoted fields", () => {
    expect(detectDelimiter('"Smith, Jones";email\nJane;jane@acme.com')).toBe(";");
  });

  it("looks at the first non-blank line, skipping leading blank lines", () => {
    expect(detectDelimiter("\n\nname\tcompany\nJane\tAcme")).toBe("\t");
  });
});

describe("parseDelimited — comma-separated (CSV)", () => {
  it("parses a header row and data rows", () => {
    const { headers, rows } = parseDelimited("name,company,email\nJane,Acme,jane@acme.com");
    expect(headers).toEqual(["name", "company", "email"]);
    expect(rows).toEqual([{ name: "Jane", company: "Acme", email: "jane@acme.com" }]);
  });

  it("handles a quoted field containing the delimiter", () => {
    const { rows } = parseDelimited('name,company\nJane,"Smith, Jones & Co"');
    expect(rows[0].company).toBe("Smith, Jones & Co");
  });

  it("handles a doubled quote as a literal quote inside a quoted field", () => {
    const { rows } = parseDelimited('name,notes\nJane,"She said ""hi"" to me"');
    expect(rows[0].notes).toBe('She said "hi" to me');
  });

  it("handles a quoted field containing an embedded newline", () => {
    const { rows } = parseDelimited('name,notes\nJane,"Line one\nLine two"\nBob,plain');
    expect(rows).toHaveLength(2);
    expect(rows[0].notes).toBe("Line one\nLine two");
    expect(rows[1].name).toBe("Bob");
  });

  it("handles CRLF line endings", () => {
    const { rows } = parseDelimited("name,company\r\nJane,Acme\r\nBob,Widgets");
    expect(rows).toEqual([
      { name: "Jane", company: "Acme" },
      { name: "Bob", company: "Widgets" },
    ]);
  });

  it("drops a BOM at the start of the text", () => {
    const { headers } = parseDelimited("﻿name,company\nJane,Acme");
    expect(headers[0]).toBe("name");
  });

  it("trims whitespace around headers and cell values", () => {
    const { headers, rows } = parseDelimited(" name , company \n Jane , Acme ");
    expect(headers).toEqual(["name", "company"]);
    expect(rows[0]).toEqual({ name: "Jane", company: "Acme" });
  });

  it("skips fully blank rows (e.g. trailing blank lines from a paste)", () => {
    const { rows } = parseDelimited("name,company\nJane,Acme\n\n\nBob,Widgets\n");
    expect(rows).toEqual([
      { name: "Jane", company: "Acme" },
      { name: "Bob", company: "Widgets" },
    ]);
  });

  it("returns empty headers and rows for empty input", () => {
    expect(parseDelimited("")).toEqual({ headers: [], rows: [] });
  });

  it("returns no rows for a header-only input", () => {
    expect(parseDelimited("name,company")).toEqual({ headers: ["name", "company"], rows: [] });
  });

  it("fills a short row's missing trailing cells as empty strings", () => {
    const { rows } = parseDelimited("name,company,email\nJane,Acme");
    expect(rows[0]).toEqual({ name: "Jane", company: "Acme", email: "" });
  });
});

describe("parseDelimited — tab-separated (pasted from Sheets/Excel)", () => {
  it("auto-detects tabs and parses correctly", () => {
    const pasted = "Name\tCompany\tEmail\nJane Doe\tAcme Corp\tjane@acme.com\nBob Lee\tWidgets Co\tbob@widgets.com";
    const { headers, rows } = parseDelimited(pasted);
    expect(headers).toEqual(["Name", "Company", "Email"]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ Name: "Bob Lee", Company: "Widgets Co", Email: "bob@widgets.com" });
  });

  it("keeps a comma inside a tab-separated cell intact", () => {
    const pasted = "Name\tCompany\nJane\tSmith, Jones & Co";
    const { rows } = parseDelimited(pasted);
    expect(rows[0].Company).toBe("Smith, Jones & Co");
  });
});

describe("parseDelimited — semicolon-separated", () => {
  it("parses correctly when an explicit delimiter is given", () => {
    const { rows } = parseDelimited("name;company\nJane;Acme", ";");
    expect(rows[0]).toEqual({ name: "Jane", company: "Acme" });
  });
});

// ── XLSX path ────────────────────────────────────────────────────────────
describe("cellToString", () => {
  it("returns '' for the empty cells read-excel-file reports as null", () => {
    expect(cellToString(null)).toBe("");
    expect(cellToString(undefined)).toBe("");
  });

  it("keeps a long numeric phone in positional notation, not exponential", () => {
    // A phone column typed as a number in Excel arrives as 201001234567.
    // String(1e21) is "1e+21", which silently destroys the number and is not
    // something a five-row preview makes obvious.
    expect(cellToString(201001234567)).toBe("201001234567");
    // The longest possible E.164 number, 15 digits.
    expect(cellToString(971501234567890)).toBe("971501234567890");
    // Above 1e21 even toFixed(0) goes exponential; BigInt is the fallback.
    expect(cellToString(1e21)).toBe("1000000000000000000000");
  });

  it("keeps decimals readable for a deal-value column", () => {
    expect(cellToString(1500.5)).toBe("1500.5");
    expect(cellToString(0)).toBe("0");
  });

  it("renders a date cell as its calendar day", () => {
    expect(cellToString(new Date("2026-08-03T00:00:00Z"))).toBe("2026-08-03");
  });

  it("renders booleans as text rather than as blank", () => {
    expect(cellToString(true)).toBe("true");
    expect(cellToString(false)).toBe("false");
  });

  it("drops NaN/Infinity instead of writing 'NaN' into a lead field", () => {
    expect(cellToString(NaN)).toBe("");
    expect(cellToString(Infinity)).toBe("");
  });
});

describe("sheetRowsToTable", () => {
  it("produces the same table parseDelimited does, for the same data", () => {
    const fromSheet = sheetRowsToTable([
      ["Name", "Company", "Email"],
      ["Jane", "Acme", "jane@acme.com"],
    ]);
    const fromText = parseDelimited("Name,Company,Email\nJane,Acme,jane@acme.com");
    expect(fromSheet).toEqual(fromText);
  });

  it("returns an empty table for an empty or wholly-blank sheet", () => {
    expect(sheetRowsToTable([])).toEqual({ headers: [], rows: [] });
    expect(sheetRowsToTable([[null, null], ["", "   "]])).toEqual({ headers: [], rows: [] });
  });

  it("drops the formatted-but-empty trailing rows an Excel export carries", () => {
    const { rows } = sheetRowsToTable([
      ["Name", "Company"],
      ["Jane", "Acme"],
      [null, null],
      ["", ""],
    ]);
    expect(rows).toHaveLength(1);
  });

  it("skips a title row above the table so the real headers are used", () => {
    const { headers, rows } = sheetRowsToTable([
      [null, null],
      ["Name", "Company"],
      ["Jane", "Acme"],
    ]);
    expect(headers).toEqual(["Name", "Company"]);
    expect(rows[0]).toEqual({ Name: "Jane", Company: "Acme" });
  });

  it("pads a short row instead of shifting its columns left", () => {
    const { rows } = sheetRowsToTable([
      ["Name", "Company", "Email"],
      ["Jane", "Acme"],
    ]);
    expect(rows[0]).toEqual({ Name: "Jane", Company: "Acme", Email: "" });
  });

  it("trims headers and cells, like the text path", () => {
    const { headers, rows } = sheetRowsToTable([
      ["  Name  ", " Company "],
      ["  Jane ", " Acme  "],
    ]);
    expect(headers).toEqual(["Name", "Company"]);
    expect(rows[0]).toEqual({ Name: "Jane", Company: "Acme" });
  });

  it("stringifies mixed cell types so every mapped field is a string", () => {
    const { rows } = sheetRowsToTable([
      ["Company", "Phone", "Deal value", "Active"],
      ["Acme", 201001234567, 5000, true],
    ]);
    expect(rows[0]).toEqual({
      Company: "Acme", Phone: "201001234567", "Deal value": "5000", Active: "true",
    });
  });
});

describe("importFileKind", () => {
  it("routes spreadsheet extensions to the xlsx parser", () => {
    expect(importFileKind("leads.xlsx")).toBe("spreadsheet");
    expect(importFileKind("Leads.XLSX")).toBe("spreadsheet");
    expect(importFileKind("old.xls")).toBe("spreadsheet");
  });

  it("routes everything else to the text parser", () => {
    expect(importFileKind("leads.csv")).toBe("text");
    expect(importFileKind("leads.tsv")).toBe("text");
    expect(importFileKind("noextension")).toBe("text");
  });

  it("uses the LAST extension, so 'leads.xlsx.csv' is text", () => {
    expect(importFileKind("leads.xlsx.csv")).toBe("text");
  });
});
