import { z } from "zod";

/**
 * Canonical email input: trim and lowercase BEFORE validating.
 *
 * Order matters — zod runs string checks in chain order, so `.email()` last
 * means "  Bob@Example.COM " is normalised to "bob@example.com" and accepted,
 * instead of being rejected outright for the stray whitespace a phone keyboard
 * or a copy-paste adds. Every address is stored lowercase, so normalising at
 * the edge is what keeps login, password reset and invites agreeing on the
 * same key.
 */
export const emailInput = z.string().trim().toLowerCase().email("Invalid email");

// ── Auth ──────────────────────────────────────────────────

export const loginSchema = z.object({
  email:    emailInput,
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  name:     z.string().min(1, "Name is required").max(100),
  email:    emailInput,
  password: z.string().min(8, "Password must be at least 8 characters"),
  role:     z.enum(["admin", "member"]).optional(),
});

export const acceptInviteSchema = z.object({
  invite_token: z.string().min(1, "Invite token is required"),
  name:         z.string().min(1, "Name is required").max(100),
  password:     z.string().min(8, "Password must be at least 8 characters"),
});

export const passwordResetRequestSchema = z.object({
  email: emailInput,
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
  name:      z.string().min(1).max(100).optional(),
  avatar:    z.string().max(255).optional(),
  title:     z.string().max(120).optional().nullable(),
  phone:     z.string().max(40).optional().nullable(),
  signature: z.string().max(8000).optional().nullable(),
  // Admin-only — the route rejects this field for non-admins and refuses to
  // demote the last remaining admin.
  role:      z.enum(["admin", "member"]).optional(),
});

// An invite typed as "Bob@Example.com" used to create an account its owner
// could never sign into, because login looks the address up lowercased.
export const inviteUserSchema = z.object({
  email: emailInput,
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

// The clearable relations accept an explicit `null` so the UI can actually
// unassign a task / detach it from a project, client or due date. `.optional()`
// alone made those fields write-once.
export const updateTaskSchema = createTaskSchema.partial().extend({
  status:      z.enum(["backlog", "todo", "in_progress", "review", "done"]).optional(),
  description: z.string().nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  project_id:  z.string().uuid().nullable().optional(),
  client_id:   z.string().uuid().nullable().optional(),
  due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").nullable().optional(),
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
  // Multi-select. categories[0] is the PRIMARY category that owns the amount
  // in P&L breakdowns, so totals always reconcile. `category` is still
  // accepted for backwards compatibility (older clients / n8n).
  categories:  z.array(z.string().min(1).max(100)).min(1).max(10).optional(),
  category:    z.string().min(1).max(100).optional(),
  tool_id:     z.string().uuid().nullable().optional(),
  client_id:   z.string().uuid().optional(),
  client_name: z.string().max(200).optional(),
  status:      z.enum(["completed", "pending", "cancelled"]).optional(),
  // Cash position: who physically holds / fronted this money (null = company account)
  held_by:     z.string().uuid().nullable().optional(),
  settled:     z.boolean().optional(),
  notes:       z.string().optional(),
}).refine(
  (d) => !!(d.categories?.length || d.category),
  { message: "At least one category is required", path: ["categories"] },
);

// .partial() isn't available on a refined schema — declare the PATCH shape
// explicitly so any subset of fields can be sent.
export const updateTransactionSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
  type:        z.enum(["income", "expense"]).optional(),
  amount:      z.number().positive("Amount must be positive").optional(),
  currency:    z.string().length(3).optional(),
  categories:  z.array(z.string().min(1).max(100)).min(1).max(10).optional(),
  category:    z.string().min(1).max(100).optional(),
  tool_id:     z.string().uuid().nullable().optional(),
  client_id:   z.string().uuid().optional(),
  client_name: z.string().max(200).optional(),
  status:      z.enum(["completed", "pending", "cancelled"]).optional(),
  held_by:     z.string().uuid().nullable().optional(),
  settled:     z.boolean().optional(),
  notes:       z.string().optional(),
});

// ── Tools ─────────────────────────────────────────────────
export const createToolSchema = z.object({
  name:           z.string().min(1).max(120),
  vendor:         z.string().max(120).nullable().optional(),
  url:            z.string().max(300).nullable().optional(),
  kind:           z.string().max(60).nullable().optional(),
  monthly_budget: z.number().nonnegative().nullable().optional(),
  active:         z.boolean().optional(),
  notes:          z.string().max(2000).nullable().optional(),
});
export const updateToolSchema = createToolSchema.partial();

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

export const externalNotificationSchema = z.object({
  user_id: z.string().uuid().optional(),
  target: z.enum(["all", "admins", "members"]).optional(),
  type: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  link: z.string().max(300).optional(),
}).refine((value) => value.user_id || value.target, {
  message: "Either user_id or target is required",
});

// ── CRM Insights ─────────────────────────────────────────

export const crmInsightsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period: z.enum(["daily", "weekly", "monthly"]).optional(),
  include_ai: z.enum(["true", "false"]).optional(),
});
