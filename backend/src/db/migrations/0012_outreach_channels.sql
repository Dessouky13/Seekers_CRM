-- Outreach channels: phone routing, suppression list, failure classification.
--
-- All additive and idempotent. No column is dropped and no data is destroyed —
-- notably this REPLACES the previous hard-bounce behaviour, which nulled
-- leads.email and threw the address away permanently.

-- ── Phone routing ─────────────────────────────────────────
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "phone_e164"      text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "phone_type"      text;
-- unknown | yes | no. Learned from what happens when a human tries the number:
-- there is no compliant free way to check WhatsApp presence up front.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "whatsapp_status" text NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS "idx_leads_phone_type"      ON "leads" ("phone_type");
CREATE INDEX IF NOT EXISTS "idx_leads_whatsapp_status" ON "leads" ("whatsapp_status");

-- ── Suppression list ──────────────────────────────────────
-- Permanent, non-destructive record of addresses that must never be emailed.
CREATE TABLE IF NOT EXISTS "suppressions" (
  "address"    text PRIMARY KEY,
  -- hard_bounce | spam_reject | complaint | unsubscribe | manual
  "reason"     text NOT NULL,
  -- inbox_poller | scheduler | ui
  "source"     text,
  "notes"      text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_suppressions_reason" ON "suppressions" ("reason", "created_at");

-- ── Failure classification ────────────────────────────────
-- transient | permanent | spam_reject | infra | suppressed
ALTER TABLE "outreach_sends" ADD COLUMN IF NOT EXISTS "failure_kind" text;
CREATE INDEX IF NOT EXISTS "idx_sends_failure_kind" ON "outreach_sends" ("failure_kind");

-- Backfill the suppression list from the damage already done. The OLD
-- hard-bounce path (backend/src/services/inbox.ts) never wrote a
-- leads.email_status of 'bounced' — that value is never written anywhere in
-- this codebase. What it actually did was set leads.email = NULL and stash the
-- original address in leads.signals->>'bounced_email' so it wasn't lost. That
-- JSON key is therefore the only surviving record of a bounced address, and is
-- the correct (and only) source to backfill from.
INSERT INTO "suppressions" ("address", "reason", "source", "notes")
SELECT DISTINCT lower(trim(signals->>'bounced_email')), 'hard_bounce', 'migration',
       'backfilled from leads.signals bounced_email key'
  FROM "leads"
 WHERE signals->>'bounced_email' IS NOT NULL
   AND length(trim(signals->>'bounced_email')) > 0
ON CONFLICT ("address") DO NOTHING;

-- ── Manual channels ───────────────────────────────────────
-- status and channel are text columns with Drizzle-side enums, so widening the
-- allowed values needs no DDL. Recorded here so the intent is not invisible:
--   outreach_steps.channel        += whatsapp | call
--   outreach_enrollments.status   += awaiting_action
--
-- awaiting_action is deliberately distinct from paused: a sequence waiting on a
-- human is not a sequence that has failed, and conflating them made a stalled
-- enrollment look like a broken one.
CREATE INDEX IF NOT EXISTS "idx_enrollments_awaiting"
  ON "outreach_enrollments" ("status", "next_send_at")
  WHERE "status" = 'awaiting_action';
