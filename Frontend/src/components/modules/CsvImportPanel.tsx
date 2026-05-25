import { useState, useRef } from "react";
import Papa from "papaparse";
import { Upload, FileText, AlertCircle, CheckCircle2, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useBulkIngest, type BulkIngestPayload } from "@/hooks/useOutreach";
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

interface CsvRow { [key: string]: string }

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

export function CsvImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows,    setRows]    = useState<CsvRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, TargetField>>({});
  const [result,  setResult]  = useState<{ created: number; deduped: number; errors: number; total: number } | null>(null);
  const bulk = useBulkIngest();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse<CsvRow>(file, {
      header:    true,
      skipEmptyLines: true,
      complete:  (res) => {
        const data = res.data.filter((r) => Object.values(r).some((v) => v && String(v).trim()));
        if (data.length === 0) {
          toast.error("CSV looks empty or unreadable");
          return;
        }
        const hdrs = res.meta.fields ?? [];
        setHeaders(hdrs);
        setMapping(detectMapping(hdrs));
        setRows(data);
        setResult(null);
        toast.success(`Loaded ${data.length} row${data.length === 1 ? "" : "s"}`);
      },
      error: (err) => toast.error(`Parse error: ${err.message}`),
    });
    e.target.value = ""; // allow re-upload of same file
  };

  const reset = () => {
    setRows([]); setHeaders([]); setMapping({}); setResult(null);
  };

  // Check required fields are mapped
  const mappedTargets = new Set(Object.values(mapping));
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedTargets.has(f));
  const hasNameOrParts  = mappedTargets.has("name") || (mappedTargets.has("first_name") && mappedTargets.has("last_name"));
  const canImport = rows.length > 0 && missingRequired.length === 0 && hasNameOrParts;

  const handleImport = () => {
    const leads: BulkIngestPayload["leads"] = [];
    for (const row of rows) {
      const lead: any = {};
      let first = "", last = "";

      for (const [csvCol, target] of Object.entries(mapping)) {
        if (!target) continue;
        const value = row[csvCol]?.toString().trim();
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

      // Build name from first/last if not directly mapped
      if (!lead.name && (first || last)) lead.name = (first + " " + last).trim();
      // Default name to company if still missing (some lists are company-only)
      if (!lead.name && lead.company) lead.name = lead.company;

      if (lead.name && lead.company) leads.push(lead);
    }

    if (leads.length === 0) {
      toast.error("No valid rows after mapping. Check your column assignments.");
      return;
    }

    // Send in batches of 500 (backend max)
    const batches: typeof leads[] = [];
    for (let i = 0; i < leads.length; i += 500) batches.push(leads.slice(i, i + 500));

    (async () => {
      let totals = { total: 0, created: 0, deduped: 0, errors: 0 };
      for (const batch of batches) {
        const res = await bulk.mutateAsync({ leads: batch });
        totals.total   += res.total;
        totals.created += res.created;
        totals.deduped += res.deduped;
        totals.errors  += res.errors;
      }
      setResult(totals);
      toast.success(`Imported ${totals.created} new lead${totals.created === 1 ? "" : "s"} (${totals.deduped} already existed)`);
    })().catch((err) => toast.error(err.message));
  };

  if (result) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/5 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <h3 className="text-sm font-semibold">Import complete</h3>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg bg-card border border-border p-3">
            <p className="text-xs text-muted-foreground">Total rows</p>
            <p className="text-xl font-semibold tabular-nums">{result.total}</p>
          </div>
          <div className="rounded-lg bg-card border border-success/30 p-3">
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="text-xl font-semibold tabular-nums text-success">{result.created}</p>
          </div>
          <div className="rounded-lg bg-card border border-info/30 p-3">
            <p className="text-xs text-muted-foreground">Already existed</p>
            <p className="text-xl font-semibold tabular-nums text-info">{result.deduped}</p>
          </div>
          <div className="rounded-lg bg-card border border-destructive/30 p-3">
            <p className="text-xs text-muted-foreground">Errors</p>
            <p className={cn("text-xl font-semibold tabular-nums", result.errors > 0 ? "text-destructive" : "text-muted-foreground")}>{result.errors}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={reset} variant="outline" size="sm">Import another</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Upload className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Import Leads from CSV</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Upload a CSV exported from Apollo, Sales Navigator, Snov.io, ZoomInfo, etc. We'll auto-detect the columns and let you tweak the mapping before import. <strong>Idempotent by email</strong> — existing leads get refreshed, not duplicated.
      </p>

      {rows.length === 0 ? (
        <div
          onClick={() => fileRef.current?.click()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0] && fileRef.current) { fileRef.current.files = e.dataTransfer.files; handleFile({ target: fileRef.current } as any); } }}
          onDragOver={(e) => e.preventDefault()}
          className="rounded-lg border-2 border-dashed border-border bg-muted/20 p-8 text-center cursor-pointer hover:border-primary/40 hover:bg-muted/40 transition-colors"
        >
          <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-medium">Drop a CSV file here</p>
          <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
        </div>
      ) : (
        <>
          {/* Mapping UI */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Map CSV columns → CRM fields
              </p>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={reset}>
                <X className="h-3 w-3" /> Clear
              </Button>
            </div>
            <div className="rounded-lg border border-border bg-muted/20 divide-y divide-border max-h-64 overflow-y-auto">
              {headers.map((h) => (
                <div key={h} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{h}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      Sample: {rows[0]?.[h]?.toString().slice(0, 40) ?? "—"}
                    </p>
                  </div>
                  <Select
                    value={mapping[h] || "_skip"}
                    onValueChange={(v) => setMapping({ ...mapping, [h]: v === "_skip" ? "" : v as TargetField })}
                  >
                    <SelectTrigger className="w-44 h-7 text-xs"><SelectValue /></SelectTrigger>
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

          {/* Action */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">
              <Badge variant="outline" className="mr-1">{rows.length}</Badge>
              rows ready · {Object.values(mapping).filter(Boolean).length} columns mapped
            </p>
            <Button
              onClick={handleImport}
              disabled={!canImport || bulk.isPending}
              size="sm"
              className="gap-1.5"
            >
              {bulk.isPending ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Importing…</>
              ) : (
                <><Upload className="h-3 w-3" /> Import {rows.length} Leads</>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
