// Board view: buckets leads into the seven pipeline stages and hands them to
// the shared KanbanBoard (drag-and-drop stage moves bubble up via onMove).

import { KanbanBoard } from "@/components/modules/KanbanBoard";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadCard, LeadCardSkeleton } from "./LeadCard";
import { LEAD_STAGES } from "./constants";
import type { ApiLead } from "@/lib/types";

export function LeadKanban({
  leads, onSelect, onMove,
}: {
  leads:    ApiLead[];
  onSelect: (id: string) => void;
  onMove:   (itemId: string, from: string, to: string) => void;
}) {
  return (
    <KanbanBoard
      columns={LEAD_STAGES.map((s) => ({
        key:   s.key,
        label: s.label,
        items: leads.filter((l) => l.stage === s.key),
      }))}
      renderCard={(lead) => <LeadCard lead={lead} onSelect={onSelect} />}
      onMoveItem={onMove}
      getItemId={(l) => l.id}
    />
  );
}

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
