// "Is our sending healthy?" in one screen.
//
// Exists because the failure modes were previously invisible: 30 sends were
// rejected by the provider's own filter and nothing surfaced it, and the domain
// has no DMARC record with nothing anywhere to say so.
import { ShieldCheck, ShieldAlert, Gauge, Ban, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeliverability } from "@/hooks/useDeliverability";
import { cn } from "@/lib/utils";

const STAGE_COPY: Record<string, string> = {
  recovery: "Recovering — reduced volume after a provider rejection",
  warmup:   "Warming up — volume increases each clean week",
  active:   "Active — at the steady ceiling",
};

export function DeliverabilityPanel() {
  const { data, isLoading, isError } = useDeliverability();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }
  if (isError || !data) return null;

  const { mailbox, auth, suppressions, failures } = data;
  const used = mailbox.daily_cap > 0
    ? Math.min(100, Math.round((mailbox.sent_today / mailbox.daily_cap) * 100))
    : 0;

  return (
    <div className="space-y-3">
      {/* Volume */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10">
            <Gauge className="h-4 w-4 text-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                {mailbox.sent_today} of {mailbox.daily_cap} sent today
              </p>
              <Badge variant="outline" className="text-[10px] uppercase">
                {mailbox.warmup_stage}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {STAGE_COPY[mailbox.warmup_stage]}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", used >= 100 ? "bg-warning" : "bg-primary")}
                style={{ width: `${used}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {mailbox.address} · {mailbox.slots_left > 0
                ? `${mailbox.slots_left}h left in today's send window`
                : "outside the 09:00–17:00 Cairo send window"}
            </p>
          </div>
        </div>
      </Card>

      {/* Domain authentication */}
      <Card className="overflow-hidden">
        <div className="border-b border-border/60 px-4 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Domain authentication · {mailbox.domain}
          </p>
        </div>
        <ul>
          {auth.map((r) => (
            <li key={r.record} className="flex items-start gap-3 border-b border-border/30 px-4 py-2.5 last:border-0">
              {r.pass
                ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">{r.record}</p>
                {r.problem && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{r.problem}</p>
                )}
                {r.value && (
                  <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground/70">{r.value}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Suppressions + failures */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Ban className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Suppressed
            </p>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {suppressions.total}
          </p>
          <p className="text-[11px] text-muted-foreground">
            addresses that will never be emailed again
          </p>
          {suppressions.by_reason.length > 0 && (
            <ul className="mt-2 space-y-1">
              {suppressions.by_reason.map((r) => (
                <li key={r.reason} className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{r.reason.replace(/_/g, " ")}</span>
                  <span className="tabular-nums">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Failures · 30 days
            </p>
          </div>
          {failures.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No failed sends.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {failures.map((f) => (
                <li key={f.kind}>
                  <div className="flex justify-between text-[11px]">
                    <span className="font-medium text-foreground">{f.kind.replace(/_/g, " ")}</span>
                    <span className="tabular-nums text-muted-foreground">{f.count}</span>
                  </div>
                  {f.example && (
                    <p className="mt-0.5 line-clamp-2 font-mono text-[10px] text-muted-foreground/70">
                      {f.example}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
