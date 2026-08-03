// The sequence cadence, drawn as a flow.
//
// The old view was a flat list of cards each labelled "Day N". That made the
// absolute offsets visible but hid the thing people actually reason about — how
// long the recipient waits between messages — so cadence mistakes (two steps on
// the same day, a 30-day gap) were invisible until someone did the arithmetic.
// Wait connectors between the cards make the rhythm the primary reading.
//
// Reordering uses the native HTML drag-and-drop API rather than a library: the
// list is short, vertical, and single-axis, and the project has a no-new-deps
// rule. Keyboard move buttons are provided because native DnD is mouse-only.
import { useState } from "react";
import {
  Mail, Linkedin, FileText, GripVertical, Pencil, Trash2, Clock,
  Sparkles, ChevronUp, ChevronDown, Flag, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SequenceStep, Channel } from "@/hooks/useOutreach";
import type { ReadinessIssue } from "./sequence-readiness";

const CHANNEL: Record<Channel, { icon: typeof Mail; label: string; tone: string }> = {
  email:    { icon: Mail,     label: "Email",           tone: "text-primary bg-primary/10" },
  linkedin: { icon: Linkedin, label: "LinkedIn",        tone: "text-info bg-info/10" },
  note:     { icon: FileText, label: "Internal note",   tone: "text-muted-foreground bg-muted" },
};

/** "the same day" / "1 day later" / "4 days later" */
function waitLabel(gap: number): string {
  if (gap <= 0) return "immediately after — same day";
  if (gap === 1) return "1 day later";
  return `${gap} days later`;
}

export function StepFlow({
  steps, issuesByStep, onEdit, onDelete, onReorder, isReordering,
}: {
  steps: SequenceStep[];
  issuesByStep: Map<string, ReadinessIssue[]>;
  onEdit: (s: SequenceStep) => void;
  onDelete: (s: SequenceStep) => void;
  onReorder: (order: string[]) => void;
  isReordering: boolean;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const ordered = [...steps].sort((a, b) => a.position - b.position);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= ordered.length || from === to) return;
    const next = [...ordered];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onReorder(next.map((s) => s.id));
  };

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    move(ordered.findIndex((s) => s.id === dragId), ordered.findIndex((s) => s.id === targetId));
    setDragId(null); setOverId(null);
  };

  return (
    <div className={cn("space-y-0", isReordering && "pointer-events-none opacity-60")}>
      {/* Enrolment is the anchor every offset is measured from. Naming it
          removes the main source of confusion about what "Day 3" means. */}
      <div className="flex items-center gap-2.5 pb-1">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card">
          <Flag className="h-3 w-3 text-muted-foreground" />
        </div>
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Lead is enrolled
        </span>
      </div>

      {ordered.map((step, i) => {
        const prevDay = i === 0 ? 0 : ordered[i - 1].dayOffset;
        const gap     = step.dayOffset - prevDay;
        const c       = CHANNEL[step.channel];
        const Icon    = c.icon;
        const issues  = issuesByStep.get(step.id) ?? [];
        const blocked = issues.some((x) => x.level === "blocker");

        return (
          <div key={step.id}>
            {/* Wait connector */}
            <div className="flex items-stretch gap-2.5">
              <div className="flex w-6 shrink-0 justify-center">
                <div className="w-px bg-border" />
              </div>
              <div className="flex items-center gap-1.5 py-1.5">
                <Clock className="h-3 w-3 text-muted-foreground/70" />
                <span className="text-[11px] text-muted-foreground">
                  {i === 0
                    ? (step.dayOffset === 0 ? "send immediately" : waitLabel(step.dayOffset))
                    : waitLabel(gap)}
                </span>
                {gap < 0 && (
                  <span className="text-[11px] font-medium text-warning">· out of order</span>
                )}
              </div>
            </div>

            {/* Step card */}
            <div
              draggable={!isReordering}
              onDragStart={() => setDragId(step.id)}
              onDragEnd={()   => { setDragId(null); setOverId(null); }}
              onDragOver={(e) => { e.preventDefault(); setOverId(step.id); }}
              onDragLeave={() => setOverId((v) => (v === step.id ? null : v))}
              onDrop={(e)     => { e.preventDefault(); drop(step.id); }}
              className={cn(
                "group flex items-start gap-2.5 rounded-lg border bg-card p-3 transition-colors",
                blocked ? "border-destructive/40" : "border-border",
                dragId === step.id && "opacity-40",
                overId === step.id && dragId !== step.id && "border-primary ring-1 ring-primary/40",
              )}
            >
              <div className="flex flex-col items-center gap-1 pt-0.5">
                <GripVertical
                  className="h-4 w-4 cursor-grab text-muted-foreground/50 active:cursor-grabbing"
                  aria-hidden
                />
                <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
              </div>

              <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", c.tone)}>
                <Icon className="h-3.5 w-3.5" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] tabular-nums">Day {step.dayOffset}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{c.label}</Badge>
                  {step.agentId && (
                    <Badge className="gap-0.5 border-primary/30 bg-primary/10 text-[10px] text-primary">
                      <Sparkles className="h-2.5 w-2.5" /> AI
                    </Badge>
                  )}
                  {blocked && (
                    <Badge variant="outline" className="gap-0.5 border-destructive/40 text-[10px] text-destructive">
                      <AlertCircle className="h-2.5 w-2.5" /> Incomplete
                    </Badge>
                  )}
                </div>

                <p className={cn(
                  "mt-1 truncate text-xs font-medium",
                  step.subjectTemplate ? "text-foreground" : "italic text-destructive/80",
                )}>
                  {step.subjectTemplate || "No subject line"}
                </p>

                <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                  {step.agentId
                    ? `Body written per lead by ${step.agentId}`
                    : step.bodyTemplate || "No body yet"}
                </p>
              </div>

              {/* Always visible rather than hover-only: on touch there is no
                  hover, and these were unreachable on a phone. */}
              <div className="flex shrink-0 flex-col gap-0.5">
                <div className="flex gap-0.5">
                  <IconBtn label={`Move step ${i + 1} up`}   disabled={i === 0}                  onClick={() => move(i, i - 1)}><ChevronUp   className="h-3 w-3" /></IconBtn>
                  <IconBtn label={`Move step ${i + 1} down`} disabled={i === ordered.length - 1} onClick={() => move(i, i + 1)}><ChevronDown className="h-3 w-3" /></IconBtn>
                </div>
                <div className="flex gap-0.5">
                  <IconBtn label={`Edit step ${i + 1}`}   onClick={() => onEdit(step)}><Pencil className="h-3 w-3" /></IconBtn>
                  <IconBtn label={`Delete step ${i + 1}`} destructive onClick={() => onDelete(step)}><Trash2 className="h-3 w-3" /></IconBtn>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* End cap */}
      <div className="flex items-stretch gap-2.5">
        <div className="flex w-6 shrink-0 justify-center"><div className="w-px bg-border" /></div>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-card">
          <Flag className="h-3 w-3 text-muted-foreground/60" />
        </div>
        <span className="text-[11px] text-muted-foreground">
          Sequence ends
          {ordered.length > 0 && ` · ${ordered[ordered.length - 1].dayOffset} days after enrolment`}
        </span>
      </div>
    </div>
  );
}

function IconBtn({ children, label, onClick, disabled, destructive }: {
  children: React.ReactNode; label: string; onClick: () => void;
  disabled?: boolean; destructive?: boolean;
}) {
  return (
    <Button
      type="button" variant="ghost" size="sm"
      aria-label={label} title={label}
      disabled={disabled} onClick={onClick}
      className={cn("h-6 w-6 p-0 max-sm:h-9 max-sm:w-9", destructive && "text-destructive hover:text-destructive")}
    >
      {children}
    </Button>
  );
}
