// Sprint 2 — Clients endpoints
import { Hono } from "hono";
import { eq, and, ilike, or, sql, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { clients, projects, tasks, transactions } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { createClientSchema, updateClientSchema } from "../utils/validators";
import type { AppEnv } from "../types";

const clientsRouter = new Hono<AppEnv>();

// GET /clients
clientsRouter.get("/", authMiddleware, async (c) => {
  const { status, search } = c.req.query() as Record<string, string>;

  const conditions = [];
  if (status && status !== "all") {
    conditions.push(eq(clients.status, status as "active" | "inactive" | "prospect"));
  }
  if (search) {
    conditions.push(
      or(
        ilike(clients.name,    `%${search}%`),
        ilike(clients.company, `%${search}%`),
      )!,
    );
  }

  const rows = await db
    .select()
    .from(clients)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(clients.createdAt);

  if (rows.length === 0) return c.json([]);

  const clientIds = rows.map((r) => r.id);

  // Parallel batch queries: project counts + revenue totals from transactions
  const [projectCounts, revenueTotals] = await Promise.all([
    db
      .select({ clientId: projects.clientId, count: sql<number>`COUNT(*)::int` })
      .from(projects)
      .where(inArray(projects.clientId, clientIds))
      .groupBy(projects.clientId),
    db
      .select({
        clientId: transactions.clientId,
        income:   sql<number>`SUM(CASE WHEN ${transactions.type} = 'income'  THEN ${transactions.amount}::numeric ELSE 0 END)`,
        expense:  sql<number>`SUM(CASE WHEN ${transactions.type} = 'expense' THEN ${transactions.amount}::numeric ELSE 0 END)`,
      })
      .from(transactions)
      .where(inArray(transactions.clientId, clientIds))
      .groupBy(transactions.clientId),
  ]);

  const countMap   = new Map(projectCounts.map((p) => [p.clientId, p.count]));
  const revenueMap = new Map(revenueTotals.map((r) => [r.clientId, r]));

  const withCounts = rows.map((client) => {
    const rev = revenueMap.get(client.id);
    const income  = Number(rev?.income  ?? 0);
    const expense = Number(rev?.expense ?? 0);
    return {
      ...client,
      // Overwrite stored totalRevenue with live-computed net revenue from transactions
      totalRevenue:  String(income),
      project_count: countMap.get(client.id) ?? 0,
      revenue_summary: { income, expense, net: income - expense },
    };
  });

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
      .orderBy(sql`${transactions.date} DESC`).limit(20),
  ]);

  const [feeSummary] = await db
    .select({
      total_income: sql<number>`SUM(CASE WHEN ${transactions.type} = 'income' THEN ${transactions.amount}::numeric ELSE 0 END)`,
      total_expense: sql<number>`SUM(CASE WHEN ${transactions.type} = 'expense' THEN ${transactions.amount}::numeric ELSE 0 END)`,
    })
    .from(transactions)
    .where(eq(transactions.clientId, id));

  const income  = Number(feeSummary?.total_income  ?? 0);
  const expense = Number(feeSummary?.total_expense ?? 0);

  return c.json({
    ...client,
    // Live-computed from transactions, overrides stale stored value
    totalRevenue:         String(income),
    projects:             clientProjects,
    tasks:                clientTasks,
    recent_transactions:  recentTransactions,
    fee_summary: {
      total_income:  income,
      total_expense: expense,
      net:           income - expense,
    },
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
