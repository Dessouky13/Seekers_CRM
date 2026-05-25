// Webhook outbound: fires events to user-configured external URLs.
// Fire-and-forget (no retry queue); logs every delivery to webhook_deliveries
// for debugging. Subscriptions are filtered by exact event name; "*" wildcard
// subscribes to everything (useful for n8n catch-alls / audit pipes).
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { webhookSubscriptions, webhookDeliveries } from "../db/schema";

// Canonical list of event types. Keep in sync with frontend selector.
export const WEBHOOK_EVENTS = [
  "lead.created",
  "lead.stage_changed",
  "lead.replied",
  "lead.assigned",
  "enrollment.started",
  "enrollment.paused",
  "enrollment.completed",
  "outreach.sent",
  "task.created",
  "task.completed",
  "task.assigned",
  "client.created",
  "client.stage_changed",
  "agent.run_completed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "*";

export async function fireEvent(event: Exclude<WebhookEvent, "*">, payload: Record<string, unknown>) {
  // Find active subscriptions matching this event OR the "*" wildcard
  const subs = await db
    .select()
    .from(webhookSubscriptions)
    .where(and(
      eq(webhookSubscriptions.isActive, true),
      inArray(webhookSubscriptions.event, [event, "*"]),
    ));

  if (subs.length === 0) return { delivered: 0 };

  const enriched = {
    event,
    timestamp: new Date().toISOString(),
    data:      payload,
  };
  const body = JSON.stringify(enriched);

  // Fire them all in parallel — fire-and-forget at the caller level, but we
  // await here so the delivery log is consistent if the caller wants to see it
  await Promise.allSettled(subs.map(async (sub) => {
    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let error:        string | null = null;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent":   "SeekersCRM-Webhook/1.0",
      };
      if (sub.secret) headers["X-Webhook-Secret"] = sub.secret;

      const res = await fetch(sub.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(8000),
      });
      statusCode  = res.status;
      responseBody = (await res.text().catch(() => "")).slice(0, 2000);
    } catch (err: any) {
      error = String(err?.message ?? err).slice(0, 500);
    }

    try {
      await db.insert(webhookDeliveries).values({
        subscriptionId: sub.id,
        event,
        url:            sub.url,
        payload:        body.slice(0, 8000),
        statusCode,
        responseBody,
        error,
      });
    } catch (logErr) {
      console.warn("[webhooks] failed to log delivery:", logErr);
    }
  }));

  return { delivered: subs.length };
}

// Convenience: fire without blocking the caller. Errors are swallowed.
export function fireEventAsync(event: Exclude<WebhookEvent, "*">, payload: Record<string, unknown>) {
  fireEvent(event, payload).catch((err) =>
    console.warn(`[webhooks] fire ${event} failed:`, err?.message ?? err),
  );
}
