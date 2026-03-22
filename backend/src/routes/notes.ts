import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client";
import { teamNotes, ideaBoard } from "../db/schema";
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

// ── Idea Board ────────────────────────────────────────────

const ideaSchema = z.object({
  content: z.string().min(1),
  color:   z.enum(["yellow", "blue", "green", "pink", "purple"]).default("yellow"),
});

// GET /notes/board — list all idea cards
notesRouter.get("/board", authMiddleware, async (c) => {
  const cards = await db
    .select()
    .from(ideaBoard)
    .orderBy(desc(ideaBoard.createdAt));
  return c.json(cards);
});

// POST /notes/board — add a card
notesRouter.post("/board", authMiddleware, async (c) => {
  const user = c.get("user");
  const { content, color } = ideaSchema.parse(await c.req.json());
  const [card] = await db
    .insert(ideaBoard)
    .values({ content, color, authorId: user.id, authorName: user.name })
    .returning();
  return c.json(card, 201);
});

// DELETE /notes/board/:id — delete a card (own card or admin)
notesRouter.delete("/board/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const { id } = c.req.param();
  const [card] = await db.select().from(ideaBoard).where(eq(ideaBoard.id, id)).limit(1);
  if (!card) return c.json({ error: "Not found" }, 404);
  if (card.authorId !== user.id && user.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }
  await db.delete(ideaBoard).where(eq(ideaBoard.id, id));
  return c.json({ ok: true });
});

export default notesRouter;
