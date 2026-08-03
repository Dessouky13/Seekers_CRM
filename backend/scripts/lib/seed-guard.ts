// One shared safety gate for every script that writes fictional data.
//
// This exists because the guard was duplicated and drifted. `seed.ts` had no
// guard at all, and `seed-dev.ts` had only a "host must be localhost" check —
// which is TRUE on the production VPS, because production's DATABASE_URL is
// `postgresql://seekers:…@localhost:5432/seekersai`. Running seed-dev on the
// server would therefore have passed its own check and then reset the passwords
// of all three real accounts (it upserts `password = EXCLUDED.password`) and
// mixed fictional clients, leads and revenue into live P&L reporting.
//
// Any new seed/demo/fixture script must call `assertSafeToSeed()` before its
// first write. Import it rather than re-implementing the checks.
import { Client } from "pg";

export interface SeedGuardOptions {
  /** Shown in the refusal message so the operator knows what was blocked. */
  scriptName: string;
}

/**
 * Throws unless this is unmistakably a throwaway local database.
 *
 * Three independent checks, because each alone is escapable:
 *   1. host is loopback        — but production's URL is loopback too, so:
 *   2. NODE_ENV is not production
 *   3. the database holds no business records — a loopback host can still be a
 *      restored production dump, which is the case the hostname check misses.
 */
export async function assertSafeToSeed(opts: SeedGuardOptions): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`${opts.scriptName}: DATABASE_URL is not set.`);

  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(
      `${opts.scriptName}: refusing to run — DATABASE_URL host is "${host}", not loopback.`,
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(`${opts.scriptName}: refusing to run — NODE_ENV=production.`);
  }

  // The check the hostname cannot make: is there real data here?
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ leads: number; clients: number; txns: number; profiles: number }>(`
      SELECT (SELECT COUNT(*) FROM leads)::int        AS leads,
             (SELECT COUNT(*) FROM clients)::int      AS clients,
             (SELECT COUNT(*) FROM transactions)::int AS txns,
             (SELECT COUNT(*) FROM profiles)::int     AS profiles
    `);
    const r = rows[0];
    const populated = r.leads > 0 || r.clients > 0 || r.txns > 0;

    if (populated && process.env.SEED_ALLOW_NON_EMPTY !== "yes") {
      throw new Error(
        `${opts.scriptName}: refusing to run — this database already holds business records ` +
        `(${r.leads} leads, ${r.clients} clients, ${r.txns} transactions, ${r.profiles} profiles).\n` +
        `Seeding would mix fictional data into it and may overwrite real credentials.\n` +
        `If this is genuinely a throwaway local database, re-run with SEED_ALLOW_NON_EMPTY=yes.`,
      );
    }
  } finally {
    await client.end();
  }
}
