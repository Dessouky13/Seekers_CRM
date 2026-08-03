// Sequences tab — grid of sequence cards plus the "New Sequence" creation
// dialog. Owns the sequence list query and create mutation; opening a card
// is delegated upward via `onOpen` so the page shell can swap in the editor.
import { Send, AlertTriangle, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSequences } from "@/hooks/useOutreach";
import { CreateSequenceDialog } from "./CreateSequenceDialog";
import { cn } from "@/lib/utils";

export function SequencesList({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: sequences = [], isLoading } = useSequences();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{sequences.length} sequence{sequences.length !== 1 ? "s" : ""}</p>
        <CreateSequenceDialog onCreated={onOpen} />
      </div>

      {isLoading ? (
        <SequencesListSkeleton />
      ) : sequences.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <Send className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No sequences yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            A sequence is a cadence of emails sent automatically after a lead is
            enrolled. Start from the 3-touch template and edit the copy — it takes
            about a minute.
          </p>
          <div className="mt-4 flex justify-center">
            <CreateSequenceDialog onCreated={onOpen} />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sequences.map((seq) => {
            // Two states worth surfacing before the user opens the card: a
            // sequence that can never send, and one that will send exactly once.
            const empty      = seq.step_count === 0;
            const singleStep = seq.step_count === 1;
            return (
              <button
                key={seq.id}
                type="button"
                onClick={() => onOpen(seq.id)}
                className={cn(
                  "space-y-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40",
                  empty ? "border-warning/40" : "border-border",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{seq.name}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {seq.category ?? "no niche"}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("shrink-0 text-[10px]", seq.isActive
                      ? "border-emerald-500/40 text-emerald-400"
                      : "border-muted text-muted-foreground")}
                  >
                    {seq.isActive ? "LIVE" : "OFF"}
                  </Badge>
                </div>

                {seq.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{seq.description}</p>
                )}

                {(empty || singleStep) && (
                  <p className="flex items-start gap-1 text-[11px] text-warning">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {empty
                      ? "No steps — this cannot send anything."
                      : "One step only — no follow-ups will be sent."}
                  </p>
                )}

                <div className="flex items-center justify-between border-t border-border/50 pt-2 text-xs">
                  <span className="text-muted-foreground">
                    {seq.step_count} step{seq.step_count !== 1 ? "s" : ""}
                  </span>
                  <span className="font-semibold tabular-nums text-primary">
                    {seq.active_enrollments} active
                  </span>
                </div>

                {(seq.autoEnrollOnCategory || seq.autoEnrollAll) && (
                  <Badge
                    variant="secondary"
                    className={cn("gap-0.5 text-[9px]", seq.autoEnrollAll && "bg-warning/15 text-warning")}
                  >
                    <Zap className="h-2.5 w-2.5" />
                    {seq.autoEnrollAll ? "AUTO-ENROLL ALL LEADS" : "AUTO-ENROLL BY NICHE"}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Mirrors the sequence card grid above: title + niche, status pill,
// two-line description, and the step-count / active-count footer.
function SequencesListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-2.5 w-20" />
            </div>
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
