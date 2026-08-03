// Phone normalisation and mobile/landline classification. Pure: no DB, no I/O,
// no dependencies — so it is unit-testable and safe to call from a migration
// script, the scheduler and the API alike.
//
// This exists because WhatsApp routing must never target a landline. Egyptian
// 02/03 numbers, UAE 04 numbers and so on can never have WhatsApp, and opening a
// chat for one wastes a human's time. Classification by dialling plan is
// deterministic and free; actual WhatsApp presence cannot be checked
// compliantly without the paid API, so that is learned from outcomes instead.

export type PhoneType = "mobile" | "landline" | "unknown";

interface DiallingPlan {
  /** Country calling code, without the +. */
  code:    string;
  country: string;
  /** National-significant-number prefixes that identify a mobile. */
  mobile:  string[];
  /** Prefixes that identify a fixed line. */
  landline: string[];
}

// Covers every country code present in the production lead list. Prefixes are
// matched against the national significant number, i.e. after the country code.
const PLANS: DiallingPlan[] = [
  { code: "971", country: "UAE",         mobile: ["50", "52", "54", "55", "56", "58"], landline: ["2", "3", "4", "6", "7", "9"] },
  { code: "20",  country: "Egypt",       mobile: ["10", "11", "12", "15"],             landline: ["2", "3", "4", "5", "6", "8", "9"] },
  { code: "966", country: "Saudi",       mobile: ["5"],                                landline: ["1"] },
  { code: "974", country: "Qatar",       mobile: ["3", "5", "6", "7"],                 landline: ["4"] },
  { code: "962", country: "Jordan",      mobile: ["7"],                                landline: ["2", "3", "5", "6"] },
  { code: "44",  country: "UK",          mobile: ["7"],                                landline: ["1", "2", "3", "8"] },
  { code: "33",  country: "France",      mobile: ["6", "7"],                           landline: ["1", "2", "3", "4", "5", "9"] },
  { code: "31",  country: "Netherlands", mobile: ["6"],                                landline: ["1", "2", "3", "4", "5", "7", "8"] },
  { code: "41",  country: "Switzerland", mobile: ["7"],                                landline: ["2", "3", "4", "5", "6"] },
  // +1 is deliberately absent: US and Canadian mobiles and landlines share the
  // same numbering space, so any classification would be a guess.
];

/** Words the scrapers use to mean "no number". */
const JUNK = new Set(["n/a", "na", "none", "no phone", "unknown", "-", "null"]);

/**
 * Normalise a raw phone string to E.164, or null when that cannot be done
 * safely.
 *
 * Deliberately has NO default country: assuming one would silently corrupt a
 * list that spans five Gulf dialling codes. The only inference made is the
 * unambiguous North-American shape, which accounts for 130 production leads
 * stored as "(212) 285-1110".
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || JUNK.has(trimmed.toLowerCase())) return null;

  // "00" is the international access prefix in most of the world.
  const withPlus = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  const digits = withPlus.replace(/[^\d]/g, "");
  if (!digits) return null;

  if (withPlus.trim().startsWith("+")) {
    // E.164 allows at most 15 digits; anything longer is corrupt data.
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  // North-American shape: 10 digits with a plausible area code (NANP area codes
  // never start with 0 or 1).
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  // Already includes the US country code.
  if (digits.length === 11 && digits.startsWith("1") && /^[2-9]/.test(digits.slice(1))) {
    return `+${digits}`;
  }

  // No country code and not a NANP shape — refuse rather than guess.
  return null;
}

function planFor(e164: string): { plan: DiallingPlan; nsn: string } | null {
  const digits = e164.replace(/[^\d]/g, "");
  // Longest code first, so "971" wins over a hypothetical "97".
  for (const plan of [...PLANS].sort((a, b) => b.code.length - a.code.length)) {
    if (digits.startsWith(plan.code)) {
      return { plan, nsn: digits.slice(plan.code.length) };
    }
  }
  return null;
}

/** Longest-prefix match, so "50" beats "5" when both are listed. */
function matches(nsn: string, prefixes: string[]): boolean {
  return [...prefixes]
    .sort((a, b) => b.length - a.length)
    .some((p) => nsn.startsWith(p));
}

export function classifyPhone(e164: string | null): PhoneType {
  if (!e164) return "unknown";
  const found = planFor(e164);
  if (!found) return "unknown";
  const { plan, nsn } = found;
  // Mobile is checked first: in several plans a mobile prefix is a longer form
  // of a landline prefix (UAE "5x" mobile vs "9" landline is fine, but Egypt
  // "1x" mobile must not fall through to a one-digit landline match).
  if (matches(nsn, plan.mobile))   return "mobile";
  if (matches(nsn, plan.landline)) return "landline";
  return "unknown";
}

/**
 * The three stored phone fields (`leads.phone`, `leads.phone_e164`,
 * `leads.phone_type`), derived together so a caller cannot populate one and
 * forget the others — which is exactly how the routing columns went stale:
 * every write path set `phone` directly and never called this file at all.
 *
 * `phone` (the human-readable original) is preserved whenever the caller
 * supplied non-blank text, even when it cannot be parsed to E.164 — a raw
 * number with no country code (a real, common case; see `normalisePhone`)
 * is still worth a human's time to fix, so it is never discarded. It is only
 * cleared (along with the other two) when the input itself is null, undefined,
 * or blank/whitespace-only — i.e. "no phone" in, "no phone" out.
 *
 * `phoneType` is null exactly when `phoneE164` is null (raw was blank or
 * unparseable) — NOT the same as `classifyPhone`'s "unknown", which means "a
 * real E.164 number whose type this dialling plan can't determine" (e.g. any
 * +1 number). That distinction matters downstream: `channels.ts` still tries
 * WhatsApp for "unknown" numbers, but null means there was no number at all.
 */
export function phoneFields(raw: string | null | undefined): {
  phone: string | null;
  phoneE164: string | null;
  phoneType: PhoneType | null;
} {
  const phone = raw?.trim() ? raw.trim() : null;
  const phoneE164 = normalisePhone(raw);
  const phoneType = phoneE164 ? classifyPhone(phoneE164) : null;
  return { phone, phoneE164, phoneType };
}

/** Short human label for the UI. */
export function describePhone(e164: string | null): string {
  if (!e164) return "no number";
  const found = planFor(e164);
  if (!found) {
    return e164.startsWith("+1") ? "US/Canada — type unknown" : "unrecognised country code";
  }
  const type = classifyPhone(e164);
  if (type === "mobile") {
    // Lead the label with the first digit of the national number, not the full
    // matched prefix — e.g. UAE's six two-digit mobile prefixes (50/52/54/55/
    // 56/58) all share the leading "5", so "5x" reads as "any UAE mobile"
    // rather than a specific block.
    return `mobile · +${found.plan.code} ${found.nsn[0]}x`;
  }
  if (type === "landline") return "landline";
  return `+${found.plan.code} — type unknown`;
}
