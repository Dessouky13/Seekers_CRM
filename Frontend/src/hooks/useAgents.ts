import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type AgentScope = "lead" | "client" | "task" | "pipeline" | "global";

export interface AgentDef {
  id:          string;
  name:        string;
  description: string;
  scope:       AgentScope;
  tier:        "standard" | "premium";
}

export interface AgentRun {
  id:           string;
  agentId:      string;
  scope:        AgentScope;
  contextId:    string | null;
  contextLabel: string | null;
  inputSummary: string | null;
  output:       string;
  model:        string;
  tokensIn:     number;
  tokensOut:    number;
  costUsd:      string;
  status:       "success" | "error";
  error:        string | null;
  createdBy:    string | null;
  author_name:  string | null;
  createdAt:    string;
}

export function useAgents() {
  return useQuery<AgentDef[]>({
    queryKey: ["agents"],
    queryFn:  () => apiFetch("/agents"),
    staleTime: 5 * 60_000,
  });
}

export function useAgentRuns(params: { scope?: AgentScope; context_id?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.scope)      qs.set("scope",      params.scope);
  if (params.context_id) qs.set("context_id", params.context_id);
  const q = qs.toString();

  return useQuery<AgentRun[]>({
    queryKey: ["agent-runs", params],
    queryFn:  () => apiFetch(`/agents/runs${q ? `?${q}` : ""}`),
  });
}

export function useRunAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { agent_id: string; context_id?: string | null }) =>
      apiFetch<AgentRun>("/agents/run", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-runs"] });
    },
  });
}

export function useSaveRunAsActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, type }: { runId: string; type?: "email" | "call" | "meeting" | "form" | "note" }) =>
      apiFetch(`/agents/runs/${runId}/save-as-activity`, {
        method: "POST",
        body: JSON.stringify({ type: type ?? "note" }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead-detail"] });
    },
  });
}

export function useCreateTasksFromRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, titles, project_id, priority }: {
      runId: string;
      titles: string[];
      project_id?: string;
      priority?: "low" | "medium" | "high" | "critical";
    }) =>
      apiFetch<{ created: number; tasks: unknown[] }>(`/agents/runs/${runId}/create-tasks`, {
        method: "POST",
        body: JSON.stringify({ titles, project_id, priority }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });
}
