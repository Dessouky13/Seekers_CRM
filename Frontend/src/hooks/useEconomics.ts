import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// Money crosses the wire as `numeric(12,2)` STRINGS, never numbers. The backend
// computes every total in bigint minor units precisely so it never becomes a
// float; parsing it into one here to render it would throw that away. Format
// with `fmtMoney` below, and if a value must be compared, compare the strings
// the server already ordered.

export type PaymentStatus = "current" | "due" | "lapsed" | "no_payments";

export interface EconomicsClientRow {
  client_id:        string | null;
  name:             string;
  status:           string | null;
  revenue:          string;
  /** How much of `revenue` was matched only by the free-text client name. */
  revenue_via_name: string;
  payments:         number;
  first_payment:    string | null;
  last_payment:     string | null;
  days_since_last_payment: number | null;
  expected_gap_days: number;
  /** False when there are too few payments to measure a gap. */
  cadence_known:    boolean;
  payment_status:   PaymentStatus;
  recurring_90d:    string;
  monthly_run_rate: string;
  share_pct:        number;
}

export interface UnlinkedPayer {
  name:         string;
  amount:       string;
  payments:     number;
  last_payment: string | null;
  ambiguous:    boolean;
}

export interface ToolSpendRow {
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
  dormant:   boolean;
  share_pct: number;
}

export interface EconomicsSummary {
  as_of:    string;
  currency: string;
  from:     string | null;
  retainers: {
    clients:             EconomicsClientRow[];
    unlinked_payers:     UnlinkedPayer[];
    unlinked_total:      string;
    unattributed_income: string;
    unattributed_count:  number;
    attributed_revenue:  string;
    top_two_share_pct:   number;
    thresholds: { due_ratio: number; lapsed_ratio: number; assumed_gap_days: number };
  };
  costs: {
    total_expenses:    string;
    by_category:       { category: string; amount: string; share_pct: number }[];
    tool_spend:        string;
    tool_share_pct:    number;
    tools:             ToolSpendRow[];
    dormant_tools:     number;
    monthly_cost_base: string;
    months_observed:   number;
    thresholds:        { dormant_days: number };
  };
  coverage: {
    monthly_recurring_revenue: string;
    monthly_cost_base:         string;
    coverage_pct:              number;
    monthly_surplus:           string;
    window_days:               number;
    contributing_clients:      number;
  };
  data_quality: {
    unattributed_income_count:  number;
    unattributed_income_amount: string;
    client_attributed_expense_count: number;
    expense_count:              number;
    foreign_currency_count:     number;
    reporting_currency:         string;
    untagged_tool_spend:        string;
  };
  /** True when the row cap was hit and the figures cover only part of the data. */
  truncated: boolean;
}

export function useEconomics(params: { from?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  const query = qs.toString();

  return useQuery<EconomicsSummary>({
    queryKey: ["economics", params],
    queryFn:  () => apiFetch(`/economics/summary${query ? `?${query}` : ""}`),
  });
}

/**
 * "109800.00" → "109,800" (or "109,800.50" when the piastres are non-zero).
 *
 * Grouping is done on the string's integer part rather than via `Number`, so a
 * value large enough to lose precision as a float still renders exactly. The
 * decimals are dropped when they are "00" because a page of six-figure EGP
 * totals reads better without a column of ".00", and kept whenever they carry
 * information.
 */
export function fmtMoney(value: string): string {
  const negative = value.startsWith("-");
  const [whole, frac = "00"] = (negative ? value.slice(1) : value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const shown   = frac === "00" ? grouped : `${grouped}.${frac}`;
  return negative ? `-${shown}` : shown;
}
