-- Follow-ups on leads, and templates for repeated task checklists.
--
-- Two additive features, no column dropped and no data touched. Both exist to
-- remove work the team is currently doing by hand.
--
-- ── Why follow-ups ────────────────────────────────────────
--
-- "I told them I'd call back Thursday" had nowhere to live. The team was
-- encoding it as a task — there is a real one in this database titled
-- "Follow up: FutureScale" — which means the commitment lands on the Tasks
-- board instead of next to the lead, carries none of the lead's context, and
-- has to be closed by hand afterwards.
--
-- It also gives Today the "not today" answer it was missing. Today's existing
-- "Skip for now" is React state: reload the page and the card is back. So the
-- only way to quieten a lead you had consciously decided to chase next week was
-- to look at it and skip it again, every single day. A follow-up date is that
-- decision, written down: it suppresses the lead's stale card until the date
-- arrives, then raises a `follow_up_due` card on the day.
--
-- ── Why task templates ────────────────────────────────────
--
-- Onboarding a client is the same eight tasks every time, typed in one at a
-- time. day_offset makes the checklist a schedule rather than a pile: applying
-- a template on a start date spreads the due dates the way the work actually
-- happens.

-- ── Follow-ups ────────────────────────────────────────────

-- A calendar day, not an instant: "Thursday" is Thursday in Cairo. Same
-- reading as every other date column in this schema (see utils/dates.ts).
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "follow_up_at"   date;
-- What you promised, in your own words. Rendered on the card so the person
-- picking it up on the day does not have to reconstruct the context.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "follow_up_note" text;

-- Partial: only rows with a follow-up are ever queried by this column, and
-- that is a small minority of leads. Ordered by the date because the worklist
-- query asks "due on or before today" and wants them oldest first.
CREATE INDEX IF NOT EXISTS "idx_leads_follow_up_at"
  ON "leads" ("follow_up_at")
  WHERE "follow_up_at" IS NOT NULL;

-- ── Task templates ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "task_templates" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"        text NOT NULL,
  "description" text,
  "created_by"  uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "task_template_items" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_id" uuid NOT NULL REFERENCES "task_templates"("id") ON DELETE CASCADE,
  "title"       text NOT NULL,
  -- Mirrors tasks.priority. Text with a Drizzle-side enum, same as the tasks
  -- table itself, so the two can never disagree about allowed values.
  "priority"    text NOT NULL DEFAULT 'medium',
  -- Days after the start date the applier is given. 0 = due on the start day.
  "day_offset"  integer NOT NULL DEFAULT 0,
  "position"    integer NOT NULL DEFAULT 0
);

-- Every read of items is "all items for this template, in order".
CREATE INDEX IF NOT EXISTS "idx_task_template_items_template"
  ON "task_template_items" ("template_id", "position");
