import { describe, it, expect } from "vitest";
import { detectDelimiter, parseDelimited } from "./import-parse";

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
