// Company-wide outreach analytics (admin tab) — KPI rows, best-niche callout,
// 30-day sends chart, and per-sequence / per-niche / per-source / per-step
// breakdowns. Owns the drill-in selection handed to SequenceAnalyticsDialog.
import { useState } from "react";
import { Mail, TrendingUp, MessageCircle, Mail as MailIcon, BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useOutreachAnalytics } from "@/hooks/useOutreach";
import { SequenceAnalyticsDialog } from "@/components/modules/outreach/SequenceAnalyticsDialog";
import { cn } from "@/lib/utils";
import { QueryError } from "@/components/QueryError";

export function AnalyticsTab() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useOutreachAnalytics();
  const [drillSeqId, setDrillSeqId] = useState<string | null>(null);

  if (isLoading) return <AnalyticsTabSkeleton />;
  // Must come before the `!data` branch: on a failed request data is also
  // undefined, so "No analytics available yet" was what a 500 looked like.
  if (isError) {
    return <QueryError what="outreach analytics" error={error} onRetry={refetch} isRetrying={isRefetching} />;
  }
  if (!data)     return <p className="text-sm text-muted-foreground text-center py-12">No analytics available yet.</p>;

  const fmtEgp = (n: number) => `EGP ${n.toLocaleString()}`;

  return (
    <div className="space-y-4">
      {/* KPI cards — top row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={MessageCircle} label="Enrollments"     value={data.totals.enrollments_total} />
        <KpiCard icon={TrendingUp}    label="Replied"         value={data.totals.replied} />
        <KpiCard icon={BarChart3}     label="Reply Rate"      value={`${data.totals.reply_rate}%`} />
        <KpiCard icon={MailIcon}      label="Sent (30d)"      value={data.totals.sends_last_30_days} />
      </div>

      {/* KPI cards — secondary row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard icon={MessageCircle} label="Active leads"    value={data.totals.active_leads} />
        <KpiCard icon={TrendingUp}    label="Stale (7d+)"     value={data.totals.stale_leads} />
        <KpiCard icon={BarChart3}     label="Pipeline value"  value={fmtEgp(data.totals.pipeline_value)} />
      </div>

      {/* Best-performing niche callout */}
      {data.best_niche ? (
        <div className="rounded-xl border border-success/30 bg-success/5 p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/20 text-success font-bold text-lg">🏆</div>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-success">Best-performing niche</p>
            <p className="text-sm text-foreground mt-0.5">
              <span className="font-semibold">{data.best_niche.category}</span>
              {" — "}
              <span className="tabular-nums font-semibold text-success">{data.best_niche.reply_rate}%</span> reply rate
              {" "}({data.best_niche.replied} replies from {data.best_niche.enrolled} enrolled)
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-muted/10 p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground font-bold text-lg">🎯</div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">
              Not enough reply data yet to identify the best niche.
              Once you have at least one reply across a niche with 3+ enrolled leads, the winner shows here.
            </p>
          </div>
        </div>
      )}

      {/* Sends-by-day chart */}
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Sends — Last 30 Days</p>
        {data.sends_by_day.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 italic">No sends yet. Once a sequence sends its first email, the chart populates here.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.sends_by_day}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(226,12%,55%)" }} axisLine={false} tickLine={false} tickFormatter={(d) => d.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(226,12%,55%)" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "hsl(230,22%,12%)", border: "1px solid hsl(230,16%,18%)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "hsl(226,20%,88%)" }}
              />
              <Bar dataKey="count" fill="hsl(246,90%,60%)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Per-sequence table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Per-Sequence Performance</p>
          <span className="text-[10px] text-muted-foreground">Click a row to drill into its funnel</span>
        </div>
        {data.per_sequence.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 italic">No sequences yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Sequence", "Niche", "Enrolled", "Active", "Replied", "Completed", "Sends", "Reply Rate", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.per_sequence.map((s) => (
                  <tr
                    key={s.sequence_id}
                    onClick={() => setDrillSeqId(s.sequence_id)}
                    className="border-b border-border/50 hover:bg-primary/5 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-2.5">
                      <span className="text-foreground font-medium">{s.sequence_name}</span>
                      {!s.is_active && <Badge variant="outline" className="ml-2 text-[9px]">INACTIVE</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">{s.category ?? "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{s.enrolled}</td>
                    <td className="px-4 py-2.5 tabular-nums text-success">{s.active}</td>
                    <td className="px-4 py-2.5 tabular-nums text-primary">{s.replied}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{s.completed}</td>
                    <td className="px-4 py-2.5 tabular-nums">{s.sends}</td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold">
                      <span className={cn(s.reply_rate >= 10 ? "text-success" : "text-muted-foreground")}>{s.reply_rate}%</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <BarChart3 className="h-3.5 w-3.5 text-muted-foreground inline-block" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-sequence drill-in dialog */}
      <SequenceAnalyticsDialog sequenceId={drillSeqId} onClose={() => setDrillSeqId(null)} />

      {/* By niche */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">By Niche — which categories perform</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Sorted by reply rate then enrolled count. Use this to double-down on what works.</p>
        </div>
        {data.by_niche.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 italic">No leads with niche tagged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Niche", "Leads", "Enrolled", "Replied", "Sends", "Pipeline", "Reply Rate"].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.by_niche.map((n, i) => (
                  <tr key={n.category} className={cn("border-b border-border/50 hover:bg-muted/20 transition-colors", i === 0 && n.replied > 0 && "bg-success/5")}>
                    <td className="px-4 py-2.5">
                      <span className="text-foreground font-medium">{n.category}</span>
                      {i === 0 && n.replied > 0 && <Badge variant="outline" className="ml-2 text-[9px] border-success/40 text-success">TOP</Badge>}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{n.leads_total}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{n.enrolled}</td>
                    <td className="px-4 py-2.5 tabular-nums text-primary font-semibold">{n.replied}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{n.sends}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground text-xs">{fmtEgp(n.pipeline_value)}</td>
                    <td className="px-4 py-2.5 tabular-nums font-semibold">
                      <span className={cn(n.reply_rate >= 10 ? "text-success" : n.reply_rate > 0 ? "text-foreground" : "text-muted-foreground")}>
                        {n.reply_rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* By source + By step — side by side on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">By Source — which lead sources convert</p>
          </div>
          {data.by_source.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12 italic">No source data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Source", "Leads", "Enrolled", "Replied", "Reply Rate"].map((h) => (
                      <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.by_source.map((s) => (
                    <tr key={s.source} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 text-foreground font-medium">{s.source}</td>
                      <td className="px-4 py-2.5 tabular-nums">{s.leads_total}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{s.enrolled}</td>
                      <td className="px-4 py-2.5 tabular-nums text-primary font-semibold">{s.replied}</td>
                      <td className="px-4 py-2.5 tabular-nums font-semibold">
                        <span className={cn(s.reply_rate >= 10 ? "text-success" : "text-muted-foreground")}>{s.reply_rate}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* By step — sends per step (drop-off view) */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sends per Step</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Drop-off shows leads exiting the sequence.</p>
          </div>
          {data.by_step.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12 italic">No steps yet.</p>
          ) : (
            <div className="px-5 py-4 space-y-2">
              {(() => {
                const maxSends = Math.max(...data.by_step.map((s) => s.sends), 1);
                return data.by_step.map((s) => (
                  <div key={s.position}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-foreground">{s.label}</span>
                      <span className="tabular-nums font-semibold text-foreground">{s.sends}</span>
                    </div>
                    <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${(s.sends / maxSends) * 100}%` }}
                      />
                    </div>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Mirrors the analytics layout: 4-up then 3-up KPI rows, the niche callout,
// the 30-day sends chart, and the two stacked breakdown tables.
function AnalyticsTabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />)}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-3 w-36 mb-3" />
        <Skeleton className="h-[200px] w-full" />
      </div>

      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <Skeleton className="h-3 w-56" />
          </div>
          <div className="px-5 py-3 space-y-3">
            {Array.from({ length: 5 }).map((_, r) => (
              <Skeleton key={r} className="h-4 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function KpiCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-1.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3.5 w-3.5" />
      </div>
      <Skeleton className="h-7 w-16" />
    </div>
  );
}

function KpiCard({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <p className="text-2xl font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}
