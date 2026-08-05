// What one inbound message IS — the pure decisions behind the inbox poller.
//
// Split from services/inbox.ts for the reason sent-sync-plan.ts is split from
// sent-sync.ts: the IMAP and database halves cannot be unit tested (no mail
// server, no database in the suite), so the rules that must not regress are
// extracted to where a test can reach them. This module imports only
// rfc5322.ts — the moment it can see db/client.ts its suite stops being
// runnable. See inbox-classify.test.ts.
//
// ── Why this was extracted ───────────────────────────────────────────────
// The classification lived inline as two unexported regex constants, and it
// was wrong in a way nothing could catch. `BOUNCE_SUBJECT_RE` held
// "undeliverable" and "returned mail" — and Postfix, which is what most of the
// world bounces with, writes "Undelivered Mail Returned to Sender". That
// matches NEITHER. Every Postfix bounce fell through to handleReply(), where
// the mailer-daemon From: matched no lead, so it was silently dropped: no
// suppression, no email_status, no event. The sequencer went on mailing the
// dead address, which is the one failure mode that actually damages a sending
// domain's reputation.
//
// The fix is not a longer phrase list — no list enumerates every MTA's wording
// in every language. It is to test the STRUCTURE first: RFC 3464 says a
// delivery status notification is a `multipart/report; report-type=
// delivery-status`, and that is true of every DSN regardless of who wrote it.
// The phrase list stays as the fallback for servers that only send a
// human-readable notice.
import { readAddressHeader, readHeader, splitHeaders } from "./rfc5322";

/** One inbound message, reduced to what a classification needs. */
export interface InboundMessage {
  /** Lowercased envelope/From address. */
  from:    string;
  subject: string;
  /** The raw header block (see rfc5322.splitHeaders). */
  headers: string;
  /** The full raw source as fetched. May be byte-truncated. */
  raw:     string;
}

export type InboundKind = "bounce" | "auto_reply" | "reply";

/**
 * What may be done to the recipient address as a result of this bounce.
 *
 * The three-way split is the point, and `policy` is the reason it exists.
 *
 *   permanent — the ADDRESS is dead (no such user, domain does not resolve).
 *               Retire it: suppress, and mark the lead's email bounced.
 *   policy    — the message was REJECTED, but the address is fine. 5.7.x is
 *               "blocked": sender reputation, SPF/DKIM/DMARC, content filter.
 *               This is a fact about US. Suppressing on it would delete the
 *               reachable half of the list to punish our own domain, and would
 *               do it fastest at exactly the moment a reputation problem
 *               started — turning one bad day into permanent data loss.
 *   transient — deferral, full mailbox, greylisting. Clears by itself.
 *   unknown   — nothing readable. Deliberately NOT lumped in with permanent:
 *               retiring an address must be proven, never assumed.
 */
export type BounceDisposition = "permanent" | "policy" | "transient" | "unknown";

// Kept as a fallback for notices that carry no DSN structure at all. Ordered
// nothing like a priority list — any hit is enough.
//
// "undelivered mail returned to sender" is Postfix's, and its absence was the
// original bug. "delivery status notification" is Gmail's and Microsoft's;
// "undeliverable" is Exchange's prefix form.
const BOUNCE_SUBJECT_RE = new RegExp([
  "undeliverable",
  "undelivered mail",
  "returned to sender",
  "returned mail",
  "delivery status notification",
  "delivery (has )?failed",
  "delivery failure",
  "delivery incomplete",
  "mail delivery (failed|system)",
  "failure notice",
  "message not delivered",
  "could ?n[o']t be delivered",
  "unable to deliver",
].join("|"), "i");

const BOUNCE_SENDER_RE = /^(mailer-daemon|postmaster|no-?reply-?daemon|bounce[sd]?(-|@)|[^@]*-bounces@)/i;

const AUTOREPLY_SUBJECT_RE =
  /out of (the )?office|auto[-\s]?reply|automatic reply|autoresponder|vacation|away from my? (e-?mail|desk)/i;

/**
 * True when the message is an RFC 3464 delivery status notification.
 *
 * Three independent structural signals, because the raw source is byte-capped
 * by the IMAP fetch and any one of them can fall outside the window:
 *
 *   1. `Content-Type: multipart/report; report-type=delivery-status` — the
 *      definitive top-level marker. `report-type` may sit on a folded
 *      continuation line, so the whole header block is unfolded before testing
 *      and the two halves are matched independently rather than as one string.
 *   2. A `Content-Type: message/delivery-status` part anywhere in the body —
 *      what the report actually contains.
 *   3. `X-Failed-Recipients`, which Exchange and some relays send instead.
 *
 * Signal 2 is scanned over the raw source rather than parsed as MIME on
 * purpose: a truncated fetch loses the closing boundary, and a real MIME parse
 * of a partial message is less reliable here than the literal header line,
 * which cannot occur in ordinary prose.
 */
export function isDeliveryStatusReport(headers: string, raw: string): boolean {
  const unfolded = (headers || "").replace(/\r?\n[ \t]+/g, " ");
  const contentType = readHeader(unfolded, "content-type") ?? "";
  if (/multipart\/report/i.test(contentType) && /report-type\s*=\s*"?delivery-status/i.test(contentType)) {
    return true;
  }

  if (readHeader(unfolded, "x-failed-recipients")) return true;
  // The header can also arrive on a part rather than the envelope when a relay
  // re-wraps the report.
  if (/^x-failed-recipients\s*:/im.test(raw)) return true;

  return /^content-type\s*:\s*message\/delivery-status/im.test(raw);
}

/**
 * The DSN's own `Status:` field (RFC 3463), or null.
 *
 * This is the machine-readable class and it is preferred over every phrase in
 * the notice. The alternative — scanning the whole raw source for `\b5\.\d\.\d\b`
 * — reads codes out of the QUOTED ORIGINAL MESSAGE and out of the
 * `Diagnostic-Code:` prose, so a bounce whose diagnostic quotes an earlier
 * 4.4.7 deferral could be read as transient when its actual status is 5.1.1.
 *
 * Anchored to the start of a line: `Status:` is a field, and the same word
 * appears in body prose constantly.
 */
export function dsnStatusCode(raw: string): string | null {
  const match = /^status\s*:\s*([245])\.(\d{1,3})\.(\d{1,3})\b/im.exec(raw);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

// Prose fallbacks, used only when there is no Status: field to read.
const TRANSIENT_PROSE_RE =
  /\b4\.\d{1,3}\.\d{1,3}\b|\b4\d\d[ -]|mailbox (is )?full|quota exceeded|over quota|try again later|temporarily (deferred|unavailable|rejected)|greylist|deferred|resources temporarily/i;

const POLICY_PROSE_RE =
  /\b5\.7\.\d{1,3}\b|spam|blocked (by|due)|blacklist|blocklist|policy (reasons?|violation|rejection)|reputation|not authori[sz]ed to send|dmarc|spf (check )?fail|dkim/i;

const PERMANENT_PROSE_RE =
  /\b5\.[0145]\.\d{1,3}\b|\b55[0-4][ -]|user unknown|unknown user|no such user|no such recipient|does not exist|address rejected|recipient (address )?rejected|invalid recipient|mailbox unavailable|no mailbox here|account (has been )?(disabled|deactivated|closed)|domain not found|host or domain name not found/i;

/**
 * What this bounce permits.
 *
 * The Status: field decides when it exists, because it is the only part of a
 * bounce that is specified rather than written. The subclass rules on the
 * 5-class are the substance:
 *
 *   5.7.x → policy. Blocked, not dead. See BounceDisposition.
 *   5.2.2 → transient. "Mailbox full" is a 5-class code for a condition that
 *           empties; RFC 3463 puts it under "mailbox status" and Postfix will
 *           happily deliver to the same address the next day. Retiring on it
 *           throws away a live lead.
 *   5.0/1/4/5.x → permanent. Bad destination address, bad routing (no such
 *           domain), protocol failure. The address itself will not work.
 *
 * With no Status: field, the prose is read in the same priority order —
 * transient beats policy beats permanent — so the most conservative reading
 * that fits wins, and an unreadable notice ends as `unknown` rather than
 * costing an address.
 */
export function bounceDisposition(raw: string, subject: string): BounceDisposition {
  const status = dsnStatusCode(raw);
  if (status) {
    const [cls, sub] = status.split(".");
    if (cls === "4") return "transient";
    if (cls === "5") {
      if (sub === "7") return "policy";
      if (status === "5.2.2" || status === "5.2.3") return "transient";
      return "permanent";
    }
    return "unknown"; // 2.x.x — a success report; nothing to retire.
  }

  const hay = `${subject}\n${raw}`;
  if (TRANSIENT_PROSE_RE.test(hay)) return "transient";
  if (POLICY_PROSE_RE.test(hay))    return "policy";
  if (PERMANENT_PROSE_RE.test(hay)) return "permanent";
  return "unknown";
}

/**
 * Bounce, vacation responder, or a person.
 *
 * Bounce is tested FIRST and that ordering is load-bearing: every DSN sets
 * `Auto-Submitted: auto-replied`, so an auto-reply test running first would
 * discard every bounce as a vacation responder and no address would ever be
 * retired.
 *
 * The bounce phrase list is matched against the SUBJECT only, never the body.
 * A lead who forwards our own bounce notice back to us ("your last mail came
 * back as undeliverable, use this address instead") would otherwise have their
 * own reply classified as a bounce — silencing the exact message the whole
 * outreach system exists to receive.
 */
export function classifyInbound(m: InboundMessage): InboundKind {
  if (isDeliveryStatusReport(m.headers, m.raw)) return "bounce";
  if (BOUNCE_SENDER_RE.test(m.from))            return "bounce";
  if (BOUNCE_SUBJECT_RE.test(m.subject))        return "bounce";
  if (isAutoReply(m.headers, m.subject))        return "auto_reply";
  return "reply";
}

/**
 * RFC 3834 and the de-facto vendor headers.
 *
 * `Auto-Submitted: no` means "a human wrote this", so only any OTHER value
 * counts as automated.
 */
export function isAutoReply(headers: string, subject: string): boolean {
  const block = headers || "";
  const autoSubmitted = readHeader(block, "auto-submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return true;

  if (readHeader(block, "x-autoreply"))               return true;
  if (readHeader(block, "x-autorespond"))             return true;
  if (readHeader(block, "x-auto-response-suppress"))  return true;

  const precedence = readHeader(block, "precedence")?.toLowerCase();
  if (precedence && ["auto_reply", "bulk", "junk", "list"].includes(precedence)) return true;

  return AUTOREPLY_SUBJECT_RE.test(subject);
}

/**
 * The dead address a DSN is about, or null.
 *
 * `Final-Recipient` / `Original-Recipient` / `X-Failed-Recipients` are the
 * machine-readable fields; the free-text address scan is the fallback for a
 * server that only sends a human-readable notice. Our own address and the
 * notice's own author are skipped — the postmaster is the bounce's writer,
 * never its victim.
 */
export function extractBouncedRecipient(
  raw: string,
  headers: string,
  ownAddresses: ReadonlySet<string>,
): string | null {
  const structured =
    /^(?:Final-Recipient|Original-Recipient|X-Failed-Recipients)\s*:\s*(?:rfc822\s*;\s*)?([^\s<>,;]+@[^\s<>,;]+)/im
      .exec(raw);
  if (structured) {
    const address = normalizeAddress(structured[1]);
    if (address && !ownAddresses.has(address)) return address;
  }

  const author = readHeader(splitHeaders(headers || raw), "from")?.toLowerCase() ?? "";
  const candidates = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

  for (const candidate of candidates) {
    const address = normalizeAddress(candidate);
    if (!address) continue;
    if (ownAddresses.has(address)) continue;
    if (author.includes(address)) continue;
    if (BOUNCE_SENDER_RE.test(address)) continue;
    return address;
  }
  return null;
}

/**
 * Who sent this message, as a bare comparable address.
 *
 * The IMAP ENVELOPE is preferred because imapflow has already parsed it; the
 * header is the fallback for a server that returns no ENVELOPE.
 *
 * That fallback MUST go through readAddressHeader and not readHeader. A real
 * From: is `"Mail Delivery System" <MAILER-DAEMON@host>`, and the bare header
 * value carries the display name into every comparison downstream — which
 * silently breaks the anchored mailer-daemon test (the address is no longer at
 * the start of the string) and the own-address check (an exact match against a
 * string with a quoted name in front of it never succeeds). Both failures are
 * invisible: the message is simply classified as a reply from a nonsense
 * address. This function exists so that stays tested rather than assumed.
 */
export function senderAddress(
  envelopeFrom: string | null | undefined,
  headers: string,
): string {
  return normalizeAddress(envelopeFrom ?? readAddressHeader(headers, "from") ?? "");
}

/**
 * One address, in the single shape every comparison uses.
 *
 * Matches services/suppressions.ts:norm and the `lower(trim(...))` the SQL side
 * applies to `leads.email`. Three places compare these strings and all three
 * must agree, or a suppression silently fails to match the lead it is about.
 */
export function normalizeAddress(value: string): string {
  return value.replace(/^[<"'\s]+|[>"'\s.,;:]+$/g, "").trim().toLowerCase();
}
