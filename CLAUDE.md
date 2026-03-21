# CLAUDE.md — AI Agency OS Backend Build Guide
## Project: Seekers AI Internal Operations Platform
## Version: 2.1 — Self-Hosted Stack (VPS + Vercel, Zero External Paid Services)

---

### BUILD STATUS (Last updated: 2026-03-21)

All 6 sprints are **complete**. The full-stack app is wired — no mock-data anywhere.

#### ✅ Completed
- **Sprint 1** — Backend foundation: Hono API, JWT auth, all middleware, `/health`, DB schema, Drizzle migrations, seed script
- **Sprint 2** — Tasks (Kanban + list), Projects, Clients (with detail sheet) — frontend wired to real API
- **Sprint 3** — Finance transactions CRUD + P&L summary charts; CRM leads Kanban + activity timeline — frontend wired
- **Sprint 4** — Dashboard KPI summary (parallel queries); Goals CRUD page — frontend wired
- **Sprint 5** — Knowledge Base: document upload, BullMQ embedding queue, RAG query (Agency Brain) — frontend wired
- **Sprint 6** — Notifications (bell in Topbar), Settings page (team management + user invite)

#### ⚠️ Windows Dev Environment Notes
- **PostgreSQL 18** (service `postgresql-x64-18`, port 5432, password `seekers2026`)
- **pgvector not available on Windows PG18** → `embedding` column in `kb_chunks` is `text` locally (stores JSON-stringified arrays). **On VPS deployment: restore to `vector("embedding", { dimensions: 1536 })` and run `db:push`**
- **BullMQ connection**: Uses plain `{ host, port }` options (not IORedis instance) to avoid version conflict
- **drizzle-kit 0.20 commands**: `generate:pg`, `push:pg`, `migrate:pg` (not `generate`/`push`)
- **Redis**: Required for Sprint 5 (Knowledge Base embedding queue). Install locally with WSL or skip — the upload endpoint will fail if Redis is not running but other endpoints still work

#### Known SQL Fix Applied
- `finance.ts` and `dashboard.ts` had `::text` cast on date arithmetic causing `operator does not exist: date >= text` on PG18. Fixed to use `sql\`${transactions.date} >= (CURRENT_DATE - INTERVAL '5 months')\``

#### Frontend Structure
```
Frontend/src/
├── hooks/
│   ├── useAuth.ts         — login, logout, current user
│   ├── useClients.ts      — clients CRUD + detail
│   ├── useTasks.ts        — tasks, projects, users (for assignee dropdown)
│   ├── useFinance.ts      — transactions CRUD + summary + categories
│   ├── useCRM.ts          — leads CRUD + activities (optimistic stage moves)
│   ├── useDashboard.ts    — dashboard summary (all KPIs)
│   ├── useGoals.ts        — goals CRUD
│   └── useNotifications.ts — notifications (bell, mark read, delete)
├── lib/
│   ├── api.ts             — apiFetch with Bearer token injection + 401 redirect guard
│   ├── auth.ts            — localStorage helpers (seekers_token, seekers_user)
│   └── types.ts           — all API response interfaces
└── pages/
    ├── Login.tsx, Dashboard.tsx, Finance.tsx, Tasks.tsx
    ├── Clients.tsx, CRM.tsx, Goals.tsx
    ├── Knowledge.tsx      — document upload + RAG query UI
    └── Settings.tsx       — team management + invite
```

#### Environment: VPS Deployment Checklist (additions)
- Restore `embedding` column in `schema.ts` from `text` to `vector("embedding", { dimensions: 1536 })`
- Set `OPENAI_API_KEY` in `backend/.env` before Knowledge Base works
- Set Brevo SMTP credentials before invite emails work
- Redis must be running (`systemctl status redis-server`) for embedding queue

---

---

### 0. Golden Rules for Claude Code

- **Never use Supabase, PlanetScale, Neon, or any DBaaS.** Database runs locally on the VPS.
- **Never use Redis cloud services.** Use BullMQ with a local Redis instance if queues are needed.
- **Never suggest paid third-party services** unless explicitly listed in this document.
- **Always generate TypeScript** — no plain JS files in `src/`.
- **Zod validates every request body** — never trust raw `req.body`.
- **Every route must be tested** via the Postman collection order in Section 11.
- **Build in sprint order** (Section 9) — do not skip ahead.
- **File uploads stay on VPS disk** (`/var/www/seekersai/uploads/`) — no cloud storage.
- **Environment variables** are never hardcoded — always read from `process.env`.
- When in doubt, ask. Do not invent database columns or API fields not listed here.

---

### 1. Project Context

**AI Agency OS** is the internal operations platform for **Seekers AI Automation Solutions** (Cairo-based AI automation agency). It is a single-tenant, team-based dashboard used by the Seekers AI team (4–20 seats, admin + member roles).

**Modules:**
- **Dashboard** — aggregated KPIs: revenue, profit, active leads, task completion, overdue tasks, goals progress
- **Finance** — income/expense transaction ledger with categories, clients, status, and P&L charts
- **Tasks** — Kanban + list view with projects, subtasks, priority, assignees, due dates, client linking
- **Clients** — client directory with revenue, linked projects, linked tasks, status (active/prospect/inactive)
- **CRM** — lead pipeline (Kanban, 7 stages), activity timeline per lead, deal values
- **Goals** — OKR-style progress tracking
- **Knowledge Base / Agency Brain** — RAG-powered document store for AI-assisted query
- **Settings** — team management, user roles, preferences

**Frontend:** React 18 + TypeScript + Vite + Tailwind + shadcn/ui — located at `./Frontend/`

---

### 2. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Node.js 20 LTS + TypeScript | Stability, ecosystem |
| Framework | **Hono** (edge-compatible) | Lightweight, typed routing, Vercel serverless compatible |
| Database | **PostgreSQL 16** (self-hosted on VPS) | Free, full control, pgvector support |
| ORM | **Drizzle ORM** | Type-safe, migrations, works with raw pg driver |
| Auth | **Custom JWT** (jose library) | No third-party dependency, full control |
| File Storage | **Local disk on VPS** (`/var/www/seekersai/uploads/`) | Free, direct control |
| AI (chat) | **OpenAI GPT-4o** | Best reasoning for agency tasks |
| AI (embeddings) | **OpenAI text-embedding-3-small** | Cost-effective for RAG |
| Background Jobs | **BullMQ + local Redis** | Async embedding jobs, email queue |
| Email | **Brevo SMTP** (formerly Sendinblue) | Free tier covers agency volume |
| Deployment (API) | **VPS** (PM2 process manager) | Direct control, no cold starts |
| Deployment (Frontend) | **Vercel** | Free tier, instant deploys |
| Reverse Proxy | **Nginx** on VPS | SSL termination, static serving |
| SSL | **Let's Encrypt / Certbot** | Free HTTPS |

**VPS minimum spec:** 2 vCPU, 4 GB RAM, 50 GB SSD (Ubuntu 22.04 LTS)

---

### 3. Repository Structure

```
seekers-ai-os/
├── backend/                  # Node.js + Hono API (runs on VPS via PM2)
│   ├── src/
│   │   ├── index.ts
│   │   ├── db/
│   │   │   ├── client.ts         # Drizzle + pg pool
│   │   │   ├── schema.ts         # All table definitions
│   │   │   └── migrations/       # Drizzle migration files
│   │   ├── middleware/
│   │   │   ├── auth.ts           # JWT verification + user injection
│   │   │   ├── cors.ts
│   │   │   └── error-handler.ts
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── users.ts
│   │   │   ├── finance.ts
│   │   │   ├── tasks.ts
│   │   │   ├── clients.ts
│   │   │   ├── crm.ts
│   │   │   ├── goals.ts
│   │   │   ├── knowledge.ts
│   │   │   ├── dashboard.ts
│   │   │   └── notifications.ts
│   │   ├── services/
│   │   │   ├── db.ts             # Drizzle query helpers
│   │   │   ├── auth.ts           # JWT sign/verify, bcrypt
│   │   │   ├── openai.ts         # OpenAI client + embedding helper
│   │   │   ├── email.ts          # Brevo SMTP via nodemailer
│   │   │   ├── rag.ts            # Chunking + embedding + query
│   │   │   ├── storage.ts        # Local file storage helpers
│   │   │   └── queue.ts          # BullMQ setup + workers
│   │   ├── types/
│   │   │   └── index.ts
│   │   └── utils/
│   │       ├── validators.ts     # Zod schemas
│   │       └── pagination.ts
│   ├── uploads/                  # Local file uploads (gitignored)
│   ├── .env
│   ├── .env.example
│   ├── drizzle.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── ecosystem.config.js       # PM2 config
├── Frontend/                 # React + Vite (deploys to Vercel)
│   └── ...
├── nginx/
│   └── seekersai.conf            # Nginx reverse proxy config
└── scripts/
    ├── setup-vps.sh              # One-time VPS bootstrap
    ├── deploy.sh                 # Pull + restart PM2
    └── seed.ts                   # Dev seed data from mock-data.ts
```

---

### 4. Environment Variables

**`backend/.env`** (never commit this file)

```env
# ── Database ──────────────────────────────────────────────
DATABASE_URL=postgresql://seekers:YOUR_DB_PASSWORD@localhost:5432/seekersai

# ── Auth ──────────────────────────────────────────────────
JWT_SECRET=your-256-bit-random-secret-here
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_EXPIRES_IN=30d

# ── OpenAI ────────────────────────────────────────────────
OPENAI_API_KEY=sk-...

# ── Brevo SMTP ────────────────────────────────────────────
BREVO_SMTP_HOST=smtp-relay.brevo.com
BREVO_SMTP_PORT=587
BREVO_SMTP_USER=your-brevo-login@example.com
BREVO_SMTP_PASS=your-brevo-smtp-key
EMAIL_FROM=Team@seekersai.org
EMAIL_FROM_NAME=Seekers AI

# ── Server ────────────────────────────────────────────────
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://app.seekersai.org

# ── File Storage ──────────────────────────────────────────
UPLOAD_DIR=/var/www/seekersai/uploads
MAX_FILE_SIZE_MB=50

# ── Redis (local) ─────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── App URL (for file serving) ────────────────────────────
API_BASE_URL=https://api.seekersai.org
```

**`Frontend/.env.local`**
```env
VITE_API_URL=http://localhost:3000/api/v1
```

**`Frontend/.env.production`**
```env
VITE_API_URL=https://api.seekersai.org/api/v1
```

---

### 5. Database Setup

#### 5.1 VPS PostgreSQL Setup

```bash
# Install PostgreSQL 16 on Ubuntu 22.04
sudo apt update && sudo apt install -y postgresql-16 postgresql-contrib-16

# Install pgvector
sudo apt install -y postgresql-16-pgvector

# Create DB and user
sudo -u postgres psql <<EOF
CREATE USER seekers WITH PASSWORD 'YOUR_DB_PASSWORD';
CREATE DATABASE seekersai OWNER seekers;
GRANT ALL PRIVILEGES ON DATABASE seekersai TO seekers;
\c seekersai
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EOF
```

#### 5.2 Drizzle Schema (`src/db/schema.ts`)

Define all tables using Drizzle ORM's schema builder. Do **not** write raw SQL migrations by hand — use `drizzle-kit generate` after editing schema.ts.

```typescript
import {
  pgTable, uuid, text, numeric, boolean,
  timestamp, date, integer, index, vector
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Profiles ──────────────────────────────────────────────
export const profiles = pgTable("profiles", {
  id:         uuid("id").primaryKey().defaultRandom(),
  name:       text("name").notNull(),
  email:      text("email").notNull().unique(),
  password:   text("password").notNull(),             // bcrypt hash
  avatar:     text("avatar"),
  role:       text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Refresh Tokens ────────────────────────────────────────
export const refreshTokens = pgTable("refresh_tokens", {
  id:         uuid("id").primaryKey().defaultRandom(),
  userId:     uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  token:      text("token").notNull().unique(),
  expiresAt:  timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Password Reset Tokens ─────────────────────────────────
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id:         uuid("id").primaryKey().defaultRandom(),
  userId:     uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  token:      text("token").notNull().unique(),
  expiresAt:  timestamp("expires_at", { withTimezone: true }).notNull(),
  used:       boolean("used").notNull().default(false),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Team Invites ──────────────────────────────────────────
export const teamInvites = pgTable("team_invites", {
  id:         uuid("id").primaryKey().defaultRandom(),
  email:      text("email").notNull(),
  role:       text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  token:      text("token").notNull().unique(),
  invitedBy:  uuid("invited_by").references(() => profiles.id, { onDelete: "set null" }),
  expiresAt:  timestamp("expires_at", { withTimezone: true }).notNull(),
  used:       boolean("used").notNull().default(false),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
}));

// ── Leads ─────────────────────────────────────────────────
export const leads = pgTable("leads", {
  id:           uuid("id").primaryKey().defaultRandom(),
  name:         text("name").notNull(),
  company:      text("company").notNull(),
  email:        text("email"),
  source:       text("source"),
  dealValue:    numeric("deal_value", { precision: 12, scale: 2 }).notNull().default("0"),
  stage:        text("stage", {
    enum: ["new_lead", "contacted", "call_scheduled", "proposal_sent", "negotiation", "closed_won", "closed_lost"]
  }).notNull().default("new_lead"),
  assigneeId:   uuid("assignee_id").references(() => profiles.id, { onDelete: "set null" }),
  lastActivity: date("last_activity"),
  notes:        text("notes"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  stageIdx: index("idx_leads_stage").on(t.stage),
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
  filePath:   text("file_path"),          // Absolute path on VPS disk
  fileUrl:    text("file_url"),           // Public serving URL
  fileType:   text("file_type"),
  fileSize:   integer("file_size"),
  uploadedBy: uuid("uploaded_by").references(() => profiles.id, { onDelete: "set null" }),
  status:     text("status", { enum: ["processing", "ready", "error"] }).notNull().default("processing"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── KB Chunks ─────────────────────────────────────────────
export const kbChunks = pgTable("kb_chunks", {
  id:         uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => kbDocuments.id, { onDelete: "cascade" }),
  content:    text("content").notNull(),
  embedding:  vector("embedding", { dimensions: 1536 }),
  chunkIndex: integer("chunk_index").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  documentIdx: index("idx_kb_chunks_document").on(t.documentId),
  // Embedding index created separately in migration SQL (ivfflat requires data first)
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
```

#### 5.3 Drizzle Config (`drizzle.config.ts`)

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out:    "./src/db/migrations",
  driver: "pg",
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
});
```

#### 5.4 Database Client (`src/db/client.ts`)

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
```

#### 5.5 Post-Migration: IVFFlat Embedding Index

After the first migration runs and data exists, execute manually:
```sql
CREATE INDEX CONCURRENTLY idx_kb_chunks_embedding
  ON kb_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

---

### 6. Auth Architecture (Custom JWT, No Third-Party Auth)

```
┌─────────────────┐   POST /auth/login    ┌──────────────────────┐
│  React Frontend │──────────────────────▶│   Hono Backend API   │
│                 │◀── access_token (JWT) ─│   bcrypt compare     │
│  Stores tokens  │◀── refresh_token ──────│   jose sign JWT      │
│  in localStorage│                       │   store refresh token│
└─────────────────┘                       └──────────────────────┘
         │
         │  Authorization: Bearer <access_token>
         ▼
┌──────────────────────┐
│  authMiddleware      │  jose.jwtVerify(token, JWT_SECRET)
│  injects user+role   │  queries profiles table
└──────────────────────┘
```

**Token strategy:**
- `access_token`: signed JWT, short-lived (7 days default, `JWT_EXPIRES_IN`)
- `refresh_token`: random UUID stored in `refresh_tokens` table, 30-day expiry
- Password hashing: `bcrypt` with 12 rounds
- Admin-only endpoints: check `c.get("user").role === "admin"` in route handler

**`src/middleware/auth.ts`**
```typescript
import { createMiddleware } from "hono/factory";
import { jwtVerify } from "jose";
import { db } from "../db/client";
import { profiles } from "../db/schema";
import { eq } from "drizzle-orm";

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

export const authMiddleware = createMiddleware(async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "");
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  try {
    const { payload } = await jwtVerify(token, secret);
    const userId = payload.sub as string;

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile) return c.json({ error: "Unauthorized" }, 401);

    c.set("user", profile);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});

export const adminOnly = createMiddleware(async (c, next) => {
  const user = c.get("user");
  if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  await next();
});
```

---

### 7. File Storage Architecture

All uploads stored on VPS at `UPLOAD_DIR` (env var). Served by Nginx as static files at `/uploads/*`.

**`src/services/storage.ts`**
```typescript
import { writeFile, mkdir, unlink } from "fs/promises";
import { join, extname } from "path";
import { randomUUID } from "crypto";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";
const API_BASE   = process.env.API_BASE_URL ?? "http://localhost:3000";

export async function saveFile(buffer: Buffer, originalName: string): Promise<{
  filePath: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
}> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const ext      = extname(originalName).toLowerCase();
  const fileName = `${randomUUID()}${ext}`;
  const filePath = join(UPLOAD_DIR, fileName);
  await writeFile(filePath, buffer);
  return {
    filePath,
    fileUrl:  `${API_BASE}/uploads/${fileName}`,
    fileType: ext.replace(".", ""),
    fileSize: buffer.byteLength,
  };
}

export async function deleteFile(filePath: string): Promise<void> {
  try { await unlink(filePath); } catch { /* already deleted */ }
}
```

**Nginx static serving** (in `nginx/seekersai.conf`):
```nginx
location /uploads/ {
  alias /var/www/seekersai/uploads/;
  expires 30d;
  add_header Cache-Control "public, immutable";
}
```

---

### 8. API Endpoints Specification

All routes are prefixed `/api/v1`. Auth via `Authorization: Bearer <access_token>`.

#### 8.1 Auth Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/login` | No | Email + password login |
| POST | `/auth/register` | No | First-time setup only (or via invite token) |
| POST | `/auth/logout` | Yes | Revoke refresh token |
| GET | `/auth/me` | Yes | Get current user profile |
| POST | `/auth/refresh` | No | Exchange refresh token for new access token |
| POST | `/auth/password-reset` | No | Send reset email |
| POST | `/auth/password-update` | No | Apply reset token + new password |
| POST | `/auth/accept-invite` | No | Register via team invite token |

**POST `/auth/login`**
```
Request:  { email: string, password: string }
Response: { access_token, refresh_token, user: Profile }
Logic:    bcrypt.compare → jose.SignJWT → insert refresh_tokens row
```

**POST `/auth/register`**
```
Request:  { name, email, password, role?: "admin"|"member" }
Response: { access_token, refresh_token, user: Profile }
Guards:   Only allowed if NO profiles exist yet (first admin), or via valid invite token
```

**POST `/auth/accept-invite`**
```
Request:  { invite_token: string, name: string, password: string }
Response: { access_token, refresh_token, user: Profile }
Logic:    Validate team_invites token → create profile → mark invite used
```

#### 8.2 Users / Team

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users` | Yes | List all team members |
| GET | `/users/:id` | Yes | Get user profile |
| PATCH | `/users/:id` | own\|admin | Update name, avatar |
| DELETE | `/users/:id` | admin | Remove team member |
| POST | `/users/invite` | admin | Send team invite email |

**POST `/users/invite`**
```
Request:  { email: string, role: "admin"|"member" }
Response: { message: "Invite sent" }
Logic:    Insert team_invites row → send invite email via Brevo with accept-invite link
```

#### 8.3 Finance

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/finance/transactions` | Yes | List (filterable, paginated) |
| POST | `/finance/transactions` | Yes | Create |
| GET | `/finance/transactions/:id` | Yes | Get one |
| PATCH | `/finance/transactions/:id` | Yes | Update |
| DELETE | `/finance/transactions/:id` | Yes | Delete |
| GET | `/finance/summary` | Yes | Aggregated P&L |
| GET | `/finance/categories` | Yes | Distinct categories used |

**GET `/finance/transactions`**
```
Query:    ?type=income|expense&category=X&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=50
Response: { data: [...], total, page, limit }
```

**GET `/finance/summary`**
```
Query:    ?from=YYYY-MM-DD&to=YYYY-MM-DD
Response: {
  total_income, total_expenses, net_profit, profit_margin,
  revenue_by_month: [{ month, revenue }],    // last 6 months
  expense_by_category: [{ name, value }]
}
Logic:    Single SQL query with conditional aggregation — no N+1 queries
```

#### 8.4 Tasks & Projects

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/tasks` | Yes | List (filterable) |
| POST | `/tasks` | Yes | Create |
| GET | `/tasks/:id` | Yes | Get + subtasks |
| PATCH | `/tasks/:id` | Yes | Update; set completed_at when status→done |
| DELETE | `/tasks/:id` | Yes | Delete |
| POST | `/tasks/:id/subtasks` | Yes | Add subtask |
| PATCH | `/tasks/:id/subtasks/:subId` | Yes | Toggle done |
| DELETE | `/tasks/:id/subtasks/:subId` | Yes | Delete subtask |
| GET | `/projects` | Yes | List projects |
| POST | `/projects` | Yes | Create project |

**GET `/tasks`**
```
Query:    ?project_id&status&assignee_id&client_id
Response: { data: [Task + assignee_name + project_name + client_name + subtasks[]] }
Logic:    Single JOIN query — do not make separate requests per task
```

#### 8.5 Clients

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/clients` | Yes | List (search + filter) |
| POST | `/clients` | Yes | Create |
| GET | `/clients/:id` | Yes | Get + projects + tasks + recent_transactions |
| PATCH | `/clients/:id` | Yes | Update |
| DELETE | `/clients/:id` | admin | Delete |
| GET | `/clients/:id/tasks` | Yes | Tasks for client |

#### 8.6 CRM Leads

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/crm/leads` | Yes | List (filter by stage, assignee) |
| POST | `/crm/leads` | Yes | Create |
| GET | `/crm/leads/:id` | Yes | Get + activities |
| PATCH | `/crm/leads/:id` | Yes | Update; auto-create activity on stage change |
| DELETE | `/crm/leads/:id` | admin | Delete |
| POST | `/crm/leads/:id/activities` | Yes | Add activity |
| GET | `/crm/pipeline-summary` | Yes | Stats per stage |

**PATCH `/crm/leads/:id` — Stage Change Logic:**
```
When stage changes:
  1. Insert lead_activity: { type: "note", description: "Stage moved to [new_stage]" }
  2. Update leads.last_activity = CURRENT_DATE
  3. If stage = "closed_won": optionally auto-create client record
```

#### 8.7 Goals

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/goals` | Yes | List with progress_pct |
| POST | `/goals` | Yes | Create |
| PATCH | `/goals/:id` | Yes | Update |
| DELETE | `/goals/:id` | admin | Delete |

**progress_pct calculation:**
```typescript
const progress = Math.min(Math.round((current / target) * 100), 100);
```

#### 8.8 Knowledge Base / Agency Brain

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/knowledge/documents` | Yes | List documents |
| POST | `/knowledge/documents` | Yes | Upload (multipart) → async embedding |
| GET | `/knowledge/documents/:id` | Yes | Get metadata |
| DELETE | `/knowledge/documents/:id` | admin | Delete doc + chunks + file |
| POST | `/knowledge/query` | Yes | RAG query |

**POST `/knowledge/documents`** (multipart/form-data)
```
Request:  { file: File, title?: string }
Response: { id, title, file_path, file_type, file_size, status: "processing" }
Logic:
  1. Save file to disk via storage.ts
  2. Insert kb_documents row (status: "processing")
  3. Enqueue BullMQ job: { documentId, filePath, fileType }
  4. Return immediately — embedding happens async
  Worker:
    a. Extract text (pdf-parse for PDF, fs.readFile for .md/.txt)
    b. Chunk text (~500 tokens, 50-token overlap, paragraph-aware)
    c. Embed each chunk: OpenAI text-embedding-3-small
    d. Batch-insert kb_chunks rows
    e. Update kb_documents.status = "ready"
```

**POST `/knowledge/query`**
```
Request:  { query: string, top_k?: number }   // default top_k = 5
Response: {
  answer: string,
  sources: [{ document_id, document_title, chunk_content, similarity_score }]
}
Logic:
  1. Embed query: text-embedding-3-small
  2. pgvector cosine similarity search:
     SELECT c.*, d.title, 1-(c.embedding <=> $1) AS sim
     FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
     WHERE 1-(c.embedding <=> $1::vector) > 0.7
     ORDER BY c.embedding <=> $1::vector LIMIT $2
  3. Build context string from top_k chunks
  4. Call GPT-4o with Agency Brain system prompt
  5. Return answer + sources
```

**Agency Brain system prompt:**
```
You are Agency Brain, the internal AI assistant for Seekers AI Automation Solutions.
Answer questions ONLY based on the context provided below.
If the answer is not in the context, say: "I don't have that information in the knowledge base."
Always cite your sources by document title.

Context:
---
{chunks}
---
```

#### 8.9 Dashboard

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/dashboard/summary` | Yes | All KPIs in one request |

**GET `/dashboard/summary`**
```
Query:    ?period=YYYY-MM  (default: current month)
Response: {
  finance: { total_income, total_expenses, net_profit, profit_margin,
             revenue_by_month, expense_by_category },
  tasks:   { total, completed, overdue, completion_rate,
             overdue_items: [{ id, title, due_date, priority, assignee_name }] },
  leads:   { total, active, pipeline_value },
  goals:   [{ title, current, target, progress_pct }]
}
⚠️  Use parallel Promise.all() for 4 sub-queries — NOT sequential awaits
```

#### 8.10 Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/notifications` | Yes | User's notifications |
| PATCH | `/notifications/:id/read` | Yes | Mark read |
| PATCH | `/notifications/read-all` | Yes | Mark all read |
| DELETE | `/notifications/:id` | Yes | Delete |

---

### 9. RAG Service (`src/services/rag.ts`)

```typescript
// Text extraction
import pdfParse from "pdf-parse";
import { readFile } from "fs/promises";

export async function extractText(filePath: string, fileType: string): Promise<string> {
  if (fileType === "pdf") {
    const buffer = await readFile(filePath);
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }
  return readFile(filePath, "utf-8");
}

// Chunking (~500 tokens, 50-token overlap, split on \n\n)
export function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let current = "";
  
  for (const para of paragraphs) {
    const words = (current + " " + para).trim().split(/\s+/);
    if (words.length > chunkSize) {
      chunks.push(current.trim());
      // Include overlap from end of current chunk
      const overlapWords = current.trim().split(/\s+/).slice(-overlap);
      current = [...overlapWords, ...para.split(/\s+/)].join(" ");
    } else {
      current = words.join(" ");
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Embed via OpenAI
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const openai = getOpenAIClient(); // from services/openai.ts
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return response.data.map(d => d.embedding);
}
```

---

### 10. Email Service (`src/services/email.ts`)

```typescript
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host:   process.env.BREVO_SMTP_HOST,
  port:   Number(process.env.BREVO_SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_PASS,
  },
});

export async function sendInviteEmail(to: string, inviteUrl: string, role: string) {
  await transporter.sendMail({
    from:    `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
    to,
    subject: "You're invited to Seekers AI OS",
    html:    `<p>You've been invited as a <strong>${role}</strong>. 
               <a href="${inviteUrl}">Accept Invite</a> (expires in 48 hours)</p>`,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await transporter.sendMail({
    from:    `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
    to,
    subject: "Reset your Seekers AI OS password",
    html:    `<p>Click to reset your password: <a href="${resetUrl}">${resetUrl}</a> 
               (expires in 1 hour)</p>`,
  });
}
```

---

### 11. BullMQ Queue Setup (`src/services/queue.ts`)

```typescript
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { processDocumentEmbedding } from "./rag";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const embeddingQueue = new Queue("embedding", { connection });

// Worker runs in same process (for simplicity; can extract to separate file)
export const embeddingWorker = new Worker(
  "embedding",
  async (job) => {
    const { documentId, filePath, fileType } = job.data;
    await processDocumentEmbedding(documentId, filePath, fileType);
  },
  { connection, concurrency: 2 }
);
```

---

### 12. Build Order (Sprint Plan)

Build strictly in this order. Each sprint is deployable to VPS.

#### Sprint 1 — Foundation (Days 1–3)
1. Initialize repo: `npm init`, install deps, configure TypeScript + tsup
2. `src/db/schema.ts` — all table definitions
3. `drizzle-kit generate` → `drizzle-kit push` to local PostgreSQL
4. `src/db/client.ts` — Drizzle + pg pool
5. `src/index.ts` — Hono app, CORS, `GET /health`
6. `src/middleware/auth.ts` + `src/middleware/error-handler.ts`
7. `src/services/auth.ts` — bcrypt + jose JWT helpers
8. Auth routes: `/auth/login`, `/auth/register`, `/auth/me`, `/auth/logout`, `/auth/refresh`
9. PM2 `ecosystem.config.js`, deploy to VPS, verify `/health` from internet

#### Sprint 2 — Core Data (Days 4–7)
10. `/users` endpoints (U1–U5 minus email)
11. `/clients` (C1–C6)
12. `/projects` + `/tasks` (T1–T10) with subtask endpoints
13. Wire frontend: replace mock data in `Tasks.tsx` + `Clients.tsx` with API calls

#### Sprint 3 — Finance + CRM (Days 8–11)
14. `/finance/transactions` (CRUD) + `/finance/summary`
15. `/crm/leads` (CRUD) + `/crm/leads/:id/activities` + `/crm/pipeline-summary`
16. Wire frontend: `Finance.tsx`, `CRM.tsx`

#### Sprint 4 — Dashboard + Goals (Days 12–14)
17. `/dashboard/summary` — parallel aggregation query
18. `/goals` endpoints
19. Wire `Dashboard.tsx`, build out Goals page

#### Sprint 5 — Knowledge Base (Days 15–20)
20. Install Redis locally: `sudo apt install redis-server`
21. `src/services/storage.ts` + `src/services/queue.ts`
22. `src/services/rag.ts` — extract, chunk, embed
23. `/knowledge/documents` upload endpoint + BullMQ worker
24. `/knowledge/query` RAG endpoint
25. Build out Knowledge Base page

#### Sprint 6 — Notifications + Settings (Days 21–24)
26. `src/services/email.ts` — Brevo SMTP via nodemailer
27. `/notifications` endpoints
28. `/users/invite` + `/auth/accept-invite` with email
29. `/auth/password-reset` + `/auth/password-update`
30. Notification triggers: overdue tasks cron, lead stage change events

---

### 13. VPS Deployment

#### 13.1 VPS Setup Script (`scripts/setup-vps.sh`)

```bash
#!/bin/bash
set -e

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 16 + pgvector
sudo apt install -y postgresql-16 postgresql-16-pgvector

# Redis
sudo apt install -y redis-server
sudo systemctl enable redis-server

# PM2
sudo npm install -g pm2 tsx

# Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Create upload dir
sudo mkdir -p /var/www/seekersai/uploads
sudo chown -R $USER:$USER /var/www/seekersai
```

#### 13.2 PM2 Config (`ecosystem.config.js`)

```javascript
module.exports = {
  apps: [{
    name:         "seekersai-api",
    script:       "tsx",
    args:         "src/index.ts",
    cwd:          "/var/www/seekersai/backend",
    env_production: { NODE_ENV: "production", PORT: 3000 },
    instances:    1,
    autorestart:  true,
    watch:        false,
    max_memory_restart: "512M",
    error_file:   "/var/log/pm2/seekersai-error.log",
    out_file:     "/var/log/pm2/seekersai-out.log",
  }],
};
```

For production builds, use `tsup` to compile first:
```bash
npx tsup src/index.ts --format cjs --dts
pm2 start dist/index.js --name seekersai-api
```

#### 13.3 Nginx Config (`nginx/seekersai.conf`)

```nginx
server {
    listen 80;
    server_name api.seekersai.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.seekersai.org;

    ssl_certificate     /etc/letsencrypt/live/api.seekersai.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.seekersai.org/privkey.pem;

    # Serve uploaded files directly (no Node.js overhead)
    location /uploads/ {
        alias /var/www/seekersai/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options nosniff;
    }

    # Proxy API
    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        client_max_body_size 51M;
    }
}
```

#### 13.4 Deploy Script (`scripts/deploy.sh`)

```bash
#!/bin/bash
set -e
cd /var/www/seekersai/backend
git pull origin main
npm install --production=false
npx tsup src/index.ts --format cjs
npx drizzle-kit migrate          # Apply any new migrations
pm2 restart seekersai-api
echo "✅ Deployed successfully"
```

---

### 14. Frontend → Vercel Deployment

1. Push `Frontend/` to GitHub
2. Create Vercel project, set root to `Frontend/`
3. Set `VITE_API_URL=https://api.seekersai.org/api/v1` in Vercel env vars
4. Vercel auto-deploys on every push to `main`
5. Custom domain: `app.seekersai.org` → Vercel nameservers

**`Frontend/vercel.json`:**
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

---

### 15. Package Dependencies

**`backend/package.json` key dependencies:**
```json
{
  "dependencies": {
    "hono":                "^4",
    "@hono/node-server":   "^1",
    "drizzle-orm":         "^0.30",
    "pg":                  "^8",
    "bcrypt":              "^5",
    "jose":                "^5",
    "openai":              "^4",
    "nodemailer":          "^6",
    "bullmq":              "^5",
    "ioredis":             "^5",
    "pdf-parse":           "^1",
    "zod":                 "^3",
    "multer":              "^1",
    "uuid":                "^9"
  },
  "devDependencies": {
    "typescript":          "^5",
    "tsx":                 "^4",
    "tsup":                "^8",
    "drizzle-kit":         "^0.20",
    "@types/node":         "^20",
    "@types/pg":           "^8",
    "@types/bcrypt":       "^5",
    "@types/nodemailer":   "^6",
    "@types/multer":       "^1",
    "@types/pdf-parse":    "^1"
  }
}
```

---

### 16. Testing Order (Postman Collection)

Test in this exact sequence after each sprint:

1. `POST /auth/login` → capture `access_token`
2. `GET /auth/me` → verify token
3. `GET /users` → list team
4. `POST /clients` → `GET /clients` → `PATCH /clients/:id` → `GET /clients/:id`
5. `POST /projects` → `POST /tasks` → `PATCH /tasks/:id` (status: "done") → `GET /tasks`
6. `POST /finance/transactions` (income) → (expense) → `GET /finance/summary`
7. `POST /crm/leads` → `PATCH /crm/leads/:id` (stage move) → `GET /crm/pipeline-summary`
8. `GET /dashboard/summary`
9. `POST /knowledge/documents` (upload PDF) → poll until status="ready" → `POST /knowledge/query`
10. `GET /notifications` → `PATCH /notifications/read-all`

---

### 17. Pre-Deploy Checklist

- [ ] PostgreSQL 16 + pgvector installed on VPS
- [ ] `seekersai` database + `seekers` user created
- [ ] `drizzle-kit push` run against production DB
- [ ] Redis running: `systemctl status redis-server`
- [ ] `/var/www/seekersai/uploads/` created with correct permissions
- [ ] `.env` populated with all required vars (see Section 4)
- [ ] `OPENAI_API_KEY` set and tested
- [ ] Brevo SMTP credentials tested with `sendInviteEmail()`
- [ ] First admin user seeded: `npx tsx scripts/seed.ts`
- [ ] Nginx config symlinked and tested: `nginx -t`
- [ ] SSL cert issued: `certbot --nginx -d api.seekersai.org`
- [ ] PM2 startup script: `pm2 startup` → follow instructions
- [ ] Frontend env var `VITE_API_URL` set in Vercel dashboard
- [ ] CORS origin in backend `.env` matches Vercel frontend URL
- [ ] `GET /health` returns `{ status: "ok" }` from internet

---

### 18. Seed Script (`scripts/seed.ts`)

```typescript
import { db } from "../src/db/client";
import { profiles, clients, projects, tasks } from "../src/db/schema";
import bcrypt from "bcrypt";

async function seed() {
  console.log("Seeding database...");

  const password = await bcrypt.hash("admin123!", 12);
  const [admin] = await db.insert(profiles).values({
    name:  "Dessouky",
    email: "dessouky@seekersai.org",
    password,
    role:  "admin",
  }).returning();

  console.log("✅ Admin user created:", admin.email);
  // Add clients, projects, tasks from Frontend/src/lib/mock-data.ts as needed
  process.exit(0);
}

seed().catch(console.error);
```

---

*Seekers AI Engineering · Build Guide v2.0 · 2026-03-21*
*Stack: Hono + Drizzle + PostgreSQL (local) + BullMQ + Vercel Frontend*