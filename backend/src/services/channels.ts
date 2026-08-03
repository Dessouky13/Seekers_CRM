// Which channels can actually reach a lead, in the order we should try them.
//
// Pure and DB-free so it can be unit-tested and called from the scheduler, the
// API and the UI without three different implementations drifting apart.
//
// Priority is WhatsApp > email > call. That is a deliberate product decision for
// a Gulf-heavy list: 575 leads have a phone against 517 with an email, WhatsApp
// penetration across UAE/Saudi/Qatar/Jordan/Egypt runs 80-95%, and email on the
// current mailbox has produced 0 replies in 871 sends.
import { describePhone, type PhoneType } from "./phone";

export type ChannelKind = "whatsapp" | "email" | "call";

export interface ChannelState {
  channel:  ChannelKind;
  eligible: boolean;
  /** Human-readable, shown directly in the UI. */
  reason:   string;
}

export interface ChannelInput {
  email:           string | null;
  /** leads.email_status — "bounced" disqualifies. */
  emailStatus:     string | null;
  phoneE164:       string | null;
  phoneType:       PhoneType | null;
  whatsappStatus:  "unknown" | "yes" | "no" | null;
  /** Looked up from the suppression list by the caller. */
  emailSuppressed: boolean;
}

function whatsappState(lead: ChannelInput): ChannelState {
  const c = (eligible: boolean, reason: string): ChannelState =>
    ({ channel: "whatsapp", eligible, reason });

  if (!lead.phoneE164)             return c(false, "no usable number");
  // A human has already opened this chat and found nothing there.
  if (lead.whatsappStatus === "no") return c(false, "not on WhatsApp");
  // A human has confirmed it works — that outranks any classification, and is
  // what rescues +1 numbers we can never classify.
  if (lead.whatsappStatus === "yes") return c(true, "confirmed on WhatsApp");
  if (lead.phoneType === "landline") return c(false, "landline — WhatsApp not available");
  if (lead.phoneType === "mobile")   return c(true, describePhone(lead.phoneE164));
  // Unclassifiable (+1). Worth trying, but say so.
  return c(true, `${describePhone(lead.phoneE164)} — try it and record the result`);
}

function emailState(lead: ChannelInput): ChannelState {
  const c = (eligible: boolean, reason: string): ChannelState =>
    ({ channel: "email", eligible, reason });

  if (!lead.email || !lead.email.trim())  return c(false, "no email address");
  if (lead.emailSuppressed)               return c(false, "suppressed — never email this address");
  if (lead.emailStatus === "bounced")     return c(false, "previous send hard-bounced");
  return c(true, lead.email.trim());
}

function callState(lead: ChannelInput): ChannelState {
  const c = (eligible: boolean, reason: string): ChannelState =>
    ({ channel: "call", eligible, reason });

  if (!lead.phoneE164) return c(false, "no usable number");
  // A landline is perfectly callable, unlike WhatsApp.
  return c(true, lead.phoneE164);
}

/** All three channels, always, in priority order. */
export function resolveChannels(lead: ChannelInput): ChannelState[] {
  return [whatsappState(lead), emailState(lead), callState(lead)];
}

/** The channel to try first, or null when the lead cannot be reached at all. */
export function preferredChannel(lead: ChannelInput): ChannelKind | null {
  return resolveChannels(lead).find((c) => c.eligible)?.channel ?? null;
}

/**
 * No channel works.
 *
 * Worth its own name because such a lead must not be enrolled in a sequence —
 * it would sit there failing silently. Today it is invisible: a lead with no
 * working contact detail looks exactly like one waiting its turn.
 */
export function isUnreachable(lead: ChannelInput): boolean {
  return preferredChannel(lead) === null;
}

/**
 * Why this lead cannot be reached, or null when it can.
 *
 * Exists so a refusal can name the actual problem ("no usable number; no email
 * address") instead of a generic "unreachable" that leaves someone guessing
 * which field to fix.
 */
export function unreachableReason(lead: ChannelInput): string | null {
  // Deliberately delegates the DECISION to isUnreachable rather than re-deriving
  // it from resolveChannels. `isUnreachable` -> `preferredChannel` ->
  // `resolveChannels` is the one chain that decides whether a lead is reachable,
  // and enrolment now refuses on this function's answer — so the refusal and the
  // channel priority order can never disagree about the same lead. Re-deriving
  // "does any channel work?" here would have been a second, drifting copy of it.
  if (!isUnreachable(lead)) return null;
  // Phone-based channels share one root cause, so don't say it twice.
  const seen = new Set<string>();
  const reasons = resolveChannels(lead)
    .map((s) => s.reason)
    .filter((r) => (seen.has(r) ? false : (seen.add(r), true)));
  return reasons.join("; ");
}

/**
 * The channel a human should actually use for a manual step, and why it differs
 * from the step's own channel when it does.
 *
 * THE landline guarantee lives here. A `whatsapp` step on a Cairo 02 landline,
 * or on a number a human has already confirmed has no WhatsApp, must not put a
 * wa.me link in front of anyone — but it must not silently vanish either: the
 * enrollment is sitting in `awaiting_action` and the Today card is the ONLY
 * thing that can resolve it, so dropping the card strands the enrollment
 * forever. It is therefore downgraded to a call, with the reason carried
 * through to the card.
 *
 * A lead with no usable number at all still gets a card: the human records
 * `wrong_number` and the enrollment re-routes. Nothing that the database says
 * needs a person may be missing from the queue.
 */
export function manualTouchRouting(input: {
  /**
   * `outreach_steps.channel` verbatim — any value of that enum, or null when the
   * step was edited or deleted while the enrollment sat blocked on it. Only
   * `whatsapp` is special here; everything else is something a human does with a
   * phone number, i.e. a call. Deliberately NOT narrowed to ChannelKind: this is
   * the one place that maps a step channel to a manual one, and narrowing it
   * pushed the same "anything but whatsapp is a call" mapping out into callers.
   */
  stepChannel: string | null;
  phoneE164:      string | null;
  phoneType:      PhoneType | null;
  whatsappStatus: "unknown" | "yes" | "no" | null;
}): { channel: "whatsapp" | "call"; note: string | null } {
  if (input.stepChannel !== "whatsapp") {
    return { channel: "call", note: null };
  }

  const wa = whatsappState({
    email: null, emailStatus: null, emailSuppressed: false,
    phoneE164:      input.phoneE164,
    phoneType:      input.phoneType,
    whatsappStatus: input.whatsappStatus,
  });
  if (wa.eligible) return { channel: "whatsapp", note: null };

  return {
    channel: "call",
    note: input.phoneE164
      ? `${wa.reason} — call instead`
      : `${wa.reason} — record the outcome to unblock this`,
  };
}
