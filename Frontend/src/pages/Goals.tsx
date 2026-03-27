import { useState } from "react";
import { Plus, Target, Pencil, Trash2, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useGoals, useCreateGoal, useUpdateGoal, useDeleteGoal } from "@/hooks/useGoals";
import { useCurrentUser } from "@/hooks/useAuth";
import type { ApiGoal } from "@/lib/types";

export default function Goals() {
  const [isOpen, setIsOpen]       = useState(false);
  const [editGoal, setEditGoal]   = useState<ApiGoal | null>(null);

  const currentUser = useCurrentUser();
  const isAdmin     = currentUser?.role === "admin";

  const { data: goals = [], isLoading } = useGoals();
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();

  const handleDelete = (id: string) => {
    if (!confirm("Delete this goal? This cannot be undone.")) return;
    deleteGoal.mutate(id, {
      onSuccess: () => toast.success("Goal deleted"),
      onError:   (err) => toast.error(err.message),
    });
  };

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      title:       fd.get("title") as string,
      description: (fd.get("description") as string) || undefined,
      target:      Number(fd.get("target")),
      current:     Number(fd.get("current") ?? 0),
      unit:        (fd.get("unit") as string) || undefined,
      period:      (fd.get("period") as string) || undefined,
    };

    if (editGoal) {
      updateGoal.mutate(
        { id: editGoal.id, ...body },
        {
          onSuccess: () => { setIsOpen(false); setEditGoal(null); toast.success("Goal updated"); },
          onError:   (err) => toast.error(err.message),
        },
      );
    } else {
      createGoal.mutate(body, {
        onSuccess: () => { setIsOpen(false); toast.success("Goal created"); },
        onError:   (err) => toast.error(err.message),
      });
    }
  };

  const openEdit = (g: ApiGoal) => { setEditGoal(g); setIsOpen(true); };
  const openAdd  = () => { setEditGoal(null); setIsOpen(true); };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading goals…</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Goals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track OKR-style progress toward your targets.</p>
        </div>
        <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); if (!o) setEditGoal(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5" onClick={openAdd}><Plus className="h-3.5 w-3.5" /> Add Goal</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editGoal ? "Edit Goal" : "Add Goal"}</DialogTitle></DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div><Label>Title</Label><Input name="title" required defaultValue={editGoal?.title} className="mt-1" /></div>
              <div><Label>Description</Label><Textarea name="description" rows={2} defaultValue={editGoal?.description ?? undefined} className="mt-1" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Target</Label><Input name="target" type="number" step="any" required defaultValue={editGoal ? Number(editGoal.target) : undefined} className="mt-1" /></div>
                <div><Label>Current</Label><Input name="current" type="number" step="any" defaultValue={editGoal ? Number(editGoal.current) : 0} className="mt-1" /></div>
                <div><Label>Unit</Label><Input name="unit" placeholder="e.g. $, %, leads" defaultValue={editGoal?.unit ?? undefined} className="mt-1" /></div>
                <div><Label>Period</Label><Input name="period" placeholder="e.g. Q1 2026" defaultValue={editGoal?.period ?? undefined} className="mt-1" /></div>
              </div>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <Button type="submit" disabled={createGoal.isPending || updateGoal.isPending}>
                  {(createGoal.isPending || updateGoal.isPending) ? "Saving…" : editGoal ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {goals.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center animate-fade-in">
          <Target className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No goals yet. Add your first goal above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((g, i) => {
            const current = Number(g.current);
            const target  = Number(g.target);
            return (
              <div
                key={g.id}
                className="rounded-xl border border-border bg-card p-5 space-y-4 animate-fade-in"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{g.title}</p>
                    {g.period && <p className="text-xs text-muted-foreground mt-0.5">{g.period}</p>}
                    {g.description && <p className="text-xs text-muted-foreground mt-1">{g.description}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(g)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {isAdmin && (
                      <button onClick={() => handleDelete(g.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">
                      {current.toLocaleString()}{g.unit ? ` ${g.unit}` : ""} / {target.toLocaleString()}{g.unit ? ` ${g.unit}` : ""}
                    </span>
                    <span className="text-sm font-semibold text-primary">{g.progress_pct}%</span>
                  </div>
                  <Progress value={g.progress_pct} className="h-2" />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => updateGoal.mutate({ id: g.id, current: Math.max(0, current - 1) }, {
                        onSuccess: () => toast.success("Progress updated"),
                        onError: (err) => toast.error(err.message),
                      })}
                      disabled={current <= 0}
                      className="h-7 w-7 rounded-md border border-border bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <Input
                      type="number"
                      value={current}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (!isNaN(val) && val >= 0) {
                          updateGoal.mutate({ id: g.id, current: val }, {
                            onError: (err) => toast.error(err.message),
                          });
                        }
                      }}
                      className="h-7 w-20 text-center text-xs"
                      min={0}
                    />
                    <button
                      onClick={() => updateGoal.mutate({ id: g.id, current: current + 1 }, {
                        onSuccess: () => toast.success("Progress updated"),
                        onError: (err) => toast.error(err.message),
                      })}
                      className="h-7 w-7 rounded-md border border-border bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {g.owner_name && (
                  <p className="text-xs text-muted-foreground">Owner: {g.owner_name}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
