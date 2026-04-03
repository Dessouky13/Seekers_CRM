import { useState } from "react";
import { Lock, Plus, Eye, EyeOff, Copy, Pencil, Trash2, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface VaultEntry {
  id: string;
  title: string;
  username: string | null;
  password: string;
  url: string | null;
  category: string;
  notes: string | null;
  createdAt: string;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="p-1 text-muted-foreground hover:text-foreground transition-colors" title="Copy">
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function PasswordCell({ password }: { password: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-sm">{show ? password : "••••••••"}</span>
      <button onClick={() => setShow((s) => !s)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <CopyButton value={password} />
    </div>
  );
}

function EntryForm({
  initial,
  categories,
  onSubmit,
  isPending,
}: {
  initial?: Partial<VaultEntry>;
  categories: string[];
  onSubmit: (data: Record<string, string>) => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-4 pt-1">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label>Title</Label>
          <Input name="title" defaultValue={initial?.title} required placeholder="e.g. Gmail, Vercel, Cloudflare" className="mt-1" />
        </div>
        <div>
          <Label>Username / Email</Label>
          <Input name="username" defaultValue={initial?.username ?? ""} placeholder="user@example.com" className="mt-1" />
        </div>
        <div>
          <Label>Password</Label>
          <Input name="password" type="text" defaultValue={initial?.password} required placeholder="Password or API key" className="mt-1 font-mono" />
        </div>
        <div>
          <Label>URL</Label>
          <Input name="url" defaultValue={initial?.url ?? ""} placeholder="https://…" className="mt-1" />
        </div>
        <div>
          <Label>Category</Label>
          <select name="category" defaultValue={initial?.category ?? "General"} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div>
        <Label>Notes</Label>
        <Textarea name="notes" defaultValue={initial?.notes ?? ""} rows={2} placeholder="Any context…" className="mt-1" />
      </div>
      <DialogFooter>
        <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Save"}</Button>
      </DialogFooter>
    </div>
  );
}

export default function Vault() {
  const currentUser = useCurrentUser();
  const qc = useQueryClient();
  const [addOpen, setAddOpen]       = useState(false);
  const [editEntry, setEditEntry]   = useState<VaultEntry | null>(null);
  const [deleteId, setDeleteId]     = useState<string | null>(null);
  const [catFilter, setCatFilter]   = useState("All");
  const [newCategory, setNewCategory] = useState("");

  const { data: entries = [], isLoading } = useQuery<VaultEntry[]>({
    queryKey: ["vault"],
    queryFn:  () => apiFetch("/vault"),
  });

  const { data: categoryOptions = [] } = useQuery<string[]>({
    queryKey: ["vault-categories"],
    queryFn: () => apiFetch("/vault/categories"),
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: (body: Record<string, string>) =>
      apiFetch("/vault", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vault"] }); setAddOpen(false); toast.success("Entry added"); },
    onError:   (err) => toast.error(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, string>) =>
      apiFetch(`/vault/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vault"] }); setEditEntry(null); toast.success("Entry updated"); },
    onError:   (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/vault/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vault"] }); setDeleteId(null); toast.success("Entry deleted"); },
    onError:   (err) => toast.error(err.message),
  });

  const createCategory = useMutation({
    mutationFn: (name: string) => apiFetch("/vault/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vault-categories"] });
      setNewCategory("");
      toast.success("Category added");
    },
    onError: (err) => toast.error(err.message),
  });

  const effectiveCategoryOptions = categoryOptions.length > 0
    ? categoryOptions
    : ["General", "API", "Other"];

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>, isEdit = false) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (v) data[k] = v as string;
    if (isEdit && editEntry) update.mutate({ id: editEntry.id, ...data });
    else create.mutate(data);
  };

  const categories = ["All", ...Array.from(new Set([...effectiveCategoryOptions, ...entries.map((e) => e.category)]))];
  const filtered = catFilter === "All" ? entries : entries.filter((e) => e.category === catFilter);
  const deleteTarget = entries.find((e) => e.id === deleteId);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" /> Vault
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Shared team password store. Protected by your login — do not share screenshots.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add Entry</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Vault Entry</DialogTitle></DialogHeader>
            <form onSubmit={(e) => handleSubmit(e)}>
              <EntryForm categories={effectiveCategoryOptions} onSubmit={() => {}} isPending={create.isPending} />
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {currentUser?.role === "admin" && (
        <div className="flex items-center gap-2">
          <Input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Add vault category"
            className="h-8 w-56"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!newCategory.trim() || createCategory.isPending}
            onClick={() => createCategory.mutate(newCategory.trim())}
          >
            Add Category
          </Button>
        </div>
      )}

      {/* Category filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCatFilter(c)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              catFilter === c
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Entries table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading vault…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-16 text-center">
          <Lock className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No entries yet. Add your first password above.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Title</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Username</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Password</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Category</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filtered.map((entry) => (
                <tr key={entry.id} className="hover:bg-muted/20 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{entry.title}</p>
                      {entry.url && (
                        <a href={entry.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    {entry.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]">{entry.notes}</p>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    <div className="flex items-center gap-1">
                      <span className="truncate max-w-[150px]">{entry.username ?? "—"}</span>
                      {entry.username && <CopyButton value={entry.username} />}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <PasswordCell password={entry.password} />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <Badge variant="outline" className="text-[10px]">{entry.category}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setEditEntry(entry)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setDeleteId(entry.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editEntry} onOpenChange={(o) => { if (!o) setEditEntry(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Entry</DialogTitle></DialogHeader>
          {editEntry && (
            <form onSubmit={(e) => handleSubmit(e, true)}>
              <EntryForm initial={editEntry} categories={effectiveCategoryOptions} onSubmit={() => {}} isPending={update.isPending} />
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This vault entry will be permanently removed for all team members.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && remove.mutate(deleteId)}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
