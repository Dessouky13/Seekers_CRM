-- Login telemetry for the Team page.
--
-- Before this, "last active" on the Team page was derived from the most recent
-- lead_activities row a person had authored, which is not the same thing as
-- using the app — someone reviewing dashboards all week looked inactive, and a
-- member who had never signed in at all was indistinguishable from one who had.
--
-- login_events records every attempt (including failures, for brute-force
-- visibility); profiles.last_seen_at is touched by the auth middleware so
-- "online now" reflects real requests rather than the last write.

CREATE TABLE IF NOT EXISTS "login_events" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"    uuid REFERENCES "profiles"("id") ON DELETE CASCADE,
  "email"      text NOT NULL,
  "success"    boolean NOT NULL,
  "ip"         text,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_login_events_user"  ON "login_events" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_login_events_email" ON "login_events" ("email", "created_at");

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;

-- Backfill so the page is not empty on day one: treat the newest thing each
-- person authored as a lower bound on when they were last active. Rows created
-- from here on are real.
UPDATE "profiles" p
   SET "last_seen_at" = seen.at
  FROM (
    SELECT created_by AS uid, MAX(created_at) AS at
      FROM "lead_activities" WHERE created_by IS NOT NULL GROUP BY created_by
  ) seen
 WHERE p."id" = seen.uid AND p."last_seen_at" IS NULL;
