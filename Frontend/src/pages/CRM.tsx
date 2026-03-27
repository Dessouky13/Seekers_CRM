import { useState } from "react";
import { Plus, Mail, Phone, Calendar, FileText, Globe, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { KanbanBoard } from "@/components/modules/KanbanBoard";
import { toast } from "sonner";
import { useLeads, useLeadDetail, useCreateLead, useUpdateLead, useDeleteLead, useAddLeadActivity } from "@/hooks/useCRM";
import { useUsers } from "@/hooks/useTasks";
import { cn } from "@/lib/utils";
import type { ApiLead, LeadStage } from "@/lib/types";

const LEAD_STAGES: { key: LeadStage; label: string }[] = [
  { key: "new_lead",       label: "New Lead" },
  { key: "contacted",      label: "Contacted" },
  { key: "call_scheduled", label: "Call Scheduled" },
  { key: "proposal_sent",  label: "Proposal Sent" },
  { key: "negotiation",    label: "Negotiation" },
  { key: "closed_won",     label: "Closed Won" },
  { key: "closed_lost",    label: "Closed Lost" },
];

const LEAD_SOURCES = [
  "Instagram", "Facebook", "TikTok", "LinkedIn",
  "Email", "Website", "Phone", "Referral", "Other",
] as const;

const activityIcons: Record<string, typeof Mail> = {
  email: Mail, call: Phone, meeting: Calendar, form: Globe,
};

const fmt = (n: number | string) => `EGP ${Number(n).toLocaleString()}`;

function LeadDetailSheet({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { data: lead, isLoading } = useLeadDetail(leadId);
  const addActivity  = useAddLeadActivity();
  const deleteLead   = useDeleteLead();
  const updateLead   = useUpdateLead();
  const { data: users = [] } = useUsers();
  const [activityOpen,  setActivityOpen]  = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editMode, setEditMode]           = useState(false);

  const handleAddActivity = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!leadId) return;
    const fd = new FormData(e.currentTarget);
    addActivity.mutate(
      {
        leadId,
        type:        fd.get("type") as string,
        description: fd.get("description") as string,
        date:        fd.get("date") as string || new Date().toISOString().slice(0, 10),
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

  return (
    <>
      <Sheet open={!!leadId} onOpenChange={(o) => { if (!o) { onClose(); setEditMode(false); } }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {/* Always render SheetTitle for accessibility — shown or visually hidden */}
          <SheetHeader className="flex flex-row items-center justify-between pr-0">
            <SheetTitle>{lead?.name ?? (isLoading ? "Loading…" : "Lead")}</SheetTitle>
            {lead && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-primary hover:text-primary"
                  onClick={() => setEditMode(!editMode)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-destructive hover:text-destructive"
                  onClick={() => setDeleteConfirm(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </SheetHeader>

          {isLoading && <p className="text-sm text-muted-foreground mt-6">Loading…</p>}
          {lead && !editMode && (
            <div className="mt-6 space-y-6">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Company</span><span>{lead.company}</span></div>
                {lead.email && <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{lead.email}</span></div>}
                {lead.source && <div className="flex justify-between"><span className="text-muted-foreground">Source</span><span>{lead.source}</span></div>}
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
                    {(lead.activities ?? []).map((a) => {
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
                    email:       (fd.get("email") as string) || undefined,
                    source:      (fd.get("source") as string) || undefined,
                    deal_value:  Number(fd.get("deal_value")) || 0,
                    stage:       fd.get("stage") as string,
                    assignee_id: (fd.get("assignee_id") as string) || undefined,
                    notes:       (fd.get("notes") as string) || undefined,
                  },
                  {
                    onSuccess: () => {
                      setEditMode(false);
                      toast.success("Lead updated");
                    },
                    onError: (err) => toast.error(err.message),
                  },
                );
              }}
            >
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Name</Label><Input name="name" defaultValue={lead.name} required className="mt-1" /></div>
                <div><Label>Company</Label><Input name="company" defaultValue={lead.company} required className="mt-1" /></div>
                <div><Label>Email</Label><Input name="email" type="email" defaultValue={lead.email ?? ""} className="mt-1" /></div>
                <div>
                  <Label>Source</Label>
                  <select name="source" defaultValue={lead.source ?? ""} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">None</option>
                    {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
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

      {/* Delete lead confirmation */}
      <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete {lead?.name} from {lead?.company}? All activities will also be removed. This cannot be undone.
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

export default function CRM() {
  const [isOpen, setIsOpen]         = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: leads = [], isLoading } = useLeads();
  const { data: users  = [] }           = useUsers();
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();

  const columns = LEAD_STAGES.map((stage) => ({
    key:   stage.key,
    label: stage.label,
    items: leads.filter((l) => l.stage === stage.key),
  }));

  const handleMove = (itemId: string, _from: string, to: string) => {
    updateLead.mutate(
      { id: itemId, stage: to },
      { onSuccess: () => toast.success("Lead moved") },
    );
  };

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createLead.mutate(
      {
        name:        fd.get("name") as string,
        company:     fd.get("company") as string,
        email:       (fd.get("email") as string) || undefined,
        source:      (fd.get("source") as string) || undefined,
        deal_value:  Number(fd.get("deal_value")) || 0,
        assignee_id: (fd.get("assignee_id") as string) || undefined,
        notes:       (fd.get("notes") as string) || undefined,
      },
      {
        onSuccess: () => { setIsOpen(false); toast.success("Lead added"); },
        onError:   (err) => toast.error(err.message),
      },
    );
  };

  const totalPipeline = leads
    .filter((l) => !["closed_won", "closed_lost"].includes(l.stage))
    .reduce((s, l) => s + Number(l.dealValue), 0);

  const LeadCard = ({ lead }: { lead: ApiLead }) => {
    const isStale = lead.lastActivity
      ? (Date.now() - new Date(lead.lastActivity).getTime()) > 2 * 24 * 60 * 60 * 1000
      : true;
    const isActive = !["closed_won", "closed_lost"].includes(lead.stage);

    return (
      <div
        onClick={() => setSelectedId(lead.id)}
        className={cn(
          "rounded-lg border bg-card p-3 space-y-2 hover:border-primary/30 transition-colors cursor-pointer",
          isStale && isActive ? "border-destructive/40" : "border-border",
        )}
      >
        <div>
          <p className="text-sm font-medium text-foreground">{lead.name}</p>
          <p className="text-xs text-muted-foreground">{lead.company}</p>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-primary tabular-nums">{fmt(lead.dealValue)}</span>
          <div className="flex items-center gap-1.5">
            {lead.source && (
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{lead.source}</span>
            )}
            {isStale && isActive && (
              <span className="text-[10px] text-destructive font-semibold">⚠</span>
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
    <div className="space-y-6 w-full overflow-hidden">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">CRM</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Pipeline: <span className="text-primary font-semibold">{fmt(totalPipeline)}</span>
            <span className="mx-2 text-border">·</span>
            <span className="text-foreground font-medium">{leads.filter(l => !["closed_won","closed_lost"].includes(l.stage)).length}</span> active leads
          </p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add Lead</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Lead</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Name</Label><Input name="name" required className="mt-1" /></div>
                <div><Label>Company</Label><Input name="company" required className="mt-1" /></div>
                <div><Label>Email</Label><Input name="email" type="email" className="mt-1" /></div>
                <div>
                  <Label>Source</Label>
                  <select name="source" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    {LEAD_SOURCES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
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

      {/* Pipeline Stats */}
      {(() => {
        const won      = leads.filter(l => l.stage === "closed_won");
        const lost     = leads.filter(l => l.stage === "closed_lost");
        const active   = leads.filter(l => !["closed_won","closed_lost"].includes(l.stage));
        const wonValue = won.reduce((s, l) => s + Number(l.dealValue), 0);
        const total    = won.length + lost.length;
        const convRate = total > 0 ? Math.round((won.length / total) * 100) : 0;
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Active Leads</p>
              <p className="text-lg font-bold text-foreground">{active.length}</p>
              <p className="text-[11px] text-muted-foreground">{fmt(totalPipeline)} in pipeline</p>
            </div>
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
              <p className="text-[11px] text-green-400 uppercase tracking-wide">Won</p>
              <p className="text-lg font-bold text-green-400">{won.length}</p>
              <p className="text-[11px] text-green-400/70">{fmt(wonValue)} closed</p>
            </div>
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-[11px] text-red-400 uppercase tracking-wide">Lost</p>
              <p className="text-lg font-bold text-red-400">{lost.length}</p>
            </div>
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <p className="text-[11px] text-primary uppercase tracking-wide">Conversion</p>
              <p className="text-lg font-bold text-primary">{convRate}%</p>
              <p className="text-[11px] text-muted-foreground">{total} total closed</p>
            </div>
          </div>
        );
      })()}

      <KanbanBoard
        columns={columns}
        renderCard={(lead) => <LeadCard lead={lead} />}
        onMoveItem={handleMove}
        getItemId={(l) => l.id}
      />

      <LeadDetailSheet leadId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
