import { cleanAddress, parseAddressList, readHeader, splitHeaders } from "./rfc5322";

// ── Which Sent-folder messages are manual emails — the pure decisions ────
//
// The sweep that uses these lives in services/sent-sync.ts. It is split from
// this file for the same reason worklist-ranking.ts is split from worklist.ts and
// manual-touch.ts from the route that calls it: the IMAP and database halves
// cannot be unit tested (no mail server, no database in the suite), so the rules
// that must not regress are extracted to where a test can reach them. This
// module imports nothing but rfc5322.ts, deliberately — the moment it can see
// db/client.ts, its suite stops being runnable.
//
// See sent-sync-plan.test.ts.

/**
 * How a manual email is marked in the timeline.
 *
 * `lead_activities.type` stays "email" and the marker goes in the description,
 * matching the "[Sequence] …" and "[Reply received] …" prefixes this table
 * already uses. A new type value (`"manual_email"`) was the obvious alternative
 * and is the wrong answer here on two counts:
 *
 *   1. Every CRM analytics query filters on the literal type list
 *      `('email','call','meeting','form')` — routes/crm.ts outreach-per-day,
 *      niches-contacted, sent_count and the AI message sample. A new type is
 *      silently EXCLUDED from all four, so manual sends would not count as
 *      outreach in the exact reports they belong in.
 *   2. The timeline renderer does `activityIcons[a.type] ?? FileText` and prints
 *      the raw type as the label, so an unknown type degrades to a generic
 *      document icon and the literal text "manual_email".
 *
 * The column has no CHECK constraint, so a new value would have been *possible* —
 * it just would have been invisible where it matters.
 */
export const MANUAL_EMAIL_PREFIX = "[Manual Email]";

/**
 * `events.type` for the durable "this Sent message is already in the timeline"
 * record — the second half of idempotency.
 *
 * The IMAP keyword is the primary guard, but it cannot be the only one: on a
 * server that refuses custom keywords the sweep runs with NO marker at all
 * (markerFallback: "none"), because every message in a Sent folder is already
 * `\Seen`. `events` is the append-only fact log this codebase already uses for
 * the same purpose in the bounce path, and it needs no migration.
 */
export const MANUAL_EMAIL_EVENT = "manual_email_synced";

/** Everything the import decision needs from one Sent-folder message. */
export interface SentMessageFacts {
  /** Normalised Message-ID (see normalizeMessageId). "" when the header is absent. */
  messageId:  string;
  subject:    string;
  /** Lowercased, de-duplicated To + Cc addresses, in header order. */
  recipients: string[];
}

/**
 * A Message-ID reduced to a comparable form: angle brackets stripped, internal
 * whitespace (from a folded header) removed, lowercased.
 *
 * Both sides of every comparison go through this, which is the point. The stored
 * `outreach_sends.message_id` comes from nodemailer's `info.messageId` and keeps
 * its angle brackets; imapflow's `envelope.messageId` keeps them too; a raw
 * header can additionally be folded. Lowercasing is technically lossy — RFC 5322
 * says the id is case-sensitive — but no generator in play (nodemailer's uuid,
 * Outlook, Gmail) varies an id only by case, and the only failure it could cause
 * is treating a manual email as a CRM send. That direction is the safe one: a
 * missing timeline row is recoverable, whereas a sequence email relabelled as
 * hand-written is a lie about what a human did.
 */
export function normalizeMessageId(value: string | null | undefined): string {
  if (!value) return "";
  const inner = /<([^<>]+)>/.exec(value)?.[1] ?? value;
  return inner.replace(/\s+/g, "").toLowerCase();
}

/** The imapflow ENVELOPE fields this module reads, narrowed to what it uses. */
export interface SentEnvelopeLike {
  subject?:   string | null;
  messageId?: string | null;
  to?:        readonly { address?: string | null }[] | null;
  cc?:        readonly { address?: string | null }[] | null;
}

/**
 * One Sent-folder message reduced to the facts the plan needs.
 *
 * The ENVELOPE is preferred — it is imapflow's parse of these same headers and
 * already handles MIME-encoded display names — with the raw header scan as the
 * fallback for a server that returns no ENVELOPE, or a message whose To: is
 * present in the fetched bytes but absent from the parse. Bcc is deliberately
 * not read: most servers do not keep it in the copy a client saves to Sent, and
 * a Bcc'd address is not evidence that person was written to.
 */
export function readSentMessageFacts(input: {
  raw?:      string | null;
  envelope?: SentEnvelopeLike | null;
}): SentMessageFacts {
  const raw     = input.raw ?? "";
  const headers = raw ? splitHeaders(raw) : "";

  const fromEnvelope = [...(input.envelope?.to ?? []), ...(input.envelope?.cc ?? [])]
    .map((a) => cleanAddress(a?.address ?? ""))
    .filter(Boolean);

  const recipients = fromEnvelope.length > 0
    ? fromEnvelope
    : [
        ...parseAddressList(readHeader(headers, "to")),
        ...parseAddressList(readHeader(headers, "cc")),
      ];

  return {
    messageId:  normalizeMessageId(input.envelope?.messageId ?? readHeader(headers, "message-id")),
    subject:    (input.envelope?.subject ?? readHeader(headers, "subject") ?? "").trim(),
    recipients: [...new Set(recipients)],
  };
}

// Both composite keys below join their parts with NUL rather than a printable
// separator. A subject can contain any character a human can type, and a
// Message-ID almost any printable ASCII — so any printable separator is also a
// character that can occur INSIDE a part, and two different input pairs would
// collide into one key. NUL can occur in neither. Written as an escape and not
// as a literal control byte, which makes git treat the whole file as binary.

/** Key for the weaker, retroactive CRM-send check. */
export function crmSendFingerprint(recipient: string, subject: string): string {
  return `${recipient.toLowerCase().trim()}\u0000${subject.trim().toLowerCase()}`;
}

/** Key for "this message is already in this lead's timeline". */
export function importKey(leadId: string, messageId: string): string {
  return `${leadId}\u0000${messageId}`;
}

/** The timeline description for one manual email. */
export function manualEmailDescription(recipient: string, subject: string): string {
  const trimmed = subject.trim();
  return `${MANUAL_EMAIL_PREFIX} to ${recipient}${trimmed ? ` — ${trimmed}` : ""}`.slice(0, 1000);
}

export interface StageAdvance {
  to:          "contacted";
  description: string;
}

/**
 * The stage move a manual email causes, or null for no move.
 *
 * ONE transition, `new_lead → contacted`, and the narrowness is the design.
 *
 * `new_lead` means "nobody has spoken to this person yet", and an email sent by
 * hand falsifies exactly that — so leaving the lead there made the board lie
 * about the one thing the first column asserts. It also made the New Lead
 * column useless as a work queue, because the leads already written to were
 * indistinguishable from the ones nobody had touched.
 *
 * Every LATER stage is a human judgement about where the deal stands
 * (`call_scheduled`, `proposal_sent`, `closed_won`), and a sweep reading a mail
 * folder knows nothing about that. Advancing `contacted → call_scheduled`
 * because somebody sent a second email would be the sweep inventing sales
 * progress; moving anything out of `closed_won` or `closed_lost` would be worse
 * still. So the rule only ever fires on the one stage that is a statement of
 * fact rather than a judgement, and only ever in the direction that fact points.
 */
export function manualEmailStageAdvance(stage: string | null | undefined): StageAdvance | null {
  if (stage !== "new_lead") return null;
  return {
    to:          "contacted",
    // Reads the same as the stage-change note routes/crm.ts writes on a manual
    // move, with the cause appended — the timeline should not have two
    // vocabularies for the same event.
    description: "Stage moved to contacted — email sent manually",
  };
}

export interface ManualSentPlanInput {
  messages:        readonly SentMessageFacts[];
  /** Normalised Message-IDs recorded in `outreach_sends` — the CRM's own sends. */
  crmMessageIds:   ReadonlySet<string>;
  /** crmSendFingerprint() keys for CRM sends whose Message-ID predates the email.ts fix. */
  crmFingerprints: ReadonlySet<string>;
  /** Lowercased lead address → lead id. */
  leadsByAddress:  ReadonlyMap<string, string>;
  /** importKey() values already present in `events`. */
  alreadyImported: ReadonlySet<string>;
  /** Our own mailbox addresses — a self-CC is not a lead being written to. */
  ownAddresses:    ReadonlySet<string>;
}

export interface ManualSentActivity {
  leadId:      string;
  messageId:   string;
  recipient:   string;
  subject:     string;
  description: string;
}

export interface ManualSentPlan {
  activities:   ManualSentActivity[];
  /** Messages recognised as the CRM's own Sent copies. */
  crmSends:     number;
  /** Messages skipped because nothing could prove they were not CRM sends. */
  unidentified: number;
  /** Recipient addresses that matched no lead. */
  unmatched:    number;
  /** (lead, message) pairs already in the timeline. */
  duplicates:   number;
}

/**
 * Which Sent-folder messages become timeline rows.
 *
 * One message can produce several rows — a mail to two leads is a touch on both.
 */
export function planManualSentImport(input: ManualSentPlanInput): ManualSentPlan {
  const activities: ManualSentActivity[] = [];
  let crmSends = 0, unidentified = 0, unmatched = 0, duplicates = 0;

  // Guards a batch that contains the same message twice (a double IMAP append)
  // from producing the row twice within a single run, which the database-level
  // `alreadyImported` set cannot see because nothing is committed yet.
  const plannedThisRun = new Set<string>();

  for (const message of input.messages) {
    // No Message-ID means no way to prove this is not one of our own sends, and
    // no key to record it under. Skipped rather than guessed: every real mail
    // client sets one, so the realistic cause of a missing id is a truncated or
    // malformed fetch, and importing on a guess risks writing a sequence email
    // into the timeline as a hand-written one.
    if (!message.messageId) { unidentified++; continue; }

    if (input.crmMessageIds.has(message.messageId)) { crmSends++; continue; }

    // Retroactive fallback for CRM sends whose Sent copy carries a Message-ID
    // that was never recorded. Checked across all recipients and applied to the
    // whole message: the CRM only ever sends to one address, so a hit means this
    // message IS a CRM copy, not that one of its recipients happens to match.
    if (message.recipients.some((r) => input.crmFingerprints.has(crmSendFingerprint(r, message.subject)))) {
      crmSends++;
      continue;
    }

    for (const recipient of message.recipients) {
      if (input.ownAddresses.has(recipient)) continue;

      const leadId = input.leadsByAddress.get(recipient);
      if (!leadId) { unmatched++; continue; }

      const key = importKey(leadId, message.messageId);
      if (input.alreadyImported.has(key) || plannedThisRun.has(key)) { duplicates++; continue; }
      plannedThisRun.add(key);

      activities.push({
        leadId,
        messageId:   message.messageId,
        recipient,
        subject:     message.subject,
        description: manualEmailDescription(recipient, message.subject),
      });
    }
  }

  return { activities, crmSends, unidentified, unmatched, duplicates };
}
