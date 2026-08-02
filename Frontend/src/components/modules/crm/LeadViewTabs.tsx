// Notion-style Table / Board view switcher for the Leads page.

import { List, Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type LeadView = "kanban" | "list";

export function LeadViewTabs({
  view, onViewChange,
}: {
  view:         LeadView;
  onViewChange: (view: LeadView) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-border/60">
      <button
        onClick={() => onViewChange("list")}
        className={cn(
          "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5",
          view === "list"
            ? "border-foreground text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground",
        )}
      >
        <List className="h-3.5 w-3.5" /> Table
      </button>
      <button
        onClick={() => onViewChange("kanban")}
        className={cn(
          "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5",
          view === "kanban"
            ? "border-foreground text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground",
        )}
      >
        <Columns3 className="h-3.5 w-3.5" /> Board
      </button>
    </div>
  );
}
