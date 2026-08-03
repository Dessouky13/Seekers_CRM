// Sprint 3 — Finance endpoints
import { Hono } from "hono";
import { eq, and, gte, lte, sql, count, isNull, desc, asc } from "drizzle-orm";
import { db } from "../db/client";
import { transactions, clients, tools, profiles } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import {
  createTransactionSchema, updateTransactionSchema,
  createToolSchema, updateToolSchema,
} from "../utils/validators";
import { parsePagination, paginate } from "../utils/pagination";
import type { AppEnv } from "../types";

const finance = new Hono<AppEnv>();

// ── Accounting cycle ──────────────────────────────────────
// Seekers closes the books ON the 20th: a period ends on the 20th and is
// NAMED AFTER THE MONTH IT CLOSES IN. cycle_day is the day a period STARTS,
// so closing on the 20th means starting on the 21st.
//   "June 2026"  =  2026-05-21 → 2026-06-20
//   "July 2026"  =  2026-06-21 → 2026-07-20
// This puts bills dated the 20th INSIDE that month's period (tool invoices
// are entered on the 20th, and they belong to the month being closed).
// Configurable per-request via ?cycle_day= (1 = plain calendar months).
const DEFAULT_CYCLE_DAY = Number(process.env.FINANCE_CYCLE_DAY ?? 21);

/** 1 → "1st", 2 → "2nd", 21 → "21st" */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:  return `${n}st`;
    case 2:  return `${n}nd`;
    case 3:  return `${n}rd`;
    default: return `${n}th`;
  }
}

function clampCycleDay(raw?: string): number {
  const n = Number(raw ?? DEFAULT_CYCLE_DAY);
  if (!Number.isFinite(n)) return DEFAULT_CYCLE_DAY;
  return Math.min(28, Math.max(1, Math.trunc(n)));   // 28 keeps every month valid
}

/** Inclusive [from, to] ISO dates for the period labelled (year, month). */
export function periodBounds(year: number, month: number, cycleDay: number): { from: string; to: string } {
  if (cycleDay <= 1) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end   = new Date(Date.UTC(year, month, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  // Starts on cycleDay of the PREVIOUS month, ends on (cycleDay - 1) of this month.
  const start = new Date(Date.UTC(year, month - 2, cycleDay));
  const end   = new Date(Date.UTC(year, month - 1, cycleDay - 1));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/**
 * SQL expression mapping a transaction date to the first day of its label month.
 *
 * Built with sql.raw so the emitted text is byte-identical everywhere it is
 * used. A templated `${cycleDay}` becomes a *numbered bind parameter*, which
 * gets a different number in SELECT vs GROUP BY — Postgres then treats them as
 * different expressions and rejects the query ("must appear in the GROUP BY
 * clause"). cycleDay is clamped to an integer 1–28 by clampCycleDay(), so
 * inlining it is safe.
 */
function cycleMonthExpr(cycleDay: number) {
  if (cycleDay <= 1) {
    return sql.raw(`DATE_TRUNC('month', "transactions"."date"::date)`);
  }
  const d = Math.trunc(cycleDay);
  return sql.raw(
    `DATE_TRUNC('month', "transactions"."date"::date` +
    ` + CASE WHEN EXTRACT(DAY FROM "transactions"."date"::date) >= ${d}` +
    ` THEN INTERVAL '1 month' ELSE INTERVAL '0 day' END)`,
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
  // Matches ANY of the transaction's categories, and falls back to the legacy
  // scalar column. Checking only the array meant filtering by category returned
  // zero rows for every transaction created before the multi-select shipped —
  // the filter looked functional and silently emptied the table.
  if (q.category) {
    conditions.push(sql`(
      ${q.category} = ANY(${transactions.categories})
      OR (cardinality(${transactions.categories}) = 0 AND ${transactions.category} = ${q.category})
      OR (${transactions.categories} IS NULL       AND ${transactions.category} = ${q.category})
    )`);
  }
  if (q.tool_id)                      conditions.push(eq(transactions.toolId, q.tool_id));
  if (q.held_by)                      conditions.push(eq(transactions.heldBy, q.held_by));
  if (q.unsettled === "true")         conditions.push(and(sql`${transactions.heldBy} IS NOT NULL`, isNull(transactions.settledAt))!);
  if (q.from)                         conditions.push(gte(transactions.date, q.from));
  if (q.to)                           conditions.push(lte(transactions.date, q.to));

  // ?period=YYYY-MM resolves to that accounting cycle's date range.
  if (q.period && /^\d{4}-\d{2}$/.test(q.period)) {
    const [py, pm] = q.period.split("-").map(Number);
    const { from, to } = periodBounds(py, pm, clampCycleDay(q.cycle_day));
    conditions.push(gte(transactions.date, from));
    conditions.push(lte(transactions.date, to));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db.select({
        tx: transactions,
        resolvedClientName: clients.name,
        toolName:   tools.name,
        heldByName: profiles.name,
      })
      .from(transactions)
      .leftJoin(clients,  eq(transactions.clientId, clients.id))
      .leftJoin(tools,    eq(transactions.toolId,   tools.id))
      .leftJoin(profiles, eq(transactions.heldBy,   profiles.id))
      .where(where)
      .orderBy(sql`${transactions.date} DESC`)
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(transactions).where(where),
  ]);

  return c.json(
    paginate(
      rows.map(({ tx, resolvedClientName, toolName, heldByName }) => ({
        ...tx,
        clientName:   resolvedClientName ?? tx.clientName,
        tool_name:    toolName,
        held_by_name: heldByName,
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

  // Normalise categories: accept either `categories[]` or legacy `category`.
  // categories[0] is the primary and is mirrored into `category` so existing
  // P&L breakdowns keep reconciling.
  const cats = normaliseCategories(body.categories, body.category);

  const [tx] = await db
    .insert(transactions)
    .values({
      date:       body.date,
      type:       body.type,
      amount:     String(body.amount),
      currency:   body.currency ?? "EGP",
      category:   cats[0],
      categories: cats,
      toolId:     body.tool_id ?? null,
      clientId:   clientRelation.clientId,
      clientName: clientRelation.clientName,
      status:     body.status      ?? "completed",
      heldBy:     body.held_by ?? null,
      settledAt:  body.settled ? new Date() : null,
      notes:      body.notes       ?? null,
      createdBy:  user.id,
    })
    .returning();
  return c.json(tx, 201);
});

/** categories[0] is primary; de-duplicates while preserving order. */
function normaliseCategories(categories?: string[], legacy?: string): string[] {
  const raw = (categories?.length ? categories : legacy ? [legacy] : [])
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(raw));
}

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
    status: body.status,
    notes: body.notes,
    amount:    body.amount ? String(body.amount) : undefined,
    updatedAt: new Date(),
  };

  // Categories: keep `category` (primary, used by P&L) in sync with categories[0].
  if (body.categories?.length || body.category) {
    const cats = normaliseCategories(body.categories, body.category);
    if (cats.length) {
      patchData.categories = cats;
      patchData.category   = cats[0];
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "tool_id")) patchData.toolId = body.tool_id ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "held_by")) patchData.heldBy = body.held_by ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "settled")) patchData.settledAt = body.settled ? new Date() : null;

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
  const { from, to, mode } = c.req.query() as Record<string, string>;

  // Mode: 'range' (default) filters from→to, 'cumulative' shows all time up to 'to' date
  const dateMode = mode === "cumulative" ? "cumulative" : "range";

  const conditions = [eq(transactions.status, "completed")]; // Only count completed transactions
  
  if (dateMode === "cumulative") {
    // Cumulative: from beginning of time until 'to' date
    if (to) conditions.push(lte(transactions.date, to));
  } else {
    // Range: between 'from' and 'to'
    if (from) conditions.push(gte(transactions.date, from));
    if (to)   conditions.push(lte(transactions.date, to));
  }
  
  const where = and(...conditions);

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

  // Revenue by month — last 6 months, fill gaps with 0 (only completed transactions)
  const revRows = await db
    .select({
      monthStart: sql<string>`DATE_TRUNC('month', ${transactions.date}::date)::date`,
      revenue:    sql<number>`SUM(${transactions.amount}::numeric)`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.type, "income"),
      eq(transactions.status, "completed"),
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

  // Expense breakdown by category (filtered period, only completed)
  const expenseByCategory = await db
    .select({
      name:  transactions.category,
      value: sql<number>`SUM(${transactions.amount}::numeric)`,
    })
    .from(transactions)
    .where(and(eq(transactions.type, "expense"), ...conditions))
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

// GET /finance/categories — every distinct category across all of categories[]
finance.get("/categories", authMiddleware, async (c) => {
  // Falls back to the legacy scalar `category`. Reading only the array column
  // meant every row created before the multi-select was invisible here, so on a
  // database of older transactions the category filter listed nothing and was
  // effectively dead.
  const rows = await db.execute(sql`
    SELECT DISTINCT cat AS category
      FROM transactions t
      CROSS JOIN LATERAL unnest(
        CASE WHEN cardinality(t.categories) > 0 THEN t.categories
             WHEN t.category IS NOT NULL       THEN ARRAY[t.category]
             ELSE ARRAY[]::text[] END
      ) AS cat
     ORDER BY category
  `);
  return c.json((rows.rows as { category: string }[]).map((r) => r.category));
});

// ── GET /finance/category-totals ──────────────────────────
// All-time totals and counts per category.
//
// The Finance page used to pull `/transactions?limit=2000` on every load purely
// to sum four fixed categories client-side. That is up to 2,000 full rows over
// the wire to produce eight numbers, and it silently under-reports once the
// ledger passes the limit. Aggregating in Postgres is both correct and cheap.
//
// Reads the `categories` array with a fallback to the legacy scalar `category`,
// since older rows predate the multi-select.
finance.get("/category-totals", authMiddleware, async (c) => {
  // The CASE picks an array and the LATERAL expands it. Putting unnest()
  // directly inside the CASE fails: "set-returning functions are not allowed
  // in CASE".
  const rows = await db.execute(sql`
    SELECT cat                                AS category,
           COUNT(*)::int                      AS count,
           COALESCE(SUM(t.amount::numeric),0) AS total,
           MAX(t.date)::text                  AS last_date
      FROM transactions t
      CROSS JOIN LATERAL unnest(
        CASE WHEN cardinality(t.categories) > 0 THEN t.categories
             WHEN t.category IS NOT NULL       THEN ARRAY[t.category]
             ELSE ARRAY[]::text[] END
      ) AS cat
     GROUP BY cat
     ORDER BY total DESC
  `);

  return c.json((rows.rows as Record<string, unknown>[]).map((r) => ({
    category:  String(r.category),
    count:     Number(r.count ?? 0),
    total:     Number(r.total ?? 0),
    last_date: (r.last_date as string) ?? null,
  })));
});

// ── GET /finance/monthly ──────────────────────────────────
// Per-cycle P&L for the last N periods (20th→19th by default), newest last.
// Each period also carries its category + tool breakdown so the UI can drill in
// without another round-trip.
finance.get("/monthly", authMiddleware, async (c) => {
  const q         = c.req.query() as Record<string, string>;
  const cycleDay  = clampCycleDay(q.cycle_day);
  const months    = Math.min(36, Math.max(1, Number(q.months ?? 12) || 12));
  const monthExpr = cycleMonthExpr(cycleDay);

  const [totalsRows, catRows, toolRows] = await Promise.all([
    // Income / expense per period
    db.select({
      m:        sql<string>`${monthExpr}::date`,
      income:   sql<number>`SUM(CASE WHEN ${transactions.type} = 'income'  THEN ${transactions.amount}::numeric ELSE 0 END)`,
      expenses: sql<number>`SUM(CASE WHEN ${transactions.type} = 'expense' THEN ${transactions.amount}::numeric ELSE 0 END)`,
      txCount:  sql<number>`COUNT(*)::int`,
    })
      .from(transactions)
      .where(eq(transactions.status, "completed"))
      .groupBy(monthExpr)
      .orderBy(sql`${monthExpr} DESC`)
      .limit(months),

    // Expense by PRIMARY category per period (primary only → totals reconcile)
    db.select({
      m:        sql<string>`${monthExpr}::date`,
      category: transactions.category,
      value:    sql<number>`SUM(${transactions.amount}::numeric)`,
    })
      .from(transactions)
      .where(and(eq(transactions.status, "completed"), eq(transactions.type, "expense")))
      .groupBy(monthExpr, transactions.category),

    // Tool spend per period
    db.select({
      m:     sql<string>`${monthExpr}::date`,
      tool:  tools.name,
      value: sql<number>`SUM(${transactions.amount}::numeric)`,
    })
      .from(transactions)
      .innerJoin(tools, eq(transactions.toolId, tools.id))
      .where(and(eq(transactions.status, "completed"), eq(transactions.type, "expense")))
      .groupBy(monthExpr, tools.name),
  ]);

  const catByMonth  = new Map<string, { name: string; value: number }[]>();
  for (const r of catRows) {
    const k = String(r.m).slice(0, 10);
    (catByMonth.get(k) ?? catByMonth.set(k, []).get(k)!).push({ name: r.category, value: Number(r.value ?? 0) });
  }
  const toolByMonth = new Map<string, { name: string; value: number }[]>();
  for (const r of toolRows) {
    const k = String(r.m).slice(0, 10);
    (toolByMonth.get(k) ?? toolByMonth.set(k, []).get(k)!).push({ name: r.tool, value: Number(r.value ?? 0) });
  }

  const periods = totalsRows
    .map((r) => {
      const key      = String(r.m).slice(0, 10);
      const d        = new Date(`${key}T00:00:00Z`);
      const year     = d.getUTCFullYear();
      const monthNum = d.getUTCMonth() + 1;
      const income   = Number(r.income   ?? 0);
      const expenses = Number(r.expenses ?? 0);
      const profit   = income - expenses;
      const bounds   = periodBounds(year, monthNum, cycleDay);
      return {
        period:        `${year}-${String(monthNum).padStart(2, "0")}`,
        label:         `${MONTH_NAMES[monthNum - 1]} ${year}`,
        short_label:   MONTH_NAMES[monthNum - 1],
        from:          bounds.from,
        to:            bounds.to,
        income,
        expenses,
        profit,
        margin:        income > 0 ? Math.round((profit / income) * 100) : 0,
        tx_count:      Number(r.txCount ?? 0),
        by_category:   (catByMonth.get(key)  ?? []).sort((a, b) => b.value - a.value),
        by_tool:       (toolByMonth.get(key) ?? []).sort((a, b) => b.value - a.value),
      };
    })
    .reverse();   // oldest → newest for charting

  // Period-over-period deltas
  const withDeltas = periods.map((p, i) => {
    const prev = i > 0 ? periods[i - 1] : null;
    const pct  = (curr: number, was: number) => (was > 0 ? Math.round(((curr - was) / was) * 100) : null);
    return {
      ...p,
      income_change_pct:   prev ? pct(p.income,   prev.income)   : null,
      expenses_change_pct: prev ? pct(p.expenses, prev.expenses) : null,
      profit_change_pct:   prev ? pct(p.profit,   prev.profit)   : null,
    };
  });

  const totals = withDeltas.reduce(
    (acc, p) => ({ income: acc.income + p.income, expenses: acc.expenses + p.expenses, profit: acc.profit + p.profit }),
    { income: 0, expenses: 0, profit: 0 },
  );

  return c.json({
    cycle_day:   cycleDay,
    cycle_label: cycleDay > 1
      ? `Books close on the ${ordinal(cycleDay - 1)} · each period runs ${ordinal(cycleDay)} → ${ordinal(cycleDay - 1)}, named after the month it closes in`
      : "Calendar months",
    periods:     withDeltas,
    totals: {
      ...totals,
      avg_monthly_profit: withDeltas.length ? Math.round(totals.profit / withDeltas.length) : 0,
      best_month:  withDeltas.length ? withDeltas.reduce((a, b) => (b.profit > a.profit ? b : a)).label : null,
      worst_month: withDeltas.length ? withDeltas.reduce((a, b) => (b.profit < a.profit ? b : a)).label : null,
    },
  });
});

// ── GET /finance/cash-positions ───────────────────────────
// Who is holding company money, and who is owed money.
//   income  held by X, unsettled → X is holding company cash  (X owes company)
//   expense paid by X, unsettled → X fronted the cost         (company owes X)
// net > 0 → that person should hand over `net` to the company.
finance.get("/cash-positions", authMiddleware, async (c) => {
  const rows = await db
    .select({
      userId:   transactions.heldBy,
      name:     profiles.name,
      email:    profiles.email,
      holding:  sql<number>`SUM(CASE WHEN ${transactions.type} = 'income'  THEN ${transactions.amount}::numeric ELSE 0 END)`,
      fronted:  sql<number>`SUM(CASE WHEN ${transactions.type} = 'expense' THEN ${transactions.amount}::numeric ELSE 0 END)`,
      items:    sql<number>`COUNT(*)::int`,
    })
    .from(transactions)
    .leftJoin(profiles, eq(transactions.heldBy, profiles.id))
    .where(and(
      sql`${transactions.heldBy} IS NOT NULL`,
      isNull(transactions.settledAt),
      eq(transactions.status, "completed"),
    ))
    .groupBy(transactions.heldBy, profiles.name, profiles.email);

  const positions = rows.map((r) => {
    const holding = Number(r.holding ?? 0);
    const fronted = Number(r.fronted ?? 0);
    return {
      user_id:      r.userId,
      name:         r.name ?? "(unknown)",
      email:        r.email,
      holding,                       // collected client cash not yet handed over
      fronted,                       // expenses paid from their own pocket
      net:          holding - fronted,
      items:        Number(r.items ?? 0),
    };
  }).sort((a, b) => b.net - a.net);

  return c.json({
    positions,
    total_outstanding: positions.reduce((s, p) => s + p.net, 0),
  });
});

// POST /finance/transactions/:id/settle — mark handed over / reimbursed
finance.post("/transactions/:id/settle", authMiddleware, async (c) => {
  const settled = (await c.req.json().catch(() => ({}))).settled !== false;
  const [updated] = await db
    .update(transactions)
    .set({ settledAt: settled ? new Date() : null, updatedAt: new Date() })
    .where(eq(transactions.id, c.req.param("id")))
    .returning();
  if (!updated) return c.json({ error: "Transaction not found" }, 404);
  return c.json(updated);
});

// POST /finance/cash-positions/:userId/settle-all — clear one person's balance
finance.post("/cash-positions/:userId/settle-all", authMiddleware, async (c) => {
  const updated = await db
    .update(transactions)
    .set({ settledAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(transactions.heldBy, c.req.param("userId")),
      isNull(transactions.settledAt),
    ))
    .returning({ id: transactions.id });
  return c.json({ settled: updated.length });
});

// ── TOOLS ─────────────────────────────────────────────────
finance.get("/tools", authMiddleware, async (c) => {
  const rows = await db
    .select({
      tool:        tools,
      totalSpend:  sql<number>`COALESCE(SUM(${transactions.amount}::numeric), 0)`,
      txCount:     sql<number>`COUNT(${transactions.id})::int`,
      lastCharged: sql<string | null>`MAX(${transactions.date})`,
    })
    .from(tools)
    .leftJoin(transactions, and(
      eq(transactions.toolId, tools.id),
      eq(transactions.status, "completed"),
    ))
    .groupBy(tools.id)
    .orderBy(sql`COALESCE(SUM(${transactions.amount}::numeric), 0) DESC`);

  return c.json(rows.map(({ tool, totalSpend, txCount, lastCharged }) => ({
    ...tool,
    total_spend:  Number(totalSpend ?? 0),
    tx_count:     Number(txCount ?? 0),
    last_charged: lastCharged,
  })));
});

finance.post("/tools", authMiddleware, async (c) => {
  const body = createToolSchema.parse(await c.req.json());
  const [existing] = await db.select({ id: tools.id }).from(tools)
    .where(sql`LOWER(${tools.name}) = ${body.name.trim().toLowerCase()}`).limit(1);
  if (existing) return c.json({ error: "A tool with that name already exists" }, 409);

  const [created] = await db.insert(tools).values({
    name:          body.name.trim(),
    vendor:        body.vendor ?? null,
    url:           body.url ?? null,
    kind:          body.kind ?? null,
    monthlyBudget: body.monthly_budget != null ? String(body.monthly_budget) : null,
    active:        body.active ?? true,
    notes:         body.notes ?? null,
  }).returning();
  return c.json(created, 201);
});

finance.patch("/tools/:id", authMiddleware, async (c) => {
  const body = updateToolSchema.parse(await c.req.json());
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name   !== undefined) patch.name   = body.name.trim();
  if (body.vendor !== undefined) patch.vendor = body.vendor;
  if (body.url    !== undefined) patch.url    = body.url;
  if (body.kind   !== undefined) patch.kind   = body.kind;
  if (body.active !== undefined) patch.active = body.active;
  if (body.notes  !== undefined) patch.notes  = body.notes;
  if (body.monthly_budget !== undefined) {
    patch.monthlyBudget = body.monthly_budget != null ? String(body.monthly_budget) : null;
  }
  const [updated] = await db.update(tools).set(patch).where(eq(tools.id, c.req.param("id"))).returning();
  if (!updated) return c.json({ error: "Tool not found" }, 404);
  return c.json(updated);
});

// Deleting a tool leaves its transactions intact (tool_id → NULL).
finance.delete("/tools/:id", authMiddleware, async (c) => {
  const [deleted] = await db.delete(tools).where(eq(tools.id, c.req.param("id"))).returning({ id: tools.id });
  if (!deleted) return c.json({ error: "Tool not found" }, 404);
  return new Response(null, { status: 204 });
});

// GET /finance/tools/spend — per-tool spend with per-period trend
finance.get("/tools/spend", authMiddleware, async (c) => {
  const q        = c.req.query() as Record<string, string>;
  const cycleDay = clampCycleDay(q.cycle_day);
  const months   = Math.min(24, Math.max(1, Number(q.months ?? 6) || 6));
  const monthExpr = cycleMonthExpr(cycleDay);

  const rows = await db
    .select({
      toolId: tools.id,
      name:   tools.name,
      kind:   tools.kind,
      m:      sql<string>`${monthExpr}::date`,
      value:  sql<number>`SUM(${transactions.amount}::numeric)`,
    })
    .from(transactions)
    .innerJoin(tools, eq(transactions.toolId, tools.id))
    .where(and(eq(transactions.status, "completed"), eq(transactions.type, "expense")))
    .groupBy(tools.id, tools.name, tools.kind, monthExpr)
    .orderBy(sql`${monthExpr} DESC`);

  // Keep only the most recent N periods present in the data.
  const allPeriods = Array.from(new Set(rows.map((r) => String(r.m).slice(0, 10)))).sort().slice(-months);
  const periodSet  = new Set(allPeriods);

  const byTool = new Map<string, {
    tool_id: string; name: string; kind: string | null;
    total: number; by_period: Record<string, number>;
  }>();

  for (const r of rows) {
    const key = String(r.m).slice(0, 10);
    if (!periodSet.has(key)) continue;
    const entry = byTool.get(r.toolId) ?? {
      tool_id: r.toolId, name: r.name, kind: r.kind, total: 0, by_period: {},
    };
    const v = Number(r.value ?? 0);
    entry.by_period[key] = (entry.by_period[key] ?? 0) + v;
    entry.total += v;
    byTool.set(r.toolId, entry);
  }

  const periodLabels = allPeriods.map((p) => {
    const d = new Date(`${p}T00:00:00Z`);
    return { key: p, label: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  });

  const toolsOut = Array.from(byTool.values())
    .map((t) => {
      // Trend: latest period vs the one before it.
      const last = allPeriods[allPeriods.length - 1];
      const prev = allPeriods[allPeriods.length - 2];
      const lastV = last ? (t.by_period[last] ?? 0) : 0;
      const prevV = prev ? (t.by_period[prev] ?? 0) : 0;
      return {
        ...t,
        latest:       lastV,
        previous:     prevV,
        change_pct:   prevV > 0 ? Math.round(((lastV - prevV) / prevV) * 100) : null,
      };
    })
    .sort((a, b) => b.total - a.total);

  return c.json({
    cycle_day: cycleDay,
    periods:   periodLabels,
    tools:     toolsOut,
    total:     toolsOut.reduce((s, t) => s + t.total, 0),
  });
});

export default finance;
