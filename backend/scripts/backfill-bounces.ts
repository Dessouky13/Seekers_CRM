// One-off: re-read every bounce already recorded, and finish the job on the
// ones that were only half-processed.
//
//   npx tsx scripts/backfill-bounces.ts            # report only, writes nothing
//   npx tsx scripts/backfill-bounces.ts --apply    # apply the write-backs
//
// ── Why this exists ──────────────────────────────────────────────────────
// 109 messages had been through the inbox poller and 2 were replies, yet no
// lead carried `email_status = 'bounced'` and the suppression list did not
// reflect the volume. Two causes, both now fixed in the poller itself:
//
//   1. services/inbox.ts only ever suppressed an address when the bounce ALSO
//      matched a lead row. A dead address whose lead had different casing or
//      trailing whitespace — or which had since been merged or deleted —
//      produced an event and nothing else, so the sequencer mailed it again.
//   2. services/inbox-classify.ts did not exist. Detection was a sender+subject
//      phrase list that missed Postfix's "Undelivered Mail Returned to Sender"
//      entirely, so those bounces were never even recognised as bounces.
//
// The fixes only apply to mail that arrives from now on. This script applies
// the first one retroactively, to bounces that WERE recognised and recorded but
// never retired their address. It cannot recover cause 2 — an unrecognised
// bounce was never written to `events` at all, and the mailbox is the only
// place that history still exists.
//
// ── What it can and cannot re-decide ─────────────────────────────────────
// The stored payload keeps `subject` and a truncated `preview`, not the raw
// source, so a re-classification here is strictly weaker than the live one: no
// `Status:` field to read, only the prose. That is why an event whose stored
// disposition is already set is trusted as-is and only unclassified rows are
// re-read — and why a re-read that lands on `unknown` changes nothing. An
// address is retired on proof or not at all.
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { bounceDisposition, normalizeAddress, type BounceDisposition } from "../src/services/inbox-classify";

const APPLY = process.argv.includes("--apply");

interface BounceEventRow {
  id:          string;
  lead_id:     string | null;
  subject:     string | null;
  recipient:   string | null;
  preview:     string | null;
  disposition: string | null;
  hard:        string | null;
  suppressed:  string | null;
  created_at:  Date;
}

async function main() {
  const result = await db.execute(sql`
    SELECT id,
           lead_id,
           payload->>'subject'     AS subject,
           payload->>'recipient'   AS recipient,
           payload->>'preview'     AS preview,
           payload->>'disposition' AS disposition,
           payload->>'hard'        AS hard,
           payload->>'suppressed'  AS suppressed,
           created_at
      FROM events
     WHERE type = 'bounce'
     ORDER BY created_at ASC
  `);
  const rows = (result as unknown as { rows: BounceEventRow[] }).rows;

  const tally: Record<BounceDisposition | "no_recipient", number> =
    { permanent: 0, policy: 0, transient: 0, unknown: 0, no_recipient: 0 };

  let suppressedNow = 0, leadsFlagged = 0, alreadyDone = 0, unmatchedAddress = 0;

  for (const row of rows) {
    const recipient = row.recipient ? normalizeAddress(row.recipient) : "";
    if (!recipient) { tally.no_recipient++; continue; }

    // Trust a stored disposition (written by the current poller, which had the
    // raw DSN in hand). Only re-decide the legacy rows, and only from what
    // survives in the payload.
    const disposition: BounceDisposition = isDisposition(row.disposition)
      ? row.disposition
      : row.hard === "true"
        ? "permanent"
        : bounceDisposition(row.preview ?? "", row.subject ?? "");

    tally[disposition]++;
    if (disposition !== "permanent") continue;

    if (row.suppressed === "true") { alreadyDone++; continue; }

    // Same normalisation on both sides — lower(trim(...)) on the column,
    // normalizeAddress() on the value. leads.email is stored as typed.
    const leadResult = await db.execute(sql`
      SELECT id, email_status FROM leads
       WHERE lower(trim(email)) = ${recipient}
    `);
    const leadRows = (leadResult as unknown as {
      rows: { id: string; email_status: string | null }[];
    }).rows;
    if (leadRows.length === 0) unmatchedAddress++;

    if (!APPLY) {
      suppressedNow++;
      leadsFlagged += leadRows.filter((l) => l.email_status !== "bounced").length;
      continue;
    }

    // Keyed by address and ON CONFLICT DO NOTHING, exactly as
    // services/suppressions.ts writes it — so this is idempotent and a rerun
    // costs nothing.
    await db.execute(sql`
      INSERT INTO suppressions (address, reason, source, notes)
      VALUES (${recipient}, 'hard_bounce', 'backfill-bounces',
              ${(row.preview ?? "").slice(0, 400) || null})
      ON CONFLICT (address) DO NOTHING
    `);
    suppressedNow++;

    for (const lead of leadRows) {
      if (lead.email_status === "bounced") continue;
      await db.execute(sql`
        UPDATE leads
           SET email_status = 'bounced',
               signals = COALESCE(signals, '{}'::jsonb) || ${JSON.stringify({
                 bounced_email: recipient,
                 bounced_at:    row.created_at.toISOString(),
                 bounced_via:   "backfill",
               })}::jsonb,
               updated_at = NOW()
         WHERE id = ${lead.id}
      `);
      leadsFlagged++;
    }

    // Stamp the event so a rerun can see this one is settled, and so the
    // deliverability panel stops counting it as a leak.
    await db.execute(sql`
      UPDATE events
         SET payload = payload || ${JSON.stringify({
           disposition,
           suppressed: true,
           backfilled: true,
         })}::jsonb
       WHERE id = ${row.id}
    `);
  }

  const label = APPLY ? "APPLIED" : "DRY RUN — nothing was written";
  console.log(`\n── Bounce backfill (${label}) ──\n`);
  console.log(`bounce events examined:   ${rows.length}`);
  console.log(`  permanent (dead address): ${tally.permanent}`);
  console.log(`  policy    (blocked — US): ${tally.policy}`);
  console.log(`  transient (will clear):   ${tally.transient}`);
  console.log(`  unknown   (unreadable):   ${tally.unknown}`);
  console.log(`  no recipient recorded:    ${tally.no_recipient}`);
  console.log(`\naddresses to suppress:    ${suppressedNow}`);
  console.log(`  of which match no lead: ${unmatchedAddress}  (suppressed anyway — that is the fix)`);
  console.log(`leads to flag bounced:    ${leadsFlagged}`);
  console.log(`already settled:          ${alreadyDone}`);

  if (tally.policy > 0) {
    console.log(
      `\n⚠  ${tally.policy} policy block(s). These are NOT dead addresses — the mail was\n` +
      `   rejected for sender reputation / SPF / DKIM / DMARC. Nothing here suppresses\n` +
      `   them, and nothing should: the fix is to the sending domain, not to the list.`,
    );
  }
  if (!APPLY) console.log(`\nRe-run with --apply to write these changes.`);
  process.exit(0);
}

function isDisposition(value: string | null): value is BounceDisposition {
  return value === "permanent" || value === "policy" || value === "transient" || value === "unknown";
}

main().catch((error) => { console.error(error); process.exit(1); });
