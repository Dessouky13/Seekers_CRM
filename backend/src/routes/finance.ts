// Sprint 3 — Finance endpoints
import { Hono } from "hono";
import { eq, and, gte, lte, sql, count } from "drizzle-orm";
import { db } from "../db/client";
import { transactions, clients } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { createTransactionSchema, updateTransactionSchema } from "../utils/validators";
import { parsePagination, paginate } from "../utils/pagination";
import type { AppEnv } from "../types";

const finance = new Hono<AppEnv>();

async function resolveClient(clientId?: string | null, clientName?: string | null) {
  if (!clientId) {
    return { clientId: null as string | null, clientName: clientName ?? null };
  }

  const [client] = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!client) {
    throw new Error("Invalid client_id");
  }

  return { clientId: client.id, clientName: client.name };
}

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
    db.select({ tx: transactions, resolvedClientName: clients.name })
      .from(transactions)
      .leftJoin(clients, eq(transactions.clientId, clients.id))
      .where(where)
      .orderBy(sql`${transactions.date} DESC`)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(transactions).where(where),
  ]);

  return c.json(
    paginate(
      rows.map(({ tx, resolvedClientName }) => ({
        ...tx,
        clientName: resolvedClientName ?? tx.clientName,
      })),
      total,
      page,
      limit,
    ),
  );
});

// POST /finance/transactions
finance.post("/transactions", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = createTransactionSchema.parse(await c.req.json());

  let clientRelation: { clientId: string | null; clientName: string | null };
  try {
    clientRelation = await resolveClient(body.client_id ?? null, body.client_name ?? null);
  } catch {
    return c.json({ error: "Invalid client_id" }, 400);
  }

  const [tx] = await db
    .insert(transactions)
    .values({
      date:       body.date,
      type:       body.type,
      amount:     String(body.amount),
      currency:   body.currency ?? "USD",
      category:   body.category,
      clientId:   clientRelation.clientId,
      clientName: clientRelation.clientName,
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

  const patchData: Record<string, unknown> = {
    date: body.date,
    type: body.type,
    currency: body.currency,
    category: body.category,
    status: body.status,
    notes: body.notes,
    amount:    body.amount ? String(body.amount) : undefined,
    updatedAt: new Date(),
  };

  if (Object.prototype.hasOwnProperty.call(body, "client_id") || Object.prototype.hasOwnProperty.call(body, "client_name")) {
    let clientRelation: { clientId: string | null; clientName: string | null };
    try {
      clientRelation = await resolveClient(body.client_id ?? null, body.client_name ?? null);
    } catch {
      return c.json({ error: "Invalid client_id" }, 400);
    }

    patchData.clientId = clientRelation.clientId;
    patchData.clientName = clientRelation.clientName;
  }

  const [updated] = await db
    .update(transactions)
    .set(patchData as any)
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

  const income   = Number(summary?.total_income   ?? 0);
  const expenses = Number(summary?.total_expenses ?? 0);
  const profit   = income - expenses;

  // Revenue by month — last 6 months, fill gaps with 0
  const revRows = await db
    .select({
      monthStart: sql<string>`DATE_TRUNC('month', ${transactions.date}::date)::date`,
      revenue:    sql<number>`SUM(${transactions.amount}::numeric)`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.type, "income"),
      sql`${transactions.date} >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '5 months')`,
    ))
    .groupBy(sql`DATE_TRUNC('month', ${transactions.date}::date)`)
    .orderBy(sql`DATE_TRUNC('month', ${transactions.date}::date)`);

  const revByMonth = new Map(revRows.map((r) => [r.monthStart.slice(0, 7), Number(r.revenue ?? 0)]));
  const now = new Date();
  const revenueByMonth: { month: string; revenue: number }[] = [];
  const monthFmt = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    revenueByMonth.push({ month: monthFmt[d.getMonth()], revenue: revByMonth.get(key) ?? 0 });
  }

  // Expense breakdown by category (filtered period)
  const expenseConditions = [eq(transactions.type, "expense"), ...conditions];
  const expenseByCategory = await db
    .select({
      name:  transactions.category,
      value: sql<number>`SUM(${transactions.amount}::numeric)`,
    })
    .from(transactions)
    .where(and(...expenseConditions))
    .groupBy(transactions.category)
    .orderBy(sql`SUM(${transactions.amount}::numeric) DESC`);

  return c.json({
    total_income:         income,
    total_expenses:       expenses,
    net_profit:           profit,
    profit_margin:        income > 0 ? Math.round((profit / income) * 100) : 0,
    revenue_by_month:     revenueByMonth,
    expense_by_category:  expenseByCategory.map((row) => ({ name: row.name, value: Number(row.value ?? 0) })),
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
