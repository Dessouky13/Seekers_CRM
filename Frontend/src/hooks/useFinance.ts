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
}

export function useTransactions(params: TransactionParams = {}) {
  const qs = new URLSearchParams();
  if (params.type && params.type !== "all") qs.set("type", params.type);
  if (params.category && params.category !== "all") qs.set("category", params.category);
  if (params.from) qs.set("from", params.from);
  if (params.to)   qs.set("to",   params.to);
  if (params.page)  qs.set("page",  String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();

  return useQuery<{ data: ApiTransaction[]; total: number; page: number; limit: number }>({
    queryKey: ["transactions", params],
    queryFn:  () => apiFetch(`/finance/transactions${query ? `?${query}` : ""}`),
  });
}

export function useFinanceSummary(params: { from?: string; to?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to)   qs.set("to",   params.to);
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
    },
  });
}
