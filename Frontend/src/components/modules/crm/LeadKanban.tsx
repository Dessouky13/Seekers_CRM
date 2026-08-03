// Board view: buckets leads into the seven pipeline stages and hands them to
// the shared KanbanBoard (drag-and-drop stage moves bubble up via onMove).
//
// PERFORMANCE — this was the slowest thing in the app. Typing one character in
// the lead search took ~2 seconds with no network involved: the search box is a
// controlled input on the page, so each keystroke re-rendered the page, and
// nothing here was memoised, so all ~200 lead cards re-rendered too.
//
// Three fixes, in order of effect:
//   - memo() on the board and on each card, so a keystroke only re-renders the
//     input it typed into;
//   - a per-column render cap, because nobody scrolls 200 cards in one column
//     and rendering them costs ~13 DOM nodes each;
//   - the column array is memoised, so a re-render with identical leads does
//     not rebuild it and defeat the memo.
import { memo, useMemo, useState } from "react";
import { KanbanBoard } from "@/components/modules/KanbanBoard";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadCard, LeadCardSkeleton } from "./LeadCard";
import { LEAD_STAGES } from "./constants";
import type { ApiLead } from "@/lib/types";

/** Cards rendered per column before "show more". Deep columns are scrolled
 *  rarely and searched often, so paying to mount all of them is waste. */
const CARDS_PER_COLUMN = 25;

export const LeadKanban = memo(function LeadKanban({
  leads, onSelect, onMove,
}: {
  leads:    ApiLead[];
  onSelect: (id: string) => void;
  onMove:   (itemId: string, from: string, to: string) => void;
}) {
  // Per-stage "show all" flags, so expanding one column does not mount the rest.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const columns = useMemo(
    () => LEAD_STAGES.map((s) => {
      const all = leads.filter((l) => l.stage === s.key);
      const show = expanded[s.key] ? all : all.slice(0, CARDS_PER_COLUMN);
      return {
        key:      s.key,
        label:    s.label,
        items:    show,
        // The header count stays the true total even when the list is capped,
        // otherwise the board would under-report the pipeline.
        totalCount: all.length,
        footer: all.length > show.length
          ? (
            <button
              type="button"
              onClick={() => setExpanded((e) => ({ ...e, [s.key]: true }))}
              className="w-full rounded-md py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/5"
            >
              Show {all.length - show.length} more
            </button>
          )
          : null,
      };
    }),
    [leads, expanded],
  );

  return (
    <KanbanBoard
      columns={columns}
      renderCard={(lead) => <LeadCard lead={lead} onSelect={onSelect} />}
      onMoveItem={onMove}
      getItemId={(l) => l.id}
    />
  );
});

// Uneven card counts so the loading board reads like a real pipeline rather
// than a grid. Column chrome/labels match KanbanBoard exactly.
const SKELETON_CARDS_PER_COLUMN = [3, 2, 2, 1, 2, 1, 1];

export function LeadKanbanSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {LEAD_STAGES.map((stage, i) => (
        <div
          key={stage.key}
          className="flex-shrink-0 w-72 rounded-xl border border-border bg-muted/30"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{stage.label}</h2>
            <Skeleton className="h-5 w-5 rounded-full" />
          </div>
          <div className="p-2 space-y-2 min-h-[200px]">
            {Array.from({ length: SKELETON_CARDS_PER_COLUMN[i] ?? 1 }).map((_, j) => (
              <LeadCardSkeleton key={j} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
