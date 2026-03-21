// ── API response shapes — mirrors backend Drizzle schema ──

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  role: "admin" | "member";
  createdAt: string;
  updatedAt: string;
}

export interface ApiClient {
  id: string;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  status: "active" | "inactive" | "prospect";
  industry: string | null;
  totalRevenue: string; // numeric → string from Postgres
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  project_count: number;
}

export interface ApiClientDetail extends Omit<ApiClient, "project_count"> {
  projects: { id: string; name: string }[];
  tasks: ApiTask[];
  recent_transactions: ApiTransaction[];
}

export interface ApiSubtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  position: number;
}

export interface ApiTask {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assignee_name: string | null;
  assignee_avatar: string | null;
  priority: "low" | "medium" | "high" | "critical";
  status: "backlog" | "todo" | "in_progress" | "review" | "done";
  dueDate: string | null;
  completedAt: string | null;
  projectId: string | null;
  project_name: string | null;
  clientId: string | null;
  client_name: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  subtasks: ApiSubtask[];
}

export interface ApiProject {
  id: string;
  name: string;
  clientId: string | null;
  createdAt: string;
}

export interface ApiTransaction {
  id: string;
  date: string;
  type: "income" | "expense";
  amount: string;
  currency: string;
  category: string;
  clientId: string | null;
  clientName: string | null;
  status: "completed" | "pending" | "cancelled";
  notes: string | null;
  createdAt: string;
}

export interface ApiLeadActivity {
  id: string;
  leadId: string;
  type: "email" | "call" | "meeting" | "form" | "note";
  description: string;
  date: string;
  createdAt: string;
}

export type LeadStage =
  | "new_lead" | "contacted" | "call_scheduled"
  | "proposal_sent" | "negotiation" | "closed_won" | "closed_lost";

export interface ApiLead {
  id: string;
  name: string;
  company: string;
  email: string | null;
  source: string | null;
  dealValue: string;
  stage: LeadStage;
  assigneeId: string | null;
  assignee_name: string | null;
  lastActivity: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiLeadDetail extends ApiLead {
  activities: ApiLeadActivity[];
}

export interface ApiGoal {
  id: string;
  title: string;
  description: string | null;
  current: string;
  target: string;
  unit: string | null;
  period: string | null;
  ownerId: string | null;
  owner_name: string | null;
  progress_pct: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKbDocument {
  id: string;
  title: string;
  filePath: string | null;
  fileUrl: string | null;
  fileType: string | null;
  fileSize: number | null;
  uploadedBy: string | null;
  status: "processing" | "ready" | "error";
  createdAt: string;
}

export interface DashboardSummary {
  finance: {
    total_income: number;
    total_expenses: number;
    net_profit: number;
    profit_margin: number;
    revenue_by_month: { month: string; revenue: number }[];
    expense_by_category: { name: string; value: number }[];
  };
  tasks: {
    total: number;
    completed: number;
    overdue: number;
    completion_rate: number;
    overdue_items: { id: string; title: string; due_date: string | null; priority: string; assignee_name: string | null }[];
  };
  leads: { total: number; active: number; pipeline_value: number };
  goals: { title: string; current: number; target: number; progress_pct: number }[];
}
