// Pure lead-import decision logic: no DB, no I/O. Shared by the single-lead
// ingest endpoint and the bulk importer (CSV/paste), so the one dedupe rule
// cannot drift between the two paths.
//
// The important property this file exists to guarantee: importing the same
// sheet twice must not create duplicates. That guarantee lives entirely in
// `planLeadImport`, which is why it takes plain data in (rows + whatever
// already exists in the DB, pre-fetched by the caller) and returns a plan —
// no query inside it, so it is trivially unit-testable and the same function
// can be asserted against twice in a row to prove idempotency.

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
