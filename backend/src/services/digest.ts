// Daily Loop push — turns the worklist into outbound events.
//
// The CRM decides, n8n executes: we fire `worklist.digest` / `supply.starving`
// onto the existing webhook bus and n8n delivers them over WhatsApp. Nothing
// here knows what WhatsApp is, which keeps the "one sender" rule intact.
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { profiles } from "../db/schema";
import { getWorklist } from "./worklist";
import { fireEvent } from "./webhooks";
import { cairoDate, CAIRO_TZ } from "../utils/dates";

/** Cairo-local hour, so "09:00 digest" means 09:00 for the team, not UTC. */
const TZ = process.env.DIGEST_TZ ?? CAIRO_TZ;

export function localHour(now: Date, tz = TZ): number {
  return Number(now.toLocaleString("en-US", { timeZone: tz, hour: "2-digit", hour12: false }));
}

/**
 * YYYY-MM-DD in the digest timezone. This file got the timezone right before the
 * rest of the codebase did; the implementation now lives in `utils/dates` so
 * there is exactly one of it, and this stays as the TZ-overridable seam the
 * digest scheduler needs.
 */
export function localDate(now: Date, tz = TZ): string {
  return cairoDate(now, tz);
}

/**
 * Build one person's digest payload. Exported for testing and so the shape is
 * documented in one place — n8n templates read these exact keys.
 */
export function buildDigestPayload(
  user: { id: string; name: string; phone: string | null },
  actions: Awaited<ReturnType<typeof getWorklist>>,
) {
  const top = actions.slice(0, 5);
  return {
    user_id:    user.id,
    user_name:  user.name,
    user_phone: user.phone,
    total:      actions.length,
    urgent:     actions.filter((a) => a.urgency === "now").length,
    // Pre-rendered so every channel says the same sentence.
    summary: actions.length === 0
      ? `Nothing waiting — you're clear.`
      : `${actions.length} thing${actions.length === 1 ? "" : "s"} need you today` +
        (top[0] ? `. Start with ${top[0].title} — ${top[0].reason.toLowerCase()}.` : "."),
    items: top.map((a) => ({
      type: a.type, urgency: a.urgency, title: a.title,
      subtitle: a.subtitle, reason: a.reason, link: a.deepLink,
    })),
  };
}

/**
 * Fire one digest per active person. Skips anyone with an empty queue — a
 * "you have nothing to do" WhatsApp every morning is how people mute a bot.
 */
export async function sendDailyDigests(): Promise<{ sent: number; skipped: number }> {
  const people = await db
    .select({ id: profiles.id, name: profiles.name, role: profiles.role, phone: profiles.phone })
    .from(profiles);

  let sent = 0, skipped = 0;
  for (const person of people) {
    try {
      const actions = await getWorklist(person);
      if (actions.length === 0) { skipped++; continue; }
      await fireEvent("worklist.digest", buildDigestPayload(person, actions));
      sent++;
    } catch (err) {
      // One broken account must never stop the rest of the team's digest.
      console.error(`[digest] failed for ${person.id}:`, (err as Error).message);
      skipped++;
    }
  }
  return { sent, skipped };
}

/**
 * Runs on a timer but only actually fires once per local day, at the configured
 * hour. Guarded in-memory: a restart mid-morning could re-send, which is why
 * the guard also records the date rather than a simple boolean.
 */
let lastDigestDate: string | null = null;

export async function maybeSendDailyDigest(now = new Date()): Promise<boolean> {
  const hour = Number(process.env.DIGEST_HOUR ?? 9);
  const today = localDate(now);
  if (lastDigestDate === today) return false;
  if (localHour(now) < hour)    return false;

  lastDigestDate = today;
  const result = await sendDailyDigests();
  console.log(`[digest] sent=${result.sent} skipped=${result.skipped}`);
  return true;
}

/** Test seam — lets a test reset the once-per-day guard. */
export function __resetDigestGuard() { lastDigestDate = null; }
