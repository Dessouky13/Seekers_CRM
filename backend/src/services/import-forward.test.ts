import { describe, it, expect, beforeEach } from "vitest";
import {
  importFingerprint, recentForwardAgeMs, recordForward, resetForwardMemory,
  FORWARD_DEDUPE_WINDOW_MS,
} from "./import-forward";

// The module holds process-level state on purpose (see its header), so every
// case starts from an empty memory or they leak into each other.
beforeEach(() => resetForwardMemory());

describe("importFingerprint", () => {
  it("is stable for identical bytes and different for changed bytes", () => {
    const a = importFingerprint(Buffer.from("name,company\nJane,Acme\n"));
    const b = importFingerprint(Buffer.from("name,company\nJane,Acme\n"));
    const c = importFingerprint(Buffer.from("name,company\nJane,Acme Ltd\n"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("is a 64-char sha256 hex digest", () => {
    expect(importFingerprint(Buffer.from("x"))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores the filename — it is content-addressed", () => {
    // The same sheet saved as "leads.csv" and "leads (1).csv" must collide.
    const bytes = Buffer.from("a,b\n1,2\n");
    expect(importFingerprint(bytes)).toBe(importFingerprint(Buffer.from(bytes)));
  });
});

describe("recentForwardAgeMs", () => {
  it("returns null for a file never forwarded", () => {
    expect(recentForwardAgeMs("deadbeef")).toBeNull();
  });

  it("returns the age of a forward inside the window", () => {
    recordForward("fp1", 1_000_000);
    expect(recentForwardAgeMs("fp1", 1_000_000 + 4 * 60_000)).toBe(4 * 60_000);
  });

  it("returns null once the window has passed", () => {
    recordForward("fp1", 1_000_000);
    expect(recentForwardAgeMs("fp1", 1_000_000 + FORWARD_DEDUPE_WINDOW_MS)).toBeNull();
  });

  it("treats the window as exclusive at its exact boundary", () => {
    recordForward("fp1", 0);
    expect(recentForwardAgeMs("fp1", FORWARD_DEDUPE_WINDOW_MS - 1)).toBe(FORWARD_DEDUPE_WINDOW_MS - 1);
    expect(recentForwardAgeMs("fp1", FORWARD_DEDUPE_WINDOW_MS)).toBeNull();
  });

  it("forgets an expired entry rather than re-checking it forever", () => {
    recordForward("fp1", 0);
    expect(recentForwardAgeMs("fp1", FORWARD_DEDUPE_WINDOW_MS + 1)).toBeNull();
    // Asking again with a time INSIDE the original window must still say null:
    // the entry is gone, not merely filtered.
    expect(recentForwardAgeMs("fp1", 1_000)).toBeNull();
  });

  it("keeps distinct files independent", () => {
    recordForward("fp1", 0);
    recordForward("fp2", 60_000);
    expect(recentForwardAgeMs("fp1", 60_000)).toBe(60_000);
    expect(recentForwardAgeMs("fp2", 60_000)).toBe(0);
  });
});

describe("recordForward", () => {
  it("re-recording refreshes the timestamp (a forced resend restarts the window)", () => {
    recordForward("fp1", 0);
    recordForward("fp1", 10 * 60_000);
    expect(recentForwardAgeMs("fp1", 10 * 60_000 + 1_000)).toBe(1_000);
  });

  it("prunes entries older than the window as new ones arrive", () => {
    recordForward("old", 0);
    recordForward("new", FORWARD_DEDUPE_WINDOW_MS + 1);
    // "old" was dropped during the prune, not just aged out on read.
    expect(recentForwardAgeMs("old", 1_000)).toBeNull();
    expect(recentForwardAgeMs("new", FORWARD_DEDUPE_WINDOW_MS + 1)).toBe(0);
  });

  it("stays bounded when many files are forwarded inside one window", () => {
    // 600 distinct files, all inside the window, against a 500-entry cap: the
    // oldest must be evicted rather than the map growing forever.
    for (let i = 0; i < 600; i++) recordForward(`fp-${i}`, i);
    expect(recentForwardAgeMs("fp-0", 600)).toBeNull();
    expect(recentForwardAgeMs("fp-599", 600)).toBe(1);
  });
});

describe("the guarantee this file exists for", () => {
  it("blocks a byte-identical resend and allows it again after the window", () => {
    const bytes = Buffer.from("name,company,email\nJane,Acme,jane@acme.com\n");
    const fp = importFingerprint(bytes);

    // First hand-off.
    expect(recentForwardAgeMs(fp, 0)).toBeNull();
    recordForward(fp, 0);

    // Double-tap 800ms later — the case this was written for.
    expect(recentForwardAgeMs(fp, 800)).toBe(800);

    // An hour later it is a legitimate new import again.
    expect(recentForwardAgeMs(fp, 60 * 60_000)).toBeNull();
  });

  it("does NOT block a semantically identical file with different bytes", () => {
    // Documented limitation: Excel rewrites zip timestamps on every save, so a
    // re-export of the same data hashes differently and gets through.
    recordForward(importFingerprint(Buffer.from("a,b\n1,2\n")), 0);
    expect(recentForwardAgeMs(importFingerprint(Buffer.from("a,b\n1,2")), 0)).toBeNull();
  });
});
