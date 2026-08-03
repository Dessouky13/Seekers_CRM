// The landline guarantee, at both of its enforcement points.
//
// channels.test.ts already covers manualTouchRouting itself. What these cover is
// the WIRING: that the queue card and the recorded outcome both go through it.
// Both of those live in database-touching code (services/worklist.ts and
// POST /outreach/enrollments/:id/touch-outcome) which this suite cannot call, so
// the decisions were extracted into manual-touch.ts precisely so they could be
// pinned here. Before that, deleting either wiring failed no test at all.
import { describe, it, expect } from "vitest";
import {
  manualTouchRow, touchOutcomeEffects, routedTouchChannel,
  type ManualTouchQueryRow,
} from "./manual-touch";

// A Cairo landline: +20 2 xxxx xxxx. Real shape from the production list, and a
// number that can never receive a WhatsApp message.
const LANDLINE = "+20221234567";
const MOBILE   = "+971501234567";

const row = (over: Partial<ManualTouchQueryRow> = {}): ManualTouchQueryRow => ({
  enrollmentId:   "e1",
  leadId:         "l1",
  leadName:       "Nile Dental",
  leadCompany:    "Nile Dental Clinic",
  phoneE164:      MOBILE,
  phoneType:      "mobile",
  whatsappStatus: "unknown",
  channel:        "whatsapp",
  message:        "Hi {{name}}",
  dealValue:      "2500.00",
  since:          new Date("2026-08-01T09:00:00Z"),
  ...over,
});

describe("manualTouchRow — the queue card may never offer WhatsApp for a landline", () => {
  it("keeps a whatsapp step on a mobile as whatsapp", () => {
    const card = manualTouchRow(row());
    expect(card.channel).toBe("whatsapp");
    expect(card.channelNote).toBeNull();
  });

  it("downgrades a whatsapp step on a landline to a call, with the reason", () => {
    // THE regression guard. Passing the step's own channel through instead of
    // the routed one puts a wa.me link in front of a human for a Cairo landline.
    const card = manualTouchRow(row({ phoneE164: LANDLINE, phoneType: "landline" }));
    expect(card.channel).toBe("call");
    expect(card.channelNote).toMatch(/landline/i);
  });

  it("downgrades when a human already recorded no WhatsApp on the number", () => {
    const card = manualTouchRow(row({ whatsappStatus: "no" }));
    expect(card.channel).toBe("call");
    expect(card.channelNote).toMatch(/not on WhatsApp/i);
  });

  it("still raises a card when the lead has no number at all", () => {
    // Never dropped: this card is the only thing that can clear an
    // awaiting_action enrollment.
    const card = manualTouchRow(row({ phoneE164: null, phoneType: null }));
    expect(card.channel).toBe("call");
    expect(card.channelNote).toMatch(/record the outcome/i);
  });

  it("carries the enrollment id, message and coerced deal value through", () => {
    const card = manualTouchRow(row());
    expect(card.enrollmentId).toBe("e1");
    expect(card.message).toBe("Hi {{name}}");
    expect(card.dealValue).toBe(2500);
    expect(card.since).toBeInstanceOf(Date);
  });

  it("survives a null deal value and a string timestamp from the driver", () => {
    const card = manualTouchRow(row({ dealValue: null, since: "2026-08-01T09:00:00Z" }));
    expect(card.dealValue).toBe(0);
    expect(card.since.toISOString()).toBe("2026-08-01T09:00:00.000Z");
  });
});

describe("touchOutcomeEffects — an outcome is gated on the ROUTED channel", () => {
  const landline = { phoneE164: LANDLINE, phoneType: "landline" as const, whatsappStatus: "unknown" as const };
  const mobile   = { phoneE164: MOBILE,   phoneType: "mobile"   as const, whatsappStatus: "unknown" as const };

  it("does NOT confirm WhatsApp when 'Sent' comes from a downgraded landline card", () => {
    // THE regression guard for the outcome side. The card showed a call script
    // and a tel: link and hid the "No WhatsApp" button, so "Sent" means "I
    // called them" — reading the step's channel here instead wrote
    // whatsapp_status='yes', which channels.ts trusts over its own landline
    // classification, permanently defeating the downgrade for this lead.
    const eff = touchOutcomeEffects({ outcome: "sent", stepChannel: "whatsapp", ...landline });
    expect(eff.routedChannel).toBe("call");
    expect(eff.whatsappStatus).toBeNull();
    expect(eff.activity).toEqual({ type: "call", description: "Called" });
  });

  it("confirms WhatsApp when 'Sent' comes from a card that really showed WhatsApp", () => {
    const eff = touchOutcomeEffects({ outcome: "sent", stepChannel: "whatsapp", ...mobile });
    expect(eff.routedChannel).toBe("whatsapp");
    expect(eff.whatsappStatus).toBe("yes");
    expect(eff.activity).toEqual({ type: "note", description: "WhatsApp sent" });
  });

  it("confirms WhatsApp on an unclassifiable +1 number, which is what rescues them", () => {
    const eff = touchOutcomeEffects({
      outcome: "sent", stepChannel: "whatsapp",
      phoneE164: "+12122851110", phoneType: "unknown", whatsappStatus: "unknown",
    });
    expect(eff.whatsappStatus).toBe("yes");
  });

  it("never flips a human's recorded 'no' back to 'yes'", () => {
    // The card for such a lead is downgraded to a call and its "No WhatsApp"
    // button is hidden, so the finding could not even be re-recorded.
    const eff = touchOutcomeEffects({
      outcome: "sent", stepChannel: "whatsapp", phoneE164: MOBILE,
      phoneType: "mobile", whatsappStatus: "no",
    });
    expect(eff.routedChannel).toBe("call");
    expect(eff.whatsappStatus).toBeNull();
  });

  it("logs a real call step as a call and appends the human's notes", () => {
    const eff = touchOutcomeEffects({
      outcome: "sent", stepChannel: "call", notes: "gatekeeper, try Tuesday", ...mobile,
    });
    expect(eff.activity).toEqual({ type: "call", description: "Called — gatekeeper, try Tuesday" });
  });

  it("claims no channel when the step was deleted under the enrollment", () => {
    const eff = touchOutcomeEffects({ outcome: "sent", stepChannel: null, ...mobile });
    expect(eff.routedChannel).toBeNull();
    expect(eff.whatsappStatus).toBeNull();
    expect(eff.activity).toEqual({ type: "note", description: "Actioned" });
  });

  it("claims no channel when the step was edited to a sending channel", () => {
    // An email step cannot be an 'awaiting_action' step, but one can be edited
    // while an enrollment is parked on it. "They made a phone call" would be a
    // fabrication.
    const eff = touchOutcomeEffects({ outcome: "sent", stepChannel: "email", ...mobile });
    expect(eff.routedChannel).toBeNull();
    expect(eff.activity.type).toBe("note");
  });

  it("records no_whatsapp as a finding about the number, never as a call", () => {
    const eff = touchOutcomeEffects({ outcome: "no_whatsapp", stepChannel: "whatsapp", ...mobile });
    expect(eff.whatsappStatus).toBe("no");
    // Nothing was dialled and nothing was delivered. Typed from the channel,
    // no_whatsapp on a call step logged a phone call that never happened.
    expect(eff.activity.type).toBe("note");
  });

  it("clears the WhatsApp finding along with the number on wrong_number", () => {
    // Leaving 'no' behind would outlive the number it described and suppress
    // WhatsApp on whatever correct number is entered next.
    const eff = touchOutcomeEffects({ outcome: "wrong_number", stepChannel: "whatsapp", ...landline });
    expect(eff.whatsappStatus).toBe("unknown");
    expect(eff.activity).toEqual({ type: "call", description: "Wrong number — cleared" });
  });

  it("writes nothing about WhatsApp for not_interested or replied", () => {
    for (const outcome of ["not_interested", "replied"] as const) {
      const eff = touchOutcomeEffects({ outcome, stepChannel: "whatsapp", ...landline });
      expect(eff.whatsappStatus).toBeNull();
      // The conversation happened on the phone, because that is what the
      // downgraded card asked for.
      expect(eff.activity.type).toBe("call");
    }
    const onWhatsapp = touchOutcomeEffects({ outcome: "replied", stepChannel: "whatsapp", ...mobile });
    expect(onWhatsapp.activity).toEqual({ type: "note", description: "Replied" });
  });

  it("never writes a whatsapp_status that contradicts the routed channel", () => {
    // Sweep of all five outcomes against both routings: 'yes' may only ever be
    // written when the human was actually shown WhatsApp.
    const outcomes = ["sent", "no_whatsapp", "wrong_number", "not_interested", "replied"] as const;
    for (const outcome of outcomes) {
      for (const facts of [landline, mobile, { phoneE164: null, phoneType: null, whatsappStatus: null }]) {
        const eff = touchOutcomeEffects({ outcome, stepChannel: "whatsapp", ...facts });
        if (eff.whatsappStatus === "yes") expect(eff.routedChannel).toBe("whatsapp");
        if (eff.activity.type === "call") expect(eff.routedChannel).toBe("call");
      }
    }
  });
});

describe("routedTouchChannel", () => {
  it("routes the two manual channels and refuses the rest", () => {
    const facts = { phoneE164: MOBILE, phoneType: "mobile" as const, whatsappStatus: "unknown" as const };
    expect(routedTouchChannel({ stepChannel: "whatsapp", ...facts })).toBe("whatsapp");
    expect(routedTouchChannel({ stepChannel: "call",     ...facts })).toBe("call");
    for (const ch of ["email", "linkedin", "note", null]) {
      expect(routedTouchChannel({ stepChannel: ch, ...facts })).toBeNull();
    }
  });
});
