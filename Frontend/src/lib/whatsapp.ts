// Deep links and message rendering for the manual channels.
//
// wa.me opens whichever WhatsApp app is installed on the device, so a phone
// running WhatsApp Business gets WhatsApp Business. There is no separate public
// deep link for the Business app.

/** Variables a template may use, matching the email templates. */
const KNOWN = ["first_name", "name", "company", "category", "source"] as const;

/**
 * Fill `{{variable}}` placeholders.
 *
 * Unknown or empty variables are removed rather than left as literal tokens:
 * sending a prospect a message containing "{{company}}" is worse than sending
 * one with a small gap.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  const resolved: Record<string, string> = {};
  for (const key of KNOWN) {
    const v = vars[key];
    if (v) resolved[key] = String(v);
  }
  // first_name falls back to the first word of a full name, which is what the
  // lead records usually hold.
  if (!resolved.first_name && vars.name) {
    resolved.first_name = String(vars.name).trim().split(/\s+/)[0];
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => resolved[key] ?? "");
}

/** Digits only — wa.me rejects a leading +. */
const digits = (e164: string) => e164.replace(/[^\d]/g, "");

export function whatsappLink(e164: string, message: string): string {
  const base = `https://wa.me/${digits(e164)}`;
  if (!message) return base;
  // encodeURIComponent, not encodeURI: newlines and & must be escaped or the
  // message arrives truncated.
  return `${base}?text=${encodeURIComponent(message)}`;
}

export function telLink(e164: string): string {
  return `tel:+${digits(e164)}`;
}
