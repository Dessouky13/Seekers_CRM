import { describe, it, expect } from "vitest";
import { buildStaleLeadDigest, staleLeadDigestKey, type StaleLeadGroup } from "./stale-lead-digest";

// The database half of the sweep is exercised against the real local database
// (see .superpowers/notes/bugfix-report.md); these cover the pure half — the
// wording and the dedupe key, which are what decide "one row per person per day".

const group = (over: Partial<StaleLeadGroup> = {}): StaleLeadGroup => ({
  userId: "u-1",
  staleCount: 12,
  sample: ["Ahmed Fathy", "Sara Nabil", "Karim Ezzat"],
  ...over,
});

describe("buildStaleLeadDigest — one sentence, whatever the volume", () => {
  it("leads with the count, because the count is the whole signal", () => {
    expect(buildStaleLeadDigest(group(), 48).title).toBe("12 leads have gone quiet");
  });

  it("says 'has' for exactly one lead", () => {
    const d = buildStaleLeadDigest(group({ staleCount: 1, sample: ["Ahmed Fathy"] }), 48);
    expect(d.title).toBe("1 lead has gone quiet");
    expect(d.body).toBe("Ahmed Fathy — no reply in 48+ hours.");
  });

  it("names at most three leads and counts the rest", () => {
    expect(buildStaleLeadDigest(group(), 48).body)
      .toBe("Ahmed Fathy, Sara Nabil, Karim Ezzat and 9 more — no reply in 48+ hours.");
  });

  it("drops the 'and N more' tail when the sample is the whole set", () => {
    expect(buildStaleLeadDigest(group({ staleCount: 3 }), 48).body)
      .toBe("Ahmed Fathy, Sara Nabil, Karim Ezzat — no reply in 48+ hours.");
  });

  it("never renders a negative or zero remainder if the sample overruns the count", () => {
    const body = buildStaleLeadDigest(group({ staleCount: 2 }), 48).body;
    expect(body).not.toMatch(/and (-\d+|0) more/);
    expect(body).toBe("Ahmed Fathy, Sara Nabil — no reply in 48+ hours.");
  });

  it("survives a group with no names", () => {
    const d = buildStaleLeadDigest(group({ staleCount: 5, sample: [] }), 48);
    expect(d.title).toBe("5 leads have gone quiet");
    expect(d.body).toBe("no reply in 48+ hours.");
  });

  it("reflects a non-default threshold", () => {
    expect(buildStaleLeadDigest(group({ staleCount: 1, sample: [] }), 72).body)
      .toBe("no reply in 72+ hours.");
  });

  it("points at the per-user queue, not the unfiltered lead list", () => {
    expect(buildStaleLeadDigest(group(), 48).link).toBe("/today");
  });

  it("changes its title when the count moves, so the refresh path can detect it", () => {
    expect(buildStaleLeadDigest(group({ staleCount: 13 }), 48).title)
      .not.toBe(buildStaleLeadDigest(group({ staleCount: 12 }), 48).title);
  });

  it("produces ONE payload for a whole group, however large", () => {
    // The regression this guards: anything that returns a per-lead collection.
    const d = buildStaleLeadDigest(group({ staleCount: 719 }), 48);
    expect(Array.isArray(d)).toBe(false);
    expect(d.title).toBe("719 leads have gone quiet");
  });
});

describe("staleLeadDigestKey — the once-per-day guarantee", () => {
  it("is stable for the same person on the same day", () => {
    expect(staleLeadDigestKey("u-1", "2026-08-04")).toBe(staleLeadDigestKey("u-1", "2026-08-04"));
  });

  it("differs per person, so one digest never suppresses another's", () => {
    expect(staleLeadDigestKey("u-1", "2026-08-04")).not.toBe(staleLeadDigestKey("u-2", "2026-08-04"));
  });

  it("differs per day, so tomorrow gets a fresh digest", () => {
    expect(staleLeadDigestKey("u-1", "2026-08-04")).not.toBe(staleLeadDigestKey("u-1", "2026-08-05"));
  });

  it("is not keyed by lead — that was the flood", () => {
    // The old key was `lead-no-response:{leadId}:{day}`: one row per lead per day.
    // Nothing in the new key can vary with a lead.
    expect(staleLeadDigestKey("u-1", "2026-08-04")).toBe("lead-no-response-digest:u-1:2026-08-04");
  });
});
