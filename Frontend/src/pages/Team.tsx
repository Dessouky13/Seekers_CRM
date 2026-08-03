import { useState } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  UserPlus, Shield, User as UserIcon, Trash2, Target, CheckSquare,
  Send, AlertTriangle, Eye, EyeOff, LogIn, Receipt, Sparkles, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

/** Coarse device label from a user-agent, for the login history rows. */
function deviceOf(ua: string | null): string {
  if (!ua) return "unknown device";
  if (/iPhone|Android.*Mobile/i.test(ua)) return "mobile";
  if (/iPad|Tablet/i.test(ua))            return "tablet";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox" : "browser";
  const os = /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Green when seen in the last 5 minutes, amber within the day, else grey. */
function PresenceDot({ online, lastSeen }: { online: boolean; lastSeen: string | null }) {
  const recent = !online && lastSeen
    && Date.now() - new Date(lastSeen).getTime() < 24 * 3600_000;
  const tone  = online ? "bg-emerald-500" : recent ? "bg-amber-500" : "bg-muted-foreground/40";
  const title = online ? "Online now"
    : lastSeen ? `Last active ${relativeTime(lastSeen)}` : "Never signed in";
  return (
    <span className="relative flex h-2 w-2 shrink-0" title={title} aria-label={title}>
      {online && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", tone)} />
    </span>
  );
}

const TIMELINE_STYLE: Record<string, { label: string; icon: React.ElementType; tone: string }> = {
  lead_activity:  { label: "Lead activity", icon: Target,      tone: "text-primary" },
  task_created:   { label: "Created task",  icon: CheckSquare, tone: "text-info" },
  task_completed: { label: "Completed",     icon: CheckSquare, tone: "text-emerald-400" },
  enrolled:       { label: "Enrolled",      icon: Send,        tone: "text-violet-400" },
  transaction:    { label: "Finance",       icon: Receipt,     tone: "text-amber-400" },
  agent_run:      { label: "AI agent",      icon: Sparkles,    tone: "text-fuchsia-400" },
  login:          { label: "Signed in",     icon: LogIn,       tone: "text-muted-foreground" },
};

export default function Team() {
  const { data: members = [], isLoading } = useTeamWorkSummary();
  const me = useCurrentUser();
  const [addOpen, setAddOpen]   = useState(false);
  const [drillId, setDrillId]   = useState<string | null>(null);

  const deleteMember = useDeleteTeamMember();
  const updateRole   = useUpdateTeamMemberRole();
  const confirm      = useConfirm();

  const handleDelete = async (m: TeamMemberWork) => {
    if (m.id === me?.id) { toast.error("You can't remove your own account"); return; }
    const ok = await confirm({
      title: `Remove ${m.name}?`,
      description:
        "They lose access immediately. Their leads and tasks stay in the system " +
        "but become unassigned.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    deleteMember.mutate(m.id, {
      onSuccess: () => toast.success(`${m.name} removed`),
      onError:   (e) => toast.error(e.message),
    });
  };

  const toggleRole = async (m: TeamMemberWork) => {
    const next = m.role === "admin" ? "member" : "admin";
    const ok = await confirm({
      title: next === "admin" ? `Make ${m.name} an admin?` : `Restrict ${m.name} to member?`,
      description: next === "admin"
        ? "They will see all finance, clients, the credentials vault, and every lead and task."
        : "They will only see leads and tasks assigned to them, plus their own notes.",
      confirmLabel: next === "admin" ? "Promote to admin" : "Restrict to member",
      destructive: next !== "admin",
    });
    if (!ok) return;
    updateRole.mutate({ id: m.id, role: next }, {
      onSuccess: () => toast.success(`${m.name} is now ${next}`),
      onError:   (e) => toast.error(e.message),
    });
  };

  // The page chrome (title, Add Member, the access legend copy) is static, so it
  // renders straight away and only the counts and member cards are placeheld.
  const admins  = members.filter((m) => m.role === "admin");
  const staff   = members.filter((m) => m.role !== "admin");

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Team</h1>
          <p className="hidden sm:block text-sm text-muted-foreground mt-0.5">
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
            <p className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1">
              Admin — {isLoading ? <Skeleton className="h-3 w-4" /> : admins.length}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Everything: finance, clients, vault, goals, all leads &amp; tasks, sequence editing and analytics.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <UserIcon className="h-3.5 w-3.5 text-info" />
            <p className="text-xs font-semibold uppercase tracking-wider text-info flex items-center gap-1">
              Member — {isLoading ? <Skeleton className="h-3 w-4" /> : staff.length}
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Only leads &amp; tasks assigned to them, their own notes, and outreach on their own leads.
            Finance, clients and the vault are blocked.
          </p>
        </div>
      </div>

      {/* Member cards */}
      <div className="space-y-3">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <MemberCardSkeleton key={i} />)
          : members.map((m) => (
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

/** Mirrors MemberCard: avatar + identity header, then the 4-column stat strip. */
function MemberCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-border">
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-7" />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/60">
        {["Leads", "Tasks", "Outreach", "Activity"].map((label) => (
          <div key={label} className="px-4 py-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Skeleton className="h-3 w-3 rounded-sm" />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
            </div>
            <Skeleton className="h-5 w-16" />
            <Skeleton className="mt-1 h-3 w-24" />
          </div>
        ))}
      </div>
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
            <PresenceDot online={m.session.is_online} lastSeen={m.session.last_seen_at} />
            <span className="text-sm font-semibold text-foreground">{m.name}</span>
            <Badge variant="outline" className={cn(
              "text-[9px]", isAdmin ? "border-primary/40 text-primary" : "border-info/40 text-info",
            )}>
              {isAdmin ? "ADMIN" : "MEMBER"}
            </Badge>
            {isSelf && <Badge variant="outline" className="text-[9px]">YOU</Badge>}
            {/* Only for a genuinely unused account. This used to be driven by
                the sign-in count alone, so someone whose session predated
                telemetry was labelled "never signed in" on a card that also
                showed them online. */}
            {m.session.never_logged_in && (
              <Badge variant="outline" className="text-[9px] border-warning/40 text-warning">
                NEVER SIGNED IN
              </Badge>
            )}
            {m.session.failed_24h >= 3 && (
              <Badge
                variant="outline"
                className="text-[9px] border-destructive/40 text-destructive gap-0.5"
                title={`${m.session.failed_24h} failed sign-in attempts in the last 24 hours`}
              >
                <ShieldAlert className="h-2.5 w-2.5" />
                {m.session.failed_24h} FAILED
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate">
            {m.email} ·{" "}
            {m.session.is_online
              ? <span className="text-emerald-400">online now</span>
              : m.session.never_logged_in
                ? "never signed in"
                : `last seen ${relativeTime(m.session.last_seen_at)}`}
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
                aria-label={`Remove ${m.name}`} title={`Remove ${m.name}`}
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
        {/* Was "N logged in the last 7 days", counted from lead notes — which
            told you nothing about whether the person had opened the app. This
            is the real sign-in record. */}
        <Stat
          icon={LogIn} label="Sign-ins"
          value={
            m.session.never_logged_in ? "never"
            : m.session.login_history_predates_tracking ? "active"
            : `${m.session.logins_30d} · 30d`
          }
          sub={
            m.session.never_logged_in ? "account not yet used"
            // Saying "0 sign-ins" about someone who is demonstrably using the
            // app is wrong; the count starts from their next sign-in.
            : m.session.login_history_predates_tracking
              ? "signed in before tracking started"
              : `last ${relativeTime(m.session.last_login_at)} · ${m.session.logins_total} total`
          }
          warn={m.session.failed_24h >= 3 ? `${m.session.failed_24h} failed today` : undefined}
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
/** Mirrors the drill-in body: header, leads table, task rows, activity cards. */
function MemberWorkSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3.5 w-56" />
      </div>

      <Section title="Leads">
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
              {Array.from({ length: 5 }).map((_, r) => (
                <tr key={r} className="border-b border-border/40">
                  {["w-24", "w-28", "w-14", "w-20", "w-20"].map((w) => (
                    <td key={w} className="px-3 py-1.5"><Skeleton className={cn("h-3.5", w)} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Tasks">
        <div className="space-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-1.5">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16 shrink-0" />
              <Skeleton className="h-3 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Recent activity">
        <div className="space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-12 shrink-0" />
              </div>
              <Skeleton className="h-3.5 w-full" />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function MemberWorkDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { data, isLoading } = useMemberWork(userId);

  return (
    <Dialog open={!!userId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[88dvh] overflow-y-auto">
        {isLoading || !data ? (
          <MemberWorkSkeleton />
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

            {/* One feed across leads, tasks, outreach, finance, AI runs and
                sign-ins — the question "what has this person been doing" was
                previously only answerable for lead notes. */}
            <Section title={`Activity timeline (${data.timeline?.length ?? 0})`}>
              {!data.timeline?.length ? (
                <Empty>No recorded actions yet.</Empty>
              ) : (
                <div className="relative max-h-80 space-y-0 overflow-y-auto pl-1">
                  {data.timeline.map((t, i) => {
                    const base = TIMELINE_STYLE[t.kind] ?? TIMELINE_STYLE.lead_activity;
                    // A failed sign-in is not a sign-in. Without this the row
                    // read "Signed in · <ip>" with a body saying the attempt
                    // failed — the label contradicted the detail beneath it.
                    const failedLogin = t.kind === "login" && t.detail === "failed";
                    const s = failedLogin
                      ? { label: "Failed sign-in", icon: ShieldAlert, tone: "text-destructive" }
                      : base;
                    const Icon = s.icon;
                    const last = i === data.timeline.length - 1;
                    return (
                      <div key={`${t.at}-${i}`} className="flex gap-2.5">
                        {/* Rail: icon plus the connector to the next entry. */}
                        <div className="flex flex-col items-center">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                            <Icon className={cn("h-3 w-3", s.tone)} />
                          </div>
                          {!last && <div className="w-px flex-1 bg-border/60" />}
                        </div>
                        <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-3")}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[11px] font-medium text-foreground">
                              {s.label}
                              {t.subject ? <span className="text-muted-foreground"> · {t.subject}</span> : null}
                            </span>
                            <span
                              className="shrink-0 text-[10px] tabular-nums text-muted-foreground"
                              title={new Date(t.at).toLocaleString()}
                            >
                              {relativeTime(t.at)}
                            </span>
                          </div>
                          {(t.body || t.detail) && (
                            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                              {t.kind === "login" ? deviceOf(t.body) : t.body || t.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground/70">
                Built from authored records. Edits made in place to an existing
                row are not attributed and so do not appear here.
              </p>
            </Section>

            <Section title={`Sign-in history (${data.logins?.length ?? 0})`}>
              {!data.logins?.length ? (
                <Empty>This account has never been signed in to.</Empty>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[520px] text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["When", "Result", "IP", "Device"].map((h) => (
                          <th key={h} className="px-3 py-1.5 text-left font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.logins.map((g) => (
                        <tr key={g.id} className="border-b border-border/40 last:border-0">
                          <td className="px-3 py-1.5 tabular-nums text-muted-foreground" title={new Date(g.createdAt).toLocaleString()}>
                            {relativeTime(g.createdAt)}
                          </td>
                          <td className="px-3 py-1.5">
                            <Badge
                              variant="outline"
                              className={cn("text-[9px]", g.success
                                ? "border-emerald-500/40 text-emerald-400"
                                : "border-destructive/40 text-destructive")}
                            >
                              {g.success ? "OK" : "FAILED"}
                            </Badge>
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[10px] text-muted-foreground">{g.ip ?? "—"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{deviceOf(g.userAgent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
