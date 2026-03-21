// Sprint 2 — Clients endpoints
import { Hono } from "hono";
import { eq, ilike, or, sql, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { clients, projects, tasks, transactions } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { createClientSchema, updateClientSchema } from "../utils/validators";
import type { AppEnv } from "../types";

const clientsRouter = new Hono<AppEnv>();

// GET /clients
clientsRouter.get("/", authMiddleware, async (c) => {
  const { status, search } = c.req.query() as Record<string, string>;

  let query = db.select().from(clients).$dynamic();

  if (status && status !== "all") {
    query = query.where(eq(clients.status, status as "active" | "inactive" | "prospect"));
  }
  if (search) {
    query = query.where(
      or(
        ilike(clients.name, `%${search}%`),
        ilike(clients.company, `%${search}%`),
      ),
    );
  }

  const rows = await query.orderBy(clients.createdAt);

  // Attach project count — single batch query instead of N+1
  const projectCounts = rows.length > 0
    ? await db
        .select({ clientId: projects.clientId, count: sql<number>`COUNT(*)::int` })
        .from(projects)
        .where(inArray(projects.clientId, rows.map((r) => r.id)))
        .groupBy(projects.clientId)
    : [];

  const countMap = new Map(projectCounts.map((p) => [p.clientId, p.count]));
  const withCounts = rows.map((client) => ({
    ...client,
    project_count: countMap.get(client.id) ?? 0,
  }));

  return c.json(withCounts);
});

// POST /clients
clientsRouter.post("/", authMiddleware, async (c) => {
  const body = createClientSchema.parse(await c.req.json());
  const [client] = await db
    .insert(clients)
    .values({
      name:    body.name,
      company: body.company,
      email:   body.email || null,
      phone:   body.phone || null,
      status:  body.status ?? "prospect",
      industry: body.industry || null,
      notes:   body.notes || null,
    })
    .returning();
  return c.json(client, 201);
});

// GET /clients/:id — with projects + tasks + recent transactions
clientsRouter.get("/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");

  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) return c.json({ error: "Client not found" }, 404);

  const [clientProjects, clientTasks, recentTransactions] = await Promise.all([
    db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.clientId, id)),
    db.select().from(tasks).where(eq(tasks.clientId, id)).orderBy(tasks.createdAt),
    db.select().from(transactions).where(eq(transactions.clientId, id))
      .orderBy(sql`${transactions.date} DESC`).limit(5),
  ]);

  return c.json({
    ...client,
    projects:             clientProjects,
    tasks:                clientTasks,
    recent_transactions:  recentTransactions,
  });
});

// PATCH /clients/:id
clientsRouter.patch("/:id", authMiddleware, async (c) => {
  const id   = c.req.param("id");
  const body = updateClientSchema.parse(await c.req.json());

  const [updated] = await db
    .update(clients)
    .set({ ...body, email: body.email || null, updatedAt: new Date() })
    .where(eq(clients.id, id))
    .returning();

  if (!updated) return c.json({ error: "Client not found" }, 404);
  return c.json(updated);
});

// DELETE /clients/:id — admin only
clientsRouter.delete("/:id", authMiddleware, adminOnly, async (c) => {
  const [deleted] = await db
    .delete(clients)
    .where(eq(clients.id, c.req.param("id")))
    .returning({ id: clients.id });

  if (!deleted) return c.json({ error: "Client not found" }, 404);
  return new Response(null, { status: 204 });
});

// GET /clients/:id/tasks
clientsRouter.get("/:id/tasks", authMiddleware, async (c) => {
  const id = c.req.param("id");
  const clientTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.clientId, id))
    .orderBy(tasks.createdAt);
  return c.json(clientTasks);
});

export default clientsRouter;
