import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { events, leads, profiles } from "../db/schema";
import { handleReply } from "./outreach";
import { createNotification } from "./notifications";
import { suppress } from "./suppressions";
import { sweepMailbox } from "./mailbox-sweep";
import { readHeader, splitBody, splitHeaders } from "./rfc5322";
import {
  bounceDisposition,
  classifyInbound,
  dsnStatusCode,
  extractBouncedRecipient,
  normalizeAddress,
  senderAddress,
  type BounceDisposition,
} from "./inbox-classify";

// ── Inbox poller ─────────────────────────────────────────────────────────
// We SEND over SMTP and APPEND to Sent over IMAP (services/email.ts), but
// nothing ever READ the mailbox — so a lead could reply and the sequencer
// would happily keep emailing them. This closes that loop: every N minutes we
// read unseen INBOX mail, classify it (bounce / auto-reply / real reply) and
// hand real replies to the existing handleReply() pipeline.
//
// The connection, marker negotiation, date bound, per-run cap and
// flag-before-process ordering all live in services/mailbox-sweep.ts, shared
// with the Sent-folder sweep in services/sent-sync.ts.

export interface PollInboxResult {
  processed: number;
  replies:   number;
  bounces:   number;
  /** Bounces that retired an address (a permanent, address-level failure). */
  suppressed: number;
  /**
   * Bounces that were a rejection of US, not of the address — sender
   * reputation, SPF/DKIM/DMARC, a content filter. Counted separately because
   * this is the number that says "the sending domain is in trouble", and it
   * must never be answered by deleting leads.
   */
  policyBlocks: number;
  /** Vacation responders and other automated mail, ignored. */
  autoReplies: number;
}

const PREVIEW_CHARS = 500;

/**
 * The mailbox's own addresses. EMAIL_FROM is the visible From:,
 * BREVO_SMTP_USER the SMTP login — either can appear in a self-CC or as the
 * originator quoted inside a DSN, and neither is ever a lead.
 */
function ownAddresses(): Set<string> {
  return new Set(
    [process.env.EMAIL_FROM, process.env.BREVO_SMTP_USER]
      .map((a) => normalizeAddress(a ?? ""))
      .filter(Boolean),
  );
}

export async function pollInbox(): Promise<PollInboxResult> {
  const result: PollInboxResult = {
    processed: 0, replies: 0, bounces: 0,
    suppressed: 0, policyBlocks: 0, autoReplies: 0,
  };
  const own = ownAddresses();

  const processed = await sweepMailbox({
    label:   "inbox",
    what:    "poller",
    mailbox: "INBOX",
    // On INBOX, unread genuinely means unhandled, so \Seen is a usable last
    // resort on a server that will not keep a custom keyword.
    markerFallback: "seen",
    onMessage: async (msg) => {
      const raw     = msg.source ? msg.source.toString("utf8") : "";
      const headers = splitHeaders(raw);
      const subject = msg.envelope?.subject ?? readHeader(headers, "subject") ?? "";
      // senderAddress(), not a hand-rolled read: the fallback path has to strip
      // the display name out of `"Mail Delivery System" <MAILER-DAEMON@host>`,
      // and getting that wrong breaks the bounce test and the own-address check
      // silently. See its comment in inbox-classify.ts.
      const from    = senderAddress(msg.envelope?.from?.[0]?.address, headers);

      if (!from) return;

      // Our own address: Sent-folder copies, self-CCs, loops.
      if (own.has(from)) return;

      // Bounce / auto-reply / human — all three decided in one place, by
      // services/inbox-classify.ts. Bounce is tested first there because every
      // DSN carries Auto-Submitted, so the other order silently discarded them.
      const kind = classifyInbound({ from, subject, headers, raw });

      if (kind === "bounce") {
        const outcome = await recordBounce({ raw, headers, from, subject, own });
        result.bounces++;
        if (outcome === "permanent") result.suppressed++;
        if (outcome === "policy")    result.policyBlocks++;
        return;
      }

      // Vacation responders would otherwise mark a live lead as "replied"
      // and kill their sequence.
      if (kind === "auto_reply") { result.autoReplies++; return; }

      const preview = extractTextPreview(raw);

      // All the real work (pause enrollments, log activity, advance stage,
      // fire lead.replied webhook) already lives in outreach.handleReply.
      const reply = await handleReply({
        fromEmail:   from,
        subject:     subject || null,
        bodyPreview: preview || null,
      });

      if (!reply.matched || !reply.leadId) return;
      result.replies++;

      await notifyReply(reply.leadId, subject, preview);
    },
  });

  result.processed = processed ?? 0;
  return result;
}

// ── Notify the humans ────────────────────────────────────────────────────
// Assignee owns the lead; an unassigned lead is everyone's problem, so it goes
// to the admins rather than silently to nobody.
async function notifyReply(leadId: string, subject: string, preview: string): Promise<void> {
  const [lead] = await db
    .select({ id: leads.id, name: leads.name, company: leads.company, assigneeId: leads.assigneeId })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!lead) return;

  const recipients: string[] = [];
  if (lead.assigneeId) {
    recipients.push(lead.assigneeId);
  } else {
    const admins = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.role, "admin"));
    recipients.push(...admins.map((a) => a.id));
  }

  const body = [subject ? `Subject: ${subject}` : null, preview || null]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 1000);

  for (const userId of recipients) {
    await createNotification({
      userId,
      type:  "lead_replied",
      title: `Reply from ${lead.name}${lead.company ? ` (${lead.company})` : ""}`,
      body:  body || null,
      link:  `/crm?lead=${lead.id}`,
    });
  }
}

// ── Bounce handling ──────────────────────────────────────────────────────
// The bounce arrives FROM the postmaster, so the interesting address is the
// original recipient buried in the DSN — that's the one to attach to a lead.
//
// Returns the disposition so the caller can count permanents and policy blocks
// apart. See services/inbox-classify.ts for why those two must never be merged.
async function recordBounce(args: {
  raw:     string;
  headers: string;
  from:    string;
  subject: string;
  own:     ReadonlySet<string>;
}): Promise<BounceDisposition> {
  const recipient = extractBouncedRecipient(args.raw, args.headers, args.own);

  let leadId: string | null = null;
  if (recipient) {
    // lower(trim(...)) on the column, not LOWER() alone. leads.email is stored
    // as the operator typed it — no lowercase CHECK, and imports have carried
    // trailing spaces — and services/suppressions.ts normalises the same way.
    // Three places compare these strings and all three must agree, or the
    // suppression silently fails to match the lead it is about.
    const [lead] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(sql`lower(trim(${leads.email})) = ${recipient}`)
      .limit(1);
    leadId = lead?.id ?? null;
  }

  const disposition = bounceDisposition(args.raw, args.subject);
  const diagnostic  = extractTextPreview(args.raw);
  const status      = dsnStatusCode(args.raw);

  // A PERMANENT bounce means the address will never accept mail. Continuing to
  // send to it is the fastest way to burn the sending domain's reputation.
  //
  // The suppression is NOT conditional on a lead being matched. It used to be,
  // and that was the hole: a dead address whose lead row had different
  // whitespace or casing — or which had since been reassigned, merged or
  // deleted — produced a bounce event and nothing else, so the very next
  // sequence run mailed it again. Suppression is keyed by address precisely so
  // it does not need a lead; the lead write-back is the extra step that needs
  // one, not the other way round.
  let suppressed = false;
  if (disposition === "permanent" && recipient) {
    await suppress({
      address: recipient,
      reason:  "hard_bounce",
      source:  "inbox_poller",
      notes:   diagnostic.slice(0, 400) || undefined,
    });
    suppressed = true;

    if (leadId) {
      // Marks the lead's email bounced so the sequencer's existing
      // disqualification guard stops it — instead of the old `email: null`,
      // which destroyed the address and recorded nothing about why. The
      // original is stashed in `signals` either way.
      await db
        .update(leads)
        .set({
          emailStatus: "bounced",
          signals: sql`COALESCE(${leads.signals}, '{}'::jsonb) || ${JSON.stringify({
            bounced_email:  recipient,
            bounced_at:     new Date().toISOString(),
            bounced_status: status,
          })}::jsonb`,
          updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId));
    }
    console.warn(
      `[inbox] permanent bounce — suppressed ${recipient}` +
      `${leadId ? ` (lead ${leadId})` : " (no matching lead)"}${status ? ` status ${status}` : ""}`,
    );
  }

  // A rejection of US, not of them. Loud in the log and recorded as an event,
  // but the address is left alone: suppressing on a reputation problem would
  // delete the reachable half of the list at exactly the moment the domain
  // needed those leads most. GET /outreach/deliverability is where this number
  // is meant to be read.
  if (disposition === "policy") {
    console.warn(
      `[inbox] policy block (NOT a dead address) for ${recipient ?? "unknown recipient"}` +
      `${status ? ` status ${status}` : ""} — check sender reputation / SPF / DKIM / DMARC`,
    );
  }

  await db.insert(events).values({
    leadId,
    type:   "bounce",
    source: "inbox-poller",
    payload: {
      from:        args.from,
      subject:     args.subject || null,
      recipient:   recipient ?? null,
      disposition,
      dsn_status:  status,
      // Kept for the events written before dispositions existed, and because
      // the deliverability read-model and the backfill both still read it.
      hard:        disposition === "permanent",
      suppressed,
      preview:     diagnostic.slice(0, PREVIEW_CHARS) || null,
    },
  });

  return disposition;
}

// Best-effort plaintext preview: pick the text/plain leaf of a multipart body,
// undo the transfer encoding, strip any HTML, collapse whitespace.
function extractTextPreview(raw: string): string {
  const headers = splitHeaders(raw);
  const body    = splitBody(raw);
  if (!body) return "";

  const contentType = readHeader(headers, "content-type") ?? "text/plain";
  const boundary    = /boundary\s*=\s*"?([^";\r\n]+)"?/i.exec(contentType)?.[1];

  let partHeaders = headers;
  let partBody    = body;

  if (/multipart\//i.test(contentType) && boundary) {
    const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    // Prefer text/plain; fall back to the first part with any content (which
    // for a text/html-only email is the HTML we then strip below).
    const chosen =
      parts.find((p) => /content-type\s*:\s*text\/plain/i.test(splitHeaders(p))) ??
      parts.find((p) => splitBody(p).trim().length > 0);
    if (chosen) {
      partHeaders = splitHeaders(chosen);
      partBody    = splitBody(chosen);
    }
  }

  const encoding = (readHeader(partHeaders, "content-transfer-encoding") ?? "").toLowerCase();
  let text = partBody;

  if (encoding === "base64") {
    // The source fetch is byte-capped, so the tail is very likely a partial
    // quantum — trim to a whole group of 4 before decoding.
    const compact = text.replace(/[^A-Za-z0-9+/=]/g, "");
    text = Buffer.from(compact.slice(0, compact.length - (compact.length % 4)), "base64").toString("utf8");
  } else if (encoding === "quoted-printable") {
    // Decode to BYTES first, then to utf8 — a =E2=80=94 em-dash is three
    // escapes that only form one character once reassembled as a buffer.
    const unfolded = text.replace(/=\r?\n/g, "");
    const bytes: number[] = [];
    for (let i = 0; i < unfolded.length; i++) {
      const hex = unfolded[i] === "=" ? unfolded.slice(i + 1, i + 3) : null;
      if (hex && /^[0-9A-F]{2}$/i.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
      } else {
        bytes.push(...Buffer.from(unfolded[i], "utf8"));
      }
    }
    text = Buffer.from(bytes).toString("utf8");
  }

  const partType = readHeader(partHeaders, "content-type") ?? "";
  if (/text\/html/i.test(partType) || (!/text\/plain/i.test(partType) && /<\/?[a-z][\s\S]*>/i.test(text))) {
    text = text
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'");
  }

  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, PREVIEW_CHARS);
}
