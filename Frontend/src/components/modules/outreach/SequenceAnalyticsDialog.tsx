// Per-sequence analytics drill-in dialog — totals, step funnel with retention,
// 30-day sends chart and recent send failures. Opened from the per-sequence
// table in AnalyticsTab; `sequenceId === null` keeps it closed.
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useSequenceAnalytics } from "@/hooks/useOutreach";
import { cn } from "@/lib/utils";

export function SequenceAnalyticsDialog({ sequenceId, onClose }: { sequenceId: string | null; onClose: () => void }) {
  const { data, isLoading } = useSequenceAnalytics(sequenceId);

  return (
    <Dialog open={!!sequenceId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        {isLoading || !data ? (
          <SequenceAnalyticsSkeleton />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {data.sequence.name}
                {!data.sequence.is_active && <Badge variant="outline" className="text-[9px]">INACTIVE</Badge>}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {data.sequence.category ? `${data.sequence.category} · ` : ""}
                {data.sequence.step_count} step{data.sequence.step_count === 1 ? "" : "s"}
              </p>
            </DialogHeader>

            {/* One-step warning */}
            {data.sequence.step_count < 2 && (
              <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 flex items-start gap-2.5">
                <Pencil className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <div className="text-xs text-foreground">
                  <span className="font-semibold text-warning">This sequence has only one step.</span>{" "}
                  Leads receive a single email and never get a follow-up. Add steps 2–3 in the
                  Sequences tab to send follow-ups automatically.
                </div>
              </div>
            )}

            {/* KPI row */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <MiniStat label="Enrolled"  value={data.totals.enrolled} />
              <MiniStat label="Active"    value={data.totals.active}    tone="success" />
              <MiniStat label="Replied"   value={data.totals.replied}   tone="info" />
              <MiniStat label="Completed" value={data.totals.completed} />
              <MiniStat label="Failed"    value={data.totals.failed}    tone={data.totals.failed > 0 ? "danger" : undefined} />
              <MiniStat label="Sends"     value={data.totals.sends} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-muted/10 px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Reply rate</p>
                <p className={cn("text-xl font-semibold tabular-nums", data.totals.reply_rate >= 10 ? "text-success" : "text-foreground")}>
                  {data.totals.reply_rate}%
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/10 px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Completion rate</p>
                <p className="text-xl font-semibold tabular-nums text-foreground">{data.totals.completion_rate}%</p>
              </div>
            </div>

            {/* Step funnel — sent + retention per step */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Step Funnel</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Emails delivered at each step. Retention = % of step-1 recipients who reached this step.
                </p>
              </div>
              {data.funnel.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8 italic">No steps configured.</p>
              ) : (
                <div className="px-4 py-3 space-y-3">
                  {data.funnel.map((f) => (
                    <div key={f.position}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-foreground font-medium">
                          {f.label}
                          <span className="text-muted-foreground font-normal ml-2">
                            day {f.day_offset}{f.has_agent ? " · AI" : ""}{f.channel !== "email" ? ` · ${f.channel}` : ""}
                          </span>
                        </span>
                        <span className="tabular-nums text-foreground">
                          <span className="font-semibold">{f.sent}</span> sent
                          {f.failed > 0 && <span className="text-destructive ml-2">{f.failed} failed</span>}
                          <span className="text-muted-foreground ml-2">{f.retention_pct}%</span>
                        </span>
                      </div>
                      <div className="h-2.5 bg-muted/40 rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${f.retention_pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sends over last 30 days */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Sends — Last 30 Days</p>
              {data.sends_by_day.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8 italic">No sends yet for this sequence.</p>
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={data.sends_by_day}>
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(226,12%,55%)" }} axisLine={false} tickLine={false} tickFormatter={(d) => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(226,12%,55%)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "hsl(230,22%,12%)", border: "1px solid hsl(230,16%,18%)", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "hsl(226,20%,88%)" }} />
                    <Bar dataKey="count" fill="hsl(246,90%,60%)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Recent failures */}
            {data.recent_failures.length > 0 && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-destructive/20">
                  <p className="text-xs font-semibold uppercase tracking-wider text-destructive">Recent Failures</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Why sends to these leads failed — fix the address or content and re-enroll.</p>
                </div>
                <div className="divide-y divide-border/40">
                  {data.recent_failures.map((f, i) => (
                    <div key={i} className="px-4 py-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{f.lead_name ?? "—"} · {f.lead_company ?? "—"}</span>
                        <span className="text-muted-foreground tabular-nums">{new Date(f.sent_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-destructive/90 mt-0.5 break-words">{f.error ?? "Unknown error"}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Mirrors the drill-in body: title block, the six MiniStat tiles, the two
// rate cards, the step funnel and the 30-day sends chart.
function SequenceAnalyticsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-3 w-32" />
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-muted/10 px-3 py-2 space-y-1.5">
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-5 w-8 mx-auto" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-muted/10 px-4 py-2.5 space-y-1.5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-80 max-w-full" />
        </div>
        <div className="px-4 py-3 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-2.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-3 w-36 mb-3" />
        <Skeleton className="h-[160px] w-full" />
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: "success" | "info" | "danger" }) {
  const color = tone === "success" ? "text-success" : tone === "info" ? "text-info" : tone === "danger" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-muted/10 px-3 py-2 text-center">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", color)}>{value}</p>
    </div>
  );
}
