// "What's stopping this sequence from working" panel.
//
// Sits at the top of the editor so the answer is visible before the user starts
// hunting. Collapses to a single green line when there is nothing to say —
// a permanent checklist that is usually all ticks trains people to ignore it.
import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReadinessIssue, IssueLevel } from "./sequence-readiness";

const LEVEL: Record<IssueLevel, { icon: typeof Info; tone: string; label: string }> = {
  blocker: { icon: XCircle,       tone: "text-destructive", label: "Blocking" },
  warning: { icon: AlertTriangle, tone: "text-warning",     label: "Warning" },
  info:    { icon: Info,          tone: "text-info",        label: "Note" },
};

export function SequenceReadiness({ issues }: { issues: ReadinessIssue[] }) {
  const blockers = issues.filter((i) => i.level === "blocker");
  const warnings = issues.filter((i) => i.level === "warning");
  // Blockers stop the sequence working, so they are never hidden behind a click.
  const [open, setOpen] = useState(blockers.length > 0);

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        <p className="text-xs text-foreground/85">
          Ready to send. Every step has a subject and a body, and the cadence is in order.
        </p>
      </div>
    );
  }

  const headlineTone = blockers.length
    ? "border-destructive/30 bg-destructive/5"
    : warnings.length
      ? "border-warning/30 bg-warning/5"
      : "border-info/25 bg-info/5";

  const summary = blockers.length
    ? `${blockers.length} thing${blockers.length === 1 ? "" : "s"} must be fixed before this can send`
    : warnings.length
      ? `${warnings.length} thing${warnings.length === 1 ? "" : "s"} worth checking`
      : issues[0].message;

  return (
    <div className={cn("rounded-lg border", headlineTone)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {blockers.length
          ? <XCircle className="h-4 w-4 shrink-0 text-destructive" />
          : warnings.length
            ? <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            : <Info className="h-4 w-4 shrink-0 text-info" />}
        <span className="min-w-0 flex-1 text-xs font-medium text-foreground">{summary}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <ul className="space-y-2 border-t border-border/40 px-3 py-2.5">
          {issues.map((issue, i) => {
            const s = LEVEL[issue.level];
            const Icon = s.icon;
            return (
              <li key={i} className="flex gap-2">
                <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", s.tone)} />
                <div className="min-w-0">
                  <p className="text-xs text-foreground">{issue.message}</p>
                  {issue.fix && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{issue.fix}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
