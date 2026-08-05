# Next session — start here

Rewritten 2026-08-05 after an unattended session. Everything below is verified,
not assumed.

## State

- Branch `main`. Vercel auto-deploys the frontend on push.
- **The backend is NOT deployed with this session's work.** No migration is
  needed (nothing here changes the schema), but `deploy.sh` must be run for any
  of the backend changes below to take effect. Frontend and backend changes in
  this session are independent — the frontend does not depend on the new
  endpoints except for the n8n workflow downloads, which will 404 until the
  backend ships. That is the one thing to deploy promptly.
- Backend 466 tests / 0 TS errors. Frontend 223 tests / 0 TS errors. Both build.

## Verification gotchas — read before claiming anything passes

- `npx tsc --noEmit` in `Frontend/` **checks nothing**. Root tsconfig is
  `"files": []` with project references. Use `npx tsc --noEmit -p tsconfig.app.json`.
- `npm test` does not exist in `backend/`. Use `npx vitest run`.
- Timezone is `Africa/Cairo`. `new Date().toISOString().slice(0,10)` returns
  YESTERDAY between midnight and ~02:00 local. Use `backend/src/utils/dates.ts`
  (`cairoToday()`) / `Frontend/src/lib/dates.ts`. This bug has been reintroduced
  repeatedly.
- Synthetic DOM events are not taps. Radix activates on `mousedown`; React
  `onClick` is often on a child node. This produced 4 false bug reports in one
  session — dispatch real events or drive the browser.
- Chrome MCP viewport emulation silently fails to apply sometimes. Always assert
  `window.innerWidth` in the same script that measures.
- Drizzle: calling `.where()` twice on a `$dynamic()` query silently overrides
  the first. Use `and(...conditions)`.
- Cache invalidation: use the shared `invalidateLeadQueries()` in
  `Frontend/src/hooks/useCRM.ts`.

## What this session changed

### 1. The 200-row lead cap is gone (was open item #2)
`crm.ts` GET /leads now accepts `offset` and clamps `limit` to 500;
`useLeads` pages until the server returns a short page, up to a 5,000 ceiling,
and the CRM page shows a banner if it ever hits that ceiling. `ORDER BY` gained
`id` as a tiebreaker — `updated_at DESC` alone is not a total order and bulk
imports write hundreds of rows sharing a timestamp, so paging without it would
duplicate and drop leads. 8 regression tests in
`Frontend/src/hooks/useLeads.paging.test.tsx`.

### 2. Bounce handling was broken at the detector (was open item #3)
Root cause found: `isBounce()` was a sender+subject phrase list holding
"undeliverable" and "returned mail". **Postfix writes "Undelivered Mail Returned
to Sender", which matches neither.** Those bounces fell through to
`handleReply()`, matched no lead (the From: is mailer-daemon), and were dropped
silently — no event, no suppression, no `email_status`. That explains bounces
being invisible; it is very likely a large share of the 107 unexplained inbound
messages.

- New `backend/src/services/inbox-classify.ts` (26 tests). Detects RFC 3464
  `multipart/report; report-type=delivery-status` **structurally** first, so it
  no longer depends on guessing every MTA's wording, and reads the DSN's own
  `Status:` field rather than scanning prose for digits.
- **`permanent` / `policy` / `transient` / `unknown`, not `hard`/`soft`.** 5.7.x
  is a rejection of US (reputation, SPF/DKIM/DMARC), not a dead address.
  Suppressing on it would delete the reachable half of the list at exactly the
  moment the domain was in trouble. Nothing suppresses on `policy`.
- Suppression **no longer requires a matching lead**. That was the write-back
  hole: a dead address whose lead row differed by whitespace or casing produced
  an event and nothing else, so the sequencer mailed it again. Lead lookup now
  uses `lower(trim(email))`, matching `suppressions.ts`.
- `GET /outreach/deliverability` gained a `bounces` block: 90-day counts by
  disposition, how many matched no lead, how many permanents were never
  suppressed (the leak indicator), and `leads_marked_bounced` for comparison.
  **This is where to look first next session.**
- `backend/scripts/backfill-bounces.ts` — dry-run by default, `--apply` to
  write. Retro-suppresses recorded bounces that never retired their address. It
  cannot recover bounces that were never recognised; only the mailbox still has
  those.

### 3. Bulk comment can record strikes (was open item #5a)
`POST /crm/leads/bulk-comment` takes `strike: boolean`. The dialog ticks it by
default for call/email/meeting and leaves it off for note/form, and respects the
user once they touch it. Batched into four statements regardless of selection
size. Reaching the third strike still closes the lead — and the toast says so
explicitly rather than closing leads quietly.

### 4. Manual emails advance the stage (was open item #5b)
The Sent-folder sweep now moves `new_lead → contacted` and writes its own
timeline note. **Only that one transition** — every later stage is a human
judgement a mail-folder sweep knows nothing about, and closed leads are never
reopened. `manualEmailStageAdvance()` in `sent-sync-plan.ts`, tested.

### 5. The n8n assets left `public/` (was open item #6)
`Frontend/public/n8n/` was served verbatim to the internet and had already
published a live `AUTOMATION_API_KEY`. Now:
- `SETUP.md` → `docs/n8n/SETUP.md`, in the repo, never served.
- The 9 workflow JSONs → `backend/src/assets/n8n/`, **imported** (so tsup inlines
  them and there is no filesystem dependency in production), served by
  `GET /outreach/n8n-workflows/:file` behind `authMiddleware`. The UI downloads
  via `apiFetch` and a Blob, because an `<a download>` cannot carry the token.
- Deleted: `Frontend/vercel.json.md`, `Frontend/public/LOGOS_TODO.md`,
  `docs/superpowers/`. (`.superpowers/` is gitignored — local only, nothing to do.)

### 6. `backend/scripts/lead-hygiene.ts` (was open item #7) — WRITTEN, NOT RUN
Dry-run by default. `--apply` nulls `@placeholder.local` emails, stashing the
original in `signals.placeholder_email` so it is reversible.
`--delete-uncontactable` additionally deletes no-email/no-phone leads — but it
**skips any lead with recorded history** and **refuses outright above
`--max-delete` (default 25)**. Deliberately fails closed: a previous session
destroyed 735 leads on this database.

## Open work, highest value first

1. **Deploy the backend** (`deploy.sh`). No migration needed. Until then the
   workflow-download cards on the Outreach page 404.
2. **Read `GET /outreach/deliverability` → `bounces`.** This is the payoff from
   the whole bounce investigation and it answers the 107-message question with
   data instead of a hypothesis. Then run
   `npx tsx scripts/backfill-bounces.ts` (dry run) and read the tally before
   deciding whether to `--apply`.
3. **Run `npx tsx scripts/lead-hygiene.ts`** (dry run) and check the report
   against the measured facts below before applying anything.
4. **UNANSWERED DECISION — stage model.** Untouched this session, deliberately.
   User proposed replacing the stages with: 1st email → 2nd email → 3rd email →
   Replied → Call scheduled → Proposal sent → Closed won → Closed lost. The
   counter-proposal was to keep sales stages, show touch count as the existing
   ○●● strike dots, add `Replied` (genuinely missing — 2 replies have nowhere to
   go) and drop `negotiation` (0 leads). Reason: 1st/2nd/3rd email is automation
   state the system already derives from `outreach_sends`; as columns they either
   auto-move (the board becomes a read-only progress bar) or go stale. It also
   loses `new_lead`, the most actionable column. **Do not migrate 619 live
   leads' stage enum without an explicit answer.**
5. **Reply rate.** 1,042 sends, 2 replies. Deliverability was tested and is fine,
   so this is copy and targeting. Once (2) is done and bounces are quantified,
   this is the real problem.

## Measured facts about production (measured 2026-08-05; re-verify before acting)

- 619 leads. 109 have no email — but **102 of those have a phone**. Only **7**
  have neither email nor phone.
- 8 leads have `@placeholder.local` emails. **All 8 have a phone.** Real Egyptian
  businesses (gyms, dental/medical clinics). Null the email, don't delete the
  lead — reachability then routes them to WhatsApp/call. `lead-hygiene.ts` does
  exactly this.
- 1,042 sends across 430 leads. **2 replies.** 109 inbound messages processed.
- **Deliverability is FINE.** Tested 2026-08-05 from `team@seekersai.org` to a
  Gmail address: arrived in inbox. An earlier hypothesis that Namecheap was
  silently dropping outbound was WRONG.
- 597+ leads still `new_lead`; all `deal_value` are 0.00.
- `clients.total_revenue` is stale and wrong (Backyard stores 10,000 vs 84,000
  actual). 60 transactions have a currency tag contradicting their magnitude.
  1 of 123 expenses is linked to a client — this is why per-client profitability
  cannot be built honestly.

## Security note

`Frontend/public/n8n/SETUP.md` published the real production `AUTOMATION_API_KEY`
at a publicly fetchable URL (verified 200 unauthenticated; key matched
production `.env` exactly). Redacted in `2b80558`; the whole directory has now
left `public/`. **The user explicitly chose NOT to rotate the key.** That is
their decision — do not re-litigate it, but be aware anyone who fetched that page
holds a working `X-API-Key` for the lead-ingest webhook.

## Never do

- Never `pm2 restart` or apply migrations without the user's explicit go-ahead.
- Never delete leads on a premise the data contradicts. A previous session
  destroyed 735 leads proving a bulk-delete exploit; the guard is now Zod
  `.min(1)` plus an explicit refusal when no WHERE condition resolves. Keep it.
- Never claim a browser verification you didn't run.
