// Sprint 3 — Finance endpoints
import { Hono } from "hono";
import { eq, and, gte, lte, sql, count } from "drizzle-orm";
import { db } from "../db/client";
import { transactions } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { createTransactionSchema, updateTransactionSchema } from "../utils/validators";
import { parsePagination, paginate } from "../utils/pagination";
import type { AppEnv } from "../types";

const finance = new Hono<AppEnv>();

// GET /finance/transactions
finance.get("/transactions", authMiddleware, async (c) => {
  const q = c.req.query() as Record<string, string>;
  const { page, limit, offset } = parsePagination(q);

  const conditions = [];
  if (q.type && q.type !== "all")     conditions.push(eq(transactions.type, q.type as "income" | "expense"));
  if (q.category)                     conditions.push(eq(transactions.category, q.category));
  if (q.from)                         conditions.push(gte(transactions.date, q.from));
  if (q.to)                           conditions.push(lte(transactions.date, q.to));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db.select().from(transactions)
      .where(where)
      .orderBy(sql`${transactions.date} DESC`)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(transactions).where(where),
  ]);

  return c.json(paginate(rows, total, page, limit));
});

// POST /finance/transactions
finance.post("/transactions", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = createTransactionSchema.parse(await c.req.json());

  const [tx] = await db
    .insert(transactions)
    .values({
      date:       body.date,
      type:       body.type,
      amount:     String(body.amount),
      currency:   body.currency ?? "USD",
      category:   body.category,
      clientId:   body.client_id   ?? null,
      clientName: body.client_name ?? null,
      status:     body.status      ?? "completed",
      notes:      body.notes       ?? null,
      createdBy:  user.id,
    })
    .returning();
  return c.json(tx, 201);
});

// GET /finance/transactions/:id
finance.get("/transactions/:id", authMiddleware, async (c) => {
  const [tx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, c.req.param("id")))
    .limit(1);

  if (!tx) return c.json({ error: "Transaction not found" }, 404);
  return c.json(tx);
});

// PATCH /finance/transactions/:id
finance.patch("/transactions/:id", authMiddleware, async (c) => {
  const body = updateTransactionSchema.parse(await c.req.json());

  const [updated] = await db
    .update(transactions)
    .set({
      ...body,
      amount:     body.amount ? String(body.amount) : undefined,
      clientId:   body.client_id   ?? undefined,
      clientName: body.client_name ?? undefined,
      updatedAt:  new Date(),
    } as any)
    .where(eq(transactions.id, c.req.param("id")))
    .returning();

  if (!updated) return c.json({ error: "Transaction not found" }, 404);
  return c.json(updated);
});

// DELETE /finance/transactions/:id
finance.delete("/transactions/:id", authMiddleware, async (c) => {
  const [deleted] = await db
    .delete(transactions)
    .where(eq(transactions.id, c.req.param("id")))
    .returning({ id: transactions.id });

  if (!deleted) return c.json({ error: "Transaction not found" }, 404);
  return new Response(null, { status: 204 });
});

// GET /finance/summary — aggregated P&L
finance.get("/summary", authMiddleware, async (c) => {
  const { from, to } = c.req.query() as Record<string, string>;

  const conditions = [];
  if (from) conditions.push(gte(transactions.date, from));
  if (to)   conditions.push(lte(transactions.date, to));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Single query: conditional aggregation
  const [summary] = await db
    .select({
      total_income:   sql<number>`SUM(CASE WHEN type = 'income'  THEN amount::numeric ELSE 0 END)`,
      total_expenses: sql<number>`SUM(CASE WHEN type = 'expense' THEN amount::numeric ELSE 0 END)`,
    })
    .from(transactions)
    .where(where);

  const income   = Number(summary.total_income   ?? 0);
  const expenses = Number(summary.total_expenses ?? 0);
  const profit   = income - expenses;

  // Revenue by month — last 6 months
  const revenueByMonth = await db
    .select({
      month:   sql<string>`TO_CHAR(DATE_TRUNC('month', date::date), 'Mon')`,
      revenue: sql<number>`SUM(amount::numeric)`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.type, "income"),
      sql`${transactions.date} >= (CURRENT_DATE - INTERVAL '5 months')`,
    ))
    .groupBy(sql`DATE_TRUNC('month', date::date)`)
    .orderBy(sql`DATE_TRUNC('month', date::date)`);

  // Expense breakdown by category (filtered period)
  const expenseByCategory = await db
    .select({
      name:  transactions.category,
      value: sql<number>`SUM(amount::numeric)`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.type, "expense"),
      ...(conditions),
    ))
    .groupBy(transactions.category)
    .orderBy(sql`SUM(amount::numeric) DESC`);

  return c.json({
    total_income:         income,
    total_expenses:       expenses,
    net_profit:           profit,
    profit_margin:        income > 0 ? Math.round((profit / income) * 100) : 0,
    revenue_by_month:     revenueByMonth,
    expense_by_category:  expenseByCategory,
  });
});

// GET /finance/categories — distinct categories used
finance.get("/categories", authMiddleware, async (c) => {
  const rows = await db
    .selectDistinct({ category: transactions.category })
    .from(transactions)
    .orderBy(transactions.category);
  return c.json(rows.map((r) => r.category));
});

export default finance;
