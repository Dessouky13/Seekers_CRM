import { ImapFlow, type FetchMessageObject } from "imapflow";

// ── Shared IMAP sweep mechanics ──────────────────────────────────────────
//
// Two sweeps read this mailbox for two different reasons — pollInbox()
// (services/inbox.ts) reads INBOX for replies and bounces, syncManualSentEmails()
// (services/sent-sync.ts) reads Sent for emails a human sent outside the CRM —
// but the mechanics are identical: the same host/credential pair, the same
// "have I already handled this one?" marker negotiation, the same date bound,
// the same per-run cap and the same flag-before-process ordering.
//
// That mechanism lives here once. It was extracted from pollInbox() rather than
// copied, so the newer Sent sweep cannot quietly drift from the INBOX sweep it
// was modelled on — and so a fix to the marker negotiation lands on both.

/**
 * Cap per run so a mailbox with a big backlog can't stall the sweep (or fire
 * hundreds of notifications) on the first tick.
 */
export const MAX_PER_RUN = 25;

/**
 * Custom IMAP keyword used as the "already handled" marker, so we never have to
 * touch the mailbox owner's read/unread state. See the note in sweepMailbox().
 */
export const PROCESSED_KEYWORD = "SeekersProcessed";

/**
 * Ignore anything older than this. Bounds the very first run on a mailbox with a
 * large history, and both replies and same-week manual sends are only relevant
 * while fresh anyway. One knob for both sweeps on purpose: two windows would
 * mean two different definitions of "recent mail" on one mailbox.
 */
export const LOOKBACK_DAYS = Number(process.env.INBOX_LOOKBACK_DAYS ?? 14);

/**
 * Headers are small; the body chunk only feeds a short preview and address
 * extraction, so there is no reason to pull whole (attachment-laden) messages.
 */
export const MAX_SOURCE_BYTES = 32 * 1024;

/** One warning per sweep per process — see the note in sweepMailbox(). */
const warnedNoCreds = new Set<string>();

export interface ImapCreds {
  host: string;
  port: number;
  user: string;
  pass: string;
}

/**
 * The one credential pair this mailbox has. Same shape as
 * appendRawToImapSent() in services/email.ts — we send and read as the same user.
 */
export function imapCreds(): ImapCreds | null {
  const user = process.env.BREVO_SMTP_USER;
  const pass = process.env.BREVO_SMTP_PASS;
  if (!user || !pass) return null;
  return {
    host: process.env.IMAP_HOST ?? "mail.privateemail.com",
    port: Number(process.env.IMAP_PORT ?? 993),
    user,
    pass,
  };
}

export interface MailboxSweepOptions {
  /** Log prefix, e.g. "inbox" / "sent". Also the warn-once key. */
  label:   string;
  /** What is disabled in the no-credentials warning, e.g. "poller". */
  what:    string;
  /** Mailbox to open, e.g. "INBOX". */
  mailbox: string;
  /**
   * What to do when the server refuses to persist a custom keyword.
   *
   *   "seen" — mark handled messages `\Seen` and search `unseen since`. Correct
   *            for INBOX, where unread genuinely means unhandled.
   *   "none" — no marker at all; search the whole date window every run. For a
   *            SENT folder, where every message already arrives `\Seen` (mail
   *            clients mark their own sends read, and our own IMAP append passes
   *            `\Seen` explicitly), so an unseen search would match nothing and
   *            the sweep would silently never import anything. A caller choosing
   *            this MUST be idempotent on its own — see sent-sync.ts.
   */
  markerFallback: "seen" | "none";
  /**
   * The whole fetched batch, before any of it is flagged or processed. Exists so
   * a caller can do its per-batch database lookups in one round trip instead of
   * one per message. Throwing here aborts the run without flagging anything.
   */
  onBatch?:  (messages: FetchMessageObject[]) => Promise<void>;
  /** One message. Throwing is contained — it never aborts the rest of the batch. */
  onMessage: (message: FetchMessageObject) => Promise<void>;
}

/**
 * Run one sweep over one mailbox.
 *
 * Returns the number of messages flagged and handed to `onMessage`, or `null`
 * when there are no credentials — callers turn that into their own zero result
 * rather than throwing, because these sweeps run on a timer and a dev machine
 * with no mail configured must not spew stack traces every two minutes.
 */
export async function sweepMailbox(opts: MailboxSweepOptions): Promise<number | null> {
  const creds = imapCreds();
  if (!creds) {
    // Warned once per process: this runs every couple of minutes and would
    // otherwise fill the log forever on an unconfigured machine.
    if (!warnedNoCreds.has(opts.label)) {
      warnedNoCreds.add(opts.label);
      console.warn(`[${opts.label}] ${opts.what} disabled — no IMAP creds (BREVO_SMTP_USER / BREVO_SMTP_PASS)`);
    }
    return null;
  }

  const client = new ImapFlow({
    host:   creds.host,
    port:   creds.port,
    secure: true,
    auth:   { user: creds.user, pass: creds.pass },
    logger: false,
  });

  let processed = 0;

  try {
    await client.connect();
    // Read-write: we need to write our idempotency marker.
    const mailbox = await client.mailboxOpen(opts.mailbox);

    // ── Idempotency marker ────────────────────────────────────────────
    // Prefer a CUSTOM keyword over \Seen. This mailbox is a real human mailbox,
    // not a robot drop-box: marking every unread message as read would silently
    // clear the owner's unread state on mail that has nothing to do with leads.
    // A custom keyword is invisible in normal mail clients and leaves read/
    // unread untouched. Most IMAP servers (Dovecot, which Namecheap PE runs)
    // advertise `\*` in PERMANENTFLAGS meaning "custom keywords allowed".
    // If this server doesn't, fall back per `markerFallback` — correctness beats
    // tidiness, because without *some* marker (or a caller that dedupes in the
    // database) we would re-handle the same mail on every sweep forever.
    const permanent = (mailbox as { permanentFlags?: Set<string> | string[] }).permanentFlags;
    const permanentList = permanent ? Array.from(permanent as Iterable<string>) : [];
    const supportsKeywords = permanentList.includes("\\*") || permanentList.includes(PROCESSED_KEYWORD);

    const marker: string | null = supportsKeywords
      ? PROCESSED_KEYWORD
      : opts.markerFallback === "seen" ? "\\Seen" : null;

    // Only look at recent mail. Without a date bound, a mailbox with years of
    // archived messages would return thousands of unmarked UIDs and the sweep
    // would crawl through ancient history 25 at a time.
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    const criteria = supportsKeywords
      ? { unKeyword: PROCESSED_KEYWORD, since }
      : marker === "\\Seen" ? { seen: false, since }
      : { since };

    const pending = await client.search(criteria, { uid: true });
    if (!pending || pending.length === 0) return processed;

    // With a marker, oldest-first: handled mail drops out of the search, so the
    // tail beyond the cap is picked up next tick and events land in the lead
    // timeline in the order they actually happened.
    //
    // WITHOUT a marker, oldest-first would return the same first 25 UIDs on
    // every single run and never reach anything newer — the sweep would be
    // permanently stuck at the start of the window. Newest-first keeps up with
    // what just happened, at the cost of a backlog deeper than the cap in one
    // window being missed.
    const uids = marker ? pending.slice(0, MAX_PER_RUN) : pending.slice(-MAX_PER_RUN);

    // Drain the whole fetch before issuing any other IMAP command — running
    // STORE mid-iteration on an open fetch is not safe with ImapFlow.
    const messages = await client.fetchAll(
      uids,
      { uid: true, envelope: true, source: { maxLength: MAX_SOURCE_BYTES } },
      { uid: true },
    );

    if (opts.onBatch) await opts.onBatch(messages);

    for (const msg of messages) {
      try {
        // Flag FIRST, process second. If a message somehow makes the handler
        // throw, we lose one message — but we never re-handle it on every sweep
        // for the rest of time, which is the worse failure.
        if (marker) await client.messageFlagsAdd([msg.uid], [marker], { uid: true });
        processed++;

        await opts.onMessage(msg);
      } catch (err) {
        // One malformed message must never abort the rest of the batch.
        console.error(`[${opts.label}] failed to process uid=${msg.uid}:`, (err as Error)?.message ?? err);
      }
    }

    return processed;
  } finally {
    try { await client.logout(); } catch { /* connection already gone */ }
  }
}
