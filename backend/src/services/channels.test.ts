import { describe, it, expect } from "vitest";
import {
  resolveChannels, preferredChannel, isUnreachable,
  unreachableReason, manualTouchRouting, type ChannelInput,
} from "./channels";

const lead = (over: Partial<ChannelInput> = {}): ChannelInput => ({
  email:           "a@b.test",
  emailStatus:     null,
  phoneE164:       "+971501234567",
  phoneType:       "mobile",
  whatsappStatus:  "unknown",
  emailSuppressed: false,
  ...over,
});

describe("resolveChannels", () => {
  it("always returns the three channels in priority order", () => {
    expect(resolveChannels(lead()).map((c) => c.channel)).toEqual(["whatsapp", "email", "call"]);
  });

  it("prefers WhatsApp when the lead has both a mobile and an email", () => {
    // The explicit product rule: a mobile beats an email.
    expect(preferredChannel(lead())).toBe("whatsapp");
  });

  it("marks WhatsApp ineligible for a landline and says why", () => {
    const out = resolveChannels(lead({ phoneType: "landline" }));
    const wa = out.find((c) => c.channel === "whatsapp")!;
    expect(wa.eligible).toBe(false);
    expect(wa.reason).toMatch(/landline/i);
    expect(preferredChannel(lead({ phoneType: "landline" }))).toBe("email");
  });

  it("marks WhatsApp ineligible once a human has found no WhatsApp there", () => {
    const out = resolveChannels(lead({ whatsappStatus: "no" }));
    expect(out.find((c) => c.channel === "whatsapp")!.eligible).toBe(false);
    expect(out.find((c) => c.channel === "whatsapp")!.reason).toMatch(/not on whatsapp/i);
  });

  it("keeps WhatsApp eligible when a human has confirmed it", () => {
    const out = resolveChannels(lead({ whatsappStatus: "yes", phoneType: "unknown" }));
    // Confirmed by a human outranks an unclassifiable number, which is the
    // whole point of learning from outcomes — it rescues +1 leads.
    expect(out.find((c) => c.channel === "whatsapp")!.eligible).toBe(true);
  });

  it("treats an unclassifiable number as WhatsApp-eligible but flags the uncertainty", () => {
    const out = resolveChannels(lead({ phoneE164: "+12122851110", phoneType: "unknown" }));
    const wa = out.find((c) => c.channel === "whatsapp")!;
    expect(wa.eligible).toBe(true);
    expect(wa.reason).toMatch(/unknown/i);
  });

  it("marks email ineligible when suppressed", () => {
    const out = resolveChannels(lead({ emailSuppressed: true }));
    const em = out.find((c) => c.channel === "email")!;
    expect(em.eligible).toBe(false);
    expect(em.reason).toMatch(/suppress/i);
  });

  it("marks email ineligible when it has bounced", () => {
    const out = resolveChannels(lead({ emailStatus: "bounced" }));
    expect(out.find((c) => c.channel === "email")!.eligible).toBe(false);
  });

  it("marks email ineligible when absent", () => {
    const out = resolveChannels(lead({ email: null }));
    expect(out.find((c) => c.channel === "email")!.eligible).toBe(false);
    expect(out.find((c) => c.channel === "email")!.reason).toMatch(/no email/i);
  });

  it("allows a call on any usable number, including a landline", () => {
    const out = resolveChannels(lead({ phoneType: "landline" }));
    expect(out.find((c) => c.channel === "call")!.eligible).toBe(true);
  });

  it("marks call ineligible when the number could not be normalised", () => {
    const out = resolveChannels(lead({ phoneE164: null, phoneType: null }));
    const call = out.find((c) => c.channel === "call")!;
    expect(call.eligible).toBe(false);
    expect(call.reason).toMatch(/no usable number/i);
  });
});

describe("isUnreachable", () => {
  it("is false while any channel works", () => {
    expect(isUnreachable(lead())).toBe(false);
    expect(isUnreachable(lead({ email: null }))).toBe(false);
    expect(isUnreachable(lead({ phoneE164: null, phoneType: null }))).toBe(false);
  });

  it("is true when there is no email and no usable number", () => {
    expect(isUnreachable(lead({ email: null, phoneE164: null, phoneType: null }))).toBe(true);
  });

  it("is true when the only email is suppressed and there is no number", () => {
    expect(isUnreachable(lead({
      emailSuppressed: true, phoneE164: null, phoneType: null,
    }))).toBe(true);
  });

  it("returns null from preferredChannel when unreachable", () => {
    expect(preferredChannel(lead({ email: null, phoneE164: null, phoneType: null }))).toBeNull();
  });
});

describe("unreachableReason", () => {
  it("is null for a lead that can be reached", () => {
    expect(unreachableReason(lead())).toBeNull();
  });

  it("names every dead channel so the refusal is actionable", () => {
    // enrollLead surfaces this string straight to whoever tried to enrol, who
    // still has the lead on screen and can fix the field it names.
    const reason = unreachableReason(lead({
      email: null, phoneE164: null, phoneType: null,
    }));
    expect(reason).toMatch(/no usable number/i);
    expect(reason).toMatch(/no email address/i);
  });

  it("does not repeat the shared phone reason twice", () => {
    // whatsapp and call both fail on "no usable number"; saying it once reads
    // like a sentence, saying it twice reads like a bug.
    const reason = unreachableReason(lead({ email: null, phoneE164: null, phoneType: null }))!;
    expect(reason.match(/no usable number/gi)).toHaveLength(1);
  });

  it("explains a suppressed address rather than just calling it missing", () => {
    expect(unreachableReason(lead({
      emailSuppressed: true, phoneE164: null, phoneType: null,
    }))).toMatch(/suppressed/i);
  });
});

describe("manualTouchRouting — WhatsApp must never target a landline", () => {
  const phone = {
    phoneE164:      "+201234567890",
    phoneType:      "mobile" as const,
    whatsappStatus: "unknown" as const,
  };

  it("keeps a whatsapp step on WhatsApp for a mobile", () => {
    expect(manualTouchRouting({ stepChannel: "whatsapp", ...phone }))
      .toEqual({ channel: "whatsapp", note: null });
  });

  it("downgrades a whatsapp step on a landline to a call, with the reason", () => {
    // THE guarantee. Before this, worklist.ts raised a whatsapp card regardless
    // of phone_type, and the Today queue rendered a wa.me link for a Cairo
    // landline that can never receive one.
    const out = manualTouchRouting({
      stepChannel: "whatsapp", ...phone, phoneType: "landline",
    });
    expect(out.channel).toBe("call");
    expect(out.note).toMatch(/landline/i);
  });

  it("downgrades to a call when a human already found no WhatsApp there", () => {
    const out = manualTouchRouting({
      stepChannel: "whatsapp", ...phone, whatsappStatus: "no",
    });
    expect(out.channel).toBe("call");
    expect(out.note).toMatch(/not on WhatsApp/i);
  });

  it("trusts a human confirmation over the dialling-plan classification", () => {
    // This is what rescues +1 numbers, which cannot be classified at all.
    expect(manualTouchRouting({
      stepChannel: "whatsapp", phoneE164: "+12122851110",
      phoneType: "unknown", whatsappStatus: "yes",
    }).channel).toBe("whatsapp");
  });

  it("still raises a card when there is no number at all", () => {
    // Never drop it: the enrollment is parked in awaiting_action and this card is
    // the only thing that can clear it. The human records wrong_number and the
    // sequence re-routes.
    const out = manualTouchRouting({
      stepChannel: "whatsapp", phoneE164: null, phoneType: null, whatsappStatus: null,
    });
    expect(out.channel).toBe("call");
    expect(out.note).toMatch(/record the outcome/i);
  });

  it("leaves a call step alone", () => {
    expect(manualTouchRouting({ stepChannel: "call", ...phone, phoneType: "landline" }))
      .toEqual({ channel: "call", note: null });
  });
});
