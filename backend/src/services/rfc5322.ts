// ── Reading raw RFC 5322 message bytes ───────────────────────────────────
//
// Deliberately hand-rolled: mailparser is not a dependency, and the two mailbox
// sweeps between them need only a header value, an address, and the body split
// off from the headers.
//
// This module has NO imports on purpose. It was extracted from inbox.ts, which
// imports the database — and that made these readers untestable and unusable
// from anywhere that must stay database-free (see sent-sync-plan.ts and its
// suite). Both sweeps now read a folded To: header the same way, because there is
// only one implementation of "unfold, then read".

/** Everything before the first blank line. */
export function splitHeaders(raw: string): string {
  const end = raw.search(/\r?\n\r?\n/);
  return end === -1 ? raw : raw.slice(0, end);
}

/** Everything after the first blank line. */
export function splitBody(raw: string): string {
  const match = /\r?\n\r?\n/.exec(raw);
  return match ? raw.slice(match.index + match[0].length) : "";
}

/**
 * One header's value.
 *
 * Unfolds RFC 5322 continuation lines before matching, so a header wrapped
 * across lines still reads as one value.
 */
export function readHeader(headers: string, name: string): string | null {
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.*)$`, "im");
  const m = re.exec(unfolded);
  return m ? m[1].trim() : null;
}

/** The first address in a header that holds one, e.g. `From:`. */
export function readAddressHeader(headers: string, name: string): string | null {
  const value = readHeader(headers, name);
  if (!value) return null;
  const angle = /<([^<>]+@[^<>]+)>/.exec(value);
  if (angle) return angle[1].trim();
  const bare = /([^\s<>,;:"]+@[^\s<>,;:"]+)/.exec(value);
  return bare ? bare[1].trim() : null;
}

/** An address stripped of its punctuation wrapper and lowercased for comparison. */
export function cleanAddress(value: string): string {
  return value.replace(/^[<"'\s]+|[>"'\s.,;:]+$/g, "").toLowerCase();
}

/**
 * Every address in an RFC 5322 address-list header (`To:`, `Cc:`).
 *
 * Angle-bracketed forms are extracted first and quoted display names are then
 * removed before the bare-address scan, so `"Fathy, Ahmed" <a@x.com>, b@y.com`
 * yields two addresses and not three — splitting that header on commas is the
 * obvious implementation and it is wrong.
 */
export function parseAddressList(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];

  for (const angled of value.match(/<[^<>]+@[^<>]+>/g) ?? []) {
    out.push(cleanAddress(angled));
  }

  // Whatever is left once quoted names and angle-bracketed addresses are gone.
  const bare = value.replace(/"[^"]*"/g, " ").replace(/<[^<>]*>/g, " ");
  for (const match of bare.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) {
    out.push(cleanAddress(match));
  }

  return out.filter(Boolean);
}
