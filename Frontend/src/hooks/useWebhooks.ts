import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface WebhookSubscription {
  id:        string;
  name:      string;
  event:     string;
  url:       string;
  secret:    string | null;
  isActive:  boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id:             string;
  subscriptionId: string | null;
  event:          string;
  url:            string;
  payload:        string;
  statusCode:     number | null;
  responseBody:   string | null;
  error:          string | null;
  deliveredAt:    string;
}

export function useWebhooks() {
  return useQuery<WebhookSubscription[]>({
    queryKey: ["webhooks"],
    queryFn:  () => apiFetch("/webhooks"),
  });
}

export function useWebhookEvents() {
  return useQuery<string[]>({
    queryKey: ["webhooks", "events"],
    queryFn:  () => apiFetch("/webhooks/events"),
    staleTime: 60 * 60_000,
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; event: string; url: string; secret?: string; is_active?: boolean }) =>
      apiFetch<WebhookSubscription>("/webhooks", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<{ name: string; event: string; url: string; secret: string | null; is_active: boolean }>) =>
      apiFetch<WebhookSubscription>(`/webhooks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/webhooks/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
  });
}

export function useTestWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<WebhookDelivery>(`/webhooks/${id}/test`, { method: "POST" }),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["webhooks", id, "deliveries"] });
    },
  });
}

export function useWebhookDeliveries(id: string | null) {
  return useQuery<WebhookDelivery[]>({
    queryKey: ["webhooks", id, "deliveries"],
    queryFn:  () => apiFetch(`/webhooks/${id}/deliveries`),
    enabled:  !!id,
  });
}
