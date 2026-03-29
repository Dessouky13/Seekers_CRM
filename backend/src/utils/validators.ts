import { z } from "zod";

// ── Auth ──────────────────────────────────────────────────

export const loginSchema = z.object({
  email:    z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  name:     z.string().min(1, "Name is required").max(100),
  email:    z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role:     z.enum(["admin", "member"]).optional(),
});

export const acceptInviteSchema = z.object({
  invite_token: z.string().min(1, "Invite token is required"),
  name:         z.string().min(1, "Name is required").max(100),
  password:     z.string().min(8, "Password must be at least 8 characters"),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email("Invalid email"),
});

export const passwordUpdateSchema = z.object({
  token:    z.string().min(1, "Reset token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1, "Refresh token is required"),
});

// ── Users ─────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  name:   z.string().min(1).max(100).optional(),
  avatar: z.string().max(255).optional(),
});

export const inviteUserSchema = z.object({
  email: z.string().email("Invalid email"),
  role:  z.enum(["admin", "member"]),
});

// ── Clients ───────────────────────────────────────────────

export const createClientSchema = z.object({
  name:    z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  email:   z.string().email().optional().or(z.literal("")),
  phone:   z.string().max(50).optional(),
  status:  z.enum(["active", "inactive", "prospect"]).optional(),
  industry: z.string().max(100).optional(),
  notes:   z.string().optional(),
});

export const updateClientSchema = createClientSchema.partial();

// ── Projects ──────────────────────────────────────────────

export const createProjectSchema = z.object({
  name:      z.string().min(1).max(200),
  client_id: z.string().uuid().optional(),
});

// ── Tasks ─────────────────────────────────────────────────

export const createTaskSchema = z.object({
  title:       z.string().min(1).max(300),
  description: z.string().optional(),
  assignee_id: z.string().uuid().optional(),
  priority:    z.enum(["low", "medium", "high", "critical"]).optional(),
  due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
  project_id:  z.string().uuid().optional(),
  client_id:   z.string().uuid().optional(),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  status: z.enum(["backlog", "todo", "in_progress", "review", "done"]).optional(),
});

export const createSubtaskSchema = z.object({
  title:    z.string().min(1).max(300),
  position: z.number().int().min(0).optional(),
});

// ── Finance ───────────────────────────────────────────────

export const createTransactionSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  type:        z.enum(["income", "expense"]),
  amount:      z.number().positive("Amount must be positive"),
  currency:    z.string().length(3).optional(),
  category:    z.string().min(1).max(100),
  client_id:   z.string().uuid().optional(),
  client_name: z.string().max(200).optional(),
  status:      z.enum(["completed", "pending", "cancelled"]).optional(),
  notes:       z.string().optional(),
});

export const updateTransactionSchema = createTransactionSchema.partial();

// ── CRM / Leads ───────────────────────────────────────────

export const createLeadSchema = z.object({
  name:        z.string().min(1).max(200),
  company:     z.string().min(1).max(200),
  email:       z.string().email().optional().or(z.literal("")),
  phone:       z.string().max(50).optional(),
  source:      z.string().max(100).optional(),
  category:    z.string().max(100).optional(),
  deal_value:  z.number().min(0).optional(),
  assignee_id: z.string().uuid().optional(),
  notes:       z.string().optional(),
});

export const updateLeadSchema = createLeadSchema.partial().extend({
  stage: z.enum([
    "new_lead", "contacted", "call_scheduled",
    "proposal_sent", "negotiation", "closed_won", "closed_lost",
  ]).optional(),
});

export const createLeadActivitySchema = z.object({
  type:        z.enum(["email", "call", "meeting", "form", "note"]),
  description: z.string().min(1).max(1000),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// ── Goals ─────────────────────────────────────────────────

export const createGoalSchema = z.object({
  title:       z.string().min(1).max(300),
  description: z.string().optional(),
  current:     z.number().min(0).optional(),
  target:      z.number().positive("Target must be positive"),
  unit:        z.string().max(20).optional(),
  period:      z.string().max(50).optional(),
  owner_id:    z.string().uuid().optional(),
});

export const updateGoalSchema = createGoalSchema.partial();

// ── Knowledge Base ────────────────────────────────────────

export const ragQuerySchema = z.object({
  query: z.string().min(1, "Query is required").max(1000),
  top_k: z.number().int().min(1).max(20).optional(),
});

// ── Notifications ─────────────────────────────────────────

// (no request body schemas needed — only query params)
