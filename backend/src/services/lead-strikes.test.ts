import { describe, it, expect } from "vitest";
import {
  STRIKE_LIMIT, DEFAULT_STRIKE_LIMIT_ACTION, normalizeStrikeLimitAction,
  strikeActivityType, strikeActivity, strikeLimitEffects,
} from "./lead-strikes";

const NOW = new Date("2026-08-05T21:40:00Z");   // 23:40 in Cairo

describe("the strike limit itself", () => {
  it("is three", () => {
    expect(STRIKE_LIMIT).toBe(3);
  });

  it("defaults to the reversible action", () => {
    // Archiving hides a lead from the list. Closing it lost only moves a stage,
    // which one click undoes. A default that loses visibility is not a default.
    expect(DEFAULT_STRIKE_LIMIT_ACTION).toBe("close_lost");
  });
});

describe("normalizeStrikeLimitAction", () => {
  it("passes both real actions through", () => {
    expect(normalizeStrikeLimitAction("close_lost")).toBe("close_lost");
    expect(normalizeStrikeLimitAction("archive")).toBe("archive");
  });

  it("falls back to the safe action for anything unrecognised", () => {
    // The column is plain text with no database CHECK, so a hand-written UPDATE
    // or a newer build can put anything there. The worst case must be "closed
    // instead of archived", never "hidden unexpectedly".
    for (const bad of ["delete", "DELETE_LEADS", "", null, undefined, 3, {}]) {
      expect(normalizeStrikeLimitAction(bad)).toBe("close_lost");
    }
  });
});

describe("strikeActivityType — a strike may not claim a contact that did not happen", () => {
  it("records a call as a call and an email as an email", () => {
    expect(strikeActivityType("call")).toBe("call");
    expect(strikeActivityType("email")).toBe("email");
    expect(strikeActivityType("meeting")).toBe("meeting");
  });

  it("records a WhatsApp message as a note, not a call", () => {
    // /crm/insights counts email/call/meeting/form activities as outreach
    // volume. Typing a WhatsApp strike as `call` would report phone calls
    // nobody made.
    expect(strikeActivityType("whatsapp")).toBe("note");
  });

  it("records an unspecified channel as a note", () => {
    expect(strikeActivityType("other")).toBe("note");
    expect(strikeActivityType(null)).toBe("note");
    expect(strikeActivityType(undefined)).toBe("note");
  });
});

describe("strikeActivity — the timeline entry", () => {
  it("carries the running total, not just 'a strike'", () => {
    expect(strikeActivity({ count: 2, channel: "whatsapp" }).description)
      .toBe("Strike 2/3 · WhatsApp attempt");
  });

  it("appends the note when there is one", () => {
    expect(strikeActivity({ count: 1, channel: "call", note: "no answer, left voicemail" }))
      .toEqual({ type: "call", description: "Strike 1/3 · Call attempt — no answer, left voicemail" });
  });

  it("ignores a whitespace-only note rather than trailing an empty dash", () => {
    expect(strikeActivity({ count: 1, channel: "call", note: "   " }).description)
      .toBe("Strike 1/3 · Call attempt");
  });

  it("still reads sensibly with no channel", () => {
    expect(strikeActivity({ count: 3 }))
      .toEqual({ type: "note", description: "Strike 3/3 · Contact attempt" });
  });
});

describe("strikeLimitEffects — below the limit", () => {
  it("does nothing on the first strike", () => {
    expect(strikeLimitEffects({ count: 1, action: "close_lost", now: NOW }))
      .toEqual({ reached: false, applied: null, patch: {}, activity: null });
  });

  it("does nothing on the second strike, under either policy", () => {
    for (const action of ["close_lost", "archive"] as const) {
      const effects = strikeLimitEffects({ count: 2, action, now: NOW });
      expect(effects.reached).toBe(false);
      expect(effects.patch).toEqual({});
    }
  });
});

describe("strikeLimitEffects — Option A: close_lost", () => {
  it("moves the lead to closed_lost and nothing else", () => {
    const effects = strikeLimitEffects({ count: 3, action: "close_lost", now: NOW });
    expect(effects.reached).toBe(true);
    expect(effects.applied).toBe("close_lost");
    expect(effects.patch).toEqual({ stage: "closed_lost" });
  });

  it("does not archive the lead", () => {
    // The whole point of the safer default: the lead stays in the list.
    expect(strikeLimitEffects({ count: 3, action: "close_lost", now: NOW }).patch.archivedAt)
      .toBeUndefined();
  });

  it("explains itself in the timeline", () => {
    const { activity } = strikeLimitEffects({ count: 3, action: "close_lost", now: NOW });
    expect(activity?.type).toBe("note");
    expect(activity?.description).toContain("Closed lost automatically after 3 contact attempts");
  });
});

describe("strikeLimitEffects — Option B: archive", () => {
  it("stamps archived_at with the instant it was given", () => {
    const effects = strikeLimitEffects({ count: 3, action: "archive", now: NOW });
    expect(effects.applied).toBe("archive");
    expect(effects.patch.archivedAt).toBe(NOW);
  });

  it("ALSO closes the lead lost", () => {
    // Archiving without the stage move would hide the lead from people while
    // leaving it in pipeline value and in Today's queue, both of which key off
    // the stage.
    expect(strikeLimitEffects({ count: 3, action: "archive", now: NOW }).patch.stage)
      .toBe("closed_lost");
  });

  it("explains itself in the timeline", () => {
    const { activity } = strikeLimitEffects({ count: 3, action: "archive", now: NOW });
    expect(activity?.description).toContain("Archived automatically after 3 contact attempts");
  });

  it("never deletes anything — the patch only ever touches two columns", () => {
    const { patch } = strikeLimitEffects({ count: 3, action: "archive", now: NOW });
    expect(Object.keys(patch).sort()).toEqual(["archivedAt", "stage"]);
  });
});

describe("strikeLimitEffects — past the limit", () => {
  it("still applies the action on a fourth strike", () => {
    // Fires on >= rather than ===. A lead reopened out of closed_lost and chased
    // again would otherwise sit at four or five strikes with none of them
    // counting for anything.
    expect(strikeLimitEffects({ count: 4, action: "close_lost", now: NOW }).reached).toBe(true);
    expect(strikeLimitEffects({ count: 9, action: "archive", now: NOW }).applied).toBe("archive");
  });
});
