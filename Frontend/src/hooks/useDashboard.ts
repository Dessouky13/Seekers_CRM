import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { DashboardSummary } from "@/lib/types";

export function useDashboardSummary(period?: string) {
  const qs = period ? `?period=${period}` : "";
  return useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary", period],
    queryFn:  () => apiFetch(`/dashboard/summary${qs}`),
    staleTime: 60_000,
  });
}
