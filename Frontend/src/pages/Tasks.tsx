import { useState } from "react";
import { Plus, List, Columns3, Trash2, Pencil, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { KanbanBoard } from "@/components/modules/KanbanBoard";
import { toast } from "sonner";
import {
  useTasks, useProjects, useUsers, useCreateTask, useMoveTask, useUpdateTask,
  useToggleSubtask, useDeleteTask, useCreateProject,
} from "@/hooks/useTasks";
import { useClients } from "@/hooks/useClients";
import { cn } from "@/lib/utils";
import type { ApiTask } from "@/lib/types";

type TaskStatus   = ApiTask["status"];
type TaskPriority = ApiTask["priority"];

const statusColumns: { key: TaskStatus; label: string }[] = [
  { key: "backlog",     label: "Backlog" },
  { key: "todo",        label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "review",      label: "Review" },
  { key: "done",        label: "Done" },
];

const priorityColors: Record<TaskPriority, string> = {
  low:      "bg-muted text-muted-foreground",
  medium:   "bg-info/15 text-info",
  high:     "bg-warning/15 text-warning",
  critical: "bg-destructive/15 text-destructive",
};

export default function Tasks() {
  const [projectFilter, setProjectFilter] = useState("all");
  const [clientFilter,  setClientFilter]  = useState("all");
  const [view,          setView]          = useState<"kanban" | "list">("kanban");
  const [isOpen,        setIsOpen]        = useState(false);
  const [projOpen,      setProjOpen]      = useState(false);
  const [detailTask,    setDetailTask]    = useState<ApiTask | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editMode,      setEditMode]      = useState(false);

  const filterParams: Record<string, string> = {};
  if (projectFilter !== "all") filterParams.project_id = projectFilter;
  if (clientFilter  !== "all") filterParams.client_id  = clientFilter;

  const { data: tasksRes, isLoading } = useTasks(
    Object.keys(filterParams).length > 0 ? filterParams : undefined,
  );
  const { data: projects  = [] } = useProjects();
  const { data: users     = [] } = useUsers();
  const { data: clients   = [] } = useClients();
  const createTask    = useCreateTask();
  const createProject = useCreateProject();
  const moveTask      = useMoveTask();
  const updateTask    = useUpdateTask();
  const toggleSub     = useToggleSubtask();
  const deleteTask    = useDeleteTask();

  const tasks = tasksRes?.data ?? [];

  const columns = statusColumns.map((col) => ({
    key:   col.key,
    label: col.label,
    items: tasks.filter((t) => t.status === col.key),
  }));

  const handleMove = (itemId: string, _from: string, to: string) => {
    moveTask.mutate(
      { id: itemId, status: to },
      { onSuccess: () => toast.success("Task moved") },
    );
  };

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const projectId = (fd.get("project_id") as string) || undefined;
    // Auto-inherit client from project if not manually set
    const project  = projects.find((p) => p.id === projectId);
    const clientId = (fd.get("client_id") as string) || project?.clientId || undefined;
    createTask.mutate(
      {
        title:       fd.get("title") as string,
        description: (fd.get("description") as string) || undefined,
        assignee_id: (fd.get("assignee_id") as string) || undefined,
        priority:    (fd.get("priority") as TaskPriority) || "medium",
        due_date:    (fd.get("due_date") as string)    || undefined,
        project_id:  projectId,
        client_id:   clientId,
      },
      {
        onSuccess: () => { setIsOpen(false); toast.success("Task created"); },
        onError:   (err) => toast.error(err.message),
      },
    );
  };

  const handleCreateProject = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createProject.mutate(
      {
        name:      fd.get("name") as string,
        client_id: (fd.get("client_id") as string) || undefined,
      },
      {
        onSuccess: () => { setProjOpen(false); toast.success("Project created"); },
        onError:   (err) => toast.error(err.message),
      },
    );
  };

  const TaskCard = ({ task }: { task: ApiTask }) => {
    const isOverdue = task.dueDate && task.status !== "done" && new Date(task.dueDate) < new Date();
    return (
      <div
        onClick={() => setDetailTask(task)}
        className={cn(
          "rounded-lg border bg-card p-3 space-y-2 hover:border-primary/30 transition-colors cursor-pointer",
          isOverdue ? "border-destructive/40" : "border-border",
        )}
      >
        <p className="text-sm font-medium text-foreground leading-snug">{task.title}</p>
        {(task.project_name || task.client_name) && (
          <p className="text-[10px] text-muted-foreground">
            {task.project_name && <span className="text-primary/80">{task.project_name}</span>}
            {task.project_name && task.client_name && <span className="mx-1 text-border">·</span>}
            {task.client_name && <span className="text-secondary">{task.client_name}</span>}
          </p>
        )}
        <div className="flex items-center justify-between">
          <span className={cn("text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded", priorityColors[task.priority])}>
            {task.priority}
          </span>
          <div className="flex items-center gap-2">
            {task.dueDate && (
              <span className={cn("text-[10px]", isOverdue ? "text-destructive font-semibold" : "text-muted-foreground")}>
                {isOverdue ? "⚠ " : ""}{task.dueDate.slice(5)}
              </span>
            )}
            {task.assignee_name && (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[8px] font-semibold text-primary" title={task.assignee_name}>
                {task.assignee_name.split(" ").map((n) => n[0]).join("")}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading tasks…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tasks.length} task{tasks.length !== 1 ? "s" : ""} · {projects.length} project{projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Project filter */}
          <Select value={projectFilter} onValueChange={(v) => { setProjectFilter(v); setClientFilter("all"); }}>
            <SelectTrigger className="w-44 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}{p.client_name ? ` (${p.client_name})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Client filter */}
          <Select value={clientFilter} onValueChange={(v) => { setClientFilter(v); setProjectFilter("all"); }}>
            <SelectTrigger className="w-40 h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View toggle */}
          <div className="flex border border-border rounded-md">
            <button
              onClick={() => setView("kanban")}
              className={cn("p-1.5", view === "kanban" ? "bg-muted text-foreground" : "text-muted-foreground")}
            >
              <Columns3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView("list")}
              className={cn("p-1.5", view === "list" ? "bg-muted text-foreground" : "text-muted-foreground")}
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          {/* New Project */}
          <Dialog open={projOpen} onOpenChange={setProjOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5 h-8">
                <FolderPlus className="h-3.5 w-3.5" /> New Project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
              <form onSubmit={handleCreateProject} className="space-y-4">
                <div><Label>Project Name</Label><Input name="name" required className="mt-1" /></div>
                <div>
                  <Label>Link to Client (optional)</Label>
                  <select name="client_id" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="">No client</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.company}</option>)}
                  </select>
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                  <Button type="submit" disabled={createProject.isPending}>
                    {createProject.isPending ? "Creating…" : "Create Project"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* New Task */}
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New Task</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Task</DialogTitle></DialogHeader>
              <form onSubmit={handleAdd} className="space-y-4">
                <div><Label>Title</Label><Input name="title" required className="mt-1" /></div>
                <div><Label>Description</Label><Textarea name="description" rows={2} className="mt-1" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Assignee</Label>
                    <select name="assignee_id" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                      <option value="">Unassigned</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Priority</Label>
                    <select name="priority" defaultValue="medium" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                      {(["low", "medium", "high", "critical"] as const).map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                  <div><Label>Due Date</Label><Input name="due_date" type="date" className="mt-1" /></div>
                  <div>
                    <Label>Project</Label>
                    <select name="project_id" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                      <option value="">No project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.client_name ? ` (${p.client_name})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <Label>Client (override)</Label>
                    <select name="client_id" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                      <option value="">From project / none</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.company}</option>)}
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                  <Button type="submit" disabled={createTask.isPending}>
                    {createTask.isPending ? "Creating…" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Kanban / List */}
      {view === "kanban" ? (
        <KanbanBoard
          columns={columns}
          renderCard={(task) => <TaskCard task={task} />}
          onMoveItem={handleMove}
          getItemId={(t) => t.id}
        />
      ) : (
        <div className="rounded-xl border border-border overflow-hidden animate-fade-in">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Title", "Project", "Client", "Priority", "Assignee", "Due", "Status"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No tasks found.</td></tr>
              )}
              {tasks.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setDetailTask(t)}
                  className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 font-medium">{t.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.project_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.client_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded", priorityColors[t.priority])}>
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{t.assignee_name ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">{t.dueDate ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-muted-foreground capitalize">{t.status.replace("_", " ")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Task detail dialog */}
      <Dialog open={!!detailTask} onOpenChange={(o) => { if (!o) { setDetailTask(null); setEditMode(false); } }}>
        <DialogContent className="max-w-lg">
          {detailTask && !editMode && (
            <>
              <DialogHeader className="flex flex-row items-center justify-between">
                <DialogTitle>{detailTask.title}</DialogTitle>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-6 text-primary" onClick={() => setEditMode(true)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 text-destructive" onClick={() => setDeleteConfirmId(detailTask.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </DialogHeader>
              <div className="space-y-4">
                {detailTask.description && (
                  <p className="text-sm text-muted-foreground">{detailTask.description}</p>
                )}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Assignee:</span>{" "}<span>{detailTask.assignee_name ?? "Unassigned"}</span></div>
                  <div>
                    <span className="text-muted-foreground">Priority:</span>
                    <span className={cn("text-xs font-semibold uppercase px-1.5 py-0.5 rounded ml-1", priorityColors[detailTask.priority])}>
                      {detailTask.priority}
                    </span>
                  </div>
                  <div><span className="text-muted-foreground">Due:</span>{" "}<span>{detailTask.dueDate ?? "—"}</span></div>
                  <div><span className="text-muted-foreground">Status:</span>{" "}<span className="capitalize">{detailTask.status.replace("_", " ")}</span></div>
                  {detailTask.project_name && (
                    <div><span className="text-muted-foreground">Project:</span>{" "}<span>{detailTask.project_name}</span></div>
                  )}
                  {detailTask.client_name && (
                    <div><span className="text-muted-foreground">Client:</span>{" "}<span>{detailTask.client_name}</span></div>
                  )}
                </div>
                {detailTask.subtasks.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Subtasks ({detailTask.subtasks.filter((s) => s.done).length}/{detailTask.subtasks.length})
                    </p>
                    <div className="space-y-2">
                      {detailTask.subtasks.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={s.done}
                            onCheckedChange={() =>
                              toggleSub.mutate({ taskId: detailTask.id, subtaskId: s.id, done: !s.done })
                            }
                          />
                          <span className={cn(s.done && "line-through text-muted-foreground")}>{s.title}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {detailTask && editMode && (
            <>
              <DialogHeader><DialogTitle>Edit Task</DialogTitle></DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  updateTask.mutate(
                    {
                      id:          detailTask.id,
                      title:       fd.get("title") as string,
                      description: (fd.get("description") as string) || undefined,
                      assignee_id: (fd.get("assignee_id") as string) || undefined,
                      priority:    (fd.get("priority") as TaskPriority) || "medium",
                      status:      (fd.get("status") as TaskStatus) || detailTask.status,
                      due_date:    (fd.get("due_date") as string) || undefined,
                      project_id:  (fd.get("project_id") as string) || undefined,
                      client_id:   (fd.get("client_id") as string) || undefined,
                    },
                    {
                      onSuccess: () => { setEditMode(false); setDetailTask(null); toast.success("Task updated"); },
                      onError:   (err) => toast.error(err.message),
                    },
                  );
                }}
                className="space-y-4"
              >
                <div><Label>Title</Label><Input name="title" defaultValue={detailTask.title} required className="mt-1" /></div>
                <div><Label>Description</Label><Textarea name="description" defaultValue={detailTask.description ?? ""} rows={2} className="mt-1" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Assignee</Label>
                    <select name="assignee_id" defaultValue={detailTask.assigneeId ?? ""} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                      <option value="">Unassigned</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Priority</Label>
                    <select name="priority" defaultValue={detailTask.priority} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                      {(["low", "medium", "high", "critical"] as const).map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <select name="status" defaultValue={detailTask.status} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                      {statusColumns.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                  <div><Label>Due Date</Label><Input name="due_date" type="date" defaultValue={detailTask.dueDate ?? ""} className="mt-1" /></div>
                  <div>
                    <Label>Project</Label>
                    <select name="project_id" defaultValue={detailTask.projectId ?? ""} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                      <option value="">No project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}{p.client_name ? ` (${p.client_name})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Client</Label>
                    <select name="client_id" defaultValue={detailTask.clientId ?? ""} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                      <option value="">None</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setEditMode(false)}>Cancel</Button>
                  <Button type="submit" disabled={updateTask.isPending}>
                    {updateTask.isPending ? "Saving…" : "Save Changes"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirmId} onOpenChange={(o) => { if (!o) setDeleteConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirmId) {
                  deleteTask.mutate(deleteConfirmId, {
                    onSuccess: () => {
                      toast.success("Task deleted");
                      setDetailTask(null);
                      setDeleteConfirmId(null);
                    },
                    onError: (err) => toast.error(err.message),
                  });
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
