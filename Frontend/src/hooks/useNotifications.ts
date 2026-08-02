import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface ApiNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  link: string | null;
  createdAt: string;
}

export function useNotifications(unreadOnly = false) {
  const qs = unreadOnly ? "?unread_only=true" : "";
  return useQuery<ApiNotification[]>({
    queryKey: ["notifications", unreadOnly],
    queryFn:  () => apiFetch(`/notifications${qs}`),
    refetchInterval: (query) => (document.hidden ? false : (query.state.data?.length ? 15_000 : 30_000)),
    refetchOnWindowFocus: true,
  });
}

/**
 * Snapshot every cached notifications list, apply `update` to each, and return
 * a rollback closure. The list is cached under several keys (`unreadOnly`
 * true/false), so a single setQueryData would leave the others stale.
 */
function optimisticallyPatch(
  qc: ReturnType<typeof useQueryClient>,
  update: (list: ApiNotification[]) => ApiNotification[],
) {
  const prev = qc.getQueriesData<ApiNotification[]>({ queryKey: ["notifications"] });
  qc.setQueriesData<ApiNotification[]>({ queryKey: ["notifications"] }, (old) =>
    old ? update(old) : old,
  );
  return () => prev.forEach(([key, data]) => qc.setQueryData(key, data));
}

// These three are the app's most latency-sensitive mutations: they're driven by
// a single click on a bell dropdown, and the unread badge is the feedback. A
// round-trip before the dot clears reads as "the click didn't register", so all
// three update the cache first and roll back if the server disagrees.
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, read = true }: { id: string; read?: boolean }) =>
      apiFetch(`/notifications/${id}/read`, { method: "PATCH", body: JSON.stringify({ read }) }),
    onMutate: async ({ id, read = true }) => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const rollback = optimisticallyPatch(qc, (list) =>
        list.map((n) => (n.id === id ? { ...n, read } : n)),
      );
      return { rollback };
    },
    onError:   (_e, _v, ctx) => ctx?.rollback?.(),
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/notifications/read-all", { method: "PATCH" }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const rollback = optimisticallyPatch(qc, (list) => list.map((n) => ({ ...n, read: true })));
      return { rollback };
    },
    onError:   (_e, _v, ctx) => ctx?.rollback?.(),
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/notifications/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const rollback = optimisticallyPatch(qc, (list) => list.filter((n) => n.id !== id));
      return { rollback };
    },
    onError:   (_e, _v, ctx) => ctx?.rollback?.(),
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
