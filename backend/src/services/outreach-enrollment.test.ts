import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// The live-enrollment uniqueness rule is written down in three places that MUST
// agree: the TypeScript constant, the partial index in schema.ts, and migration
// 0017. They cannot import each other — Drizzle needs a SQL fragment and the
// migration is plain SQL — so this test is the thing that keeps them in sync.
//
// This is not hypothetical drift. The set was previously spelled out inline as
// just active/paused in three places, `awaiting_action` was missed in all three,
// and a lead parked on a manual WhatsApp step therefore read as "not enrolled" —
// which produced a SECOND live enrollment and re-opened the duplicate-send hole
// that once sent 142 leads up to 4 messages each.
//
// Read as text rather than imported, because importing services/outreach.ts
// pulls in the database client.

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf-8");

const outreachSrc = read("src/services/outreach.ts");
const schemaSrc = read("src/db/schema.ts");
const migrationSrc = read("src/db/migrations/0017_enrollment_live_unique.sql");

/** Pull the statuses out of a `IN ('a', 'b')` / `["a", "b"]` list. */
function statusesIn(text: string): string[] {
  return [...text.matchAll(/["']([a-z_]+)["']/g)].map((m) => m[1]).sort();
}

const EXPECTED = ["active", "awaiting_action", "paused"];

describe("LIVE_ENROLLMENT_STATUSES is the single source of truth", () => {
  it("is exactly active, paused and awaiting_action in TypeScript", () => {
    const decl = /export const LIVE_ENROLLMENT_STATUSES = \[([^\]]+)\]/.exec(outreachSrc);
    expect(decl, "LIVE_ENROLLMENT_STATUSES declaration not found").toBeTruthy();
    expect(statusesIn(decl![1])).toEqual(EXPECTED);
  });

  it("matches the partial unique index predicate in schema.ts", () => {
    const idx = /uniqueIndex\("idx_enrollments_live_unique"\)[\s\S]*?\.where\(sql`[^`]*IN \(([^)]+)\)/.exec(schemaSrc);
    expect(idx, "partial unique index not found in schema.ts").toBeTruthy();
    expect(statusesIn(idx![1])).toEqual(EXPECTED);
  });

  it("matches the index predicate in migration 0017", () => {
    const create = /CREATE UNIQUE INDEX IF NOT EXISTS "idx_enrollments_live_unique"[\s\S]*?WHERE "status" IN \(([^)]+)\)/.exec(migrationSrc);
    expect(create, "CREATE UNIQUE INDEX not found in migration 0017").toBeTruthy();
    expect(statusesIn(create![1])).toEqual(EXPECTED);
  });

  it("matches the duplicate-retirement predicate in migration 0017", () => {
    // The cleanup must consider the same set the index constrains, or the
    // migration leaves behind a duplicate the index then refuses to be created over.
    const cleanup = /WHERE e\.status IN \(([^)]+)\)/.exec(migrationSrc);
    expect(cleanup, "duplicate-retirement WHERE clause not found").toBeTruthy();
    expect(statusesIn(cleanup![1])).toEqual(EXPECTED);
  });

  it("keeps the index name identical in schema.ts, the migration and the service", () => {
    const name = "idx_enrollments_live_unique";
    expect(schemaSrc).toContain(`uniqueIndex("${name}")`);
    expect(migrationSrc).toContain(`"${name}"`);
    expect(outreachSrc).toContain(`LIVE_ENROLLMENT_UNIQUE_INDEX = "${name}"`);
  });
});

describe("migration 0017 is safe to apply", () => {
  it("creates the index idempotently", () => {
    expect(migrationSrc).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/);
  });

  it("retires duplicates rather than deleting them", () => {
    // Losing an enrollment loses its send history with it (ON DELETE CASCADE).
    expect(migrationSrc).not.toMatch(/DELETE\s+FROM\s+outreach_enrollments/i);
    expect(migrationSrc).toMatch(/UPDATE outreach_enrollments/);
  });

  it("resolves duplicates BEFORE creating the index, or the index cannot be built", () => {
    expect(migrationSrc.indexOf("UPDATE outreach_enrollments"))
      .toBeLessThan(migrationSrc.indexOf("CREATE UNIQUE INDEX"));
  });

  it("keeps the enrollment that actually sent something", () => {
    expect(migrationSrc).toMatch(/COUNT\(\*\) FROM outreach_sends[\s\S]*?DESC/);
  });
});

describe("enrollLead handles the lost race", () => {
  it("catches unique_violation specifically, not every error", () => {
    expect(outreachSrc).toContain('const PG_UNIQUE_VIOLATION = "23505"');
    expect(outreachSrc).toMatch(/code\s*!==\s*PG_UNIQUE_VIOLATION\)\s*throw err/);
  });

  it("re-reads the winner and reports alreadyEnrolled rather than failing the caller", () => {
    const tail = outreachSrc.slice(outreachSrc.indexOf("PG_UNIQUE_VIOLATION) throw err"));
    expect(tail).toMatch(/findLiveEnrollment/);
    expect(tail).toMatch(/alreadyEnrolled: true/);
  });

  it("still rethrows a 23505 that is not about a live enrollment", () => {
    const tail = outreachSrc.slice(outreachSrc.indexOf("PG_UNIQUE_VIOLATION) throw err"));
    expect(tail).toMatch(/if \(!winner\) throw err/);
  });
});
