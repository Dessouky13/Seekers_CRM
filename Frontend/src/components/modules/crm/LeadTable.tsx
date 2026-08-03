// Notion-style table view of leads (was `NotionTable` inside CRM.tsx): header
// row with select-all, one row per lead with stage/niche/source chips, deal
// value, staleness flag and per-row selection checkbox.

import { ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LEAD_STAGES, CATEGORY_CHIP, SOURCE_CHIP, fmt } from "./constants";
import type { ApiLead } from "@/lib/types";

const TABLE_COLUMNS = [
  { label: "Name",        cls: "w-[20%]" },
  { label: "Company",     cls: "w-[16%]" },
  { label: "Stage",       cls: "w-[13%]" },
  { label: "Niche",       cls: "w-[11%]" },
  { label: "Deal Value",  cls: "w-[10%] text-right" },
  { label: "Source",      cls: "w-[8%]" },
  { label: "Last Activity", cls: "w-[10%]" },
  { label: "Assigned",    cls: "w-[8%]" },
];

export function LeadTable({
  leads, onSelect, selectedIds, toggleOne, toggleAll,
}: {
  leads:       ApiLead[];
  onSelect:    (id: string) => void;
  selectedIds: Set<string>;
  toggleOne:   (id: string) => void;
  toggleAll:   () => void;
}) {
  const allSelected = leads.length > 0 && leads.every((l) => selectedIds.has(l.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  return (
    <>
      {/* ── Phone: stacked cards ──────────────────────────
          A nine-column table inside a horizontal scroller means dragging a
          375px viewport across a grid to read one lead — the columns to the
          right are effectively invisible. Same data, stacked. */}
      <div className="space-y-2 md:hidden">
        <div className="flex items-center gap-2 px-1 pb-1">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleAll}
            aria-label="Select all visible leads"
          />
          <span className="text-[11px] text-muted-foreground">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
          </span>
        </div>

        {leads.map((l) => {
          const stageInfo = LEAD_STAGES.find((s) => s.key === l.stage);
          const isStale = l.lastActivity
            ? (Date.now() - new Date(l.lastActivity).getTime()) > 2 * 24 * 60 * 60 * 1000
            : true;
          const isActive = !["closed_won", "closed_lost"].includes(l.stage);
          const checked  = selectedIds.has(l.id);
          return (
            <div
              key={l.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-3 transition-colors",
                checked ? "border-primary/50 bg-primary/5" : "border-border bg-card",
              )}
            >
              {/* Generous hit area — a bare 16px checkbox is a miss on touch. */}
              <button
                type="button"
                onClick={() => toggleOne(l.id)}
                aria-label={`Select ${l.name}`}
                className="-m-1 grid h-9 w-9 shrink-0 place-items-center"
              >
                <Checkbox checked={checked} tabIndex={-1} aria-hidden />
              </button>

              <button
                type="button"
                onClick={() => onSelect(l.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{l.name}</span>
                  {isStale && isActive && (
                    <span className="shrink-0 text-[10px] text-destructive" title="No activity in 2+ days">⚠</span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{l.company}</p>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded px-2 py-0.5 text-[11px] font-medium", stageInfo?.chip)}>
                    {stageInfo?.label}
                  </span>
                  {l.category && (
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", CATEGORY_CHIP)}>
                      {l.category}
                    </span>
                  )}
                  <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">
                    {fmt(l.dealValue)}
                  </span>
                </div>

                <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                  {l.assignee_name ?? "Unassigned"} · {l.lastActivity ?? "no activity"}
                </p>
              </button>

              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40" />
            </div>
          );
        })}
      </div>

      {/* ── Desktop: full table ── */}
      <div className="hidden rounded-lg border border-border/60 bg-card/30 md:block">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-border/60 bg-muted/20">
              <th className="w-[36px] px-3 py-2">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all visible rows"
                />
              </th>
              {TABLE_COLUMNS.map((h) => (
                <th
                  key={h.label}
                  className={cn(
                    "px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider",
                    h.cls,
                    h.cls.includes("text-right") ? "text-right" : "text-left",
                  )}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const stageInfo = LEAD_STAGES.find((s) => s.key === l.stage);
              const isStale   = l.lastActivity
                ? (Date.now() - new Date(l.lastActivity).getTime()) > 2 * 24 * 60 * 60 * 1000
                : true;
              const isActive  = !["closed_won", "closed_lost"].includes(l.stage);
              const checked = selectedIds.has(l.id);
              return (
                <tr
                  key={l.id}
                  onClick={() => onSelect(l.id)}
                  className={cn(
                    "group border-b border-border/30 last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer",
                    checked && "bg-primary/5",
                  )}
                >
                  <td
                    className="px-3 py-2.5 align-middle"
                    onClick={(e) => { e.stopPropagation(); toggleOne(l.id); }}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggleOne(l.id)} aria-label={`Select ${l.name}`} />
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{l.name}</span>
                      {isStale && isActive && (
                        <span className="text-[10px] text-destructive" title="No activity in 2+ days">⚠</span>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground truncate">{l.company}</td>
                  <td className="px-3 py-2.5">
                    <span className={cn("inline-block text-[11px] font-medium px-2 py-0.5 rounded", stageInfo?.chip)}>
                      {stageInfo?.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {l.category
                      ? <span className={cn("inline-block text-[10px] font-medium px-1.5 py-0.5 rounded", CATEGORY_CHIP)}>{l.category}</span>
                      : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-foreground font-medium text-right">{fmt(l.dealValue)}</td>
                  <td className="px-3 py-2.5">
                    {l.source
                      ? <span className={cn("inline-block text-[10px] font-medium px-1.5 py-0.5 rounded", SOURCE_CHIP)}>{l.source}</span>
                      : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground tabular-nums text-[12px]">{l.lastActivity ?? "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground text-[12px] truncate">{l.assignee_name ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
}

// Same frame, same column widths and the real header labels — only the cell
// values are placeholders, so rows don't shift when the data lands.
export function LeadTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="border border-border/60 rounded-lg overflow-x-auto bg-card/30">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-border/60 bg-muted/20">
              <th className="w-[36px] px-3 py-2">
                <Skeleton className="h-4 w-4 rounded-sm" />
              </th>
              {TABLE_COLUMNS.map((h) => (
                <th
                  key={h.label}
                  className={cn(
                    "px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider",
                    h.cls,
                    h.cls.includes("text-right") ? "text-right" : "text-left",
                  )}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i} className="border-b border-border/30 last:border-b-0">
                <td className="px-3 py-2.5 align-middle"><Skeleton className="h-4 w-4 rounded-sm" /></td>
                <td className="px-3 py-2.5 align-middle"><Skeleton className="h-3.5 w-32" /></td>
                <td className="px-3 py-2.5"><Skeleton className="h-3.5 w-24" /></td>
                <td className="px-3 py-2.5"><Skeleton className="h-[18px] w-20 rounded" /></td>
                <td className="px-3 py-2.5"><Skeleton className="h-[17px] w-16 rounded" /></td>
                <td className="px-3 py-2.5"><Skeleton className="h-3.5 w-16 ml-auto" /></td>
                <td className="px-3 py-2.5"><Skeleton className="h-[17px] w-14 rounded" /></td>
                <td className="px-3 py-2.5"><Skeleton className="h-3.5 w-20" /></td>
                <td className="px-3 py-2.5"><Skeleton className="h-3.5 w-16" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
