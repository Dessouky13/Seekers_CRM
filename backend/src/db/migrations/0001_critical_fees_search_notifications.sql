-- Critical production migration: fees/client consistency, lead search performance,
-- dynamic vault categories, and notification deduplication.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) Finance/client linkage query performance
CREATE INDEX IF NOT EXISTS idx_transactions_client ON transactions (client_id);

-- 2) Lead search performance for ILIKE '%term%'
CREATE INDEX IF NOT EXISTS idx_leads_name_trgm ON leads USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_company_trgm ON leads USING gin (company gin_trgm_ops);

-- 3) Dynamic vault categories table
CREATE TABLE IF NOT EXISTS vault_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vault_categories_active_sort
  ON vault_categories (is_active, sort_order);

INSERT INTO vault_categories (name, sort_order)
VALUES
  ('General', 10),
  ('Social Media', 20),
  ('Email', 30),
  ('Hosting', 40),
  ('Tools', 50),
  ('Clients', 60),
  ('Finance', 70),
  ('API', 80),
  ('Other', 90)
ON CONFLICT (name) DO NOTHING;

-- 4) Notification dedup/idempotency table
CREATE TABLE IF NOT EXISTS notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_events_user_event
  ON notification_events (user_id, event_key);

CREATE INDEX IF NOT EXISTS idx_notification_events_user_event
  ON notification_events (user_id, event_key);
