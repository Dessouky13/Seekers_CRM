// Bulk lead import: paste rows straight from Google Sheets/Excel, or upload a
// CSV. Both paths share one pipeline — parse -> map columns -> preview ->
// import -> results — so there is exactly one place dedupe and mapping logic
// can go wrong, not two.
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
  Upload, FileText, ClipboardPaste, AlertCircle, CheckCircle2, X, Loader2, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useBulkIngest, type BulkIngestPayload, type BulkIngestResult } from "@/hooks/useOutreach";
import { parseDelimited } from "@/lib/import-parse";
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

interface ImportRow { [key: string]: string }
type DedupeMode = BulkIngestPayload["mode"] & string;

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

/** Build the ingest payload for one row from the column mapping. Shared by
 *  the live preview and the actual import so they can never disagree. */
function buildLeadFromRow(row: ImportRow, mapping: Record<string, TargetField>): BulkIngestPayload["leads"][number] | null {
  const lead: any = {};
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

  return lead.name && lead.company ? lead : null;
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
  const bulk = useBulkIngest();

  const loadTable = (text: string, sourceLabel: string) => {
    const { headers: hdrs, rows: data } = parseDelimited(text);
    if (data.length === 0) {
      toast.error(hdrs.length === 0 ? `${sourceLabel} looks empty or unreadable` : `No data rows found — is the first row a header?`);
      return;
    }
    setHeaders(hdrs);
    setMapping(detectMapping(hdrs));
    setRows(data);
    setResult(null);
    toast.success(`Loaded ${data.length} row${data.length === 1 ? "" : "s"}`);
  };

  const handleFile = (file: File) => {
    file.text()
      .then((text) => loadTable(text, "File"))
      .catch(() => toast.error("Could not read that file"));
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = ""; // allow re-upload of same file
  };

  const handleParsePaste = () => {
    if (!pasteText.trim()) { toast.error("Paste some rows first"); return; }
    loadTable(pasteText, "Pasted text");
  };

  const reset = () => {
    setRows([]); setHeaders([]); setMapping({}); setResult(null); setPasteText(""); setShowErrors(false);
  };

  // Check required fields are mapped
  const mappedTargets = new Set(Object.values(mapping));
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedTargets.has(f));
  const hasNameOrParts  = mappedTargets.has("name") || (mappedTargets.has("first_name") && mappedTargets.has("last_name"));
  const canImport = rows.length > 0 && missingRequired.length === 0 && hasNameOrParts;

  // First few rows exactly as they will be sent, for the preview table.
  const previewLeads = useMemo(
    () => rows.slice(0, 5).map((r) => buildLeadFromRow(r, mapping)),
    [rows, mapping],
  );

  const handleImport = () => {
    const leadsToImport: BulkIngestPayload["leads"] = [];
    for (const row of rows) {
      const lead = buildLeadFromRow(row, mapping);
      if (lead) leadsToImport.push(lead);
    }

    if (leadsToImport.length === 0) {
      toast.error("No valid rows after mapping. Check your column assignments.");
      return;
    }

    // Send in batches of 500 (backend max)
    const batches: typeof leadsToImport[] = [];
    for (let i = 0; i < leadsToImport.length; i += 500) batches.push(leadsToImport.slice(i, i + 500));

    (async () => {
      const totals: BulkIngestResult = { total: 0, created: 0, updated: 0, skipped: 0, errors: 0, created_ids: [], error_rows: [] };
      for (const batch of batches) {
        const res = await bulk.mutateAsync({ leads: batch, mode: dedupeMode });
        totals.total       += res.total;
        totals.created      += res.created;
        totals.updated       += res.updated;
        totals.skipped       += res.skipped;
        totals.errors       += res.errors;
        totals.created_ids.push(...res.created_ids);
        totals.error_rows.push(...res.error_rows);
      }
      setResult(totals);
      toast.success(
        `Imported ${totals.created} new lead${totals.created === 1 ? "" : "s"}` +
        (totals.updated > 0 ? ` · ${totals.updated} updated` : "") +
        (totals.skipped > 0 ? ` · ${totals.skipped} skipped` : ""),
      );
    })().catch((err) => toast.error(err.message));
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
        Paste rows copied from Google Sheets or Excel, or upload a CSV exported from Apollo, Sales Navigator, Snov.io, ZoomInfo, etc.
        We auto-detect the columns and let you tweak the mapping before anything is saved. <strong>Idempotent</strong> — importing the
        same rows twice will not create duplicates; existing leads are matched by email (or name+company when there's no email).
      </p>

      {rows.length === 0 ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as "paste" | "file")}>
          <TabsList>
            <TabsTrigger value="paste" className="gap-1.5 min-h-9"><ClipboardPaste className="h-3.5 w-3.5" /> Paste</TabsTrigger>
            <TabsTrigger value="file"  className="gap-1.5 min-h-9"><FileText className="h-3.5 w-3.5" /> CSV file</TabsTrigger>
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
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
              onDragOver={(e) => e.preventDefault()}
              className={cn(
                "flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed",
                "border-border bg-muted/20 p-8 text-center transition-colors hover:border-primary/40 hover:bg-muted/40",
                // Visible keyboard focus even though the real input is sr-only —
                // `peer` on the input lets this label react to ITS focus state.
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
              )}
            >
              <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Drop a CSV file here</p>
              <p className="text-xs text-muted-foreground mt-1">or click to browse (Tab + Enter also works)</p>
              <input
                ref={fileRef}
                id="csv-file-input"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileInputChange}
                className="sr-only peer"
              />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Exported columns don't need to match ours exactly — the next step lets you map any header to a CRM field.
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
                    onValueChange={(v) => setMapping({ ...mapping, [h]: v === "_skip" ? "" : v as TargetField })}
                  >
                    <SelectTrigger className="w-44 h-8 min-h-9 text-xs"><SelectValue /></SelectTrigger>
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
                        <th key={h} className="px-2.5 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
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
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
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

          {/* Action */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">
              <Badge variant="outline" className="mr-1">{rows.length}</Badge>
              rows ready · {Object.values(mapping).filter(Boolean).length} columns mapped
            </p>
            <Button
              onClick={handleImport}
              disabled={!canImport || bulk.isPending}
              size="sm"
              className="min-h-11 gap-1.5"
            >
              {bulk.isPending ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Importing…</>
              ) : (
                <><Upload className="h-3 w-3" /> Import {rows.length} lead{rows.length === 1 ? "" : "s"}</>
              )}
            </Button>
          </div>
        </>
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
