import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ApiTransaction } from "@/lib/types";

interface TransactionParams {
  type?: string;
  category?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  tool_id?: string;
  held_by?: string;
  unsettled?: boolean;
  /** YYYY-MM — resolves to that accounting cycle's date range on the server */
  period?: string;
}

export function useTransactions(
  params: TransactionParams = {},
  /** Set false to hold the request until the data is actually needed. */
  opts: { enabled?: boolean } = {},
) {
  const qs = new URLSearchParams();
  if (params.type && params.type !== "all") qs.set("type", params.type);
  if (params.category && params.category !== "all") qs.set("category", params.category);
  if (params.from) qs.set("from", params.from);
  if (params.to)   qs.set("to",   params.to);
  if (params.page)  qs.set("page",  String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.tool_id)   qs.set("tool_id", params.tool_id);
  if (params.held_by)   qs.set("held_by", params.held_by);
  if (params.unsettled) qs.set("unsettled", "true");
  if (params.period)    qs.set("period", params.period);
  const query = qs.toString();

  return useQuery<{ data: ApiTransaction[]; total: number; page: number; limit: number }>({
    queryKey: ["transactions", params],
    queryFn:  () => apiFetch(`/finance/transactions${query ? `?${query}` : ""}`),
    enabled:  opts.enabled ?? true,
  });
}

// ── All-time totals per category ──────────────────────────
// Replaces summing a 2,000-row transaction download in the browser. Server-side
// aggregation is both cheaper and correct past the row limit.
export interface CategoryTotal {
  category:  string;
  count:     number;
  total:     number;
  last_date: string | null;
}

export function useCategoryTotals() {
  return useQuery<CategoryTotal[]>({
    queryKey: ["finance-category-totals"],
    queryFn:  () => apiFetch("/finance/category-totals"),
    staleTime: 60_000,
  });
}

// ── Monthly cycle analytics (20th → 19th) ─────────────────
export interface FinancePeriod {
  period:       string;   // "2026-06"
  label:        string;   // "Jun 2026"
  short_label:  string;   // "Jun"
  from:         string;   // "2026-05-20"
  to:           string;   // "2026-06-19"
  income:       number;
  expenses:     number;
  profit:       number;
  margin:       number;
  tx_count:     number;
  by_category:  { name: string; value: number }[];
  by_tool:      { name: string; value: number }[];
  income_change_pct:   number | null;
  expenses_change_pct: number | null;
  profit_change_pct:   number | null;
}

export interface MonthlyAnalytics {
  cycle_day:   number;
  cycle_label: string;
  periods:     FinancePeriod[];
  totals: {
    income: number; expenses: number; profit: number;
    avg_monthly_profit: number;
    best_month:  string | null;
    worst_month: string | null;
  };
}

export function useMonthlyAnalytics(params: { months?: number; cycle_day?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.months)    qs.set("months",    String(params.months));
  if (params.cycle_day) qs.set("cycle_day", String(params.cycle_day));
  const query = qs.toString();
  return useQuery<MonthlyAnalytics>({
    queryKey: ["finance-monthly", params],
    queryFn:  () => apiFetch(`/finance/monthly${query ? `?${query}` : ""}`),
    staleTime: 30_000,
  });
}

// ── Tools ─────────────────────────────────────────────────
export interface Tool {
  id:            string;
  name:          string;
  vendor:        string | null;
  url:           string | null;
  kind:          string | null;
  monthlyBudget: string | null;
  active:        boolean;
  notes:         string | null;
  total_spend:   number;
  tx_count:      number;
  last_charged:  string | null;
}

export function useTools() {
  return useQuery<Tool[]>({
    queryKey: ["finance-tools"],
    queryFn:  () => apiFetch("/finance/tools"),
    staleTime: 60_000,
  });
}

export interface ToolSpend {
  cycle_day: number;
  periods:   { key: string; label: string }[];
  total:     number;
  tools: {
    tool_id:    string;
    name:       string;
    kind:       string | null;
    total:      number;
    latest:     number;
    previous:   number;
    change_pct: number | null;
    by_period:  Record<string, number>;
  }[];
}

export function useToolSpend(params: { months?: number; cycle_day?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.months)    qs.set("months",    String(params.months));
  if (params.cycle_day) qs.set("cycle_day", String(params.cycle_day));
  const query = qs.toString();
  return useQuery<ToolSpend>({
    queryKey: ["finance-tool-spend", params],
    queryFn:  () => apiFetch(`/finance/tools/spend${query ? `?${query}` : ""}`),
    staleTime: 30_000,
  });
}

export function useCreateTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<Tool>("/finance/tools", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-tools"] });
      qc.invalidateQueries({ queryKey: ["finance-tool-spend"] });
    },
  });
}

export function useUpdateTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiFetch<Tool>(`/finance/tools/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-tools"] });
      qc.invalidateQueries({ queryKey: ["finance-tool-spend"] });
    },
  });
}

export function useDeleteTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/finance/tools/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["finance-tools"] });
      qc.invalidateQueries({ queryKey: ["finance-tool-spend"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

// ── Cash positions (who holds company money) ──────────────
export interface CashPositions {
  positions: {
    user_id: string | null;
    name:    string;
    email:   string | null;
    holding: number;   // collected client cash not yet handed over
    fronted: number;   // expenses paid from their own pocket
    net:     number;   // holding - fronted; >0 = owes the company
    items:   number;
  }[];
  total_outstanding: number;
}

export function useCashPositions() {
  return useQuery<CashPositions>({
    queryKey: ["finance-cash-positions"],
    queryFn:  () => apiFetch("/finance/cash-positions"),
    staleTime: 15_000,
  });
}

function invalidateCash(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["finance-cash-positions"] });
  qc.invalidateQueries({ queryKey: ["transactions"] });
}

export function useSettleTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, settled }: { id: string; settled: boolean }) =>
      apiFetch(`/finance/transactions/${id}/settle`, { method: "POST", body: JSON.stringify({ settled }) }),
    onSuccess: () => invalidateCash(qc),
  });
}

export function useSettleAllForUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<{ settled: number }>(`/finance/cash-positions/${userId}/settle-all`, { method: "POST" }),
    onSuccess: () => invalidateCash(qc),
  });
}

export function useFinanceSummary(params: { from?: string; to?: string; mode?: "range" | "cumulative" } = {}) {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to)   qs.set("to",   params.to);
  if (params.mode) qs.set("mode", params.mode);
  const query = qs.toString();

  return useQuery<{
    total_income: number;
    total_expenses: number;
    net_profit: number;
    profit_margin: number;
    revenue_by_month: { month: string; revenue: number }[];
    expense_by_category: { name: string; value: number }[];
  }>({
    queryKey: ["finance-summary", params],
    queryFn:  () => apiFetch(`/finance/summary${query ? `?${query}` : ""}`),
  });
}

export function useCategories() {
  return useQuery<string[]>({
    queryKey: ["finance-categories"],
    queryFn:  () => apiFetch("/finance/categories"),
    staleTime: 60_000,
  });
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<ApiTransaction>("/finance/transactions", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["finance-summary"] });
      qc.invalidateQueries({ queryKey: ["finance-categories"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      qc.invalidateQueries({ queryKey: ["finance-monthly"] });
      qc.invalidateQueries({ queryKey: ["finance-tool-spend"] });
      qc.invalidateQueries({ queryKey: ["finance-cash-positions"] });
    },
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiFetch<ApiTransaction>(`/finance/transactions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["finance-summary"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      qc.invalidateQueries({ queryKey: ["finance-monthly"] });
      qc.invalidateQueries({ queryKey: ["finance-tool-spend"] });
      qc.invalidateQueries({ queryKey: ["finance-cash-positions"] });
    },
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/finance/transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["finance-summary"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      qc.invalidateQueries({ queryKey: ["finance-monthly"] });
      qc.invalidateQueries({ queryKey: ["finance-tool-spend"] });
      qc.invalidateQueries({ queryKey: ["finance-cash-positions"] });
    },
  });
}
