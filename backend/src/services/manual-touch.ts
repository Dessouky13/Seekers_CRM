// Manual touches — the pure decisions, on both sides of one.
//
// A whatsapp/call step does not send. It parks the enrollment in
// `awaiting_action`, raises a card in the Today queue, and waits for a human to
// act and report back. This file owns the two decisions that bracket that:
//
//   OUT  manualTouchRow()      — the card a queued enrollment becomes, which is
//                                where the "WhatsApp never targets a landline"
//                                downgrade is applied.
//   BACK touchOutcomeEffects() — what the reported outcome may write, gated on
//                                the SAME routed channel the card showed.
//
// They live together because they must agree, and they are pure (no DB, no
// clock) because the enforcement points they feed — services/worklist.ts and
// POST /enrollments/:id/touch-outcome — both hit the database and neither can be
// unit-tested directly. Extracting the decisions is what makes them testable;
// see manual-touch.test.ts.
//
// Both delegate the actual eligibility rules to channels.ts, which stays the
// single authority. Nothing here re-derives "is this a landline".
import { manualTouchRouting } from "./channels";
import type { PhoneType } from "./phone";
import type { ManualTouchRow } from "./worklist-ranking";

export type WhatsappStatus = "unknown" | "yes" | "no";

/** The five things a human can report back from a manual touch card. */
export type TouchOutcome =
  | "sent" | "no_whatsapp" | "wrong_number" | "not_interested" | "replied";

/** The routing facts about a lead's number, as stored on `leads`. */
export interface LeadPhoneFacts {
  phoneE164:      string | null;
  phoneType:      PhoneType | null;
  whatsappStatus: WhatsappStatus | null;
}

/**
 * The channel a human was ACTUALLY asked to use for this step, or null when
 * that cannot be known.
 *
 * `stepChannel` is `outreach_steps.channel` verbatim, so it can be any value of
 * that enum — or null, when the step was edited or deleted while the enrollment
 * sat blocked on it. Only whatsapp and call are manual channels; anything else
 * returns null rather than being coerced into a call, because "we don't know
 * what this person was asked to do" must not be recorded as "they made a phone
 * call".
 */
export function routedTouchChannel(
  input: LeadPhoneFacts & { stepChannel: string | null },
): "whatsapp" | "call" | null {
  if (input.stepChannel !== "whatsapp" && input.stepChannel !== "call") return null;
  return manualTouchRouting({
    stepChannel:    input.stepChannel,
    phoneE164:      input.phoneE164,
    phoneType:      input.phoneType,
    whatsappStatus: input.whatsappStatus,
  }).channel;
}

/** One row of the awaiting_action query in services/worklist.ts. */
export interface ManualTouchQueryRow {
  enrollmentId:   string;
  leadId:         string;
  leadName:       string | null;
  leadCompany:    string | null;
  phoneE164:      string | null;
  phoneType:      PhoneType | null;
  whatsappStatus: WhatsappStatus | null;
  /** The STEP's channel, straight out of SQL — not the one to present. */
  channel:        string | null;
  message:        string | null;
  dealValue:      unknown;
  since:          unknown;
}

/**
 * A queued enrollment as the card a human sees.
 *
 * THE landline guarantee is enforced on the `channel` line below: the step's own
 * channel never reaches the card, only the routed one, so a `whatsapp` step on a
 * landline (or on a number a human already found has no WhatsApp) arrives at the
 * UI as a `call` and no wa.me link can be built for it. Downgraded, never
 * dropped — the card is the only thing that can clear an `awaiting_action`
 * enrollment, so hiding it would strand the enrollment for good.
 *
 * Extracted from worklist.ts so that guarantee has a test. It previously lived
 * inline in a function that queries the database, and this suite has no database
 * — so replacing `routed.channel` with the raw step channel broke the guarantee
 * without failing anything.
 */
export function manualTouchRow(r: ManualTouchQueryRow): ManualTouchRow {
  const routed = manualTouchRouting({
    stepChannel:    r.channel,
    phoneE164:      r.phoneE164 ?? null,
    phoneType:      r.phoneType ?? null,
    whatsappStatus: r.whatsappStatus ?? null,
  });

  return {
    enrollmentId: r.enrollmentId,
    leadId:       r.leadId,
    leadName:     r.leadName,
    leadCompany:  r.leadCompany,
    channel:      routed.channel,
    channelNote:  routed.note,
    message:      r.message,
    phoneE164:    r.phoneE164 ?? null,
    dealValue:    Number(r.dealValue ?? 0),
    since:        r.since instanceof Date ? r.since : new Date(String(r.since)),
  };
}

export interface TouchOutcomeEffects {
  /** The channel the card actually asked for; null when it cannot be known. */
  routedChannel:  "whatsapp" | "call" | null;
  /** What to write to `leads.whatsapp_status`; null means leave it alone. */
  whatsappStatus: WhatsappStatus | null;
  activity: {
    /** `lead_activities.type` — "call" claims a phone call really happened. */
    type:        "call" | "note";
    description: string;
  };
}

/**
 * What a reported outcome may write, decided from the ROUTED channel.
 *
 * Gating on the routed channel rather than the step's is the whole point. A
 * `whatsapp` step on a Cairo landline is presented as a CALL — the wa.me link,
 * the WhatsApp script and the "No WhatsApp" button are all withheld, so "Sent"
 * is the only success the human can report. Read the step's channel back here
 * and that "Sent" said "confirmed on WhatsApp": it wrote
 * `whatsapp_status = 'yes'`, which channels.ts checks BEFORE the landline
 * check, so the classification was permanently overridden and the lead's next
 * whatsapp step stopped being downgraded — putting a wa.me link in front of a
 * human for a number that can never receive one. It also logged "WhatsApp sent"
 * as a `note` for what was a phone call, so downgraded calls never appeared as
 * calls, and it silently flipped a lead a human had marked `'no'` back to
 * `'yes'` on a card whose "No WhatsApp" button was hidden.
 */
export function touchOutcomeEffects(input: LeadPhoneFacts & {
  outcome:     TouchOutcome;
  notes?:      string | null;
  stepChannel: string | null;
}): TouchOutcomeEffects {
  const routedChannel = routedTouchChannel(input);
  // "call" asserts a phone call took place, so it is only ever used where the
  // human's report actually implies one.
  const touchType = routedChannel === "call" ? "call" as const : "note" as const;
  const notes  = input.notes?.trim();
  const suffix = notes ? ` — ${notes}` : "";

  switch (input.outcome) {
    // A message that went through IS the confirmation the number is on
    // WhatsApp — but only when WhatsApp is what the human was shown. On a
    // downgraded card "Sent" means "I called them", and teaches the list
    // nothing about WhatsApp.
    case "sent": {
      const label = routedChannel === "call"     ? "Called"
                  : routedChannel === "whatsapp" ? "WhatsApp sent"
                  : "Actioned";
      return {
        routedChannel,
        whatsappStatus: routedChannel === "whatsapp" ? "yes" : null,
        activity: { type: touchType, description: `${label}${suffix}` },
      };
    }

    // A human opened the chat and found nothing there. That is a finding about
    // the NUMBER, so it is recorded whatever the routed channel was — but it is
    // never a call: nothing was dialled and nothing was delivered. (Derived
    // from the step's channel, a `call` step's no_whatsapp logged a phone call
    // that never happened.)
    case "no_whatsapp":
      return {
        routedChannel,
        whatsappStatus: "no",
        activity: {
          type:        "note",
          description: "No WhatsApp on this number — routing to another channel",
        },
      };

    // The number is being erased, so any WhatsApp finding about it is erased
    // too. Leaving 'no' behind would outlive the number it described and
    // suppress WhatsApp on whatever correct number is entered next — the same
    // stale-override bug as above, pointing the other way.
    case "wrong_number":
      return {
        routedChannel,
        whatsappStatus: "unknown",
        activity: { type: touchType, description: "Wrong number — cleared" },
      };

    // Both of these are the outcome of a conversation, which on a routed call
    // card happened on the phone. Neither says anything about WhatsApp
    // availability, so neither may write it.
    case "not_interested":
      return {
        routedChannel,
        whatsappStatus: null,
        activity: { type: touchType, description: `Not interested${suffix}` },
      };

    case "replied":
      return {
        routedChannel,
        whatsappStatus: null,
        activity: { type: touchType, description: `Replied${suffix}` },
      };
  }
}
