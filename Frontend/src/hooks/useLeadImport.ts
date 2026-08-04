// Hooks for the two server calls that wrap a bulk lead import:
//   • pre-flight row validation  → POST /lead-imports/validate
//   • the n8n file handoff       → POST /lead-imports/n8n
//
// The n8n webhook's shared secret is NOT here and must never be. Everything in
// Frontend/ ships as a public bundle (and `vite build` inlines every
// `import.meta.env.VITE_*` literally), so the browser uploads the file to our own
// API with its normal JWT and the backend attaches the secret server-side. The
// n8n URL isn't here either — the backend holds both.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { invalidateLeadQueries } from "@/hooks/useCRM";

// ── Pre-flight validation ────────────────────────────────

/** Mirrors `RowIssueCode` in backend/src/services/lead-import.ts. */
export type ImportIssueCode =
  | "missing_required"
  | "invalid_email"
  | "invalid_phone"
  | "landline_phone"
  | "duplicate_email_in_file"
  | "duplicate_phone_in_file"
  | "duplicate_email_existing"
  | "duplicate_phone_existing";

export interface ImportRowIssue {
  code:     ImportIssueCode;
  field:    "row" | "email" | "phone";
  message:  string;
  /** True when the row cannot be imported at all and must be dropped. */
  blocking: boolean;
}

export interface ImportValidationReport {
  total:    number;
  clean:    number;
  blocking: number;
  warnings: number;
  counts:   Partial<Record<ImportIssueCode, number>>;
  /** Only rows WITH issues, in sheet order. */
  rows:     { index: number; issues: ImportRowIssue[] }[];
  max_rows: number;
}

/** The four fields the pre-flight check looks at. */
export interface ValidatableLead {
  name?:    string | null;
  company?: string | null;
  email?:   string | null;
  phone?:   string | null;
}

/**
 * Server-side row check. Deliberately a server call rather than a copy of the
 * rules in the browser: it is the only way to compare against leads ALREADY in
 * the CRM, and the phone rules live in one dialling-plan classifier
 * (backend/src/services/phone.ts) that WhatsApp routing also uses. A second
 * browser-side phone validator would be a second thing to keep in step.
 */
export function useValidateImportRows() {
  return useMutation({
    mutationFn: (leads: ValidatableLead[]) =>
      apiFetch<ImportValidationReport>("/lead-imports/validate", {
        method: "POST",
        body:   JSON.stringify({ leads }),
      }),
  });
}

// ── n8n handoff ──────────────────────────────────────────

export interface ForwardResult {
  forwarded:       true;
  upstream_status: number;
  fingerprint:     string;
  response:        string;
}

export interface ForwardVars {
  file:      File;
  rowCount?: number;
  mode?:     "skip" | "update";
  /** Resend a file the server already forwarded inside its dedupe window. */
  force?:    boolean;
}

/**
 * Hand the raw file to the n8n import workflow through our own backend.
 *
 * Failure modes the caller must distinguish, all surfaced as a thrown Error
 * carrying `.status` (see lib/api.ts):
 *   503 — the handoff isn't configured on this server (no secret set)
 *   409 — this exact file was already forwarded recently (`body.duplicate`)
 *   502 — n8n unreachable, timed out, or returned a non-2xx
 * None of them are silent, and none of them are reported as success.
 */
export function useForwardImportFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, rowCount, mode, force }: ForwardVars) => {
      const form = new FormData();
      form.append("file", file, file.name);
      if (rowCount !== undefined) form.append("row_count", String(rowCount));
      if (mode) form.append("mode", mode);
      if (force) form.append("force", "true");
      return apiFetch<ForwardResult>("/lead-imports/n8n", { method: "POST", body: form });
    },
    // The n8n workflow enriches and POSTs leads back through
    // /outreach/leads/ingest, so rows can land seconds after the handoff. Using
    // the shared dependant list rather than a hand-picked subset is the point —
    // partial invalidation is what left the pipeline summary stale before.
    onSuccess: () => invalidateLeadQueries(qc),
  });
}
