-- Finance enhancement: multi-category, tools as first-class rows, cash positions.
-- Idempotent — safe to re-run.

-- ── 1. Tools table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tools (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  vendor         text,
  url            text,
  kind           text,
  monthly_budget numeric(12,2),
  active         boolean NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tools_name   ON tools (name);
CREATE INDEX IF NOT EXISTS idx_tools_active ON tools (active);

-- ── 2. Transaction columns ────────────────────────────────
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tool_id    uuid REFERENCES tools(id)    ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS held_by    uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS settled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_transactions_tool    ON transactions (tool_id);
CREATE INDEX IF NOT EXISTS idx_transactions_held_by ON transactions (held_by, settled_at);

-- ── 3. Backfill categories[] from the existing single category ──
UPDATE transactions
SET categories = ARRAY[category]
WHERE cardinality(categories) = 0 AND category IS NOT NULL;

-- ── 4. Seed tools from the names previously typed into notes ──
-- Normalises the variants seen in production:
--   "Claude" / "Claude.ai"            -> Claude
--   "Openai" / "Openai API" / "OpenAI API" -> OpenAI
--   "Convocore " (trailing space)     -> Convocore
INSERT INTO tools (name, vendor, kind) VALUES
  ('Claude',     'Anthropic',  'AI'),
  ('OpenAI',     'OpenAI',     'AI'),
  ('OpenRouter', 'OpenRouter', 'AI'),
  ('Voiceflow',  'Voiceflow',  'AI'),
  ('Convocore',  'Convocore',  'AI'),
  ('Base44',     'Base44',     'AI'),
  ('Make.com',   'Make',       'Automation'),
  ('Hetzner',    'Hetzner',    'Infra'),
  ('Railway',    'Railway',    'Infra'),
  ('Domain',      NULL,        'Infra')
ON CONFLICT (name) DO NOTHING;

-- ── 5. Link existing expense rows to those tools by matching notes ──
-- Only touches rows that don't already have a tool linked.
UPDATE transactions t
SET tool_id = tl.id
FROM tools tl
WHERE t.tool_id IS NULL
  AND t.type = 'expense'
  AND t.notes IS NOT NULL
  AND (
        -- exact-ish match on the normalised name
        lower(btrim(t.notes)) = lower(tl.name)
        -- common variants: "Claude.ai", "Openai API", "OpenAI API "
     OR lower(btrim(t.notes)) LIKE lower(tl.name) || '.%'
     OR lower(btrim(t.notes)) LIKE lower(tl.name) || ' %'
  );
