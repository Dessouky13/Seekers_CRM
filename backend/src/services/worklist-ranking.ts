// Worklist ranking — "what needs a human, and in what order".
//
// Deliberately free of imports. No database, no HTTP, no clock of its own
// (`now` is passed in). This is the part we will tune for months, so it has to
// be runnable and testable on its own — see worklist-ranking.test.ts. The
// database queries that feed it live in worklist.ts.

export type ActionType =
  | "reply_waiting"
  | "hot_lead"
  | "sequence_blocked"
  | "task_due"
  | "stale_lead"
  | "unassigned_lead"
  | "manual_touch";

/** How fast this rots. Drives grouping in the UI and WhatsApp urgency. */
export type Urgency = "now" | "today" | "week";

export interface WorklistAction {
  /** Stable across refreshes so the UI can keep focus and dedupe. */
  id:        string;
  type:      ActionType;
  urgency:   Urgency;
  score:     number;
  title:     string;
  subtitle:  string | null;
  /** Why this is on the list, in words a human reads. */
  reason:    string;
  /** Optional extra context — e.g. the first line of their reply. */
  detail:    string | null;
  deepLink:  string;
  leadId:    string | null;
  taskId:    string | null;
  dealValue: number;
  ageHours:  number;
  /** Present only on manual_touch — the enrollment a human must action. */
  enrollmentId?: string;
  channel?:      "whatsapp" | "call";
  /** The message text to send, already rendered by the caller. */
  message?:      string | null;
  phoneE164?:    string | null;
}

/** Rows the ranker needs. Shaped by fetchWorklist, but any source works. */
export interface WorklistInputs {
  now: Date;
  replies: {
    leadId: string; name: string; company: string | null;
    dealValue: number; repliedAt: Date; preview: string | null;
  }[];
  hotLeads: {
    leadId: string; name: string; company: string | null;
    dealValue: number; views: number; slug: string; lastViewAt: Date;
  }[];
  blocked: {
    enrollmentId: string; sequenceName: string | null;
    reason: string | null; leadCount: number; since: Date;
  }[];
  dueTasks: {
    taskId: string; title: string; dueDate: string;
    priority: string; projectName: string | null;
  }[];
  staleLeads: {
    leadId: string; name: string; company: string | null;
    dealValue: number; stage: string; lastActivity: Date | null;
  }[];
  unassigned: {
    leadId: string; name: string; company: string | null;
    dealValue: number; createdAt: Date;
  }[];
  manualTouches?: ManualTouchRow[];
}

/** An enrollment blocked on a whatsapp/call step, waiting on a human to act. */
export interface ManualTouchRow {
  enrollmentId: string;
  leadId:       string;
  leadName:     string | null;
  leadCompany:  string | null;
  channel:      "whatsapp" | "call";
  message:      string | null;
  phoneE164:    string | null;
  dealValue:    string | number | null;
  /** When the enrollment arrived at this step — drives ageHours, same as `blocked`'s `since`. */
  since:        Date;
}

// ── Scoring ───────────────────────────────────────────────
//
// score = base + valueBonus + ageBonus
//
// Base encodes "what kind of thing is this", value tilts toward money, and age
// is what stops anything sitting at the bottom of the list forever. An
// unanswered reply climbs fast because speed-to-lead is the single biggest
// lever we have; a stale lead climbs slowly because it has already gone cold.

const BASE: Record<ActionType, number> = {
  reply_waiting:    1000,
  manual_touch:      900,
  hot_lead:          800,
  sequence_blocked:  520,
  task_due:          420,
  stale_lead:        300,
  unassigned_lead:   260,
};

/**
 * Log-scaled so a 500k deal outranks a 5k one without a single whale burying
 * everything else. Capped at 300 — roughly a third of a reply's base weight.
 */
export function valueBonus(dealValue: number): number {
  if (!Number.isFinite(dealValue) || dealValue <= 0) return 0;
  return Math.min(300, Math.round(Math.log10(1 + dealValue) * 55));
}

const hoursBetween = (a: Date, b: Date) =>
  Math.max(0, (a.getTime() - b.getTime()) / 3_600_000);

const cap = (n: number, max: number) => Math.min(max, Math.round(n));

export function rankWorklist(input: WorklistInputs): WorklistAction[] {
  const { now } = input;
  const out: WorklistAction[] = [];

  for (const r of input.replies) {
    const age = hoursBetween(now, r.repliedAt);
    out.push({
      id: `reply:${r.leadId}`,
      type: "reply_waiting",
      urgency: "now",
      // 25/hour: a reply left overnight outranks almost anything else.
      score: BASE.reply_waiting + valueBonus(r.dealValue) + cap(age * 25, 400),
      title: r.name,
      subtitle: r.company,
      reason: age < 1
        ? "Replied just now — sequence auto-paused"
        : `Replied ${formatAge(age)} ago and nobody has answered`,
      detail: r.preview,
      deepLink: `/crm?lead=${r.leadId}`,
      leadId: r.leadId, taskId: null, dealValue: r.dealValue, ageHours: age,
    });
  }

  // Enrollments blocked on a human. Ranked with replies, because a sequence
  // stalled waiting for someone is costing the same as an unanswered reply.
  for (const m of input.manualTouches ?? []) {
    const age = hoursBetween(now, m.since);
    out.push({
      id: `manual:${m.enrollmentId}`,
      type: "manual_touch",
      urgency: "now",
      score: BASE.manual_touch,
      title: m.leadName ?? "Lead",
      subtitle: m.leadCompany ?? null,
      reason: m.channel === "whatsapp"
        ? "WhatsApp message ready to send"
        : "Call this lead",
      detail: m.message ?? null,
      deepLink: `/crm?lead=${m.leadId}`,
      leadId: m.leadId, taskId: null, dealValue: Number(m.dealValue ?? 0), ageHours: age,
      enrollmentId: m.enrollmentId, channel: m.channel,
      message: m.message ?? null, phoneE164: m.phoneE164 ?? null,
    });
  }

  for (const h of input.hotLeads) {
    const age = hoursBetween(now, h.lastViewAt);
    out.push({
      id: `hot:${h.leadId}`,
      type: "hot_lead",
      urgency: "now",
      // Intent decays: someone who read their audit an hour ago is worth far
      // more than someone who read it last week, so age SUBTRACTS here.
      score: BASE.hot_lead + valueBonus(h.dealValue) + cap(h.views * 30, 200) - cap(age * 4, 300),
      title: h.name,
      subtitle: h.company,
      reason: `Opened their audit ${h.views}× — last ${formatAge(age)} ago`,
      detail: null,
      deepLink: `/crm?lead=${h.leadId}`,
      leadId: h.leadId, taskId: null, dealValue: h.dealValue, ageHours: age,
    });
  }

  for (const b of input.blocked) {
    const age = hoursBetween(now, b.since);
    out.push({
      id: `blocked:${b.enrollmentId}`,
      type: "sequence_blocked",
      urgency: "today",
      // Scales with how many leads are frozen behind the problem.
      score: BASE.sequence_blocked + cap(b.leadCount * 12, 250) + cap(age / 6, 150),
      title: b.sequenceName ?? "Outreach sequence",
      subtitle: b.leadCount > 1 ? `${b.leadCount} leads frozen` : "1 lead frozen",
      reason: b.reason ?? "Sequence stopped and needs attention",
      detail: null,
      deepLink: "/outreach",
      leadId: null, taskId: null, dealValue: 0, ageHours: age,
    });
  }

  for (const t of input.dueTasks) {
    const daysOverdue = daysBetweenDates(toIso(now), t.dueDate);
    out.push({
      id: `task:${t.taskId}`,
      type: "task_due",
      urgency: "today",
      score: BASE.task_due + priorityBonus(t.priority) + cap(Math.max(0, daysOverdue) * 40, 300),
      title: t.title,
      subtitle: t.projectName,
      reason: daysOverdue > 0
        ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`
        : "Due today",
      detail: null,
      deepLink: `/tasks?task=${t.taskId}`,
      leadId: null, taskId: t.taskId, dealValue: 0, ageHours: Math.max(0, daysOverdue) * 24,
    });
  }

  for (const s of input.staleLeads) {
    const days = s.lastActivity ? daysBetweenDates(toIso(now), toIso(s.lastActivity)) : 30;
    out.push({
      id: `stale:${s.leadId}`,
      type: "stale_lead",
      urgency: "week",
      score: BASE.stale_lead + valueBonus(s.dealValue) + cap(days * 8, 200),
      title: s.name,
      subtitle: s.company,
      reason: s.lastActivity
        ? `${prettyStage(s.stage)} · nothing for ${days} days`
        : `${prettyStage(s.stage)} · never contacted`,
      detail: null,
      deepLink: `/crm?lead=${s.leadId}`,
      leadId: s.leadId, taskId: null, dealValue: s.dealValue, ageHours: days * 24,
    });
  }

  for (const u of input.unassigned) {
    const age = hoursBetween(now, u.createdAt);
    out.push({
      id: `unassigned:${u.leadId}`,
      type: "unassigned_lead",
      urgency: "week",
      score: BASE.unassigned_lead + valueBonus(u.dealValue) + cap(age / 3, 200),
      title: u.name,
      subtitle: u.company,
      reason: `Landed ${formatAge(age)} ago with no owner`,
      detail: null,
      deepLink: `/crm?lead=${u.leadId}`,
      leadId: u.leadId, taskId: null, dealValue: u.dealValue, ageHours: age,
    });
  }

  // One lead can only occupy one slot. A lead that replied AND is hot is a
  // single conversation — showing it twice makes the list feel like noise and
  // teaches people to skim it. Highest-scoring entry wins.
  const seenLeads = new Set<string>();
  const keepers: WorklistAction[] = [];
  for (const a of out.sort((x, y) => y.score - x.score)) {
    if (a.leadId) {
      if (seenLeads.has(a.leadId)) continue;
      seenLeads.add(a.leadId);
    }
    keepers.push(a);
  }

  return keepers.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// ── Small helpers ─────────────────────────────────────────

function priorityBonus(priority: string): number {
  return ({ critical: 180, high: 110, medium: 40, low: 0 } as Record<string, number>)[priority] ?? 40;
}

export function formatAge(hours: number): string {
  if (hours < 1)  return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)} days`;
}

function prettyStage(stage: string): string {
  return stage.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** Whole days between two YYYY-MM-DD strings (a - b). */
function daysBetweenDates(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}
