// Bulk lead import: paste rows straight from Google Sheets/Excel, or upload a
// CSV / .xlsx. All three paths share one pipeline — parse -> map columns ->
// pre-flight check -> preview -> import -> results — so there is exactly one
// place dedupe and mapping logic can go wrong, not three.
//
// WHERE XLSX IS PARSED, AND WHY IT IS THE BROWSER
// `read-excel-file/browser` unzips the workbook client-side and
// `sheetRowsToTable` folds the result into the same `{ headers, rows }` the CSV
// path already produced. Parsing on the server was the alternative and is worse
// here for three concrete reasons:
//   1. Nothing is saved until the user presses Import. The column mapping and
//      the preview both need the rows in hand; a server parser would mean an
//      upload round-trip just to render a preview of a file the user may then
//      abandon.
//   2. It would put a zip + XML parser on the request path of the API process
//      that also runs the outreach scheduler and the inbox poller. A 20 MB
//      workbook is CPU the browser has to spare and the VPS does not.
//   3. One parser output shape means the mapping, validation and import steps
//      cannot behave differently for .xlsx than for .csv.
// The chosen library is `read-excel-file` (MIT, last published 2026-07): the
// npm `xlsx` package is pinned at 0.18.5 from 2022 with two unpatched
// advisories (the fixes were never published to npm), and `exceljs` is a 21 MB
// Node-oriented package for a job that is "give me the cells".
//
// Accessibility: the file dropzone used to be a `<div onClick>` with the real
// `<input type=file>` set to `className="hidden"`. `hidden` (and `display:
// none`) removes an element from the tab order entirely, so a keyboard user
// could never reach it — clicking was the only way in. It's now a `<label>`
// (natively activates its control on click AND is reachable by tabbing to the
// input it points at) wrapping an `sr-only` input, which stays focusable and
// keyboard-operable (Enter/Space opens the file picker) while visually hidden.
import { useMemo, useRef, useState } from "react";
import {
  Upload, FileText, ClipboardPaste, AlertCircle, AlertTriangle, CheckCircle2, X,
  Loader2, ChevronDown, Send, RefreshCw, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useBulkIngest, type BulkIngestPayload, type BulkIngestResult } from "@/hooks/useOutreach";
import {
  useValidateImportRows, useForwardImportFile, type ImportValidationReport,
} from "@/hooks/useLeadImport";
import { parseDelimited, sheetRowsToTable, importFileKind, type ParsedTable } from "@/lib/import-parse";
import { cn } from "@/lib/utils";

// Common header variations we auto-detect.
const FIELD_ALIASES: Record<string, string[]> = {
  name:       ["name", "full_name", "fullname", "contact_name", "contact name", "lead_name", "full name"],
  first_name: ["first_name", "firstname", "first name", "given_name"],
  last_name:  ["last_name", "lastname", "last name", "surname", "family_name"],
  company:    ["company", "company_name", "organization", "organization_name", "account", "account_name", "business", "business_name"],
  email:      ["email", "email_address", "work_email", "email address", "e-mail"],
  phone:      ["phone", "phone_number", "mobile", "telephone", "tel", "cell", "phone number"],
  source:     ["source", "lead_source"],
  category:   ["category", "niche", "industry", "vertical", "segment"],
  notes:      ["notes", "note", "comment", "comments", "description"],
  deal_value: ["deal_value", "value", "deal_size", "estimated_value", "revenue"],
};

const REQUIRED_FIELDS = ["company"] as const;
const TARGET_FIELDS   = ["name", "company", "email", "phone", "source", "category", "deal_value", "notes"] as const;
type TargetField = (typeof TARGET_FIELDS)[number] | "first_name" | "last_name" | "";

/** Extensions the file picker and the n8n proxy both accept. */
const ACCEPTED_EXTENSIONS = ".csv,.tsv,.txt,.xlsx,.xls";
const ACCEPT_ATTR = `${ACCEPTED_EXTENSIONS},text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`;

/** Matches MAX_VALIDATE_ROWS on the server. Bigger files get their first
 *  2,000 rows checked, and the UI says so rather than implying a full pass. */
const VALIDATE_LIMIT = 2000;

/** The backend caps a single ingest call at 500 leads. */
const BATCH_SIZE = 500;

interface ImportRow { [key: string]: string }
type DedupeMode = BulkIngestPayload["mode"] & string;
type IngestLead = BulkIngestPayload["leads"][number];

/** Every mapped field, before the name/company requirement is applied. */
type MappedLead = Partial<IngestLead>;

/** Outcome of the optional n8n file handoff, kept beside the import result so
 *  the result screen can never show a bare success when the handoff failed. */
type HandoffStatus = "not_requested" | "sent" | "duplicate" | "failed";
interface Handoff { status: HandoffStatus; message?: string }

function detectMapping(headers: string[]): Record<string, TargetField> {
  const map: Record<string, TargetField> = {};
  for (const h of headers) {
    const low = h.toLowerCase().trim();
    let matched: TargetField = "";
    for (const target of Object.keys(FIELD_ALIASES) as TargetField[]) {
      if (FIELD_ALIASES[target!]?.some((alias) => alias === low)) {
        matched = target;
        break;
      }
    }
    map[h] = matched;
  }
  return map;
}

/** Apply the column mapping to one row. Returns whatever the mapping produced,
 *  WITHOUT the name+company requirement — the pre-flight check needs to see
 *  the rows that fail it in order to report them instead of dropping them. */
function mapRow(row: ImportRow, mapping: Record<string, TargetField>): MappedLead {
  const lead: MappedLead = {};
  let first = "", last = "";

  for (const [col, target] of Object.entries(mapping)) {
    if (!target) continue;
    const value = row[col]?.toString().trim();
    if (!value) continue;

    if (target === "first_name") first = value;
    else if (target === "last_name") last = value;
    else if (target === "deal_value") {
      const num = parseFloat(value.replace(/[^0-9.]/g, ""));
      if (!isNaN(num)) lead.deal_value = num;
    } else {
      lead[target] = value;
    }
  }

  if (!lead.name && (first || last)) lead.name = (first + " " + last).trim();
  if (!lead.name && lead.company) lead.name = lead.company;

  return lead;
}

/** Build the ingest payload for one row from the column mapping. Shared by
 *  the live preview and the actual import so they can never disagree. */
function buildLeadFromRow(row: ImportRow, mapping: Record<string, TargetField>): IngestLead | null {
  const lead = mapRow(row, mapping);
  return lead.name && lead.company ? { ...lead, name: lead.name, company: lead.company } : null;
}

/** Read `.status` off an error thrown by apiFetch without reaching for `any`. */
function errorInfo(err: unknown): { message: string; status?: number } {
  if (err instanceof Error) {
    return { message: err.message, status: (err as Error & { status?: number }).status };
  }
  return { message: String(err) };
}

export function CsvImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab,      setTab]      = useState<"paste" | "file">("paste");
  const [pasteText, setPasteText] = useState("");
  const [rows,     setRows]     = useState<ImportRow[]>([]);
  const [headers,  setHeaders]  = useState<string[]>([]);
  const [mapping,  setMapping]  = useState<Record<string, TargetField>>({});
  const [dedupeMode, setDedupeMode] = useState<DedupeMode>("update");
  const [result,   setResult]   = useState<BulkIngestResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  // ── File handoff state ──
  // The picked File is kept so it can be handed to n8n byte-for-byte AFTER the
  // rows are safely in Postgres. Paste has no file, so the handoff is simply
  // unavailable there rather than silently skipped.
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sendToN8n,  setSendToN8n]  = useState(true);
  const [handoff,    setHandoff]    = useState<Handoff>({ status: "not_requested" });
  const [parsing,    setParsing]    = useState(false);
  // ── Pre-flight check state ──
  const [validation,    setValidation]    = useState<ImportValidationReport | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [showIssues,    setShowIssues]    = useState(false);
  const [progress,      setProgress]      = useState<{ done: number; total: number } | null>(null);

  const bulk     = useBulkIngest();
  const validate = useValidateImportRows();
  const forward  = useForwardImportFile();

  /**
   * Ask the server to check the mapped rows.
   *
   * Called explicitly from the two places that change the inputs (a new table,
   * or a changed column mapping) rather than from a `useEffect` on the mapped
   * rows: the effect version re-ran on every keystroke-sized state change and
   * needed the row array in its dependency list, which is a new array every
   * render. Explicit calls also mean the request count is obvious from reading
   * the code.
   */
  const runValidation = (dataRows: ImportRow[], map: Record<string, TargetField>) => {
    const sample = dataRows.slice(0, VALIDATE_LIMIT).map((r) => {
      const lead = mapRow(r, map);
      return { name: lead.name, company: lead.company, email: lead.email, phone: lead.phone };
    });
    if (sample.length === 0) { setValidation(null); setValidateError(null); return; }

    validate.mutateAsync(sample)
      .then((report) => { setValidation(report); setValidateError(null); })
      .catch((err: unknown) => {
        // A failed pre-check must not block the import — it is advice, not a
        // gate. But it must be visible, so the user knows the rows were NOT
        // checked rather than assuming a clean sheet.
        setValidation(null);
        setValidateError(errorInfo(err).message);
      });
  };

  const applyTable = ({ headers: hdrs, rows: data }: ParsedTable, sourceLabel: string) => {
    if (data.length === 0) {
      toast.error(hdrs.length === 0 ? `${sourceLabel} looks empty or unreadable` : `No data rows found — is the first row a header?`);
      return;
    }
    const detected = detectMapping(hdrs);
    setHeaders(hdrs);
    setMapping(detected);
    setRows(data);
    setResult(null);
    setHandoff({ status: "not_requested" });
    setShowIssues(false);
    toast.success(`Loaded ${data.length} row${data.length === 1 ? "" : "s"}`);
    runValidation(data, detected);
  };

  const handleFile = async (file: File) => {
    setParsing(true);
    setSourceFile(file);
    setSendToN8n(true);
    try {
      if (importFileKind(file.name) === "spreadsheet") {
        // Dynamic import: the xlsx reader (unzip + XML) is only needed by the
        // people who actually upload a workbook, so it stays out of the main
        // bundle every page load pays for.
        const { readSheet } = await import("read-excel-file/browser");
        const sheet = await readSheet(file);
        applyTable(sheetRowsToTable(sheet), "That workbook");
      } else {
        applyTable(parseDelimited(await file.text()), "File");
      }
    } catch (err: unknown) {
      // Real reason, never a generic "failed". A password-protected or
      // corrupt-zip .xlsx is the common case and the message says so.
      setSourceFile(null);
      toast.error(`Could not read ${file.name}: ${errorInfo(err).message}`);
    } finally {
      setParsing(false);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = ""; // allow re-upload of same file
  };

  const handleParsePaste = () => {
    if (!pasteText.trim()) { toast.error("Paste some rows first"); return; }
    setSourceFile(null);   // nothing to hand to n8n from a paste
    applyTable(parseDelimited(pasteText), "Pasted text");
  };

  const reset = () => {
    setRows([]); setHeaders([]); setMapping({}); setResult(null); setPasteText("");
    setShowErrors(false); setSourceFile(null); setHandoff({ status: "not_requested" });
    setValidation(null); setValidateError(null); setShowIssues(false); setProgress(null);
  };

  const changeMapping = (header: string, target: TargetField) => {
    const next = { ...mapping, [header]: target };
    setMapping(next);
    runValidation(rows, next);
  };

  // Check required fields are mapped
  const mappedTargets = new Set(Object.values(mapping));
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedTargets.has(f));
  const hasNameOrParts  = mappedTargets.has("name") || (mappedTargets.has("first_name") && mappedTargets.has("last_name"));
  const canImport = rows.length > 0 && missingRequired.length === 0 && hasNameOrParts;

  // Rows the server said cannot be imported. They are dropped from the payload
  // rather than blocking the whole file: an invalid email in row 417 used to
  // fail Zod validation for the entire 500-row batch, so 499 good leads never
  // landed because of one typo.
  const blockingIndexes = useMemo(() => {
    const set = new Set<number>();
    for (const row of validation?.rows ?? []) {
      if (row.issues.some((i) => i.blocking)) set.add(row.index);
    }
    return set;
  }, [validation]);

  const importableCount = Math.max(0, rows.length - blockingIndexes.size);

  // First few rows exactly as they will be sent, for the preview table.
  const previewLeads = useMemo(
    () => rows.slice(0, 5).map((r) => buildLeadFromRow(r, mapping)),
    [rows, mapping],
  );

  /** Hand the raw file over. Extracted so the result screen can retry it
   *  without re-running the database import. */
  const forwardFile = async (file: File, rowCount: number, force = false): Promise<Handoff> => {
    try {
      await forward.mutateAsync({ file, rowCount, mode: dedupeMode, force });
      return { status: "sent" };
    } catch (err: unknown) {
      const { message, status } = errorInfo(err);
      return { status: status === 409 ? "duplicate" : "failed", message };
    }
  };

  const handleImport = () => {
    const leadsToImport: BulkIngestPayload["leads"] = [];
    rows.forEach((row, index) => {
      if (blockingIndexes.has(index)) return;
      const lead = buildLeadFromRow(row, mapping);
      if (lead) leadsToImport.push(lead);
    });

    if (leadsToImport.length === 0) {
      toast.error("No valid rows after mapping. Check your column assignments.");
      return;
    }

    const batches: BulkIngestPayload["leads"][] = [];
    for (let i = 0; i < leadsToImport.length; i += BATCH_SIZE) {
      batches.push(leadsToImport.slice(i, i + BATCH_SIZE));
    }

    (async () => {
      const totals: BulkIngestResult = { total: 0, created: 0, updated: 0, skipped: 0, errors: 0, created_ids: [], error_rows: [] };
      setProgress({ done: 0, total: batches.length });
      for (const [i, batch] of batches.entries()) {
        const res = await bulk.mutateAsync({ leads: batch, mode: dedupeMode });
        totals.total   += res.total;
        totals.created += res.created;
        totals.updated += res.updated;
        totals.skipped += res.skipped;
        totals.errors  += res.errors;
        totals.created_ids.push(...res.created_ids);
        totals.error_rows.push(...res.error_rows);
        setProgress({ done: i + 1, total: batches.length });
      }

      // The n8n handoff runs AFTER the database write, deliberately: the CRM
      // must end up holding the leads whether or not n8n is reachable. A failed
      // handoff is reported on the result screen with a retry, not rolled back.
      const outcome = sendToN8n && sourceFile
        ? await forwardFile(sourceFile, leadsToImport.length)
        : { status: "not_requested" as const };

      setProgress(null);
      setResult(totals);
      setHandoff(outcome);

      const summary =
        `Imported ${totals.created} new lead${totals.created === 1 ? "" : "s"}` +
        (totals.updated > 0 ? ` · ${totals.updated} updated` : "") +
        (totals.skipped > 0 ? ` · ${totals.skipped} skipped` : "");

      // Never a plain success toast when the handoff failed — the leads are in,
      // but n8n did not get the file and the user has to know.
      if (outcome.status === "failed" || outcome.status === "duplicate") {
        toast.warning(`${summary} — but the n8n handoff did not complete`, { description: outcome.message });
      } else {
        toast.success(summary + (outcome.status === "sent" ? " · file sent to n8n" : ""));
      }
    })().catch((err: unknown) => {
      setProgress(null);
      toast.error(errorInfo(err).message);
    });
  };

  const retryHandoff = (force: boolean) => {
    if (!sourceFile) return;
    void forwardFile(sourceFile, result?.total ?? rows.length, force).then((outcome) => {
      setHandoff(outcome);
      if (outcome.status === "sent") toast.success("File sent to n8n");
      else toast.error(outcome.message ?? "The n8n handoff failed again");
    });
  };

  if (result) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <h3 className="text-sm font-semibold">Import complete</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <StatTile label="Total rows" value={result.total} />
          <StatTile label="Created"    value={result.created} tone="success" />
          <StatTile label="Updated"    value={result.updated} tone="info" />
          <StatTile label="Skipped"    value={result.skipped} tone="muted" />
          <StatTile label="Errors"     value={result.errors}  tone={result.errors > 0 ? "destructive" : "muted"} />
        </div>

        {/* n8n handoff outcome — success and failure are equally explicit */}
        {handoff.status !== "not_requested" && (
          <div
            className={cn(
              "rounded-lg border p-3 space-y-2",
              handoff.status === "sent"
                ? "border-success/30 bg-success/5"
                : "border-destructive/30 bg-destructive/5",
            )}
          >
            <div className="flex items-start gap-2">
              {handoff.status === "sent"
                ? <Send className="h-3.5 w-3.5 shrink-0 mt-0.5 text-success" />
                : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-destructive" />}
              <div className="min-w-0 space-y-0.5">
                <p className={cn("text-xs font-medium", handoff.status === "sent" ? "text-success" : "text-destructive")}>
                  {handoff.status === "sent" && "File handed to the n8n import workflow"}
                  {handoff.status === "duplicate" && "n8n did not run — this file was already sent"}
                  {handoff.status === "failed" && "The n8n handoff failed"}
                </p>
                {handoff.message && <p className="text-xs text-muted-foreground break-words">{handoff.message}</p>}
                {handoff.status !== "sent" && (
                  <p className="text-[11px] text-muted-foreground">
                    The leads above <strong>are saved in the CRM</strong> — only the n8n copy is missing.
                  </p>
                )}
              </div>
            </div>
            {handoff.status !== "sent" && sourceFile && (
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => retryHandoff(handoff.status === "duplicate")}
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5"
                  disabled={forward.isPending}
                >
                  {forward.isPending
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Sending…</>
                    : <><RefreshCw className="h-3 w-3" /> {handoff.status === "duplicate" ? "Send anyway" : "Retry handoff"}</>}
                </Button>
              </div>
            )}
          </div>
        )}

        {result.error_rows.length > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5">
            <button
              type="button"
              onClick={() => setShowErrors((s) => !s)}
              className="flex w-full min-h-11 items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-destructive"
            >
              <span>{result.error_rows.length} row{result.error_rows.length === 1 ? "" : "s"} failed — see why</span>
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", showErrors && "rotate-180")} />
            </button>
            {showErrors && (
              <div className="max-h-48 overflow-y-auto border-t border-destructive/20 divide-y divide-destructive/10">
                {result.error_rows.map((e, i) => (
                  <div key={i} className="px-3 py-2 text-xs">
                    <span className="font-medium text-destructive">Row {e.index + 1}:</span>{" "}
                    <span className="text-muted-foreground">{e.error}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <Button onClick={reset} variant="outline" size="sm" className="min-h-11">Import another batch</Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Upload className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Import Leads</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Paste rows copied from Google Sheets or Excel, or upload a <strong>CSV or .xlsx</strong> exported from Apollo, Sales Navigator,
        Snov.io, ZoomInfo, etc. We auto-detect the columns, check every row, and let you tweak the mapping before anything is saved.
        {" "}<strong>Idempotent</strong> — importing the same rows twice will not create duplicates; existing leads are matched by email
        (or name+company when there's no email).
      </p>

      {rows.length === 0 ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "paste" | "file")}>
          <TabsList>
            <TabsTrigger value="paste" className="gap-1.5 min-h-9"><ClipboardPaste className="h-3.5 w-3.5" /> Paste</TabsTrigger>
            <TabsTrigger value="file"  className="gap-1.5 min-h-9"><FileText className="h-3.5 w-3.5" /> CSV / Excel</TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="space-y-2">
            <Label htmlFor="lead-paste-area">Paste rows (with a header row on top)</Label>
            <Textarea
              id="lead-paste-area"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"Name\tCompany\tEmail\tPhone\nJane Doe\tAcme Corp\tjane@acme.com\t+20 100 000 0000"}
              rows={6}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Select a range in Sheets or Excel, copy (Ctrl/Cmd+C), then paste here — tabs, commas and semicolons are all detected automatically.
            </p>
            <Button size="sm" className="min-h-11 gap-1.5" onClick={handleParsePaste} disabled={!pasteText.trim()}>
              <ClipboardPaste className="h-3.5 w-3.5" /> Preview import
            </Button>
          </TabsContent>

          <TabsContent value="file" className="space-y-2">
            <label
              htmlFor="csv-file-input"
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void handleFile(f); }}
              onDragOver={(e) => e.preventDefault()}
              className={cn(
                "flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed",
                "border-border bg-muted/20 p-8 text-center transition-colors hover:border-primary/40 hover:bg-muted/40",
                // Visible keyboard focus even though the real input is sr-only —
                // `peer` on the input lets this label react to ITS focus state.
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                parsing && "pointer-events-none opacity-60",
              )}
            >
              {parsing ? (
                <>
                  <Loader2 className="h-8 w-8 mx-auto text-muted-foreground mb-2 animate-spin" />
                  <p className="text-sm font-medium">Reading the file…</p>
                  <p className="text-xs text-muted-foreground mt-1">Large workbooks take a moment to unzip</p>
                </>
              ) : (
                <>
                  <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Drop a CSV or Excel file here</p>
                  <p className="text-xs text-muted-foreground mt-1">.csv, .tsv, .xlsx — or click to browse (Tab + Enter also works)</p>
                </>
              )}
              <input
                ref={fileRef}
                id="csv-file-input"
                type="file"
                accept={ACCEPT_ATTR}
                onChange={handleFileInputChange}
                className="sr-only peer"
              />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Exported columns don't need to match ours exactly — the next step lets you map any header to a CRM field.
              An .xlsx is read in your browser, so nothing leaves this device until you press Import.
            </p>
          </TabsContent>
        </Tabs>
      ) : (
        <>
          {/* Mapping UI */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Map columns → CRM fields
              </p>
              <Button variant="ghost" size="sm" className="h-8 min-h-9 text-xs gap-1" onClick={reset}>
                <X className="h-3 w-3" /> Start over
              </Button>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 divide-y divide-border max-h-64 overflow-y-auto">
              {headers.map((h) => (
                <div key={h} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{h}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      Sample: {rows[0]?.[h]?.toString().slice(0, 40) || "—"}
                    </p>
                  </div>
                  <Select
                    value={mapping[h] || "_skip"}
                    onValueChange={(v) => changeMapping(h, v === "_skip" ? "" : v as TargetField)}
                  >
                    <SelectTrigger className="w-36 sm:w-44 h-8 min-h-9 text-xs shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_skip" className="text-muted-foreground italic">Skip column</SelectItem>
                      <SelectItem value="name">→ Name (full)</SelectItem>
                      <SelectItem value="first_name">→ First name</SelectItem>
                      <SelectItem value="last_name">→ Last name</SelectItem>
                      <SelectItem value="company">→ Company *</SelectItem>
                      <SelectItem value="email">→ Email</SelectItem>
                      <SelectItem value="phone">→ Phone</SelectItem>
                      <SelectItem value="source">→ Source</SelectItem>
                      <SelectItem value="category">→ Category / Niche</SelectItem>
                      <SelectItem value="deal_value">→ Deal value</SelectItem>
                      <SelectItem value="notes">→ Notes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>

          {/* Validation */}
          {missingRequired.length > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>Required field missing: <strong>{missingRequired.join(", ")}</strong></span>
            </div>
          )}
          {!hasNameOrParts && (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>Map either <strong>Name</strong> or both <strong>First name + Last name</strong> (otherwise we'll fall back to company as the contact name)</span>
            </div>
          )}

          {/* Per-row pre-flight check: duplicates, missing fields, bad email/phone */}
          <RowCheck
            report={validation}
            error={validateError}
            pending={validate.isPending}
            totalRows={rows.length}
            open={showIssues}
            onToggle={() => setShowIssues((s) => !s)}
          />

          {/* Preview of what will actually be imported */}
          {canImport && previewLeads.some((l) => l) && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Preview — first {Math.min(rows.length, 5)} row{rows.length === 1 ? "" : "s"}
              </p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      {["Name", "Company", "Email", "Phone"].map((h) => (
                        <th key={h} className="px-2.5 py-1.5 text-start font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previewLeads.map((lead, i) => (
                      <tr key={i}>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{lead?.name ?? <span className="text-destructive">skipped</span>}</td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{lead?.company ?? "—"}</td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{lead?.email ?? "—"}</td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{lead?.phone ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Dedupe mode */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="dedupe-mode" className="text-xs">If a lead already exists</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="What does this mean?" className="text-muted-foreground min-h-6 min-w-6 grid place-items-center">
                    <AlertCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64 text-xs">
                  Matched by email, or by name + company when a row has no email. "Update" fills in blanks (source, category, phone)
                  without touching anything already set. "Skip" leaves the existing lead completely untouched.
                </TooltipContent>
              </Tooltip>
            </div>
            <Select value={dedupeMode} onValueChange={(v) => setDedupeMode(v as DedupeMode)}>
              <SelectTrigger id="dedupe-mode" className="w-40 h-8 min-h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="update">Update missing fields</SelectItem>
                <SelectItem value="skip">Skip it</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* n8n handoff — only offered when there is an actual file to hand over */}
          {sourceFile && (
            <label
              htmlFor="send-to-n8n"
              className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2.5"
            >
              <Checkbox
                id="send-to-n8n"
                checked={sendToN8n}
                onCheckedChange={(v) => setSendToN8n(v === true)}
                className="mt-0.5"
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block text-xs font-medium">Also send <span className="break-all">{sourceFile.name}</span> to the n8n import workflow</span>
                <span className="block text-[11px] text-muted-foreground">
                  Runs after the leads are saved here, for enrichment and follow-up automation. If n8n is unreachable the leads still
                  import and you'll be told the handoff failed. Sending the same file twice in 30 minutes is blocked so the workflow
                  can't run twice.
                </span>
              </span>
            </label>
          )}

          {/* Action */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">
              <Badge variant="outline" className="me-1">{importableCount}</Badge>
              row{importableCount === 1 ? "" : "s"} ready · {Object.values(mapping).filter(Boolean).length} columns mapped
              {blockingIndexes.size > 0 && (
                <span className="text-destructive"> · {blockingIndexes.size} will be skipped</span>
              )}
            </p>
            <Button
              onClick={handleImport}
              disabled={!canImport || bulk.isPending || forward.isPending || importableCount === 0}
              size="sm"
              className="min-h-11 gap-1.5"
            >
              {progress ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Importing {progress.done}/{progress.total}…</>
              ) : forward.isPending ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Sending to n8n…</>
              ) : bulk.isPending ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Importing…</>
              ) : (
                <><Upload className="h-3 w-3" /> Import {importableCount} lead{importableCount === 1 ? "" : "s"}</>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The pre-flight verdict on the mapped rows.
 *
 * Four states, all of them explicit: checking, could-not-check, clean, and
 * "here is what is wrong". The could-not-check state exists because the check is
 * a network call — silently showing nothing would read identically to a clean
 * sheet, which is the worst possible ambiguity right before a 5,000-row write.
 */
function RowCheck({ report, error, pending, totalRows, open, onToggle }: {
  report:    ImportValidationReport | null;
  error:     string | null;
  pending:   boolean;
  totalRows: number;
  open:      boolean;
  onToggle:  () => void;
}) {
  if (pending) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span>Checking {totalRows.toLocaleString()} row{totalRows === 1 ? "" : "s"} for duplicates and bad emails…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Couldn't pre-check these rows: {error}. You can still import — duplicates are caught server-side either way — but
          bad emails and existing phone numbers won't have been flagged first.
        </span>
      </div>
    );
  }

  if (!report) return null;

  const partial = report.total < totalRows;

  if (report.rows.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-2 text-xs text-success">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        <span>
          All {report.total.toLocaleString()} checked row{report.total === 1 ? "" : "s"} look good — no duplicates, no invalid emails or phone numbers.
          {partial && ` (First ${report.max_rows.toLocaleString()} of ${totalRows.toLocaleString()} rows checked.)`}
        </span>
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-lg border",
      report.blocking > 0 ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/10",
    )}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full min-h-11 items-center justify-between gap-2 px-3 py-2 text-start text-xs font-medium",
          report.blocking > 0 ? "text-destructive" : "text-warning",
        )}
      >
        <span>
          {report.blocking > 0 && (
            <>{report.blocking.toLocaleString()} row{report.blocking === 1 ? "" : "s"} can't be imported</>
          )}
          {report.blocking > 0 && report.warnings > 0 && " · "}
          {report.warnings > 0 && (
            <>{report.warnings.toLocaleString()} to double-check</>
          )}
          {" — see details"}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-border/40">
          <p className="px-3 py-1.5 text-[10px] text-muted-foreground">
            Row numbers count data rows, not the header row.
            {partial && ` Only the first ${report.max_rows.toLocaleString()} of ${totalRows.toLocaleString()} rows were checked.`}
            {report.blocking > 0 && " Rows marked \"can't import\" are left out of the import; everything else still goes in."}
          </p>
          <div className="max-h-56 overflow-y-auto border-t border-border/40 divide-y divide-border/40">
            {report.rows.slice(0, 100).map((row) => (
              <div key={row.index} className="px-3 py-2 text-xs">
                <span className="font-medium">Row {row.index + 1}:</span>
                <ul className="mt-0.5 space-y-0.5">
                  {row.issues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                      <span className={cn(
                        "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                        issue.blocking ? "bg-destructive" : "bg-warning",
                      )} />
                      <span className="min-w-0 break-words">
                        {issue.message}
                        {issue.blocking && <span className="text-destructive"> (can't import)</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {report.rows.length > 100 && (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">
                …and {(report.rows.length - 100).toLocaleString()} more row{report.rows.length - 100 === 1 ? "" : "s"} with issues.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, tone = "default" }: {
  label: string;
  value: number;
  tone?: "default" | "success" | "info" | "muted" | "destructive";
}) {
  const toneClass = {
    default:     "border-border text-foreground",
    success:     "border-success/30 text-success",
    info:        "border-info/30 text-info",
    muted:       "border-border text-muted-foreground",
    destructive: "border-destructive/30 text-destructive",
  }[tone];
  return (
    <div className={cn("rounded-lg bg-card border p-2.5", toneClass)}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
