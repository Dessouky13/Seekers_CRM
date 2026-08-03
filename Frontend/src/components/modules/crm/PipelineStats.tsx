// Header stat line for the Leads page: active count, pipeline value, won/lost
// counts and conversion rate. Totals come from /crm/pipeline-summary so they
// cover ALL leads, not the currently filtered page of rows.

import { Skeleton } from "@/components/ui/skeleton";
import { fmt } from "./constants";
import type { PipelineStageRow } from "@/hooks/useCRM";

export function PipelineStats({ pipeline }: { pipeline: PipelineStageRow[] }) {
  const totalActive   = pipeline.filter((r) => !["closed_won", "closed_lost"].includes(r.stage)).reduce((s, r) => s + Number(r.count), 0);
  const totalPipeline = pipeline.filter((r) => !["closed_won", "closed_lost"].includes(r.stage)).reduce((s, r) => s + Number(r.total_value), 0);
  const wonCount      = Number(pipeline.find((r) => r.stage === "closed_won")?.count ?? 0);
  const lostCount     = Number(pipeline.find((r) => r.stage === "closed_lost")?.count ?? 0);
  const totalClosed   = wonCount + lostCount;
  const convRate      = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : 0;

  // One scrollable line on a phone rather than a wrapping block. Wrapping
  // turned five short stats into three stacked rows and pushed the actual
  // leads most of a screen further down.
  return (
    <div className="-mx-1 flex items-center gap-3 overflow-x-auto whitespace-nowrap px-1 text-[12px] text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-4 sm:overflow-visible">
      <span className="shrink-0"><span className="font-semibold tabular-nums text-foreground">{totalActive}</span> active</span>
      <span className="shrink-0 text-border">·</span>
      <span className="shrink-0">Pipeline <span className="font-semibold tabular-nums text-foreground">{fmt(totalPipeline)}</span></span>
      <span className="shrink-0 text-border">·</span>
      <span className="shrink-0"><span className="font-semibold tabular-nums text-emerald-400">{wonCount}</span> won</span>
      <span className="shrink-0 text-border">·</span>
      <span className="shrink-0"><span className="font-semibold tabular-nums text-rose-400">{lostCount}</span> lost</span>
      <span className="shrink-0 text-border">·</span>
      <span className="shrink-0"><span className="font-semibold tabular-nums text-primary">{convRate}%</span> conv</span>
    </div>
  );
}

// Same row rhythm as the real stat line — separators stay, numbers become bars,
// so the header doesn't flash misleading zeros while the summary loads.
export function PipelineStatsSkeleton() {
  return (
    <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
      <Skeleton className="h-3.5 w-16" />
      <span className="text-border">·</span>
      <Skeleton className="h-3.5 w-32" />
      <span className="text-border">·</span>
      <Skeleton className="h-3.5 w-12" />
      <span className="text-border">·</span>
      <Skeleton className="h-3.5 w-12" />
      <span className="text-border">·</span>
      <Skeleton className="h-3.5 w-14" />
    </div>
  );
}
