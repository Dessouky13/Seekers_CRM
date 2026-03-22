import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { teamNotes } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { z } from "zod";
import type { AppEnv } from "../types";

const notesRouter = new Hono<AppEnv>();

const saveNoteSchema = z.object({ content: z.string() });

// GET /notes/my — get current user's note
notesRouter.get("/my", authMiddleware, async (c) => {
  const userId = c.get("user").id;
  const [note] = await db
    .select()
    .from(teamNotes)
    .where(eq(teamNotes.userId, userId))
    .limit(1);
  return c.json({ content: note?.content ?? "", updatedAt: note?.updatedAt ?? null });
});

// PUT /notes/my — upsert current user's note
notesRouter.put("/my", authMiddleware, async (c) => {
  const userId = c.get("user").id;
  const { content } = saveNoteSchema.parse(await c.req.json());

  const [existing] = await db
    .select({ id: teamNotes.id })
    .from(teamNotes)
    .where(eq(teamNotes.userId, userId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(teamNotes)
      .set({ content, updatedAt: new Date() })
      .where(eq(teamNotes.userId, userId))
      .returning();
    return c.json({ content: updated.content, updatedAt: updated.updatedAt });
  }

  const [created] = await db
    .insert(teamNotes)
    .values({ userId, content })
    .returning();
  return c.json({ content: created.content, updatedAt: created.updatedAt });
});

export default notesRouter;
