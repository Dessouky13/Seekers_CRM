-- Manual contact strikes: three attempts, then a decision.
--
-- The team already contacts leads by hand — a WhatsApp message, a call, a
-- follow-up email — and the only record of it was a free-text activity line.
-- Nothing counted the attempts, so "we've chased this one three times and heard
-- nothing" was a thing people remembered rather than a thing the CRM knew.
--
-- ── Why a table and not an integer column ─────────────────
--
-- An `int strike_count` would answer "how many" and nothing else. The
-- requirement is that each strike records WHEN it happened, WHO did it, and an
-- optional note — three facts per strike, which is a row, not a counter. The
-- count is therefore DERIVED (COUNT(*) per lead) and cannot drift out of step
-- with the history that justifies it. It also means a strike can be inspected
-- and audited months later, and that deleting a lead takes its strikes with it
-- via ON DELETE CASCADE rather than leaving an orphan tally behind.
--
-- ── Why `date` as well as `created_at` ───────────────────
--
-- Same split as `lead_activities`: `created_at` is the instant the row was
-- written, `date` is the Cairo calendar day the contact belongs to. A WhatsApp
-- sent at 23:30 belongs to that evening, and the UTC day at that moment is
-- already tomorrow. The application always supplies `date` explicitly from
-- utils/dates.ts:cairoToday(); the DEFAULT is only a floor for hand-written SQL.
--
-- ── Why `archived_at` on leads ───────────────────────────
--
-- The third strike triggers a configurable action (company_settings.
-- strike_limit_action). One of the two options is "archive", and archiving has
-- to mean something different from disqualifying or the setting is decoration.
-- `archived_at` is that difference: an archived lead is hidden from the leads
-- list, while the row, its activity timeline and its strike history all survive.
-- Nothing is deleted. Deliberately NOT a hard delete: an automatic irreversible
-- DELETE driven by a counter is precisely the shape of the incident that removed
-- 735 leads in one request.
--
-- Additive only — one new table, two new columns, three new indexes. No DROP, no
-- type change, no data rewritten. Every statement is IF NOT EXISTS so the deploy
-- runner (which applies each file once and records it in `_migrations`) is safe
-- to re-run, and the file applies cleanly to a database that has never seen it.

-- ── Strike history ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "lead_strikes" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "lead_id"    uuid NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  -- How the human made contact. Nullable because "I chased them" without a
  -- channel is still a strike, and refusing to record it would just push people
  -- back to typing a note nobody counts. Constrained by the Drizzle enum rather
  -- than a CHECK, matching lead_activities.type and outreach_steps.channel.
  "channel"    text,
  "note"       text,
  -- The Cairo calendar day this contact belongs to. See the header.
  "date"       date NOT NULL DEFAULT CURRENT_DATE,
  "created_by" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Every read is "the strikes for this lead, newest first" — the detail sheet
-- renders the history and the count comes off the same rows.
CREATE INDEX IF NOT EXISTS "idx_lead_strikes_lead"
  ON "lead_strikes" ("lead_id", "created_at" DESC);

-- ── The strike-3 action, and what "archive" means ─────────

-- 'close_lost' | 'archive'. Defaults to the SAFER of the two: it moves the lead
-- to the pipeline's existing terminal stage and changes nothing else, so the
-- lead stays visible, searchable and reportable. 'archive' additionally hides it
-- from the leads list, which is a bigger step and has to be chosen on purpose.
ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "strike_limit_action" text NOT NULL DEFAULT 'close_lost';

-- NULL = not archived, which is every existing row. A timestamp rather than a
-- boolean because "when was this shelved" is the question anyone reviewing an
-- archived lead actually asks.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;

-- Partial: the leads list filters on `archived_at IS NULL` for every request,
-- and archived leads are a small minority, so the index only needs to cover the
-- rows that ARE archived (for the "show archived" view). The common path is
-- served by the planner skipping this index entirely.
CREATE INDEX IF NOT EXISTS "idx_leads_archived_at"
  ON "leads" ("archived_at")
  WHERE "archived_at" IS NOT NULL;
