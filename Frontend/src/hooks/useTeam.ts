import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ApiUser } from "@/lib/types";

export interface TeamMemberWork extends ApiUser {
  leads: {
    total: number; open: number; won: number; lost: number; stale: number;
    pipeline: number; won_value: number;
  };
  tasks: {
    total: number; done: number; in_progress: number; overdue: number;
    done_this_week: number; completion_rate: number;
  };
  outreach: { enrolled: number; replied: number; sends: number };
  activity: { last_at: string | null; logged_last_7d: number };
  /** Real sign-in telemetry — distinct from `activity`, which measures output. */
  session: {
    last_login_at: string | null;
    last_seen_at:  string | null;
    logins_total:  number;
    logins_30d:    number;
    logins_7d:     number;
    failed_24h:    number;
    is_online:     boolean;
    /** Genuinely unused account: no recorded sign-in AND never seen. */
    never_logged_in: boolean;
    /** Active, but their sign-in happened before login tracking existed. */
    login_history_predates_tracking: boolean;
  };
}

/** Per-person workload + output. Admin only. */
export function useTeamWorkSummary() {
  return useQuery<TeamMemberWork[]>({
    queryKey: ["team-work-summary"],
    queryFn:  async () => {
      const rows = await apiFetch<TeamMemberWork[]>("/users/work-summary");
      // The frontend deploys from git while the API is restarted separately, so
      // for a minute or two after release the browser can be running new code
      // against the previous API. `session` would be undefined there and every
      // read of it would throw. Fill it in rather than crash the page.
      return rows.map((r) => ({
        ...r,
        session: r.session ?? {
          last_login_at: null, last_seen_at: null,
          logins_total: 0, logins_30d: 0, logins_7d: 0,
          failed_24h: 0, is_online: false, never_logged_in: false,
          login_history_predates_tracking: false,
        },
      }));
    },
    staleTime: 30_000,
    // Presence goes stale on its own, so the dot has to be refreshed on a timer
    // or "online now" quietly becomes "was online when you opened the page".
    refetchInterval: 60_000,
  });
}

export interface MemberWorkDetail {
  user: ApiUser;
  leads: {
    id: string; name: string; company: string; stage: string;
    dealValue: string; lastActivity: string | null; category: string | null;
  }[];
  tasks: {
    id: string; title: string; status: string; priority: string;
    dueDate: string | null; completedAt: string | null;
  }[];
  activity: {
    id: string; type: string; description: string; date: string;
    createdAt: string; lead_name: string | null; lead_company: string | null;
  }[];
  logins: {
    id: string; success: boolean; ip: string | null;
    userAgent: string | null; createdAt: string;
  }[];
  /** Unified action feed, newest first, across every table that records authorship. */
  timeline: {
    at: string;
    kind: "lead_activity" | "task_created" | "task_completed" | "enrolled"
        | "transaction" | "agent_run" | "login";
    detail:  string | null;
    subject: string | null;
    body:    string | null;
    link_id: string | null;
  }[];
}

export function useMemberWork(userId: string | null) {
  return useQuery<MemberWorkDetail>({
    queryKey: ["member-work", userId],
    queryFn:  () => apiFetch(`/users/${userId}/work`),
    enabled:  !!userId,
  });
}

export function useCreateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; email: string; password: string; role: "admin" | "member" }) =>
      apiFetch<ApiUser>("/users/create", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-work-summary"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useDeleteTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-work-summary"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useUpdateTeamMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: "admin" | "member" }) =>
      apiFetch<ApiUser>(`/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-work-summary"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}
