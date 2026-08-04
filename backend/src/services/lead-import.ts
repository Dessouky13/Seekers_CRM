// Pure lead-import decision logic: no DB, no I/O. Shared by the single-lead
// ingest endpoint and the bulk importer (CSV/paste/XLSX), so the one dedupe rule
// cannot drift between the two paths.
//
// The important property this file exists to guarantee: importing the same
// sheet twice must not create duplicates. That guarantee lives entirely in
// `planLeadImport`, which is why it takes plain data in (rows + whatever
// already exists in the DB, pre-fetched by the caller) and returns a plan —
// no query inside it, so it is trivially unit-testable and the same function
// can be asserted against twice in a row to prove idempotency.

import { z } from "zod";
import { classifyPhone, normalisePhone } from "./phone";

/** Resolve required NOT NULL fields when only one of name/company was supplied. */
export function fillNameCompany(
  name: string | null | undefined,
  company: string | null | undefined,
): { name: string; company: string } {
  const n = name?.trim();
  const c = company?.trim();
  if (n && c) return { name: n, company: c };
  if (n) return { name: n, company: n };
  if (c) return { name: c, company: c };
  return { name: "(unknown)", company: "(unknown)" };
}

/** Dedupe key for leads with no email. JSON so a name containing the separator
 *  cannot collide with a different name/company split. */
export function pairKey(name: string, company: string): string {
  return JSON.stringify([name, company]);
}

/** `lower(trim(email))`, or null when there is nothing usable. */
export function emailKey(email: string | null | undefined): string | null {
  const trimmed = email?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export type ImportMode = "skip" | "update";

/** One row from the incoming batch, already normalised. */
export interface ImportRow<TLead = Record<string, unknown>> {
  index: number;
  name: string;
  company: string;
  emailLower: string | null;
  /** The original, un-normalised payload for this row (used once a decision is made). */
  lead: TLead;
}

/** What we already have in the DB for a potential match. */
export interface ExistingLeadMatch {
  id: string;
  phone: string | null;
}

export interface ImportPlan<TLead> {
  /** Brand-new leads — no existing row matched, and no earlier row in this
   *  batch claimed the same key. */
  toInsert: ImportRow<TLead>[];
  /** Rows matching an existing DB row, to be patched (mode: "update"). */
  toUpdate: { id: string; existingPhone: string | null; row: ImportRow<TLead> }[];
  /** Rows that were not written at all, with why. */
  toSkip: { row: ImportRow<TLead>; reason: "existing" | "duplicate_in_batch" }[];
}

/**
 * Decide what to do with every row in a batch, given what already exists.
 *
 * Matching precedence, same as the single-lead ingest endpoint: email first
 * (case-insensitive), falling back to exact name+company when there is no
 * email. A row that matches an EARLIER row in the same batch (by the same
 * key) is treated the same as matching an existing DB row — one CSV
 * containing the same lead twice must not create two records.
 */
export function planLeadImport<TLead>(params: {
  rows: ImportRow<TLead>[];
  existingByEmail: Map<string, ExistingLeadMatch>;
  existingByPair: Map<string, ExistingLeadMatch>;
  mode: ImportMode;
}): ImportPlan<TLead> {
  const { rows, existingByEmail, existingByPair, mode } = params;

  const toInsert: ImportRow<TLead>[] = [];
  const toUpdate: ImportPlan<TLead>["toUpdate"] = [];
  const toSkip: ImportPlan<TLead>["toSkip"] = [];

  // Keys already claimed by an earlier row in this batch — checked FIRST, so
  // a row repeating an earlier row's key is always "duplicate_in_batch", even
  // when that earlier row itself matched an existing DB record.
  const seenInBatch = new Set<string>();

  for (const row of rows) {
    const key = row.emailLower ?? pairKey(row.name, row.company);

    if (seenInBatch.has(key)) {
      toSkip.push({ row, reason: "duplicate_in_batch" });
      continue;
    }
    seenInBatch.add(key);

    const existing = row.emailLower
      ? existingByEmail.get(row.emailLower)
      : existingByPair.get(key);

    if (existing) {
      if (mode === "skip") {
        toSkip.push({ row, reason: "existing" });
      } else {
        toUpdate.push({ id: existing.id, existingPhone: existing.phone, row });
      }
      continue;
    }

    toInsert.push(row);
  }

  return { toInsert, toUpdate, toSkip };
}

// ── Pre-flight row validation ────────────────────────────────────────────
//
// `planLeadImport` above decides what to WRITE. This section decides what to
// TELL THE USER before anything is written, and it exists because the importer
// had two failure modes that were invisible until after the button was pressed:
//
//  1. ONE malformed email cell rejected the whole batch. The bulk endpoint's
//     Zod schema validates `leads` as an array, and `emailField` is
//     `z.string().email()` — Zod fails the entire request before the first row
//     is inserted, so a 500-row sheet with one "jane@" in it returned a 400 and
//     imported nothing, with a `leads.417.email` field path as the only clue.
//     That is why `invalid_email` is the one BLOCKING issue: the caller has to
//     drop those rows or the other 499 never land.
//
//  2. Duplicate PHONE against an existing lead is not deduped anywhere.
//     `planLeadImport` matches on email, falling back to name+company — so a
//     row with a new email and a phone number we already hold creates a second
//     lead for the same human. There is no safe automatic fix (two people at
//     one company genuinely share a switchboard number), so it is reported as a
//     warning for a human to judge. Be clear that this is detection, not
//     prevention.
//
// Email format is checked with the SAME `z.string().email()` predicate the
// ingest schema uses, deliberately — a pre-flight check that is more lenient
// than the importer would pass rows the importer then rejects wholesale, which
// is exactly the bug being fixed. Phone checks go through `./phone`
// (`normalisePhone` / `classifyPhone`), the single dialling-plan classifier
// the routing code already uses; there is no second phone validator here.

export type RowIssueCode =
  | "missing_required"
  | "invalid_email"
  | "invalid_phone"
  | "landline_phone"
  | "duplicate_email_in_file"
  | "duplicate_phone_in_file"
  | "duplicate_email_existing"
  | "duplicate_phone_existing";

export interface RowIssue {
  code:    RowIssueCode;
  field:   "row" | "email" | "phone";
  message: string;
  /** True when importing this row cannot succeed and it must be dropped. */
  blocking: boolean;
}

/** One row's four dedupe/validation-relevant fields, straight off the sheet. */
export interface ValidatableRow {
  index:    number;
  name?:    string | null;
  company?: string | null;
  email?:   string | null;
  phone?:   string | null;
}

export interface RowValidation {
  index:  number;
  issues: RowIssue[];
}

export interface ValidationReport {
  total:    number;
  /** Rows with no issue at all. */
  clean:    number;
  /** Rows carrying at least one blocking issue — these must not be sent. */
  blocking: number;
  /** Rows carrying warnings but no blocking issue. */
  warnings: number;
  counts:   Partial<Record<RowIssueCode, number>>;
  /** Only rows that HAVE issues, in sheet order. Clean rows are omitted. */
  rows:     RowValidation[];
}

// A module-level shape rather than a per-call `z.string().email()`: this runs
// once per row and Zod rebuilds its internal checks on every construction.
const emailShape = z.string().email();

/**
 * Validate a batch of rows against the four fields that can fail, plus the
 * duplicate keys.
 *
 * `existingEmails` (lowercased) and `existingPhones` (E.164) are passed in by
 * the caller after querying the DB, keeping this function pure and testable —
 * the same reason `planLeadImport` takes its lookups as Maps.
 */
export function validateImportRows(params: {
  rows: ValidatableRow[];
  existingEmails?: Set<string>;
  existingPhones?: Set<string>;
}): ValidationReport {
  const { rows, existingEmails, existingPhones } = params;

  // First occurrence wins: row 2 is clean, row 40 repeating it is the duplicate.
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();

  const out: RowValidation[] = [];
  const counts: Partial<Record<RowIssueCode, number>> = {};
  let blocking = 0;
  let warnings = 0;

  for (const row of rows) {
    const issues: RowIssue[] = [];
    const add = (code: RowIssueCode, field: RowIssue["field"], message: string, isBlocking = false) => {
      issues.push({ code, field, message, blocking: isBlocking });
      counts[code] = (counts[code] ?? 0) + 1;
    };

    const name    = row.name?.trim()    || "";
    const company = row.company?.trim() || "";
    const email   = row.email?.trim()   || "";
    const phone   = row.phone?.trim()   || "";

    // Mirrors the ingest schema's `.refine()`: any ONE of the four is enough.
    // A row with none of them carries no lead at all.
    if (!name && !company && !email && !phone) {
      add("missing_required", "row", "Row has no name, company, email or phone — nothing to import", true);
    }

    if (email) {
      if (!emailShape.safeParse(email).success) {
        add("invalid_email", "email", `"${email}" is not a valid email address`, true);
      } else {
        const key = email.toLowerCase();
        if (seenEmails.has(key)) {
          add("duplicate_email_in_file", "email", `${email} appears earlier in this file — it will be counted as skipped, not imported twice`);
        } else if (existingEmails?.has(key)) {
          add("duplicate_email_existing", "email", `${email} already exists in the CRM — it will be updated or skipped, never duplicated`);
        }
        seenEmails.add(key);
      }
    }

    if (phone) {
      const e164 = normalisePhone(phone);
      if (!e164) {
        // Not blocking: the ingest endpoint keeps unparseable phone text as-is
        // (see phoneFields) because a number missing its country code is still
        // worth a human's time. It just cannot be dialled or WhatsApp'd yet.
        add("invalid_phone", "phone", `"${phone}" has no recognisable country code — saved as text, but not dialable`);
      } else {
        if (classifyPhone(e164) === "landline") {
          add("landline_phone", "phone", `${e164} is a landline — WhatsApp outreach will skip it`);
        }
        if (seenPhones.has(e164)) {
          add("duplicate_phone_in_file", "phone", `${e164} appears earlier in this file`);
        } else if (existingPhones?.has(e164)) {
          // The honest wording matters: this one is NOT prevented downstream.
          add("duplicate_phone_existing", "phone", `${e164} already belongs to another lead — importing this row WILL create a second record`);
        }
        seenPhones.add(e164);
      }
    }

    if (issues.length === 0) continue;
    if (issues.some((i) => i.blocking)) blocking++;
    else warnings++;
    out.push({ index: row.index, issues });
  }

  return {
    total:    rows.length,
    clean:    rows.length - out.length,
    blocking,
    warnings,
    counts,
    rows:     out,
  };
}
