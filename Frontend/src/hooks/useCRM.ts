import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ApiLead, ApiLeadDetail } from "@/lib/types";

export function useLeads(params: {
  stage?: string;
  assignee_id?: string;
  search?: string;
  category?: string;
} = {}) {
  const qs = new URLSearchParams();
  if (params.stage)       qs.set("stage",       params.stage);
  if (params.assignee_id) qs.set("assignee_id", params.assignee_id);
  if (params.search)      qs.set("search",      params.search);
  if (params.category)    qs.set("category",    params.category);
  const query = qs.toString();

  return useQuery<ApiLead[]>({
    queryKey: ["leads", params],
    queryFn:  () => apiFetch(`/crm/leads${query ? `?${query}` : ""}`),
  });
}

export function useLeadDetail(id: string | null) {
  return useQuery<ApiLeadDetail>({
    queryKey: ["lead", id],
    queryFn:  () => apiFetch(`/crm/leads/${id}`),
    enabled:  !!id,
  });
}

export function useLeadCategories() {
  return useQuery<string[]>({
    queryKey: ["lead-categories"],
    queryFn:  () => apiFetch("/crm/categories"),
    staleTime: 60_000,
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<ApiLead>("/crm/leads", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-categories"] });
    },
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiFetch<ApiLead>(`/crm/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onMutate: async ({ id, stage }) => {
      if (!stage) return;
      await qc.cancelQueries({ queryKey: ["leads"] });
      const prev = qc.getQueriesData<ApiLead[]>({ queryKey: ["leads"] });
      qc.setQueriesData<ApiLead[]>({ queryKey: ["leads"] }, (old) =>
        old ? old.map((l) => (l.id === id ? { ...l, stage: stage as ApiLead["stage"] } : l)) : old,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) ctx.prev.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: (_data, _err, { id }) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead", id] });
    },
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/crm/leads/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export function useAddLeadActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, ...body }: { leadId: string } & Record<string, unknown>) =>
      apiFetch(`/crm/leads/${leadId}/activities`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (_data, { leadId }) => {
      qc.invalidateQueries({ queryKey: ["lead", leadId] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useStaleLeads() {
  return useQuery<ApiLead[]>({
    queryKey: ["stale-leads"],
    queryFn:  () => apiFetch("/crm/stale-leads"),
    staleTime: 60_000,
  });
}
