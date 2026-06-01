import { useState } from "react";
import { Plus, Trash2, Search, Loader2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  useEnrollments, useEnrollLead, useDeleteEnrollment,
  type EnrollmentStatus,
} from "@/hooks/useOutreach";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useCurrentUser } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { ApiLead } from "@/lib/types";

const statusColors: Record<EnrollmentStatus, string> = {
  active:    "border-success/30 text-success",
  paused:    "border-warning/30 text-warning",
  completed: "border-muted text-muted-foreground",
  failed:    "border-destructive/30 text-destructive",
  replied:   "border-info/30 text-info",
};

interface Props {
  sequenceId:   string;
  sequenceName: string;
}

export function EnrolledLeadsPanel({ sequenceId, sequenceName }: Props) {
  const user = useCurrentUser();
  const isAdmin = user?.role === "admin";

  const { data: enrollments = [], isLoading } = useEnrollments({ sequence_id: sequenceId });
  const deleteEnrollment = useDeleteEnrollment();
  const [addOpen, setAddOpen] = useState(false);

  const handleRemove = (enrollmentId: string, leadName: string) => {
    if (!confirm(`Remove ${leadName} from "${sequenceName}"?`)) return;
    deleteEnrollment.mutate(enrollmentId, {
      onSuccess: () => toast.success("Removed from sequence"),
      onError:   (err) => toast.error(err.message),
    });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Enrolled Leads
          </p>
          <Badge variant="outline" className="text-[10px] h-5 tabular-nums">{enrollments.length}</Badge>
        </div>
        {isAdmin && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5 h-7">
                <Plus className="h-3.5 w-3.5" /> Add Leads
              </Button>
            </DialogTrigger>
            <AddLeadsDialog
              sequenceId={sequenceId}
              sequenceName={sequenceName}
              enrolledLeadIds={new Set(enrollments.map((e) => e.leadId))}
              onClose={() => setAddOpen(false)}
            />
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground italic">Loading…</p>
      ) : enrollments.length === 0 ? (
        <div className="rounded-lg bg-muted/20 border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">No leads enrolled in this sequence yet.</p>
          {isAdmin && (
            <p className="text-xs text-muted-foreground mt-1">
              Click <strong>Add Leads</strong> to enroll existing leads, or enable Auto-enroll on the toggle above.
            </p>
          )}
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto space-y-1.5 -mx-1 px-1">
          {enrollments.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 hover:bg-muted/40 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {e.lead_name ?? "(deleted)"}
                  </span>
                  <Badge variant="outline" className={cn("text-[9px] h-4 uppercase", statusColors[e.status])}>
                    {e.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                  <span className="truncate">{e.lead_company ?? "—"}</span>
                  {e.lead_email && <><span>·</span><span className="truncate">{e.lead_email}</span></>}
                  <span>·</span>
                  <span className="tabular-nums">step {e.currentStep + 1}</span>
                  {e.nextSendAt && e.status === "active" && (
                    <>
                      <span>·</span>
                      <span className="tabular-nums">next: {new Date(e.nextSendAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    </>
                  )}
                </div>
              </div>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-destructive shrink-0"
                  onClick={() => handleRemove(e.id, e.lead_name ?? "this lead")}
                  disabled={deleteEnrollment.isPending}
                  title="Remove from sequence"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {!isAdmin && enrollments.length > 0 && (
        <p className="text-[10px] text-muted-foreground italic">
          Read-only view. Admin role required to add or remove leads.
        </p>
      )}
    </div>
  );
}

// ─── Add Leads dialog: search + select + bulk-enroll ───
function AddLeadsDialog({
  sequenceId, sequenceName, enrolledLeadIds, onClose,
}: {
  sequenceId:      string;
  sequenceName:    string;
  enrolledLeadIds: Set<string>;
  onClose:         () => void;
}) {
  const [search, setSearch]     = useState("");
  const debounced               = useDebouncedValue(search.trim(), 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const enroll = useEnrollLead();

  const { data: leads = [], isLoading } = useQuery<ApiLead[]>({
    queryKey: ["leads-search-for-enroll", debounced],
    queryFn:  () => apiFetch(`/crm/leads?${debounced ? `search=${encodeURIComponent(debounced)}&` : ""}limit=50`),
    enabled:  true,
  });

  const visibleLeads = leads.filter((l) => !enrolledLeadIds.has(l.id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleEnroll = async () => {
    if (selected.size === 0) return;
    let ok = 0, fail = 0;
    for (const leadId of Array.from(selected)) {
      try {
        await enroll.mutateAsync({ lead_id: leadId, sequence_id: sequenceId });
        ok++;
      } catch {
        fail++;
      }
    }
    toast.success(`Enrolled ${ok} lead${ok === 1 ? "" : "s"}${fail > 0 ? ` · ${fail} failed` : ""} in "${sequenceName}"`);
    setSelected(new Set());
    onClose();
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Add leads to <span className="text-primary">{sequenceName}</span></DialogTitle>
        <p className="text-xs text-muted-foreground pt-1">
          Search existing leads by name or company. Click to select multiple, then enroll.
        </p>
      </DialogHeader>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search by name or company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9 text-sm"
          autoFocus
        />
      </div>

      <div className="max-h-[340px] overflow-y-auto rounded-md border border-border bg-muted/10">
        {isLoading ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
          </div>
        ) : visibleLeads.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {leads.length === 0 ? "No leads found." : "All matching leads are already enrolled."}
          </div>
        ) : (
          visibleLeads.map((l) => {
            const checked = selected.has(l.id);
            return (
              <button
                key={l.id}
                onClick={() => toggle(l.id)}
                className={cn(
                  "w-full text-left px-3 py-2 border-b border-border/40 last:border-b-0 flex items-center gap-3 hover:bg-muted/40 transition-colors",
                  checked && "bg-primary/5",
                )}
              >
                <div className={cn(
                  "h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors",
                  checked ? "bg-primary border-primary" : "border-border",
                )}>
                  {checked && <span className="text-white text-[10px]">✓</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{l.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {l.company}
                    {l.email && <> · {l.email}</>}
                    {l.category && <> · {l.category}</>}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
        <span className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">{selected.size}</span> selected
        </span>
        <div className="flex gap-2">
          <DialogClose asChild><Button variant="ghost"><X className="h-3.5 w-3.5 mr-1" /> Cancel</Button></DialogClose>
          <Button
            disabled={selected.size === 0 || enroll.isPending}
            onClick={handleEnroll}
          >
            {enroll.isPending ? "Enrolling…" : `Enroll ${selected.size} lead${selected.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
