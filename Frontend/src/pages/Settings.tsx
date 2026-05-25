import { useState, useEffect } from "react";
import {
  UserPlus, Shield, User, Trash2, KeyRound, Pencil, Save,
  Webhook, Plus, Send, Loader2, CheckCircle2, XCircle, Power,
} from "lucide-react";
import {
  useWebhooks, useWebhookEvents, useCreateWebhook, useUpdateWebhook,
  useDeleteWebhook, useTestWebhook, useWebhookDeliveries,
  type WebhookSubscription,
} from "@/hooks/useWebhooks";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
            <Badge variant="outline" className={cn("text-[10px] mt-1", currentUser?.role === "admin" ? "border-primary/40 bg-primary/10 text-primary" : "border-muted-foreground/30 bg-muted text-muted-foreground")}>
              {currentUser?.role}
            </Badge>
          </div>
        </div>
      </div>

      {/* Email signature */}
      {currentUser && <SignatureEditor user={currentUser} />}

      {/* Outbound Webhooks */}
      {isAdmin && <WebhooksPanel />}

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
                  <Badge variant="outline" className={cn("text-[10px]", u.role === "admin" ? "border-primary/40 bg-primary/10 text-primary" : "border-muted-foreground/30 bg-muted text-muted-foreground")}>
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

// ─── Signature Editor ─────────────────────────────────────
function SignatureEditor({ user }: { user: ApiUser }) {
  const qc = useQueryClient();
  const [editing,  setEditing]  = useState(false);
  const [title,    setTitle]    = useState(user.title ?? "");
  const [sig,      setSig]      = useState(user.signature ?? "");

  // Keep local state in sync when user updates (e.g. after save)
  useEffect(() => {
    if (!editing) {
      setTitle(user.title ?? "");
      setSig(user.signature ?? "");
    }
  }, [user.title, user.signature, editing]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<ApiUser>(`/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title:     title.trim() || null,
          signature: sig.trim()   || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditing(false);
      toast.success("Signature saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const useDefault = () => setSig("");

  const previewName  = user.name;
  const previewTitle = title.trim() || "Seekers AI Automation Solutions";
  const previewEmail = user.email;

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Email Signature</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Appears at the bottom of every outreach email sent on your behalf. Leave the signature box empty to use the default with the Seekers logo.
          </p>
        </div>
        {!editing && (
          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </div>

      {editing ? (
        <>
          <div>
            <Label>Title / Role</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Founder, Sales Lead"
              maxLength={120}
              className="mt-1"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Shown below your name in the default signature.</p>
          </div>

          <div>
            <Label>Custom signature (HTML or plain text)</Label>
            <Textarea
              value={sig}
              onChange={(e) => setSig(e.target.value)}
              rows={6}
              placeholder="Leave blank to use the default Seekers signature with logo."
              maxLength={8000}
              className="mt-1 font-mono text-xs"
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-[10px] text-muted-foreground">
                {sig.length} / 8000 chars. HTML supported. Use {`<img src="...">`} for inline images.
              </p>
              {sig && (
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={useDefault}>Use default</Button>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" onClick={() => { setEditing(false); setTitle(user.title ?? ""); setSig(user.signature ?? ""); }}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending} className="gap-1.5">
              <Save className="h-3.5 w-3.5" /> {save.isPending ? "Saving…" : "Save Signature"}
            </Button>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          {user.signature?.trim() ? (
            <div
              className="email-signature-preview"
              dangerouslySetInnerHTML={{ __html: user.signature }}
            />
          ) : (
            <div className="font-sans text-xs text-foreground" style={{ lineHeight: 1.5 }}>
              <div style={{ paddingTop: 12, borderTop: "1px solid #e5e5e5" }}>
                <div className="flex items-center gap-3">
                  <img src="/logo-symbol.png" alt="Seekers" width={42} height={42} style={{ borderRadius: 6 }} />
                  <div>
                    <div className="font-semibold text-foreground text-sm">{previewName}</div>
                    <div className="text-muted-foreground text-[11px]">{previewTitle}</div>
                  </div>
                </div>
                <div className="mt-2 text-muted-foreground text-[11px]">
                  <span className="text-primary">seekersai.org</span> · <span className="text-primary">{previewEmail}</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-3 italic">
                Default signature — click Edit to customize.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Webhooks Panel ───────────────────────────────────────
function WebhooksPanel() {
  const { data: webhooks = [], isLoading } = useWebhooks();
  const { data: events = [] }              = useWebhookEvents();
  const [isOpen, setIsOpen]                = useState(false);
  const [editing, setEditing]              = useState<WebhookSubscription | null>(null);

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Outbound Webhooks</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fire HTTP POSTs to external services (Slack, n8n, WhatsApp via Twilio, Discord, custom servers) when CRM events happen. Lets you wire automation without touching backend code.
          </p>
        </div>
        <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New Webhook</Button>
          </DialogTrigger>
          <WebhookForm editing={editing} events={events} onClose={() => { setIsOpen(false); setEditing(null); }} />
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground italic">Loading…</p>
      ) : webhooks.length === 0 ? (
        <div className="rounded-lg bg-muted/20 border border-dashed border-border p-6 text-center">
          <Webhook className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No webhooks yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create one to start firing events to Slack, n8n, WhatsApp, or any HTTP endpoint.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {webhooks.map((w) => (
            <WebhookRow key={w.id} hook={w} onEdit={() => { setEditing(w); setIsOpen(true); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function WebhookRow({ hook, onEdit }: { hook: WebhookSubscription; onEdit: () => void }) {
  const update = useUpdateWebhook();
  const del    = useDeleteWebhook();
  const test   = useTestWebhook();

  const handleTest = () => {
    test.mutate(hook.id, {
      onSuccess: (delivery) => {
        if (delivery.error) {
          toast.error(`Failed: ${delivery.error}`);
        } else if (delivery.statusCode && delivery.statusCode >= 200 && delivery.statusCode < 300) {
          toast.success(`Test fired — endpoint returned ${delivery.statusCode}`);
        } else {
          toast.warning(`Fired but got HTTP ${delivery.statusCode ?? "?"}`);
        }
      },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{hook.name}</p>
            <Badge variant="outline" className={cn("text-[10px]", hook.isActive ? "border-success/30 text-success" : "border-muted text-muted-foreground")}>
              {hook.isActive ? "ACTIVE" : "PAUSED"}
            </Badge>
            <Badge variant="secondary" className="text-[10px] font-mono">{hook.event}</Badge>
          </div>
          <p className="text-[11px] text-muted-foreground font-mono truncate mt-1">{hook.url}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" className="h-7 px-2 gap-1" disabled={test.isPending} onClick={handleTest} title="Send a test payload">
            {test.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          </Button>
          <Button
            size="sm" variant="ghost" className="h-7 w-7 p-0"
            onClick={() => update.mutate({ id: hook.id, is_active: !hook.isActive }, {
              onSuccess: () => toast.success(hook.isActive ? "Webhook paused" : "Webhook activated"),
              onError:   (err) => toast.error(err.message),
            })}
            title={hook.isActive ? "Pause" : "Activate"}
          >
            <Power className={cn("h-3.5 w-3.5", hook.isActive ? "text-success" : "text-muted-foreground")} />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive"
            onClick={() => {
              if (!confirm(`Delete webhook "${hook.name}"?`)) return;
              del.mutate(hook.id, {
                onSuccess: () => toast.success("Webhook deleted"),
                onError:   (err) => toast.error(err.message),
              });
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function WebhookForm({ editing, events, onClose }: {
  editing: WebhookSubscription | null;
  events:  string[];
  onClose: () => void;
}) {
  const create = useCreateWebhook();
  const update = useUpdateWebhook();
  const [event, setEvent] = useState(editing?.event ?? events[0] ?? "lead.created");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      name:   fd.get("name") as string,
      event,
      url:    fd.get("url") as string,
      secret: (fd.get("secret") as string) || undefined,
    };
    const mut = editing ? update.mutateAsync({ id: editing.id, ...body }) : create.mutateAsync(body);
    mut
      .then(() => { toast.success(editing ? "Webhook updated" : "Webhook created"); onClose(); })
      .catch((err) => toast.error(err.message));
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit Webhook" : "New Webhook"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label>Name</Label>
          <Input name="name" required defaultValue={editing?.name ?? ""} placeholder="e.g. Slack #leads — new lead alerts" className="mt-1" />
        </div>
        <div>
          <Label>Event</Label>
          <Select value={event} onValueChange={setEvent}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="*">* (all events)</SelectItem>
              {events.map((ev) => <SelectItem key={ev} value={ev}>{ev}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground mt-1">
            Use <code className="font-mono bg-muted px-1 rounded">*</code> to receive every event (audit / catch-all flows).
          </p>
        </div>
        <div>
          <Label>Target URL</Label>
          <Input name="url" type="url" required defaultValue={editing?.url ?? ""} placeholder="https://hooks.slack.com/services/... or your n8n webhook" className="mt-1" />
        </div>
        <div>
          <Label>Shared secret (optional)</Label>
          <Input name="secret" defaultValue={editing?.secret ?? ""} placeholder="Sent as X-Webhook-Secret header" className="mt-1" />
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
          <Button type="submit" disabled={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? "Saving…" : editing ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
