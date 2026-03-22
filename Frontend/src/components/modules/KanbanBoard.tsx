import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KanbanColumn<T> {
  key: string;
  label: string;
  items: T[];
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
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => (
        <div
          key={col.key}
          className={cn(
            "flex-shrink-0 w-72 rounded-xl border border-border bg-muted/30 transition-colors duration-150",
            dragOverColumn === col.key && "border-primary/50 bg-primary/5"
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
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{col.label}</h3>
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums">
              {col.items.length}
            </span>
          </div>
          <div className="p-2 space-y-2 min-h-[200px]">
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
          </div>
        </div>
      ))}
    </div>
  );
}
