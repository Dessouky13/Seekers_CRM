import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type Channel = "email" | "linkedin" | "note" | "whatsapp" | "call";
export type EnrollmentStatus = "active" | "paused" | "completed" | "failed" | "replied";

export interface Sequence {
  id:                       string;
  name:                     string;
  description:              string | null;
  category:                 string | null;
  isActive:                 boolean;
  autoEnrollOnCategory:     boolean;
  autoEnrollAll:            boolean;
  createdAt:                string;
  updatedAt:                string;
  step_count:               number;
  active_enrollments:       number;
}

export interface SequenceStep {
  id:               string;
  sequenceId:       string;
  position:         number;
  dayOffset:        number;
  channel:          Channel;
  subjectTemplate:  string | null;
  bodyTemplate:     string | null;
  agentId:          string | null;
  createdAt:        string;
}

export interface SequenceWithSteps extends Sequence {
  steps: SequenceStep[];
}

export interface Enrollment {
  id:                  string;
  leadId:              string;
  sequenceId:          string;
  currentStep:         number;
  status:              EnrollmentStatus;
  enrolledAt:          string;
  nextSendAt:          string | null;
  lastStepCompletedAt: string | null;
  completedAt:         string | null;
  pausedReason:        string | null;
  enrolledBy:          string | null;
  lead_name:           string | null;
  lead_company:        string | null;
  lead_email:          string | null;
  sequence_name:       string | null;
}

export interface SendRecord {
  id:           string;
  enrollmentId: string;
  stepId:       string | null;
  channel:      Channel;
  subject:      string | null;
  body:         string | null;
  sentAt:       string;
  status:       "sent" | "failed";
  messageId:    string | null;
  error:        string | null;
}

// ── Sequences ─────────────────────────────────────────────
export function useSequences() {
  return useQuery<Sequence[]>({
    queryKey: ["outreach", "sequences"],
    queryFn:  () => apiFetch("/outreach/sequences"),
  });
}

export function useSequence(id: string | null) {
  return useQuery<SequenceWithSteps>({
    queryKey: ["outreach", "sequences", id],
    queryFn:  () => apiFetch(`/outreach/sequences/${id}`),
    enabled:  !!id,
  });
}

/** A step supplied at creation time, e.g. from a starter template. */
export interface SeedStep {
  day_offset:        number;
  channel?:          Channel;
  subject_template?: string | null;
  body_template?:    string | null;
  agent_id?:         string | null;
}

export function useCreateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string; description?: string; category?: string; is_active?: boolean;
      auto_enroll_on_category?: boolean; auto_enroll_all?: boolean;
      /** Created atomically with the sequence — see POST /outreach/sequences. */
      steps?: SeedStep[];
    }) =>
      apiFetch<Sequence>("/outreach/sequences", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach", "sequences"] }),
  });
}

export function useUpdateSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<{ name: string; description: string | null; category: string | null; is_active: boolean; auto_enroll_on_category: boolean; auto_enroll_all: boolean }>) =>
      apiFetch<Sequence>(`/outreach/sequences/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach"] }),
  });
}

export function useDeleteSequence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/outreach/sequences/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach", "sequences"] }),
  });
}

// ── Steps ─────────────────────────────────────────────────
export function useAddStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sequenceId, ...body }: { sequenceId: string; day_offset: number; channel?: Channel; subject_template?: string | null; body_template?: string | null; agent_id?: string | null }) =>
      apiFetch<SequenceStep>(`/outreach/sequences/${sequenceId}/steps`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (_d, { sequenceId }) => qc.invalidateQueries({ queryKey: ["outreach", "sequences", sequenceId] }),
  });
}

export function useUpdateStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sequenceId, stepId, ...body }: { sequenceId: string; stepId: string } & Partial<{ day_offset: number; channel: Channel; subject_template: string | null; body_template: string | null; agent_id: string | null }>) =>
      apiFetch<SequenceStep>(`/outreach/sequences/${sequenceId}/steps/${stepId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (_d, { sequenceId }) => qc.invalidateQueries({ queryKey: ["outreach", "sequences", sequenceId] }),
  });
}

/**
 * Persist a drag-and-drop reorder. The server rewrites day offsets to preserve
 * the gaps between steps, so the response is authoritative — the optimistic
 * update below is replaced by it on settle.
 */
export function useReorderSteps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sequenceId, order }: { sequenceId: string; order: string[] }) =>
      apiFetch<SequenceStep[]>(`/outreach/sequences/${sequenceId}/steps/reorder`, {
        method: "PUT",
        body:   JSON.stringify({ order }),
      }),
    // Dragging must feel instant; without this the card snaps back to its old
    // slot for the duration of the round trip.
    onMutate: async ({ sequenceId, order }) => {
      const key = ["outreach", "sequences", sequenceId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<SequenceWithSteps>(key);
      if (prev) {
        const byId = new Map(prev.steps.map((s) => [s.id, s]));
        qc.setQueryData<SequenceWithSteps>(key, {
          ...prev,
          steps: order
            .map((id, i) => { const s = byId.get(id); return s ? { ...s, position: i } : null; })
            .filter((s): s is SequenceStep => s !== null),
        });
      }
      return { prev, key };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); },
    onSettled: (_d, _e, { sequenceId }) =>
      qc.invalidateQueries({ queryKey: ["outreach", "sequences", sequenceId] }),
  });
}

export function useDeleteStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sequenceId, stepId }: { sequenceId: string; stepId: string }) =>
      apiFetch(`/outreach/sequences/${sequenceId}/steps/${stepId}`, { method: "DELETE" }),
    onSuccess: (_d, { sequenceId }) => qc.invalidateQueries({ queryKey: ["outreach", "sequences", sequenceId] }),
  });
}

// ── Enrollments ───────────────────────────────────────────
export function useEnrollments(params: { status?: EnrollmentStatus; lead_id?: string; sequence_id?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.status)      qs.set("status",      params.status);
  if (params.lead_id)     qs.set("lead_id",     params.lead_id);
  if (params.sequence_id) qs.set("sequence_id", params.sequence_id);
  const q = qs.toString();
  return useQuery<Enrollment[]>({
    queryKey: ["outreach", "enrollments", params],
    queryFn:  () => apiFetch(`/outreach/enrollments${q ? `?${q}` : ""}`),
  });
}

// Hard-delete an enrollment (vs cancel which keeps the row). Admin-only on backend.
export function useDeleteEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/outreach/enrollments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outreach", "enrollments"] });
      qc.invalidateQueries({ queryKey: ["outreach", "sequences"] });
    },
  });
}

export function useEnrollLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { lead_id: string; sequence_id: string }) =>
      apiFetch("/outreach/enroll", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach", "enrollments"] }),
  });
}

export interface BulkEnrollResult {
  total:            number;
  enrolled:         number;
  already_enrolled: number;
  errors:           number;
  error_rows:       { lead_id: string; error: string }[];
}

export function useBulkEnroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { lead_ids: string[]; sequence_id: string }) =>
      apiFetch<BulkEnrollResult>("/outreach/enroll-bulk", {
        method: "POST",
        body:   JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outreach", "enrollments"] });
      qc.invalidateQueries({ queryKey: ["outreach", "sequences"] });
    },
  });
}

export function usePauseEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/outreach/enrollments/${id}/pause`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach", "enrollments"] }),
  });
}

export function useResumeEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/outreach/enrollments/${id}/resume`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach", "enrollments"] }),
  });
}

export function useCancelEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/outreach/enrollments/${id}/cancel`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach", "enrollments"] }),
  });
}

export function useEnrollmentSends(enrollmentId: string | null) {
  return useQuery<SendRecord[]>({
    queryKey: ["outreach", "enrollments", enrollmentId, "sends"],
    queryFn:  () => apiFetch(`/outreach/enrollments/${enrollmentId}/sends`),
    enabled:  !!enrollmentId,
  });
}

// ── Analytics ─────────────────────────────────────────────
export interface OutreachAnalytics {
  totals: {
    enrollments_total:  number;
    replied:            number;
    reply_rate:         number;
    sends_last_30_days: number;
    active_leads:       number;
    stale_leads:        number;
    pipeline_value:     number;
  };
  by_status:    { status: EnrollmentStatus; count: number }[];
  sends_by_day: { day: string; count: number }[];
  per_sequence: {
    sequence_id:   string;
    sequence_name: string;
    category:      string | null;
    is_active:     boolean;
    enrolled:      number;
    active:        number;
    replied:       number;
    completed:     number;
    sends:         number;
    reply_rate:    number;
  }[];
  by_niche: {
    category:       string;
    leads_total:    number;
    pipeline_value: number;
    enrolled:       number;
    replied:        number;
    sends:          number;
    reply_rate:     number;
  }[];
  by_source: {
    source:      string;
    leads_total: number;
    enrolled:    number;
    replied:     number;
    sends:       number;
    reply_rate:  number;
  }[];
  by_step: {
    position: number;
    label:    string;
    sends:    number;
  }[];
  best_niche: {
    category:    string;
    leads_total: number;
    enrolled:    number;
    replied:     number;
    reply_rate:  number;
  } | null;
}

export interface BulkIngestPayload {
  leads: Array<{
    name:        string;
    company:     string;
    email?:      string | null;
    phone?:      string | null;
    source?:     string | null;
    category?:   string | null;
    deal_value?: number;
    notes?:      string | null;
  }>;
}

export interface BulkIngestResult {
  total:       number;
  created:     number;
  deduped:     number;
  errors:      number;
  created_ids: string[];
  error_rows:  { index: number; error: string }[];
}

export function useBulkIngest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkIngestPayload) =>
      apiFetch<BulkIngestResult>("/outreach/leads/ingest-bulk", {
        method: "POST",
        body:   JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });
}

export function useOutreachAnalytics() {
  return useQuery<OutreachAnalytics>({
    queryKey: ["outreach", "analytics"],
    queryFn:  () => apiFetch("/outreach/analytics"),
    staleTime: 30_000,
  });
}

// ── Per-sequence analytics (drill-in) ─────────────────────
export interface SequenceAnalytics {
  sequence: {
    id:          string;
    name:        string;
    description: string | null;
    category:    string | null;
    is_active:   boolean;
    step_count:  number;
  };
  totals: {
    enrolled:        number;
    active:          number;
    paused:          number;
    completed:       number;
    replied:         number;
    failed:          number;
    sends:           number;
    sends_failed:    number;
    reply_rate:      number;
    completion_rate: number;
  };
  by_status: { status: EnrollmentStatus; count: number }[];
  funnel: {
    position:      number;
    label:         string;
    day_offset:    number;
    channel:       Channel;
    has_agent:     boolean;
    subject:       string | null;
    sent:          number;
    failed:        number;
    retention_pct: number;
  }[];
  sends_by_day: { day: string; count: number }[];
  recent_failures: {
    lead_name:    string | null;
    lead_company: string | null;
    lead_email:   string | null;
    error:        string | null;
    sent_at:      string;
  }[];
}

export function useSequenceAnalytics(sequenceId: string | null) {
  return useQuery<SequenceAnalytics>({
    queryKey: ["outreach", "analytics", "sequence", sequenceId],
    queryFn:  () => apiFetch(`/outreach/analytics/sequence/${sequenceId}`),
    enabled:  !!sequenceId,
    staleTime: 30_000,
  });
}
