// Single-sequence editor — header with activation / auto-enroll switches and
// delete, the ordered steps timeline, the embedded enrolled-leads panel, and
// the add/edit step dialog (channel + template + optional AI agent).
import { useState, useEffect } from "react";
import {
  Plus, Mail, Linkedin, FileText, Pencil, Trash2,
  ChevronLeft, Activity, Sparkles,
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  useSequence, useUpdateSequence, useDeleteSequence,
  useAddStep, useUpdateStep, useDeleteStep,
  type SequenceStep, type Channel,
} from "@/hooks/useOutreach";
import { EnrolledLeadsPanel } from "@/components/modules/EnrolledLeadsPanel";
import { useAgents } from "@/hooks/useAgents";

const channelIcons: Record<Channel, typeof Mail> = {
  email:    Mail,
  linkedin: Linkedin,
  note:     FileText,
};

export function SequenceEditor({ sequenceId, onBack }: { sequenceId: string; onBack: () => void }) {
  const { data: seq, isLoading } = useSequence(sequenceId);
  const updateSeq = useUpdateSequence();
  const deleteSeq = useDeleteSequence();
  const addStep   = useAddStep();
  const deleteStep = useDeleteStep();
  const { data: agents = [] } = useAgents();
  // Email steps may ONLY use email-capable agents — brief/enrichment/proposal
  // agents produce internal documents that must never be emailed to a prospect.
  const leadAgents = agents.filter((a) => a.scope === "lead" && a.email_capable);

  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [editingStep, setEditingStep]       = useState<SequenceStep | null>(null);
  // Controlled state for the two Selects (FormData can't read Radix Select reliably)
  const [stepChannel,  setStepChannel]      = useState<Channel>("email");
  const [stepAgentId,  setStepAgentId]      = useState<string>("");
  const updateStep = useUpdateStep();

  // Reset/load Select state whenever the dialog opens or we switch between add/edit
  useEffect(() => {
    if (stepDialogOpen) {
      setStepChannel(editingStep?.channel ?? "email");
      setStepAgentId(editingStep?.agentId ?? "");
    }
  }, [stepDialogOpen, editingStep]);

  if (isLoading || !seq) {
    return <SequenceEditorSkeleton />;
  }

  const handleAddStep = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      sequenceId,
      day_offset:       Number(fd.get("day_offset")),
      channel:          stepChannel,                              // from controlled state
      subject_template: (fd.get("subject_template") as string) || undefined,
      body_template:    (fd.get("body_template") as string) || undefined,
      agent_id:         stepAgentId || undefined,                 // from controlled state
    };
    const mutation = editingStep
      ? updateStep.mutateAsync({ sequenceId, stepId: editingStep.id, ...payload })
      : addStep.mutateAsync(payload);

    mutation
      .then(() => {
        toast.success(editingStep ? "Step updated" : "Step added");
        setStepDialogOpen(false);
        setEditingStep(null);
      })
      .catch((err) => toast.error(err?.message ?? "Failed to save step"));
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <h2 className="text-base font-semibold text-foreground">{seq.name}</h2>
            <p className="text-xs text-muted-foreground">
              {seq.category ?? "no niche"} · {seq.step_count} step{seq.step_count !== 1 ? "s" : ""} · {seq.active_enrollments} active
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs">
            <Switch
              checked={seq.isActive}
              onCheckedChange={(v) => updateSeq.mutate({ id: sequenceId, is_active: v })}
            />
            <span className="text-muted-foreground">Active</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Switch
              checked={seq.autoEnrollOnCategory}
              onCheckedChange={(v) => updateSeq.mutate({ id: sequenceId, auto_enroll_on_category: v })}
              disabled={!seq.category}
            />
            <span className="text-muted-foreground">Auto-enroll category</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Switch
              checked={seq.autoEnrollAll}
              onCheckedChange={(v) => updateSeq.mutate({ id: sequenceId, auto_enroll_all: v })}
            />
            <span className="text-muted-foreground" title="Every new lead created — regardless of category — auto-enrolls in this sequence. Use carefully.">
              Auto-enroll ALL
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => {
              if (!confirm(`Delete sequence "${seq.name}"? Active enrollments will be cancelled.`)) return;
              deleteSeq.mutate(sequenceId, {
                onSuccess: () => { toast.success("Sequence deleted"); onBack(); },
                onError:   (err) => toast.error(err.message),
              });
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Steps timeline */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Steps</p>
          <Button size="sm" className="gap-1.5 h-7" onClick={() => { setEditingStep(null); setStepDialogOpen(true); }}>
            <Plus className="h-3.5 w-3.5" /> Add Step
          </Button>
        </div>

        {seq.steps.length === 1 && (
          <div className="mb-3 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 flex items-start gap-2.5">
            <Activity className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div className="text-xs text-foreground">
              <span className="font-semibold text-warning">Only one step — no follow-ups will be sent.</span>{" "}
              Leads enrolled here get a single email and stop. Add a 2nd and 3rd step
              (e.g. day 3 and day 7) so the system follows up automatically.
            </div>
          </div>
        )}

        {seq.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No steps yet. Add one to define this sequence's cadence.</p>
        ) : (
          <div className="space-y-2">
            {seq.steps.map((step, idx) => {
              const Icon = channelIcons[step.channel];
              const isAi = !!step.agentId;
              return (
                <div
                  key={step.id}
                  className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3"
                >
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
                      <span className="text-xs font-bold text-primary">{idx + 1}</span>
                    </div>
                    <Icon className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">Day {step.dayOffset}</Badge>
                      <Badge variant="secondary" className="text-[10px] uppercase">{step.channel}</Badge>
                      {isAi && <Badge className="text-[10px] bg-primary/10 text-primary border-primary/30"><Sparkles className="h-2.5 w-2.5 mr-0.5" /> {step.agentId}</Badge>}
                    </div>
                    {step.subjectTemplate && (
                      <p className="text-xs font-medium text-foreground truncate">{step.subjectTemplate}</p>
                    )}
                    {step.bodyTemplate && !isAi && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{step.bodyTemplate}</p>
                    )}
                    {isAi && (
                      <p className="text-xs text-muted-foreground italic">Body generated per-lead by AI agent</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 max-sm:h-10 max-sm:w-10" onClick={() => { setEditingStep(step); setStepDialogOpen(true); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 max-sm:h-10 max-sm:w-10 text-destructive"
                      onClick={() => {
                        if (!confirm("Delete this step?")) return;
                        deleteStep.mutate({ sequenceId, stepId: step.id }, {
                          onSuccess: () => toast.success("Step deleted"),
                          onError:   (err) => toast.error(err.message),
                        });
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Enrolled leads */}
      <EnrolledLeadsPanel sequenceId={sequenceId} sequenceName={seq.name} />

      {/* Step dialog */}
      <Dialog open={stepDialogOpen} onOpenChange={(o) => { setStepDialogOpen(o); if (!o) setEditingStep(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingStep ? "Edit Step" : "Add Step"}</DialogTitle></DialogHeader>
          <form onSubmit={handleAddStep} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Day offset</Label>
                <Input name="day_offset" type="number" min="0" max="365" defaultValue={editingStep?.dayOffset ?? 0} required className="mt-1" />
              </div>
              <div>
                <Label>Channel</Label>
                <Select value={stepChannel} onValueChange={(v) => setStepChannel(v as Channel)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="linkedin">LinkedIn (manual)</SelectItem>
                    <SelectItem value="note">Internal note</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Subject template</Label>
              <Input name="subject_template" defaultValue={editingStep?.subjectTemplate ?? ""} className="mt-1" placeholder="Quick question, {{first_name}}" />
              <p className="text-[10px] text-muted-foreground mt-1">Variables: {`{{name}}`}, {`{{first_name}}`}, {`{{company}}`}, {`{{category}}`}, {`{{source}}`}</p>
            </div>
            <div>
              <Label>Body template</Label>
              <Textarea name="body_template" rows={6} defaultValue={editingStep?.bodyTemplate ?? ""} className="mt-1 font-mono text-xs" placeholder="Hi {{first_name}},&#10;&#10;Noticed you're at {{company}} in {{category}}. We help agencies like yours…" />
            </div>
            <div>
              <Label>OR use AI agent to generate body per-lead</Label>
              <Select
                value={stepAgentId || "__none__"}
                onValueChange={(v) => setStepAgentId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(none — use template above)</SelectItem>
                  {leadAgents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name} — {a.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">If an agent is selected, body template is ignored and the agent generates the email per-lead.</p>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
              <Button type="submit" disabled={addStep.isPending || updateStep.isPending}>
                {(addStep.isPending || updateStep.isPending) ? "Saving…" : editingStep ? "Update" : "Add Step"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Mirrors the editor above: back button + title/meta line, the row of
// switches, and the steps card with three placeholder step rows.
function SequenceEditorSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-20" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-7 w-24" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-3 w-3" />
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-14 rounded-full" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Skeleton className="h-6 w-6" />
                <Skeleton className="h-6 w-6" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
