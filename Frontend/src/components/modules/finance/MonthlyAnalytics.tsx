import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  ComposedChart, Line, CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, CalendarRange, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useMonthlyAnalytics, type FinancePeriod } from "@/hooks/useFinance";
import { cn } from "@/lib/utils";

const fmt = (n: number) =>
  `EGP ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;
const fmtCompact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Coloured +/- delta chip. Null (no prior period) renders a dash. */
function Delta({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct === null) return <span className="text-muted-foreground text-[11px]">—</span>;
  // For expenses, going UP is bad — invert the colour meaning.
  const good = invert ? pct <= 0 : pct >= 0;
  const Icon = pct === 0 ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
        pct === 0 ? "text-muted-foreground" : good ? "text-success" : "text-destructive",
      )}
    >
      <Icon className="h-3 w-3" />
      {pct > 0 ? "+" : ""}{pct}%
    </span>
  );
}

export function MonthlyAnalytics() {
  const [months, setMonths] = useState(12);
  const { data, isLoading } = useMonthlyAnalytics({ months });
  const [openPeriod, setOpenPeriod] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-muted-foreground text-center py-16">Loading monthly analytics…</p>;
  if (!data || data.periods.length === 0)
    return <p className="text-sm text-muted-foreground text-center py-16 italic">No transactions yet.</p>;

  const { periods, totals } = data;
  const latest = periods[periods.length - 1];

  const chartData = periods.map((p) => ({
    name:     p.short_label,
    Income:   p.income,
    Expenses: p.expenses,
    Profit:   p.profit,
  }));

  return (
    <div className="space-y-4">
      {/* Cycle explainer + range switch */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <CalendarRange className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Accounting cycle</p>
            <p className="text-[11px] text-muted-foreground">{data.cycle_label}</p>
          </div>
        </div>
        <div className="flex gap-1">
          {[6, 12, 24].map((m) => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                months === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>

      {/* Headline tiles for the most recent closed period */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label={`${latest.label} income`}   value={fmt(latest.income)}   delta={<Delta pct={latest.income_change_pct} />} />
        <Tile label={`${latest.label} expenses`} value={fmt(latest.expenses)} delta={<Delta pct={latest.expenses_change_pct} invert />} />
        <Tile
          label={`${latest.label} profit`}
          value={fmt(latest.profit)}
          valueClass={latest.profit >= 0 ? "text-success" : "text-destructive"}
          delta={<Delta pct={latest.profit_change_pct} />}
        />
        <Tile label="Avg monthly profit" value={fmt(totals.avg_monthly_profit)} sub={`over ${periods.length} periods`} />
      </div>

      {/* Income vs expenses, with profit line */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Income vs Expenses</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">One bar per accounting period. Line = profit.</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Best / worst</p>
            <p className="text-xs text-foreground">
              <span className="text-success">{totals.best_month}</span>
              {" · "}
              <span className="text-destructive">{totals.worst_month}</span>
            </p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(230,16%,20%)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(226,12%,55%)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(226,12%,55%)" }} axisLine={false} tickLine={false} tickFormatter={fmtCompact} />
            <Tooltip
              formatter={(v: number) => fmt(v)}
              contentStyle={{ background: "hsl(230,22%,12%)", border: "1px solid hsl(230,16%,18%)", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "hsl(226,20%,88%)" }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Income"   fill="hsl(160,70%,45%)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Expenses" fill="hsl(0,72%,58%)"   radius={[3, 3, 0, 0]} />
            <Line dataKey="Profit" stroke="hsl(246,90%,65%)" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Period table — click a row to expand its breakdown */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Month by Month</p>
          <span className="text-[10px] text-muted-foreground">Click a row for its category &amp; tool breakdown</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Period", "Covers", "Income", "Expenses", "Profit", "Margin", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...periods].reverse().map((p) => {
                const open = openPeriod === p.period;
                return (
                  <PeriodRow key={p.period} p={p} open={open} onToggle={() => setOpenPeriod(open ? null : p.period)} />
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                <td className="px-4 py-2.5" colSpan={2}>Total ({periods.length} periods)</td>
                <td className="px-4 py-2.5 tabular-nums text-success">{fmt(totals.income)}</td>
                <td className="px-4 py-2.5 tabular-nums text-destructive">{fmt(totals.expenses)}</td>
                <td className={cn("px-4 py-2.5 tabular-nums", totals.profit >= 0 ? "text-success" : "text-destructive")}>
                  {fmt(totals.profit)}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                  {totals.income > 0 ? Math.round((totals.profit / totals.income) * 100) : 0}%
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function PeriodRow({ p, open, onToggle }: { p: FinancePeriod; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-border/50 hover:bg-primary/5 transition-colors cursor-pointer"
      >
        <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{p.label}</td>
        <td className="px-4 py-2.5 text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">{p.from} → {p.to}</td>
        <td className="px-4 py-2.5 tabular-nums text-success whitespace-nowrap">
          {fmt(p.income)} <Delta pct={p.income_change_pct} />
        </td>
        <td className="px-4 py-2.5 tabular-nums text-destructive whitespace-nowrap">
          {fmt(p.expenses)} <Delta pct={p.expenses_change_pct} invert />
        </td>
        <td className={cn("px-4 py-2.5 tabular-nums font-semibold whitespace-nowrap", p.profit >= 0 ? "text-success" : "text-destructive")}>
          {fmt(p.profit)}
        </td>
        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{p.margin}%</td>
        <td className="px-4 py-2.5">
          <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        </td>
      </tr>
      {open && (
        <tr className="bg-muted/10">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Breakdown title="Expenses by category" rows={p.by_category} empty="No expenses in this period." />
              <Breakdown title="Spend by tool"        rows={p.by_tool}     empty="No tool charges in this period." />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Breakdown({ title, rows, empty }: { title: string; rows: { name: string; value: number }[]; empty: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.name}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-foreground truncate">{r.name}</span>
                <span className="tabular-nums text-muted-foreground ml-2 shrink-0">{fmt(r.value)}</span>
              </div>
              <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                <div className="h-full bg-primary/70" style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub, delta, valueClass }: {
  label: string; value: string; sub?: string; delta?: React.ReactNode; valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums mt-1", valueClass ?? "text-foreground")}>{value}</p>
      <div className="mt-0.5 h-4">{delta ?? (sub && <span className="text-[10px] text-muted-foreground">{sub}</span>)}</div>
    </div>
  );
}
