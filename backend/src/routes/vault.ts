import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { vaultEntries } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { z } from "zod";
import type { AppEnv } from "../types";

const vault = new Hono<AppEnv>();

const entrySchema = z.object({
  title:    z.string().min(1),
  username: z.string().optional(),
  password: z.string().min(1),
  url:      z.string().optional(),
  category: z.string().default("General"),
  notes:    z.string().optional(),
});

// GET /vault — list all entries
vault.get("/", authMiddleware, async (c) => {
  const rows = await db
    .select()
    .from(vaultEntries)
    .orderBy(vaultEntries.category, vaultEntries.title);
  return c.json(rows);
});

// POST /vault — create entry
vault.post("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = entrySchema.parse(await c.req.json());
  const [entry] = await db
    .insert(vaultEntries)
    .values({ ...body, createdBy: user.id })
    .returning();
  return c.json(entry, 201);
});

// PATCH /vault/:id — update entry
vault.patch("/:id", authMiddleware, async (c) => {
  const { id } = c.req.param();
  const body = entrySchema.partial().parse(await c.req.json());
  const [entry] = await db
    .update(vaultEntries)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(vaultEntries.id, id))
    .returning();
  if (!entry) return c.json({ error: "Not found" }, 404);
  return c.json(entry);
});

// DELETE /vault/:id — delete entry
vault.delete("/:id", authMiddleware, async (c) => {
  const { id } = c.req.param();
  await db.delete(vaultEntries).where(eq(vaultEntries.id, id));
  return c.json({ ok: true });
});

export default vault;
