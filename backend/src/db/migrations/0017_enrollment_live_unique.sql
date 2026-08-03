-- One live enrollment per (lead, sequence), enforced by the database.
--
-- enrollLead() SELECTs for a live enrollment and then INSERTs, with no lock and
-- no constraint between the two. Two concurrent enrols — a double-tapped button,
-- an n8n retry, a bulk enroll racing the auto-enroll on lead creation — both read
-- "not enrolled" and both insert. The lead then has two parallel message streams
-- from the same sequence, which is the exact shape of the incident where 142
-- leads received up to 4 messages each.
--
-- The service-layer check stays (it is what produces the friendly "already
-- enrolled" answer), but it is no longer the only thing standing between a race
-- and a double-send.
--
-- PARTIAL, not a plain unique index. Re-enrolling a lead whose previous run
-- finished is a legitimate action, so completed / failed / replied rows may
-- legitimately repeat (lead_id, sequence_id). Only the LIVE set is constrained,
-- and that set must match LIVE_ENROLLMENT_STATUSES in services/outreach.ts —
-- active, paused AND awaiting_action. Leaving awaiting_action out would be the
-- same omission that re-opened this hole once already: a lead parked on a manual
-- WhatsApp step would read as "not enrolled".
--
-- Idempotent, and applies cleanly to an empty table. Not CONCURRENTLY: the
-- deploy runner wraps each migration file in a transaction, and CREATE INDEX
-- CONCURRENTLY cannot run inside one.

-- ── 1. Retire any duplicate live enrollments that already exist ────────────
-- The index cannot be created while duplicates are present, and silently
-- failing the migration on production data is not an option. Keep ONE row per
-- (lead_id, sequence_id): preferring the one that has actually sent something,
-- then the earliest. The losers are closed rather than deleted — they are real
-- history, including any sends they made.
WITH ranked AS (
  SELECT
    e.id,
    ROW_NUMBER() OVER (
      PARTITION BY e.lead_id, e.sequence_id
      ORDER BY
        (SELECT COUNT(*) FROM outreach_sends s WHERE s.enrollment_id = e.id) DESC,
        e.enrolled_at ASC,
        e.id ASC
    ) AS rn
  FROM outreach_enrollments e
  WHERE e.status IN ('active', 'paused', 'awaiting_action')
)
UPDATE outreach_enrollments e
SET
  status        = 'completed',
  completed_at  = COALESCE(e.completed_at, NOW()),
  next_send_at  = NULL,
  paused_reason = COALESCE(
    e.paused_reason,
    'Closed by migration 0017: a duplicate live enrollment for the same lead and sequence.'
  )
FROM ranked r
WHERE e.id = r.id
  AND r.rn > 1;

-- ── 2. The constraint ──────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "idx_enrollments_live_unique"
  ON "outreach_enrollments" ("lead_id", "sequence_id")
  WHERE "status" IN ('active', 'paused', 'awaiting_action');
