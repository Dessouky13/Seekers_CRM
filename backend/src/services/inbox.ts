import { ImapFlow } from "imapflow";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { events, leads, profiles } from "../db/schema";
import { handleReply } from "./outreach";
import { createNotification } from "./notifications";
import { suppress } from "./suppressions";

// ── Inbox poller ─────────────────────────────────────────────────────────
// We SEND over SMTP and APPEND to Sent over IMAP (services/email.ts), but
// nothing ever READ the mailbox — so a lead could reply and the sequencer
// would happily keep emailing them. This closes that loop: every N minutes we
// read unseen INBOX mail, classify it (bounce / auto-reply / real reply) and
// hand real replies to the existing handleReply() pipeline.

export interface PollInboxResult {
  processed: number;
  replies:   number;
  bounces:   number;
}

// Cap per run so a mailbox with a big unread backlog can't stall the sweep
// (or fire hundreds of notifications) on the first tick.
const MAX_PER_RUN = 25;
const PREVIEW_CHARS = 500;
// Custom IMAP keyword used as our "already handled" marker, so we never have
// to touch the mailbox owner's read/unread state. See the note in pollInbox().
const PROCESSED_KEYWORD = "SeekersProcessed";
// Ignore anything older than this. Bounds the very first run on a mailbox with
// a large history, and outreach replies are only relevant while fresh anyway.
const LOOKBACK_DAYS = Number(process.env.INBOX_LOOKBACK_DAYS ?? 14);
// Headers are small; the body chunk only feeds a 500-char preview and bounce
// address extraction, so there's no reason to pull whole (attachment-laden)
// messages down.
const MAX_SOURCE_BYTES = 32 * 1024;

// The creds warning is logged once per process — this sweep runs every couple
// of minutes and would otherwise spam the logs forever on a dev machine.
let warnedNoCreds = false;

const BOUNCE_SENDER_RE  = /^(mailer-daemon|postmaster|no-?reply-?daemon)@/i;
const BOUNCE_SUBJECT_RE = /undeliverable|delivery status|returned mail|delivery has failed|mail delivery failed|failure notice/i;

const AUTOREPLY_SUBJECT_RE = /out of (the )?office|auto[-\s]?reply|automatic reply|autoresponder|vacation|away from my? (e-?mail|desk)/i;

export async function pollInbox(): Promise<PollInboxResult> {
  const result: PollInboxResult = { processed: 0, replies: 0, bounces: 0 };

  // Same connection shape as appendRawToImapSent() in services/email.ts —
  // one mailbox, one credential pair for both send and read.
  const host = process.env.IMAP_HOST ?? "mail.privateemail.com";
  const port = Number(process.env.IMAP_PORT ?? 993);
  const user = process.env.BREVO_SMTP_USER;
  const pass = process.env.BREVO_SMTP_PASS;

  if (!user || !pass) {
    if (!warnedNoCreds) {
      warnedNoCreds = true;
      console.warn("[inbox] poller disabled — no IMAP creds (BREVO_SMTP_USER / BREVO_SMTP_PASS)");
    }
    return result;
  }

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    // Read-write: we need to write our idempotency marker.
    const mailbox = await client.mailboxOpen("INBOX");

    // ── Idempotency marker ────────────────────────────────────────────
    // Prefer a CUSTOM keyword over \Seen. This mailbox is a real human inbox,
    // not a robot drop-box: marking every unread message as read would silently
    // clear the owner's unread state on mail that has nothing to do with leads.
    // A custom keyword is invisible in normal mail clients and leaves read/
    // unread untouched. Most IMAP servers (Dovecot, which Namecheap PE runs)
    // advertise `\*` in PERMANENTFLAGS meaning "custom keywords allowed".
    // If this server doesn't, fall back to \Seen — correctness beats tidiness,
    // because without *some* marker we would re-notify on every sweep forever.
    const permanent = (mailbox as { permanentFlags?: Set<string> | string[] }).permanentFlags;
    const permanentList = permanent ? Array.from(permanent as Iterable<string>) : [];
    const supportsKeywords = permanentList.includes("\\*") || permanentList.includes(PROCESSED_KEYWORD);
    const marker = supportsKeywords ? PROCESSED_KEYWORD : "\\Seen";

    // Only look at recent mail. Without a date bound, an inbox with years of
    // archived messages would return thousands of unmarked UIDs and the poller
    // would crawl through ancient history 25 at a time.
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    const criteria = supportsKeywords
      ? { unKeyword: PROCESSED_KEYWORD, since }
      : { seen: false, since };

    const pending = await client.search(criteria, { uid: true });
    if (!pending || pending.length === 0) return result;

    // Oldest-first so replies land in the lead timeline in the order they
    // actually arrived; the tail beyond the cap is picked up next tick.
    const uids = pending.slice(0, MAX_PER_RUN);

    // Drain the whole fetch before issuing any other IMAP command — running
    // STORE mid-iteration on an open fetch is not safe with ImapFlow.
    const messages = await client.fetchAll(
      uids,
      { uid: true, envelope: true, source: { maxLength: MAX_SOURCE_BYTES } },
      { uid: true },
    );

    for (const msg of messages) {
      try {
        // Flag FIRST, process second. If a message somehow makes the handler
        // throw, we lose one reply — but we never re-notify on every sweep
        // for the rest of time, which is the worse failure.
        await client.messageFlagsAdd([msg.uid], [marker], { uid: true });
        result.processed++;

        const raw     = msg.source ? msg.source.toString("utf8") : "";
        const headers = splitHeaders(raw);
        const subject = msg.envelope?.subject ?? readHeader(headers, "subject") ?? "";
        const from    = (msg.envelope?.from?.[0]?.address ?? readAddressHeader(headers, "from") ?? "")
          .toLowerCase()
          .trim();

        if (!from) continue;

        // Our own address: Sent-folder copies, self-CCs, loops.
        const ownAddress = (process.env.EMAIL_FROM ?? "").toLowerCase().trim();
        if (ownAddress && from === ownAddress) continue;

        if (isBounce(from, subject)) {
          await recordBounce({ raw, headers, from, subject, ownAddress });
          result.bounces++;
          continue;
        }

        // Vacation responders would otherwise mark a live lead as "replied"
        // and kill their sequence.
        if (isAutoReply(headers, subject)) continue;

        const preview = extractTextPreview(raw);

        // All the real work (pause enrollments, log activity, advance stage,
        // fire lead.replied webhook) already lives in outreach.handleReply.
        const reply = await handleReply({
          fromEmail:   from,
          subject:     subject || null,
          bodyPreview: preview || null,
        });

        if (!reply.matched || !reply.leadId) continue;
        result.replies++;

        await notifyReply(reply.leadId, subject, preview);
      } catch (err) {
        // One malformed message must never abort the rest of the batch.
        console.error(`[inbox] failed to process uid=${msg.uid}:`, (err as Error)?.message ?? err);
      }
    }

    return result;
  } finally {
    try { await client.logout(); } catch { /* connection already gone */ }
  }
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

// ── Raw message helpers ──────────────────────────────────────────────────
// Deliberately hand-rolled: mailparser is not a dependency and we only need a
// sender, a subject and a short human-readable preview.

function splitHeaders(raw: string): string {
  const end = raw.search(/\r?\n\r?\n/);
  return end === -1 ? raw : raw.slice(0, end);
}

function splitBody(raw: string): string {
  const match = /\r?\n\r?\n/.exec(raw);
  return match ? raw.slice(match.index + match[0].length) : "";
}

// Unfolds RFC 5322 continuation lines before matching, so a header wrapped
// across lines still reads as one value.
function readHeader(headers: string, name: string): string | null {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.*)$`, "im");
  const m = re.exec(unfolded);
  return m ? m[1].trim() : null;
}

function readAddressHeader(headers: string, name: string): string | null {
  const value = readHeader(headers, name);
  if (!value) return null;
  const angle = /<([^<>]+@[^<>]+)>/.exec(value);
  if (angle) return angle[1].trim();
  const bare = /([^\s<>,;:"]+@[^\s<>,;:"]+)/.exec(value);
  return bare ? bare[1].trim() : null;
}

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

function cleanAddress(value: string): string {
  return value.replace(/^[<"'\s]+|[>"'\s.,;:]+$/g, "").toLowerCase();
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
