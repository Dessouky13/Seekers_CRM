-- Supporting indexes for the Economics report (/economics/summary).
--
-- The report reads every completed transaction once per request and resolves
-- income rows to clients by `client_id` OR by a normalised `client_name`. Two
-- of those access paths were unindexed:
--
--   1. The main fetch filters on status = 'completed' and orders by date. Both
--      the filter and the sort came off a Seq Scan + Sort over the whole table.
--   2. `client_name` is matched case- and whitespace-insensitively. An index on
--      the raw column cannot serve that, so this indexes the same normalised
--      expression the service uses (lower + trim), keeping the two definitions
--      in step. This one matters more than the row count suggests: 139,800 EGP
--      of client revenue on this database is reachable ONLY via that text name.
--
-- No new columns and no new data-entry burden — the report is built entirely
-- from what is already recorded. These only make reading it cheap.
--
-- Idempotent and safe on an empty database, so it applies cleanly from scratch.
-- Not CONCURRENTLY: the deploy runner wraps each migration file in a
-- transaction, and CREATE INDEX CONCURRENTLY cannot run inside one. At 164 rows
-- the exclusive lock is sub-millisecond.

CREATE INDEX IF NOT EXISTS "idx_transactions_status_date"
  ON "transactions" ("status", "date");

CREATE INDEX IF NOT EXISTS "idx_transactions_client_name_norm"
  ON "transactions" (lower(btrim("client_name")))
  WHERE "client_name" IS NOT NULL;

-- Per-tool spend groups by tool_id over expense rows only.
CREATE INDEX IF NOT EXISTS "idx_transactions_tool"
  ON "transactions" ("tool_id")
  WHERE "tool_id" IS NOT NULL;
