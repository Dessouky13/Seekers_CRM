-- Canonicalise mailboxes.address to lowercase, and make it impossible to store
-- anything else.
--
-- WHAT THIS FIXES
-- `mailboxes` has UNIQUE (address) on the raw text. The boot seed inserted
-- process.env.EMAIL_FROM verbatim — production is configured
-- `EMAIL_FROM=Team@seekersai.org` — while POST /mailboxes/health (called by
-- n8n on a schedule) inserts address.toLowerCase(). Those are two different
-- strings, so the unique index did not collide and the first health post
-- created a SECOND row for the same physical mailbox.
--
-- Both `daily_cap` reads then did `SELECT ... LIMIT 1` with no ORDER BY, so the
-- cap the scheduler ENFORCED and the cap the deliverability panel DISPLAYED
-- came from an arbitrary row, and the spam-reject safety downgrade could be
-- written to the row the scheduler was not reading — leaving sending at the
-- rate that had just drawn a provider rejection.
--
-- Idempotent and non-destructive by design: safe to re-run, and safe on a
-- database that never grew the duplicate.

-- ── 1. Merge any case-variant duplicates ──────────────────
-- Survivor per lower(address) group = the OLDEST row (created_at, id as a
-- stable tie-break), so the row every foreign reference and every operator
-- habit already points at is the one that lives.
--
-- The merge is deliberately CONSERVATIVE on the two fields that gate sending:
--   * warmup_stage — 'recovery' wins over 'warmup' wins over 'active'. If ANY
--     duplicate recorded a spam-reject downgrade, that downgrade must survive
--     the merge; silently promoting the mailbox back to `active` here would
--     re-create the exact failure this migration exists to close.
--   * daily_cap    — 0 ("unset", i.e. let the warmup policy decide) wins if ANY
--     duplicate is unset, otherwise the LOWEST override wins. Never the highest.
--     0 is the conservative answer, not a neutral one: paired with the merged
--     stage above it means recovery's 5/day, which is lower than any override
--     could produce once effectiveDailyCap clamps it to the ceiling of 40.
-- Health telemetry (placement, bounce rate, DNSBL, seed results, score) is
-- taken from the most recently checked duplicate, since that is the freshest
-- observation of the same mailbox.
WITH grouped AS (
  SELECT lower(address) AS key,
         (array_agg(id ORDER BY created_at, id))[1] AS survivor_id,
         min(created_at)                            AS oldest_created_at,
         min(CASE warmup_stage WHEN 'recovery' THEN 1 WHEN 'warmup' THEN 2
                               WHEN 'active'   THEN 3 ELSE 4 END) AS stage_rank,
         -- min() over the raw column, so an unset 0 wins outright.
         min(daily_cap)                             AS lowest_cap,
         max(last_checked_at)                       AS newest_check
    FROM mailboxes
   GROUP BY lower(address)
  HAVING count(*) > 1
),
freshest AS (
  SELECT g.key, m.inbox_placement_pct, m.bounce_rate, m.dnsbl_listings,
         m.seed_results, m.health_score
    FROM grouped g
    JOIN mailboxes m ON lower(m.address) = g.key
                    AND m.last_checked_at IS NOT DISTINCT FROM g.newest_check
)
--
-- NOTE the ordering: this step merges DATA only and deliberately leaves the
-- survivor's address alone. Canonicalising it here would collide with the very
-- duplicate we are about to delete — that duplicate is the row already holding
-- the lowercase form, and UNIQUE (address) rejects the update before the DELETE
-- below ever runs. Step 2 lowercases, after the losers are gone.
UPDATE mailboxes m
   SET created_at          = g.oldest_created_at,
       warmup_stage        = CASE g.stage_rank WHEN 1 THEN 'recovery'
                                              WHEN 2 THEN 'warmup'
                                              WHEN 3 THEN 'active'
                                              ELSE m.warmup_stage END,
       daily_cap           = COALESCE(g.lowest_cap, 0),
       last_checked_at     = COALESCE(g.newest_check, m.last_checked_at),
       inbox_placement_pct = COALESCE(f.inbox_placement_pct, m.inbox_placement_pct),
       bounce_rate         = COALESCE(f.bounce_rate,         m.bounce_rate),
       dnsbl_listings      = COALESCE(f.dnsbl_listings,      m.dnsbl_listings),
       seed_results        = COALESCE(f.seed_results,        m.seed_results),
       health_score        = COALESCE(f.health_score,        m.health_score),
       updated_at          = now()
  FROM grouped g
  LEFT JOIN freshest f ON f.key = g.key
 WHERE m.id = g.survivor_id;

-- Now drop the losers. Only rows whose lowercase form is already held by a
-- DIFFERENT row, so a single row is never deleted.
DELETE FROM mailboxes m
 WHERE EXISTS (
   SELECT 1 FROM mailboxes keep
    WHERE keep.id <> m.id
      AND lower(keep.address) = lower(m.address)
      AND (keep.created_at, keep.id) < (m.created_at, m.id));

-- ── 2. Canonicalise whatever is left ─────────────────────
UPDATE mailboxes SET address = lower(trim(address)), updated_at = now()
 WHERE address <> lower(trim(address));

-- ── 3. Make the invariant structural ─────────────────────
-- A CHECK rather than a UNIQUE (lower(address)) index, deliberately:
--   * it guarantees the STORED value is canonical, not merely that no two rows
--     differ by case — so every existing `ON CONFLICT (address)` upsert keeps
--     working and keeps meaning what it says;
--   * combined with the existing UNIQUE (address) it gives uniqueness on
--     lower(address) for free;
--   * a future write path that forgets to lowercase fails loudly at insert
--     instead of quietly forking the row that governs the daily cap.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mailboxes_address_lowercase'
  ) THEN
    ALTER TABLE mailboxes
      ADD CONSTRAINT mailboxes_address_lowercase
      CHECK (address = lower(address));
  END IF;
END $$;
