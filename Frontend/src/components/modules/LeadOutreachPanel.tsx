import { useState } from "react";
import { Send, Plus, Pause, Play, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  useSequences, useEnrollments, useEnrollLead,
  usePauseEnrollment, useResumeEnrollment, useCancelEnrollment,
  type EnrollmentStatus,
} from "@/hooks/useOutreach";
import { cn } from "@/lib/utils";

interface Props {
  leadId:   string;
  category: string | null;
}

const statusColors: Record<EnrollmentStatus, string> = {
  active:    "bg-success/15 text-success border-success/30",
  paused:    "bg-warning/15 text-warning border-warning/30",
  completed: "bg-muted text-muted-foreground border-muted",
  failed:    "bg-destructive/15 text-destructive border-destructive/30",
  replied:   "bg-info/15 text-info border-info/30",
};

export function LeadOutreachPanel({ leadId, category }: Props) {
  const { data: sequences = [] } = useSequences();
  const { data: enrollments = [] } = useEnrollments({ lead_id: leadId });
  const enroll  = useEnrollLead();
  const pauseE  = usePauseEnrollment();
  const resumeE = useResumeEnrollment();
  const cancelE = useCancelEnrollment();

  // Sort sequences: matching category first, then others
  const sortedSequences = [...sequences]
    .filter((s) => s.isActive && s.step_count > 0)
    .sort((a, b) => {
      const aMatch = a.category && category && a.category === category ? 0 : 1;
      const bMatch = b.category && category && b.category === category ? 0 : 1;
      return aMatch - bMatch;
    });

  const handleEnroll = (sequenceId: string, sequenceName: string) => {
    enroll.mutate(
      { lead_id: leadId, sequence_id: sequenceId },
      {
        onSuccess: (res: any) => {
          if (res?.alreadyEnrolled) {
            toast.info(`Already enrolled in "${sequenceName}"`);
          } else {
            toast.success(`Enrolled in "${sequenceName}"`);
          }
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Outreach Sequences
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={enroll.isPending || sortedSequences.length === 0}>
              <Plus className="h-3 w-3" /> Enroll <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {sortedSequences.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                No active sequences. Create one in <strong>Outreach</strong> page.
              </div>
            ) : sortedSequences.map((s) => {
              const isMatch = s.category && category && s.category === category;
              return (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => handleEnroll(s.id, s.name)}
                  className="flex-col items-start py-2"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-sm font-medium">{s.name}</span>
                    {isMatch && <Badge variant="secondary" className="text-[9px] h-4">MATCH</Badge>}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {s.step_count} step{s.step_count !== 1 ? "s" : ""}
                    {s.category && ` · ${s.category}`}
                  </p>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {enrollments.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1">
          Not enrolled in any sequence. Click "Enroll" to start automated outreach.
        </p>
      ) : (
        <div className="space-y-2">
          {enrollments.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-2.5"
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">
                  {e.sequence_name ?? "(deleted)"}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="outline" className={cn("text-[9px] h-4 uppercase", statusColors[e.status])}>
                    {e.status}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    Step {e.currentStep + 1}
                  </span>
                  {e.nextSendAt && e.status === "active" && (
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      · next: {new Date(e.nextSendAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {e.status === "active" && (
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => pauseE.mutate(e.id, { onSuccess: () => toast.success("Paused") })}>
                    <Pause className="h-3 w-3" />
                  </Button>
                )}
                {e.status === "paused" && (
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => resumeE.mutate(e.id, { onSuccess: () => toast.success("Resumed") })}>
                    <Play className="h-3 w-3" />
                  </Button>
                )}
                {(e.status === "active" || e.status === "paused") && (
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => cancelE.mutate(e.id, { onSuccess: () => toast.success("Cancelled") })}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
