import { useState } from "react";
import {
  UserPlus, Shield, User as UserIcon, Trash2, Target, CheckSquare,
  Send, AlertTriangle, Clock, ChevronRight, Loader2, Eye, EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  useTeamWorkSummary, useMemberWork, useCreateTeamMember,
  useDeleteTeamMember, useUpdateTeamMemberRole, type TeamMemberWork,
} from "@/hooks/useTeam";
import { useCurrentUser } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const fmt = (n: number) =>
  `EGP ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;

const STAGE_LABELS: Record<string, string> = {
  new_lead: "New", contacted: "Contacted", call_scheduled: "Call", proposal_sent: "Proposal",
  negotiation: "Negotiation", closed_won: "Won", closed_lost: "Lost",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Team() {
  const { data: members = [], isLoading } = useTeamWorkSummary();
  const me = useCurrentUser();
  const [addOpen, setAddOpen]   = useState(false);
  const [drillId, setDrillId]   = useState<string | null>(null);

  const deleteMember = useDeleteTeamMember();
  const updateRole   = useUpdateTeamMemberRole();

  const handleDelete = (m: TeamMemberWork) => {
    if (m.id === me?.id) { toast.error("You can't remove your own account"); return; }
    if (!confirm(
      `Remove ${m.name}?\n\nThey lose access immediately. Their leads and tasks stay in the system but become unassigned.`,
    )) return;
    deleteMember.mutate(m.id, {
      onSuccess: () => toast.success(`${m.name} removed`),
      onError:   (e) => toast.error(e.message),
    });
  };

  const toggleRole = (m: TeamMemberWork) => {
    const next = m.role === "admin" ? "member" : "admin";
    if (!confirm(
      next === "admin"
        ? `Make ${m.name} an ADMIN?\n\nThey will see all finance, clients, the vault and every lead & task.`
        : `Restrict ${m.name} to MEMBER?\n\nThey will only see leads and tasks assigned to them, plus their own notes.`,
    )) return;
    updateRole.mutate({ id: m.id, role: next }, {
      onSuccess: () => toast.success(`${m.name} is now ${next}`),
      onError:   (e) => toast.error(e.message),
    });
  };

  if (isLoading) return <p className="text-sm text-muted-foreground text-center py-16">Loading team…</p>;

  const admins  = members.filter((m) => m.role === "admin");
  const staff   = members.filter((m) => m.role !== "admin");

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Team</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Give access, set what each person can see, and track their work.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Add Member</Button>
          </DialogTrigger>
          <AddMemberDialog onDone={() => setAddOpen(false)} />
        </Dialog>
      </div>

      {/* Access legend */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Shield className="h-3.5 w-3.5 text-primary" />
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Admin — {admins.length}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Everything: finance, clients, vault, goals, all leads &amp; tasks, sequence editing and analytics.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <UserIcon className="h-3.5 w-3.5 text-info" />
            <p className="text-xs font-semibold uppercase tracking-wider text-info">Member — {staff.length}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Only leads &amp; tasks assigned to them, their own notes, and outreach on their own leads.
            Finance, clients and the vault are blocked.
          </p>
        </div>
      </div>

      {/* Member cards */}
      <div className="space-y-3">
        {members.map((m) => (
          <MemberCard
            key={m.id}
            m={m}
            isSelf={m.id === me?.id}
            onOpen={() => setDrillId(m.id)}
            onToggleRole={() => toggleRole(m)}
            onDelete={() => handleDelete(m)}
            busy={updateRole.isPending || deleteMember.isPending}
          />
        ))}
      </div>

      <MemberWorkDialog userId={drillId} onClose={() => setDrillId(null)} />
    </div>
  );
}

function MemberCard({ m, isSelf, onOpen, onToggleRole, onDelete, busy }: {
  m: TeamMemberWork; isSelf: boolean; onOpen: () => void;
  onToggleRole: () => void; onDelete: () => void; busy: boolean;
}) {
  const isAdmin = m.role === "admin";
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-border">
        <div className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          isAdmin ? "bg-primary/15 text-primary" : "bg-info/15 text-info",
        )}>
          {m.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{m.name}</span>
            <Badge variant="outline" className={cn(
              "text-[9px]", isAdmin ? "border-primary/40 text-primary" : "border-info/40 text-info",
            )}>
              {isAdmin ? "ADMIN" : "MEMBER"}
            </Badge>
            {isSelf && <Badge variant="outline" className="text-[9px]">YOU</Badge>}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">
            {m.email} · active {relativeTime(m.activity.last_at)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onOpen}>
            <Eye className="h-3 w-3" /> View work
          </Button>
          {!isSelf && (
            <>
              <Button
                size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                onClick={onToggleRole} disabled={busy}
                title={isAdmin ? "Restrict to member" : "Promote to admin"}
              >
                {isAdmin ? <EyeOff className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                {isAdmin ? "Restrict" : "Promote"}
              </Button>
              <Button
                size="sm" variant="ghost" className="h-7 w-7 p-0 max-sm:h-10 max-sm:w-10 text-destructive"
                onClick={onDelete} disabled={busy}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Work stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/60">
        <Stat
          icon={Target} label="Leads"
          value={`${m.leads.open} open`}
          sub={`${m.leads.won} won · ${fmt(m.leads.pipeline)} pipeline`}
          warn={m.leads.stale > 0 ? `${m.leads.stale} stale` : undefined}
        />
        <Stat
          icon={CheckSquare} label="Tasks"
          value={`${m.tasks.done}/${m.tasks.total}`}
          sub={`${m.tasks.completion_rate}% done · ${m.tasks.done_this_week} this week`}
          warn={m.tasks.overdue > 0 ? `${m.tasks.overdue} overdue` : undefined}
        />
        <Stat
          icon={Send} label="Outreach"
          value={`${m.outreach.sends} sent`}
          sub={`${m.outreach.enrolled} enrolled · ${m.outreach.replied} replied`}
        />
        <Stat
          icon={Clock} label="Activity"
          value={`${m.activity.logged_last_7d} logged`}
          sub="in the last 7 days"
        />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, warn }: {
  icon: React.ElementType; label: string; value: string; sub: string; warn?: string;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className="text-sm font-semibold text-foreground tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
      {warn && (
        <p className="text-[10px] text-warning flex items-center gap-0.5 mt-0.5">
          <AlertTriangle className="h-2.5 w-2.5" />{warn}
        </p>
      )}
    </div>
  );
}

// ─── Add member ───────────────────────────────────────────
function AddMemberDialog({ onDone }: { onDone: () => void }) {
  const create = useCreateTeamMember();
  const [role, setRole] = useState<"admin" | "member">("member");

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = (fd.get("password") as string) ?? "";
    if (password.length < 8) { toast.error("Use at least 8 characters for the password"); return; }
    create.mutate(
      {
        name:     (fd.get("name") as string).trim(),
        email:    (fd.get("email") as string).trim(),
        password,
        role,
      },
      {
        onSuccess: (u) => { toast.success(`${u.name} added as ${role}`); onDone(); },
        onError:   (err) => toast.error(err.message),
      },
    );
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Add team member</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Name</Label><Input name="name" required className="mt-1" placeholder="e.g. Mostafa" /></div>
          <div><Label>Email</Label><Input name="email" type="email" required className="mt-1" placeholder="name@seekersai.org" /></div>
        </div>
        <div>
          <Label>Temporary password</Label>
          <Input name="password" type="text" required minLength={8} className="mt-1" placeholder="min 8 characters" />
          <p className="text-[10px] text-muted-foreground mt-1">
            Share it privately and ask them to change it after first login.
          </p>
        </div>

        <div>
          <Label>Access level</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
            <button
              type="button" onClick={() => setRole("member")}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                role === "member" ? "border-info/50 bg-info/5" : "border-border hover:border-border/80",
              )}
            >
              <div className="flex items-center gap-1.5">
                <UserIcon className="h-3.5 w-3.5 text-info" />
                <span className="text-sm font-medium">Member</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Only their own leads, tasks and notes. Finance, clients and vault blocked.
              </p>
            </button>
            <button
              type="button" onClick={() => setRole("admin")}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                role === "admin" ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80",
              )}
            >
              <div className="flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                <span className="text-sm font-medium">Admin</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Full access including finance, clients and the credentials vault.
              </p>
            </button>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create account"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

// ─── Drill-in: what this person is working on ─────────────
function MemberWorkDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { data, isLoading } = useMemberWork(userId);

  return (
    <Dialog open={!!userId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        {isLoading || !data ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{data.user.name}’s work</DialogTitle>
              <p className="text-xs text-muted-foreground">{data.user.email}</p>
            </DialogHeader>

            <Section title={`Leads (${data.leads.length})`}>
              {data.leads.length === 0 ? <Empty>No leads assigned yet.</Empty> : (
                <div className="rounded-lg border border-border overflow-x-auto">
                  <table className="w-full text-xs min-w-[640px]">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Lead", "Company", "Stage", "Value", "Last activity"].map((h) => (
                          <th key={h} className="text-left px-3 py-1.5 font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.leads.map((l) => (
                        <tr key={l.id} className="border-b border-border/40">
                          <td className="px-3 py-1.5 text-foreground truncate max-w-[140px]">{l.name}</td>
                          <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[140px]">{l.company}</td>
                          <td className="px-3 py-1.5">
                            <Badge variant="outline" className="text-[9px]">{STAGE_LABELS[l.stage] ?? l.stage}</Badge>
                          </td>
                          <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{fmt(Number(l.dealValue))}</td>
                          <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{l.lastActivity ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title={`Tasks (${data.tasks.length})`}>
              {data.tasks.length === 0 ? <Empty>No tasks assigned yet.</Empty> : (
                <div className="space-y-1">
                  {data.tasks.map((t) => {
                    const overdue = t.status !== "done" && t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10);
                    return (
                      <div key={t.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-1.5">
                        <span className={cn("text-xs flex-1 truncate", t.status === "done" && "line-through text-muted-foreground")}>
                          {t.title}
                        </span>
                        <Badge variant="outline" className="text-[9px]">{t.status.replace("_", " ")}</Badge>
                        {t.dueDate && (
                          <span className={cn("text-[10px] tabular-nums", overdue ? "text-destructive" : "text-muted-foreground")}>
                            {t.dueDate}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title={`Recent activity (${data.activity.length})`}>
              {data.activity.length === 0 ? <Empty>Nothing logged yet.</Empty> : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {data.activity.map((a) => (
                    <div key={a.id} className="rounded-md border border-border/60 bg-muted/10 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-foreground truncate">
                          {a.lead_name ?? "—"}{a.lead_company ? ` · ${a.lead_company}` : ""}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{relativeTime(a.createdAt)}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{a.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-muted-foreground italic">{children}</p>
);
