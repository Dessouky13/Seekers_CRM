import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type ActionType =
  | "reply_waiting"
  | "hot_lead"
  | "sequence_blocked"
  | "task_due"
  | "stale_lead"
  | "unassigned_lead";

export type Urgency = "now" | "today" | "week";

export interface WorklistAction {
  id:        string;
  type:      ActionType;
  urgency:   Urgency;
  score:     number;
  title:     string;
  subtitle:  string | null;
  reason:    string;
  detail:    string | null;
  deepLink:  string;
  leadId:    string | null;
  taskId:    string | null;
  dealValue: number;
  ageHours:  number;
}

export interface WorklistResponse {
  focus:     WorklistAction[];
  rest:      WorklistAction[];
  counts:    { total: number; now: number; today: number; week: number; replies: number };
  all_clear: boolean;
}

export interface PipelineHealth {
  new_leads_7d:   number;
  active_leads:   number;
  total_leads:    number;
  enriched_pct:   number;
  uncontacted:    number;
  sent_7d:        number;
  replies_7d:     number;
  reply_rate_pct: number;
  send_rate_day:  number;
  runway_days:    number | null;
  starving:       boolean;
  headline:       string;
}

/**
 * Vercel deploys the frontend the moment `main` moves, but the API only
 * updates when someone runs deploy.sh on the VPS. So for a window after every
 * release these endpoints legitimately do not exist yet.
 *
 * `retry: false` stops react-query hammering a 404, and the Today page renders
 * a plain "not deployed yet" note instead of an error boundary. Nothing else
 * on the page depends on this call succeeding.
 */
export function useWorklist() {
  return useQuery<WorklistResponse>({
    queryKey: ["worklist"],
    queryFn:  () => apiFetch("/worklist"),
    retry:            false,
    staleTime:        30_000,
    refetchInterval:  60_000,       // a reply landing should surface on its own
    refetchOnWindowFocus: true,     // coming back to the tab re-checks
  });
}

export function usePipelineHealth(enabled = true) {
  return useQuery<PipelineHealth>({
    queryKey: ["pipeline-health"],
    queryFn:  () => apiFetch("/worklist/pipeline-health"),
    enabled,
    retry:     false,
    staleTime: 120_000,
  });
}
