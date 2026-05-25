// Webhook subscription CRUD + delivery log + test endpoint.
import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client";
import { webhookSubscriptions, webhookDeliveries } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { WEBHOOK_EVENTS, fireEvent } from "../services/webhooks";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();

// GET /webhooks — list all subscriptions
router.get("/", authMiddleware, async (c) => {
  const subs = await db.select().from(webhookSubscriptions).orderBy(desc(webhookSubscriptions.createdAt));
  return c.json(subs);
});

// GET /webhooks/events — list available event types
router.get("/events", authMiddleware, (c) => c.json(WEBHOOK_EVENTS));

// POST /webhooks — create
const createSchema = z.object({
  name:      z.string().min(1).max(120),
  event:     z.string().min(1),
  url:       z.string().url(),
  secret:    z.string().max(200).optional().nullable(),
  is_active: z.boolean().optional(),
});

router.post("/", authMiddleware, adminOnly, async (c) => {
  const user = c.get("user");
  const body = createSchema.parse(await c.req.json());

  // Validate event is in allowed list (or wildcard)
  if (body.event !== "*" && !WEBHOOK_EVENTS.includes(body.event as any)) {
    return c.json({ error: `Unknown event. Allowed: ${WEBHOOK_EVENTS.join(", ")}, or "*"` }, 400);
  }

  const [created] = await db.insert(webhookSubscriptions).values({
    name:      body.name,
    event:     body.event,
    url:       body.url,
    secret:    body.secret ?? null,
    isActive:  body.is_active ?? true,
    createdBy: user.id,
  }).returning();
  return c.json(created, 201);
});

// PATCH /webhooks/:id
router.patch("/:id", authMiddleware, adminOnly, async (c) => {
  const body = createSchema.partial().parse(await c.req.json());
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined)      patch.name = body.name;
  if (body.event !== undefined)     patch.event = body.event;
  if (body.url !== undefined)       patch.url = body.url;
  if (body.secret !== undefined)    patch.secret = body.secret;
  if (body.is_active !== undefined) patch.isActive = body.is_active;

  const [updated] = await db.update(webhookSubscriptions).set(patch)
    .where(eq(webhookSubscriptions.id, c.req.param("id"))).returning();
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

// DELETE /webhooks/:id
router.delete("/:id", authMiddleware, adminOnly, async (c) => {
  const [deleted] = await db.delete(webhookSubscriptions)
    .where(eq(webhookSubscriptions.id, c.req.param("id"))).returning({ id: webhookSubscriptions.id });
  if (!deleted) return c.json({ error: "Not found" }, 404);
  return new Response(null, { status: 204 });
});

// POST /webhooks/:id/test — fire a test event to verify the URL is reachable
router.post("/:id/test", authMiddleware, adminOnly, async (c) => {
  const [sub] = await db.select().from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.id, c.req.param("id"))).limit(1);
  if (!sub) return c.json({ error: "Not found" }, 404);

  await fireEvent(sub.event as any, {
    test:    true,
    message: "This is a test event from Seekers CRM. If you see this, your webhook is wired up correctly.",
  });

  // Return the most recent delivery for this subscription
  const [latest] = await db.select().from(webhookDeliveries)
    .where(eq(webhookDeliveries.subscriptionId, sub.id))
    .orderBy(desc(webhookDeliveries.deliveredAt))
    .limit(1);
  return c.json(latest ?? { error: "No delivery logged" });
});

// GET /webhooks/:id/deliveries — recent delivery log for debugging
router.get("/:id/deliveries", authMiddleware, async (c) => {
  const rows = await db.select().from(webhookDeliveries)
    .where(eq(webhookDeliveries.subscriptionId, c.req.param("id")))
    .orderBy(desc(webhookDeliveries.deliveredAt))
    .limit(50);
  return c.json(rows);
});

export default router;
