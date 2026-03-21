import { useState } from "react";
import { Plus, Mail, Phone, ExternalLink, Building2, Search, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/modules/StatCard";
import { toast } from "sonner";
import { useClients, useClientDetail, useCreateClient, useDeleteClient } from "@/hooks/useClients";
import { cn } from "@/lib/utils";
import type { ApiClient } from "@/lib/types";

const fmt = (n: string | number) => `$${Number(n).toLocaleString()}`;

const statusColors: Record<ApiClient["status"], string> = {
  active:   "bg-success/15 text-success",
  inactive: "bg-muted text-muted-foreground",
  prospect: "bg-info/15 text-info",
};

const priorityColors: Record<string, string> = {
  low:      "bg-muted text-muted-foreground",
  medium:   "bg-info/15 text-info",
  high:     "bg-warning/15 text-warning",
  critical: "bg-destructive/15 text-destructive",
};

function ClientDetailSheet({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const { data: detail, isLoading } = useClientDetail(clientId);
  const deleteClient = useDeleteClient();

  const handleDelete = () => {
    if (clientId) {
      deleteClient.mutate(clientId, {
        onSuccess: () => {
          toast.success("Client deleted");
          setDeleteConfirm(false);
          onClose();
        },
        onError: (err) => toast.error(err.message),
      });
    }
  };

  return (
    <>
      <Sheet open={!!clientId} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {isLoading && <p className="text-sm text-muted-foreground p-6">Loading…</p>}
          {detail && (
            <>
              <SheetHeader className="flex flex-row items-center justify-between pr-0">
                <SheetTitle className="flex items-center gap-2">
                  {detail.name}
                  <Badge variant="outline" className={cn("text-[10px]", statusColors[detail.status])}>
                    {detail.status}
                  </Badge>
                </SheetTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-destructive"
                  onClick={() => setDeleteConfirm(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </SheetHeader>
            <div className="mt-6 space-y-6">
              {/* Contact info */}
              <div className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Company</span><span>{detail.company}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Industry</span><span>{detail.industry ?? "—"}</span></div>
                {detail.email && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Email</span>
                    <span className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-muted-foreground" />{detail.email}</span>
                  </div>
                )}
                {detail.phone && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Phone</span>
                    <span className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-muted-foreground" />{detail.phone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Revenue</span>
                  <span className="font-semibold text-primary">{fmt(detail.totalRevenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Client Since</span>
                  <span>{detail.createdAt.slice(0, 10)}</span>
                </div>
              </div>

              {detail.notes && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Notes</p>
                  <p className="text-sm text-foreground">{detail.notes}</p>
                </div>
              )}

              {/* Projects */}
              {detail.projects.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Projects</p>
                  <div className="flex flex-wrap gap-2">
                    {detail.projects.map((p) => (
                      <Badge key={p.id} variant="secondary" className="text-xs">{p.name}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Tasks */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Tasks ({detail.tasks.length})
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1 text-primary"
                    onClick={() => { onClose(); navigate("/tasks"); }}
                  >
                    View all <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
                {detail.tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tasks linked to this client yet.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.tasks.map((task) => (
                      <div key={task.id} className="rounded-lg bg-muted/40 p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-foreground">{task.title}</p>
                          <span className={cn("text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded", priorityColors[task.priority])}>
                            {task.priority}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="capitalize">{task.status.replace("_", " ")}</span>
                          {task.dueDate && <span>Due {task.dueDate.slice(5)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>

    {/* Delete client confirmation */}
    <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Client?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete {detail?.name}? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleDelete}
          >
            {deleteClient.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

export default function Clients() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch]             = useState("");
  const [isOpen, setIsOpen]             = useState(false);
  const [selectedId, setSelectedId]     = useState<string | null>(null);

  const { data: clients = [], isLoading } = useClients({ status: statusFilter, search });
  const createClient = useCreateClient();

  const activeCount    = clients.filter((c) => c.status === "active").length;
  const totalRevenue   = clients.reduce((s, c) => s + Number(c.totalRevenue), 0);

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createClient.mutate(
      {
        name:     fd.get("name") as string,
        company:  fd.get("company") as string,
        email:    (fd.get("email") as string) || undefined,
        phone:    (fd.get("phone") as string) || undefined,
        status:   (fd.get("status") as string) || "prospect",
        industry: (fd.get("industry") as string) || undefined,
        notes:    (fd.get("notes") as string) || undefined,
      },
      {
        onSuccess: () => { setIsOpen(false); toast.success("Client added"); },
        onError:   (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Clients</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage client relationships and track connected tasks.</p>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add Client</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Client</DialogTitle></DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Name</Label><Input name="name" required className="mt-1" /></div>
                <div><Label>Company</Label><Input name="company" required className="mt-1" /></div>
                <div><Label>Email</Label><Input name="email" type="email" className="mt-1" /></div>
                <div><Label>Phone</Label><Input name="phone" className="mt-1" /></div>
                <div><Label>Industry</Label><Input name="industry" className="mt-1" /></div>
                <div>
                  <Label>Status</Label>
                  <select name="status" defaultValue="prospect" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="active">Active</option>
                    <option value="prospect">Prospect</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div><Label>Notes</Label><Textarea name="notes" rows={2} className="mt-1" /></div>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <Button type="submit" disabled={createClient.isPending}>
                  {createClient.isPending ? "Adding…" : "Add Client"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Clients" value={String(clients.length)} icon={Building2} />
        <StatCard
          title="Active Clients"
          value={String(activeCount)}
          change={clients.length ? `${Math.round((activeCount / clients.length) * 100)}% of total` : "0%"}
          changeType="positive"
        />
        <StatCard title="Total Revenue" value={fmt(totalRevenue)} changeType="positive" change="Lifetime" />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="prospect">Prospect</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Client cards grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading clients…</div>
      ) : clients.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center animate-fade-in">
          <p className="text-muted-foreground">No clients found. Add your first client above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((client, i) => (
            <div
              key={client.id}
              onClick={() => setSelectedId(client.id)}
              className="rounded-xl border border-border bg-card p-5 space-y-3 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 cursor-pointer animate-fade-in"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{client.name}</p>
                  <p className="text-xs text-muted-foreground">{client.company}</p>
                </div>
                <span className={cn("text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full", statusColors[client.status])}>
                  {client.status}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{client.industry ?? "—"}</span>
                <span className="text-primary font-semibold">{fmt(client.totalRevenue)}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/50">
                <span className="text-xs text-muted-foreground">{client.project_count} project{client.project_count !== 1 ? "s" : ""}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <ClientDetailSheet clientId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
