// Sprint 6 — Notifications endpoints
import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client";
import { notifications } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

const notificationsRouter = new Hono<AppEnv>();

// GET /notifications
notificationsRouter.get("/", authMiddleware, async (c) => {
  const user         = c.get("user");
  const { unread_only } = c.req.query() as Record<string, string>;

  const conditions = [eq(notifications.userId, user.id)];
  if (unread_only === "true") conditions.push(eq(notifications.read, false));

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(50);

  return c.json(rows);
});

// PATCH /notifications/:id/read
notificationsRouter.patch("/:id/read", authMiddleware, async (c) => {
  const user = c.get("user");

  const [updated] = await db
    .update(notifications)
    .set({ read: true })
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
