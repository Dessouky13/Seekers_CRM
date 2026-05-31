import { useState, useMemo } from "react";
import {
  Plus, Mail, Phone, Calendar, FileText, Globe, Trash2, Pencil,
  Search, List, Columns3, UserCheck, Filter, X, ArrowUpDown, Settings2,
  TrendingUp, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { KanbanBoard } from "@/components/modules/KanbanBoard";
import { AgentPanel } from "@/components/modules/AgentPanel";
import { LeadOutreachPanel } from "@/components/modules/LeadOutreachPanel";
import { toast } from "sonner";
import {
  useLeads, useLeadDetail, useCreateLead, useUpdateLead, useDeleteLead,
  useAddLeadActivity, useLeadCategories, usePipelineSummary,
} from "@/hooks/useCRM";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUsers } from "@/hooks/useTasks";
import { useCreateClient } from "@/hooks/useClients";
import { cn } from "@/lib/utils";
import type { ApiLead, LeadStage } from "@/lib/types";

const LEAD_STAGES: { key: LeadStage; label: string; color: string; chip: string }[] = [
  { key: "new_lead",       label: "New Lead",        color: "text-zinc-300",   chip: "bg-zinc-500/15 text-zinc-300 ring-1 ring-inset ring-zinc-500/20" },
  { key: "contacted",      label: "Contacted",       color: "text-blue-300",   chip: "bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-500/20" },
  { key: "call_scheduled", label: "Call Scheduled",  color: "text-violet-300", chip: "bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-500/20" },
  { key: "proposal_sent",  label: "Proposal Sent",   color: "text-amber-300",  chip: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/20" },
  { key: "negotiation",    label: "Negotiation",     color: "text-orange-300", chip: "bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-500/20" },
  { key: "closed_won",     label: "Closed Won",      color: "text-emerald-300", chip: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/20" },
  { key: "closed_lost",    label: "Closed Lost",     color: "text-rose-300",   chip: "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/20" },
];

const CATEGORY_CHIP = "bg-fuchsia-500/12 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-500/20";
const SOURCE_CHIP   = "bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-500/15";

const LEAD_SOURCES = [
  "Instagram", "Facebook", "TikTok", "LinkedIn",
  "Email", "Website", "Phone", "Referral", "Other",
] as const;

const LEAD_CATEGORIES = [
  "E-commerce", "Healthcare", "Real Estate", "Education", "Retail",
  "Food & Beverage", "Manufacturing", "Financial Services", "Legal",
  "Marketing Agency", "SaaS", "Logistics", "Media", "Automotive", "Other",
] as const;

const activityIcons: Record<string, typeof Mail> = {
  email: Mail, call: Phone, meeting: Calendar, form: Globe,
};

const fmt = (n: number | string) => `EGP ${Number(n).toLocaleString()}`;

// ── Lead Detail Sheet ─────────────────────────────────────

function LeadDetailSheet({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { data: lead, isLoading } = useLeadDetail(leadId);
  const addActivity  = useAddLeadActivity();
  const deleteLead   = useDeleteLead();
  const updateLead   = useUpdateLead();
  const createClient = useCreateClient();
  const { data: users = [] } = useUsers();
  const [activityOpen,  setActivityOpen]  = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editMode,      setEditMode]      = useState(false);

  const handleAddActivity = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!leadId) return;
    const fd = new FormData(e.currentTarget);
    addActivity.mutate(
      {
        leadId,
        type:        fd.get("type") as string,
        description: fd.get("description") as string,
        date:        (fd.get("date") as string) || new Date().toISOString().slice(0, 10),
      },
      {
        onSuccess: () => { setActivityOpen(false); toast.success("Activity added"); },
        onError:   (err) => toast.error(err.message),
      },
    );
  };

  const handleDelete = () => {
    if (!leadId) return;
    deleteLead.mutate(leadId, {
      onSuccess: () => { toast.success("Lead deleted"); setDeleteConfirm(false); onClose(); },
      onError:   (err) => toast.error(err.message),
    });
  };

  const handleConvertToClient = () => {
    if (!lead) return;
    createClient.mutate(
      {
        name:    lead.name,
        company: lead.company,
        email:   lead.email   || undefined,
        phone:   lead.phone   || undefined,
        status:  "active",
      },
      {
        onSuccess: () => toast.success(`${lead.name} converted to client`),
        onError:   (err) => toast.error(err.message),
      },
    );
  };

  return (
    <>
      <Sheet open={!!leadId} onOpenChange={(o) => { if (!o) { onClose(); setEditMode(false); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="flex flex-row items-center justify-between pr-0">
            <SheetTitle>{lead?.name ?? (isLoading ? "Loading…" : "Lead")}</SheetTitle>
            {lead && (
              <div className="flex items-center gap-1">
                {lead.stage === "closed_won" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-green-400 hover:text-green-400 gap-1"
                    onClick={handleConvertToClient}
                    disabled={createClient.isPending}
                    title="Convert to client"
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost" size="sm"
                  className="h-7 text-primary hover:text-primary"
                  onClick={() => setEditMode(!editMode)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="sm"
                  className="h-7 text-destructive hover:text-destructive"
                  onClick={() => setDeleteConfirm(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </SheetHeader>

          {isLoading && <p className="text-sm text-muted-foreground mt-6">Loading…</p>}

          {/* View mode */}
          {lead && !editMode && (
            <div className="mt-6 space-y-6">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Company</span><span>{lead.company}</span></div>
                {lead.email && <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Email</span>
                  <span className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-muted-foreground" />{lead.email}</span>
                </div>}
                {lead.phone && <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Phone</span>
                  <span className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-muted-foreground" />{lead.phone}</span>
                </div>}
                {lead.source && <div className="flex justify-between"><span className="text-muted-foreground">Source</span><span>{lead.source}</span></div>}
                {lead.category && <div className="flex justify-between"><span className="text-muted-foreground">Category</span>
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/30">{lead.category}</Badge>
                </div>}
                <div className="flex justify-between"><span className="text-muted-foreground">Deal Value</span><span className="font-semibold text-primary">{fmt(lead.dealValue)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Assigned</span><span>{lead.assignee_name ?? "—"}</span></div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stage</span>
                  <span className="capitalize px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                    {lead.stage.replace(/_/g, " ")}
                  </span>
                </div>
              </div>

              {lead.notes && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Notes</p>
                  <p className="text-sm text-foreground/80 bg-muted/40 rounded-lg p-3">{lead.notes}</p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Activity Timeline</p>
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-primary" onClick={() => setActivityOpen(true)}>
                    + Add
                  </Button>
                </div>
                {(lead.activities ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activities yet.</p>
                ) : (
                  <div className="space-y-3">
                    {[...(lead.activities ?? [])].reverse().map((a) => {
                      const Icon = activityIcons[a.type] ?? FileText;
                      return (
                        <div key={a.id} className="flex gap-3">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm text-foreground">{a.description}</p>
                            <p className="text-xs text-muted-foreground mt-0.5 capitalize">{a.type} · {a.date}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Outreach */}
              <div className="border-t border-border pt-4">
                <LeadOutreachPanel leadId={lead.id} category={lead.category} />
              </div>

              {/* AI Agents */}
              <div className="border-t border-border pt-4">
                <AgentPanel
                  scope="lead"
                  contextId={lead.id}
                  contextLabel={`${lead.name} · ${lead.company}`}
                />
              </div>
            </div>
          )}

          {/* Edit mode */}
          {lead && editMode && (
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                updateLead.mutate(
                  {
                    id:          lead.id,
                    name:        fd.get("name") as string,
                    company:     fd.get("company") as string,
                    email:       (fd.get("email") as string)       || undefined,
                    phone:       (fd.get("phone") as string)       || undefined,
                    source:      (fd.get("source") as string)      || undefined,
                    category:    (fd.get("category") as string)    || undefined,
                    deal_value:  Number(fd.get("deal_value"))      || 0,
                    stage:       fd.get("stage") as string,
                    assignee_id: (fd.get("assignee_id") as string) || undefined,
                    notes:       (fd.get("notes") as string)       || undefined,
                  },
                  {
                    onSuccess: () => { setEditMode(false); toast.success("Lead updated"); },
                    onError:   (err) => toast.error(err.message),
                  },
                );
              }}
            >
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Name</Label><Input name="name" defaultValue={lead.name} required className="mt-1" /></div>
                <div><Label>Company</Label><Input name="company" defaultValue={lead.company} required className="mt-1" /></div>
                <div><Label>Email</Label><Input name="email" type="email" defaultValue={lead.email ?? ""} className="mt-1" /></div>
                <div><Label>Phone</Label><Input name="phone" defaultValue={lead.phone ?? ""} className="mt-1" /></div>
                <div>
                  <Label>Source</Label>
                  <select name="source" defaultValue={lead.source ?? ""} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">None</option>
                    {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Category / Niche</Label>
                  <select name="category" defaultValue={lead.category ?? ""} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">None</option>
                    {LEAD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><Label>Deal Value (EGP)</Label><Input name="deal_value" type="number" min="0" defaultValue={Number(lead.dealValue)} className="mt-1" /></div>
                <div>
                  <Label>Stage</Label>
                  <select name="stage" defaultValue={lead.stage} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <Label>Assigned To</Label>
                  <select name="assignee_id" defaultValue={lead.assigneeId ?? ""} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">Unassigned</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>
              <div><Label>Notes</Label><Textarea name="notes" rows={3} defaultValue={lead.notes ?? ""} className="mt-1" /></div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setEditMode(false)}>Cancel</Button>
                <Button type="submit" disabled={updateLead.isPending}>
                  {updateLead.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </form>
          )}

          {/* Add Activity Dialog */}
          <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Activity</DialogTitle></DialogHeader>
              <form onSubmit={handleAddActivity} className="space-y-4">
                <div>
                  <Label>Type</Label>
                  <select name="type" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {["email", "call", "meeting", "form", "note"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div><Label>Description</Label><Input name="description" required className="mt-1" /></div>
                <div><Label>Date</Label><Input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="mt-1" /></div>
                <DialogFooter>
                  <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                  <Button type="submit" disabled={addActivity.isPending}>
                    {addActivity.isPending ? "Adding…" : "Add Activity"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete {lead?.name} from {lead?.company}? All activities will also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              {deleteLead.isPending ? "Deleting…" : "Delete Lead"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Main CRM Page ─────────────────────────────────────────

export default function CRM() {
  const [isOpen,      setIsOpen]      = useState(false);
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [view,        setView]        = useState<"kanban" | "list">("kanban");
  const [search,      setSearch]      = useState("");
  const [catFilter,   setCatFilter]   = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 350);

  const { data: rawLeads = [], isLoading } = useLeads({
    search:   debouncedSearch || undefined,
    category: catFilter || undefined,
    stage:    stageFilter || undefined,
    limit:    200,
  });

  // Pipeline-summary: accurate totals across ALL leads regardless of current filter
  const { data: pipeline = [] } = usePipelineSummary();
  const { data: users    = [] } = useUsers();
  const { data: categories = [] } = useLeadCategories();
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();

  // Deduplicate by id to prevent any double-render glitches
  const leads = useMemo(
    () => rawLeads.filter((l, i, arr) => arr.findIndex((x) => x.id === l.id) === i),
    [rawLeads],
  );

  const columns = LEAD_STAGES.map((stage) => ({
    key:   stage.key,
    label: stage.label,
    items: leads.filter((l) => l.stage === stage.key),
  }));

  const handleMove = (itemId: string, _from: string, to: string) => {
    updateLead.mutate(
      { id: itemId, stage: to },
      { onError: () => toast.error("Failed to move lead") },
    );
  };

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createLead.mutate(
      {
        name:        fd.get("name") as string,
        company:     fd.get("company") as string,
        email:       (fd.get("email") as string)       || undefined,
        phone:       (fd.get("phone") as string)       || undefined,
        source:      (fd.get("source") as string)      || undefined,
        category:    (fd.get("category") as string)    || undefined,
        deal_value:  Number(fd.get("deal_value"))      || 0,
        assignee_id: (fd.get("assignee_id") as string) || undefined,
        notes:       (fd.get("notes") as string)       || undefined,
      },
      {
        onSuccess: () => { setIsOpen(false); toast.success("Lead added"); },
        onError:   (err) => toast.error(err.message),
      },
    );
  };

  // Global totals — from pipeline-summary, not filtered leads.
  // This is THE bug fix: previously stats used the filtered+limited array.
  const totalActive    = pipeline.filter((r) => !["closed_won", "closed_lost"].includes(r.stage)).reduce((s, r) => s + Number(r.count), 0);
  const totalPipeline  = pipeline.filter((r) => !["closed_won", "closed_lost"].includes(r.stage)).reduce((s, r) => s + Number(r.total_value), 0);
  const wonCount       = Number(pipeline.find((r) => r.stage === "closed_won")?.count ?? 0);
  const wonValue       = Number(pipeline.find((r) => r.stage === "closed_won")?.total_value ?? 0);
  const lostCount      = Number(pipeline.find((r) => r.stage === "closed_lost")?.count ?? 0);
  const totalClosed    = wonCount + lostCount;
  const convRate       = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : 0;

  const activeFilterCount = (catFilter ? 1 : 0) + (stageFilter ? 1 : 0);

  const LeadCard = ({ lead }: { lead: ApiLead }) => {
    const isStale  = lead.lastActivity
      ? (Date.now() - new Date(lead.lastActivity).getTime()) > 2 * 24 * 60 * 60 * 1000
      : true;
    const isActive = !["closed_won", "closed_lost"].includes(lead.stage);

    return (
      <div
        onClick={() => setSelectedId(lead.id)}
        className={cn(
          "group rounded-md border bg-card px-3 py-2.5 space-y-2 transition-all cursor-pointer",
          "hover:shadow-sm hover:border-border/80 hover:bg-card/80",
          isStale && isActive ? "border-destructive/30" : "border-border/60",
        )}
      >
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground leading-snug">{lead.name}</p>
          <p className="text-xs text-muted-foreground leading-tight">{lead.company}</p>
        </div>
        {(lead.category || lead.source) && (
          <div className="flex flex-wrap items-center gap-1">
            {lead.category && (
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", CATEGORY_CHIP)}>
                {lead.category}
              </span>
            )}
            {lead.source && (
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", SOURCE_CHIP)}>
                {lead.source}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center justify-between pt-1 border-t border-border/40">
          <span className="text-xs font-semibold text-foreground tabular-nums">{fmt(lead.dealValue)}</span>
          <div className="flex items-center gap-1.5">
            {isStale && isActive && (
              <span className="text-[10px] text-destructive font-semibold" title="No activity in 2+ days">⚠</span>
            )}
            <span className="text-[10px] text-muted-foreground">{lead.lastActivity ?? "—"}</span>
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading leads…</div>;
  }

  return (
    <div className="space-y-4 w-full overflow-hidden -mt-2">
      {/* ── Notion-style header ──────────────────────────────── */}
      <div className="flex items-end justify-between flex-wrap gap-3 pb-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Leads</h1>
          </div>
          <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
            <span><span className="text-foreground font-semibold tabular-nums">{totalActive}</span> active</span>
            <span className="text-border">·</span>
            <span>Pipeline <span className="text-foreground font-semibold tabular-nums">{fmt(totalPipeline)}</span></span>
            <span className="text-border">·</span>
            <span><span className="text-emerald-400 font-semibold tabular-nums">{wonCount}</span> won</span>
            <span className="text-border">·</span>
            <span><span className="text-rose-400 font-semibold tabular-nums">{lostCount}</span> lost</span>
            <span className="text-border">·</span>
            <span><span className="text-primary font-semibold tabular-nums">{convRate}%</span> conv</span>
          </div>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 h-8">
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add Lead</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Name</Label><Input name="name" required className="mt-1" /></div>
                <div><Label>Company</Label><Input name="company" required className="mt-1" /></div>
                <div><Label>Email</Label><Input name="email" type="email" className="mt-1" /></div>
                <div><Label>Phone</Label><Input name="phone" className="mt-1" placeholder="+20..." /></div>
                <div>
                  <Label>Source</Label>
                  <select name="source" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">None</option>
                    {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Niche</Label>
                  <select name="category" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">None</option>
                    {LEAD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><Label>Deal Value (EGP)</Label><Input name="deal_value" type="number" min="0" className="mt-1" /></div>
                <div>
                  <Label>Assigned To</Label>
                  <select name="assignee_id" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">Unassigned</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>
              <div><Label>Notes</Label><Textarea name="notes" rows={2} placeholder="Any context about this lead…" className="mt-1" /></div>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <Button type="submit" disabled={createLead.isPending}>
                  {createLead.isPending ? "Adding…" : "Add Lead"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* ── View tabs (Notion-style underline indicator) ────── */}
      <div className="flex items-center gap-1 border-b border-border/60">
        <button
          onClick={() => setView("list")}
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5",
            view === "list"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <List className="h-3.5 w-3.5" /> Table
        </button>
        <button
          onClick={() => setView("kanban")}
          className={cn(
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5",
            view === "kanban"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Columns3 className="h-3.5 w-3.5" /> Board
        </button>
      </div>

      {/* ── Filter bar — Notion-style: search + filter pills + sort ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by name or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm border-border/60 bg-transparent focus-visible:bg-background"
          />
        </div>

        {/* Filter button with popover-like select */}
        <div className="flex items-center gap-1">
          <div className="relative">
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className={cn(
                "h-8 appearance-none rounded-md pl-7 pr-7 text-xs cursor-pointer transition-colors",
                "border bg-transparent",
                stageFilter
                  ? "border-foreground/30 text-foreground bg-muted/40"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              <option value="">Stage</option>
              {LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none text-muted-foreground" />
          </div>
          <div className="relative">
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className={cn(
                "h-8 appearance-none rounded-md pl-7 pr-7 text-xs cursor-pointer transition-colors",
                "border bg-transparent",
                catFilter
                  ? "border-foreground/30 text-foreground bg-muted/40"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
              )}
            >
              <option value="">Niche</option>
              {LEAD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              {categories.filter((c) => !LEAD_CATEGORIES.includes(c as any)).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none text-muted-foreground" />
          </div>
        </div>

        {/* Active filter pills */}
        {stageFilter && (
          <FilterPill
            label={`Stage: ${LEAD_STAGES.find((s) => s.key === stageFilter)?.label}`}
            onRemove={() => setStageFilter("")}
          />
        )}
        {catFilter && (
          <FilterPill label={`Niche: ${catFilter}`} onRemove={() => setCatFilter("")} />
        )}

        {(search || activeFilterCount > 0) && (
          <button
            onClick={() => { setSearch(""); setCatFilter(""); setStageFilter(""); }}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            Reset
          </button>
        )}

        <div className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {leads.length} {leads.length === 1 ? "row" : "rows"}
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────── */}
      {view === "kanban" ? (
        <KanbanBoard
          columns={LEAD_STAGES.map((s) => ({
            key:   s.key,
            label: s.label,
            items: leads.filter((l) => l.stage === s.key),
          }))}
          renderCard={(lead) => <LeadCard lead={lead} />}
          onMoveItem={handleMove}
          getItemId={(l) => l.id}
        />
      ) : leads.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 p-12 text-center">
          <p className="text-sm font-medium text-foreground">No leads match these filters</p>
          <p className="text-xs text-muted-foreground mt-1">
            {search || activeFilterCount > 0
              ? "Try clearing filters or "
              : "Get started by "}
            <button onClick={() => setIsOpen(true)} className="text-primary hover:underline">
              add a new lead
            </button>.
          </p>
        </div>
      ) : (
        <NotionTable
          leads={leads}
          stages={LEAD_STAGES}
          onSelect={setSelectedId}
          fmt={fmt}
        />
      )}

      <LeadDetailSheet leadId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

// ─── Notion-style filter pill ────────────────────────────
function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-muted/60 border border-border/60 text-[11px] text-foreground font-medium">
      {label}
      <button onClick={onRemove} className="rounded hover:bg-muted ml-0.5">
        <X className="h-3 w-3 text-muted-foreground" />
      </button>
    </span>
  );
}

// ─── Notion-style table ──────────────────────────────────
function NotionTable({
  leads, stages, onSelect, fmt,
}: {
  leads:    ApiLead[];
  stages:   typeof LEAD_STAGES;
  onSelect: (id: string) => void;
  fmt:      (n: number | string) => string;
}) {
  return (
    <div className="border border-border/60 rounded-lg overflow-hidden bg-card/30">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/20">
              {[
                { label: "Name",        cls: "w-[22%]" },
                { label: "Company",     cls: "w-[18%]" },
                { label: "Stage",       cls: "w-[14%]" },
                { label: "Niche",       cls: "w-[12%]" },
                { label: "Deal Value",  cls: "w-[10%] text-right" },
                { label: "Source",      cls: "w-[8%]" },
                { label: "Last Activity", cls: "w-[10%]" },
                { label: "Assigned",    cls: "w-[6%]" },
              ].map((h) => (
                <th
                  key={h.label}
                  className={cn(
                    "px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider",
                    h.cls,
                    h.cls.includes("text-right") ? "text-right" : "text-left",
                  )}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const stageInfo = stages.find((s) => s.key === l.stage);
              const isStale   = l.lastActivity
                ? (Date.now() - new Date(l.lastActivity).getTime()) > 2 * 24 * 60 * 60 * 1000
                : true;
              const isActive  = !["closed_won", "closed_lost"].includes(l.stage);
              return (
                <tr
                  key={l.id}
                  onClick={() => onSelect(l.id)}
                  className="group border-b border-border/30 last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{l.name}</span>
                      {isStale && isActive && (
                        <span className="text-[10px] text-destructive" title="No activity in 2+ days">⚠</span>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground truncate">{l.company}</td>
                  <td className="px-3 py-2.5">
                    <span className={cn("inline-block text-[11px] font-medium px-2 py-0.5 rounded", stageInfo?.chip)}>
                      {stageInfo?.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {l.category
                      ? <span className={cn("inline-block text-[10px] font-medium px-1.5 py-0.5 rounded", CATEGORY_CHIP)}>{l.category}</span>
                      : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-foreground font-medium text-right">{fmt(l.dealValue)}</td>
                  <td className="px-3 py-2.5">
                    {l.source
                      ? <span className={cn("inline-block text-[10px] font-medium px-1.5 py-0.5 rounded", SOURCE_CHIP)}>{l.source}</span>
                      : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground tabular-nums text-[12px]">{l.lastActivity ?? "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground text-[12px] truncate">{l.assignee_name ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
