// Sprint 6 — Notifications endpoints
import { Hono } from "hono";
import { eq, and, desc, gte } from "drizzle-orm";
import { db } from "../db/client";
import { notifications, profiles } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { createNotification } from "../services/notifications";
import { externalNotificationSchema } from "../utils/validators";
import type { AppEnv } from "../types";

const notificationsRouter = new Hono<AppEnv>();
const externalRateLimits = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(key: string, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const current = externalRateLimits.get(key);

  if (!current || now - current.windowStart >= windowMs) {
    externalRateLimits.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (current.count >= limit) return false;
  current.count += 1;
  externalRateLimits.set(key, current);
  return true;
}

// POST /notifications/send — external automation API (API key protected)
notificationsRouter.post("/send", async (c) => {
  const apiKey = c.req.header("x-api-key") ?? c.req.header("authorization")?.replace("Bearer ", "");
  if (!apiKey || apiKey !== process.env.AUTOMATION_API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (!checkRateLimit(apiKey)) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  const body = externalNotificationSchema.parse(await c.req.json());

  let targetUserIds: string[] = [];
  if (body.user_id) {
    targetUserIds = [body.user_id];
  } else if (body.target) {
    const roleFilter = body.target === "all" ? undefined : body.target === "admins" ? "admin" : "member";
    const rows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(roleFilter ? eq(profiles.role, roleFilter) : undefined);
    targetUserIds = rows.map((r) => r.id);
  }

  if (targetUserIds.length === 0) {
    return c.json({ error: "No target users found" }, 404);
  }

  await Promise.all(targetUserIds.map((userId) => createNotification({
    userId,
    type: body.type,
    title: body.title,
    body: body.message,
    link: body.link ?? null,
  })));

  console.log("[notifications/send]", {
    created: targetUserIds.length,
    type: body.type,
    target: body.user_id ?? body.target,
  });

  return c.json({ message: "Notification(s) queued", created: targetUserIds.length }, 202);
});

// GET /notifications
notificationsRouter.get("/", authMiddleware, async (c) => {
  const user         = c.get("user");
  const { unread_only, limit, since } = c.req.query() as Record<string, string>;
  const max = Math.max(1, Math.min(Number(limit || 50), 200));

  const conditions = [eq(notifications.userId, user.id)];
  if (unread_only === "true") conditions.push(eq(notifications.read, false));
  if (since) {
    const sinceDate = new Date(since);
    if (!Number.isNaN(sinceDate.getTime())) {
      conditions.push(gte(notifications.createdAt, sinceDate));
    }
  }

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(max);

  return c.json(rows);
});

// PATCH /notifications/:id/read
notificationsRouter.patch("/:id/read", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const read = typeof body.read === "boolean" ? body.read : true;

  const [updated] = await db
    .update(notifications)
    .set({ read })
    .where(and(
      eq(notifications.id, c.req.param("id")),
      eq(notifications.userId, user.id),
    ))
    .returning();

  if (!updated) return c.json({ error: "Notification not found" }, 404);
  return c.json(updated);
});

// PATCH /notifications/read-all
notificationsRouter.patch("/read-all", authMiddleware, async (c) => {
  const user = c.get("user");

  await db
    .update(notifications)
    .set({ read: true })
    .where(and(
      eq(notifications.userId, user.id),
      eq(notifications.read,   false),
    ));

  return c.json({ message: "All notifications marked as read" });
});

// DELETE /notifications/:id
notificationsRouter.delete("/:id", authMiddleware, async (c) => {
  const user = c.get("user");

  const [deleted] = await db
    .delete(notifications)
    .where(and(
      eq(notifications.id, c.req.param("id")),
      eq(notifications.userId, user.id),
    ))
    .returning({ id: notifications.id });

  if (!deleted) return c.json({ error: "Notification not found" }, 404);
  return new Response(null, { status: 204 });
});

export default notificationsRouter;
