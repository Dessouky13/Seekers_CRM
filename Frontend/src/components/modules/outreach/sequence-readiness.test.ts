import { describe, it, expect } from "vitest";
import { checkSequence, isSendable, worstLevel, type SequenceShape } from "./sequence-readiness";
import { suggestNextDayOffset } from "./sequence-templates";
import type { SequenceStep } from "@/hooks/useOutreach";

const step = (over: Partial<SequenceStep> = {}): SequenceStep => ({
  id:              over.id ?? `s${over.position ?? 0}`,
  sequenceId:      "seq",
  position:        over.position ?? 0,
  dayOffset:       over.dayOffset ?? 0,
  channel:         over.channel ?? "email",
  subjectTemplate: over.subjectTemplate !== undefined ? over.subjectTemplate : "A subject",
  bodyTemplate:    over.bodyTemplate    !== undefined ? over.bodyTemplate    : "A body long enough",
  agentId:         over.agentId ?? null,
  createdAt:       "2026-01-01T00:00:00Z",
});

const seq = (over: Partial<SequenceShape> = {}): SequenceShape => ({
  isActive:             over.isActive ?? true,
  // `??` would swallow an explicitly-null category and substitute the default,
  // making the "no category set" case untestable.
  category:             "category" in over ? over.category! : "dentist",
  autoEnrollOnCategory: over.autoEnrollOnCategory ?? false,
  autoEnrollAll:        over.autoEnrollAll ?? false,
  steps:                over.steps ?? [
    step({ position: 0, dayOffset: 0 }),
    step({ position: 1, dayOffset: 3 }),
    step({ position: 2, dayOffset: 7 }),
  ],
});

describe("checkSequence", () => {
  it("passes a well-formed 3-touch sequence", () => {
    expect(checkSequence(seq())).toEqual([]);
    expect(isSendable(seq())).toBe(true);
  });

  it("blocks an active sequence with no steps", () => {
    const issues = checkSequence(seq({ steps: [] }));
    expect(issues.some((i) => i.level === "blocker")).toBe(true);
    expect(isSendable(seq({ steps: [] }))).toBe(false);
  });

  it("only warns about an empty sequence that is switched off", () => {
    const issues = checkSequence(seq({ steps: [], isActive: false }));
    expect(issues.every((i) => i.level !== "blocker")).toBe(true);
  });

  it("blocks a step with no body and no agent", () => {
    const issues = checkSequence(seq({ steps: [step({ bodyTemplate: null })] }));
    expect(issues.some((i) => i.level === "blocker" && /no body/.test(i.message))).toBe(true);
  });

  it("accepts an agent-generated step with no body template", () => {
    const issues = checkSequence(seq({
      steps: [step({ bodyTemplate: null, agentId: "outreach_drafter" })],
    }));
    expect(issues.some((i) => /no body/.test(i.message))).toBe(false);
  });

  it("blocks a step with no subject", () => {
    const issues = checkSequence(seq({ steps: [step({ subjectTemplate: null })] }));
    expect(issues.some((i) => i.level === "blocker" && /no subject/.test(i.message))).toBe(true);
  });

  it("does not require a body on non-sending channels", () => {
    const issues = checkSequence(seq({
      steps: [step({ channel: "note", subjectTemplate: null, bodyTemplate: null })],
    }));
    expect(issues.some((i) => i.level === "blocker")).toBe(false);
  });

  it("warns when a subject ends in a question mark", () => {
    // The mailbox provider rejects these with 554; the sender strips them, but
    // the author should know their wording is being changed.
    const issues = checkSequence(seq({ steps: [step({ subjectTemplate: "Got a minute?" })] }));
    expect(issues.some((i) => i.level === "warning" && /ends with/.test(i.message))).toBe(true);
  });

  it("warns on duplicate day offsets", () => {
    const issues = checkSequence(seq({
      steps: [step({ position: 0, dayOffset: 2 }), step({ position: 1, dayOffset: 2, id: "b" })],
    }));
    expect(issues.some((i) => /share day 2/.test(i.message))).toBe(true);
  });

  it("warns when steps are out of day order", () => {
    const issues = checkSequence(seq({
      steps: [step({ position: 0, dayOffset: 7 }), step({ position: 1, dayOffset: 3, id: "b" })],
    }));
    expect(issues.some((i) => /not in day order/.test(i.message))).toBe(true);
  });

  it("warns about the single-step trap", () => {
    const issues = checkSequence(seq({ steps: [step()] }));
    expect(issues.some((i) => /no follow-ups/.test(i.message))).toBe(true);
  });

  it("blocks auto-enroll by category when no category is set", () => {
    const issues = checkSequence(seq({ autoEnrollOnCategory: true, category: null }));
    expect(issues.some((i) => i.level === "blocker" && /no category is set/.test(i.message))).toBe(true);
  });

  it("warns about auto-enroll-all, which is how leads get double-emailed", () => {
    const issues = checkSequence(seq({ autoEnrollAll: true }));
    expect(issues.some((i) => /Every new lead/.test(i.message))).toBe(true);
  });

  it("does not demand a subject line on a WhatsApp step", () => {
    // WhatsApp messages have no subject; requiring one would make every
    // WhatsApp sequence permanently un-sendable.
    const issues = checkSequence(seq({
      steps: [step({ channel: "whatsapp", subjectTemplate: null, bodyTemplate: "Hi there, quick question." })],
    }));
    expect(issues.some((i) => /no subject/i.test(i.message))).toBe(false);
  });

  it("still requires a body on a WhatsApp step", () => {
    const issues = checkSequence(seq({
      steps: [step({ channel: "whatsapp", subjectTemplate: null, bodyTemplate: null })],
    }));
    expect(issues.some((i) => i.level === "blocker" && /no body/i.test(i.message))).toBe(true);
  });

  it("requires neither subject nor body on a call step", () => {
    // A call step is a reminder to phone someone; a script is optional.
    const issues = checkSequence(seq({
      steps: [step({ channel: "call", subjectTemplate: null, bodyTemplate: null })],
    }));
    expect(issues.some((i) => i.level === "blocker")).toBe(false);
  });

  it("notes that manual steps pause the sequence for a human", () => {
    const issues = checkSequence(seq({
      steps: [
        step({ position: 0, dayOffset: 0, channel: "email" }),
        step({ position: 1, dayOffset: 3, channel: "whatsapp", id: "b", subjectTemplate: null, bodyTemplate: "Hi" }),
      ],
    }));
    expect(issues.some((i) => /waits for a person/i.test(i.message))).toBe(true);
  });
});

describe("worstLevel", () => {
  it("ranks blocker over warning over info", () => {
    expect(worstLevel([{ level: "info", message: "" }, { level: "blocker", message: "" }])).toBe("blocker");
    expect(worstLevel([{ level: "info", message: "" }, { level: "warning", message: "" }])).toBe("warning");
    expect(worstLevel([])).toBeNull();
  });
});

describe("suggestNextDayOffset", () => {
  it("starts at day 0", () => {
    expect(suggestNextDayOffset([])).toBe(0);
  });

  it("suggests day 3 after a single day-0 step", () => {
    expect(suggestNextDayOffset([0])).toBe(3);
  });

  it("repeats the most recent gap", () => {
    expect(suggestNextDayOffset([0, 3])).toBe(6);
    expect(suggestNextDayOffset([0, 2, 5])).toBe(8);
  });

  it("is order-independent", () => {
    expect(suggestNextDayOffset([7, 0, 3])).toBe(11);
  });

  it("never suggests the same day twice", () => {
    expect(suggestNextDayOffset([4, 4])).toBeGreaterThan(4);
  });
});
