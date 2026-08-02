// Live enrollments table — status filter plus per-row pause / resume / cancel
// controls. The API scopes rows by role (members only see their own leads'
// enrollments), so this component renders whatever the query returns.
import { useState } from "react";
import { Pause, Play, X, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  useEnrollments, usePauseEnrollment, useResumeEnrollment, useCancelEnrollment,
  type EnrollmentStatus,
} from "@/hooks/useOutreach";
import { cn } from "@/lib/utils";

const statusColors: Record<EnrollmentStatus, string> = {
  active:    "bg-success/15 text-success",
  paused:    "bg-warning/15 text-warning",
  completed: "bg-muted text-muted-foreground",
  failed:    "bg-destructive/15 text-destructive",
  replied:   "bg-info/15 text-info",
};

export function EnrollmentsList() {
  const [statusFilter, setStatusFilter] = useState<EnrollmentStatus | "all">("active");
  const { data: enrollments = [], isLoading } = useEnrollments(
    statusFilter !== "all" ? { status: statusFilter } : {},
  );
  const pauseE  = usePauseEnrollment();
  const resumeE = useResumeEnrollment();
  const cancelE = useCancelEnrollment();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-40 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="replied">Replied</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{enrollments.length} enrollments</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
      ) : enrollments.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Activity className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No enrollments match this filter.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Lead", "Sequence", "Step", "Next send", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enrollments.map((e) => (
                <tr key={e.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium">{e.lead_name ?? "(deleted)"}</div>
                    <div className="text-xs text-muted-foreground">{e.lead_company} · {e.lead_email ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{e.sequence_name ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">{e.currentStep + 1}</td>
                  <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                    {e.nextSendAt ? new Date(e.nextSendAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={cn("text-[10px] uppercase", statusColors[e.status])}>{e.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {e.status === "active" && (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => pauseE.mutate(e.id, { onSuccess: () => toast.success("Paused") })}>
                          <Pause className="h-3 w-3" />
                        </Button>
                      )}
                      {e.status === "paused" && (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => resumeE.mutate(e.id, { onSuccess: () => toast.success("Resumed") })}>
                          <Play className="h-3 w-3" />
                        </Button>
                      )}
                      {(e.status === "active" || e.status === "paused") && (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => cancelE.mutate(e.id, { onSuccess: () => toast.success("Cancelled") })}>
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
