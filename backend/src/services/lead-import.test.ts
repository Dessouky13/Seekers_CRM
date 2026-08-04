import { describe, it, expect } from "vitest";
import {
  fillNameCompany, pairKey, emailKey, planLeadImport, validateImportRows,
  type ImportRow, type ExistingLeadMatch,
} from "./lead-import";

describe("fillNameCompany", () => {
  it("keeps both when both are supplied", () => {
    expect(fillNameCompany("Jane", "Acme")).toEqual({ name: "Jane", company: "Acme" });
  });

  it("falls back company to name when company is missing", () => {
    expect(fillNameCompany("Jane", undefined)).toEqual({ name: "Jane", company: "Jane" });
    expect(fillNameCompany("Jane", "")).toEqual({ name: "Jane", company: "Jane" });
  });

  it("falls back name to company when name is missing", () => {
    expect(fillNameCompany(undefined, "Acme")).toEqual({ name: "Acme", company: "Acme" });
    expect(fillNameCompany(null, "Acme")).toEqual({ name: "Acme", company: "Acme" });
  });

  it("uses a placeholder when neither is supplied — DB columns are NOT NULL", () => {
    expect(fillNameCompany(undefined, undefined)).toEqual({ name: "(unknown)", company: "(unknown)" });
    expect(fillNameCompany("  ", "  ")).toEqual({ name: "(unknown)", company: "(unknown)" });
  });

  it("trims whitespace", () => {
    expect(fillNameCompany("  Jane  ", "  Acme  ")).toEqual({ name: "Jane", company: "Acme" });
  });
});

describe("pairKey", () => {
  it("cannot collide across a name/company split", () => {
    // Without a real separator, "Jane Doe" + "Acme" could collide with
    // "Jane" + "Doe Acme". JSON-encoding each field separately prevents that.
    const a = pairKey("Jane Doe", "Acme");
    const b = pairKey("Jane", "Doe Acme");
    expect(a).not.toBe(b);
  });

  it("is stable for identical input", () => {
    expect(pairKey("Jane", "Acme")).toBe(pairKey("Jane", "Acme"));
  });
});

describe("emailKey", () => {
  it("lowercases and trims", () => {
    expect(emailKey("  Jane@Acme.com  ")).toBe("jane@acme.com");
  });

  it("returns null for blank or missing input", () => {
    expect(emailKey("")).toBeNull();
    expect(emailKey("   ")).toBeNull();
    expect(emailKey(undefined)).toBeNull();
    expect(emailKey(null)).toBeNull();
  });
});

// ── planLeadImport — the part that must be right ────────────
//
// A minimal lead payload shape for the tests; planLeadImport is generic over
// this, so the tests exercise it exactly as the route does.
interface TestLead { phone?: string | null }

function row(index: number, name: string, company: string, emailLower: string | null, lead: TestLead = {}): ImportRow<TestLead> {
  return { index, name, company, emailLower, lead };
}

describe("planLeadImport", () => {
  it("puts every row with no match into toInsert", () => {
    const plan = planLeadImport<TestLead>({
      rows: [row(0, "Jane", "Acme", "jane@acme.com"), row(1, "Bob", "Widgets", null)],
      existingByEmail: new Map(),
      existingByPair: new Map(),
      mode: "update",
    });
    expect(plan.toInsert).toHaveLength(2);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toSkip).toHaveLength(0);
  });

  it("routes an email match to toUpdate in update mode", () => {
    const existing: ExistingLeadMatch = { id: "lead-1", phone: null };
    const plan = planLeadImport<TestLead>({
      rows: [row(0, "Jane", "Acme", "jane@acme.com")],
      existingByEmail: new Map([["jane@acme.com", existing]]),
      existingByPair: new Map(),
      mode: "update",
    });
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toUpdate).toEqual([{ id: "lead-1", existingPhone: null, row: plan.toUpdate[0].row }]);
    expect(plan.toSkip).toHaveLength(0);
  });

  it("routes an email match to toSkip (reason: existing) in skip mode", () => {
    const existing: ExistingLeadMatch = { id: "lead-1", phone: "+201000000000" };
    const plan = planLeadImport<TestLead>({
      rows: [row(0, "Jane", "Acme", "jane@acme.com")],
      existingByEmail: new Map([["jane@acme.com", existing]]),
      existingByPair: new Map(),
      mode: "skip",
    });
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.toSkip).toEqual([{ row: plan.toSkip[0].row, reason: "existing" }]);
  });

  it("falls back to name+company match when a row has no email", () => {
    const existing: ExistingLeadMatch = { id: "lead-2", phone: null };
    const plan = planLeadImport<TestLead>({
      rows: [row(0, "Jane", "Acme", null)],
      existingByEmail: new Map(),
      existingByPair: new Map([[pairKey("Jane", "Acme"), existing]]),
      mode: "update",
    });
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].id).toBe("lead-2");
  });

  it("treats a same-batch repeat as a duplicate, not a second insert", () => {
    const plan = planLeadImport<TestLead>({
      rows: [
        row(0, "Jane", "Acme", "jane@acme.com"),
        row(1, "Jane", "Acme", "jane@acme.com"), // same sheet, pasted twice
      ],
      existingByEmail: new Map(),
      existingByPair: new Map(),
      mode: "update",
    });
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toInsert[0].index).toBe(0);
    expect(plan.toSkip).toHaveLength(1);
    expect(plan.toSkip[0].reason).toBe("duplicate_in_batch");
    expect(plan.toSkip[0].row.index).toBe(1);
  });

  it("treats a same-batch repeat of an existing-match row as a duplicate too", () => {
    // Row 0 matches the DB and is queued for update; row 1 repeats the same
    // email within the same paste and must not queue a second update.
    const existing: ExistingLeadMatch = { id: "lead-1", phone: null };
    const plan = planLeadImport<TestLead>({
      rows: [
        row(0, "Jane", "Acme", "jane@acme.com"),
        row(1, "Jane", "Acme", "jane@acme.com"),
      ],
      existingByEmail: new Map([["jane@acme.com", existing]]),
      existingByPair: new Map(),
      mode: "update",
    });
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].row.index).toBe(0);
    expect(plan.toSkip).toHaveLength(1);
    expect(plan.toSkip[0].row.index).toBe(1);
  });

  it("email match takes precedence over an incidental name+company match", () => {
    const byEmail: ExistingLeadMatch = { id: "by-email", phone: null };
    const byPair: ExistingLeadMatch = { id: "by-pair", phone: null };
    const plan = planLeadImport<TestLead>({
      rows: [row(0, "Jane", "Acme", "jane@acme.com")],
      existingByEmail: new Map([["jane@acme.com", byEmail]]),
      existingByPair: new Map([[pairKey("Jane", "Acme"), byPair]]),
      mode: "update",
    });
    expect(plan.toUpdate[0].id).toBe("by-email");
  });

  // ── The property the whole feature exists to guarantee ────
  it("importing the identical batch twice creates nothing the second time", () => {
    const rows = [
      row(0, "Jane", "Acme", "jane@acme.com"),
      row(1, "Bob", "Widgets Co", null),
    ];

    // First import: nothing exists yet.
    const first = planLeadImport<TestLead>({
      rows, existingByEmail: new Map(), existingByPair: new Map(), mode: "update",
    });
    expect(first.toInsert).toHaveLength(2);
    expect(first.toUpdate).toHaveLength(0);

    // Simulate the DB now containing what was inserted, then run the exact
    // same batch again — this is what "import the same file twice" means.
    const existingByEmail = new Map([["jane@acme.com", { id: "new-1", phone: null }]]);
    const existingByPair = new Map([[pairKey("Bob", "Widgets Co"), { id: "new-2", phone: null }]]);
    const second = planLeadImport<TestLead>({
      rows, existingByEmail, existingByPair, mode: "update",
    });
    expect(second.toInsert).toHaveLength(0);
    expect(second.toUpdate).toHaveLength(2);
  });
});

// ── Pre-flight validation ────────────────────────────────────────────────
describe("validateImportRows", () => {
  const vrow = (index: number, fields: Partial<{ name: string; company: string; email: string; phone: string }>) =>
    ({ index, ...fields });

  const codesFor = (report: ReturnType<typeof validateImportRows>, index: number) =>
    report.rows.find((r) => r.index === index)?.issues.map((i) => i.code) ?? [];

  it("reports nothing for a clean sheet", () => {
    const report = validateImportRows({
      rows: [
        vrow(0, { name: "Jane", company: "Acme", email: "jane@acme.com", phone: "+201001234567" }),
        vrow(1, { name: "Bob", company: "Widgets Co", email: "bob@widgets.co" }),
      ],
    });
    expect(report.rows).toEqual([]);
    expect(report.clean).toBe(2);
    expect(report.blocking).toBe(0);
    expect(report.warnings).toBe(0);
  });

  it("flags a row carrying none of name/company/email/phone as blocking", () => {
    // Mirrors the ingest schema's .refine() — such a row has no lead in it.
    const report = validateImportRows({ rows: [vrow(0, { name: "   ", company: "" })] });
    expect(codesFor(report, 0)).toEqual(["missing_required"]);
    expect(report.blocking).toBe(1);
  });

  it("treats a malformed email as BLOCKING, because one bad cell 400s the whole batch", () => {
    const report = validateImportRows({
      rows: [
        vrow(0, { name: "Jane", company: "Acme", email: "jane@" }),
        vrow(1, { name: "Bob",  company: "Acme", email: "not-an-email" }),
      ],
    });
    expect(codesFor(report, 0)).toEqual(["invalid_email"]);
    expect(codesFor(report, 1)).toEqual(["invalid_email"]);
    expect(report.blocking).toBe(2);
    expect(report.rows[0].issues[0].blocking).toBe(true);
  });

  it("flags an unparseable phone as a WARNING — the importer keeps the raw text", () => {
    const report = validateImportRows({
      rows: [vrow(0, { name: "Jane", company: "Acme", phone: "0100 123 4567" })],
    });
    expect(codesFor(report, 0)).toEqual(["invalid_phone"]);
    expect(report.blocking).toBe(0);
    expect(report.warnings).toBe(1);
  });

  it("does not treat scraper junk like 'N/A' as a phone at all", () => {
    // normalisePhone() already maps the junk words to null, so this would
    // otherwise be reported as an invalid number the user has to look at.
    const report = validateImportRows({
      rows: [vrow(0, { name: "Jane", company: "Acme", phone: "N/A" })],
    });
    expect(codesFor(report, 0)).toEqual(["invalid_phone"]);
  });

  it("flags a landline, because WhatsApp outreach will skip it", () => {
    // +20 2… is a Cairo fixed line under the Egyptian dialling plan.
    const report = validateImportRows({
      rows: [vrow(0, { name: "Jane", company: "Acme", phone: "+20223456789" })],
    });
    expect(codesFor(report, 0)).toEqual(["landline_phone"]);
  });

  it("detects a duplicate email inside the file, case-insensitively, on the LATER row", () => {
    const report = validateImportRows({
      rows: [
        vrow(0, { name: "Jane", company: "Acme", email: "jane@acme.com" }),
        vrow(1, { name: "J. Doe", company: "Acme", email: "JANE@ACME.COM" }),
      ],
    });
    expect(codesFor(report, 0)).toEqual([]);
    expect(codesFor(report, 1)).toEqual(["duplicate_email_in_file"]);
  });

  it("detects a duplicate phone inside the file after normalising to E.164", () => {
    // "00201..." and "+201..." are the same number; a raw string compare
    // would call neither a duplicate.
    const report = validateImportRows({
      rows: [
        vrow(0, { name: "Jane", company: "Acme", phone: "+20 100 123 4567" }),
        vrow(1, { name: "Bob",  company: "Acme", phone: "00201001234567" }),
      ],
    });
    expect(codesFor(report, 0)).toEqual([]);
    expect(codesFor(report, 1)).toEqual(["duplicate_phone_in_file"]);
  });

  it("detects an email that already exists in the CRM", () => {
    const report = validateImportRows({
      rows: [vrow(0, { name: "Jane", company: "Acme", email: "Jane@Acme.com" })],
      existingEmails: new Set(["jane@acme.com"]),
    });
    expect(codesFor(report, 0)).toEqual(["duplicate_email_existing"]);
  });

  it("detects an existing phone — the case planLeadImport does NOT dedupe", () => {
    // Different email, same number: planLeadImport matches on email and would
    // happily insert a second record for the same human. Detection is all
    // there is today, which is why the message says WILL create a second record.
    const report = validateImportRows({
      rows: [vrow(0, { name: "Jane", company: "Acme", email: "new@acme.com", phone: "+201001234567" })],
      existingEmails: new Set(),
      existingPhones: new Set(["+201001234567"]),
    });
    expect(codesFor(report, 0)).toEqual(["duplicate_phone_existing"]);
    expect(report.rows[0].issues[0].blocking).toBe(false);
  });

  it("prefers 'already in this file' over 'already in the CRM' for a repeat row", () => {
    const report = validateImportRows({
      rows: [
        vrow(0, { name: "Jane", company: "Acme", email: "jane@acme.com" }),
        vrow(1, { name: "Jane", company: "Acme", email: "jane@acme.com" }),
      ],
      existingEmails: new Set(["jane@acme.com"]),
    });
    expect(codesFor(report, 0)).toEqual(["duplicate_email_existing"]);
    expect(codesFor(report, 1)).toEqual(["duplicate_email_in_file"]);
  });

  it("accumulates several issues on one row and counts it once", () => {
    const report = validateImportRows({
      rows: [vrow(0, { name: "Jane", company: "Acme", email: "jane@", phone: "12345" })],
    });
    expect(codesFor(report, 0)).toEqual(["invalid_email", "invalid_phone"]);
    // One blocking issue makes the ROW blocking; it is not also a warning row.
    expect(report.blocking).toBe(1);
    expect(report.warnings).toBe(0);
    expect(report.rows).toHaveLength(1);
  });

  it("reports per-code counts and omits clean rows from the row list", () => {
    const report = validateImportRows({
      rows: [
        vrow(0, { name: "Jane", company: "Acme", email: "jane@acme.com" }),
        vrow(1, { name: "Bob",  company: "Acme", email: "bob@" }),
        vrow(2, { name: "Sue",  company: "Acme", email: "sue@" }),
      ],
    });
    expect(report.total).toBe(3);
    expect(report.clean).toBe(1);
    expect(report.counts).toEqual({ invalid_email: 2 });
    expect(report.rows.map((r) => r.index)).toEqual([1, 2]);
  });

  it("keeps sheet row indices so the UI can name the offending row", () => {
    const report = validateImportRows({ rows: [vrow(417, { email: "jane@" })] });
    expect(report.rows[0].index).toBe(417);
  });
});
