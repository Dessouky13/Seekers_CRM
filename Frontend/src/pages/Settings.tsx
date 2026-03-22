import { useState } from "react";
import { UserPlus, Shield, User, Trash2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { ApiUser } from "@/lib/types";

export default function Settings() {
  const currentUser = useCurrentUser();
  const [inviteOpen,  setInviteOpen]  = useState(false);
  const [createOpen,  setCreateOpen]  = useState(false);
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery<ApiUser[]>({
    queryKey: ["users"],
    queryFn:  () => apiFetch("/users"),
  });

  const inviteUser = useMutation({
    mutationFn: (body: { email: string; role: string }) =>
      apiFetch("/users/invite", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { setInviteOpen(false); toast.success("Invite sent successfully"); },
    onError:   (err) => toast.error(err.message),
  });

  const createUser = useMutation({
    mutationFn: (body: { name: string; email: string; password: string; role: string }) =>
      apiFetch("/users/create", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setCreateOpen(false);
      toast.success("User created successfully");
    },
    onError: (err) => toast.error(err.message),
  });

  const removeUser = useMutation({
    mutationFn: (id: string) => apiFetch(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); toast.success("User removed"); },
    onError:   (err) => toast.error(err.message),
  });

  const handleInvite = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    inviteUser.mutate({ email: fd.get("email") as string, role: fd.get("role") as string });
  };

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createUser.mutate({
      name:     fd.get("name") as string,
      email:    fd.get("email") as string,
      password: fd.get("password") as string,
      role:     fd.get("role") as string,
    });
  };

  const isAdmin = currentUser?.role === "admin";

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage your team and account preferences.</p>
      </div>

      {/* My Profile */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">My Profile</h2>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-lg font-semibold text-primary">
            {currentUser?.name?.slice(0, 2).toUpperCase() ?? "?"}
          </div>
          <div>
            <p className="font-medium text-foreground">{currentUser?.name}</p>
            <p className="text-sm text-muted-foreground">{currentUser?.email}</p>
            <Badge variant="outline" className={cn("text-[10px] mt-1", currentUser?.role === "admin" ? "border-primary/30 text-primary" : "")}>
              {currentUser?.role}
            </Badge>
          </div>
        </div>
      </div>

      {/* Team Members */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Team ({users.length})</h2>
          {isAdmin && (
            <div className="flex gap-2">
              {/* Create user directly */}
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5 h-8">
                    <KeyRound className="h-3.5 w-3.5" /> Add User
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Team Member</DialogTitle>
                    <p className="text-sm text-muted-foreground pt-1">
                      Create an account directly — they can log in immediately with these credentials.
                    </p>
                  </DialogHeader>
                  <form onSubmit={handleCreate} className="space-y-4 pt-2">
                    <div>
                      <Label>Full Name</Label>
                      <Input name="name" placeholder="Ahmed Hassan" required className="mt-1" />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input name="email" type="email" placeholder="ahmed@seekersai.org" required className="mt-1" />
                    </div>
                    <div>
                      <Label>Password</Label>
                      <Input name="password" type="password" placeholder="Min 6 characters" required minLength={6} className="mt-1" />
                    </div>
                    <div>
                      <Label>Role</Label>
                      <select name="role" defaultValue="member" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <DialogFooter>
                      <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
                      <Button type="submit" disabled={createUser.isPending}>
                        {createUser.isPending ? "Creating…" : "Create User"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>

              {/* Send invite link */}
              <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5 h-8">
                    <UserPlus className="h-3.5 w-3.5" /> Invite Link
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Send Invite Email</DialogTitle>
                    <p className="text-sm text-muted-foreground pt-1">
                      User receives an email with a link to set their own password.
                    </p>
                  </DialogHeader>
                  <form onSubmit={handleInvite} className="space-y-4 pt-2">
                    <div><Label>Email</Label><Input name="email" type="email" required className="mt-1" /></div>
                    <div>
                      <Label>Role</Label>
                      <select name="role" defaultValue="member" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <DialogFooter>
                      <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
                      <Button type="submit" disabled={inviteUser.isPending}>
                        {inviteUser.isPending ? "Sending…" : "Send Invite"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">Loading…</div>
        ) : users.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">No team members yet.</div>
        ) : (
          <div className="divide-y divide-border/50">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
                    {u.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className={cn("text-[10px]", u.role === "admin" ? "border-primary/30 text-primary" : "")}>
                    {u.role === "admin" ? <Shield className="h-2.5 w-2.5 mr-1 inline" /> : <User className="h-2.5 w-2.5 mr-1 inline" />}
                    {u.role}
                  </Badge>
                  {isAdmin && u.id !== currentUser?.id && (
                    <button
                      onClick={() => { if (confirm(`Remove ${u.name}?`)) removeUser.mutate(u.id); }}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove user"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* About */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-2">
        <h2 className="text-sm font-semibold text-foreground">About</h2>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>Seekers AI Agency OS — Internal Operations Platform</p>
          <p>Stack: Hono + Drizzle + PostgreSQL + React + Vite</p>
          <p className="text-xs pt-1">API: <span className="font-mono">{import.meta.env.VITE_API_URL}</span></p>
        </div>
      </div>
    </div>
  );
}
