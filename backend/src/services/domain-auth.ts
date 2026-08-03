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
  /** Why it fails, in words the reader can act on. Null when it passes. */
  problem: string | null;
}

/** TXT records arrive as arrays of chunks that must be joined before matching. */
async function txt(name: string): Promise<string[]> {
  try {
    return (await resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch {
    // NXDOMAIN and ENODATA both mean "not published", which is the answer.
    return [];
  }
}

async function checkSpf(domain: string): Promise<AuthRecord> {
  const records = (await txt(domain)).filter((r) => r.toLowerCase().startsWith("v=spf1"));
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
  const records = (await txt(name)).filter((r) => /(^|;)\s*v=DKIM1/i.test(r) || /p=/.test(r));
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
  const records = (await txt(`_dmarc.${domain}`)).filter((r) => /^v=DMARC1/i.test(r));
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
