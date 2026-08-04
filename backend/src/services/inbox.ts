import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { events, leads, profiles } from "../db/schema";
import { handleReply } from "./outreach";
import { createNotification } from "./notifications";
import { suppress } from "./suppressions";
import { sweepMailbox } from "./mailbox-sweep";
import { cleanAddress, readAddressHeader, readHeader, splitBody, splitHeaders } from "./rfc5322";

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
}

const PREVIEW_CHARS = 500;

const BOUNCE_SENDER_RE  = /^(mailer-daemon|postmaster|no-?reply-?daemon)@/i;
const BOUNCE_SUBJECT_RE = /undeliverable|delivery status|returned mail|delivery has failed|mail delivery failed|failure notice/i;

const AUTOREPLY_SUBJECT_RE = /out of (the )?office|auto[-\s]?reply|automatic reply|autoresponder|vacation|away from my? (e-?mail|desk)/i;

export async function pollInbox(): Promise<PollInboxResult> {
  const result: PollInboxResult = { processed: 0, replies: 0, bounces: 0 };

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
      const from    = (msg.envelope?.from?.[0]?.address ?? readAddressHeader(headers, "from") ?? "")
        .toLowerCase()
        .trim();

      if (!from) return;

      // Our own address: Sent-folder copies, self-CCs, loops.
      const ownAddress = (process.env.EMAIL_FROM ?? "").toLowerCase().trim();
      if (ownAddress && from === ownAddress) return;

      if (isBounce(from, subject)) {
        await recordBounce({ raw, headers, from, subject, ownAddress });
        result.bounces++;
        return;
      }

      // Vacation responders would otherwise mark a live lead as "replied"
      // and kill their sequence.
      if (isAutoReply(headers, subject)) return;

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
async function recordBounce(args: {
  raw:        string;
  headers:    string;
  from:       string;
  subject:    string;
  ownAddress: string;
}): Promise<void> {
  const recipient = extractBouncedRecipient(args.raw, args.headers, args.ownAddress);

  let leadId: string | null = null;
  if (recipient) {
    const [lead] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(sql`LOWER(${leads.email}) = ${recipient}`)
      .limit(1);
    leadId = lead?.id ?? null;
  }

  // A HARD bounce means the address will never accept mail. Continuing to send
  // to it is the fastest way to burn the sending domain's reputation — and we
  // have already emailed dead addresses 3-4 times each. Mark the lead's email
  // as bounced so the sequencer's existing disqualification guard stops it,
  // and add a permanent suppression so it is never sent to again — instead of
  // the old `email: null`, which destroyed the address, made the lead
  // uncorrectable, and recorded nothing about why it had vanished. The
  // original is still stashed in `signals` so nothing is lost either way.
  const hard = isHardBounce(args.raw, args.subject);
  const diagnostic = extractTextPreview(args.raw);
  let suppressed = false;
  if (hard && leadId && recipient) {
    await db
      .update(leads)
      .set({
        emailStatus: "bounced",
        signals: sql`COALESCE(${leads.signals}, '{}'::jsonb) || ${JSON.stringify({
          bounced_email: recipient,
          bounced_at:    new Date().toISOString(),
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, leadId));
    await suppress({
      address: recipient,
      reason:  "hard_bounce",
      source:  "inbox_poller",
      notes:   diagnostic.slice(0, 400) || undefined,
    });
    suppressed = true;
    console.warn(`[inbox] hard bounce — suppressed address ${recipient} (lead ${leadId})`);
  }

  await db.insert(events).values({
    leadId,
    type:   "bounce",
    source: "inbox-poller",
    payload: {
      from:       args.from,
      subject:    args.subject || null,
      recipient:  recipient ?? null,
      hard,
      suppressed,
      preview:    diagnostic.slice(0, PREVIEW_CHARS) || null,
    },
  });
}

// Distinguish permanent failure from a temporary one. Only a permanent failure
// justifies retiring the address; a full mailbox or a greylisting will clear.
function isHardBounce(raw: string, subject: string): boolean {
  const hay = `${subject}\n${raw}`.toLowerCase();
  // Explicit temporary signals win — never retire on these.
  if (/\b4\.\d\.\d\b|mailbox full|quota exceeded|over quota|try again later|temporarily deferred|greylist/i.test(hay)) {
    return false;
  }
  return /\b5\.[01]\.\d\b|\b55[0-4]\b|user unknown|unknown user|no such user|does not exist|address rejected|recipient rejected|invalid recipient|mailbox unavailable|no mailbox here/i.test(hay);
}

function isBounce(from: string, subject: string): boolean {
  return BOUNCE_SENDER_RE.test(from) || BOUNCE_SUBJECT_RE.test(subject);
}

function isAutoReply(headers: string, subject: string): boolean {
  // RFC 3834 / de-facto vendor headers. Auto-Submitted: no means "a human
  // wrote this", so only anything else counts as automated.
  const autoSubmitted = readHeader(headers, "auto-submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return true;

  if (readHeader(headers, "x-autoreply")) return true;
  if (readHeader(headers, "x-autorespond")) return true;
  if (readHeader(headers, "x-auto-response-suppress")) return true;

  const precedence = readHeader(headers, "precedence")?.toLowerCase();
  if (precedence && ["auto_reply", "bulk", "junk", "list"].includes(precedence)) return true;

  return AUTOREPLY_SUBJECT_RE.test(subject);
}

// ── Bounce / preview parsing ─────────────────────────────────────────────
// The generic RFC 5322 readers this uses (splitHeaders, readHeader, …) live in
// services/rfc5322.ts, shared with the Sent-folder sweep.

// DSNs put the dead address in a machine-readable header; the free-text scan is
// the fallback for servers that only bounce a human-readable notice.
function extractBouncedRecipient(raw: string, headers: string, ownAddress: string): string | null {
  const structured = /(?:Final-Recipient|Original-Recipient|X-Failed-Recipients)\s*:\s*(?:rfc822\s*;\s*)?([^\s<>,;]+@[^\s<>,;]+)/i.exec(raw);
  if (structured) return cleanAddress(structured[1]);

  const skip = new Set([ownAddress, readAddressHeader(headers, "from")?.toLowerCase() ?? ""].filter(Boolean));
  const candidates = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

  for (const candidate of candidates) {
    const address = cleanAddress(candidate);
    if (!address) continue;
    if (skip.has(address)) continue;
    // Postmaster/daemon addresses are the bounce's author, never its victim.
    if (BOUNCE_SENDER_RE.test(address)) continue;
    return address;
  }
  return null;
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
