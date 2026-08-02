// Full-page loading state for the Leads page. Mirrors the real shell exactly —
// header + stat line, view tabs, filter bar and the board/table for whichever
// view is active — so nothing jumps when the leads request resolves.

import { Skeleton } from "@/components/ui/skeleton";
import { PipelineStatsSkeleton } from "./PipelineStats";
import { LeadKanbanSkeleton } from "./LeadKanban";
import { LeadTableSkeleton } from "./LeadTable";
import type { LeadView } from "./LeadViewTabs";

export function LeadsPageSkeleton({ view }: { view: LeadView }) {
  return (
    <div className="space-y-4 w-full overflow-hidden -mt-2">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3 pb-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Leads</h1>
          </div>
          <PipelineStatsSkeleton />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 border-b border-border/60">
        <div className="px-3 py-2"><Skeleton className="h-4 w-14" /></div>
        <div className="px-3 py-2"><Skeleton className="h-4 w-14" /></div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
        <div className="flex items-center gap-1">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
        <Skeleton className="ml-auto h-3.5 w-14" />
      </div>

      {/* Content */}
      {view === "kanban" ? <LeadKanbanSkeleton /> : <LeadTableSkeleton />}
    </div>
  );
}
