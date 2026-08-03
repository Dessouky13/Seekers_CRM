// The list of addresses that must never be emailed again.
//
// Replaces the previous behaviour, where a hard bounce set leads.email = NULL:
// that destroyed the address, made the lead uncorrectable, and recorded nothing
// about why it had vanished. Keyed by address rather than lead id, so a shared
// info@ inbox is suppressed once no matter how many leads share it.
import { inArray, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { suppressions } from "../db/schema";

export type SuppressionReason =
  | "hard_bounce" | "spam_reject" | "complaint" | "unsubscribe" | "manual";

const norm = (a: string) => a.trim().toLowerCase();

export async function isSuppressed(address: string): Promise<boolean> {
  if (!address?.trim()) return false;
  const [row] = await db
    .select({ address: suppressions.address })
    .from(suppressions)
    .where(eq(suppressions.address, norm(address)))
    .limit(1);
  return !!row;
}

/**
 * Batch lookup. The scheduler checks a page of enrollments at once, and one
 * query beats one per lead.
 */
export async function suppressedSet(addresses: string[]): Promise<Set<string>> {
  const wanted = [...new Set(addresses.filter(Boolean).map(norm))];
  if (wanted.length === 0) return new Set();
  const rows = await db
    .select({ address: suppressions.address })
    .from(suppressions)
    .where(inArray(suppressions.address, wanted));
  return new Set(rows.map((r) => r.address));
}

export async function suppress(input: {
  address: string;
  reason:  SuppressionReason;
  source?: string;
  notes?:  string;
}): Promise<void> {
  if (!input.address?.trim()) return;
  // First reason wins: a later complaint should not overwrite the original
  // hard bounce that explains why this address died.
  await db.execute(sql`
    INSERT INTO suppressions (address, reason, source, notes)
    VALUES (${norm(input.address)}, ${input.reason}, ${input.source ?? null}, ${input.notes ?? null})
    ON CONFLICT (address) DO NOTHING
  `);
}
