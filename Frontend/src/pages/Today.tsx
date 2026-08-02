import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MessageSquareReply, Flame, AlertTriangle, CheckSquare,
  Clock, UserPlus, ArrowRight, CheckCircle2, TrendingDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/useAuth";
import {
  useWorklist, usePipelineHealth,
  type WorklistAction, type ActionType,
} from "@/hooks/useWorklist";

// Each action type gets one icon and one colour, used identically in the focus
// card, the queue and the badges — so "green means a reply is waiting" is
// learned once and holds everywhere.
const STYLE: Record<ActionType, { icon: typeof Flame; label: string; tone: string; dot: string }> = {
  reply_waiting:    { icon: MessageSquareReply, label: "Reply waiting", tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25", dot: "bg-emerald-500" },
  hot_lead:         { icon: Flame,              label: "Hot",           tone: "text-red-400 bg-red-500/10 border-red-500/25",           dot: "bg-red-500" },
  sequence_blocked: { icon: AlertTriangle,      label: "Stuck",         tone: "text-violet-400 bg-violet-500/10 border-violet-500/25",  dot: "bg-violet-500" },
  task_due:         { icon: CheckSquare,        label: "Task",          tone: "text-blue-400 bg-blue-500/10 border-blue-500/25",        dot: "bg-blue-500" },
  stale_lead:       { icon: Clock,              label: "Stale",         tone: "text-amber-400 bg-amber-500/10 border-amber-500/25",     dot: "bg-amber-500" },
  unassigned_lead:  { icon: UserPlus,           label: "No owner",      tone: "text-slate-400 bg-slate-500/10 border-slate-500/25",     dot: "bg-slate-500" },
};

const PRIMARY_CTA: Record<ActionType, string> = {
  reply_waiting:    "Open & reply",
  hot_lead:         "Open lead",
  sequence_blocked: "Fix sequence",
  task_due:         "Open task",
  stale_lead:       "Chase",
  unassigned_lead:  "Assign",
};

const money = (n: number) =>
  n > 0 ? new Intl.NumberFormat("en-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(n) : null;

function TypeBadge({ type }: { type: ActionType }) {
  const s = STYLE[type];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${s.tone}`}>
      <Icon className="h-3 w-3" />
      {s.label}
    </span>
  );
}

/** The one thing you should be doing, with everything needed to do it. */
function FocusCard({ action, onGo, onSkip, position, total }: {
  action: WorklistAction;
  onGo: (a: WorklistAction) => void;
  onSkip: () => void;
  position: number;
  total: number;
}) {
  const value = money(action.dealValue);
  return (
    <Card className="p-6 border-border/70">
      <div className="flex items-start justify-between gap-4">
        <TypeBadge type={action.type} />
        <span className="text-xs text-muted-foreground shrink-0">{position} of {total}</span>
      </div>

      <h2 className="mt-4 text-2xl font-semibold text-foreground leading-tight">{action.title}</h2>
      {(action.subtitle || value) && (
        <p className="mt-1 text-sm text-muted-foreground">
          {[action.subtitle, value].filter(Boolean).join(" · ")}
        </p>
      )}

      <p className="mt-3 text-sm text-foreground/80">{action.reason}</p>

      {action.detail && (
        <blockquote className="mt-4 border-l-2 border-emerald-500/60 bg-emerald-500/5 px-4 py-3 text-sm italic text-foreground/85">
          “{action.detail}”
        </blockquote>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => onGo(action)}>
          {PRIMARY_CTA[action.type]} <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
        {total > 1 && (
          <Button variant="ghost" onClick={onSkip}>Skip for now</Button>
        )}
      </div>
    </Card>
  );
}

function QueueRow({ action, onGo, active }: {
  action: WorklistAction;
  onGo: (a: WorklistAction) => void;
  active: boolean;
}) {
  const s = STYLE[action.type];
  return (
    <button
      onClick={() => onGo(action)}
      className={`flex w-full items-center gap-3 border-b border-border/40 px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/50 ${active ? "bg-muted/40" : ""}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{action.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{action.reason}</span>
      </span>
      {action.dealValue > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground">{money(action.dealValue)}</span>
      )}
    </button>
  );
}

/** Admin-only supply strip. Runway is the number that owns "not enough leads". */
function SupplyStrip() {
  const { data, isError, isLoading } = usePipelineHealth();

  // Its own query, so it gets its own placeholder rather than riding on the
  // worklist's loading flag — whichever resolves first shows first.
  if (isLoading) {
    return (
      <Card className="overflow-hidden border-border/70">
        <div className="grid grid-cols-2 gap-px bg-border/40 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-card px-4 py-3">
              <Skeleton className="h-7 w-12" />
              <Skeleton className="mt-1 h-3 w-16" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (isError || !data) return null;

  const stats = [
    { label: "new · 7d",  value: String(data.new_leads_7d) },
    { label: "enriched",  value: `${data.enriched_pct}%` },
    { label: "sent · 7d", value: String(data.sent_7d) },
    { label: "replies",   value: `${data.replies_7d} · ${data.reply_rate_pct}%` },
    {
      label: "runway",
      value: data.runway_days === null ? "idle" : `${data.runway_days}d`,
      warn:  data.starving || data.runway_days === null,
    },
  ];

  return (
    <Card className={`overflow-hidden ${data.starving ? "border-red-500/40" : "border-border/70"}`}>
      <div className="grid grid-cols-2 gap-px bg-border/40 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="bg-card px-4 py-3">
            <div className={`text-lg font-semibold ${s.warn ? "text-red-400" : "text-foreground"}`}>{s.value}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
      {(data.starving || data.runway_days === null) && (
        <div className="flex items-start gap-2 border-t border-red-500/25 bg-red-500/5 px-4 py-3">
          <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-foreground/85">{data.headline}</p>
        </div>
      )}
    </Card>
  );
}

/** Mirrors FocusCard: badge row, title, subtitle, reason, two buttons. */
function FocusCardSkeleton() {
  return (
    <Card className="p-6 border-border/70">
      <div className="flex items-start justify-between gap-4">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="h-4 w-12 shrink-0" />
      </div>
      <Skeleton className="mt-4 h-8 w-3/4" />
      <Skeleton className="mt-2 h-5 w-1/2" />
      <Skeleton className="mt-3 h-5 w-2/3" />
      <div className="mt-5 flex gap-2">
        <Skeleton className="h-10 w-36" />
        <Skeleton className="h-10 w-28" />
      </div>
    </Card>
  );
}

/** Mirrors QueueRow: dot, two stacked lines. */
function QueueRowSkeleton() {
  return (
    <div className="flex w-full items-center gap-3 border-b border-border/40 px-4 py-2.5 last:border-0">
      <Skeleton className="h-1.5 w-1.5 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export default function Today() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useWorklist();
  // Skipping only moves you down today's list; it never mutates the lead, so
  // the item is back tomorrow if it still needs doing.
  const [skipped, setSkipped] = useState<string[]>([]);

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const isAdmin = user?.role === "admin";

  const go = (a: WorklistAction) => navigate(a.deepLink);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 py-2">
        {/* The greeting comes from the cached user, not the queue, so it renders
            for real — only the counts underneath are placeheld. */}
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{greeting}, {firstName}</h1>
          <Skeleton className="mt-1.5 h-4 w-56" />
        </div>

        {isAdmin && <SupplyStrip />}

        <FocusCardSkeleton />

        <div>
          <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Up next
          </p>
          <Card className="overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => <QueueRowSkeleton key={i} />)}
          </Card>
        </div>
      </div>
    );
  }

  // The API ships ahead of the VPS deploy, so a missing endpoint is an expected
  // state for a few minutes after release — not a crash.
  if (isError) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <h1 className="text-2xl font-semibold">{greeting}, {firstName}</h1>
        <Card className="mt-6 p-6">
          <p className="text-sm text-muted-foreground">
            Your daily queue isn’t available yet — the API hasn’t picked up this release.
            Everything else works normally in the meantime.
          </p>
          <p className="mt-2 text-xs text-muted-foreground/70">{(error as Error)?.message}</p>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => navigate("/crm")}>Go to CRM</Button>
            <Button variant="ghost" onClick={() => navigate("/tasks")}>Go to Tasks</Button>
          </div>
        </Card>
      </div>
    );
  }

  const all = [...(data?.focus ?? []), ...(data?.rest ?? [])];
  const live = all.filter((a) => !skipped.includes(a.id));
  const focus = live[0];
  const queue = live.slice(1, 8);

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{greeting}, {firstName}</h1>
          <p className="text-sm text-muted-foreground">
            {live.length === 0
              ? "Nothing is waiting on you."
              : `${live.length} thing${live.length === 1 ? "" : "s"} need you` +
                (data && data.counts.now > 0 ? ` · ${data.counts.now} can’t wait` : "")}
          </p>
        </div>
        {skipped.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSkipped([])}>
            Restore {skipped.length} skipped
          </Button>
        )}
      </div>

      {isAdmin && <SupplyStrip />}

      {focus ? (
        <>
          <FocusCard
            action={focus}
            onGo={go}
            onSkip={() => setSkipped((s) => [...s, focus.id])}
            position={all.length - live.length + 1}
            total={all.length}
          />

          {queue.length > 0 && (
            <div>
              <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Up next
              </p>
              <Card className="overflow-hidden">
                {queue.map((a) => <QueueRow key={a.id} action={a} onGo={go} active={false} />)}
              </Card>
              {live.length > 8 && (
                <p className="mt-2 px-1 text-xs text-muted-foreground">
                  + {live.length - 8} more further down the list
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
          <div>
            <p className="font-medium text-foreground">You’re clear.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No replies waiting, nothing overdue, nothing going cold. This refills
              itself as leads reply.
            </p>
          </div>
          <div className="mt-1 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/crm")}>Open CRM</Button>
            {isAdmin && <Button variant="ghost" size="sm" onClick={() => navigate("/outbound")}>Outbound</Button>}
          </div>
        </Card>
      )}
    </div>
  );
}
