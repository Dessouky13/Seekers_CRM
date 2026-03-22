import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ApiClient, ApiClientDetail } from "@/lib/types";

export function useClients(params?: { status?: string; search?: string }) {
  const qs = new URLSearchParams();
  if (params?.status && params.status !== "all") qs.set("status", params.status);
  if (params?.search) qs.set("search", params.search);
  const query = qs.toString();

  return useQuery<ApiClient[]>({
    queryKey: ["clients", params],
    queryFn: () => apiFetch(`/clients${query ? `?${query}` : ""}`),
  });
}

export function useClientDetail(id: string | null) {
  return useQuery<ApiClientDetail>({
    queryKey: ["clients", id, "detail"],
    queryFn: () => apiFetch(`/clients/${id}`),
    enabled: !!id,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<ApiClient>("/clients", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });
}

export function useUpdateClient(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<ApiClient>(`/clients/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clients"] }),
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/clients/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: ["clients", id, "detail"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
  });
}
