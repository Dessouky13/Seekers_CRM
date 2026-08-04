import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ApiTask } from "@/lib/types";

export interface TaskTemplateItem {
  id:         string;
  templateId: string;
  title:      string;
  priority:   "low" | "medium" | "high" | "critical";
  dayOffset:  number;
  position:   number;
}

export interface TaskTemplate {
  id:          string;
  name:        string;
  description: string | null;
  createdBy:   string | null;
  createdAt:   string;
  updatedAt:   string;
  items:       TaskTemplateItem[];
  item_count:  number;
  /** First item to last, in days — "this is a fortnight of work". */
  span_days:   number;
}

/** What the caller sends when saving a template. `position` is array order. */
export interface TaskTemplateInput {
  name:         string;
  description?: string | null;
  items: {
    title:       string;
    priority?:   TaskTemplateItem["priority"];
    day_offset?: number;
  }[];
}

export function useTaskTemplates(enabled = true) {
  return useQuery<TaskTemplate[]>({
    queryKey: ["task-templates"],
    queryFn:  () => apiFetch("/task-templates"),
    enabled,
    staleTime: 60_000,
  });
}

export function useCreateTaskTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskTemplateInput) =>
      apiFetch<TaskTemplate>("/task-templates", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-templates"] }),
  });
}

export function useDeleteTaskTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/task-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-templates"] }),
  });
}

export interface ApplyTemplateResult {
  template_id:   string;
  template_name: string;
  created:       number;
  tasks:         ApiTask[];
}

export function useApplyTaskTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; start_date?: string; assignee_id?: string | null;
      project_id?: string | null; client_id?: string | null;
    }) =>
      apiFetch<ApplyTemplateResult>(`/task-templates/${id}/apply`, {
        method: "POST", body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      // Applied tasks have due dates, so several of them are "due today" the
      // moment they land — Today must not keep showing the old queue.
      qc.invalidateQueries({ queryKey: ["worklist"] });
    },
  });
}
