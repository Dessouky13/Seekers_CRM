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

-- Backfill the suppression list from the damage already done: any lead whose
-- email was nulled by the old hard-bounce path is unrecoverable, but any lead
-- already marked bounced still has its address and should be suppressed rather
-- than silently retried.
INSERT INTO "suppressions" ("address", "reason", "source", "notes")
SELECT DISTINCT lower(trim(email)), 'hard_bounce', 'migration',
       'backfilled from leads.email_status'
  FROM "leads"
 WHERE email IS NOT NULL AND email_status = 'bounced'
ON CONFLICT ("address") DO NOTHING;
