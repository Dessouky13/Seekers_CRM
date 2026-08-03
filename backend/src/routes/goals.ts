// Sprint 4 — Goals endpoints
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { goals, profiles } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { createGoalSchema, updateGoalSchema } from "../utils/validators";
import type { AppEnv } from "../types";

const goalsRouter = new Hono<AppEnv>();

/** Capped at 100 so an overshoot renders as a full bar rather than 137%. */
function progressPct(current: unknown, target: unknown): number {
  const c = Number(current ?? 0);
  const t = Number(target);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.min(Math.round((c / t) * 100), 100);
}

/** Shared shape so create, update and list all return the same fields. */
function withProgress<T extends { current: unknown; target: unknown }>(goal: T, ownerName?: string | null) {
  return {
    ...goal,
    ...(ownerName !== undefined ? { owner_name: ownerName } : {}),
    progress_pct: progressPct(goal.current, goal.target),
  };
}

// GET /goals
goalsRouter.get("/", authMiddleware, async (c) => {
  const rows = await db
    .select({ goal: goals, ownerName: profiles.name })
    .from(goals)
    .leftJoin(profiles, eq(goals.ownerId, profiles.id))
    .orderBy(goals.createdAt);

  return c.json(rows.map(({ goal, ownerName }) => withProgress(goal, ownerName)));
});

// POST /goals
goalsRouter.post("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = createGoalSchema.parse(await c.req.json());

  const [goal] = await db
    .insert(goals)
    .values({
      title:       body.title,
      description: body.description ?? null,
      current:     String(body.current ?? 0),
      target:      String(body.target),
      unit:        body.unit   ?? "",
      period:      body.period ?? null,
      ownerId:     body.owner_id ?? user.id,
    })
    .returning();

  return c.json(withProgress(goal), 201);
});

// PATCH /goals/:id
goalsRouter.patch("/:id", authMiddleware, async (c) => {
  const body = updateGoalSchema.parse(await c.req.json());

  // Built field by field rather than spreading `body`.
  //
  // The previous version used `body.current ? String(body.current) : undefined`,
  // and 0 is falsy — so setting a goal's progress back to zero was silently
  // dropped and the old value stayed. It also spread the snake_case `owner_id`
  // straight into the column set, which only went unnoticed because of the
  // `as any`.
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title       !== undefined) patch.title       = body.title;
  if (body.description !== undefined) patch.description = body.description;
  if (body.unit        !== undefined) patch.unit        = body.unit;
  if (body.period      !== undefined) patch.period      = body.period;
  if (body.current     !== undefined) patch.current     = String(body.current);
  if (body.target      !== undefined) patch.target      = String(body.target);
  if (body.owner_id    !== undefined) patch.ownerId     = body.owner_id;

  const [updated] = await db
    .update(goals)
    .set(patch)
    .where(eq(goals.id, c.req.param("id")))
    .returning();

  if (!updated) return c.json({ error: "Goal not found" }, 404);
  return c.json(withProgress(updated));
});

// DELETE /goals/:id — admin only
goalsRouter.delete("/:id", authMiddleware, adminOnly, async (c) => {
  const [deleted] = await db
    .delete(goals)
    .where(eq(goals.id, c.req.param("id")))
    .returning({ id: goals.id });

  if (!deleted) return c.json({ error: "Goal not found" }, 404);
  return new Response(null, { status: 204 });
});

export default goalsRouter;
