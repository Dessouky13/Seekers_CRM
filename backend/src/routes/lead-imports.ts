// Bulk lead import support routes:
//   POST /lead-imports/validate   — pre-flight row check (no writes)
//   POST /lead-imports/n8n        — server-side proxy that hands the raw
//                                   spreadsheet to the n8n import workflow
//
// Deliberately a NEW router rather than more surface on routes/crm.ts or
// routes/outreach.ts: the actual lead WRITE still goes through
// POST /outreach/leads/ingest-bulk, unchanged. Everything here is about the two
// things that happen around that write — telling the user what is wrong with
// their sheet first, and handing the file to n8n afterwards.
//
// ── WHY THE n8n CALL IS PROXIED ─────────────────────────────────────────
// The n8n webhook is protected by a shared secret. Anything under Frontend/ is
// compiled into a public JS bundle that any visitor can read (and `vite build`
// inlines every `import.meta.env.VITE_*` value literally), so a secret used from
// the browser is a published secret. The browser therefore uploads the file to
// this endpoint with its normal JWT, and the secret is read from process.env
// here and attached server-side. `Frontend/dist` contains neither the secret nor
// the n8n hostname.
import { Hono } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { leads } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { validateImportRows, type ValidatableRow } from "../services/lead-import";
import { normalisePhone } from "../services/phone";
import {
  importFingerprint, recentForwardAgeMs, recordForward, FORWARD_DEDUPE_WINDOW_MS,
} from "../services/import-forward";
import { cairoToday } from "../utils/dates";
import type { AppEnv } from "../types";

const leadImports = new Hono<AppEnv>();

// ── POST /lead-imports/validate ───────────────────────────
//
// Row cap. The importer itself sends leads in batches of 500; this checks a
// whole file in one call so the user sees a single verdict, but a 20k-row Apify
// dump would otherwise build a 20k-element IN list. The frontend sends the first
// 2,000 rows and says so rather than pretending the rest were checked.
const MAX_VALIDATE_ROWS = 2000;

// NOTE: `email` is `z.string()`, NOT `z.string().email()`. Reporting a malformed
// address is the entire job of this endpoint — validating it at the schema level
// would 400 the request instead, which is precisely the failure this endpoint
// exists to move earlier and explain.
const validateSchema = z.object({
  leads: z.array(z.object({
    name:    z.string().max(500).nullish(),
    company: z.string().max(500).nullish(),
    email:   z.string().max(500).nullish(),
    phone:   z.string().max(200).nullish(),
  })).min(1).max(MAX_VALIDATE_ROWS),
});

leadImports.post("/validate", authMiddleware, adminOnly, async (c) => {
  const body = validateSchema.parse(await c.req.json());

  const rows: ValidatableRow[] = body.leads.map((lead, index) => ({ index, ...lead }));

  // Only the keys present in this batch are looked up — an explicit IN list, the
  // same shape routes/outreach.ts uses, because Drizzle binds a JS array as one
  // scalar parameter that Postgres rejects as a malformed array literal.
  const emails = [...new Set(
    rows.map((r) => r.email?.trim().toLowerCase()).filter((e): e is string => !!e),
  )];
  // Compared in E.164, not as typed: "+20 100 000 0000" and "00201000000000"
  // are the same number, and a raw-string comparison would call neither a
  // duplicate. `phone_e164` is the column the routing code already keeps
  // normalised for exactly this reason.
  const phones = [...new Set(
    rows.map((r) => normalisePhone(r.phone)).filter((p): p is string => !!p),
  )];

  const [emailRows, phoneRows] = await Promise.all([
    emails.length
      ? db.select({ email: sql<string>`LOWER(${leads.email})` })
          .from(leads)
          .where(sql`LOWER(${leads.email}) IN (${sql.join(emails.map((e) => sql`${e}`), sql`, `)})`)
      : Promise.resolve([] as { email: string }[]),
    phones.length
      ? db.select({ phoneE164: leads.phoneE164 })
          .from(leads)
          .where(sql`${leads.phoneE164} IN (${sql.join(phones.map((p) => sql`${p}`), sql`, `)})`)
      : Promise.resolve([] as { phoneE164: string | null }[]),
  ]);

  const report = validateImportRows({
    rows,
    existingEmails: new Set(emailRows.map((r) => r.email)),
    existingPhones: new Set(phoneRows.map((r) => r.phoneE164).filter((p): p is string => !!p)),
  });

  return c.json({ ...report, max_rows: MAX_VALIDATE_ROWS });
});

// ── POST /lead-imports/n8n ────────────────────────────────
//
// The URL has a default so the feature works on a fresh checkout; the SECRET
// never does. A missing or still-placeholder secret returns 503 with a message
// the UI shows verbatim — the one thing this must never do is pretend a file was
// handed over when it wasn't.
const N8N_IMPORT_URL_DEFAULT = "https://n8n.srv1131703.hstgr.cloud/webhook/leads-import";

/**
 * The secret travels as a REQUEST HEADER, not a body field. Three reasons, in
 * order of how much they matter here:
 *   1. The body is multipart/form-data carrying the user's spreadsheet. n8n
 *      persists incoming webhook bodies in its execution history (binary data
 *      included) and renders form fields as item JSON, so a secret in the body
 *      is a secret written into every stored execution and visible to anyone who
 *      can open the workflow's run log. Headers are not part of that item JSON.
 *   2. n8n's built-in "Header Auth" credential checks the header at the webhook
 *      node itself, so a wrong secret is rejected before the workflow body — and
 *      before the file — is processed at all.
 *   3. It keeps the transport identical to how this codebase already signs
 *      outbound calls (services/webhooks.ts sends X-Webhook-Secret), so there is
 *      one convention to configure on the n8n side rather than two.
 */
const N8N_SECRET_HEADER = "X-Seekers-Import-Secret";

/** n8n is a self-hosted VPS box; 20s covers a cold workflow start plus the upload. */
const N8N_TIMEOUT_MS = 20_000;

const ALLOWED_EXTENSIONS = ["csv", "tsv", "txt", "xlsx", "xls"];

// The non-file parts of the multipart body. Everything arrives as a string from
// `parseBody()`, hence `z.coerce` — but it is still validated, not trusted.
const forwardMetaSchema = z.object({
  row_count: z.coerce.number().int().nonnegative().max(1_000_000).optional(),
  mode:      z.enum(["skip", "update"]).optional(),
  force:     z.enum(["true", "false"]).optional(),
});

leadImports.post("/n8n", authMiddleware, adminOnly, async (c) => {
  const user = c.get("user");

  const secret = process.env.N8N_LEADS_IMPORT_SECRET;
  if (!secret || secret.startsWith("replace-")) {
    return c.json({
      error: "The n8n import handoff is not configured on this server (N8N_LEADS_IMPORT_SECRET is missing). " +
             "Leads were not sent to n8n.",
    }, 503);
  }
  const url = process.env.N8N_LEADS_IMPORT_URL ?? N8N_IMPORT_URL_DEFAULT;

  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || typeof file === "string") {
    return c.json({ error: "A file is required" }, 400);
  }

  const meta = forwardMetaSchema.parse({
    row_count: body["row_count"] === "" ? undefined : body["row_count"],
    mode:      body["mode"]      === "" ? undefined : body["mode"],
    force:     body["force"]     === "" ? undefined : body["force"],
  });

  const originalName = file.name || "import";
  const ext = originalName.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return c.json({
      error: `File type ".${ext}" is not accepted. Supported: ${ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(", ")}`,
    }, 400);
  }

  const maxMb = Number(process.env.MAX_FILE_SIZE_MB ?? 50);
  if (file.size > maxMb * 1024 * 1024) {
    return c.json({ error: `File exceeds the ${maxMb} MB limit` }, 400);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const fingerprint = importFingerprint(bytes);

  if (meta.force !== "true") {
    const ageMs = recentForwardAgeMs(fingerprint);
    if (ageMs !== null) {
      // A double-tap is milliseconds apart, so "1 minute ago" would read as a
      // bug rather than as an explanation. Say what actually happened.
      const minutes = Math.round(ageMs / 60_000);
      const ago = minutes < 1 ? "moments ago" : `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
      return c.json({
        error: `This exact file was already sent to n8n ${ago}. ` +
               `Sending it again would run the workflow twice.`,
        duplicate: true,
        fingerprint,
        window_minutes: Math.round(FORWARD_DEDUPE_WINDOW_MS / 60_000),
      }, 409);
    }
  }

  // `imported_on` is the Cairo calendar day, not the UTC one. n8n buckets
  // imports by this value; taken from toISOString() an import at 00:30 Cairo
  // would be filed under the previous day. See utils/dates.ts.
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: file.type || "application/octet-stream" }), originalName);
  form.append("file_name",   originalName);
  form.append("fingerprint", fingerprint);
  form.append("imported_on", cairoToday());
  form.append("imported_by", user.name);
  form.append("imported_by_id", user.id);
  if (meta.row_count !== undefined) form.append("row_count", String(meta.row_count));
  if (meta.mode) form.append("mode", meta.mode);

  let res: Response;
  try {
    res = await fetch(url, {
      method:  "POST",
      headers: {
        [N8N_SECRET_HEADER]: secret,
        "User-Agent":        "SeekersCRM-LeadImport/1.0",
        // Content-Type is intentionally unset: fetch derives
        // `multipart/form-data; boundary=…` from the FormData body, and setting
        // it by hand omits the boundary and makes the upload unparseable.
      },
      body:   form,
      signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
    });
  } catch (err: any) {
    // Timeouts surface as a DOMException named TimeoutError; everything else is
    // DNS/TLS/connection-refused. Both are reported as what they are — a 502
    // with a readable reason — never swallowed into a success response.
    const timedOut = err?.name === "TimeoutError";
    console.error("[lead-import] n8n handoff failed:", err?.message ?? err);
    return c.json({
      error: timedOut
        ? `n8n did not respond within ${N8N_TIMEOUT_MS / 1000}s. The leads are saved in the CRM; the n8n workflow may or may not have run.`
        : `Could not reach the n8n import workflow: ${String(err?.message ?? err).slice(0, 200)}`,
      timeout: timedOut,
    }, 502);
  }

  const responseText = (await res.text().catch(() => "")).slice(0, 1000);

  if (!res.ok) {
    console.error(`[lead-import] n8n returned ${res.status}:`, responseText.slice(0, 300));
    return c.json({
      error: `n8n rejected the file (HTTP ${res.status})` +
             (responseText ? `: ${responseText.slice(0, 300)}` : ""),
      upstream_status: res.status,
    }, 502);
  }

  // Only remembered on success. A failed forward must stay retryable — the
  // duplicate guard is there to stop the workflow running twice, not to stop a
  // file that never arrived from being sent at all.
  recordForward(fingerprint);

  return c.json({
    forwarded:       true,
    upstream_status: res.status,
    fingerprint,
    response:        responseText,
  });
});

export default leadImports;
