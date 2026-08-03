// Outreach service: template rendering, scheduler tick, send orchestration.
import { and, eq, lte, sql, asc, isNull, or, inArray } from "drizzle-orm";
import { db } from "../db/client";
import {
  outreachSequences, outreachSteps, outreachEnrollments, outreachSends,
  leads, leadActivities, profiles, mailboxes,
} from "../db/schema";
import { sendOutreachEmail, buildDefaultSignature, buildDefaultSignatureText } from "./email";
import { runAgent, isEmailCapableAgent } from "./agents";
import { fireEventAsync } from "./webhooks";
import { sanitizeSubject } from "./outreach-subject";
import {
  spreadGapSeconds, nextSpreadSlot, isWithinSendWindow,
  releaseCountNow, nextStageAfterSpamReject, type WarmupStage,
} from "./sending-policy";
import { suppress, suppressedSet } from "./suppressions";
import { configuredSenderAddress, loadSendingMailbox } from "./mailbox";
import { unreachableReason } from "./channels";
import { cairoToday } from "../utils/dates";

// Promise-based sleep for spacing sends within a released batch.
function sleepUntil(target: Date): Promise<void> {
  const ms = Math.max(0, target.getTime() - Date.now());
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mustache-lite template renderer. Supports {{name}}, {{company}}, etc.
// Missing keys render as empty string. Whitespace inside braces is ignored.
export function renderTemplate(tpl: string, vars: Record<string, string | null | undefined>): string {
  return tpl.replace(/\{\{\s*([\w_.]+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

// Parse an AI-agent output that may begin with "Subject: ..." on the first line.
// Returns { subject, body }. If no Subject: prefix, subject is null and body is the full output.
// Strip trailing AI-generated sign-offs / signatures. We always append a
// canonical signature ourselves; any sign-off the model adds becomes a duplicate
// and tanks deliverability (looks templated). Patterns we strip from the END:
//   "— Seekers AI team", "Best, ...", "Thanks, ...", lone "--" delimiter,
//   "Sent from my iPhone", and any contact-info trailer (email/url/phone).
function stripTrailingSignoff(body: string): string {
  let lines = body.replace(/\r\n/g, "\n").split("\n");
  // Pop trailing blank/sign-off lines until we hit real content.
  const signoffRe = /^(\s*[-–—]+\s*$|\s*[-–—]\s*Seekers.*|\s*(best|thanks|cheers|regards|warmly|sincerely)[\s,!.]*.*|\s*Sent from my .*|\s*The Seekers team.*|\s*Seekers AI Automation Solutions.*|\s*team@seekersai\.org.*|\s*\+?\d[\d\s\-()]{6,}\s*$|\s*https?:\/\/\S+\s*$)/i;
  while (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last.trim() === "" || signoffRe.test(last)) {
      lines.pop();
    } else {
      break;
    }
  }
  return lines.join("\n").trim();
}

export function parseSubjectAndBody(output: string): { subject: string | null; body: string } {
  const trimmed = output.replace(/^\s+/, "");
  const m = trimmed.match(/^Subject:\s*([^\n\r]+)[\r\n]+([\s\S]*)$/i);
  if (m) {
    return {
      subject: m[1].trim().slice(0, 200),
      body:    stripTrailingSignoff(m[2].trim()),
    };
  }
  // Sometimes models wrap output in ```markdown blocks — strip them.
  const stripped = trimmed.replace(/^```\w*\s*|\s*```$/g, "").trim();
  const m2 = stripped.match(/^Subject:\s*([^\n\r]+)[\r\n]+([\s\S]*)$/i);
  if (m2) return { subject: m2[1].trim().slice(0, 200), body: stripTrailingSignoff(m2[2].trim()) };
  return { subject: null, body: stripTrailingSignoff(trimmed) };
}

// Build the variables available to templates for a given lead.
function buildLeadVars(lead: typeof leads.$inferSelect): Record<string, string> {
  return {
    name:        lead.name,
    first_name:  lead.name.split(/\s+/)[0] ?? lead.name,
    company:     lead.company,
    email:       lead.email ?? "",
    category:    lead.category ?? "",
    niche:       lead.category ?? "",
    source:      lead.source ?? "",
  };
}

// Find a step's actual due date for an enrollment based on its day_offset.
// Snaps every send to 12:00 PM Cairo (Africa/Cairo) and skips Egyptian
// weekend (Friday + Saturday) by pushing forward to Sunday.
const CAIRO_TZ = "Africa/Cairo";

function computeNextSendAt(enrolledAt: Date, dayOffset: number): Date {
  // Step 1 — add the requested day offset
  const base = new Date(enrolledAt.getTime() + dayOffset * 86_400_000);

  // Step 2 — extract the Cairo-local date components (handles DST automatically)
  const cairoDateStr = base.toLocaleDateString("en-CA", { timeZone: CAIRO_TZ }); // "YYYY-MM-DD"
  const [y, m, d] = cairoDateStr.split("-").map(Number);

  // Step 3 — find the UTC instant that corresponds to 12:00 Cairo on that date.
  // Use noon UTC as an anchor, observe what Cairo says, then shift to land at 12.
  const noonUtc   = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const cairoHour = Number(noonUtc.toLocaleString("en-US", { timeZone: CAIRO_TZ, hour: "2-digit", hour12: false }));
  let sendAt      = new Date(noonUtc.getTime() + (12 - cairoHour) * 3_600_000);

  // Step 4 — if for any reason this lands in the past (dayOffset=0 enrolled
  // after noon Cairo), push to next-day noon Cairo.
  if (sendAt.getTime() <= enrolledAt.getTime()) {
    sendAt = new Date(sendAt.getTime() + 86_400_000);
  }

  // Step 5 — skip the Egyptian weekend (Friday + Saturday).
  // Push Fri → Sun (+2 days), Sat → Sun (+1 day).
  let weekday = sendAt.toLocaleString("en-US", { timeZone: CAIRO_TZ, weekday: "short" });
  while (weekday === "Fri" || weekday === "Sat") {
    sendAt  = new Date(sendAt.getTime() + 86_400_000);
    weekday = sendAt.toLocaleString("en-US", { timeZone: CAIRO_TZ, weekday: "short" });
  }

  return sendAt;
}

/** Next send slot `gapDays` from now, honouring the Cairo window and weekend. */
export function computeNextSendAtFromNow(gapDays: number): Date {
  return computeNextSendAt(new Date(), gapDays);
}

// ── Enrollment ────────────────────────────────────────────
/**
 * Enrollment statuses that mean "this lead is currently being worked by a
 * sequence". THE single definition — every already-enrolled guard reads it.
 *
 * It exists as one constant because it was previously spelled out inline in
 * three places as just active/paused, and `awaiting_action` (added by the
 * manual-channel work) was missed in all three. A lead parked on a WhatsApp
 * step therefore counted as NOT enrolled, so a bulk enroll from the CRM created
 * a SECOND live enrollment for them — re-opening the duplicate-send hole that
 * once sent 142 leads up to 4 messages each (see autoEnrollIfMatchingCategory).
 *
 * `completed`/`failed`/`replied` are deliberately absent: those are historical,
 * and re-enrolling a lead whose sequence finished is a legitimate action.
 */
export const LIVE_ENROLLMENT_STATUSES = ["active", "paused", "awaiting_action"] as const;

/** Reusable predicate over the constant above, so no caller re-spells the set. */
const isLiveEnrollment = () =>
  inArray(outreachEnrollments.status, [...LIVE_ENROLLMENT_STATUSES]);

export interface EnrollOptions {
  leadId:      string;
  sequenceId:  string;
  enrolledBy?: string | null;
}

export async function enrollLead(opts: EnrollOptions) {
  // Check sequence + first step exist
  const [seq] = await db.select().from(outreachSequences).where(eq(outreachSequences.id, opts.sequenceId)).limit(1);
  if (!seq)              throw new Error("Sequence not found");
  if (!seq.isActive)     throw new Error("Sequence is inactive");

  const steps = await db.select().from(outreachSteps).where(eq(outreachSteps.sequenceId, opts.sequenceId)).orderBy(asc(outreachSteps.position));
  if (steps.length === 0) throw new Error("Sequence has no steps");

  // Dedupe: only block re-enrollment if there is a LIVE enrollment (see
  // LIVE_ENROLLMENT_STATUSES — this must include awaiting_action).
  // Completed/failed/replied enrollments are historical — we allow re-enrolling.
  const [existing] = await db
    .select({ id: outreachEnrollments.id, status: outreachEnrollments.status })
    .from(outreachEnrollments)
    .where(and(
      eq(outreachEnrollments.leadId, opts.leadId),
      eq(outreachEnrollments.sequenceId, opts.sequenceId),
      isLiveEnrollment(),
    ))
    .limit(1);

  if (existing) {
    return { enrollment: { id: existing.id, status: existing.status }, alreadyEnrolled: true };
  }

  // Refuse a lead no channel can reach, rather than creating an enrollment that
  // can only ever fail. channels.ts is the authority on reachability — the same
  // function the Leads page's reachability filter and the worklist routing use,
  // so all three agree about the same lead.
  await assertReachable(opts.leadId);

  const now = new Date();
  const nextSendAt = computeNextSendAt(now, steps[0].dayOffset);

  const [enrollment] = await db
    .insert(outreachEnrollments)
    .values({
      leadId:      opts.leadId,
      sequenceId:  opts.sequenceId,
      currentStep: 0,
      status:      "active",
      enrolledAt:  now,
      nextSendAt,
      enrolledBy:  opts.enrolledBy ?? null,
    })
    .returning();

  return { enrollment, alreadyEnrolled: false };
}

/**
 * Throw unless at least one channel can reach this lead.
 *
 * The design promised this refusal and never implemented it, so a lead with a
 * dead email and no number could be enrolled and then sat in the pipeline
 * looking exactly like one waiting its turn, until the scheduler failed it.
 * Refusing at enrolment puts the reason in front of whoever is enrolling, while
 * they still have the lead on screen.
 */
async function assertReachable(leadId: string): Promise<void> {
  const [lead] = await db
    .select({
      email:          leads.email,
      emailStatus:    leads.emailStatus,
      phoneE164:      leads.phoneE164,
      phoneType:      leads.phoneType,
      whatsappStatus: leads.whatsappStatus,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
    .limit(1);
  if (!lead) throw new Error("Lead not found");

  const reason = unreachableReason({
    ...lead,
    emailSuppressed: lead.email ? await isSuppressedAddress(lead.email) : false,
  });
  if (reason) throw new Error(`Lead cannot be reached on any channel: ${reason}`);
}

/** Channels that require a person. The scheduler raises a task instead of sending. */
const MANUAL_CHANNELS = new Set(["whatsapp", "call"]);

// Max delivery attempts for a single step before we give up and mark the
// enrollment failed. Transient SMTP errors (greylisting, timeouts, rate-limit)
// are retried with a day of backoff between attempts.
const MAX_SEND_ATTEMPTS = 3;

// Classify an SMTP / send error as permanent (don't retry — content or address
// is the problem) vs transient (retry later). Permanent: hard bounces, unknown
// mailbox, and spam rejections (retrying spam-flagged content only burns more
// domain reputation). Everything else (timeouts, 4xx greylisting, network) is
// transient.
/**
 * Is this a problem with OUR infrastructure rather than with the lead?
 *
 * These resolve without anyone touching the enrolment — a topped-up AI
 * balance, a rate-limit window passing, a provider outage ending — so the
 * enrolment must survive them. Anything not matched here is treated as a real
 * failure attributable to this specific lead/send.
 */
function isRecoverableInfraError(msg: string): boolean {
  return /\b(402|429|500|502|503|504)\b|requires more credit|insufficient (credit|funds|quota)|rate.?limit|quota exceeded|timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network|temporarily unavailable|overloaded|all fallback models failed|not configured/i.test(msg);
}


function isPermanentSendError(msg: string): boolean {
  return /\b(550|551|553|554)\b|spam|blocked|black\s?list|no such user|mailbox (unavailable|not found|does not exist)|user unknown|address rejected|recipient (address )?rejected|invalid recipient|relay access denied/i.test(msg);
}

// The provider's own outbound filter refusing us, as distinct from the
// recipient's server rejecting a bad address. Namecheap returns
// "554 5.7.1 ... JFE040023" when it decides a message looks like bulk.
//
// This is the signal that matters most: it means continuing at the current rate
// will make things worse, so the mailbox drops to the recovery cap.
function isSpamRejection(msg: string): boolean {
  return /\b554\b|JFE\d+|spam|blocked|blacklist|reputation|bulk/i.test(msg);
}

/** Bucket a failure so the UI can explain it rather than just reporting "failed". */
function classifyFailure(msg: string): "spam_reject" | "permanent" | "infra" | "transient" {
  if (isSpamRejection(msg))         return "spam_reject";
  if (isPermanentSendError(msg))    return "permanent";
  if (isRecoverableInfraError(msg)) return "infra";
  return "transient";
}

/**
 * Whole clean weeks since the mailbox last changed stage, which is what the
 * warmup ramp is paid out against. Missing timestamp means "just started".
 *
 * Exported so the deliverability panel (routes/outreach.ts) can compute the
 * SAME cap the scheduler actually enforces, instead of hardcoding cleanWeeks
 * to 0 and showing a number that disagrees with reality.
 */
export function cleanWeeksFor(mailbox: typeof mailboxes.$inferSelect | undefined): number {
  if (!mailbox?.updatedAt) return 0;
  const ms = Date.now() - new Date(mailbox.updatedAt).getTime();
  return Math.max(0, Math.floor(ms / (7 * 86_400_000)));
}

async function isSuppressedAddress(address: string): Promise<boolean> {
  return (await suppressedSet([address])).size > 0;
}

// ── Scheduler tick: find due enrollments, send next step ──
//
// Guards against overlapping ticks. The spread delay below can make a single
// tick take far longer than "a release of 5 at the max 240s gap" (~16 min) —
// that figure is only true for the recovery-stage cap. releaseCountNow spreads
// the day's allowance pro-rata across the send window, but its budget reaches
// the full cap on the last tick inside that window, so one release can still be
// the whole remaining allowance. The worst case is bounded, and bounded by
// exactly one number: effectiveDailyCap clamps the stage default AND any stored
// mailboxes.daily_cap override to ACTIVE_CEILING (40), so the longest possible
// batch is ~2.6 hours (39 gaps x up to 240s). A network-writable override
// cannot make it longer than that — but 2.6 hours easily outlives
// the 5-minute sweep interval — if the next setInterval firing started a
// second tick while the first was still mid-flight, both could select the
// SAME due enrollment before either had updated its nextSendAt/status,
// causing an actual duplicate send. A simple in-process mutex is the more
// direct fix for that (a delay-budget cap only bounds the sleep portion, not
// real DB/SMTP time, and doesn't stop two ticks from starting) and is simpler
// to reason about than a partial-budget scheme. It is the mutex, not a bound
// on batch length, that stops a second tick from starting at all — what now
// actually bounds how long a single batch can run is the per-iteration Cairo
// window re-check inside the send loop below (isWithinSendWindow), which was
// previously checked only once, at the top of the tick.
let tickInFlight = false;

export async function processDueSends(limit = 20): Promise<{ processed: number; sent: number; failed: number; throttled: number }> {
  if (tickInFlight) {
    console.warn("[outreach] tick already in flight — skipping this interval");
    return { processed: 0, sent: 0, failed: 0, throttled: 0 };
  }
  tickInFlight = true;
  try {
    return await runOneTick(limit);
  } finally {
    tickInFlight = false;
  }
}

async function runOneTick(limit: number): Promise<{ processed: number; sent: number; failed: number; throttled: number }> {
  const now = new Date();

  // ── Volume gate ───────────────────────────────────────
  // Outside the Cairo send window, or over today's cap, nothing goes out. This
  // replaces the previous behaviour of releasing every due enrollment at once.
  // Cheap pure check first so an out-of-window tick never touches the DB.
  if (!isWithinSendWindow(now)) {
    return { processed: 0, sent: 0, failed: 0, throttled: 0 };
  }

  // The mailbox we are actually sending FROM, looked up by address — never
  // `LIMIT 1` with no ORDER BY, which read an arbitrary row and could enforce
  // a different mailbox's cap than the panel displayed. See services/mailbox.ts.
  const mailbox    = await loadSendingMailbox();
  const stage      = (mailbox?.warmupStage ?? "recovery") as WarmupStage;
  const storedCap  = mailbox?.dailyCap ?? 0;
  const cleanWeeks = cleanWeeksFor(mailbox);

  // Authoritative count: derived from the sends table for the current Cairo
  // day, never from a stored counter — a counter drifts across restarts and
  // double-sends, and this number decides whether we breach the cap.
  const [{ sentTodayCount }] = await db
    .select({ sentTodayCount: sql<number>`COUNT(*)::int` })
    .from(outreachSends)
    .where(and(
      eq(outreachSends.status, "sent"),
      sql`(${outreachSends.sentAt} AT TIME ZONE 'Africa/Cairo')::date
          = (NOW() AT TIME ZONE 'Africa/Cairo')::date`,
    ));

  // The whole cap+window release decision is one pure, unit-tested function
  // (sending-policy.ts) — see releaseCountNow's own tests for the
  // outside-window-zero and over-cap-zero paths in isolation.
  const release = releaseCountNow({
    stage, storedCap, cleanWeeks,
    sentToday: Number(sentTodayCount),
    now,
  });
  if (release === 0) {
    return { processed: 0, sent: 0, failed: 0, throttled: 1 };
  }

  const due = await db
    .select()
    .from(outreachEnrollments)
    .where(and(
      eq(outreachEnrollments.status, "active"),
      lte(outreachEnrollments.nextSendAt, now),
    ))
    .limit(Math.min(limit, release));

  let sent = 0;
  let failed = 0;
  let throttled = 0;
  // Number of `due` entries actually attempted (reached the try/catch below),
  // as opposed to due.length, which also counts entries left untouched by an
  // early window-close break. The caller must not be told work happened that
  // didn't.
  let attempted = 0;

  for (let i = 0; i < due.length; i++) {
    // Re-check the Cairo window on EVERY iteration, not just once at the top
    // of the tick. releaseCountNow's budget reaches the full cap on the last
    // tick inside the window, so it can still hand back the whole day's
    // remaining allowance in one release (up to ACTIVE_CEILING, which is what
    // effectiveDailyCap clamps every cap and override to), and the spread delay
    // below can stretch that release across hours of real time — long enough to
    // run well past 17:00 Cairo if this were only checked once. Being clamped is
    // not the same as being short: 40 sends at up to 240s apart is ~2.6 hours.
    // The moment the window closes, stop and leave
    // everything still in `due` exactly as it is: their nextSendAt is still
    // legitimately in the past, so tomorrow's tick will pick them up again —
    // this is throttling, not failure, and must not touch their rows.
    if (!isWithinSendWindow(new Date())) {
      const remaining = due.length - i;
      console.warn(
        `[outreach] send window closed mid-batch — stopping with ${remaining} ` +
        `enrollment(s) left untouched for the next tick`,
      );
      throttled += remaining;
      break;
    }

    const enrollment = due[i];
    attempted++;
    // Set by processSingleSend only when it actually reaches sendOutreachEmail
    // — never for a skipped non-email step, a suppressed address, a
    // config-hold, or a lead with no email. The spread delay below exists
    // only to space out real SMTP transmissions, so it must key off this,
    // not off "an enrollment was processed."
    const attempt = { smtpAttempted: false };
    try {
      const outcome = await processSingleSend(enrollment, attempt);
      if (outcome === "failed") failed++;
      else if (outcome === "awaiting_action") throttled++;   // handed to a human, not sent
      else sent++;   // "sent", "advanced" (non-email skip), "completed", "retry" all count as handled
    } catch (err: any) {
      // Backstop for errors thrown BEFORE the send — most often the AI step
      // (runAgent) rather than SMTP, since send failures are handled inside
      // processSingleSend.
      const msg = String(err?.message ?? err);

      // Infrastructure problems are NOT the lead's fault and DO fix themselves:
      // an OpenRouter 402 clears the moment credit is topped up, a 429/5xx
      // clears on its own. Previously these were marked permanently failed —
      // 31 enrolments died purely because the AI account ran out of credit,
      // and no amount of topping up would have revived them. Pause instead, so
      // a human can resume, and retry on a backoff in the meantime.
      if (isRecoverableInfraError(msg)) {
        await db
          .update(outreachEnrollments)
          .set({
            status:       "paused",
            pausedReason: `Paused — service issue, will retry: ${msg}`.slice(0, 500),
            nextSendAt:   computeNextSendAt(new Date(), 1),
          })
          .where(eq(outreachEnrollments.id, enrollment.id));
        console.warn(`[outreach] paused enrollment ${enrollment.id} on recoverable error: ${msg.slice(0, 120)}`);
        continue;   // not counted as a failure — nothing is wrong with this lead
      }

      failed++;
      await db
        .update(outreachEnrollments)
        .set({ status: "failed", pausedReason: msg.slice(0, 500), nextSendAt: null })
        .where(eq(outreachEnrollments.id, enrollment.id));
    }

    // Spread real SMTP sends within this batch. Never delays before the first
    // send (nothing has been sent yet) or after the last one (nothing left to
    // space out from) — only between two actual transmissions, which is
    // exactly the "5 emails leaving one mailbox in seconds" shape that drew
    // the original 30 provider rejections.
    if (attempt.smtpAttempted && i < due.length - 1) {
      const gapSeconds = spreadGapSeconds();
      console.log(`[outreach] spreading next send by ${gapSeconds}s (batch ${i + 1}/${due.length})`);
      await sleepUntil(nextSpreadSlot(new Date(), gapSeconds));
    }
  }

  return { processed: attempted, sent, failed, throttled };
}

// Record a failed send + decide whether to retry (transient) or give up
// (permanent / exhausted attempts). NEVER bursts: a retry is always scheduled
// at least a day out via computeNextSendAt.
async function handleSendFailure(
  enrollment: typeof outreachEnrollments.$inferSelect,
  step: typeof outreachSteps.$inferSelect,
  err: any,
  // The mailbox that actually sent this message — scopes the spam-reject
  // downgrade below to that one row. Without this, an unqualified UPDATE
  // drops EVERY mailbox to recovery the moment a second one exists, which is
  // wrong the instant this is no longer a single-mailbox system.
  mailboxAddress: string,
): Promise<"retry" | "failed"> {
  const msg = String(err?.message ?? err);
  const kind = classifyFailure(msg);

  // Always log the failure to the sends table so it's visible in analytics.
  await db.insert(outreachSends).values({
    enrollmentId: enrollment.id,
    stepId:       step.id,
    channel:      "email",
    subject:      null,
    body:         null,
    status:       "failed",
    error:        msg.slice(0, 1000),
    failureKind:  kind,
  });

  // The provider is refusing us. Continuing at this rate makes it worse, so
  // drop THIS mailbox to the recovery cap and suppress the address that drew it.
  if (kind === "spam_reject") {
    const downgrade = await db.update(mailboxes)
      .set({ warmupStage: nextStageAfterSpamReject(), updatedAt: new Date() })
      .where(eq(mailboxes.address, mailboxAddress));
    // rowCount is 0 (or null) when no mailbox row matched mailboxAddress — a
    // boot-seed race, or EMAIL_FROM changed between deploys without the row
    // being updated to match. Silently doing nothing here means the safety
    // downgrade never happens and sending keeps going at the rate that just
    // drew a spam rejection, with no trace of why.
    if (!downgrade.rowCount) {
      console.error(
        `[outreach] safety downgrade found no mailbox row for address "${mailboxAddress}" ` +
        `— warmup stage was NOT changed. Check the mailboxes table / EMAIL_FROM.`,
      );
    }
    const [rejectedLead] = await db
      .select({ email: leads.email })
      .from(leads)
      .where(eq(leads.id, enrollment.leadId))
      .limit(1);
    if (rejectedLead?.email) {
      await suppress({
        address: rejectedLead.email, reason: "spam_reject",
        source: "scheduler", notes: msg.slice(0, 400),
      });
    }
  }

  // Count failed attempts for THIS step (includes the row just inserted).
  const [{ failures }] = await db
    .select({ failures: sql<number>`COUNT(*)::int` })
    .from(outreachSends)
    .where(and(
      eq(outreachSends.enrollmentId, enrollment.id),
      eq(outreachSends.stepId, step.id),
      eq(outreachSends.status, "failed"),
    ));
  const attempts = Number(failures);

  const permanent = isPermanentSendError(msg);

  if (permanent || attempts >= MAX_SEND_ATTEMPTS) {
    await db.update(outreachEnrollments)
      .set({
        status:       "failed",
        pausedReason: `${permanent ? "Permanent failure" : `Failed after ${attempts} attempts`}: ${msg}`.slice(0, 500),
        nextSendAt:   null,
      })
      .where(eq(outreachEnrollments.id, enrollment.id));
    return "failed";
  }

  // Transient → retry. Back off one extra day per prior attempt, snapped to
  // noon Cairo & skipping the weekend (computeNextSendAt handles both).
  const backoffDays = attempts;   // 1st retry → +1 day, 2nd → +2 days
  await db.update(outreachEnrollments)
    .set({
      nextSendAt:   computeNextSendAt(new Date(), backoffDays),
      pausedReason: `Retry ${attempts}/${MAX_SEND_ATTEMPTS}: ${msg}`.slice(0, 500),
    })
    .where(eq(outreachEnrollments.id, enrollment.id));
  return "retry";
}

type SendOutcome = "sent" | "advanced" | "completed" | "retry" | "failed" | "awaiting_action";

// Pause an enrollment because of a fixable configuration problem (e.g. step
// wired to a non-email agent, or no body). Distinct from a send failure: this
// is recoverable — fix the step, then resume the enrollment.
async function holdForConfig(enrollment: typeof outreachEnrollments.$inferSelect, reason: string) {
  await db.update(outreachEnrollments)
    .set({ status: "paused", pausedReason: reason.slice(0, 500), nextSendAt: null })
    .where(eq(outreachEnrollments.id, enrollment.id));
  console.warn(`[outreach] enrollment ${enrollment.id} held: ${reason}`);
}

async function processSingleSend(
  enrollment: typeof outreachEnrollments.$inferSelect,
  // Set to true only once we actually reach sendOutreachEmail, so the caller's
  // batch-spread delay can key off "a real SMTP send happened" rather than
  // "an enrollment was processed" (which also covers skips/holds/suppression).
  attempt?: { smtpAttempted: boolean },
): Promise<SendOutcome> {
  // Get lead and step
  const [lead] = await db.select().from(leads).where(eq(leads.id, enrollment.leadId)).limit(1);
  if (!lead) throw new Error("Lead vanished");   // pre-send, genuinely unexpected → backstop marks failed

  // NOTE ON GUARD ORDER: the "lead has no email" check does NOT belong here,
  // before the step is known. It used to, and it meant a phone-only lead
  // enrolled in a WhatsApp sequence died on step 1 with the reason "Lead has no
  // email address" — a step that was never going to send an email in the first
  // place. Roughly 102 production leads are phone-only, and phone coverage
  // (575) exceeds email coverage (517), so this defeated the entire point of
  // the manual channels. It now lives below, after the channel is known, and
  // fires only for an email step.

  // If lead has reached closed_won/closed_lost, finish enrollment
  if (lead.stage === "closed_won" || lead.stage === "closed_lost") {
    await db.update(outreachEnrollments)
      .set({ status: "completed", completedAt: new Date(), nextSendAt: null })
      .where(eq(outreachEnrollments.id, enrollment.id));
    return "completed";
  }

  const steps = await db
    .select()
    .from(outreachSteps)
    .where(eq(outreachSteps.sequenceId, enrollment.sequenceId))
    .orderBy(asc(outreachSteps.position));

  const step = steps[enrollment.currentStep];
  if (!step) {
    // No more steps — mark complete
    await db.update(outreachEnrollments)
      .set({ status: "completed", completedAt: new Date(), nextSendAt: null })
      .where(eq(outreachEnrollments.id, enrollment.id));
    return "completed";
  }

  // Manual channels do not send. They raise a task and STOP.
  //
  // Previously any non-email step was silently advanced past, so a sequence
  // containing a LinkedIn or note step quietly skipped it — the cadence the
  // author designed was not the cadence that ran. A manual step now blocks:
  // the next step does not fire until a human records an outcome.
  if (MANUAL_CHANNELS.has(step.channel)) {
    await db.update(outreachEnrollments)
      .set({
        status:       "awaiting_action",
        pausedReason: `Waiting on a human: ${step.channel} step (day ${step.dayOffset})`,
        nextSendAt:   null,
      })
      .where(eq(outreachEnrollments.id, enrollment.id));
    return "awaiting_action";
  }

  // note/linkedin keep their historical behaviour of advancing automatically,
  // because existing sequences rely on it and changing that silently would
  // alter live cadences.
  if (step.channel !== "email") {
    await advanceStep(enrollment, steps);
    return "advanced";
  }

  // From here down the step is definitely an email step, so an absent address
  // really is fatal for it. Mark failed with a clear, non-retryable reason
  // (don't throw, so it doesn't look like a transient crash). Deliberately
  // placed AFTER the manual-channel and non-email branches above and BEFORE the
  // suppression check below, which needs a non-null address.
  if (!lead.email) {
    await db.update(outreachEnrollments)
      .set({ status: "failed", pausedReason: "Lead has no email address", nextSendAt: null })
      .where(eq(outreachEnrollments.id, enrollment.id));
    return "failed";
  }

  // Never send to a suppressed address. Checked here rather than only at
  // enrolment because an address can be suppressed mid-sequence by a bounce.
  if (await isSuppressedAddress(lead.email)) {
    await db.insert(outreachSends).values({
      enrollmentId: enrollment.id,
      stepId:       step.id,
      channel:      "email",
      status:       "failed",
      error:        "Address is on the suppression list",
      failureKind:  "suppressed",
    });
    await db.update(outreachEnrollments)
      .set({ status: "failed", pausedReason: "Address suppressed", nextSendAt: null })
      .where(eq(outreachEnrollments.id, enrollment.id));
    return "failed";
  }

  const vars = buildLeadVars(lead);

  // GUARD: if this email step has an agent that is NOT email-capable (a brief /
  // enrichment / proposal writer), DO NOT send its output — that would email an
  // internal research document to the prospect. Pause the enrollment so it can
  // be resumed once the step is repointed to an email-writing agent.
  if (step.agentId && !isEmailCapableAgent(step.agentId)) {
    await holdForConfig(
      enrollment,
      `Step ${enrollment.currentStep + 1} uses non-email agent "${step.agentId}". Assign the Outreach Drafter (or a body template).`,
    );
    return "failed";
  }

  // Resolve subject + body. If an agent is set, it produces both; otherwise we use templates.
  const fallbackSubject = renderTemplate(step.subjectTemplate ?? "Following up — {{company}}", vars);
  let subject: string;
  let body:    string;

  if (step.agentId) {
    const run = await runAgent({ agentId: step.agentId, contextId: lead.id, userId: null });
    const parsed = parseSubjectAndBody(run.output);
    subject = parsed.subject ?? fallbackSubject;
    body    = parsed.body   || renderTemplate(step.bodyTemplate ?? "", vars);
  } else {
    subject = fallbackSubject;
    body    = renderTemplate(step.bodyTemplate ?? "", vars);
  }

  // Our SMTP provider (Namecheap Private Email) hard-rejects a subject line
  // that ends in "?" with `554 5.7.1 ... Reason: JFE040023`. The mail is never
  // delivered and, before this, the enrolment was marked permanently failed.
  // Cold-email subjects are very often questions, so this is not an edge case:
  // 15 of 871 sends hit it. The agent prompt now forbids it too, but a prompt
  // is a request — this is the guarantee.
  subject = sanitizeSubject(subject);

  // GUARD: never send an empty / placeholder body. This catches steps that have
  // neither an agent nor a real body template (which previously sent the literal
  // text "(no body template)" or an empty email).
  const cleanBody = (body ?? "").trim();
  if (cleanBody.length < 10) {
    await holdForConfig(
      enrollment,
      `Step ${enrollment.currentStep + 1} produced an empty body. Add the Outreach Drafter agent or a body template.`,
    );
    return "failed";
  }

  // Resolve sender signature: prefer lead.assignee's signature, fall back to default
  let signatureHtml: string;
  let signatureText: string;
  let fromName: string | undefined;
  if (lead.assigneeId) {
    const [assignee] = await db
      .select({ name: profiles.name, title: profiles.title, email: profiles.email, phone: profiles.phone, signature: profiles.signature })
      .from(profiles)
      .where(eq(profiles.id, lead.assigneeId))
      .limit(1);
    if (assignee) {
      fromName = assignee.name;
      const hasCustom = !!assignee.signature?.trim();
      signatureHtml = hasCustom
        ? assignee.signature!.trim()
        : buildDefaultSignature({ name: assignee.name, title: assignee.title, email: assignee.email, phone: assignee.phone });
      signatureText = buildDefaultSignatureText({ email: assignee.email, phone: assignee.phone });
    } else {
      signatureHtml = buildDefaultSignature({});
      signatureText = buildDefaultSignatureText({});
    }
  } else {
    signatureHtml = buildDefaultSignature({});
    signatureText = buildDefaultSignatureText({});
  }

  // The mailbox identity a spam-reject downgrade must be scoped to. Canonical
  // (lowercased) form, because that is how the row is keyed — using
  // process.env.EMAIL_FROM verbatim, as this did, pointed the downgrade at
  // "Team@seekersai.org" while the scheduler read "team@seekersai.org", so the
  // safety downgrade silently updated 0 rows.
  const fromAddress = configuredSenderAddress();

  // Send. A failure here is caught and routed to the retry/permanent-fail
  // handler — it must NOT bubble up and permanently kill the enrollment, and
  // it must NOT advance the step (so we don't skip a touch on a transient error).
  let result;
  if (attempt) attempt.smtpAttempted = true;   // reaching here IS the SMTP attempt, success or not
  try {
    result = await sendOutreachEmail({ to: lead.email, subject, body, fromName, signatureHtml, signatureText });
  } catch (sendErr) {
    return await handleSendFailure(enrollment, step, sendErr, fromAddress);
  }

  // nodemailer can also report a soft rejection without throwing (recipient in
  // the `rejected` array). Treat that the same as a thrown send failure.
  if (result.rejected && result.rejected.length > 0 && (!result.accepted || result.accepted.length === 0)) {
    return await handleSendFailure(enrollment, step, new Error(`Recipient rejected: ${result.rejected.join(", ")}`), fromAddress);
  }

  // Fire webhook for outreach.sent
  fireEventAsync("outreach.sent", {
    lead_id:      lead.id,
    lead_name:    lead.name,
    lead_company: lead.company,
    lead_email:   lead.email,
    sequence_id:  enrollment.sequenceId,
    step_index:   enrollment.currentStep,
    subject,
    sent_at:      new Date().toISOString(),
  });

  // Persist send
  await db.insert(outreachSends).values({
    enrollmentId: enrollment.id,
    stepId:       step.id,
    channel:      "email",
    subject,
    body,
    status:       "sent",
    messageId:    result.messageId,
  });

  // Log to lead activity timeline
  await db.insert(leadActivities).values({
    leadId:      lead.id,
    type:        "email",
    description: `[Sequence] ${subject}\n\n${body}`.slice(0, 4000),
  });

  // Update lead.lastActivity
  await db.update(leads)
    .set({ lastActivity: cairoToday(), updatedAt: new Date() })
    .where(eq(leads.id, lead.id));

  await advanceStep(enrollment, steps);
  return "sent";
}

async function advanceStep(
  enrollment: typeof outreachEnrollments.$inferSelect,
  steps: (typeof outreachSteps.$inferSelect)[],
) {
  const nextStepIdx = enrollment.currentStep + 1;
  if (nextStepIdx >= steps.length) {
    await db.update(outreachEnrollments)
      .set({
        status:               "completed",
        currentStep:          nextStepIdx,
        lastStepCompletedAt:  new Date(),
        completedAt:          new Date(),
        nextSendAt:           null,
      })
      .where(eq(outreachEnrollments.id, enrollment.id));
  } else {
    const prevStep = steps[enrollment.currentStep];
    const nextStep = steps[nextStepIdx];

    // CRITICAL: anchor the next send to NOW + the *interval* between this step
    // and the next, NOT to enrolledAt + nextStep.dayOffset.
    //
    // The old enrolledAt-relative formula meant any behind-schedule enrollment
    // (paused & resumed, or enrolled days ago) would have every overdue step's
    // nextSendAt already in the past — so the scheduler fired step 2, 3, 4…
    // back-to-back on consecutive 5-min ticks. That's a spam cannon: e.g. a
    // lead enrolled 13 days ago with steps at day 0/3/7 would receive all
    // three emails within ~15 minutes of resume.
    //
    // By anchoring to (now + gap) we preserve the INTENDED spacing between
    // touches no matter how late we are. gap is clamped to >= 1 day so two
    // steps can never fire on the same scheduler tick even if misconfigured
    // with identical day offsets.
    const gapDays = Math.max(1, (nextStep.dayOffset ?? 0) - (prevStep?.dayOffset ?? 0));

    await db.update(outreachEnrollments)
      .set({
        currentStep:          nextStepIdx,
        lastStepCompletedAt:  new Date(),
        nextSendAt:           computeNextSendAt(new Date(), gapDays),
      })
      .where(eq(outreachEnrollments.id, enrollment.id));
  }
}

// ── Handle a detected reply from a lead ──────────────────
// Triggered by webhook from n8n (IMAP/Gmail) or Brevo inbound parsing.
// Looks up the lead by email and pauses all active enrollments for them.
export async function handleReply(opts: {
  fromEmail:    string;
  subject?:     string | null;
  bodyPreview?: string | null;
}) {
  const emailLower = opts.fromEmail.toLowerCase().trim();
  if (!emailLower) throw new Error("from_email required");

  // Find lead by email (case-insensitive)
  const [lead] = await db
    .select()
    .from(leads)
    .where(sql`LOWER(${leads.email}) = ${emailLower}`)
    .limit(1);

  if (!lead) {
    return { matched: false, leadId: null, pausedCount: 0 };
  }

  // Stop every LIVE enrollment for this lead — including awaiting_action.
  //
  // awaiting_action was missing here, and its absence was not cosmetic: a lead
  // blocked on a WhatsApp step who then replied BY EMAIL kept a live
  // awaiting_action enrollment. The database went on saying "a human must send
  // this WhatsApp message" to a lead who had already answered, and the only
  // screen that can clear that state (the Today queue's manual-touch card) was
  // hidden by the ranker's per-lead dedupe, because reply_waiting outscores
  // manual_touch. The enrollment became permanently unresolvable. A reply
  // resolves the enrollment however it arrives.
  const updated = await db
    .update(outreachEnrollments)
    .set({
      status:       "replied",
      pausedReason: "Reply received",
      completedAt:  new Date(),
      nextSendAt:   null,
    })
    .where(and(
      eq(outreachEnrollments.leadId, lead.id),
      isLiveEnrollment(),
    ))
    .returning({ id: outreachEnrollments.id });

  // Add a reply activity to the lead timeline
  const preview = (opts.bodyPreview ?? "").slice(0, 500).trim();
  await db.insert(leadActivities).values({
    leadId:      lead.id,
    type:        "email",
    description: `[Reply received]${opts.subject ? ` ${opts.subject}` : ""}${preview ? `\n\n${preview}` : ""}`.slice(0, 4000),
  });

  // Move stage forward if still in early stages
  const earlyStages = ["new_lead", "contacted"];
  if (earlyStages.includes(lead.stage)) {
    await db.update(leads)
      .set({
        stage:        "contacted",
        lastActivity: cairoToday(),
        updatedAt:    new Date(),
      })
      .where(eq(leads.id, lead.id));
  } else {
    await db.update(leads)
      .set({ lastActivity: cairoToday(), updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
  }

  // Fire lead.replied event for any subscribed webhook (Slack, WhatsApp, etc.)
  fireEventAsync("lead.replied", {
    lead_id:      lead.id,
    lead_name:    lead.name,
    lead_company: lead.company,
    lead_email:   lead.email,
    subject:      opts.subject,
    body_preview: opts.bodyPreview,
    paused_count: updated.length,
  });

  return { matched: true, leadId: lead.id, pausedCount: updated.length };
}

// ── Auto-enroll a freshly created lead ────────────────────
// Combines two auto-enroll behaviours:
//   1. Sequences marked autoEnrollAll → enroll EVERY new lead regardless of category.
//   2. Sequences marked autoEnrollOnCategory with matching category → enroll only matches.
// enrollLead() is dedup-safe so a lead can never be double-enrolled in the same sequence.
/**
 * Every sequence that could auto-enrol something, fetched once.
 *
 * Bulk ingest calls autoEnrollIfMatchingCategory per lead, and each call used
 * to re-run this query — 500 identical round trips for one CSV import. The
 * candidate set cannot change during a single request, so callers processing a
 * batch fetch it once and pass it in.
 */
export async function getAutoEnrollCandidates() {
  return db
    .select()
    .from(outreachSequences)
    .where(and(
      eq(outreachSequences.isActive, true),
      or(
        eq(outreachSequences.autoEnrollAll, true),
        eq(outreachSequences.autoEnrollOnCategory, true),
      )!,
    ));
}

type AutoEnrollCandidate = Awaited<ReturnType<typeof getAutoEnrollCandidates>>[number];

export async function autoEnrollIfMatchingCategory(
  leadId: string,
  category: string | null,
  /** Pre-fetched candidates, for batch callers. Omit to query per call. */
  candidates?: AutoEnrollCandidate[],
) {
  // Same predicate as the query below, applied in memory when the caller has
  // already fetched the candidate set.
  const matches = candidates
    ? candidates.filter((s) =>
        s.autoEnrollAll ||
        (s.autoEnrollOnCategory && !!category && s.category === category))
    : await db
        .select()
        .from(outreachSequences)
        .where(and(
          eq(outreachSequences.isActive, true),
          or(
            eq(outreachSequences.autoEnrollAll, true),
            category
              ? and(eq(outreachSequences.autoEnrollOnCategory, true), eq(outreachSequences.category, category))
              : sql`false`,
          )!,
        ));

  if (matches.length === 0) return;

  // ONE auto-enrolment per lead, ever.
  //
  // Two sequences were both flagged autoEnrollAll, so every new lead was
  // enrolled in both and received two independent streams of email — 142 leads
  // got up to 4 messages. Nothing in the sequencer could catch it, because each
  // enrolment is individually valid; the duplication is across sequences.
  //
  // A category-matched sequence is more specific than a catch-all, so it wins;
  // otherwise take the oldest, which is the stable choice across re-runs.
  const ranked = [...matches].sort((a, b) => {
    const aSpecific = a.autoEnrollOnCategory && a.category === category ? 0 : 1;
    const bSpecific = b.autoEnrollOnCategory && b.category === category ? 0 : 1;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  const chosen = ranked[0];

  if (matches.length > 1) {
    console.warn(
      `[outreach] ${matches.length} sequences want to auto-enrol lead ${leadId}; ` +
      `using "${chosen.name}" only. Turn off auto-enrol on the others.`,
    );
  }

  // Belt and braces: never add a second LIVE enrolment for this lead, even in a
  // different sequence. enrollLead() only de-dupes within one sequence.
  // LIVE_ENROLLMENT_STATUSES includes awaiting_action — spelled out inline as
  // active/paused, this guard treated a lead parked on a manual step as "not
  // enrolled" and cheerfully started a second stream of messages to them.
  const [live] = await db
    .select({ id: outreachEnrollments.id })
    .from(outreachEnrollments)
    .where(and(
      eq(outreachEnrollments.leadId, leadId),
      isLiveEnrollment(),
    ))
    .limit(1);
  if (live) return;

  try { await enrollLead({ leadId, sequenceId: chosen.id }); }
  catch { /* swallow — won't kill ingestion */ }
}
