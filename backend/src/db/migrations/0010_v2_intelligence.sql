-- v2 Outbound Machine — Lead Intelligence foundation.
-- Additive only: new columns on leads + three new tables. Safe to re-run.

-- ── Lead enrichment columns ───────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS domain           text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_status     text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS icp_score        integer;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS tech_fingerprint jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS review_stats     jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS complaint_tags   text[];
ALTER TABLE leads ADD COLUMN IF NOT EXISTS signals          jsonb;
CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads (domain);

-- ── events (append-only) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    uuid REFERENCES leads(id) ON DELETE SET NULL,
  type       text NOT NULL,
  payload    jsonb,
  source     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_lead ON events (lead_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (type, created_at);

-- ── mailboxes ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mailboxes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address             text NOT NULL UNIQUE,
  daily_cap           integer NOT NULL DEFAULT 0,
  sent_today          integer NOT NULL DEFAULT 0,
  health_score        integer,
  warmup_stage        text,
  inbox_placement_pct numeric(5,2),
  bounce_rate         numeric(5,2),
  dnsbl_listings      jsonb,
  seed_results        jsonb,
  last_checked_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ── audits ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    uuid REFERENCES leads(id) ON DELETE SET NULL,
  slug       text NOT NULL UNIQUE,
  score      integer,
  issues     jsonb,
  quick_wins jsonb,
  pdf_url    text,
  page_url   text,
  views      integer NOT NULL DEFAULT 0,
  hot_fired  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audits_slug ON audits (slug);
CREATE INDEX IF NOT EXISTS idx_audits_lead ON audits (lead_id);
