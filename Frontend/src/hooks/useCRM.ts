import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type {
  ApiLead, ApiLeadDetail, ApiLeadStrike, StrikeChannel, StrikeLimitAction,
} from "@/lib/types";

/**
 * Every cached query whose answer changes when the set of leads changes.
 *
 * Each lead mutation used to list its own invalidations, and the five of them
 * had drifted into five different lists. The gaps were not theoretical:
 *
 *   • NONE of them invalidated ["dashboard-summary"], which is where the
 *     "Active Leads" KPI comes from and which caches for 60s. Add a lead, open
 *     the Dashboard, and the number had not moved — reported as the counter
 *     being wrong when in fact the query was never re-run.
 *   • Create, update and delete all skipped ["pipeline-summary"]. Since
 *     useUpdateLead is what moves a lead between stages, the one mutation most
 *     certain to change the per-stage counts and pipeline value was the one
 *     that left them stale.
 *   • useDeleteLead invalidated ["leads"] alone, so a deleted lead stayed in
 *     the category list, the pipeline totals and Today's queue.
 *
 * Listing the dependants in one place means a new mutation gets all of them,
 * and a new lead-derived query is added once. Prefix matching means
 * ["leads", {...params}] and ["lead", id] are covered by their prefixes.
 */
const LEAD_DEPENDENT_KEYS = [
  ["leads"],
  ["lead-categories"],
  ["pipeline-summary"],
  ["dashboard-summary"],
  ["worklist"],
  ["stale-leads"],
  ["crm-insights"],
] as const;

/**
 * Exported so lead mutations living OUTSIDE this file get the same complete
 * list. `useBulkIngest` in useOutreach.ts was invalidating only ["leads"] and
 * ["dashboard-summary"], so a 500-row CSV import left the pipeline summary, the
 * category filter, Today's queue and the stale-lead list showing pre-import
 * numbers — the same class of drift this helper was created to end.
 */
export function invalidateLeadQueries(qc: QueryClient, leadId?: string) {
  for (const key of LEAD_DEPENDENT_KEYS) {
    qc.invalidateQueries({ queryKey: key });
  }
  // The single-lead detail cache is keyed by id, so it needs the id to target.
  if (leadId) qc.invalidateQueries({ queryKey: ["lead", leadId] });
}

export interface CrmInsights {
  period: { from: string; to: string; granularity: string };
  outreach_per_day: { date: string; count: number }[];
  niches_contacted: { niche: string; count: number }[];
  message_summary: string | null;
  suggestions: string[];
  response_rate: { sent: number; replied: number; percentage: number };
}

export function useLeads(params: {
  stage?: string;
  assignee_id?: string;
  search?: string;
  category?: string;
  reachability?: "unreachable" | "reachable";
  /**
   * Archived leads are hidden by default server-side. "only" is how the
   * Archived view reaches them — without it a lead archived by the strike limit
   * would be findable only by its id.
   */
  archived?: "only" | "include";
  limit?: number;
} = {}) {
  const qs = new URLSearchParams();
  if (params.stage)        qs.set("stage",        params.stage);
  if (params.assignee_id)  qs.set("assignee_id",   params.assignee_id);
  if (params.search)       qs.set("search",        params.search);
  if (params.category)     qs.set("category",      params.category);
  if (params.reachability) qs.set("reachability",  params.reachability);
  if (params.archived)     qs.set("archived",      params.archived);
  if (params.limit)        qs.set("limit",         String(params.limit));
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
    onSuccess: () => invalidateLeadQueries(qc),
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
    onSettled: (_data, _err, { id }) => invalidateLeadQueries(qc, id),
  });
}

/**
 * Set or clear a lead's follow-up date.
 *
 * Separate from useUpdateLead for one reason: it invalidates `["worklist"]`.
 * Setting a follow-up is the one lead edit whose whole purpose is to change
 * Today's queue — it removes the lead's card until the date arrives — so
 * without that invalidation the card sits there until the 60s refetch and the
 * tap looks like it did nothing.
 *
 * Pass `date: null` to clear.
 */
export function useSetLeadFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, date, note }: { id: string; date: string | null; note?: string | null }) =>
      apiFetch<ApiLead>(`/crm/leads/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          follow_up_at: date,
          ...(note !== undefined ? { follow_up_note: note } : {}),
        }),
      }),
    onSuccess: (_data, { id }) => invalidateLeadQueries(qc, id),
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/crm/leads/${id}`, { method: "DELETE" }),
    onSuccess: (_res, id) => invalidateLeadQueries(qc, id),
  });
}

export interface BulkDeleteResult {
  deleted:       number;
  would_delete?: number;
  preview?:      { id: string; name: string; company: string; source: string | null }[];
}

/**
 * Bulk-delete leads by explicit selection. Admin only, server-enforced.
 *
 * Deletion cascades to activities, enrolments and sends and cannot be undone,
 * so the UI always runs `dry_run` first to show an exact count before asking
 * for confirmation. Every real execution is recorded in the events log.
 */
export function useBulkDeleteLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, dryRun }: { ids: string[]; dryRun?: boolean }) =>
      apiFetch<BulkDeleteResult>("/crm/leads/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids, confirm: "DELETE_LEADS", dry_run: !!dryRun }),
      }),
    onSuccess: (_res, vars) => {
      if (vars.dryRun) return;               // preview must not disturb the list
      invalidateLeadQueries(qc);
    },
  });
}

// ── Bulk actions ──────────────────────────────────────────

export interface BulkUpdateResult {
  updated:       number;
  would_update?: number;
  /** Selected ids that resolved to no row the caller may write. */
  skipped:       number;
  /** Which wire fields the server actually applied. */
  fields:        string[];
}

/** The fields a bulk edit may change. See BulkLeadPatchInput on the backend. */
export interface BulkLeadPatch {
  stage?:       string;
  assignee_id?: string | null;
  category?:    string | null;
  source?:      string | null;
}

/**
 * Apply the same field changes to many leads.
 *
 * Server-side this is ONE `UPDATE ... WHERE id IN (...)`, which is why the UI
 * shows a pending state and not a progress bar: there are no intermediate
 * milestones to report, and a bar that fills on a timer would be an invention.
 * The whole batch commits or none of it does.
 */
export function useBulkUpdateLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, patch, dryRun }: { ids: string[]; patch: BulkLeadPatch; dryRun?: boolean }) =>
      apiFetch<BulkUpdateResult>("/crm/leads/bulk-update", {
        method: "POST",
        body: JSON.stringify({ ids, patch, dry_run: !!dryRun }),
      }),
    onSuccess: (_res, vars) => {
      if (vars.dryRun) return;               // a preview must not disturb the list
      invalidateLeadQueries(qc);
    },
  });
}

export interface BulkCommentResult {
  commented: number;
  skipped:   number;
}

/**
 * Add the SAME comment to every selected lead, as one activity per lead.
 *
 * Per-lead on purpose: the timeline is where anyone reviewing a lead six months
 * later looks, and a history that pointed at a batch record kept somewhere else
 * would be unreadable.
 */
export function useBulkCommentLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: string[]; description: string; type?: string; date?: string }) =>
      apiFetch<BulkCommentResult>("/crm/leads/bulk-comment", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateLeadQueries(qc),
  });
}

// ── Manual contact strikes ────────────────────────────────

export interface StrikeResult {
  strike:        ApiLeadStrike;
  strike_count:  number;
  strike_limit:  number;
  limit_action:  StrikeLimitAction;
  /** Non-null when this strike hit the limit and the action was applied. */
  limit_applied: StrikeLimitAction | null;
  strikes:       ApiLeadStrike[];
}

/**
 * Record one manual contact attempt.
 *
 * Invalidated through the shared helper because a strike can change the lead's
 * STAGE (the third one closes or archives it), which moves pipeline totals,
 * Today's queue and the dashboard KPI — not just this lead's detail.
 */
export function useAddLeadStrike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, ...body }: {
      leadId:   string;
      channel?: StrikeChannel;
      note?:    string | null;
      date?:    string;
    }) =>
      apiFetch<StrikeResult>(`/crm/leads/${leadId}/strikes`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (_res, { leadId }) => invalidateLeadQueries(qc, leadId),
  });
}

/** Undo a strike recorded by mistake. Does not reopen a lead the limit closed. */
export function useDeleteLeadStrike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, strikeId }: { leadId: string; strikeId: string }) =>
      apiFetch<{ strike_count: number; strike_limit: number }>(
        `/crm/leads/${leadId}/strikes/${strikeId}`, { method: "DELETE" },
      ),
    onSuccess: (_res, { leadId }) => invalidateLeadQueries(qc, leadId),
  });
}

/** Restore an archived lead to the list. `false` clears `archived_at`. */
export function useSetLeadArchived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      apiFetch<ApiLead>(`/crm/leads/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived }),
      }),
    onSuccess: (_res, { id }) => invalidateLeadQueries(qc, id),
  });
}

export function useAddLeadActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, ...body }: { leadId: string } & Record<string, unknown>) =>
      apiFetch(`/crm/leads/${leadId}/activities`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (_data, { leadId }) => invalidateLeadQueries(qc, leadId),
  });
}

export function useStaleLeads() {
  return useQuery<ApiLead[]>({
    queryKey: ["stale-leads"],
    queryFn:  () => apiFetch("/crm/stale-leads"),
    staleTime: 60_000,
  });
}

export interface PipelineStageRow {
  stage:       string;
  stage_label: string;
  count:       number;
  total_value: number;
}

export function usePipelineSummary() {
  return useQuery<PipelineStageRow[]>({
    queryKey: ["pipeline-summary"],
    queryFn:  () => apiFetch("/crm/pipeline-summary"),
    staleTime: 30_000,
  });
}

export function useCrmInsights(params: {
  period?: "daily" | "weekly" | "monthly";
  from?: string;
  to?: string;
  include_ai?: boolean;
} = {}) {
  const qs = new URLSearchParams();
  if (params.period) qs.set("period", params.period);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.include_ai) qs.set("include_ai", "true");

  return useQuery<CrmInsights>({
    queryKey: ["crm-insights", params],
    queryFn: () => apiFetch(`/crm/insights${qs.toString() ? `?${qs.toString()}` : ""}`),
    staleTime: 60_000,
  });
}
