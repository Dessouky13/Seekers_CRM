// Header stat line for the Leads page: active count, pipeline value, won/lost
// counts and conversion rate. Totals come from /crm/pipeline-summary so they
// cover ALL leads, not the currently filtered page of rows.

import { fmt } from "./constants";
import type { PipelineStageRow } from "@/hooks/useCRM";

export function PipelineStats({ pipeline }: { pipeline: PipelineStageRow[] }) {
  const totalActive   = pipeline.filter((r) => !["closed_won", "closed_lost"].includes(r.stage)).reduce((s, r) => s + Number(r.count), 0);
  const totalPipeline = pipeline.filter((r) => !["closed_won", "closed_lost"].includes(r.stage)).reduce((s, r) => s + Number(r.total_value), 0);
  const wonCount      = Number(pipeline.find((r) => r.stage === "closed_won")?.count ?? 0);
  const lostCount     = Number(pipeline.find((r) => r.stage === "closed_lost")?.count ?? 0);
  const totalClosed   = wonCount + lostCount;
  const convRate      = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : 0;

  return (
    <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
      <span><span className="text-foreground font-semibold tabular-nums">{totalActive}</span> active</span>
      <span className="text-border">·</span>
      <span>Pipeline <span className="text-foreground font-semibold tabular-nums">{fmt(totalPipeline)}</span></span>
      <span className="text-border">·</span>
      <span><span className="text-emerald-400 font-semibold tabular-nums">{wonCount}</span> won</span>
      <span className="text-border">·</span>
      <span><span className="text-rose-400 font-semibold tabular-nums">{lostCount}</span> lost</span>
      <span className="text-border">·</span>
      <span><span className="text-primary font-semibold tabular-nums">{convRate}%</span> conv</span>
    </div>
  );
}
