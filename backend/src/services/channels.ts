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
