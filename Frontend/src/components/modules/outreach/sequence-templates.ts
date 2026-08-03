// Starter cadences offered when creating a sequence.
//
// Creating a sequence that could actually send used to take four dialogs: one
// for the sequence, then one per step, with the user expected to know that
// `day_offset` counts from enrolment (not from the previous step) and that a
// one-step sequence never follows up. Picking a template creates the sequence
// and its steps in a single request, already cadenced.
//
// Copy is deliberately short and specific. These are drafts meant to be edited,
// not send-ready marketing — a template that reads like filler gets rewritten
// anyway, and one that reads like it is finished gets sent as-is.
import type { SeedStep } from "@/hooks/useOutreach";

export interface SequenceTemplate {
  id:          string;
  name:        string;
  /** One line, shown under the name in the picker. */
  summary:     string;
  /** Human-readable cadence, e.g. "Day 0 · 3 · 7". */
  cadence:     string;
  recommended?: boolean;
  /** Shown as a caution when the choice has a known downside. */
  caveat?:     string;
  steps:       SeedStep[];
}

const email = (day: number, subject: string, body: string): SeedStep => ({
  day_offset: day, channel: "email", subject_template: subject, body_template: body,
});

export const SEQUENCE_TEMPLATES: SequenceTemplate[] = [
  {
    id: "three-touch",
    name: "3-touch cold open",
    summary: "Intro, one nudge, then a polite close. The default for a cold list.",
    cadence: "Day 0 · 3 · 7",
    recommended: true,
    steps: [
      email(0, "Quick question about {{company}}",
        "Hi {{first_name}},\n\nI came across {{company}} and had a specific question about how you handle {{category}} enquiries.\n\nWe build automations that answer and qualify them without anyone watching the inbox.\n\nWorth a short look?"),
      email(3, "Following up on {{company}}",
        "Hi {{first_name}},\n\nCircling back on my note. Happy to send a two-minute walkthrough rather than take a meeting — whichever is easier.\n\nWould that help?"),
      email(7, "Closing the loop",
        "Hi {{first_name}},\n\nLast note from me so I'm not cluttering your inbox. If the timing isn't right I'll leave it there — just reply if that changes."),
    ],
  },
  {
    id: "five-touch",
    name: "5-touch nurture",
    summary: "Longer runway with a case study and a break-up note. For higher-value targets.",
    cadence: "Day 0 · 2 · 5 · 9 · 14",
    steps: [
      email(0, "{{company}} and {{category}} enquiries",
        "Hi {{first_name}},\n\nQuick one — how does {{company}} handle enquiries that come in after hours?"),
      email(2, "One example",
        "Hi {{first_name}},\n\nA clinic we work with was losing evening enquiries to voicemail. Automating the first reply recovered most of them.\n\nHappy to share the specifics."),
      email(5, "Worth 10 minutes?",
        "Hi {{first_name}},\n\nIf this is worth exploring I can walk through what it would look like for {{company}} in about ten minutes."),
      email(9, "Still relevant?",
        "Hi {{first_name}},\n\nChecking whether this is still on your list. Entirely fine if not."),
      email(14, "Closing the file",
        "Hi {{first_name}},\n\nI'll stop here. If {{category}} enquiry handling comes back up, reply to this and I'll pick it straight up."),
    ],
  },
  {
    id: "single",
    name: "Single email",
    summary: "One message, no follow-up. For warm intros and re-engagement.",
    cadence: "Day 0 only",
    caveat: "Most replies to cold outreach come from the second and third touch. Use this only when the contact already knows you.",
    steps: [
      email(0, "{{first_name}} — quick note",
        "Hi {{first_name}},\n\n"),
    ],
  },
  {
    id: "blank",
    name: "Start empty",
    summary: "No steps. Build the cadence yourself.",
    cadence: "You add the steps",
    steps: [],
  },
];

/**
 * The day offset to pre-fill for the next step, given what already exists.
 *
 * Mirrors the spacing the user has already established rather than always
 * defaulting to 0 (which produced two steps on the same day, and a scheduler
 * that fired them back to back).
 */
export function suggestNextDayOffset(existing: number[]): number {
  if (existing.length === 0) return 0;
  const sorted = [...existing].sort((a, b) => a - b);
  const last   = sorted[sorted.length - 1];
  if (sorted.length === 1) return last + 3;
  const lastGap = last - sorted[sorted.length - 2];
  return last + Math.max(1, lastGap);
}
