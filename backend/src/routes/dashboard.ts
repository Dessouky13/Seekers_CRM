// Sprint 4 — Dashboard summary endpoint
import { Hono } from "hono";
import { and, eq, lt, not, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { transactions, tasks, leads, goals, profiles } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

const dashboard = new Hono<AppEnv>();

// GET /dashboard/summary — all KPIs in one request (parallel queries)
dashboard.get("/summary", authMiddleware, async (c) => {
  const { period } = c.req.query() as Record<string, string>;

  // Period: default to current month — validate YYYY-MM format
  const now = new Date();
  if (period && !/^\d{4}-\d{2}$/.test(period)) {
    return c.json({ error: "Invalid period format. Use YYYY-MM (e.g. 2026-03)" }, 400);
  }
  const periodStr = period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, month] = periodStr.split("-").map(Number);
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth   = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;

  const today = now.toISOString().slice(0, 10);

  const [financeData, taskData, leadData, goalsData] = await Promise.all([
    // Finance — KPI totals are all-time; charts use rolling windows
    (async () => {
      const [totals] = await db.select({
        total_income:   sql<number>`SUM(CASE WHEN type = 'income'  THEN amount::numeric ELSE 0 END)`,
        total_expenses: sql<number>`SUM(CASE WHEN type = 'expense' THEN amount::numeric ELSE 0 END)`,
      }).from(transactions);

      const income   = Number(totals.total_income   ?? 0);
      const expenses = Number(totals.total_expenses ?? 0);
      const profit   = income - expenses;

      const revenueByMonth = await db.select({
        month:   sql<string>`TO_CHAR(DATE_TRUNC('month', date::date), 'Mon')`,
        revenue: sql<number>`SUM(amount::numeric)`,
      }).from(transactions).where(and(
        eq(transactions.type, "income"),
        sql`${transactions.date} >= (CURRENT_DATE - INTERVAL '5 months')`,
      )).groupBy(sql`DATE_TRUNC('month', date::date)`)
        .orderBy(sql`DATE_TRUNC('month', date::date)`);

      const expenseByCategory = await db.select({
        name:  transactions.category,
        value: sql<number>`SUM(amount::numeric)`,
      }).from(transactions).where(and(
        eq(transactions.type, "expense"),
        sql`date >= ${periodStart}`,
        sql`date < ${nextMonth}`,
      )).groupBy(transactions.category).orderBy(sql`SUM(amount::numeric) DESC`);

      return {
        total_income:        income,
        total_expenses:      expenses,
        net_profit:          profit,
        profit_margin:       income > 0 ? Math.round((profit / income) * 100) : 0,
        revenue_by_month:    revenueByMonth,
        expense_by_category: expenseByCategory,
      };
    })(),

    // Tasks
    (async () => {
      const [counts] = await db.select({
        total:     sql<number>`COUNT(*)::int`,
        completed: sql<number>`SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)::int`,
        overdue:   sql<number>`SUM(CASE WHEN status != 'done' AND due_date < ${today} THEN 1 ELSE 0 END)::int`,
      }).from(tasks);

      const overdueItems = await db.select({
        task:         tasks,
        assigneeName: profiles.name,
      }).from(tasks)
        .leftJoin(profiles, eq(tasks.assigneeId, profiles.id))
        .where(and(
          not(eq(tasks.status, "done")),
          sql`${tasks.dueDate} < ${today}`,
        ))
        .orderBy(tasks.dueDate)
        .limit(5);

      const total     = Number(counts.total     ?? 0);
      const completed = Number(counts.completed ?? 0);
      const overdue   = Number(counts.overdue   ?? 0);

      return {
        total,
        completed,
        overdue,
        completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
        overdue_items: overdueItems.map(({ task, assigneeName }) => ({
          id:            task.id,
          title:         task.title,
          due_date:      task.dueDate,
          priority:      task.priority,
          assignee_name: assigneeName,
        })),
      };
    })(),

    // Leads
    (async () => {
      const [counts] = await db.select({
        total:          sql<number>`COUNT(*)::int`,
        active:         sql<number>`SUM(CASE WHEN stage NOT IN ('closed_won','closed_lost') THEN 1 ELSE 0 END)::int`,
        pipeline_value: sql<number>`SUM(CASE WHEN stage NOT IN ('closed_won','closed_lost') THEN deal_value::numeric ELSE 0 END)`,
      }).from(leads);

      return {
        total:          Number(counts.total          ?? 0),
        active:         Number(counts.active         ?? 0),
        pipeline_value: Number(counts.pipeline_value ?? 0),
      };
    })(),

    // Goals
    (async () => {
      const rows = await db.select().from(goals).orderBy(goals.createdAt);
      return rows.map((g) => {
        const current = Number(g.current ?? 0);
        const target  = Number(g.target);
        return {
          title:        g.title,
          current,
          target,
          progress_pct: target > 0 ? Math.min(Math.round((current / target) * 100), 100) : 0,
        };
      });
    })(),
  ]);

  return c.json({ finance: financeData, tasks: taskData, leads: leadData, goals: goalsData });
});

export default dashboard;
