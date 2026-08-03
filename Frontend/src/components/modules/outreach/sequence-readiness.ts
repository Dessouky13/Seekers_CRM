// "Can this sequence actually run, and will it do what the user thinks?"
//
// Validation used to be a single warning that appeared only when a sequence had
// exactly one step. Everything else failed silently at send time: a step with no
// subject, two steps on the same day, an active sequence with no steps at all.
// Those turned into support questions ("it only sent the first mail") rather
// than anything visible in the builder.
//
// Pure functions over the sequence shape so they can be unit-tested without a
// DOM or a server.
import type { SequenceStep, Channel } from "@/hooks/useOutreach";

export type IssueLevel = "blocker" | "warning" | "info";

export interface ReadinessIssue {
  level:   IssueLevel;
  /** Shown in the list. One sentence, states the problem. */
  message: string;
  /** What to do about it. Optional — omit when the message is self-evident. */
  fix?:    string;
  /** Step this attaches to, so the UI can highlight the offending card. */
  stepId?: string;
}

export interface SequenceShape {
  isActive:             boolean;
  category:             string | null;
  autoEnrollOnCategory: boolean;
  autoEnrollAll:        boolean;
  steps:                SequenceStep[];
}

/** True when a step will produce a body at send time. */
function stepHasContent(s: SequenceStep): boolean {
  return !!s.agentId || !!(s.bodyTemplate && s.bodyTemplate.trim().length >= 10);
}

/** Channels that need message text a human will actually send. */
const CHANNEL_NEEDS_BODY: Record<Channel, boolean> = {
  email: true, linkedin: false, note: false, whatsapp: true, call: false,
};

/** Only email has a subject line. */
const CHANNEL_NEEDS_SUBJECT: Record<Channel, boolean> = {
  email: true, linkedin: false, note: false, whatsapp: false, call: false,
};

/** Channels that stop the sequence until a person acts. */
const CHANNEL_IS_MANUAL: Record<Channel, boolean> = {
  email: false, linkedin: false, note: false, whatsapp: true, call: true,
};

export function checkSequence(seq: SequenceShape): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
  const steps = [...seq.steps].sort((a, b) => a.position - b.position);

  // ── Blockers: the sequence cannot do its job at all ──
  if (steps.length === 0) {
    issues.push({
      level: seq.isActive ? "blocker" : "warning",
      message: "This sequence has no steps.",
      fix: "Add at least one step, or it will never send anything.",
    });
  }

  for (const s of steps) {
    if (CHANNEL_NEEDS_BODY[s.channel] && !stepHasContent(s)) {
      issues.push({
        level: "blocker", stepId: s.id,
        message: `Day ${s.dayOffset} has no body.`,
        fix: s.channel === "whatsapp"
          ? "Write the WhatsApp message. Without it there is nothing for a human to send."
          : "Write a body template, or pick an AI agent to generate one per lead.",
      });
    }

    if (CHANNEL_NEEDS_SUBJECT[s.channel]) {
      if (!s.subjectTemplate?.trim()) {
        issues.push({
          level: "blocker", stepId: s.id,
          message: `Day ${s.dayOffset} has no subject line.`,
          fix: "Emails without a subject are rejected by most mail servers.",
        });
      } else if (/[?!]\s*$/.test(s.subjectTemplate.trim())) {
        // Learned the hard way: the mailbox provider rejects these outright.
        issues.push({
          level: "warning", stepId: s.id,
          message: `Day ${s.dayOffset}'s subject ends with "${s.subjectTemplate.trim().slice(-1)}".`,
          fix: "Some providers reject subject lines ending in ? or !. It will be stripped automatically before sending.",
        });
      }
    }
  }

  // Manual steps are a feature, but they change how the sequence behaves and
  // the author should know before enrolling anyone.
  const manualCount = steps.filter((s) => CHANNEL_IS_MANUAL[s.channel]).length;
  if (manualCount > 0) {
    issues.push({
      level: "info",
      message: `${manualCount} step${manualCount === 1 ? "" : "s"} waits for a person.`,
      fix: "Nothing is sent automatically at those steps — they appear in Today until someone records an outcome, and the sequence pauses until they do.",
    });
  }

  // ── Cadence problems ──
  const offsets = steps.map((s) => s.dayOffset);
  const dupes = offsets.filter((v, i) => offsets.indexOf(v) !== i);
  if (dupes.length) {
    issues.push({
      level: "warning",
      message: `Two or more steps share day ${[...new Set(dupes)].join(", ")}.`,
      fix: "They will send within moments of each other, which reads as a glitch to the recipient.",
    });
  }
  if (steps.some((s, i) => i > 0 && s.dayOffset < steps[i - 1].dayOffset)) {
    issues.push({
      level: "warning",
      message: "Steps are not in day order.",
      fix: "Drag them into ascending order so the cadence matches the sequence.",
    });
  }

  // ── The single-step trap ──
  if (steps.length === 1) {
    issues.push({
      level: "warning",
      message: "Only one step, so no follow-ups will ever be sent.",
      fix: "Most replies come from the second and third touch. Add a day-3 and a day-7 step.",
    });
  }

  // ── Enrolment configuration ──
  if (seq.autoEnrollOnCategory && !seq.category) {
    issues.push({
      level: "blocker",
      message: "Auto-enroll by category is on, but no category is set.",
      fix: "Set a category, or nothing will ever match and the sequence stays empty.",
    });
  }
  if (seq.autoEnrollAll) {
    issues.push({
      level: "warning",
      message: "Every new lead auto-enrolls in this sequence, regardless of category.",
      fix: "If a second sequence also has this on, leads get enrolled twice and receive duplicate emails.",
    });
  }
  if (!seq.isActive && steps.length > 0) {
    issues.push({
      level: "info",
      message: "This sequence is inactive — enrolled leads are not being sent to.",
      fix: "Switch Active on when the steps look right.",
    });
  }

  return issues;
}

/** Highest severity present, or null when the sequence is clean. */
export function worstLevel(issues: ReadinessIssue[]): IssueLevel | null {
  if (issues.some((i) => i.level === "blocker")) return "blocker";
  if (issues.some((i) => i.level === "warning")) return "warning";
  if (issues.length) return "info";
  return null;
}

/** True when the sequence would send correctly if switched on. */
export function isSendable(seq: SequenceShape): boolean {
  return seq.steps.length > 0 && !checkSequence(seq).some((i) => i.level === "blocker");
}
