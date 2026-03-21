# AI Agency OS — Seekers AI

Internal operations platform for **Seekers AI Automation Solutions** — a Cairo-based AI automation company.

## What it is

A full-stack internal dashboard covering:
- **Finance** — income/expense tracking, P&L summaries
- **Tasks** — Kanban + list view with subtasks and project filtering
- **Clients** — client management with linked tasks and revenue tracking
- **CRM** — lead pipeline (Kanban), activity timeline, deal values
- **Goals** — OKR-style progress tracking (coming soon)
- **Knowledge Base** — RAG-powered document search via Agency Brain (coming soon)
- **Settings** — team management and preferences (coming soon)

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend (target):** Node.js + Hono + Supabase (PostgreSQL + pgvector)
- **Auth:** Supabase Auth (JWT + Row Level Security)
- **AI:** OpenAI GPT-4o + text-embedding-3-small for RAG

## Getting Started

```bash
npm install
npm run dev
```

App runs on [http://localhost:8080](http://localhost:8080).

## Brand

- **Company:** Seekers AI Automation Solutions
- **Tagline:** Automate. Accelerate. Dominate.
- **Website:** www.seekersai.org
- **Email:** Team@seekersai.org
