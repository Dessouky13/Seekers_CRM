/**
 * Agency unit economics — the arithmetic behind the Economics page.
 *
 * ── Why this module exists ────────────────────────────────
 * Seekers bills retainers and pays for tools, and until now nothing joined the
 * two up. The finance module answers "what did we earn and spend", per period.
 * It cannot answer the three questions an agency owner actually asks:
 *
 *   1. What is each client really worth, and has one gone quiet?
 *   2. Where does the software bill go, and am I still paying for dead tools?
 *   3. Does the recurring revenue cover the fixed cost base?
 *
 * ── Why it is pure ────────────────────────────────────────
 * No db, no clock, no env. Every function takes rows and a `today` and returns
 * a plain object, so the maths is unit tested directly (economics.test.ts).
 * The route does the SQL; this file does the thinking.
 *
 * ── Why money is bigint ───────────────────────────────────
 * Every amount here is minor units via `money.ts`. Summing 164 `numeric(12,2)`
 * strings as JS floats drifts, and a margin that is a piastre out is a margin
 * someone will argue with. Amounts enter through `parseMoney` and leave through
 * `formatMoney` as strings — they are never a float in between.
 *
 * ── Scale note ────────────────────────────────────────────
 * These functions aggregate in TypeScript over rows the route has already
 * fetched, rather than in SQL. At this business's size (164 transactions in
 * ~11 months) that is a rounding error, and it buys exact bigint money and full
 * unit-testability. `MAX_ROWS` in the route bounds the fetch; if this agency
 * ever books six figures of transactions, the aggregation moves into SQL and
 * these functions keep their shape.
 */

import { parseMoney, formatMoney } from "./money";

// ── Inputs ────────────────────────────────────────────────

/** One completed transaction, exactly as the route selects it. */
export interface EconomicsTxn {
  /** `YYYY-MM-DD`, the Cairo calendar day the money moved. */
  date:       string;
  type:       "income" | "expense";
  /** `numeric(12,2)` as a string — never pre-converted to a number. */
  amount:     string;
  category:   string;
  clientId:   string | null;
  clientName: string | null;
  toolId:     string | null;
  currency:   string;
}

export interface EconomicsClient {
  id:     string;
  name:   string;
  company: string;
  status: string;
}

export interface EconomicsTool {
  id:     string;
  name:   string;
  vendor: string | null;
  kind:   string | null;
  active: boolean;
}

// ── Tunable thresholds, named so the UI can quote them ────

/**
 * A payment is "due" past 1.25x the client's own median gap and "lapsed" past
 * 2x it. Both are judgement calls, so they are constants with names rather than
 * magic numbers buried in a comparison, and the API returns them so the tooltip
 * can state the rule it is applying.
 */
export const DUE_RATIO    = 1.25;
export const LAPSED_RATIO = 2;

/**
 * Used only when a client has fewer than two payments, so no gap can be
 * measured. Flagged as `cadence_known: false` wherever it is applied — an
 * assumed 30 days must never be presented as an observed one.
 */
export const ASSUMED_GAP_DAYS = 30;

/**
 * A tool still flagged `active` whose last charge is older than this has
 * missed two monthly billing cycles. Either the subscription is gone and the
 * record is stale, or it is still being charged somewhere that is not being
 * recorded. Both are worth surfacing; neither is an assertion of waste.
 */
export const DORMANT_DAYS = 75;

/** The recurring-revenue window. 90 days smooths an irregular payment day. */
export const RUN_RATE_DAYS = 90;

/**
 * The one income category that represents contracted recurring revenue.
 * Matched case-insensitively against `transactions.category`.
 */
export const RECURRING_CATEGORY = "client recurring fee";

// ── Small helpers ─────────────────────────────────────────

/**
 * Whole days between two `YYYY-MM-DD` calendar days.
 *
 * Anchored at UTC midnight on both sides, so the result is a pure calendar
 * difference that no timezone can shift. These are already Cairo days — the
 * caller resolved that with `cairoToday()` — and re-interpreting them in a
 * local zone is what would introduce the off-by-one.
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Normalised key for matching a free-text `client_name` to a client record:
 * lowercased, trimmed, inner whitespace collapsed.
 *
 * Deliberately EXACT after normalisation — no fuzzy or prefix matching. This
 * database contains both "Rajac" and "Rajac Medical center" as separate paying
 * clients, and any substring rule merges them into one and silently doubles a
 * client's revenue.
 */
export function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Median of a numeric list. Even-length takes the mean of the middle pair. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Percentage of `part` in `whole`, 1dp, guarding a zero denominator. */
function pct(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Math.round(Number((part * 10000n) / whole)) / 100;
}

// ── Client resolution ─────────────────────────────────────

export type PaymentStatus = "current" | "due" | "lapsed" | "no_payments";

export interface RetainerClient {
  /** Client record id, or null for a name-only payer with no client row. */
  client_id:      string | null;
  name:           string;
  status:         string | null;
  /** All-time completed income resolved to this client. */
  revenue:        string;
  /** How much of `revenue` arrived only via the free-text `client_name`. */
  revenue_via_name: string;
  payments:       number;
  first_payment:  string | null;
  last_payment:   string | null;
  days_since_last_payment: number | null;
  /** Median days between consecutive payments, or the assumed default. */
  expected_gap_days: number;
  /** False when fewer than two payments exist and the gap is assumed. */
  cadence_known:  boolean;
  payment_status: PaymentStatus;
  /** Recurring-category income in the trailing `RUN_RATE_DAYS`. */
  recurring_90d:  string;
  /** `recurring_90d` expressed as a monthly figure. */
  monthly_run_rate: string;
  /** This client's share of all client-attributed revenue, %. */
  share_pct:      number;
}

/**
 * A `client_name` on an income row that matches no client record.
 *
 * Two very different things land here and the report cannot tell them apart,
 * which is exactly why they are listed for a human rather than folded into a
 * total: a real payer with no CRM record (this database has "Digitivia", who
 * has paid 10,000), and a bookkeeping row that is not a client at all (a
 * 77,339 "Starting 2026 amount" opening balance).
 */
export interface UnlinkedPayer {
  name:         string;
  amount:       string;
  payments:     number;
  last_payment: string | null;
  /** True when the name matched more than one client, so no winner was picked. */
  ambiguous:    boolean;
}

export interface RetainerReport {
  clients: RetainerClient[];
  /** Named payers with no client record — for triage, not for totals. */
  unlinked_payers:     UnlinkedPayer[];
  unlinked_total:      string;
  /** Income with no client id and no name at all. */
  unattributed_income: string;
  unattributed_count:  number;
  /** Sum of every matched client's `revenue`. The denominator for `share_pct`. */
  attributed_revenue:  string;
  /** Combined share of the two largest clients — concentration risk. */
  top_two_share_pct:   number;
  thresholds: { due_ratio: number; lapsed_ratio: number; assumed_gap_days: number };
}

/**
 * Per-client revenue truth and payment health.
 *
 * ── What counts ───────────────────────────────────────────
 * A completed income transaction is attributed to a client when EITHER
 * `client_id` points at a client row, OR `client_name` normalises to exactly
 * one client's `name` or `company`. The second rule is not a nicety: on this
 * database 137,800 EGP of real client revenue carries only the text name, so a
 * report keyed on `client_id` alone shows Rajac at 44,000 when it has paid
 * 109,800.
 *
 * ── What is excluded, and why it is still shown ───────────
 * A `client_name` matching no client record does NOT become a client row. It is
 * listed separately as an `UnlinkedPayer`. The temptation is to synthesise a
 * client from the name, and it is a trap: this database's largest such name is
 * "Starting 2026 amount", a 77,339 opening balance, which would have become the
 * agency's single biggest "client" and taken 40% of the revenue-share pie with
 * it. The report cannot tell an opening balance from a real payer, so it
 * refuses to guess and asks a human to look.
 *
 * Income with neither an id nor any name is `unattributed_income`.
 *
 * Neither pot counts toward `attributed_revenue`, which is what `share_pct`
 * divides by — a share is only meaningful when its denominator is one
 * population, and "known clients" is that population.
 *
 * Expenses are not touched here. See `buildCostBase` — and see FEATURES-NEW.md
 * for why per-client cost is not computed at all.
 */
export function buildRetainerReport(
  txns:    EconomicsTxn[],
  clients: EconomicsClient[],
  today:   string,
): RetainerReport {
  // Normalised text -> client, in two TIERS: `name` is tried before `company`.
  //
  // The tiers are not cosmetic. In this database two different clients are
  // called "Rajac" and "Rajac Medical center", and BOTH carry company "Rajac".
  // A single flat map makes the key "rajac" ambiguous and rejects 65,800 EGP of
  // Rajac's revenue — the precise money this report exists to recover. Matching
  // `name` first resolves it unambiguously, because only one client is *named*
  // Rajac, and the company collision never gets consulted.
  //
  // Within a tier, a key shared by two clients is still refused (stored as
  // null): guessing between two real clients is worse than declining to.
  const byName    = new Map<string, EconomicsClient | null>();
  const byCompany = new Map<string, EconomicsClient | null>();
  const claim = (map: Map<string, EconomicsClient | null>, key: string, client: EconomicsClient) => {
    if (!key) return;
    const seen = map.get(key);
    if (seen === undefined)          map.set(key, client);
    else if (seen?.id !== client.id) map.set(key, null);      // ambiguous within tier
  };
  for (const client of clients) {
    claim(byName,    nameKey(client.name),    client);
    claim(byCompany, nameKey(client.company), client);
  }
  const byId = new Map(clients.map((client) => [client.id, client]));

  /**
   * Tier 1 (`name`), then tier 2 (`company`).
   * Returns a client, `null` for ambiguous, or `undefined` for no match.
   *
   * An AMBIGUOUS tier stops the search rather than falling through. If two
   * clients are both named "Acme", the text "Acme" genuinely identifies two
   * clients, and consulting their companies to break the tie is picking a
   * winner on evidence the transaction never offered. Only a tier that is
   * SILENT — no client uses that text at all — falls through.
   */
  const resolveByText = (raw: string): EconomicsClient | null | undefined => {
    const key   = nameKey(raw);
    const tier1 = byName.get(key);
    if (tier1 !== undefined) return tier1;          // hit, or an explicit refusal
    return byCompany.get(key);
  };

  interface Bucket {
    clientId: string | null;
    name:     string;
    status:   string | null;
    total:    bigint;
    viaName:  bigint;
    recurring90: bigint;
    dates:    string[];
  }
  const buckets = new Map<string, Bucket>();
  let unattributed      = 0n;
  let unattributedCount = 0;

  interface Unlinked { name: string; total: bigint; payments: number; dates: string[]; ambiguous: boolean }
  const unlinked = new Map<string, Unlinked>();

  const bucketFor = (
    key: string, clientId: string | null, name: string, status: string | null,
  ): Bucket => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { clientId, name, status, total: 0n, viaName: 0n, recurring90: 0n, dates: [] };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  for (const txn of txns) {
    if (txn.type !== "income") continue;
    const amount = parseMoney(txn.amount, "transaction amount");

    // 1. A real foreign key always wins.
    let client: EconomicsClient | undefined = txn.clientId ? byId.get(txn.clientId) : undefined;
    let viaName   = false;
    let ambiguous = false;

    // 2. Otherwise fall back to the text name, exact after normalisation.
    if (!client && txn.clientName) {
      const matched = resolveByText(txn.clientName);
      if (matched)               { client = matched; viaName = true; }
      else if (matched === null) ambiguous = true;    // shared key, no tie-break
    }

    if (client) {
      const bucket = bucketFor(client.id, client.id, client.name, client.status);
      bucket.total += amount;
      if (viaName) bucket.viaName += amount;
      bucket.dates.push(txn.date);
      if (isRecurring(txn) && daysBetween(txn.date, today) <= RUN_RATE_DAYS) {
        bucket.recurring90 += amount;
      }
      continue;
    }

    // 3. A name matching no client record. Listed for triage, never invented
    //    into a client — see the doc comment for the opening-balance trap.
    const raw = txn.clientName?.trim();
    if (raw) {
      const key = nameKey(raw);
      let row   = unlinked.get(key);
      if (!row) { row = { name: raw, total: 0n, payments: 0, dates: [], ambiguous }; unlinked.set(key, row); }
      row.total    += amount;
      row.payments += 1;
      row.dates.push(txn.date);
      if (ambiguous) row.ambiguous = true;
      continue;
    }

    // 4. Nobody at all.
    unattributed += amount;
    unattributedCount += 1;
  }

  // Clients with a record but no income still deserve a row — "this client has
  // never paid" is exactly the kind of thing a revenue page should not hide.
  for (const client of clients) {
    if (!buckets.has(client.id)) {
      bucketFor(client.id, client.id, client.name, client.status);
    }
  }

  const attributed = [...buckets.values()].reduce((sum, b) => sum + b.total, 0n);

  const rows: RetainerClient[] = [...buckets.values()].map((bucket) => {
    const dates = [...bucket.dates].sort();
    const first = dates[0] ?? null;
    const last  = dates[dates.length - 1] ?? null;

    const gaps = dates.slice(1).map((date, i) => daysBetween(dates[i], date));
    const cadenceKnown = gaps.length > 0;
    const expectedGap  = cadenceKnown ? Math.max(1, median(gaps)) : ASSUMED_GAP_DAYS;

    const daysSince = last === null ? null : daysBetween(last, today);
    const monthly   = (bucket.recurring90 * 30n) / BigInt(RUN_RATE_DAYS);

    return {
      client_id:        bucket.clientId,
      name:             bucket.name,
      status:           bucket.status,
      revenue:          formatMoney(bucket.total),
      revenue_via_name: formatMoney(bucket.viaName),
      payments:         dates.length,
      first_payment:    first,
      last_payment:     last,
      days_since_last_payment: daysSince,
      expected_gap_days: expectedGap,
      cadence_known:    cadenceKnown,
      payment_status:   paymentStatus(daysSince, expectedGap),
      recurring_90d:    formatMoney(bucket.recurring90),
      monthly_run_rate: formatMoney(monthly),
      share_pct:        pct(bucket.total, attributed),
    };
  });

  // Largest first: this page is read top-down and the biggest client is the
  // one whose silence matters most.
  rows.sort((a, b) => {
    const diff = parseMoney(b.revenue) - parseMoney(a.revenue);
    return diff === 0n ? a.name.localeCompare(b.name) : diff > 0n ? 1 : -1;
  });

  const topTwo = rows.slice(0, 2).reduce((sum, r) => sum + parseMoney(r.revenue), 0n);

  const unlinkedRows: UnlinkedPayer[] = [...unlinked.values()]
    .map((row) => {
      const dates = [...row.dates].sort();
      return {
        name:         row.name,
        amount:       formatMoney(row.total),
        payments:     row.payments,
        last_payment: dates[dates.length - 1] ?? null,
        ambiguous:    row.ambiguous,
      };
    })
    .sort((a, b) => (parseMoney(b.amount) > parseMoney(a.amount) ? 1 : -1));

  return {
    clients:             rows,
    unlinked_payers:     unlinkedRows,
    unlinked_total:      formatMoney([...unlinked.values()].reduce((sum, r) => sum + r.total, 0n)),
    unattributed_income: formatMoney(unattributed),
    unattributed_count:  unattributedCount,
    attributed_revenue:  formatMoney(attributed),
    top_two_share_pct:   pct(topTwo, attributed),
    thresholds: {
      due_ratio:        DUE_RATIO,
      lapsed_ratio:     LAPSED_RATIO,
      assumed_gap_days: ASSUMED_GAP_DAYS,
    },
  };
}

function isRecurring(txn: EconomicsTxn): boolean {
  return txn.category.trim().toLowerCase() === RECURRING_CATEGORY;
}

/**
 * Payment health, measured against the client's OWN rhythm rather than a fixed
 * calendar month. Backyard pays around the 19th and Rajac around the 5th; a
 * flat "30 days" rule would nag one of them every month and never the other.
 */
export function paymentStatus(daysSince: number | null, expectedGap: number): PaymentStatus {
  if (daysSince === null) return "no_payments";
  if (daysSince > expectedGap * LAPSED_RATIO) return "lapsed";
  if (daysSince > expectedGap * DUE_RATIO)    return "due";
  return "current";
}

// ── Cost base and tool spend ──────────────────────────────

export interface ToolSpend {
  tool_id:   string | null;
  name:      string;
  vendor:    string | null;
  kind:      string | null;
  active:    boolean;
  spend:     string;
  charges:   number;
  first_charge: string | null;
  last_charge:  string | null;
  days_since_last_charge: number | null;
  /** Still marked active but silent for longer than `DORMANT_DAYS`. */
  dormant:   boolean;
  /** Share of total tool spend, %. */
  share_pct: number;
}

export interface CostBaseReport {
  total_expenses:   string;
  /** Expenses grouped by the primary `category`, which owns the amount. */
  by_category:      { category: string; amount: string; share_pct: number }[];
  tool_spend:       string;
  /** Tool spend as a share of total expenses, %. */
  tool_share_pct:   number;
  tools:            ToolSpend[];
  dormant_tools:    number;
  /** Mean monthly expense across whole months observed. */
  monthly_cost_base: string;
  months_observed:  number;
  thresholds:       { dormant_days: number };
}

/**
 * Where the money goes.
 *
 * ── The monthly cost base ─────────────────────────────────
 * Total expenses divided by the number of whole months between the first and
 * last expense. It is a MEAN, not a forecast: a single 20,000 one-off lifts it,
 * and it makes no attempt to separate fixed from variable cost — nothing in the
 * data marks that distinction, and inventing one would be guessing.
 *
 * ── Tool attribution ──────────────────────────────────────
 * A tool's spend is the sum of expenses carrying its `tool_id`. Expenses in the
 * "Tools" category with no `tool_id` are counted in `total_expenses` and in
 * `by_category`, but not against any named tool, so the tool table can total to
 * less than the Tools category. That gap is real and visible rather than
 * smeared across the named tools.
 */
export function buildCostBase(
  txns:  EconomicsTxn[],
  tools: EconomicsTool[],
  today: string,
): CostBaseReport {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));

  let total = 0n;
  const categories = new Map<string, bigint>();
  const spend = new Map<string, { total: bigint; charges: number; dates: string[] }>();
  const expenseDates: string[] = [];

  for (const txn of txns) {
    if (txn.type !== "expense") continue;
    const amount = parseMoney(txn.amount, "transaction amount");
    total += amount;
    expenseDates.push(txn.date);

    const category = txn.category.trim() || "Uncategorised";
    categories.set(category, (categories.get(category) ?? 0n) + amount);

    if (txn.toolId) {
      let row = spend.get(txn.toolId);
      if (!row) { row = { total: 0n, charges: 0, dates: [] }; spend.set(txn.toolId, row); }
      row.total   += amount;
      row.charges += 1;
      row.dates.push(txn.date);
    }
  }

  const toolTotal = [...spend.values()].reduce((sum, row) => sum + row.total, 0n);

  const toolRows: ToolSpend[] = [...spend.entries()].map(([toolId, row]) => {
    const tool  = byId.get(toolId);
    const dates = [...row.dates].sort();
    const last  = dates[dates.length - 1] ?? null;
    const since = last === null ? null : daysBetween(last, today);
    const active = tool?.active ?? true;

    return {
      tool_id:   toolId,
      name:      tool?.name   ?? "Unknown tool",
      vendor:    tool?.vendor ?? null,
      kind:      tool?.kind   ?? null,
      active,
      spend:     formatMoney(row.total),
      charges:   row.charges,
      first_charge: dates[0] ?? null,
      last_charge:  last,
      days_since_last_charge: since,
      dormant:   active && since !== null && since > DORMANT_DAYS,
      share_pct: pct(row.total, toolTotal),
    };
  });

  toolRows.sort((a, b) => {
    const diff = parseMoney(b.spend) - parseMoney(a.spend);
    return diff === 0n ? a.name.localeCompare(b.name) : diff > 0n ? 1 : -1;
  });

  const months = wholeMonthsObserved(expenseDates);

  return {
    total_expenses: formatMoney(total),
    by_category: [...categories.entries()]
      .map(([category, amount]) => ({ category, amount: formatMoney(amount), share_pct: pct(amount, total) }))
      .sort((a, b) => (parseMoney(b.amount) > parseMoney(a.amount) ? 1 : -1)),
    tool_spend:     formatMoney(toolTotal),
    tool_share_pct: pct(toolTotal, total),
    tools:          toolRows,
    dormant_tools:  toolRows.filter((t) => t.dormant).length,
    monthly_cost_base: formatMoney(months > 0 ? total / BigInt(months) : total),
    months_observed:   months,
    thresholds:        { dormant_days: DORMANT_DAYS },
  };
}

/**
 * How many whole months the expense history spans, minimum 1.
 *
 * Rounding up a part-month would divide by a period longer than the data
 * actually covers and understate the monthly cost base — the direction that
 * flatters the business, which is the wrong way for a cost figure to be wrong.
 */
export function wholeMonthsObserved(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...dates].sort();
  const days   = daysBetween(sorted[0], sorted[sorted.length - 1]);
  return Math.max(1, Math.floor(days / 30.44) || 1);
}

// ── Coverage ──────────────────────────────────────────────

export interface CoverageReport {
  /** Recurring income in the trailing window, restated per month. */
  monthly_recurring_revenue: string;
  monthly_cost_base:         string;
  /** MRR as a percentage of the monthly cost base. 100 = break-even. */
  coverage_pct:              number;
  /** MRR − cost base. Negative means the retainers do not pay the bills. */
  monthly_surplus:           string;
  window_days:               number;
  /** Clients contributing to MRR in the window. */
  contributing_clients:      number;
}

/**
 * The survival number: does contracted recurring revenue cover the cost base?
 *
 * ── Definition ────────────────────────────────────────────
 *   MRR       = income in category "Client Recurring Fee" over the trailing 90
 *               days, x 30/90.
 *   cost base = mean monthly expense over the whole observed history.
 *
 * The two sides use deliberately different windows, and that is the honest
 * choice rather than an oversight. Revenue uses 90 days because what matters is
 * what is being billed NOW — a client who churned in January should not prop up
 * today's coverage. Cost uses the full history because the expense record is
 * lumpy (annual domains, irregular tool invoices) and a 90-day cost window
 * swings wildly with whatever happened to be invoiced. Both windows are
 * returned so the UI can state them.
 *
 * Setup fees are excluded: they are one-off, and counting them as recurring is
 * how an agency convinces itself a project business is a retainer business.
 */
export function buildCoverage(
  retainers: RetainerReport,
  costs:     CostBaseReport,
): CoverageReport {
  const mrr  = retainers.clients.reduce((sum, c) => sum + parseMoney(c.monthly_run_rate), 0n);
  const base = parseMoney(costs.monthly_cost_base);

  return {
    monthly_recurring_revenue: formatMoney(mrr),
    monthly_cost_base:         formatMoney(base),
    coverage_pct:              pct(mrr, base),
    monthly_surplus:           formatMoney(mrr - base),
    window_days:               RUN_RATE_DAYS,
    contributing_clients:      retainers.clients.filter((c) => parseMoney(c.recurring_90d) > 0n).length,
  };
}

// ── Data quality ──────────────────────────────────────────

export interface DataQuality {
  /** Income rows resolving to no client. */
  unattributed_income_count:  number;
  unattributed_income_amount: string;
  /** Expense rows carrying a client — the reason per-client cost is not shown. */
  client_attributed_expense_count: number;
  expense_count:                   number;
  /** Rows whose currency is not the reporting currency. */
  foreign_currency_count: number;
  reporting_currency:     string;
  /** "Tools" category spend with no `tool_id`, so attributable to no vendor. */
  untagged_tool_spend:    string;
}

/**
 * The caveats, computed rather than asserted.
 *
 * Every number on the Economics page rests on assumptions about messy data, and
 * a metric that hides its own caveats is worse than no metric. These counts are
 * rendered next to the figures they qualify, so the reader can see exactly how
 * much of the picture is estimated.
 *
 * `foreign_currency_count` deserves its own note. This database has 60 rows
 * tagged USD, but their magnitudes match the EGP rows exactly — salaries of
 * "7,000 USD" alongside salaries of 7,000 EGP, tool invoices of "8,024 USD"
 * alongside 8,000 EGP. They are EGP amounts with the wrong currency tag, so
 * every total here treats all amounts as the reporting currency. Converting
 * them at a real rate would inflate the cost base roughly fiftyfold. The count
 * is surfaced so the mis-tagging gets fixed at source rather than silently
 * carried by every report that reads this table.
 */
export function buildDataQuality(
  txns: EconomicsTxn[],
  retainers: RetainerReport,
  reportingCurrency: string,
): DataQuality {
  let expenses = 0, clientExpenses = 0, foreign = 0, untaggedTools = 0n;

  for (const txn of txns) {
    if (txn.currency.trim().toUpperCase() !== reportingCurrency) foreign += 1;
    if (txn.type !== "expense") continue;
    expenses += 1;
    if (txn.clientId) clientExpenses += 1;
    if (txn.category.trim().toLowerCase() === "tools" && !txn.toolId) {
      untaggedTools += parseMoney(txn.amount, "transaction amount");
    }
  }

  return {
    unattributed_income_count:  retainers.unattributed_count,
    unattributed_income_amount: retainers.unattributed_income,
    client_attributed_expense_count: clientExpenses,
    expense_count:              expenses,
    foreign_currency_count:     foreign,
    reporting_currency:         reportingCurrency,
    untagged_tool_spend:        formatMoney(untaggedTools),
  };
}
