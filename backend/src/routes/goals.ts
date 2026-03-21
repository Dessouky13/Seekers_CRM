// Sprint 4 — Goals endpoints
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { goals, profiles } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { createGoalSchema, updateGoalSchema } from "../utils/validators";
import type { AppEnv } from "../types";

const goalsRouter = new Hono<AppEnv>();

// GET /goals
goalsRouter.get("/", authMiddleware, async (c) => {
  const rows = await db
    .select({ goal: goals, ownerName: profiles.name })
    .from(goals)
    .leftJoin(profiles, eq(goals.ownerId, profiles.id))
    .orderBy(goals.createdAt);

  return c.json(
    rows.map(({ goal, ownerName }) => {
      const current = Number(goal.current ?? 0);
      const target  = Number(goal.target);
      return {
        ...goal,
        owner_name:   ownerName,
        progress_pct: target > 0 ? Math.min(Math.round((current / target) * 100), 100) : 0,
      };
    }),
  );
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

  return c.json(goal, 201);
});

// PATCH /goals/:id
goalsRouter.patch("/:id", authMiddleware, async (c) => {
  const body = updateGoalSchema.parse(await c.req.json());

  const [updated] = await db
    .update(goals)
    .set({
      ...body,
      current:  body.current ? String(body.current) : undefined,
      target:   body.target  ? String(body.target)  : undefined,
      ownerId:  body.owner_id ?? undefined,
      updatedAt: new Date(),
    } as any)
    .where(eq(goals.id, c.req.param("id")))
    .returning();

  if (!updated) return c.json({ error: "Goal not found" }, 404);
  return c.json(updated);
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
