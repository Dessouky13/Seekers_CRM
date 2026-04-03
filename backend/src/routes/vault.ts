import { Hono } from "hono";
import { eq, and, asc } from "drizzle-orm";
import { db } from "../db/client";
import { vaultEntries, vaultCategories } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { z } from "zod";
import type { AppEnv } from "../types";

const vault = new Hono<AppEnv>();

const DEFAULT_CATEGORIES = [
  "General",
  "Social Media",
  "Email",
  "Hosting",
  "Tools",
  "Clients",
  "Finance",
  "API",
  "Other",
];

async function ensureDefaultCategories() {
  await db
    .insert(vaultCategories)
    .values(DEFAULT_CATEGORIES.map((name, index) => ({
      name,
      sortOrder: (index + 1) * 10,
    })))
    .onConflictDoNothing();
}

const entrySchema = z.object({
  title:    z.string().min(1),
  username: z.string().optional(),
  password: z.string().min(1),
  url:      z.string().optional(),
  category: z.string().default("General"),
  notes:    z.string().optional(),
});

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  sort_order: z.number().int().min(0).max(10_000).optional(),
});

// GET /vault/categories — dynamic categories + backward-compatible legacy categories
vault.get("/categories", authMiddleware, async (c) => {
  await ensureDefaultCategories();

  const [managed, legacy] = await Promise.all([
    db
      .select({ name: vaultCategories.name })
      .from(vaultCategories)
      .where(eq(vaultCategories.isActive, true))
      .orderBy(asc(vaultCategories.sortOrder), asc(vaultCategories.name)),
    db
      .selectDistinct({ name: vaultEntries.category })
      .from(vaultEntries)
      .orderBy(vaultEntries.category),
  ]);

  const all = Array.from(new Set([
    ...managed.map((c) => c.name),
    ...legacy.map((c) => c.name),
  ]));

  return c.json(all);
});

// POST /vault/categories — admin managed category creation
vault.post("/categories", authMiddleware, adminOnly, async (c) => {
  const body = createCategorySchema.parse(await c.req.json());
  const name = body.name.trim();

  const [created] = await db
    .insert(vaultCategories)
    .values({
      name,
      sortOrder: body.sort_order ?? 100,
    })
    .onConflictDoNothing()
    .returning();

  if (!created) return c.json({ error: "Category already exists" }, 409);
  return c.json(created, 201);
});

// GET /vault — list all entries
vault.get("/", authMiddleware, async (c) => {
  await ensureDefaultCategories();

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

  await ensureDefaultCategories();

  const [categoryRow] = await db
    .select({ name: vaultCategories.name })
    .from(vaultCategories)
    .where(and(
      eq(vaultCategories.name, body.category),
      eq(vaultCategories.isActive, true),
    ))
    .limit(1);

  if (!categoryRow) {
    return c.json({ error: "Invalid vault category" }, 400);
  }

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

  if (body.category) {
    const [categoryRow] = await db
      .select({ name: vaultCategories.name })
      .from(vaultCategories)
      .where(and(
        eq(vaultCategories.name, body.category),
        eq(vaultCategories.isActive, true),
      ))
      .limit(1);

    if (!categoryRow) {
      return c.json({ error: "Invalid vault category" }, 400);
    }
  }

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
