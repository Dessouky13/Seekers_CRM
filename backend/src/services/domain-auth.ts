// SPF / DKIM / DMARC presence and sanity, over DNS.
//
// Read-only, free, and uses Node's built-in resolver — no dependency and no
// paid reputation service. Missing DMARC in particular is the single cheapest
// deliverability fix available and is invisible today.
import { resolveTxt } from "dns/promises";

export interface AuthRecord {
  record:  "SPF" | "DKIM" | "DMARC";
  pass:    boolean;
  value:   string | null;
  /**
   * Why it fails, in words the reader can act on. Null when it passes outright.
   * Not always null on a pass, though: the DMARC p=none branch below returns
   * pass: true WITH a non-null advisory note (monitoring-only, not yet
   * enforcing) — this field also carries that kind of qualified-pass context,
   * not only failure reasons.
   */
  problem: string | null;
}

// DNS error codes that genuinely mean "this name/record does not exist" —
// Node's dns/promises rejects with these when a query resolves successfully
// but finds nothing, as opposed to failing to get an answer at all.
const NOT_PUBLISHED_CODES = new Set(["ENOTFOUND", "ENODATA"]);

interface TxtLookup {
  records: string[];
  /**
   * Set (non-null) when the lookup itself failed for a reason OTHER than
   * "no such record" — a resolver timeout, SERVFAIL, ECONNREFUSED,
   * ECANCELLED, etc. In that case `records` is always []; but unlike a
   * genuine "not published" answer, [] here does NOT mean the record is
   * missing — it means we don't know. Callers must report that distinction
   * rather than asserting the record is absent.
   */
  lookupError: string | null;
}

/** TXT records arrive as arrays of chunks that must be joined before matching. */
async function txt(name: string): Promise<TxtLookup> {
  try {
    const records = (await resolveTxt(name)).map((chunks) => chunks.join(""));
    return { records, lookupError: null };
  } catch (err: any) {
    const code = err?.code as string | undefined;
    // ENOTFOUND and ENODATA both mean "not published" — that's a real answer.
    if (code && NOT_PUBLISHED_CODES.has(code)) {
      return { records: [], lookupError: null };
    }
    // Anything else (SERVFAIL, ECONNREFUSED, ETIMEOUT, ECANCELLED, a plain
    // timeout, ...) means the check itself failed — we could not determine
    // whether the record exists. Reporting "no record" for these would tell
    // the user their correctly-configured domain has none, which is exactly
    // the failure mode this function exists to avoid.
    return { records: [], lookupError: code ?? String(err?.message ?? err) };
  }
}

async function checkSpf(domain: string): Promise<AuthRecord> {
  const lookup = await txt(domain);
  if (lookup.lookupError) {
    return { record: "SPF", pass: false, value: null,
      problem: `Could not check SPF — DNS lookup failed (${lookup.lookupError}). This means the check itself failed, not that the record is missing; retry once the resolver is reachable.` };
  }
  const records = lookup.records.filter((r) => r.toLowerCase().startsWith("v=spf1"));
  if (records.length === 0) {
    return { record: "SPF", pass: false, value: null,
      problem: "No SPF record. Receivers cannot tell which servers may send as this domain." };
  }
  if (records.length > 1) {
    return { record: "SPF", pass: false, value: records.join(" | "),
      problem: "More than one SPF record. Receivers treat this as a permanent error and may reject every message." };
  }
  const value = records[0];
  if (/\+all/i.test(value)) {
    return { record: "SPF", pass: false, value,
      problem: "Ends in +all, which authorises the entire internet to send as this domain." };
  }
  if (!/[~-]all/i.test(value)) {
    return { record: "SPF", pass: false, value,
      problem: "No ~all or -all, so unlisted senders are neither softfailed nor rejected." };
  }
  return { record: "SPF", pass: true, value, problem: null };
}

async function checkDkim(domain: string, selector: string): Promise<AuthRecord> {
  const name = `${selector}._domainkey.${domain}`;
  const lookup = await txt(name);
  if (lookup.lookupError) {
    return { record: "DKIM", pass: false, value: null,
      problem: `Could not check DKIM at ${name} — DNS lookup failed (${lookup.lookupError}). This means the check itself failed, not that the key is missing; retry once the resolver is reachable.` };
  }
  const records = lookup.records.filter((r) => /(^|;)\s*v=DKIM1/i.test(r) || /p=/.test(r));
  if (records.length === 0) {
    return { record: "DKIM", pass: false, value: null,
      problem: `No DKIM key at ${name}. Messages cannot be cryptographically signed, so any relay can forge them.` };
  }
  const value = records[0];
  if (/(^|;)\s*p=\s*(;|$)/.test(value)) {
    return { record: "DKIM", pass: false, value,
      problem: "The key is published but empty (p=), which revokes it." };
  }
  return { record: "DKIM", pass: true, value, problem: null };
}

async function checkDmarc(domain: string): Promise<AuthRecord> {
  const lookup = await txt(`_dmarc.${domain}`);
  if (lookup.lookupError) {
    return { record: "DMARC", pass: false, value: null,
      problem: `Could not check DMARC — DNS lookup failed (${lookup.lookupError}). This means the check itself failed, not that the record is missing; retry once the resolver is reachable.` };
  }
  const records = lookup.records.filter((r) => /^v=DMARC1/i.test(r));
  if (records.length === 0) {
    return { record: "DMARC", pass: false, value: null,
      problem: "No DMARC record. Nothing tells receivers what to do when SPF or DKIM fails, and no reports come back." };
  }
  const value = records[0];
  const policy = /p=\s*(none|quarantine|reject)/i.exec(value)?.[1]?.toLowerCase();
  if (!policy) {
    return { record: "DMARC", pass: false, value,
      problem: "DMARC record has no p= policy, so it does nothing." };
  }
  if (policy === "none") {
    // Not a failure: p=none is the correct first step, and moving straight to
    // quarantine before reading reports breaks legitimate mail.
    return { record: "DMARC", pass: true, value,
      problem: "Policy is p=none — monitoring only. Move to quarantine once the reports look clean." };
  }
  return { record: "DMARC", pass: true, value, problem: null };
}

/**
 * All three records for a domain. Runs in parallel — three independent DNS
 * lookups have no reason to be serial.
 */
export async function checkDomainAuth(
  domain: string,
  dkimSelector = process.env.DKIM_SELECTOR ?? "default",
): Promise<AuthRecord[]> {
  const clean = domain.trim().toLowerCase().replace(/^@/, "");
  return Promise.all([
    checkSpf(clean),
    checkDkim(clean, dkimSelector),
    checkDmarc(clean),
  ]);
}
