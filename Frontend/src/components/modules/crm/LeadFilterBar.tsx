// Lead filter bar: search box, stage + niche selects, active-filter pills,
// reset link and the visible-row count. Filter state itself lives in the page.

import { Search, Filter, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LEAD_STAGES, LEAD_CATEGORIES } from "./constants";

export function LeadFilterBar({
  search, onSearchChange,
  stageFilter, onStageFilterChange,
  catFilter, onCatFilterChange,
  categories, onReset, resultCount,
}: {
  search:               string;
  onSearchChange:       (value: string) => void;
  stageFilter:          string;
  onStageFilterChange:  (value: string) => void;
  catFilter:            string;
  onCatFilterChange:    (value: string) => void;
  categories:           string[];
  onReset:              () => void;
  resultCount:          number;
}) {
  const activeFilterCount = (catFilter ? 1 : 0) + (stageFilter ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search by name or company…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8 h-8 text-sm border-border/60 bg-transparent focus-visible:bg-background"
        />
      </div>

      {/* Filter button with popover-like select */}
      <div className="flex items-center gap-1">
        <div className="relative">
          <select
            value={stageFilter}
            onChange={(e) => onStageFilterChange(e.target.value)}
            className={cn(
              "h-8 appearance-none rounded-md pl-7 pr-7 text-xs cursor-pointer transition-colors",
              "border bg-transparent",
              stageFilter
                ? "border-foreground/30 text-foreground bg-muted/40"
                : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
            )}
          >
            <option value="">Stage</option>
            {LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none text-muted-foreground" />
        </div>
        <div className="relative">
          <select
            value={catFilter}
            onChange={(e) => onCatFilterChange(e.target.value)}
            className={cn(
              "h-8 appearance-none rounded-md pl-7 pr-7 text-xs cursor-pointer transition-colors",
              "border bg-transparent",
              catFilter
                ? "border-foreground/30 text-foreground bg-muted/40"
                : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
            )}
          >
            <option value="">Niche</option>
            {LEAD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            {categories.filter((c) => !LEAD_CATEGORIES.includes(c as any)).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none text-muted-foreground" />
        </div>
      </div>

      {/* Active filter pills */}
      {stageFilter && (
        <FilterPill
          label={`Stage: ${LEAD_STAGES.find((s) => s.key === stageFilter)?.label}`}
          onRemove={() => onStageFilterChange("")}
        />
      )}
      {catFilter && (
        <FilterPill label={`Niche: ${catFilter}`} onRemove={() => onCatFilterChange("")} />
      )}

      {(search || activeFilterCount > 0) && (
        <button
          onClick={onReset}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-1"
        >
          Reset
        </button>
      )}

      <div className="ml-auto text-[11px] text-muted-foreground tabular-nums">
        {resultCount} {resultCount === 1 ? "row" : "rows"}
      </div>
    </div>
  );
}

// ─── Notion-style filter pill ────────────────────────────
function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-muted/60 border border-border/60 text-[11px] text-foreground font-medium">
      {label}
      <button onClick={onRemove} className="rounded hover:bg-muted ml-0.5">
        <X className="h-3 w-3 text-muted-foreground" />
      </button>
    </span>
  );
}
