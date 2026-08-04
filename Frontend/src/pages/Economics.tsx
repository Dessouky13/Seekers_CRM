// Economics — the three questions the finance page cannot answer:
// what each client is really worth, where the cost base goes, and whether the
// recurring revenue covers it.
//
// ── A note on honesty ─────────────────────────────────────
// Every figure here is derived from messy real data, and the page states its
// own definitions and caveats inline rather than in a document nobody opens.
// The `Definition` disclosures and the "How these numbers are built" panel are
// load-bearing, not decoration: a margin whose denominator is unstated is a
// number someone will act on and then be wrong about.
//
// ── Mobile ────────────────────────────────────────────────
// Phone is the primary device. Everything is a single column that opts into
// extra columns at `sm`/`lg`; bars are CSS width percentages so they stay
// legible at 375px; the one chart is horizontal, because 19 vendor names cannot
// be read on a vertical axis on a phone.
import { useMemo, useState } from "react";
import {
  TrendingUp, TrendingDown, Wallet, Users, Wrench, AlertTriangle,
  Info, CircleSlash, Link2Off,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { QueryError } from "@/components/QueryError";
import {
  useEconomics, fmtMoney,
  type EconomicsClientRow, type PaymentStatus, type ToolSpendRow,
} from "@/hooks/useEconomics";
import { cn } from "@/lib/utils";

export default function Economics() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useEconomics();

  if (isLoading) return <EconomicsSkeleton />;
  // Before the `!data` branch: on a failed request data is also undefined, so
  // "no data yet" is what a 500 would otherwise look like.
  if (isError) {
    return (
      <div className="p-4 sm:p-6">
        <QueryError what="the economics report" error={error} onRetry={refetch} isRetrying={isRefetching} variant="page" />
      </div>
    );
  }
  if (!data) return null;

  const { retainers, costs, coverage, data_quality: dq, currency } = data;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Economics</h1>
        <p className="text-sm text-muted-foreground">
          What each client is worth, where the money goes, and whether the retainers cover it.
          {" "}All amounts in {currency}, as of {data.as_of}.
        </p>
      </header>

      {data.truncated && (
        <Callout tone="warning" icon={AlertTriangle} title="Partial report">
          The row limit was reached, so these totals cover only part of the transaction history.
        </Callout>
      )}

      <CoveragePanel coverage={coverage} costs={costs} />
      <RetainerPanel retainers={retainers} />
      <CostPanel costs={costs} currency={currency} />
      <MethodPanel retainers={retainers} costs={costs} coverage={coverage} dq={dq} />
    </div>
  );
}

// ── Panel 1: coverage ─────────────────────────────────────

/**
 * The survival number. Deliberately the first thing on the page: for a business
 * running at a ~10% operating margin, whether recurring revenue clears the cost
 * base matters more than any individual client's figure.
 */
function CoveragePanel({
  coverage, costs,
}: {
  coverage: EconomicsSummaryOf["coverage"];
  costs:    EconomicsSummaryOf["costs"];
}) {
  const pct      = coverage.coverage_pct;
  const positive = !coverage.monthly_surplus.startsWith("-");
  // Cap the bar at 100% of its track so a 300% month does not overflow, while
  // the number itself still reads 300%.
  const barPct   = Math.max(0, Math.min(100, pct));

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Recurring coverage
          </h2>
          <p className="text-xs text-muted-foreground">
            Do the monthly retainers pay the monthly bills?
          </p>
        </div>
        <div className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          positive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
        )}>
          {positive ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn(
          "text-4xl font-semibold tabular-nums",
          positive ? "text-success" : "text-destructive",
        )}>
          {pct}%
        </span>
        <span className="text-sm text-muted-foreground">
          of the cost base covered
        </span>
      </div>

      {/* Break-even marker at 100%, so "covered" is a position, not a claim. */}
      <div className="space-y-1.5">
        <div className="relative h-2.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", positive ? "bg-success" : "bg-destructive")}
            style={{ width: `${barPct}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          The full bar is break-even (100%).
        </p>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Figure
          label={`Recurring revenue / mo`}
          value={fmtMoney(coverage.monthly_recurring_revenue)}
        />
        <Figure
          label="Cost base / mo"
          value={fmtMoney(coverage.monthly_cost_base)}
        />
        <Figure
          label={positive ? "Surplus / mo" : "Shortfall / mo"}
          value={fmtMoney(coverage.monthly_surplus)}
          tone={positive ? "positive" : "negative"}
        />
      </dl>

      <Definition>
        <strong>Recurring revenue</strong> is income categorised “Client Recurring Fee” over the
        last {coverage.window_days} days, restated per month ({coverage.contributing_clients} client
        {coverage.contributing_clients === 1 ? "" : "s"} contributing). Setup fees are excluded —
        they are one-off, and counting them makes a project business look like a retainer business.
        {" "}<strong>Cost base</strong> is the mean monthly expense across all
        {" "}{costs.months_observed} month{costs.months_observed === 1 ? "" : "s"} of recorded
        history, not a forecast. The two windows differ on purpose: revenue should reflect what is
        billed <em>now</em>, while a 90-day cost window swings wildly with whatever happened to be
        invoiced in it.
      </Definition>
    </section>
  );
}

// ── Panel 2: retainer health ──────────────────────────────

function RetainerPanel({ retainers }: { retainers: EconomicsSummaryOf["retainers"] }) {
  const attention = retainers.clients.filter(
    (c) => c.payment_status === "due" || c.payment_status === "lapsed",
  );

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Clients &amp; retainer health
          </h2>
          <p className="text-xs text-muted-foreground">
            What each client has really paid, and who has gone quiet.
          </p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Users className="h-5 w-5" />
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Figure label="Attributed revenue" value={fmtMoney(retainers.attributed_revenue)} />
        <Figure label="Top 2 clients" value={`${retainers.top_two_share_pct}%`} />
        <Figure label="Needs a nudge" value={String(attention.length)}
          tone={attention.length > 0 ? "negative" : "neutral"} />
      </dl>

      {attention.length > 0 && (
        <Callout tone="warning" icon={AlertTriangle} title="Payments overdue against their own rhythm">
          {attention.map((c) => c.name).join(", ")}
        </Callout>
      )}

      {retainers.clients.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No clients recorded yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {retainers.clients.map((client) => (
            <ClientRow key={client.client_id ?? client.name} client={client} />
          ))}
        </ul>
      )}

      {retainers.unlinked_payers.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-3.5 space-y-2.5">
          <div className="flex items-center gap-2">
            <Link2Off className="h-4 w-4 text-muted-foreground shrink-0" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Money with no client record — {fmtMoney(retainers.unlinked_total)}
            </h3>
          </div>
          <ul className="space-y-1.5">
            {retainers.unlinked_payers.map((payer) => (
              <li key={payer.name} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
                <span className="text-foreground break-words">
                  {payer.name}
                  {payer.ambiguous && (
                    <Badge variant="outline" className="ml-2 text-[10px]">matches 2 clients</Badge>
                  )}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {fmtMoney(payer.amount)}
                  <span className="ml-1.5 text-xs">
                    ({payer.payments} payment{payer.payments === 1 ? "" : "s"})
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            These income rows name a payer that matches no client record, so they are
            {" "}<strong>excluded</strong> from every client figure above. Two different things land
            here and the report cannot tell them apart: a real client who was never added to the
            CRM, and a bookkeeping row that is not a client at all (an opening balance). Worth a
            look — either add the client or recategorise the row.
          </p>
        </div>
      )}

      <Definition>
        <strong>Revenue</strong> is all completed income matched to the client, either by its
        client link or by its typed client name. That second rule is why these figures can exceed
        what the Clients page shows: a large share of this agency’s income carries only the typed
        name. Matching is exact after normalising case and spacing — never fuzzy, because
        “Rajac” and “Rajac Medical center” are two different clients.
        {" "}<strong>Health</strong> compares the days since the last payment to that client’s own
        median gap: over {retainers.thresholds.due_ratio}× is <em>due</em>, over
        {" "}{retainers.thresholds.lapsed_ratio}× is <em>lapsed</em>. With fewer than two payments
        no gap can be measured and {retainers.thresholds.assumed_gap_days} days is assumed, shown
        as “assumed”. Nothing here counts costs — see the method note below.
      </Definition>
    </section>
  );
}

function ClientRow({ client }: { client: EconomicsClientRow }) {
  const viaName = client.revenue_via_name !== "0.00" && client.revenue_via_name !== "0";

  return (
    <li className="rounded-lg border border-border bg-background/40 p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground break-words">{client.name}</p>
          <p className="text-xs text-muted-foreground">
            {client.payments} payment{client.payments === 1 ? "" : "s"}
            {client.last_payment && ` · last ${client.last_payment}`}
            {client.days_since_last_payment !== null && ` (${client.days_since_last_payment}d ago)`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-semibold tabular-nums text-foreground">{fmtMoney(client.revenue)}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{client.share_pct}% of revenue</p>
        </div>
      </div>

      {/* Share of total revenue as a CSS bar — legible at any width. */}
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.min(100, client.share_pct)}%` }} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <PaymentBadge status={client.payment_status} />
        <Badge variant="outline" className="text-[10px] font-normal">
          every ~{client.expected_gap_days}d{client.cadence_known ? "" : " (assumed)"}
        </Badge>
        {client.monthly_run_rate !== "0.00" && (
          <Badge variant="outline" className="text-[10px] font-normal tabular-nums">
            {fmtMoney(client.monthly_run_rate)}/mo
          </Badge>
        )}
        {viaName && (
          <Badge variant="outline" className="text-[10px] font-normal tabular-nums">
            {fmtMoney(client.revenue_via_name)} matched by name
          </Badge>
        )}
      </div>
    </li>
  );
}

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  current:     "Current",
  due:         "Due",
  lapsed:      "Lapsed",
  no_payments: "Never paid",
};

function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px]", {
        "border-success/40 bg-success/10 text-success":             status === "current",
        "border-warning/40 bg-warning/10 text-warning":            status === "due",
        "border-destructive/40 bg-destructive/10 text-destructive": status === "lapsed",
        "text-muted-foreground":                                   status === "no_payments",
      })}
    >
      {PAYMENT_LABEL[status]}
    </Badge>
  );
}

// ── Panel 3: cost base and tools ──────────────────────────

const TOOLS_COLLAPSED = 8;

function CostPanel({
  costs, currency,
}: {
  costs:    EconomicsSummaryOf["costs"];
  currency: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const dormant = costs.tools.filter((t) => t.dormant);
  const shown   = expanded ? costs.tools : costs.tools.slice(0, TOOLS_COLLAPSED);

  // Recharts wants numbers, and only for the bar geometry — every rendered
  // figure still comes from the exact string the server sent.
  const chartData = useMemo(
    () => shown.map((tool) => ({
      name: tool.name, value: Number(tool.spend), label: fmtMoney(tool.spend), dormant: tool.dormant,
    })),
    [shown],
  );

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Cost base &amp; tool spend
          </h2>
          <p className="text-xs text-muted-foreground">Where the money actually goes.</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Wrench className="h-5 w-5" />
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Figure label="Total expenses" value={fmtMoney(costs.total_expenses)} />
        <Figure label="Tool spend" value={`${fmtMoney(costs.tool_spend)} (${costs.tool_share_pct}%)`} />
        <Figure label="Quiet subscriptions" value={String(costs.dormant_tools)}
          tone={costs.dormant_tools > 0 ? "negative" : "neutral"} />
      </dl>

      {/* Category split as CSS bars — four rows, no chart needed. */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          By category
        </h3>
        {costs.by_category.map((row) => (
          <div key={row.category} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-foreground">{row.category}</span>
              <span className="tabular-nums text-muted-foreground">
                {fmtMoney(row.amount)} <span className="text-xs">({row.share_pct}%)</span>
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary/60" style={{ width: `${Math.min(100, row.share_pct)}%` }} />
            </div>
          </div>
        ))}
      </div>

      {dormant.length > 0 && (
        <Callout tone="warning" icon={CircleSlash} title={`${dormant.length} tool${dormant.length === 1 ? "" : "s"} marked active with no recent charge`}>
          {dormant.map((t) => `${t.name} (${t.days_since_last_charge}d)`).join(", ")}
          <span className="block mt-1.5 text-[11px] opacity-90">
            Either the subscription is gone and the record is stale, or it is still being charged
            somewhere that is not being recorded. Annually-billed items — domains especially —
            legitimately appear here.
          </span>
        </Callout>
      )}

      {costs.tools.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Spend by tool
          </h3>
          {/* Horizontal bars: 19 vendor names are unreadable on a vertical axis
              at 375px. Height scales with row count so labels never collide. */}
          <div style={{ height: Math.max(160, chartData.length * 34) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category" dataKey="name" width={96}
                  tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
                  interval={0}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
                  contentStyle={{
                    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                    borderRadius: 8, fontSize: 12,
                  }}
                  formatter={(_v, _n, item) => [`${currency} ${item.payload.label}`, "Spend"]}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                  {chartData.map((row) => (
                    <Cell
                      key={row.name}
                      fill={row.dormant ? "hsl(var(--muted-foreground))" : "hsl(var(--primary))"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {costs.tools.length > TOOLS_COLLAPSED && (
            <Button
              variant="outline" size="sm"
              className="w-full min-h-[44px]"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show top 8 only" : `Show all ${costs.tools.length} tools`}
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">
            Grey bars are subscriptions with no charge in the last {costs.thresholds.dormant_days} days.
          </p>
        </div>
      )}

      <Definition>
        <strong>Tool spend</strong> is expenses carrying that tool’s link. Expenses in the “Tools”
        category with no tool attached are counted in the total and the category split but against
        no named vendor, so the tool list can add up to less than the Tools category — that gap is
        left visible rather than smeared across the named tools.
        {" "}<strong>Quiet</strong> means still marked active with no charge for over
        {" "}{costs.thresholds.dormant_days} days, i.e. two missed monthly cycles. It is a
        prompt to check, not a claim of waste.
      </Definition>
    </section>
  );
}

// ── Panel 4: how the numbers are built ────────────────────

/**
 * The caveats, computed from the data rather than asserted in prose. This panel
 * is the reason the rest of the page can be trusted: it states exactly what is
 * missing, and it is the honest answer to the question this module deliberately
 * does NOT try to answer (per-client profit).
 */
function MethodPanel({
  retainers, costs, coverage, dq,
}: {
  retainers: EconomicsSummaryOf["retainers"];
  costs:     EconomicsSummaryOf["costs"];
  coverage:  EconomicsSummaryOf["coverage"];
  dq:        EconomicsSummaryOf["data_quality"];
}) {
  const attributedPct = dq.expense_count > 0
    ? Math.round((dq.client_attributed_expense_count / dq.expense_count) * 1000) / 10
    : 0;

  return (
    <section className="rounded-xl border border-border bg-muted/20 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Info className="h-4 w-4 text-muted-foreground shrink-0" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          How these numbers are built
        </h2>
      </div>

      <ul className="space-y-2.5 text-xs text-muted-foreground leading-relaxed">
        <li>
          <strong className="text-foreground">There is no per-client profit here, on purpose.</strong>
          {" "}Only {dq.client_attributed_expense_count} of {dq.expense_count} expense rows
          ({attributedPct}%) is linked to a client, so cost per client cannot be measured. Splitting
          shared cost by revenue share would be worse than useless: it gives every client an
          identical margin percentage by construction, which looks like an insight and contains no
          information. Fix it by tagging expenses to clients, and this page can answer it honestly.
        </li>
        <li>
          <strong className="text-foreground">Only completed transactions count.</strong>
          {" "}Pending and cancelled rows are intentions, not money that moved.
        </li>
        {dq.foreign_currency_count > 0 && (
          <li>
            <strong className="text-foreground">
              {dq.foreign_currency_count} rows are not tagged {dq.reporting_currency}, and are
              treated as though they were.
            </strong>
            {" "}Their amounts match the {dq.reporting_currency} rows in magnitude — salaries and
            tool invoices of the same size on both tags — so they read as mis-tagged
            {" "}{dq.reporting_currency}, not genuine foreign currency. Converting them at a real
            rate would inflate the cost base roughly fiftyfold. Worth correcting at source.
          </li>
        )}
        {dq.unattributed_income_count > 0 && (
          <li>
            <strong className="text-foreground">
              {fmtMoney(dq.unattributed_income_amount)} of income names no payer at all
            </strong>
            {" "}({dq.unattributed_income_count} row{dq.unattributed_income_count === 1 ? "" : "s"}),
            so it is excluded from every client figure and from the revenue-share denominator.
          </li>
        )}
        {retainers.unlinked_payers.length > 0 && (
          <li>
            <strong className="text-foreground">
              {fmtMoney(retainers.unlinked_total)} names a payer with no client record
            </strong>
            {" "}and is likewise excluded from client figures — listed above so it can be triaged.
          </li>
        )}
        {dq.untagged_tool_spend !== "0.00" && (
          <li>
            <strong className="text-foreground">
              {fmtMoney(dq.untagged_tool_spend)} of “Tools” spend has no tool attached
            </strong>
            {" "}so it appears in the category split but against no vendor.
          </li>
        )}
        <li>
          <strong className="text-foreground">Windows differ by side.</strong>
          {" "}Recurring revenue uses the last {coverage.window_days} days; the cost base averages
          all {costs.months_observed} recorded month{costs.months_observed === 1 ? "" : "s"}. Part
          months are floored, so the cost base is never flattered by dividing over a longer period
          than the data covers.
        </li>
      </ul>
    </section>
  );
}

// ── Shared bits ───────────────────────────────────────────

/** Local alias so the sub-components can type their slice of the response. */
type EconomicsSummaryOf = NonNullable<ReturnType<typeof useEconomics>["data"]>;

function Figure({
  label, value, tone = "neutral",
}: {
  label: string; value: string; tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-lg font-semibold tabular-nums break-words", {
        "text-foreground":   tone === "neutral",
        "text-success":      tone === "positive",
        "text-destructive":  tone === "negative",
      })}>
        {value}
      </dd>
    </div>
  );
}

/** The inline "what this number means" note. Always visible — never a hover. */
function Definition({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border pt-3">
      {children}
    </p>
  );
}

function Callout({
  tone, icon: Icon, title, children,
}: {
  tone: "warning"; icon: typeof AlertTriangle; title: string; children?: React.ReactNode;
}) {
  return (
    <div className={cn(
      "rounded-lg border p-3.5 flex items-start gap-2.5",
      tone === "warning" && "border-warning/30 bg-warning/5",
    )}>
      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        {children && <div className="text-xs text-muted-foreground break-words">{children}</div>}
      </div>
    </div>
  );
}

function EconomicsSkeleton() {
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-4">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-10 w-32" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Skeleton className="h-24 w-full" />
        </div>
      ))}
    </div>
  );
}
