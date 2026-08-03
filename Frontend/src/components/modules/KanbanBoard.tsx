import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KanbanColumn<T> {
  key: string;
  label: string;
  items: T[];
  /** True total when `items` is capped, so the header count stays honest. */
  totalCount?: number;
  /** Rendered under the cards — used for a "show more" control. */
  footer?: ReactNode;
}

interface KanbanBoardProps<T> {
  columns: KanbanColumn<T>[];
  renderCard: (item: T) => ReactNode;
  onMoveItem?: (itemId: string, fromColumn: string, toColumn: string) => void;
  getItemId: (item: T) => string;
}

export function KanbanBoard<T>({ columns, renderCard, onMoveItem, getItemId }: KanbanBoardProps<T>) {
  const [dragItem, setDragItem] = useState<{ id: string; column: string } | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  return (
    <div
      className={cn(
        "flex gap-4 overflow-x-auto pb-4",
        // Snap each column to the viewport edge on a phone, so swiping lands on
        // a whole column instead of leaving two half-columns on screen.
        "snap-x snap-mandatory md:snap-none",
        // Momentum scrolling, and keep the browser's bounce inside the board
        // rather than propagating to the page.
        "overscroll-x-contain [-webkit-overflow-scrolling:touch]",
      )}
    >
      {columns.map((col) => (
        <div
          key={col.key}
          className={cn(
            "shrink-0 snap-start rounded-xl border border-border bg-muted/30 transition-colors duration-150",
            // Nearly full-width on a phone: a 288px column on a 390px screen
            // left a sliver of the next one and read as broken. 85vw shows the
            // current column plus a hint that another follows.
            "w-[85vw] max-w-[20rem] md:w-72 md:max-w-none",
            dragOverColumn === col.key && "border-primary/50 bg-primary/5",
          )}
          onDragOver={(e) => { e.preventDefault(); setDragOverColumn(col.key); }}
          onDragLeave={() => setDragOverColumn(null)}
          onDrop={() => {
            if (dragItem && dragItem.column !== col.key) {
              onMoveItem?.(dragItem.id, dragItem.column, col.key);
            }
            setDragItem(null);
            setDragOverColumn(null);
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{col.label}</h2>
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {col.totalCount ?? col.items.length}
            </span>
          </div>
          <div className="min-h-[200px] space-y-2 p-2">
            {col.items.map((item) => (
              <div
                key={getItemId(item)}
                draggable
                onDragStart={() => setDragItem({ id: getItemId(item), column: col.key })}
                onDragEnd={() => { setDragItem(null); setDragOverColumn(null); }}
                className="cursor-grab active:cursor-grabbing"
              >
                {renderCard(item)}
              </div>
            ))}
            {col.footer}
          </div>
        </div>
      ))}
    </div>
  );
}
