// Single lead card used by the kanban board: name/company, category + source
// chips, deal value and the "no activity in 2+ days" staleness flag.

import { cn } from "@/lib/utils";
import { CATEGORY_CHIP, SOURCE_CHIP, fmt } from "./constants";
import type { ApiLead } from "@/lib/types";

export function LeadCard({ lead, onSelect }: { lead: ApiLead; onSelect: (id: string) => void }) {
  const isStale  = lead.lastActivity
    ? (Date.now() - new Date(lead.lastActivity).getTime()) > 2 * 24 * 60 * 60 * 1000
    : true;
  const isActive = !["closed_won", "closed_lost"].includes(lead.stage);

  return (
    <div
      onClick={() => onSelect(lead.id)}
      className={cn(
        "group rounded-md border bg-card px-3 py-2.5 space-y-2 transition-all cursor-pointer",
        "hover:shadow-sm hover:border-border/80 hover:bg-card/80",
        isStale && isActive ? "border-destructive/30" : "border-border/60",
      )}
    >
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground leading-snug">{lead.name}</p>
        <p className="text-xs text-muted-foreground leading-tight">{lead.company}</p>
      </div>
      {(lead.category || lead.source) && (
        <div className="flex flex-wrap items-center gap-1">
          {lead.category && (
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", CATEGORY_CHIP)}>
              {lead.category}
            </span>
          )}
          {lead.source && (
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", SOURCE_CHIP)}>
              {lead.source}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        <span className="text-xs font-semibold text-foreground tabular-nums">{fmt(lead.dealValue)}</span>
        <div className="flex items-center gap-1.5">
          {isStale && isActive && (
            <span className="text-[10px] text-destructive font-semibold" title="No activity in 2+ days">⚠</span>
          )}
          <span className="text-[10px] text-muted-foreground">{lead.lastActivity ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}
