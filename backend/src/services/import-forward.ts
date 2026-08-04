// Duplicate-forward guard for the bulk-import → n8n handoff.
//
// WHY THIS EXISTS
// The importer does two things per file: it writes the leads to Postgres, and it
// hands the raw file to an n8n workflow. The database side is already
// idempotent — `planLeadImport` matches on email (or name+company) so the same
// sheet imported twice produces `Created: 0`. The n8n side is not: every POST is
// a fresh workflow execution, and whatever that workflow does (enrichment
// credits, an outbound message, a Sheets append) happens again. A double-tap on
// a phone, or a page refresh mid-request, is enough.
//
// So this remembers the SHA-256 of every file body already handed over and
// refuses a byte-identical repeat inside a time window.
//
// HONEST LIMITS — this is a guard, not a guarantee:
//   • In-process memory. It resets on every deploy and `pm2 restart`, and it is
//     per-process: it works because ecosystem.config.js runs `instances: 1`, and
//     it would silently stop working if that were ever raised to cluster mode.
//     A `lead_import_forwards` table would fix both; that needs a migration,
//     which this change deliberately does not carry.
//   • Byte-identical only. Re-saving the same sheet from Excel rewrites the zip
//     entries' timestamps, so the second export of the same data has a different
//     hash and gets through. It catches "the same file sent twice", which is the
//     actual observed failure, not "the same data sent twice".
//   • It is bypassable on purpose (`force`), because a genuinely intended resend
//     after a partial n8n failure has to be possible.
import { createHash } from "crypto";

/** How long a forwarded file is remembered. */
export const FORWARD_DEDUPE_WINDOW_MS = 30 * 60_000;

/**
 * Cap on remembered fingerprints, so a long-running process importing many
 * files cannot grow this map without bound. 500 × ~80 bytes is negligible, and
 * pruning is by age first — the cap only ever bites within a single window.
 */
const MAX_REMEMBERED = 500;

/** fingerprint → epoch ms of the forward. */
const recentForwards = new Map<string, number>();

/** SHA-256 hex of the file body. Content-addressed, so the filename is irrelevant. */
export function importFingerprint(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * How long ago this exact file was last forwarded, or null if it wasn't inside
 * the window. Returning the AGE rather than a boolean lets the API tell the user
 * "you sent this 4 minutes ago", which is the difference between a message they
 * can act on and one they'll assume is a bug.
 */
export function recentForwardAgeMs(
  fingerprint: string,
  now: number = Date.now(),
  windowMs: number = FORWARD_DEDUPE_WINDOW_MS,
): number | null {
  const at = recentForwards.get(fingerprint);
  if (at === undefined) return null;
  const age = now - at;
  if (age >= windowMs) {
    recentForwards.delete(fingerprint);   // expired: don't keep re-checking it
    return null;
  }
  return age;
}

/** Record a successful forward. Prunes expired entries on the way in. */
export function recordForward(fingerprint: string, now: number = Date.now()): void {
  for (const [fp, at] of recentForwards) {
    if (now - at >= FORWARD_DEDUPE_WINDOW_MS) recentForwards.delete(fp);
  }
  recentForwards.set(fingerprint, now);

  // Map iteration order is insertion order, so the first keys are the oldest.
  while (recentForwards.size > MAX_REMEMBERED) {
    const oldest = recentForwards.keys().next();
    if (oldest.done) break;
    recentForwards.delete(oldest.value);
  }
}

/** Test seam — the module state would otherwise leak between test cases. */
export function resetForwardMemory(): void {
  recentForwards.clear();
}
