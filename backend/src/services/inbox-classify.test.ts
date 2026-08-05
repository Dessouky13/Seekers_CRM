import { describe, it, expect } from "vitest";
import {
  classifyInbound,
  bounceDisposition,
  dsnStatusCode,
  isDeliveryStatusReport,
  senderAddress,
  type InboundMessage,
} from "./inbox-classify";

// The IMAP half of the poller cannot be exercised here (no mail server, no
// database in this suite), so these cover the decisions — which is where the
// bug that motivated this file lived. `isBounce` was sender+subject heuristics
// only, and it missed BOTH of the two most common real bounces:
//
//   • Postfix's standard "Undelivered Mail Returned to Sender". The old subject
//     list had "undeliverable" and "returned mail", neither of which matches it.
//   • Anything from a server whose notifier is not called mailer-daemon or
//     postmaster.
//
// A missed bounce is not inert. It falls through to handleReply(), so the dead
// address is never suppressed and the sequencer keeps mailing it — which is the
// one failure mode that can actually burn the sending domain.

const message = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  from:    "mailer-daemon@seekersai.org",
  subject: "Undelivered Mail Returned to Sender",
  headers: "",
  raw:     "",
  ...over,
});

// A realistic Postfix DSN, trimmed to the parts that carry meaning.
const postfixDsn = (status = "5.1.1", action = "failed") => [
  "From: MAILER-DAEMON@mail.example.com (Mail Delivery System)",
  "Subject: Undelivered Mail Returned to Sender",
  'Content-Type: multipart/report; report-type=delivery-status;',
  '\tboundary="XYZ"',
  "",
  "--XYZ",
  "Content-Type: text/plain; charset=us-ascii",
  "",
  "This is the mail system at host mail.example.com.",
  "",
  "--XYZ",
  "Content-Type: message/delivery-status",
  "",
  "Reporting-MTA: dns; mail.example.com",
  "",
  "Final-Recipient: rfc822; ahmed@deadcompany.com",
  `Original-Recipient: rfc822;ahmed@deadcompany.com`,
  `Action: ${action}`,
  `Status: ${status}`,
  "Diagnostic-Code: smtp; 550 5.1.1 <ahmed@deadcompany.com>: Recipient address rejected",
  "",
  "--XYZ--",
].join("\r\n");

// ── isDeliveryStatusReport ───────────────────────────────────────────────

describe("isDeliveryStatusReport — the structural marker, not a phrase list", () => {
  it("recognises an RFC 3464 multipart/report", () => {
    const raw = postfixDsn();
    expect(isDeliveryStatusReport(raw.split("\r\n\r\n")[0], raw)).toBe(true);
  });

  it("recognises a message/delivery-status part even when the top Content-Type is missing", () => {
    const raw = [
      "Content-Type: message/delivery-status",
      "",
      "Final-Recipient: rfc822; nobody@example.com",
      "Action: failed",
      "Status: 5.1.1",
    ].join("\r\n");
    expect(isDeliveryStatusReport("", raw)).toBe(true);
  });

  it("recognises Exchange's X-Failed-Recipients header", () => {
    const headers = "X-Failed-Recipients: nobody@example.com";
    expect(isDeliveryStatusReport(headers, headers)).toBe(true);
  });

  it("does not fire on a multipart/report that is not a delivery status", () => {
    const headers = "Content-Type: multipart/report; report-type=disposition-notification";
    expect(isDeliveryStatusReport(headers, headers)).toBe(false);
  });

  it("does not fire on an ordinary reply that happens to quote the word status", () => {
    const raw = "Subject: Re: proposal\r\n\r\nWhat is the delivery status of the first milestone?";
    expect(isDeliveryStatusReport("Subject: Re: proposal", raw)).toBe(false);
  });
});

// ── classifyInbound ──────────────────────────────────────────────────────

describe("classifyInbound — bounce vs auto-reply vs a human", () => {
  it("catches Postfix's standard subject, which the old sender+subject test missed", () => {
    // The regression this file exists for. "Undelivered Mail Returned to
    // Sender" contains neither "undeliverable" nor "returned mail".
    expect(classifyInbound(message({
      from:    "someone@mail.example.com",
      subject: "Undelivered Mail Returned to Sender",
    }))).toBe("bounce");
  });

  it("catches Gmail's wording", () => {
    expect(classifyInbound(message({
      from:    "mailer-daemon@googlemail.com",
      subject: "Delivery Status Notification (Failure)",
    }))).toBe("bounce");
  });

  it("catches Microsoft's wording", () => {
    expect(classifyInbound(message({
      from:    "postmaster@outlook.com",
      subject: "Undeliverable: Quick question about your booking flow",
    }))).toBe("bounce");
  });

  it("catches a DSN whose sender and subject are both unrecognisable", () => {
    // The structural marker is what makes the classifier robust: no phrase list
    // can enumerate every MTA's wording, but every DSN is a multipart/report.
    const raw = postfixDsn();
    expect(classifyInbound({
      from:    "bounces-99283@relay.example.net",
      subject: "رسالة مرتدة",
      headers: raw.split("\r\n\r\n")[0],
      raw,
    })).toBe("bounce");
  });

  it("classifies a bounce as a bounce even though DSNs carry Auto-Submitted", () => {
    // Every DSN sets Auto-Submitted: auto-replied. If auto-reply were tested
    // first, every bounce would be discarded as a vacation responder and no
    // address would ever be suppressed.
    const raw = postfixDsn();
    expect(classifyInbound({
      from:    "mailer-daemon@mail.example.com",
      subject: "Undelivered Mail Returned to Sender",
      headers: "Auto-Submitted: auto-replied",
      raw,
    })).toBe("bounce");
  });

  it("still recognises an out-of-office", () => {
    expect(classifyInbound(message({
      from:    "ahmed@acme.com",
      subject: "Automatic reply: Quick question",
      headers: "",
      raw:     "",
    }))).toBe("auto_reply");
  });

  it("treats a plain human message as a reply", () => {
    expect(classifyInbound({
      from:    "ahmed@acme.com",
      subject: "Re: Quick question about your booking flow",
      headers: "From: ahmed@acme.com",
      raw:     "From: ahmed@acme.com\r\n\r\nSounds interesting, can we talk Thursday?",
    })).toBe("reply");
  });

  it("does not call a human's message a bounce because they wrote the word undeliverable", () => {
    // Subject matching only. Scanning the BODY for these phrases would let a
    // lead quoting our own bounce notice disable their own address.
    expect(classifyInbound({
      from:    "ahmed@acme.com",
      subject: "Re: Quick question",
      headers: "From: ahmed@acme.com",
      raw:     "From: ahmed@acme.com\r\n\r\nYour last mail came back as undeliverable, try this address.",
    })).toBe("reply");
  });
});

// ── dsnStatusCode ────────────────────────────────────────────────────────

describe("dsnStatusCode — read the machine field, not the prose", () => {
  it("reads the Status: field of a DSN", () => {
    expect(dsnStatusCode(postfixDsn("5.1.1"))).toBe("5.1.1");
  });

  it("reads a transient status", () => {
    expect(dsnStatusCode(postfixDsn("4.2.2", "delayed"))).toBe("4.2.2");
  });

  it("returns null when there is no DSN status field at all", () => {
    expect(dsnStatusCode("Subject: hello\r\n\r\nno status here")).toBeNull();
  });

  it("ignores an SMTP reply code that is not the Status: field", () => {
    // "550 5.1.1" inside Diagnostic-Code is prose. Only the Status: line is the
    // machine-readable field, and preferring it is what stops a 4.x.x quoted in
    // the original message from being read as this bounce's own class.
    const raw = [
      "Diagnostic-Code: smtp; 550 5.1.1 user unknown",
      "Status: 4.4.7",
    ].join("\r\n");
    expect(dsnStatusCode(raw)).toBe("4.4.7");
  });
});

// ── bounceDisposition ────────────────────────────────────────────────────

describe("bounceDisposition — what may be done to the address", () => {
  it("calls a 5.1.1 permanent, so the address is retired", () => {
    expect(bounceDisposition(postfixDsn("5.1.1"), "Undelivered Mail Returned to Sender"))
      .toBe("permanent");
  });

  it("calls a 5.4.4 permanent — the domain does not resolve", () => {
    expect(bounceDisposition(postfixDsn("5.4.4"), "Undelivered")).toBe("permanent");
  });

  it("calls a 4.x.x transient, so nothing is retired on a deferral", () => {
    expect(bounceDisposition(postfixDsn("4.2.2", "delayed"), "Delayed")).toBe("transient");
  });

  it("calls a full mailbox transient even though 5.2.2 is a 5-class code", () => {
    // A full mailbox empties. Retiring the address on it throws away a live
    // lead for a condition that clears by itself.
    expect(bounceDisposition(postfixDsn("5.2.2"), "Undelivered")).toBe("transient");
  });

  it("calls a 5.7.x policy, NOT permanent — this one is about us, not them", () => {
    // THE important distinction. 5.7.1 is "your message was blocked", usually
    // for sender reputation or SPF/DKIM/DMARC. Treating it as a dead address
    // would suppress every lead at every provider that blocked us — deleting
    // the reachable half of the list to punish our own domain's reputation.
    expect(bounceDisposition(postfixDsn("5.7.1"), "Undelivered")).toBe("policy");
    expect(bounceDisposition(postfixDsn("5.7.26"), "Undelivered")).toBe("policy");
  });

  it("falls back to prose when there is no Status: field", () => {
    expect(bounceDisposition("550 user unknown", "Undeliverable")).toBe("permanent");
    expect(bounceDisposition("452 mailbox full, try again later", "Undeliverable")).toBe("transient");
  });

  it("lets an explicit temporary phrase beat a permanent-looking one", () => {
    expect(bounceDisposition("user unknown ... try again later", "Undeliverable")).toBe("transient");
  });

  it("reads a spam rejection in prose as policy, not as a dead address", () => {
    expect(bounceDisposition(
      "550 5.7.1 Message rejected due to content spam policy",
      "Undeliverable",
    )).toBe("policy");
  });

  it("returns unknown when nothing at all can be read", () => {
    // Deliberately not "permanent". An unreadable bounce must never be enough
    // to retire an address — the failure has to be proven, not assumed.
    expect(bounceDisposition("something went wrong", "Mail problem")).toBe("unknown");
  });
});

// ── senderAddress ────────────────────────────────────────────────────────

describe("senderAddress — the display name must not reach the comparisons", () => {
  it("prefers the parsed ENVELOPE address", () => {
    expect(senderAddress("Ahmed@Acme.com", "From: someone-else@example.com"))
      .toBe("ahmed@acme.com");
  });

  it("strips the display name when falling back to the header", () => {
    // The regression this exists to prevent. A bare readHeader() returns
    // `"Mail Delivery System" <MAILER-DAEMON@host>` — which is not anchored at
    // the address, so the mailer-daemon test stops matching, and is not equal
    // to our own address, so the self-mail guard stops matching. The message is
    // then classified as an ordinary reply from a nonsense sender, and nothing
    // anywhere reports a problem.
    expect(senderAddress(null, 'From: "Mail Delivery System" <MAILER-DAEMON@mail.example.com>'))
      .toBe("mailer-daemon@mail.example.com");
  });

  it("handles a bare address with no angle brackets", () => {
    expect(senderAddress(undefined, "From: ahmed@acme.com")).toBe("ahmed@acme.com");
  });

  it("survives a folded From header", () => {
    expect(senderAddress(null, 'From: "Someone With A\r\n\tVery Long Name" <a@b.com>'))
      .toBe("a@b.com");
  });

  it("is empty when there is no sender at all, so the caller can bail", () => {
    expect(senderAddress(null, "Subject: no from header")).toBe("");
    expect(senderAddress(undefined, "")).toBe("");
  });

  it("produces something the bounce classifier actually recognises", () => {
    // The end-to-end point: parse then classify. With the display name left in,
    // this returns "reply".
    const from = senderAddress(null, 'From: "Mail Delivery System" <MAILER-DAEMON@mail.example.com>');
    expect(classifyInbound({ from, subject: "hello", headers: "", raw: "" })).toBe("bounce");
  });
});
