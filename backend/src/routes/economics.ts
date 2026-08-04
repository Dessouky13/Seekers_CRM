/**
 * GET /economics/summary — agency unit economics.
 *
 * One endpoint, one round trip, three answers: what each client is really
 * worth, where the cost base goes, and whether recurring revenue covers it.
 * The maths lives in `services/economics.ts` (pure, unit tested); this file
 * only fetches rows and hands them over.
 *
 * Admin-gated at the module level in `index.ts` alongside /finance and
 * /clients — every figure here is revenue, cost or margin.
 */
import { Hono } from "hono";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { transactions, clients, tools } from "../db/schema";
import { cairoToday } from "../utils/dates";
import {
  buildRetainerReport, buildCostBase, buildCoverage, buildDataQuality,
  type EconomicsTxn,
} from "../services/economics";
import type { AppEnv } from "../types";

const economics = new Hono<AppEnv>();

/**
 * The reporting currency. Every amount is treated as this regardless of the
 * row's `currency` column — see `buildDataQuality` for why that is the correct
 * reading of this dataset rather than a shortcut, and note that the response
 * reports how many rows disagree so the mis-tagging stays visible.
 */
const REPORTING_CURRENCY = (process.env.REPORTING_CURRENCY ?? "EGP").toUpperCase();

/**
 * Aggregation happens in TypeScript over fetched rows (exact bigint money,
 * fully unit tested). This bounds the fetch so a runaway dataset degrades into
 * a truncated report rather than an out-of-memory process. The response says
 * when it has been hit, so a silently partial number is impossible.
 */
const MAX_ROWS = 20_000;

const querySchema = z.object({
  /**
   * Optional inclusive lower bound, `YYYY-MM-DD`. Omitted means all history,
   * which is the default because a cost base averaged over a short window
   * swings wildly with whatever happened to be invoiced in it.
   */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD").optional(),
});

economics.get("/summary", async (c) => {
  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid query" }, 400);
  }
  const { from } = parsed.data;

  // Only `completed` rows. Pending and cancelled transactions are intentions,
  // not money that moved, and counting them would overstate both sides.
  const where = from
    ? and(eq(transactions.status, "completed"), gte(transactions.date, from))
    : eq(transactions.status, "completed");

  const [txnRows, clientRows, toolRows] = await Promise.all([
    db.select({
        date:       transactions.date,
        type:       transactions.type,
        amount:     transactions.amount,
        category:   transactions.category,
        clientId:   transactions.clientId,
        clientName: transactions.clientName,
        toolId:     transactions.toolId,
        currency:   transactions.currency,
      })
      .from(transactions)
      .where(where)
      .orderBy(sql`${transactions.date} ASC`)
      .limit(MAX_ROWS),
    db.select({
        id: clients.id, name: clients.name, company: clients.company, status: clients.status,
      }).from(clients),
    db.select({
        id: tools.id, name: tools.name, vendor: tools.vendor, kind: tools.kind, active: tools.active,
      }).from(tools),
  ]);

  const txns = txnRows as EconomicsTxn[];
  const today = cairoToday();

  const retainers = buildRetainerReport(txns, clientRows, today);
  const costs     = buildCostBase(txns, toolRows, today);
  const coverage  = buildCoverage(retainers, costs);
  const quality   = buildDataQuality(txns, retainers, REPORTING_CURRENCY);

  return c.json({
    as_of:      today,
    currency:   REPORTING_CURRENCY,
    from:       from ?? null,
    retainers,
    costs,
    coverage,
    data_quality: quality,
    truncated:  txns.length >= MAX_ROWS,
  });
});

export default economics;
