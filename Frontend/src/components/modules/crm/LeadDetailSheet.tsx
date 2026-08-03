// Lead detail side sheet: read-only view (contact fields, notes, activity
// timeline, outreach + AI agent panels), inline edit form, the "add activity"
// dialog and the single-lead delete confirmation. Owns its own data hooks.

import { useState } from "react";
import { Mail, Phone, FileText, Trash2, Pencil, UserCheck, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
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
import { cairoToday } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentPanel } from "@/components/modules/AgentPanel";
import { LeadOutreachPanel } from "@/components/modules/LeadOutreachPanel";
import { toast } from "sonner";
import {
  useLeadDetail, useUpdateLead, useDeleteLead, useAddLeadActivity,
} from "@/hooks/useCRM";
import { useUsers, useCreateTask } from "@/hooks/useTasks";
import { useCreateClient } from "@/hooks/useClients";
import { LEAD_STAGES, LEAD_SOURCES, LEAD_CATEGORIES, activityIcons, fmt } from "./constants";

export function LeadDetailSheet({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { data: lead, isLoading } = useLeadDetail(leadId);
  const addActivity  = useAddLeadActivity();
  const deleteLead   = useDeleteLead();
  const updateLead   = useUpdateLead();
  const createClient = useCreateClient();
  const { data: users = [] } = useUsers();
  const [activityOpen,  setActivityOpen]  = useState(false);
  // Today -> lead -> reply -> TASK was a dead end: the sheet could enrol,
  // log activity and run an agent, but there was no way to turn a reply into
  // a follow-up task without leaving for the Tasks page and retyping the
  // context. This closes that loop.
  const [taskOpen, setTaskOpen] = useState(false);
  const createTask = useCreateTask();
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
        date:        (fd.get("date") as string) || cairoToday(),
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
        onSuccess: () => {
          toast.success(`${lead.name} converted to client`);
          // Closes the loop on the timeline: anyone reviewing this lead later
          // can see exactly when and that it became a client, without having
          // to cross-reference the Clients page.
          addActivity.mutate({
            leadId: lead.id,
            type: "note",
            description: "Converted to client",
            date: cairoToday(),
          });
        },
        onError: (err) => toast.error(err.message),
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
                {/* Convert-to-client used to live here too, as a second
                    icon-only button easy to miss next to Edit/Delete. It's now
                    a full-width button right under the Stage control below —
                    same place you just moved the lead to Closed Won, so the
                    next obvious action is right there instead of hidden in
                    the header. */}
                {/* These were unlabelled icon-only buttons, so a screen reader
                    announced "button" for the control that DELETES a lead. The
                    min-h/min-w give a 44px touch box without changing the visual
                    size — they were 40x28, roughly half the recommended target. */}
                <Button
                  variant="ghost" size="sm"
                  className="h-7 min-h-11 min-w-11 text-primary hover:text-primary"
                  aria-label={editMode ? "Stop editing this lead" : "Edit this lead"}
                  title={editMode ? "Stop editing" : "Edit lead"}
                  onClick={() => setEditMode(!editMode)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="sm"
                  className="h-7 min-h-11 min-w-11 text-destructive hover:text-destructive"
                  aria-label="Delete this lead"
                  title="Delete lead"
                  onClick={() => setDeleteConfirm(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </SheetHeader>

          {isLoading && <LeadDetailSkeleton />}

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
                {/* Stage is a CONTROL, not a label.
                    It used to render as plain text, and the kanban board it
                    mirrors uses HTML5 drag-and-drop, which touch browsers do not
                    synthesise from a finger. So on a phone the only way to move a
                    lead through the pipeline was: tap the pencil, scroll the edit
                    form, change a <select>, then Save — six taps for the single
                    most common action in a CRM. This commits on change, using the
                    optimistic mutation that already existed. */}
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="lead-stage-quick" className="text-muted-foreground">Stage</label>
                  <select
                    id="lead-stage-quick"
                    value={lead.stage}
                    disabled={updateLead.isPending}
                    onChange={(e) => {
                      const stage = e.target.value;
                      if (stage === lead.stage) return;
                      updateLead.mutate(
                        { id: lead.id, stage },
                        {
                          onSuccess: () =>
                            toast.success(
                              `Moved to ${LEAD_STAGES.find((s) => s.key === stage)?.label ?? stage}`,
                            ),
                          onError: (err) => toast.error(err.message),
                        },
                      );
                    }}
                    className="min-h-11 rounded-full bg-primary/10 px-3 text-xs font-medium capitalize text-primary
                               disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-ring"
                  >
                    {LEAD_STAGES.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* The pipeline's obvious next step. Visible and one tap: no
                  hunting for a tiny icon once a deal is won, and a plain
                  sentence pointing at the stage control otherwise — not a
                  tour, just the one thing to do next. */}
              {lead.stage === "closed_won" ? (
                <Button
                  className="w-full gap-1.5 bg-green-600 text-white hover:bg-green-600/90"
                  onClick={handleConvertToClient}
                  disabled={createClient.isPending}
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  {createClient.isPending ? "Converting…" : "Convert to Client"}
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground -mt-3">
                  Move the stage above to <strong>Closed Won</strong> to convert this lead into a client.
                </p>
              )}

              {lead.notes && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Notes</p>
                  <p className="text-sm text-foreground/80 bg-muted/40 rounded-lg p-3">{lead.notes}</p>
                </div>
              )}

              {/* The action you most often want after reading a reply. Sits
                  above the timeline so it's reachable without scrolling the
                  sheet on a phone. */}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5"
                onClick={() => setTaskOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Create follow-up task
              </Button>

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
                    {/* The API now returns activities newest-first (ordered by
                        date then created_at); reversing here would undo that. */}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

          {/* Create Task Dialog — pre-filled with the lead's context.
              Guarded on `lead`: this sits outside the view-mode block, so while
              the detail query is in flight `lead` is undefined. Dereferencing it
              here threw and took the whole CRM page down with it. */}
          <Dialog open={taskOpen && !!lead} onOpenChange={setTaskOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>New task for {lead?.name}</DialogTitle></DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  createTask.mutate(
                    {
                      title:       fd.get('title') as string,
                      description: (fd.get('description') as string) || undefined,
                      due_date:    (fd.get('due_date') as string) || undefined,
                      priority:    (fd.get('priority') as string) || 'medium',
                      assignee_id: lead?.assigneeId || undefined,
                    },
                    {
                      onSuccess: () => { setTaskOpen(false); toast.success('Task created'); },
                      onError:   (err) => toast.error(err.message),
                    },
                  );
                }}
                className="space-y-4"
              >
                <div>
                  <Label>Title</Label>
                  <Input
                    name="title"
                    required
                    className="mt-1"
                    defaultValue={'Follow up: ' + (lead?.company ?? '')}
                  />
                </div>
                <div><Label>Notes</Label><Input name="description" className="mt-1" placeholder="Optional" /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><Label>Due date</Label><Input name="due_date" type="date" className="mt-1" /></div>
                  <div>
                    <Label>Priority</Label>
                    <select name="priority" defaultValue="medium" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                      {['low', 'medium', 'high', 'critical'].map((pr) => (
                        <option key={pr} value={pr}>{pr}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Assigned to whoever owns this lead.
                </p>
                <DialogFooter>
                  <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
                  <Button type="submit" disabled={createTask.isPending}>
                    {createTask.isPending ? 'Creating…' : 'Create task'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

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
                <div><Label>Date</Label><Input name="date" type="date" defaultValue={cairoToday()} className="mt-1" /></div>
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
              className="bg-destructive-solid text-destructive-foreground hover:bg-destructive-solid/90"
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

// Mirrors the view-mode layout: the label/value field rows, the notes block and
// the first few activity timeline entries.
function LeadDetailSkeleton() {
  return (
    <div className="mt-6 space-y-6">
      <div className="space-y-3 text-sm">
        {[
          "w-20", "w-32", "w-24", "w-16", "w-20", "w-24", "w-20", "w-24",
        ].map((valueWidth, i) => (
          <div key={i} className="flex justify-between items-center">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className={`h-3.5 ${valueWidth}`} />
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Notes</p>
        <div className="bg-muted/40 rounded-lg p-3 space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Activity Timeline</p>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
