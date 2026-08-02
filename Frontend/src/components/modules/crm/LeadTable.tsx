// Notion-style table view of leads (was `NotionTable` inside CRM.tsx): header
// row with select-all, one row per lead with stage/niche/source chips, deal
// value, staleness flag and per-row selection checkbox.

import { ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { LEAD_STAGES, CATEGORY_CHIP, SOURCE_CHIP, fmt } from "./constants";
import type { ApiLead } from "@/lib/types";

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
    <div className="border border-border/60 rounded-lg overflow-x-auto bg-card/30">
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
              {[
                { label: "Name",        cls: "w-[20%]" },
                { label: "Company",     cls: "w-[16%]" },
                { label: "Stage",       cls: "w-[13%]" },
                { label: "Niche",       cls: "w-[11%]" },
                { label: "Deal Value",  cls: "w-[10%] text-right" },
                { label: "Source",      cls: "w-[8%]" },
                { label: "Last Activity", cls: "w-[10%]" },
                { label: "Assigned",    cls: "w-[8%]" },
              ].map((h) => (
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
  );
}
