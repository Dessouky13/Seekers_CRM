import { describe, it, expect } from "vitest";
import { resolveChannels, preferredChannel, isUnreachable, type ChannelInput } from "./channels";

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
