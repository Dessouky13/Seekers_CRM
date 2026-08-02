// Board view: buckets leads into the seven pipeline stages and hands them to
// the shared KanbanBoard (drag-and-drop stage moves bubble up via onMove).

import { KanbanBoard } from "@/components/modules/KanbanBoard";
import { LeadCard } from "./LeadCard";
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
