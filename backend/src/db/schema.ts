import {
  pgTable, uuid, text, numeric, boolean,
  timestamp, date, integer, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// pgvector custom type (requires CREATE EXTENSION IF NOT EXISTS vector in DB)
import { customType } from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    return config?.dimensions ? `vector(${config.dimensions})` : "vector";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map(Number);
  },
});

// ── Profiles ──────────────────────────────────────────────
export const profiles = pgTable("profiles", {
  id:        uuid("id").primaryKey().defaultRandom(),
  name:      text("name").notNull(),
  email:     text("email").notNull().unique(),
  password:  text("password").notNull(),          // bcrypt hash
  avatar:    text("avatar"),
  role:      text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  // Optional role label shown in the email signature (e.g. "Founder", "Sales Lead")
  title:     text("title"),
  // Phone (used in email signature + optional WhatsApp link). Plain text format, e.g. "+20 12 1110 0767"
  phone:     text("phone"),
  // Custom email signature HTML or plain text. If null, a default is built from name/title.
  signature: text("signature"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Refresh Tokens ────────────────────────────────────────
export const refreshTokens = pgTable("refresh_tokens", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  token:     text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Password Reset Tokens ─────────────────────────────────
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  token:     text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used:      boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Team Invites ──────────────────────────────────────────
export const teamInvites = pgTable("team_invites", {
  id:        uuid("id").primaryKey().defaultRandom(),
  email:     text("email").notNull(),
  role:      text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  token:     text("token").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => profiles.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used:      boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Clients ───────────────────────────────────────────────
export const clients = pgTable("clients", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         text("name").notNull(),
  company:      text("company").notNull(),
  email:        text("email"),
  phone:        text("phone"),
  status:       text("status", { enum: ["active", "inactive", "prospect"] }).notNull().default("prospect"),
  industry:     text("industry"),
  totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 }).notNull().default("0"),
  notes:        text("notes"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index("idx_clients_status").on(t.status),
}));

// ── Projects ──────────────────────────────────────────────
export const projects = pgTable("projects", {
  id:        uuid("id").primaryKey().defaultRandom(),
  name:      text("name").notNull(),
  clientId:  uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Tasks ─────────────────────────────────────────────────
export const tasks = pgTable("tasks", {
  id:          uuid("id").primaryKey().defaultRandom(),
  title:       text("title").notNull(),
  description: text("description"),
  assigneeId:  uuid("assignee_id").references(() => profiles.id, { onDelete: "set null" }),
  priority:    text("priority", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
  status:      text("status", { enum: ["backlog", "todo", "in_progress", "review", "done"] }).notNull().default("backlog"),
  dueDate:     date("due_date"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  projectId:   uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  clientId:    uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  createdBy:   uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx:   index("idx_tasks_status").on(t.status),
  assigneeIdx: index("idx_tasks_assignee").on(t.assigneeId),
  projectIdx:  index("idx_tasks_project").on(t.projectId),
  clientIdx:   index("idx_tasks_client").on(t.clientId),
}));

// ── Subtasks ──────────────────────────────────────────────
export const subtasks = pgTable("subtasks", {
  id:       uuid("id").primaryKey().defaultRandom(),
  taskId:   uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  title:    text("title").notNull(),
  done:     boolean("done").notNull().default(false),
  position: integer("position").notNull().default(0),
});

// ── Transactions ──────────────────────────────────────────
export const transactions = pgTable("transactions", {
  id:         uuid("id").primaryKey().defaultRandom(),
  date:       date("date").notNull(),
  type:       text("type", { enum: ["income", "expense"] }).notNull(),
  amount:     numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency:   text("currency").notNull().default("EGP"),
  category:   text("category").notNull(),
  clientId:   uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name"),
  status:     text("status", { enum: ["completed", "pending", "cancelled"] }).notNull().default("completed"),
  notes:      text("notes"),
  createdBy:  uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dateIdx: index("idx_transactions_date").on(t.date),
  typeIdx: index("idx_transactions_type").on(t.type),
  clientIdx: index("idx_transactions_client").on(t.clientId),
}));

// ── Leads ─────────────────────────────────────────────────
export const leads = pgTable("leads", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         text("name").notNull(),
  company:      text("company").notNull(),
  email:        text("email"),
  phone:        text("phone"),
  source:       text("source"),
  category:     text("category"),   // niche / industry vertical
  dealValue:    numeric("deal_value", { precision: 12, scale: 2 }).notNull().default("0"),
  stage:        text("stage", {
    enum: ["new_lead", "contacted", "call_scheduled", "proposal_sent", "negotiation", "closed_won", "closed_lost"],
  }).notNull().default("new_lead"),
  assigneeId:   uuid("assignee_id").references(() => profiles.id, { onDelete: "set null" }),
  lastActivity: date("last_activity"),
  notes:        text("notes"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  stageIdx:    index("idx_leads_stage").on(t.stage),
  categoryIdx: index("idx_leads_category").on(t.category),
  nameIdx:     index("idx_leads_name").on(t.name),
  companyIdx:  index("idx_leads_company").on(t.company),
}));

// ── Lead Activities ───────────────────────────────────────
export const leadActivities = pgTable("lead_activities", {
  id:          uuid("id").primaryKey().defaultRandom(),
  leadId:      uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  type:        text("type", { enum: ["email", "call", "meeting", "form", "note"] }).notNull(),
  description: text("description").notNull(),
  date:        date("date").notNull().default(sql`CURRENT_DATE`),
  createdBy:   uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  leadIdx: index("idx_lead_activities_lead").on(t.leadId),
}));

// ── Goals ─────────────────────────────────────────────────
export const goals = pgTable("goals", {
  id:          uuid("id").primaryKey().defaultRandom(),
  title:       text("title").notNull(),
  description: text("description"),
  current:     numeric("current", { precision: 12, scale: 2 }).notNull().default("0"),
  target:      numeric("target", { precision: 12, scale: 2 }).notNull(),
  unit:        text("unit").default(""),
  period:      text("period"),
  ownerId:     uuid("owner_id").references(() => profiles.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── KB Documents ──────────────────────────────────────────
export const kbDocuments = pgTable("kb_documents", {
  id:         uuid("id").primaryKey().defaultRandom(),
  title:      text("title").notNull(),
  filePath:   text("file_path"),        // Absolute path on VPS disk
  fileUrl:    text("file_url"),         // Public serving URL via Nginx
  fileType:   text("file_type"),
  fileSize:   integer("file_size"),
  uploadedBy: uuid("uploaded_by").references(() => profiles.id, { onDelete: "set null" }),
  status:     text("status", { enum: ["processing", "ready", "error"] }).notNull().default("processing"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── KB Chunks (pgvector) ──────────────────────────────────
export const kbChunks = pgTable("kb_chunks", {
  id:         uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => kbDocuments.id, { onDelete: "cascade" }),
  content:    text("content").notNull(),
  // NOTE: On VPS (Linux), change this to: vector("embedding", { dimensions: 1536 })
  // Requires: CREATE EXTENSION vector; (pgvector — not available as prebuilt on Windows)
  embedding:  vector("embedding", { dimensions: 1536 }),
  chunkIndex: integer("chunk_index").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  documentIdx: index("idx_kb_chunks_document").on(t.documentId),
  // IVFFlat index created separately after data exists:
  // CREATE INDEX CONCURRENTLY idx_kb_chunks_embedding
  //   ON kb_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
}));

// ── Notifications ─────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  type:      text("type").notNull(),
  title:     text("title").notNull(),
  body:      text("body"),
  read:      boolean("read").notNull().default(false),
  link:      text("link"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("idx_notifications_user").on(t.userId, t.read, t.createdAt),
}));

// ── Notification Events (dedupe/idempotency) ─────────────
export const notificationEvents = pgTable("notification_events", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  eventKey:  text("event_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userEventIdx: index("idx_notification_events_user_event").on(t.userId, t.eventKey),
}));

// ── Team Notes (personal notepad per user) ────────────────
export const teamNotes = pgTable("team_notes", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }).unique(),
  content:   text("content").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Idea Board (shared team moodboard) ────────────────────
export const ideaBoard = pgTable("idea_board", {
  id:         uuid("id").primaryKey().defaultRandom(),
  content:    text("content").notNull(),
  color:      text("color").notNull().default("yellow"),
  authorId:   uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  authorName: text("author_name"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Vault (shared password store) ─────────────────────────
export const vaultEntries = pgTable("vault_entries", {
  id:        uuid("id").primaryKey().defaultRandom(),
  title:     text("title").notNull(),
  username:  text("username"),
  password:  text("password").notNull(),
  url:       text("url"),
  category:  text("category").notNull().default("General"),
  notes:     text("notes"),
  createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── AI Agent Runs (audit log + history) ──────────────────
export const agentRuns = pgTable("agent_runs", {
  id:           uuid("id").primaryKey().defaultRandom(),
  agentId:      text("agent_id").notNull(),
  scope:        text("scope", { enum: ["lead", "client", "task", "pipeline", "global"] }).notNull(),
  contextId:    uuid("context_id"),                  // lead/client/task id
  contextLabel: text("context_label"),               // human-readable label
  inputSummary: text("input_summary"),
  output:       text("output").notNull(),
  model:        text("model").notNull(),
  tokensIn:     integer("tokens_in").notNull().default(0),
  tokensOut:    integer("tokens_out").notNull().default(0),
  costUsd:      numeric("cost_usd", { precision: 10, scale: 5 }).notNull().default("0"),
  status:       text("status", { enum: ["success", "error"] }).notNull().default("success"),
  error:        text("error"),
  createdBy:    uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  agentIdx:   index("idx_agent_runs_agent").on(t.agentId, t.createdAt),
  contextIdx: index("idx_agent_runs_context").on(t.scope, t.contextId),
}));

// ── Outreach Sequences ────────────────────────────────────
export const outreachSequences = pgTable("outreach_sequences", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         text("name").notNull(),
  description:  text("description"),
  category:     text("category"),                                              // niche this sequence is for, optional
  isActive:     boolean("is_active").notNull().default(true),
  // If set, auto-enroll new leads with matching category. NULL = manual only.
  autoEnrollOnCategory: boolean("auto_enroll_on_category").notNull().default(false),
  // If set, auto-enroll EVERY new lead regardless of category (use carefully).
  autoEnrollAll:        boolean("auto_enroll_all").notNull().default(false),
  createdBy:    uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activeIdx:   index("idx_sequences_active").on(t.isActive),
  categoryIdx: index("idx_sequences_category").on(t.category),
}));

// ── Outreach Steps (a sequence has many steps) ───────────
export const outreachSteps = pgTable("outreach_steps", {
  id:              uuid("id").primaryKey().defaultRandom(),
  sequenceId:      uuid("sequence_id").notNull().references(() => outreachSequences.id, { onDelete: "cascade" }),
  position:        integer("position").notNull(),                              // 0,1,2,... for ordering
  dayOffset:       integer("day_offset").notNull(),                            // days after enrollment to send
  channel:         text("channel", { enum: ["email", "linkedin", "note"] }).notNull().default("email"),
  subjectTemplate: text("subject_template"),
  bodyTemplate:    text("body_template"),                                      // mustache-style {{name}}, {{company}}
  agentId:         text("agent_id"),                                           // if set, agent generates body per-lead
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sequenceIdx: index("idx_steps_sequence").on(t.sequenceId, t.position),
}));

// ── Outreach Enrollments (a lead's progress through a sequence) ─
export const outreachEnrollments = pgTable("outreach_enrollments", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  leadId:              uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
  sequenceId:          uuid("sequence_id").notNull().references(() => outreachSequences.id, { onDelete: "cascade" }),
  currentStep:         integer("current_step").notNull().default(0),
  status:              text("status", { enum: ["active", "paused", "completed", "failed", "replied"] }).notNull().default("active"),
  enrolledAt:          timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  nextSendAt:          timestamp("next_send_at", { withTimezone: true }),
  lastStepCompletedAt: timestamp("last_step_completed_at", { withTimezone: true }),
  completedAt:         timestamp("completed_at", { withTimezone: true }),
  pausedReason:        text("paused_reason"),
  enrolledBy:          uuid("enrolled_by").references(() => profiles.id, { onDelete: "set null" }),
}, (t) => ({
  leadIdx:     index("idx_enrollments_lead").on(t.leadId),
  statusIdx:   index("idx_enrollments_status").on(t.status, t.nextSendAt),
  uniqueIdx:   index("idx_enrollments_unique").on(t.leadId, t.sequenceId),     // prevent dupes
}));

// ── Outreach Sends (audit log of every email sent) ───────
export const outreachSends = pgTable("outreach_sends", {
  id:           uuid("id").primaryKey().defaultRandom(),
  enrollmentId: uuid("enrollment_id").notNull().references(() => outreachEnrollments.id, { onDelete: "cascade" }),
  stepId:       uuid("step_id").references(() => outreachSteps.id, { onDelete: "set null" }),
  channel:      text("channel").notNull().default("email"),
  subject:      text("subject"),
  body:         text("body"),
  sentAt:       timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  status:       text("status", { enum: ["sent", "failed"] }).notNull().default("sent"),
  messageId:    text("message_id"),
  error:        text("error"),
}, (t) => ({
  enrollmentIdx: index("idx_sends_enrollment").on(t.enrollmentId, t.sentAt),
}));

// ── Webhook Subscriptions ─────────────────────────────────
// Lets the user wire CRM events to any external system (n8n, Slack, WhatsApp via
// Twilio, custom servers). Each subscription listens for one event type and
// POSTs to a target URL with the event payload.
export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         text("name").notNull(),
  event:        text("event").notNull(),                 // e.g. "lead.created", "lead.replied"
  url:          text("url").notNull(),
  secret:       text("secret"),                          // optional — sent as X-Webhook-Secret header
  isActive:     boolean("is_active").notNull().default(true),
  createdBy:    uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  eventActiveIdx: index("idx_webhook_subs_event_active").on(t.event, t.isActive),
}));

// ── Webhook Delivery Log (for debugging) ─────────────────
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id:             uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id").references(() => webhookSubscriptions.id, { onDelete: "cascade" }),
  event:          text("event").notNull(),
  url:            text("url").notNull(),
  payload:        text("payload").notNull(),
  statusCode:     integer("status_code"),
  responseBody:   text("response_body"),
  error:          text("error"),
  deliveredAt:    timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  subIdx: index("idx_webhook_deliveries_sub").on(t.subscriptionId, t.deliveredAt),
}));

// ── Vault Categories (dynamic, team-managed) ─────────────
export const vaultCategories = pgTable("vault_categories", {
  id:        uuid("id").primaryKey().defaultRandom(),
  name:      text("name").notNull().unique(),
  isActive:  boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activeSortIdx: index("idx_vault_categories_active_sort").on(t.isActive, t.sortOrder),
}));
