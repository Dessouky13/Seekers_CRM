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
}

/** Per-person workload + output. Admin only. */
export function useTeamWorkSummary() {
  return useQuery<TeamMemberWork[]>({
    queryKey: ["team-work-summary"],
    queryFn:  () => apiFetch("/users/work-summary"),
    staleTime: 30_000,
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
