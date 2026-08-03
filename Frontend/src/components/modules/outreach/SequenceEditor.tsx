// Single-sequence editor: settings header, the readiness panel, the step flow
// (drag to reorder), the enrolled-leads panel, and the add/edit step dialog.
import { useState, useEffect, useMemo } from "react";
import {
  Plus, ChevronLeft, Trash2, Power, Users, Sparkles, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  useSequence, useUpdateSequence, useDeleteSequence,
  useAddStep, useUpdateStep, useDeleteStep, useReorderSteps,
  type SequenceStep, type Channel,
} from "@/hooks/useOutreach";
import { EnrolledLeadsPanel } from "@/components/modules/EnrolledLeadsPanel";
import { useAgents } from "@/hooks/useAgents";
import { StepFlow } from "./StepFlow";
import { SequenceReadiness } from "./SequenceReadiness";
import { checkSequence, isSendable } from "./sequence-readiness";
import { suggestNextDayOffset } from "./sequence-templates";
import { cn } from "@/lib/utils";

const VARIABLES = ["first_name", "name", "company", "category", "source"];

export function SequenceEditor({ sequenceId, onBack }: { sequenceId: string; onBack: () => void }) {
  const { data: seq, isLoading } = useSequence(sequenceId);
  const updateSeq  = useUpdateSequence();
  const deleteSeq  = useDeleteSequence();
  const addStep    = useAddStep();
  const updateStep = useUpdateStep();
  const deleteStep = useDeleteStep();
  const reorder    = useReorderSteps();
  const { data: agents = [] } = useAgents();

  // Email steps may ONLY use email-capable agents — brief/enrichment/proposal
  // agents produce internal documents that must never be emailed to a prospect.
  const leadAgents = agents.filter((a) => a.scope === "lead" && a.email_capable);

  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [editingStep, setEditingStep]       = useState<SequenceStep | null>(null);
  const [pendingDelete, setPendingDelete]   = useState<SequenceStep | null>(null);
  const [deleteSeqOpen, setDeleteSeqOpen]   = useState(false);
  // Radix Select can't be read from FormData, so these two stay controlled.
  const [stepChannel, setStepChannel] = useState<Channel>("email");
  const [stepAgentId, setStepAgentId] = useState<string>("");

  useEffect(() => {
    if (!stepDialogOpen) return;
    setStepChannel(editingStep?.channel ?? "email");
    setStepAgentId(editingStep?.agentId ?? "");
  }, [stepDialogOpen, editingStep]);

  const steps = useMemo(() => seq?.steps ?? [], [seq]);

  const issues = useMemo(
    () => (seq ? checkSequence({
      isActive:             seq.isActive,
      category:             seq.category,
      autoEnrollOnCategory: seq.autoEnrollOnCategory,
      autoEnrollAll:        seq.autoEnrollAll,
      steps,
    }) : []),
    [seq, steps],
  );

  const issuesByStep = useMemo(() => {
    const m = new Map<string, typeof issues>();
    for (const i of issues) {
      if (!i.stepId) continue;
      m.set(i.stepId, [...(m.get(i.stepId) ?? []), i]);
    }
    return m;
  }, [issues]);

  if (isLoading || !seq) return <SequenceEditorSkeleton />;

  const sendable = isSendable({
    isActive: seq.isActive, category: seq.category,
    autoEnrollOnCategory: seq.autoEnrollOnCategory,
    autoEnrollAll: seq.autoEnrollAll, steps,
  });

  const openAdd = () => { setEditingStep(null); setStepDialogOpen(true); };

  const saveStep = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      day_offset:       Number(fd.get("day_offset")),
      channel:          stepChannel,
      subject_template: (fd.get("subject_template") as string) || undefined,
      body_template:    (fd.get("body_template") as string)    || undefined,
      agent_id:         stepAgentId || undefined,
    };

    const run = editingStep
      ? updateStep.mutateAsync({ ...payload, sequenceId, stepId: editingStep.id })
      : addStep.mutateAsync({ ...payload, sequenceId });

    run
      .then(() => {
        toast.success(editingStep ? "Step updated" : "Step added");
        setStepDialogOpen(false);
        setEditingStep(null);
      })
      .catch((err) => toast.error(err?.message ?? "Failed to save step"));
  };

  const confirmDeleteStep = () => {
    if (!pendingDelete) return;
    deleteStep.mutate({ sequenceId, stepId: pendingDelete.id }, {
      onSuccess: () => { toast.success("Step deleted"); setPendingDelete(null); },
      onError:   (err) => toast.error(err.message),
    });
  };

  // Pre-fills the day offset by continuing the spacing already established,
  // instead of defaulting to 0 and stacking a second step on the same day.
  const suggestedDay = editingStep?.dayOffset ?? suggestNextDayOffset(steps.map((s) => s.dayOffset));

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 shrink-0">
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">{seq.name}</h2>
              <Badge
                variant="outline"
                className={cn("text-[10px]", seq.isActive
                  ? "border-emerald-500/40 text-emerald-400"
                  : "border-muted text-muted-foreground")}
              >
                {seq.isActive ? "LIVE" : "OFF"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {seq.category ?? "no niche"} · {steps.length} step{steps.length !== 1 ? "s" : ""} · {seq.active_enrollments} active
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* One prominent on/off control instead of three equal-weight
              switches. Turning a sequence live is the consequential action;
              the auto-enrol rules are settings and now sit below. */}
          <Button
            size="sm"
            variant={seq.isActive ? "outline" : "default"}
            className="gap-1.5"
            disabled={!seq.isActive && !sendable}
            title={!seq.isActive && !sendable ? "Fix the blocking issues first" : undefined}
            onClick={() => updateSeq.mutate(
              { id: sequenceId, is_active: !seq.isActive },
              {
                onSuccess: () => toast.success(seq.isActive ? "Sequence paused" : "Sequence is live"),
                onError:   (e) => toast.error(e.message),
              },
            )}
          >
            <Power className="h-3.5 w-3.5" />
            {seq.isActive ? "Turn off" : "Turn on"}
          </Button>
          <Button
            variant="ghost" size="sm"
            className="text-destructive"
            aria-label="Delete sequence"
            onClick={() => setDeleteSeqOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <SequenceReadiness issues={issues} />

      {/* ── Steps ──────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cadence</p>
            {steps.length > 1 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Drag a step, or use the arrows, to reorder. Gaps between steps are preserved.
              </p>
            )}
          </div>
          <Button size="sm" className="h-7 gap-1.5" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5" /> Add step
          </Button>
        </div>

        {steps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 px-6 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No steps yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              A sequence needs at least one step to send anything. Most cold outreach
              works best as three: an intro, a nudge on day 3, and a close on day 7.
            </p>
            <Button size="sm" className="mt-4 gap-1.5" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" /> Add the first step
            </Button>
          </div>
        ) : (
          <StepFlow
            steps={steps}
            issuesByStep={issuesByStep}
            onEdit={(s) => { setEditingStep(s); setStepDialogOpen(true); }}
            onDelete={setPendingDelete}
            isReordering={reorder.isPending}
            onReorder={(order) => reorder.mutate({ sequenceId, order }, {
              onError: (e) => toast.error(e.message),
            })}
          />
        )}
      </div>

      {/* ── Enrolment rules ────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Who joins automatically
          </p>
        </div>
        <div className="space-y-3">
          <RuleRow
            checked={seq.autoEnrollOnCategory}
            disabled={!seq.category}
            onChange={(v) => updateSeq.mutate({ id: sequenceId, auto_enroll_on_category: v })}
            title={`New leads in "${seq.category ?? "—"}"`}
            detail={seq.category
              ? "Any lead created with this niche joins this sequence automatically."
              : "Set a niche on this sequence to use this rule."}
          />
          <RuleRow
            checked={seq.autoEnrollAll}
            onChange={(v) => updateSeq.mutate({ id: sequenceId, auto_enroll_all: v })}
            title="Every new lead, whatever the niche"
            detail="Use with care. If a second sequence also has this on, leads are enrolled twice and get duplicate emails."
            danger
          />
        </div>
      </div>

      <EnrolledLeadsPanel sequenceId={sequenceId} sequenceName={seq.name} />

      {/* ── Add / edit step ────────────────────────────── */}
      <Dialog open={stepDialogOpen} onOpenChange={(o) => { setStepDialogOpen(o); if (!o) setEditingStep(null); }}>
        <DialogContent
          className="max-w-lg"
          description="Choose when this step sends, on which channel, and what it says."
        >
          <DialogHeader>
            <DialogTitle>{editingStep ? `Edit step — day ${editingStep.dayOffset}` : "Add step"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={saveStep} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="day_offset">Send on day</Label>
                <Input
                  id="day_offset" name="day_offset" type="number" min="0" max="365"
                  defaultValue={suggestedDay} required className="mt-1"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Counted from when the lead is enrolled. 0 sends straight away.
                </p>
              </div>
              <div>
                <Label>Channel</Label>
                <Select value={stepChannel} onValueChange={(v) => setStepChannel(v as Channel)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="linkedin">LinkedIn (manual)</SelectItem>
                    <SelectItem value="note">Internal note</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp (you press send)</SelectItem>
                    <SelectItem value="call">Phone call (reminder)</SelectItem>
                  </SelectContent>
                </Select>
                {stepChannel !== "email" && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {stepChannel === "whatsapp" || stepChannel === "call"
                      ? "Nothing is sent automatically. This appears in Today and the sequence pauses until someone records an outcome."
                      : "Not sent automatically — this creates a reminder to do it by hand."}
                  </p>
                )}
              </div>
            </div>

            {stepChannel === "email" && (
              <div>
                <Label htmlFor="subject_template">Subject</Label>
                <Input
                  id="subject_template" name="subject_template"
                  defaultValue={editingStep?.subjectTemplate ?? ""} className="mt-1"
                  placeholder="Quick question about {{company}}"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Variables: {VARIABLES.map((v) => `{{${v}}}`).join(", ")}
                </p>
              </div>
            )}

            <div>
              <Label htmlFor="body_template">Body</Label>
              <Textarea
                id="body_template" name="body_template" rows={6}
                defaultValue={editingStep?.bodyTemplate ?? ""}
                className="mt-1 font-mono text-xs"
                disabled={!!stepAgentId}
                placeholder={"Hi {{first_name}},\n\nNoticed {{company}} is in {{category}}…"}
              />
              {stepAgentId && (
                <p className="mt-1 flex items-center gap-1 text-[10px] text-primary">
                  <Info className="h-3 w-3" />
                  Ignored while an AI agent is selected below.
                </p>
              )}
            </div>

            <div>
              <Label>Or let an AI agent write it per lead</Label>
              <Select
                value={stepAgentId || "__none__"}
                onValueChange={(v) => setStepAgentId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Use the body above</SelectItem>
                  {leadAgents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3" />{a.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {leadAgents.length === 0 && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  No email-capable agents configured. Other agents write internal
                  documents and are deliberately not offered here.
                </p>
              )}
            </div>

            <DialogFooter>
              <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
              <Button type="submit" disabled={addStep.isPending || updateStep.isPending}>
                {(addStep.isPending || updateStep.isPending)
                  ? "Saving…" : editingStep ? "Save step" : "Add step"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Replaces window.confirm(), which is unstyled, unblockable and reads as
          a browser error rather than part of the app. */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => { if (!o) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this step?</AlertDialogTitle>
            <AlertDialogDescription>
              Day {pendingDelete?.dayOffset} — “{pendingDelete?.subjectTemplate || "no subject"}”.
              Leads already past this step are unaffected; those before it will skip straight to the next one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive-solid text-destructive-foreground hover:bg-destructive-solid/90"
              onClick={confirmDeleteStep}
            >
              {deleteStep.isPending ? "Deleting…" : "Delete step"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteSeqOpen} onOpenChange={setDeleteSeqOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{seq.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {seq.active_enrollments > 0
                ? `${seq.active_enrollments} lead${seq.active_enrollments === 1 ? " is" : "s are"} currently enrolled and will stop receiving this sequence immediately.`
                : "No leads are currently enrolled."}
              {" "}The sequence, its {steps.length} step{steps.length === 1 ? "" : "s"} and its send history are removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive-solid text-destructive-foreground hover:bg-destructive-solid/90"
              onClick={() => deleteSeq.mutate(sequenceId, {
                onSuccess: () => { toast.success("Sequence deleted"); onBack(); },
                onError:   (err) => toast.error(err.message),
              })}
            >
              {deleteSeq.isPending ? "Deleting…" : "Delete sequence"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RuleRow({ checked, onChange, title, detail, disabled, danger }: {
  checked: boolean; onChange: (v: boolean) => void;
  title: string; detail: string; disabled?: boolean; danger?: boolean;
}) {
  return (
    <label className={cn(
      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
      disabled && "cursor-not-allowed opacity-60",
      checked && danger ? "border-warning/40 bg-warning/5"
        : checked ? "border-primary/40 bg-primary/5" : "border-border",
    )}>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </label>
  );
}

// Mirrors the editor: header, readiness strip, steps card with three rows.
function SequenceEditorSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Skeleton className="h-8 w-20" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>

      <Skeleton className="h-9 w-full rounded-lg" />

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-24" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-lg border border-border p-3">
              <Skeleton className="h-4 w-4 shrink-0" />
              <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <div className="flex gap-1.5">
                  <Skeleton className="h-4 w-14 rounded-full" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
