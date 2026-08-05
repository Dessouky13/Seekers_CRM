import { describe, it, expect } from "vitest";
import { parseAddressList } from "./rfc5322";
import {
  MANUAL_EMAIL_PREFIX,
  crmSendFingerprint,
  importKey,
  manualEmailDescription,
  normalizeMessageId,
  planManualSentImport,
  readSentMessageFacts,
  manualEmailStageAdvance,
  type ManualSentPlanInput,
  type SentMessageFacts,
} from "./sent-sync-plan";

// The IMAP and database halves of the sweep cannot be exercised here (no mail
// server, no database in this suite). These cover the decisions: what counts as
// one of the CRM's own Sent copies, what counts as already imported, and what the
// timeline row says. Those are the rules that must not regress — getting the
// first one wrong relabels every sequence email as hand-written, and getting the
// second one wrong duplicates the timeline on every two-minute tick.

const facts = (over: Partial<SentMessageFacts> = {}): SentMessageFacts => ({
  messageId:  "abc-123@seekersai.org",
  subject:    "Quick question about your booking flow",
  recipients: ["ahmed@acme.com"],
  ...over,
});

const plan = (over: Partial<ManualSentPlanInput> = {}) => planManualSentImport({
  messages:        [facts()],
  crmMessageIds:   new Set(),
  crmFingerprints: new Set(),
  leadsByAddress:  new Map([["ahmed@acme.com", "lead-1"]]),
  alreadyImported: new Set(),
  ownAddresses:    new Set(["team@seekersai.org"]),
  ...over,
});

// ── normalizeMessageId ───────────────────────────────────────────────────

describe("normalizeMessageId — one comparable shape for both sides", () => {
  it("strips the angle brackets nodemailer and imapflow both keep", () => {
    expect(normalizeMessageId("<abc-123@seekersai.org>")).toBe("abc-123@seekersai.org");
  });

  it("matches a bracketed stored id against a bare one", () => {
    expect(normalizeMessageId("<AbC@x.com>")).toBe(normalizeMessageId("abc@x.com"));
  });

  it("survives a folded header, which arrives with a newline inside it", () => {
    expect(normalizeMessageId("<abc-123\r\n  @seekersai.org>")).toBe("abc-123@seekersai.org");
  });

  it("returns empty for absent ids so the plan can skip them", () => {
    expect(normalizeMessageId(null)).toBe("");
    expect(normalizeMessageId(undefined)).toBe("");
    expect(normalizeMessageId("")).toBe("");
  });
});

// ── parseAddressList ─────────────────────────────────────────────────────

describe("parseAddressList — commas are not separators", () => {
  it("reads several angle-bracketed addresses", () => {
    expect(parseAddressList("Ahmed <a@x.com>, Sara <s@y.com>"))
      .toEqual(["a@x.com", "s@y.com"]);
  });

  it("does not split on the comma inside a quoted display name", () => {
    // Splitting this header on "," yields three fragments and one bogus address.
    expect(parseAddressList('"Fathy, Ahmed" <a@x.com>, b@y.com'))
      .toEqual(["a@x.com", "b@y.com"]);
  });

  it("reads bare addresses with no angle brackets", () => {
    expect(parseAddressList("a@x.com, b@y.com")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("lowercases, because lead matching is case-insensitive", () => {
    expect(parseAddressList("Ahmed <Ahmed@ACME.com>")).toEqual(["ahmed@acme.com"]);
  });

  it("returns nothing for an absent header", () => {
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList("Undisclosed recipients:;")).toEqual([]);
  });
});

// ── readSentMessageFacts ─────────────────────────────────────────────────

describe("readSentMessageFacts — envelope first, raw headers as the fallback", () => {
  const raw = [
    "Message-ID: <raw-id@seekersai.org>",
    "From: Team <team@seekersai.org>",
    'To: "Fathy, Ahmed" <Ahmed@ACME.com>',
    "Cc: sara@acme.com",
    "Subject: Raw subject",
    "",
    "body text",
  ].join("\r\n");

  it("prefers the envelope when the server supplied one", () => {
    const f = readSentMessageFacts({
      raw,
      envelope: {
        messageId: "<env-id@seekersai.org>",
        subject:   "Envelope subject",
        to:        [{ address: "Ahmed@ACME.com" }],
        cc:        [{ address: "sara@acme.com" }],
      },
    });
    expect(f.messageId).toBe("env-id@seekersai.org");
    expect(f.subject).toBe("Envelope subject");
    expect(f.recipients).toEqual(["ahmed@acme.com", "sara@acme.com"]);
  });

  it("falls back to the raw To/Cc headers when the envelope has no recipients", () => {
    const f = readSentMessageFacts({ raw, envelope: { subject: null, messageId: null, to: [], cc: [] } });
    expect(f.messageId).toBe("raw-id@seekersai.org");
    expect(f.subject).toBe("Raw subject");
    expect(f.recipients).toEqual(["ahmed@acme.com", "sara@acme.com"]);
  });

  it("works with no envelope at all", () => {
    expect(readSentMessageFacts({ raw }).recipients).toEqual(["ahmed@acme.com", "sara@acme.com"]);
  });

  it("de-duplicates an address that is in both To and Cc", () => {
    const f = readSentMessageFacts({
      envelope: { to: [{ address: "a@x.com" }], cc: [{ address: "A@X.com" }], messageId: "<m@x>", subject: "s" },
    });
    expect(f.recipients).toEqual(["a@x.com"]);
  });

  it("reports an empty messageId rather than throwing on a message that has none", () => {
    expect(readSentMessageFacts({ raw: "To: a@x.com\r\n\r\nbody" }).messageId).toBe("");
  });
});

// ── planManualSentImport: excluding the CRM's own sends ──────────────────

describe("planManualSentImport — the CRM's own Sent copies never come back in", () => {
  it("imports an email the CRM has no record of", () => {
    const p = plan();
    expect(p.activities).toHaveLength(1);
    expect(p.activities[0].leadId).toBe("lead-1");
    expect(p.activities[0].recipient).toBe("ahmed@acme.com");
  });

  it("skips a message whose Message-ID is recorded in outreach_sends", () => {
    const p = plan({ crmMessageIds: new Set(["abc-123@seekersai.org"]) });
    expect(p.activities).toEqual([]);
    expect(p.crmSends).toBe(1);
  });

  it("skips a CRM send whose Message-ID predates the email.ts pinning fix, via (recipient, subject)", () => {
    const p = plan({
      // The Sent copy carries an id nothing ever recorded.
      messages:        [facts({ messageId: "never-recorded@seekersai.org" })],
      crmFingerprints: new Set([crmSendFingerprint("ahmed@acme.com", "Quick question about your booking flow")]),
    });
    expect(p.activities).toEqual([]);
    expect(p.crmSends).toBe(1);
  });

  it("does not let the fingerprint fall over on subject case or padding", () => {
    const p = plan({
      messages:        [facts({ messageId: "x@y", subject: "  QUICK Question About Your Booking Flow " })],
      crmFingerprints: new Set([crmSendFingerprint("ahmed@acme.com", "Quick question about your booking flow")]),
    });
    expect(p.crmSends).toBe(1);
  });

  it("still imports a genuine manual email to the same lead with a different subject", () => {
    const p = plan({
      messages:        [facts({ messageId: "manual@x", subject: "Re: our call yesterday" })],
      crmFingerprints: new Set([crmSendFingerprint("ahmed@acme.com", "Quick question about your booking flow")]),
    });
    expect(p.activities).toHaveLength(1);
    expect(p.crmSends).toBe(0);
  });

  it("skips a message with no Message-ID rather than guessing it is manual", () => {
    const p = plan({ messages: [facts({ messageId: "" })] });
    expect(p.activities).toEqual([]);
    expect(p.unidentified).toBe(1);
  });
});

// ── planManualSentImport: lead matching ──────────────────────────────────

describe("planManualSentImport — matching recipients to leads", () => {
  it("matches case-insensitively, because leads.email is stored as typed", () => {
    // readSentMessageFacts lowercases recipients and the address map is keyed
    // lowercase, which is the convention migration 0013 made structural for
    // mailboxes.address. A mixed-case lead address must still match.
    const p = plan({
      messages:       [facts({ recipients: ["ahmed@acme.com"] })],
      leadsByAddress: new Map([["ahmed@acme.com", "lead-1"]]),
    });
    expect(p.activities.map((a) => a.leadId)).toEqual(["lead-1"]);
  });

  it("logs a touch on every lead the mail was addressed to", () => {
    const p = plan({
      messages:       [facts({ recipients: ["ahmed@acme.com", "sara@other.com"] })],
      leadsByAddress: new Map([["ahmed@acme.com", "lead-1"], ["sara@other.com", "lead-2"]]),
    });
    expect(p.activities.map((a) => a.leadId)).toEqual(["lead-1", "lead-2"]);
  });

  it("counts but does not import a recipient who is not a lead", () => {
    const p = plan({
      messages:       [facts({ recipients: ["ahmed@acme.com", "accountant@nobody.com"] })],
      leadsByAddress: new Map([["ahmed@acme.com", "lead-1"]]),
    });
    expect(p.activities).toHaveLength(1);
    expect(p.unmatched).toBe(1);
  });

  it("ignores our own mailbox in the recipient list — a self-CC is not a touch", () => {
    const p = plan({
      messages:       [facts({ recipients: ["team@seekersai.org", "ahmed@acme.com"] })],
      leadsByAddress: new Map([["ahmed@acme.com", "lead-1"], ["team@seekersai.org", "lead-oops"]]),
    });
    expect(p.activities.map((a) => a.leadId)).toEqual(["lead-1"]);
    expect(p.unmatched).toBe(0);
  });

  it("produces nothing at all when no recipient is a lead", () => {
    expect(plan({ leadsByAddress: new Map() }).activities).toEqual([]);
  });
});

// ── Idempotency ──────────────────────────────────────────────────────────

describe("planManualSentImport — running the sweep twice imports nothing twice", () => {
  it("skips a (lead, message) pair already recorded in events", () => {
    const messages = [facts()];

    // Run 1: nothing recorded yet.
    const first = planManualSentImport({
      messages,
      crmMessageIds:   new Set(),
      crmFingerprints: new Set(),
      leadsByAddress:  new Map([["ahmed@acme.com", "lead-1"]]),
      alreadyImported: new Set(),
      ownAddresses:    new Set(),
    });
    expect(first.activities).toHaveLength(1);

    // Run 2: exactly what run 1 committed is now in the events table. This is
    // the guard that carries idempotency on a server that will not persist the
    // custom IMAP keyword, where the sweep re-reads the same window every tick.
    const second = planManualSentImport({
      messages,
      crmMessageIds:   new Set(),
      crmFingerprints: new Set(),
      leadsByAddress:  new Map([["ahmed@acme.com", "lead-1"]]),
      alreadyImported: new Set(first.activities.map((a) => importKey(a.leadId, a.messageId))),
      ownAddresses:    new Set(),
    });
    expect(second.activities).toEqual([]);
    expect(second.duplicates).toBe(1);
  });

  it("re-imports nothing even after ten identical runs", () => {
    const messages = [facts(), facts({ messageId: "second@x", recipients: ["sara@other.com"] })];
    const leadsByAddress = new Map([["ahmed@acme.com", "lead-1"], ["sara@other.com", "lead-2"]]);
    const alreadyImported = new Set<string>();
    let totalImported = 0;

    for (let run = 0; run < 10; run++) {
      const p = planManualSentImport({
        messages,
        crmMessageIds:   new Set(),
        crmFingerprints: new Set(),
        leadsByAddress,
        alreadyImported,
        ownAddresses:    new Set(),
      });
      totalImported += p.activities.length;
      for (const a of p.activities) alreadyImported.add(importKey(a.leadId, a.messageId));
    }

    expect(totalImported).toBe(2);
  });

  it("does not write the same row twice when one batch holds a duplicated append", () => {
    // A double IMAP append puts the same Message-ID in the folder twice. Nothing
    // is committed mid-batch, so the events set cannot see the first one.
    const p = plan({ messages: [facts(), facts()] });
    expect(p.activities).toHaveLength(1);
    expect(p.duplicates).toBe(1);
  });

  it("keys on (lead, message), so one mail to two leads is not deduped into one", () => {
    const p = plan({
      messages:       [facts({ recipients: ["ahmed@acme.com", "sara@other.com"] })],
      leadsByAddress: new Map([["ahmed@acme.com", "lead-1"], ["sara@other.com", "lead-2"]]),
      alreadyImported: new Set([importKey("lead-1", "abc-123@seekersai.org")]),
    });
    expect(p.activities.map((a) => a.leadId)).toEqual(["lead-2"]);
    expect(p.duplicates).toBe(1);
  });
});

// ── The timeline row ─────────────────────────────────────────────────────

describe("manualEmailDescription — identifiable as manual, and as an email", () => {
  it("leads with the marker, so the timeline and a grep both find it", () => {
    expect(manualEmailDescription("ahmed@acme.com", "Re: pricing"))
      .toBe("[Manual Email] to ahmed@acme.com — Re: pricing");
  });

  it("uses the same bracketed-prefix convention as [Sequence] and [Reply received]", () => {
    expect(manualEmailDescription("a@x.com", "s").startsWith(MANUAL_EMAIL_PREFIX)).toBe(true);
  });

  it("names the recipient, which is the only way to tell which lead a group mail hit", () => {
    expect(manualEmailDescription("sara@other.com", "Re: pricing")).toContain("sara@other.com");
  });

  it("drops the dash rather than leaving a dangling one on a subject-less email", () => {
    expect(manualEmailDescription("a@x.com", "   ")).toBe("[Manual Email] to a@x.com");
  });

  it("bounds the description so a runaway subject cannot bloat the timeline", () => {
    expect(manualEmailDescription("a@x.com", "x".repeat(5000)).length).toBe(1000);
  });

  it("is what the plan puts on the row", () => {
    const p = plan();
    expect(p.activities[0].description)
      .toBe(manualEmailDescription("ahmed@acme.com", "Quick question about your booking flow"));
  });
});

describe("key builders", () => {
  it("importKey separates lead from message so ids cannot run together", () => {
    expect(importKey("lead-1", "m-1")).not.toBe(importKey("lead-1m", "-1"));
  });

  it("crmSendFingerprint is stable across case and surrounding whitespace", () => {
    expect(crmSendFingerprint(" Ahmed@ACME.com ", "  Hello There ")).toBe(crmSendFingerprint("ahmed@acme.com", "hello there"));
  });

  it("crmSendFingerprint distinguishes different subjects to the same address", () => {
    expect(crmSendFingerprint("a@x.com", "one")).not.toBe(crmSendFingerprint("a@x.com", "two"));
  });
});

// ── manualEmailStageAdvance ──────────────────────────────────────────────

describe("manualEmailStageAdvance — a hand-sent email is proof of contact", () => {
  it("moves a new lead to contacted", () => {
    // The whole point: `new_lead` asserts nobody has spoken to this person, and
    // an email sent by hand falsifies exactly that.
    expect(manualEmailStageAdvance("new_lead")).toEqual({
      to:          "contacted",
      description: "Stage moved to contacted — email sent manually",
    });
  });

  it("leaves every later stage alone", () => {
    // A sweep reading a mail folder knows nothing about where a deal stands.
    // Advancing contacted → call_scheduled because somebody sent a second email
    // would be the sweep inventing sales progress.
    for (const stage of [
      "contacted", "call_scheduled", "proposal_sent", "negotiation",
    ]) {
      expect(manualEmailStageAdvance(stage)).toBeNull();
    }
  });

  it("never reopens a closed lead", () => {
    // Chasing somebody who already said no does not undo their answer.
    expect(manualEmailStageAdvance("closed_won")).toBeNull();
    expect(manualEmailStageAdvance("closed_lost")).toBeNull();
  });

  it("does nothing when the stage is unknown", () => {
    expect(manualEmailStageAdvance(null)).toBeNull();
    expect(manualEmailStageAdvance(undefined)).toBeNull();
    expect(manualEmailStageAdvance("")).toBeNull();
  });
});
