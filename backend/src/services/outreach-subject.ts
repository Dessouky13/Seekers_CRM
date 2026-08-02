// Pure subject-line helpers, deliberately kept out of outreach.ts so they can
// be unit-tested without a database connection (same split as
// worklist-ranking.ts vs worklist.ts).

/**
 * Make a subject line safe for the sending provider.
 *
 * Namecheap Private Email hard-rejects a subject that ends in "?" with
 * `554 5.7.1 The subject line ends with a question mark ... JFE040023` — the
 * mail is never delivered and the enrolment used to be marked permanently
 * failed. Cold-email subjects are very often questions, so this is not an edge
 * case: 15 of 871 real sends hit it.
 *
 * We keep the question's wording and only drop the punctuation, plus trailing
 * dashes/colons that make a subject look truncated.
 */
export function sanitizeSubject(subject: string): string {
  let s = (subject ?? "").trim();
  // Any run of trailing ? ! and whitespace: "Worth a look???" → "Worth a look".
  s = s.replace(/[?!\s]+$/g, "").trim();
  // Trailing dashes/colons/commas read as cut off mid-thought.
  s = s.replace(/[-–—:,;]+$/g, "").trim();
  return s;
}
