import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { FetchMessageObject } from "imapflow";
import { db } from "../db/client";
import { events, leadActivities, leads, outreachSends } from "../db/schema";
import { cairoToday } from "../utils/dates";
import { fireEventAsync } from "./webhooks";
import { LOOKBACK_DAYS, sweepMailbox } from "./mailbox-sweep";
import {
  MANUAL_EMAIL_EVENT,
  crmSendFingerprint,
  importKey,
  manualEmailStageAdvance,
  planManualSentImport,
  readSentMessageFacts,
  type ManualSentActivity,
  type ManualSentPlanInput,
  type SentEnvelopeLike,
  type SentMessageFacts,
} from "./sent-sync-plan";

// ── Manually sent email → lead timeline ──────────────────────────────────
//
// A lead's timeline only ever showed emails the CRM itself sent. When somebody on
// the team answered a lead from Outlook or webmail — which is what actually
// happens once a conversation gets real — the CRM had no idea, so the lead read
// as untouched: it stayed in the stale-lead digest, kept its old last_activity,
// and the Today queue went on nagging about a person who had already been
// answered.
//
// This sweep reads the SENT folder and writes those emails into the timeline. The
// decisions it applies are in sent-sync-plan.ts; this file is the IMAP and
// database plumbing around them.
//
// ── The one hard problem: our own sends are in there too ─────────────────
// services/email.ts IMAP-APPENDs every CRM send to this same Sent folder, so a
// naive sweep re-imports every sequence email as "manual". The key that tells
// them apart is `outreach_sends.message_id`, which holds the Message-ID of
// everything the CRM sends.
//
// That key only works because of a fix this feature required in email.ts:
// sendOutreachEmail() hands the message to nodemailer twice (a stream transport
// for the bytes we append, the real transport for the SMTP send) and nodemailer
// minted a SEPARATE Message-ID per call, so the id recorded in outreach_sends was
// never the id in the Sent copy of the same email. email.ts now pins one id for
// both — see the comment there, which cites the two measured ids.
//
// It follows that the Message-ID key is NOT retroactive: CRM emails sent before
// that fix have a Sent copy whose id was never recorded anywhere. Those are
// caught by a second, weaker key — (recipient, subject) against the same
// outreach_sends rows — so the first run on a live mailbox does not flood
// timelines with sequence emails relabelled as hand-written ones.

export interface SyncManualSentResult {
  /** Sent-folder messages examined this run. */
  processed: number;
  /** Timeline rows written. */
  imported:  number;
  /** Messages recognised as the CRM's own Sent copies and skipped. */
  crmSends:  number;
}

export async function syncManualSentEmails(): Promise<SyncManualSentResult> {
  const result: SyncManualSentResult = { processed: 0, imported: 0, crmSends: 0 };

  // Both are the same physical mailbox (EMAIL_FROM is the visible From:,
  // BREVO_SMTP_USER the login), and either can turn up in a self-CC.
  const ownAddresses = new Set(
    [process.env.EMAIL_FROM, process.env.BREVO_SMTP_USER]
      .map((a) => (a ?? "").toLowerCase().trim())
      .filter(Boolean),
  );

  const factsByUid = new Map<number, SentMessageFacts>();
  /** Planned rows keyed by Message-ID, drained as they are written. */
  const pending    = new Map<string, ManualSentActivity[]>();

  const processed = await sweepMailbox({
    label:   "sent",
    what:    "manual-send sweep",
    mailbox: process.env.SENT_FOLDER ?? "Sent",
    // NOT "seen": a Sent folder is entirely \Seen already (mail clients mark
    // their own sends read, and appendRawToImapSent passes \Seen explicitly), so
    // an unseen search would match nothing and this sweep would silently do
    // nothing forever. Idempotency comes from the `events` check below instead.
    markerFallback: "none",

    // One batch, one set of lookups. Per-message queries would be four round
    // trips × 25 messages every two minutes.
    onBatch: async (messages) => {
      for (const msg of messages) {
        factsByUid.set(msg.uid, readSentMessageFacts({
          raw:      msg.source?.toString("utf8"),
          envelope: msg.envelope as SentEnvelopeLike | undefined,
        }));
      }

      const facts = [...factsByUid.values()];
      const plan  = planManualSentImport({
        messages: facts,
        ownAddresses,
        ...(await loadPlanFacts(facts, ownAddresses)),
      });

      for (const activity of plan.activities) {
        const rows = pending.get(activity.messageId);
        if (rows) rows.push(activity); else pending.set(activity.messageId, [activity]);
      }
      result.crmSends = plan.crmSends;
    },

    onMessage: async (msg: FetchMessageObject) => {
      const facts = factsByUid.get(msg.uid);
      if (!facts?.messageId) return;

      const rows = pending.get(facts.messageId);
      if (!rows || rows.length === 0) return;
      // Drain before writing: two Sent messages sharing a Message-ID must not
      // write the same rows twice within one run.
      pending.delete(facts.messageId);

      for (const row of rows) {
        await writeManualEmailActivity(row);
        result.imported++;
      }
    },
  });

  result.processed = processed ?? 0;
  return result;
}

/**
 * The four set lookups the plan needs, for one batch.
 *
 * `outreach_sends` is bounded by `sent_at` rather than scanned whole: a Sent-folder
 * message inside the IMAP lookback window was appended at send time, so the CRM
 * row that produced it is inside the same window. The extra two days absorb clock
 * skew between the app server and the mail server.
 */
async function loadPlanFacts(
  facts: readonly SentMessageFacts[],
  ownAddresses: ReadonlySet<string>,
): Promise<Pick<ManualSentPlanInput, "crmMessageIds" | "crmFingerprints" | "leadsByAddress" | "alreadyImported">> {
  const messageIds = [...new Set(facts.map((f) => f.messageId).filter(Boolean))];
  const addresses  = [...new Set(
    facts.flatMap((f) => f.recipients).filter((a) => a && !ownAddresses.has(a)),
  )];

  const empty = {
    crmMessageIds:   new Set<string>(),
    crmFingerprints: new Set<string>(),
    leadsByAddress:  new Map<string, string>(),
    alreadyImported: new Set<string>(),
  };
  // No ids or no third-party recipients means nothing can be imported, so the
  // lookups would only be answering a question with no consequence.
  if (messageIds.length === 0 || addresses.length === 0) return empty;

  const since = new Date(Date.now() - (LOOKBACK_DAYS + 2) * 86_400_000);

  // An explicit IN list rather than `= ANY($1)`: Drizzle binds a JS array as a
  // single scalar parameter, which Postgres rejects as a malformed array literal.
  // Same reason and same shape as the bulk lead lookup in routes/outreach.ts.
  const idList   = sql`(${sql.join(messageIds.map((id) => sql`${id}`), sql`, `)})`;
  const addrList = sql`(${sql.join(addresses.map((a) => sql`${a}`), sql`, `)})`;

  // Normalised the same way as normalizeMessageId(): strip the angle brackets
  // nodemailer stores, lowercase. btrim only removes leading/trailing < and >.
  const storedId = sql<string>`LOWER(BTRIM(${outreachSends.messageId}, '<>'))`;

  const [crmIdRows, crmFingerprintRows, leadRows, importedRows] = await Promise.all([
    db.select({ id: storedId })
      .from(outreachSends)
      .where(and(
        isNotNull(outreachSends.messageId),
        gte(outreachSends.sentAt, since),
        inArray(storedId, messageIds),
      )),

    db.execute(sql`
      SELECT LOWER(l.email) AS address, s.subject AS subject
        FROM outreach_sends s
        JOIN outreach_enrollments e ON e.id = s.enrollment_id
        JOIN leads l                ON l.id = e.lead_id
       WHERE s.subject IS NOT NULL
         AND l.email   IS NOT NULL
         AND s.sent_at >= ${since}
         AND LOWER(l.email) IN ${addrList}`),

    // LOWER() on both sides: leads.email is stored as the operator typed it (no
    // lowercase CHECK, unlike mailboxes.address after migration 0013), so an
    // exact comparison would miss `Ahmed@Acme.com`.
    db.select({ id: leads.id, address: sql<string>`LOWER(${leads.email})` })
      .from(leads)
      .where(sql`LOWER(${leads.email}) IN ${addrList}`),

    db.execute(sql`
      SELECT lead_id AS lead_id, payload->>'message_id' AS message_id
        FROM events
       WHERE type = ${MANUAL_EMAIL_EVENT}
         AND lead_id IS NOT NULL
         AND payload->>'message_id' IN ${idList}`),
  ]);

  const fingerprintRows = rowsOf<{ address: string; subject: string }>(crmFingerprintRows);
  const importedKeyRows = rowsOf<{ lead_id: string; message_id: string }>(importedRows);

  return {
    crmMessageIds:   new Set(crmIdRows.map((r) => r.id)),
    crmFingerprints: new Set(fingerprintRows.map((r) => crmSendFingerprint(r.address, r.subject ?? ""))),
    // A Map keeps the first lead per address; two leads sharing an inbox is a
    // duplicate to merge, not a reason to log the same email twice.
    leadsByAddress:  new Map(leadRows.map((r) => [r.address, r.id] as const)),
    alreadyImported: new Set(importedKeyRows.map((r) => importKey(r.lead_id, r.message_id))),
  };
}

/** node-postgres returns { rows }; drizzle's typings for execute() are looser. */
function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] })?.rows ?? []) as T[];
}

/**
 * One manual email, written as one transaction.
 *
 * The activity, the last_activity bump and the idempotency record commit together
 * or not at all. Split apart, a crash between the activity insert and the
 * `events` insert would leave a timeline row with no record that it had been
 * imported — and the next sweep on a keyword-less server would write it again.
 */
async function writeManualEmailActivity(row: ManualSentActivity): Promise<void> {
  const today = cairoToday();

  const advance = await db.transaction(async (tx) => {
    // Read inside the transaction, because the stage decides both the patch
    // below and whether a second timeline row is written — the two must agree.
    const [before] = await tx
      .select({ stage: leads.stage })
      .from(leads)
      .where(eq(leads.id, row.leadId))
      .limit(1);

    const advance = manualEmailStageAdvance(before?.stage);

    await tx.insert(leadActivities).values([
      {
        leadId:      row.leadId,
        type:        "email" as const,
        description: row.description,
        // Cairo, not UTC: an email sent at 00:30 Cairo belongs to that morning.
        // `new Date().toISOString().slice(0,10)` would file it under yesterday.
        date:        today,
      },
      // The stage move gets its own row rather than being folded into the email
      // one. A stage change is the event people scan a timeline for, and every
      // other stage change in this CRM — manual, bulk, reply-driven, strike-driven
      // — is already its own `note`. One that hid inside an email entry would be
      // the only invisible one.
      ...(advance ? [{
        leadId:      row.leadId,
        type:        "note" as const,
        description: advance.description,
        date:        today,
      }] : []),
    ]);

    // The whole point of the feature: a lead answered by hand is not stale. Same
    // field, same helper, same shape as every other touch — the sequencer
    // (services/outreach.ts) and the manual-touch handler both do exactly this.
    //
    // The stage rides along in the SAME update, so a lead can never end up with
    // a fresh last_activity and a stale stage (or a stage-change note in its
    // timeline that no column backs up).
    await tx.update(leads)
      .set({
        lastActivity: today,
        ...(advance ? { stage: advance.to } : {}),
        updatedAt:    new Date(),
      })
      .where(eq(leads.id, row.leadId));

    await tx.insert(events).values({
      leadId:  row.leadId,
      type:    MANUAL_EMAIL_EVENT,
      source:  "sent-sync",
      payload: {
        message_id:     row.messageId,
        recipient:      row.recipient,
        subject:        row.subject || null,
        stage_advanced: advance?.to ?? null,
      },
    });

    return advance;
  });

  // Fired AFTER the transaction commits, not inside it. A webhook that went out
  // for a stage change the transaction then rolled back would be an event the
  // outside world saw and the database never did.
  if (advance) {
    fireEventAsync("lead.stage_changed", {
      lead_id:    row.leadId,
      from_stage: "new_lead",
      to_stage:   advance.to,
      reason:     "manual_email_sent",
    });
  }
}
