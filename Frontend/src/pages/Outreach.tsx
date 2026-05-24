import { useState } from "react";
import {
  Plus, Send, Pause, Play, X, Mail, Linkedin, FileText, Pencil, Trash2,
  ChevronLeft, Activity, Sparkles, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  useSequences, useSequence, useCreateSequence, useUpdateSequence, useDeleteSequence,
  useAddStep, useUpdateStep, useDeleteStep,
  useEnrollments, usePauseEnrollment, useResumeEnrollment, useCancelEnrollment,
  useOutreachAnalytics,
  type SequenceStep, type Channel, type EnrollmentStatus,
} from "@/hooks/useOutreach";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, MessageCircle, Mail as MailIcon, BarChart3 } from "lucide-react";
import { useAgents } from "@/hooks/useAgents";
import { cn } from "@/lib/utils";

const channelIcons: Record<Channel, typeof Mail> = {
  email:    Mail,
  linkedin: Linkedin,
  note:     FileText,
};

const statusColors: Record<EnrollmentStatus, string> = {
  active:    "bg-success/15 text-success",
  paused:    "bg-warning/15 text-warning",
  completed: "bg-muted text-muted-foreground",
  failed:    "bg-destructive/15 text-destructive",
  replied:   "bg-info/15 text-info",
};

export default function Outreach() {
  const [selectedSeqId, setSelectedSeqId] = useState<string | null>(null);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Outreach</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automated sequences, lead ingestion, and live enrollments.
          </p>
        </div>
      </div>

      <Tabs defaultValue="sequences">
        <TabsList className="mb-4">
          <TabsTrigger value="sequences">Sequences</TabsTrigger>
          <TabsTrigger value="enrollments">Live Enrollments</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="ingest">Setup & Ingestion</TabsTrigger>
        </TabsList>

        <TabsContent value="sequences">
          {selectedSeqId
            ? <SequenceEditor sequenceId={selectedSeqId} onBack={() => setSelectedSeqId(null)} />
            : <SequencesList onOpen={setSelectedSeqId} />}
        </TabsContent>

        <TabsContent value="enrollments">
          <EnrollmentsList />
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsTab />
        </TabsContent>

        <TabsContent value="ingest">
          <IngestDocs />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Sequences List ────────────────────────────────────────
function SequencesList({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: sequences = [], isLoading } = useSequences();
  const createSeq = useCreateSequence();
  const [isOpen, setIsOpen] = useState(false);

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createSeq.mutate(
      {
        name:        fd.get("name") as string,
        description: (fd.get("description") as string) || undefined,
        category:    (fd.get("category") as string)    || undefined,
      },
      {
        onSuccess: (created) => {
          setIsOpen(false);
          toast.success("Sequence created");
          onOpen(created.id);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{sequences.length} sequence{sequences.length !== 1 ? "s" : ""}</p>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New Sequence</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Sequence</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div><Label>Name</Label><Input name="name" required className="mt-1" placeholder="E.g. Cold outreach — SaaS founders" /></div>
              <div><Label>Description</Label><Textarea name="description" rows={2} className="mt-1" placeholder="What this sequence is for" /></div>
              <div><Label>Niche / Category (optional)</Label><Input name="category" className="mt-1" placeholder="E.g. SaaS, agency, e-commerce" /></div>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <Button type="submit" disabled={createSeq.isPending}>
                  {createSeq.isPending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground text-center py-12">Loading…</div>
      ) : sequences.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Send className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No sequences yet. Create your first outreach sequence above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sequences.map((seq) => (
            <div
              key={seq.id}
              onClick={() => onOpen(seq.id)}
              className="rounded-xl border border-border bg-card p-4 space-y-3 hover:border-primary/40 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{seq.name}</p>
                  {seq.category && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">{seq.category}</p>
                  )}
                </div>
                <Badge variant="outline" className={cn("text-[10px]", seq.isActive ? "border-success/30 text-success" : "border-muted text-muted-foreground")}>
                  {seq.isActive ? "ACTIVE" : "INACTIVE"}
                </Badge>
              </div>
              {seq.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{seq.description}</p>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
                <span className="text-muted-foreground">{seq.step_count} step{seq.step_count !== 1 ? "s" : ""}</span>
                <span className="text-primary font-semibold tabular-nums">{seq.active_enrollments} active</span>
              </div>
              {seq.autoEnrollOnCategory && (
                <Badge variant="secondary" className="text-[9px]">AUTO-ENROLL</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sequence Editor ───────────────────────────────────────
function SequenceEditor({ sequenceId, onBack }: { sequenceId: string; onBack: () => void }) {
  const { data: seq, isLoading } = useSequence(sequenceId);
  const updateSeq = useUpdateSequence();
  const deleteSeq = useDeleteSequence();
  const addStep   = useAddStep();
  const deleteStep = useDeleteStep();
  const { data: agents = [] } = useAgents();
  const leadAgents = agents.filter((a) => a.scope === "lead");

  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [editingStep, setEditingStep]       = useState<SequenceStep | null>(null);
  const updateStep = useUpdateStep();

  if (isLoading || !seq) {
    return <div className="text-sm text-muted-foreground text-center py-12">Loading…</div>;
  }

  const handleAddStep = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const agentId = fd.get("agent_id") as string;
    const payload = {
      sequenceId,
      day_offset:       Number(fd.get("day_offset")),
      channel:          fd.get("channel") as Channel,
      subject_template: (fd.get("subject_template") as string) || undefined,
      body_template:    (fd.get("body_template") as string) || undefined,
      agent_id:         agentId || undefined,
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
      .catch((err) => toast.error(err.message));
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
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setEditingStep(step); setStepDialogOpen(true); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-destructive"
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

      {/* Step dialog */}
      <Dialog open={stepDialogOpen} onOpenChange={(o) => { setStepDialogOpen(o); if (!o) setEditingStep(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingStep ? "Edit Step" : "Add Step"}</DialogTitle></DialogHeader>
          <form onSubmit={handleAddStep} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Day offset</Label>
                <Input name="day_offset" type="number" min="0" max="365" defaultValue={editingStep?.dayOffset ?? 0} required className="mt-1" />
              </div>
              <div>
                <Label>Channel</Label>
                <Select name="channel" defaultValue={editingStep?.channel ?? "email"}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="linkedin">LinkedIn (manual)</SelectItem>
                    <SelectItem value="note">Internal note</SelectItem>
                  </SelectContent>
                </Select>
                {/* Need a hidden input because Select doesn't auto-include name */}
                <input type="hidden" name="channel" defaultValue={editingStep?.channel ?? "email"} />
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
              <Select name="agent_id" defaultValue={editingStep?.agentId ?? ""}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="None — use body template" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">(none — use template above)</SelectItem>
                  {leadAgents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name} — {a.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="agent_id" defaultValue={editingStep?.agentId ?? ""} />
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

// ── Enrollments List ──────────────────────────────────────
function EnrollmentsList() {
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
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
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

// ── Analytics tab ─────────────────────────────────────────
function AnalyticsTab() {
  const { data, isLoading } = useOutreachAnalytics();

  if (isLoading) return <p className="text-sm text-muted-foreground text-center py-12">Loading analytics…</p>;
  if (!data)     return <p className="text-sm text-muted-foreground text-center py-12">No analytics available yet.</p>;

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={MessageCircle} label="Enrollments"     value={data.totals.enrollments_total} />
        <KpiCard icon={TrendingUp}    label="Replied"         value={data.totals.replied} />
        <KpiCard icon={BarChart3}     label="Reply Rate"      value={`${data.totals.reply_rate}%`} />
        <KpiCard icon={MailIcon}      label="Sent (30d)"      value={data.totals.sends_last_30_days} />
      </div>

      {/* Sends-by-day chart */}
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Sends — Last 30 Days</p>
        {data.sends_by_day.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 italic">No sends yet. Once a sequence sends its first email, the chart populates here.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.sends_by_day}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(226,12%,55%)" }} axisLine={false} tickLine={false} tickFormatter={(d) => d.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(226,12%,55%)" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "hsl(230,22%,12%)", border: "1px solid hsl(230,16%,18%)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "hsl(226,20%,88%)" }}
              />
              <Bar dataKey="count" fill="hsl(246,90%,60%)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Per-sequence table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Per-Sequence Performance</p>
        </div>
        {data.per_sequence.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 italic">No sequences yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Sequence", "Niche", "Enrolled", "Active", "Replied", "Completed", "Sends", "Reply Rate"].map((h) => (
                  <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.per_sequence.map((s) => (
                <tr key={s.sequence_id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className="text-foreground font-medium">{s.sequence_name}</span>
                    {!s.is_active && <Badge variant="outline" className="ml-2 text-[9px]">INACTIVE</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{s.category ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums">{s.enrolled}</td>
                  <td className="px-4 py-2.5 tabular-nums text-success">{s.active}</td>
                  <td className="px-4 py-2.5 tabular-nums text-primary">{s.replied}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{s.completed}</td>
                  <td className="px-4 py-2.5 tabular-nums">{s.sends}</td>
                  <td className="px-4 py-2.5 tabular-nums font-semibold">
                    <span className={cn(s.reply_rate >= 10 ? "text-success" : "text-muted-foreground")}>{s.reply_rate}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <p className="text-2xl font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

// ── Lead Ingestion docs ───────────────────────────────────
function IngestDocs() {
  const apiBase = (import.meta.env.VITE_API_URL as string) ?? "https://agency.seekersai.org/api/v1";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">How to push leads into the CRM</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Use this webhook from <strong>n8n</strong>, Apollo, Instantly, or any tool that can POST JSON.
          Authentication is via API key set on the VPS as <code className="bg-muted px-1 py-0.5 rounded text-[10px]">AUTOMATION_API_KEY</code>.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Endpoint</p>
        <pre className="bg-muted/40 rounded-lg p-3 text-xs overflow-x-auto"><code>POST {apiBase}/outreach/leads/ingest
Headers:
  Content-Type: application/json
  X-API-Key: {`<your AUTOMATION_API_KEY>`}

Body:
{`{
  "name": "Jane Doe",
  "company": "Acme Corp",
  "email": "jane@acme.com",
  "phone": "+1 555-555-1234",
  "source": "apollo",
  "category": "SaaS",
  "deal_value": 5000,
  "notes": "Reached out via LinkedIn first"
}`}

Response:
{`{ "id": "uuid", "created": true, "deduped": false }`}
</code></pre>
        <p className="text-xs text-muted-foreground">
          The endpoint is idempotent by email (case-insensitive). Existing leads get patched with any missing fields but their data is preserved.
          If a matching active sequence has <strong>auto-enroll</strong> turned on for the same category, the lead is automatically enrolled.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reply detection webhook</p>
        <pre className="bg-muted/40 rounded-lg p-3 text-xs overflow-x-auto"><code>POST {apiBase}/outreach/webhooks/reply
Headers:
  Content-Type: application/json
  X-API-Key: {`<your AUTOMATION_API_KEY>`}

Body:
{`{
  "from_email": "jane@acme.com",
  "subject":    "Re: Quick question",
  "body_preview": "Sounds good — let's set up a call."
}`}

Response:
{`{ "matched": true, "leadId": "uuid", "pausedCount": 1 }`}
</code></pre>
        <p className="text-xs text-muted-foreground">
          When a lead replies, this pauses all their active enrollments (status → <code>replied</code>),
          adds a reply activity to the timeline, and moves the lead from <code>new_lead</code> → <code>contacted</code>.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ready-to-import n8n workflow</p>
        <p className="text-xs text-muted-foreground">
          Pre-built workflow with two pieces:
          <strong className="text-foreground"> (1) a webhook for lead ingestion</strong> any tool can POST to,
          and <strong className="text-foreground">(2) an IMAP email trigger</strong> that watches your inbox for replies and fires the reply webhook.
        </p>
        <div className="flex gap-2 flex-wrap">
          <a href="/n8n/seekers-crm-automation.json" download className="inline-block">
            <Button size="sm" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Download workflow JSON</Button>
          </a>
          <a href="/n8n/SETUP.md" target="_blank" rel="noopener noreferrer" className="inline-block">
            <Button size="sm" variant="outline" className="gap-1.5"><FileText className="h-3.5 w-3.5" /> Setup guide</Button>
          </a>
        </div>
      </div>
    </div>
  );
}
