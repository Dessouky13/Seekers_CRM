import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ApiTask, ApiProject, ApiUser } from "@/lib/types";

export function useTasks(params?: { project_id?: string; status?: string }) {
  const qs = new URLSearchParams();
  if (params?.project_id) qs.set("project_id", params.project_id);
  if (params?.status) qs.set("status", params.status);
  const query = qs.toString();

  return useQuery<{ data: ApiTask[] }>({
    queryKey: ["tasks", params],
    queryFn: () => apiFetch(`/tasks${query ? `?${query}` : ""}`),
  });
}

export function useProjects() {
  return useQuery<ApiProject[]>({
    queryKey: ["projects"],
    queryFn: () => apiFetch("/projects"),
  });
}

export function useUsers() {
  return useQuery<ApiUser[]>({
    queryKey: ["users"],
    queryFn: () => apiFetch("/users"),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<ApiTask>("/tasks", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onMutate: async ({ id, status }) => {
      // Optimistic update — swap status locally before server confirms
      await qc.cancelQueries({ queryKey: ["tasks"] });
      const prev = qc.getQueriesData<{ data: ApiTask[] }>({ queryKey: ["tasks"] });
      qc.setQueriesData<{ data: ApiTask[] }>({ queryKey: ["tasks"] }, (old) =>
        old ? { data: old.data.map((t) => (t.id === id ? { ...t, status: status as ApiTask["status"] } : t)) } : old,
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) ctx.prev.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useToggleSubtask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, subtaskId, done }: { taskId: string; subtaskId: string; done: boolean }) =>
      apiFetch(`/tasks/${taskId}/subtasks/${subtaskId}`, {
        method: "PATCH",
        body: JSON.stringify({ done }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiFetch<ApiTask>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/tasks/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}
