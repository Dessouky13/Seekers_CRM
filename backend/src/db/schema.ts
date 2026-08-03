import {
  pgTable, uuid, text, numeric, boolean,
  timestamp, date, integer, index, uniqueIndex, jsonb,
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
  // Last authenticated request, refreshed at most once every few minutes by the
  // auth middleware. This is what "online now" and "last active" on the Team
  // page read — previously that was inferred from when someone last logged a
  // lead note, which said nothing about whether they had opened the app.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Login Events ──────────────────────────────────────────
// One row per sign-in attempt. Gives the Team page a real last-login, a login
// count and a history, and gives an admin a way to spot a member being
// brute-forced (repeated `success = false` against one email).
//
// Failed attempts store the submitted email rather than a user id, because the
// account may not exist — that is exactly the case worth seeing.
export const loginEvents = pgTable("login_events", {
  id:        uuid("id").primaryKey().defaultRandom(),
  userId:    uuid("user_id").references(() => profiles.id, { onDelete: "cascade" }),
  email:     text("email").notNull(),
  success:   boolean("success").notNull(),
  ip:        text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx:  index("idx_login_events_user").on(t.userId, t.createdAt),
  emailIdx: index("idx_login_events_email").on(t.email, t.createdAt),
}));

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
// ── Tools / Subscriptions ─────────────────────────────────
// Tool names used to be typed free-hand into transaction notes ("Claude",
// "Claude.ai", "Openai API", "OpenAI API"), which made per-tool spend
// impossible to total. Tools are now first-class rows and transactions
// reference them, so naming is normalised once.
export const tools = pgTable("tools", {
  id:        uuid("id").primaryKey().defaultRandom(),
  name:      text("name").notNull().unique(),
  vendor:    text("vendor"),                     // e.g. "Anthropic"
  url:       text("url"),
  // What the tool is for — free text so it can be grouped in reports.
  kind:      text("kind"),                       // e.g. "AI", "Infra", "Automation"
  // Expected recurring cost, for budget-vs-actual. Null = variable/usage-based.
  monthlyBudget: numeric("monthly_budget", { precision: 12, scale: 2 }),
  active:    boolean("active").notNull().default(true),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  nameIdx:   index("idx_tools_name").on(t.name),
  activeIdx: index("idx_tools_active").on(t.active),
}));

export const transactions = pgTable("transactions", {
  id:         uuid("id").primaryKey().defaultRandom(),
  date:       date("date").notNull(),
  type:       text("type", { enum: ["income", "expense"] }).notNull(),
  amount:     numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency:   text("currency").notNull().default("EGP"),
  // PRIMARY category — owns the amount in P&L breakdowns so totals always
  // reconcile to the real total. Kept in sync with categories[0].
  category:   text("category").notNull(),
  // Full multi-select. categories[0] === category. Extra entries are tags
  // used for filtering, and never double-count in the P&L breakdown.
  categories: text("categories").array().notNull().default(sql`ARRAY[]::text[]`),
  // Which tool this expense paid for (expenses only). Replaces typing the
  // tool name into notes.
  toolId:     uuid("tool_id").references(() => tools.id, { onDelete: "set null" }),
  clientId:   uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName: text("client_name"),
  status:     text("status", { enum: ["completed", "pending", "cancelled"] }).notNull().default("completed"),
  // ── Cash position ──
  // Who physically holds/fronted this money instead of the company account.
  //   income  + heldBy=X → X is holding company cash (X owes the company)
  //   expense + heldBy=X → X paid from their own pocket (company owes X)
  // NULL = went through the company account, nothing outstanding.
  heldBy:     uuid("held_by").references(() => profiles.id, { onDelete: "set null" }),
  // Set once the money has actually been handed over / reimbursed.
  settledAt:  timestamp("settled_at", { withTimezone: true }),
  notes:      text("notes"),
  createdBy:  uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dateIdx: index("idx_transactions_date").on(t.date),
  typeIdx: index("idx_transactions_type").on(t.type),
  clientIdx: index("idx_transactions_client").on(t.clientId),
  toolIdx:   index("idx_transactions_tool").on(t.toolId),
  heldByIdx: index("idx_transactions_held_by").on(t.heldBy, t.settledAt),
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
  // ── v2 Lead Intelligence (populated by n8n via /intel/* ingest) ──
  domain:          text("domain"),                        // company website domain, for matching
  emailStatus:     text("email_status"),                  // verified | risky | invalid | unknown | bounced
  icpScore:        integer("icp_score"),                  // 0-100, computed server-side
  techFingerprint: jsonb("tech_fingerprint"),             // chat widget, booking, CMS, pagespeed…
  reviewStats:     jsonb("review_stats"),                 // rating, count, source
  complaintTags:   text("complaint_tags").array(),        // slow_response, booking_chaos, …
  signals:         jsonb("signals"),                      // catch-all: enrichment contacts, hooks…
  // ── Outreach channels (phone routing) ──
  // Normalised once on write, so routing never re-parses free text.
  phoneE164:      text("phone_e164"),
  phoneType:      text("phone_type", { enum: ["mobile", "landline", "unknown"] }),
  // Learned from outcomes: there is no compliant free WhatsApp presence check.
  whatsappStatus: text("whatsapp_status", { enum: ["unknown", "yes", "no"] }).notNull().default("unknown"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  stageIdx:    index("idx_leads_stage").on(t.stage),
  // The tenant-isolation key. Every member-scoped read filters on it — the
  // worklist alone does so five times per request — and it was unindexed, so
  // EXPLAIN showed a Seq Scan over the whole table on every member page load.
  assigneeIdx: index("idx_leads_assignee").on(t.assigneeId),
  categoryIdx: index("idx_leads_category").on(t.category),
  nameIdx:     index("idx_leads_name").on(t.name),
  companyIdx:  index("idx_leads_company").on(t.company),
  domainIdx:   index("idx_leads_domain").on(t.domain),
  phoneTypeIdx:      index("idx_leads_phone_type").on(t.phoneType),
  whatsappStatusIdx: index("idx_leads_whatsapp_status").on(t.whatsappStatus),
}));

// ── Events (append-only fact log — the learning-loop training data) ──
// Written by n8n (via /events) and by the CRM itself. Never updated/deleted.
export const events = pgTable("events", {
  id:        uuid("id").primaryKey().defaultRandom(),
  leadId:    uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  type:      text("type").notNull(),   // sourced|verified|sent|bounce|open|click|reply|unsub|meeting|won|lost|fingerprinted|enriched|reviewed|audit_view|error…
  payload:   jsonb("payload"),
  source:    text("source"),           // "n8n", "crm", workflow name…
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  leadIdx: index("idx_events_lead").on(t.leadId),
  typeIdx: index("idx_events_type").on(t.type, t.createdAt),
}));

// ── Mailboxes (deliverability ops — health signals pushed by n8n) ──
export const mailboxes = pgTable("mailboxes", {
  id:                uuid("id").primaryKey().defaultRandom(),
  address:           text("address").notNull().unique(),
  dailyCap:          integer("daily_cap").notNull().default(0),
  sentToday:         integer("sent_today").notNull().default(0),
  healthScore:       integer("health_score"),                    // 0-100, computed
  warmupStage:       text("warmup_stage"),                       // warmup | active | recovery
  inboxPlacementPct: numeric("inbox_placement_pct", { precision: 5, scale: 2 }),
  bounceRate:        numeric("bounce_rate", { precision: 5, scale: 2 }),
  dnsblListings:     jsonb("dnsbl_listings"),
  seedResults:       jsonb("seed_results"),
  lastCheckedAt:     timestamp("last_checked_at", { withTimezone: true }),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Audits (per-lead audit lead-magnet + intent tracking) ──
export const audits = pgTable("audits", {
  id:        uuid("id").primaryKey().defaultRandom(),
  leadId:    uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  slug:      text("slug").notNull().unique(),
  score:     integer("score"),
  issues:    jsonb("issues"),
  quickWins: jsonb("quick_wins"),
  pdfUrl:    text("pdf_url"),
  pageUrl:   text("page_url"),
  views:     integer("views").notNull().default(0),
  hotFired:  boolean("hot_fired").notNull().default(false),   // lead.hot already alerted?
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugIdx: index("idx_audits_slug").on(t.slug),
  leadIdx: index("idx_audits_lead").on(t.leadId),
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
  // Requires: CREATE EXTENSION vector;  (pgvector)
  // pgvector has no prebuilt Windows binary, so a local dev DB will not have
  // the extension and `db:push` will fail on this column — Knowledge Base is a
  // VPS-only feature locally. Everything else works without it.
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
  channel:         text("channel", {
    // whatsapp and call are MANUAL: the scheduler raises a task instead of
    // sending, because a human has to press send.
    enum: ["email", "linkedin", "note", "whatsapp", "call"],
  }).notNull().default("email"),
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
  status:              text("status", {
    // awaiting_action: blocked on a human completing a manual step. Distinct
    // from paused, which means something went wrong.
    enum: ["active", "paused", "completed", "failed", "replied", "awaiting_action"],
  }).notNull().default("active"),
  enrolledAt:          timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  nextSendAt:          timestamp("next_send_at", { withTimezone: true }),
  lastStepCompletedAt: timestamp("last_step_completed_at", { withTimezone: true }),
  completedAt:         timestamp("completed_at", { withTimezone: true }),
  pausedReason:        text("paused_reason"),
  enrolledBy:          uuid("enrolled_by").references(() => profiles.id, { onDelete: "set null" }),
}, (t) => ({
  leadIdx:     index("idx_enrollments_lead").on(t.leadId),
  statusIdx:   index("idx_enrollments_status").on(t.status, t.nextSendAt),
  // Plain lookup index over ALL rows, live or historical. Deliberately not
  // unique: re-enrolling a lead whose previous run is completed/failed/replied
  // is a legitimate action, so several rows may legitimately share
  // (lead_id, sequence_id).
  leadSequenceIdx: index("idx_enrollments_unique").on(t.leadId, t.sequenceId),
  // The uniqueness that DOES hold, and it is now the database's job rather than
  // only the service layer's.
  //
  // enrollLead() was check-then-insert with no lock and no constraint, so two
  // concurrent enrols — a double-tapped button, an n8n retry, a bulk enroll
  // racing auto-enrolment — both read "not enrolled" and both inserted, giving
  // one lead two parallel message streams from the same sequence. That is the
  // shape of the incident where 142 leads received up to 4 messages each.
  //
  // PARTIAL, over exactly LIVE_ENROLLMENT_STATUSES (services/outreach.ts):
  // active, paused AND awaiting_action. awaiting_action must be in the set —
  // omitting it is what re-opened this hole once already, because a lead parked
  // on a manual WhatsApp step then reads as "not enrolled".
  //
  // Migration 0017 is AUTHORITATIVE — it also retires any pre-existing duplicate
  // live rows, which a bare `db:push` would not, and drizzle-kit 0.20 is not
  // trusted to emit the WHERE clause. Without the predicate this index would be
  // a full unique constraint and would refuse to build over legitimate
  // historical re-enrollments.
  //
  // The literal status list is spelled out here because Drizzle needs a SQL
  // fragment, not a TypeScript array; that it still matches
  // LIVE_ENROLLMENT_STATUSES and the migration is asserted by a unit test in
  // outreach-enrollment.test.ts.
  liveUniqueIdx: uniqueIndex("idx_enrollments_live_unique")
    .on(t.leadId, t.sequenceId)
    .where(sql`${t.status} IN ('active', 'paused', 'awaiting_action')`),
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
  // "pending" is an INTENT row, written immediately before the message is handed
  // to SMTP and resolved to sent/failed once the outcome is known. It exists so a
  // crash, pool timeout or restart in that window is *detectable*: on the next
  // tick a leftover pending row for the same (enrollment, step) means the message
  // was probably already delivered, and re-sending it would be the duplicate this
  // system has a documented history of. See processSingleSend.
  //
  // No migration is needed to add it: this is a plain `text` column with no CHECK
  // constraint in Postgres — the enum is a TypeScript-level narrowing only.
  status:       text("status", { enum: ["sent", "failed", "pending"] }).notNull().default("sent"),
  messageId:    text("message_id"),
  error:        text("error"),
  // transient | permanent | spam_reject | infra | suppressed — lets the UI say
  // WHY a send failed rather than only that it did.
  failureKind:  text("failure_kind"),
}, (t) => ({
  enrollmentIdx: index("idx_sends_enrollment").on(t.enrollmentId, t.sentAt),
  failureKindIdx: index("idx_sends_failure_kind").on(t.failureKind),
}));

// ── Suppressions ──────────────────────────────────────────
// Addresses that must never be emailed again.
//
// Replaces the previous hard-bounce handling, which set leads.email = NULL and
// destroyed the address — so the lead could never be corrected, and nothing
// recorded why it had gone. This is permanent, non-destructive, and keyed by
// address rather than by lead so a shared inbox is suppressed once.
export const suppressions = pgTable("suppressions", {
  address:   text("address").primaryKey(),
  reason:    text("reason", {
    enum: ["hard_bounce", "spam_reject", "complaint", "unsubscribe", "manual"],
  }).notNull(),
  source:    text("source"),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  reasonIdx: index("idx_suppressions_reason").on(t.reason, t.createdAt),
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

// ── Company Settings (single row) ─────────────────────────
// Branding + company details for client-facing documents. Lives in the DB, not
// in the PDF renderer, so the logo/colours/terms are editable from Settings
// without a deploy. `singleton` has a unique index, which is what makes
// "exactly one row" a database guarantee.
export const companySettings = pgTable("company_settings", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  singleton:           boolean("singleton").notNull().default(true),
  companyName:         text("company_name").notNull().default("Seekers AI Automation Solutions"),
  tagline:             text("tagline"),
  address:             text("address"),
  email:               text("email"),
  phone:               text("phone"),
  website:             text("website"),
  taxNumber:           text("tax_number"),
  registrationNumber:  text("registration_number"),
  // NULL = the white Seekers mark bundled with the API (services/brand-logo.ts).
  // Otherwise a data:image/png;base64,… URI uploaded from Settings.
  logo:                text("logo"),
  brandPrimary:        text("brand_primary").notNull().default("#7C3AED"),
  brandSecondary:      text("brand_secondary").notNull().default("#3730A3"),
  brandDark:           text("brand_dark").notNull().default("#1E1B4B"),
  defaultCurrency:     text("default_currency").notNull().default("EGP"),
  defaultPaymentTerms: text("default_payment_terms"),
  defaultTaxRate:      numeric("default_tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  quotationPrefix:     text("quotation_prefix").notNull().default("SQ"),
  invoicePrefix:       text("invoice_prefix").notNull().default("INV"),
  quotationFooter:     text("quotation_footer"),
  invoiceFooter:       text("invoice_footer"),
  bankDetails:         text("bank_details"),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Quotations ────────────────────────────────────────────
// clientId is nullable on purpose: a quotation routinely goes out before the
// prospect exists as a client row, so the recipient is also snapshotted as free
// text. Converting an accepted quotation is what creates/links the client.
export const quotations = pgTable("quotations", {
  id:              uuid("id").primaryKey().defaultRandom(),
  number:          text("number").notNull().unique(),          // SQ-2026-0001
  title:           text("title"),
  clientId:        uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  clientName:      text("client_name"),
  clientCompany:   text("client_company"),
  clientEmail:     text("client_email"),
  clientPhone:     text("client_phone"),
  clientAddress:   text("client_address"),
  status:          text("status", {
    enum: ["draft", "sent", "accepted", "rejected", "expired"],
  }).notNull().default("draft"),
  currency:        text("currency").notNull().default("EGP"),
  setupFee:        numeric("setup_fee",        { precision: 12, scale: 2 }).notNull().default("0"),
  monthlyRetainer: numeric("monthly_retainer", { precision: 12, scale: 2 }).notNull().default("0"),
  retainerMonths:  integer("retainer_months").notNull().default(0),
  // Explicit discriminator rather than two nullable columns — "10" can never be
  // ambiguous between 10% and EGP 10.
  discountType:    text("discount_type", { enum: ["none", "percent", "amount"] }).notNull().default("none"),
  discountValue:   numeric("discount_value", { precision: 12, scale: 2 }).notNull().default("0"),
  taxRate:         numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  notes:           text("notes"),
  terms:           text("terms"),
  validUntil:      date("valid_until"),
  // 43-char base64url of 32 random bytes. The share link is the only thing
  // authenticating a public reader, so it must be unguessable.
  shareToken:      text("share_token").notNull().unique(),
  sentAt:          timestamp("sent_at",    { withTimezone: true }),
  decidedAt:       timestamp("decided_at", { withTimezone: true }),
  createdBy:       uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index("idx_quotations_status").on(t.status, t.createdAt),
  clientIdx: index("idx_quotations_client").on(t.clientId),
}));

export const quotationItems = pgTable("quotation_items", {
  id:          uuid("id").primaryKey().defaultRandom(),
  quotationId: uuid("quotation_id").notNull().references(() => quotations.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity:    numeric("quantity",   { precision: 12, scale: 2 }).notNull().default("1"),
  unitPrice:   numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  // one_off bills once; recurring bills once per month of the retainer term.
  kind:        text("kind", { enum: ["one_off", "recurring"] }).notNull().default("one_off"),
  position:    integer("position").notNull().default(0),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  quotationIdx: index("idx_quotation_items_quotation").on(t.quotationId, t.position),
}));

// ── Invoices ──────────────────────────────────────────────
// Same money shape as a quotation, so one pure total engine serves both.
export const invoices = pgTable("invoices", {
  id:              uuid("id").primaryKey().defaultRandom(),
  number:          text("number").notNull().unique(),          // INV-2026-0001
  title:           text("title"),
  clientId:        uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  quotationId:     uuid("quotation_id").references(() => quotations.id, { onDelete: "set null" }),
  clientName:      text("client_name"),
  clientCompany:   text("client_company"),
  clientEmail:     text("client_email"),
  clientPhone:     text("client_phone"),
  clientAddress:   text("client_address"),
  status:          text("status", {
    enum: ["draft", "sent", "paid", "overdue", "void"],
  }).notNull().default("draft"),
  issueDate:       date("issue_date").notNull().default(sql`CURRENT_DATE`),
  dueDate:         date("due_date"),
  currency:        text("currency").notNull().default("EGP"),
  setupFee:        numeric("setup_fee",        { precision: 12, scale: 2 }).notNull().default("0"),
  monthlyRetainer: numeric("monthly_retainer", { precision: 12, scale: 2 }).notNull().default("0"),
  retainerMonths:  integer("retainer_months").notNull().default(0),
  discountType:    text("discount_type", { enum: ["none", "percent", "amount"] }).notNull().default("none"),
  discountValue:   numeric("discount_value", { precision: 12, scale: 2 }).notNull().default("0"),
  taxRate:         numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  notes:           text("notes"),
  terms:           text("terms"),
  paidAt:          timestamp("paid_at", { withTimezone: true }),
  // ── Recurrence ──
  // A retainer produces a ROLLING series: the next invoice is spawned from this
  // one on demand, rather than pre-creating N drafts that go stale if the
  // client churns or the price changes.
  recurring:        boolean("recurring").notNull().default(false),
  recurrenceMonths: integer("recurrence_months").notNull().default(1),
  recurrenceIndex:  integer("recurrence_index").notNull().default(1),
  recurrenceTotal:  integer("recurrence_total"),
  nextInvoiceDate:  date("next_invoice_date"),
  parentInvoiceId:  uuid("parent_invoice_id"),
  // ── Finance tie-in ──
  // The income row written into the P&L when this invoice was FIRST marked
  // paid. Its presence is the idempotency marker: mark-paid refuses to write a
  // second transaction while it is populated, so marking paid twice cannot
  // double-count revenue.
  transactionId:   uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
  shareToken:      text("share_token").notNull().unique(),
  createdBy:       uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx:    index("idx_invoices_status").on(t.status, t.issueDate),
  clientIdx:    index("idx_invoices_client").on(t.clientId),
  quotationIdx: index("idx_invoices_quotation").on(t.quotationId),
  parentIdx:    index("idx_invoices_parent").on(t.parentInvoiceId),
}));

export const invoiceItems = pgTable("invoice_items", {
  id:          uuid("id").primaryKey().defaultRandom(),
  invoiceId:   uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity:    numeric("quantity",   { precision: 12, scale: 2 }).notNull().default("1"),
  unitPrice:   numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  kind:        text("kind", { enum: ["one_off", "recurring"] }).notNull().default("one_off"),
  position:    integer("position").notNull().default(0),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  invoiceIdx: index("idx_invoice_items_invoice").on(t.invoiceId, t.position),
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
