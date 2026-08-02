import { describe, it, expect } from "vitest";
import { sanitizeSubject } from "./outreach-subject";

// Namecheap Private Email hard-rejects a subject ending in "?" with
// `554 5.7.1 ... JFE040023` and the mail is never delivered. 15 of 871 real
// sends hit this. The agent prompt now forbids it, but a prompt is a request —
// sanitizeSubject is the guarantee, so it needs real coverage.
describe("sanitizeSubject", () => {
  it("strips a trailing question mark (the actual rejection cause)", () => {
    expect(sanitizeSubject("Is now not the time?")).toBe("Is now not the time");
    expect(sanitizeSubject("Partnership for your agency?")).toBe("Partnership for your agency");
  });

  it("strips repeated/mixed trailing punctuation", () => {
    expect(sanitizeSubject("Worth a look???")).toBe("Worth a look");
    expect(sanitizeSubject("Big news!!")).toBe("Big news");
    expect(sanitizeSubject("Really?!")).toBe("Really");
  });

  it("strips trailing whitespace around the punctuation", () => {
    expect(sanitizeSubject("  Quick question ?  ")).toBe("Quick question");
  });

  it("strips trailing dashes and colons that read as truncated", () => {
    expect(sanitizeSubject("A quick idea —")).toBe("A quick idea");
    expect(sanitizeSubject("For your clinic:")).toBe("For your clinic");
  });

  it("leaves a clean statement subject untouched", () => {
    expect(sanitizeSubject("A quick question")).toBe("A quick question");
    expect(sanitizeSubject("WhatsApp leads in 10s")).toBe("WhatsApp leads in 10s");
  });

  it("preserves internal punctuation — only the tail is unsafe", () => {
    expect(sanitizeSubject("Booking? Here's a fix")).toBe("Booking? Here's a fix");
  });

  it("handles empty and whitespace-only input without throwing", () => {
    expect(sanitizeSubject("")).toBe("");
    expect(sanitizeSubject("   ")).toBe("");
    expect(sanitizeSubject("???")).toBe("");
  });
});
