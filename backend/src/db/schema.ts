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
  currency:   text("currency").notNull().default("USD"),
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
