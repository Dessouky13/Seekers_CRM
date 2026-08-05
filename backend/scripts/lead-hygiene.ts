// Two specific, measured data problems in the lead table — reported by default,
// applied only when asked.
//
//   npx tsx scripts/lead-hygiene.ts                       # report only
//   npx tsx scripts/lead-hygiene.ts --apply               # null placeholder emails
//   npx tsx scripts/lead-hygiene.ts --apply --delete-uncontactable
//
// ── Problem 1: placeholder emails ────────────────────────────────────────
// Some imported leads carry a synthesised `…@placeholder.local` address. It is
// not an address — it is a spreadsheet column that had to be non-empty — but
// every part of this system treats it as one: the lead reads as email-reachable,
// the sequencer will enrol it, and each send bounces or vanishes. Every one of
// these leads has a real phone number, so nulling the fake address is not a
// loss: services/channels.ts then routes them to WhatsApp or a call, which is
// how they were always going to be reached.
//
// The address is stashed in `signals.placeholder_email` first, so this is
// reversible and nothing is destroyed.
//
// ── Problem 2: leads with no way to contact them ─────────────────────────
// No email, no phone. Nothing in this CRM can act on such a row and no report
// is improved by it. Deletion is offered — but it is IRREVERSIBLE and cascades
// to activities, strikes, enrolments and sends, so it is behind its own flag,
// it refuses any lead that has recorded history, and it refuses outright if the
// number of matches is larger than expected.
//
// That last guard is not theoretical. A previous session on this database
// deleted 735 leads while demonstrating a bulk-delete flaw. A script that can
// delete rows and is run unattended must fail closed when the data does not
// look like what it was written for.
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

const APPLY              = process.argv.includes("--apply");
const DELETE_UNCONTACTED = process.argv.includes("--delete-uncontactable");

/**
 * Refuse to delete more than this many leads in one run.
 *
 * The measured count on 2026-08-05 was 7. A run that suddenly matches hundreds
 * means the premise changed — a broken import, a migration that blanked a
 * column — and the right response to that is to stop, not to delete faster.
 */
const MAX_DELETE = Number(
  process.argv.find((a) => a.startsWith("--max-delete="))?.split("=")[1] ?? 25,
);

const PLACEHOLDER_DOMAIN = "@placeholder.local";

interface PlaceholderRow {
  id: string; name: string; company: string | null;
  email: string; phone_e164: string | null;
}

interface UncontactableRow {
  id: string; name: string; company: string | null; stage: string;
  activities: number; strikes: number; enrollments: number; events: number;
}

async function main() {
  const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;

  // ── 1. Placeholder emails ──
  const placeholders = rows<PlaceholderRow>(await db.execute(sql`
    SELECT id, name, company, email, phone_e164
      FROM leads
     WHERE lower(email) LIKE ${"%" + PLACEHOLDER_DOMAIN}
     ORDER BY company NULLS LAST, name
  `));

  const withPhone    = placeholders.filter((r) => r.phone_e164);
  const withoutPhone = placeholders.filter((r) => !r.phone_e164);

  console.log(`\n── Placeholder emails (${PLACEHOLDER_DOMAIN}) ──\n`);
  console.log(`found:              ${placeholders.length}`);
  console.log(`  reachable by phone: ${withPhone.length}  (nulling the email costs nothing)`);
  console.log(`  no phone either:    ${withoutPhone.length}  (nulling leaves them uncontactable)`);
  for (const r of placeholders) {
    console.log(`  ${r.company ?? "—"} · ${r.name} · ${r.email} · ${r.phone_e164 ?? "NO PHONE"}`);
  }

  if (APPLY && placeholders.length > 0) {
    // The fake address is kept in `signals` before it is cleared. Same pattern
    // as the bounce path in services/inbox.ts: never destroy the original,
    // record why it went.
    await db.execute(sql`
      UPDATE leads
         SET signals = COALESCE(signals, '{}'::jsonb)
                       || jsonb_build_object(
                            'placeholder_email', email,
                            'placeholder_cleared_at', NOW()
                          ),
             email = NULL,
             updated_at = NOW()
       WHERE lower(email) LIKE ${"%" + PLACEHOLDER_DOMAIN}
    `);
    console.log(`\n✅ cleared ${placeholders.length} placeholder address(es) — originals kept in signals.placeholder_email`);
  }

  // ── 2. Leads with no contact channel at all ──
  //
  // Evaluated AFTER the placeholder pass, so a lead whose only "email" was a
  // placeholder and which has no phone is counted here rather than being
  // missed on this run and appearing on the next one.
  const uncontactable = rows<UncontactableRow>(await db.execute(sql`
    SELECT l.id, l.name, l.company, l.stage,
           (SELECT COUNT(*)::int FROM lead_activities a       WHERE a.lead_id = l.id) AS activities,
           (SELECT COUNT(*)::int FROM lead_strikes    s       WHERE s.lead_id = l.id) AS strikes,
           (SELECT COUNT(*)::int FROM outreach_enrollments e   WHERE e.lead_id = l.id) AS enrollments,
           (SELECT COUNT(*)::int FROM events          ev      WHERE ev.lead_id = l.id) AS events
      FROM leads l
     WHERE COALESCE(trim(l.email), '') = ''
       AND COALESCE(trim(l.phone), '') = ''
       AND l.phone_e164 IS NULL
     ORDER BY l.created_at
  `));

  const hasHistory = (r: UncontactableRow) =>
    r.activities > 0 || r.strikes > 0 || r.enrollments > 0 || r.events > 0;
  const deletable = uncontactable.filter((r) => !hasHistory(r));
  const keep      = uncontactable.filter(hasHistory);

  console.log(`\n── Leads with no email and no phone ──\n`);
  console.log(`found:            ${uncontactable.length}`);
  console.log(`  no history — deletable: ${deletable.length}`);
  console.log(`  has history — KEPT:     ${keep.length}  (deleting would erase the record of work done)`);
  for (const r of uncontactable) {
    const marks = hasHistory(r)
      ? `KEEP (${r.activities} activities, ${r.strikes} strikes, ${r.enrollments} enrolments, ${r.events} events)`
      : "deletable";
    console.log(`  ${r.company ?? "—"} · ${r.name} · ${r.stage} · ${marks}`);
  }

  if (DELETE_UNCONTACTED) {
    if (!APPLY) {
      console.log(`\n--delete-uncontactable needs --apply as well. Nothing was deleted.`);
    } else if (deletable.length === 0) {
      console.log(`\nNothing to delete.`);
    } else if (deletable.length > MAX_DELETE) {
      // Fail closed. See MAX_DELETE.
      console.error(
        `\n⛔ REFUSING: ${deletable.length} leads match, which is more than --max-delete=${MAX_DELETE}.\n` +
        `   This script expects a handful of stragglers. A number this large means the\n` +
        `   premise changed — check for a broken import or a blanked column before\n` +
        `   raising the limit.`,
      );
      process.exit(1);
    } else {
      const ids = deletable.map((r) => r.id);
      await db.execute(sql`
        DELETE FROM leads WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      `);
      console.log(`\n✅ deleted ${ids.length} uncontactable lead(s)`);
    }
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing was written. Re-run with --apply.`);
    console.log(`Add --delete-uncontactable to also delete the no-channel leads (irreversible).`);
  }
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
