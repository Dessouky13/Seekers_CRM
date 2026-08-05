# Next session — start here

Written 2026-08-05 at the end of a context window. Everything below is verified,
not assumed. Tree was clean and pushed when this was written.

## State

- Branch `main`, HEAD `d058fa5`, pushed. Vercel auto-deploys the frontend.
- **Backend IS deployed** — the user ran `deploy.sh` themselves, so migrations
  0015/0017/0018/0019/0020 are applied to production.
- `N8N_LEADS_IMPORT_SECRET` is set in `/var/www/seekersai/backend/.env` (verified
  present once, file intact at 49 lines).
- Backend 432 tests / 0 TS errors. Frontend 213 tests / 0 TS errors. Build clean.

## Verification gotchas — read before claiming anything passes

- `npx tsc --noEmit` in `Frontend/` **checks nothing**. Root tsconfig is
  `"files": []` with project references. Use `npx tsc --noEmit -p tsconfig.app.json`.
- Timezone is `Africa/Cairo`. `new Date().toISOString().slice(0,10)` returns
  YESTERDAY between midnight and ~02:00 local. Use `backend/src/utils/dates.ts`
  (`cairoToday()`) / `Frontend/src/lib/dates.ts`. This bug has been reintroduced
  repeatedly.
- Synthetic DOM events are not taps. Radix activates on `mousedown`; React
  `onClick` is often on a child node. This produced 4 false bug reports in one
  session — dispatch real events or drive the browser.
- Chrome MCP viewport emulation silently fails to apply sometimes. Always assert
  `window.innerWidth` in the same script that measures, or you compare against a
  width that was never set (this produced a false "horizontal scroll" report).
- Drizzle: calling `.where()` twice on a `$dynamic()` query silently overrides
  the first. Use `and(...conditions)`.
- Cache invalidation: use the shared `invalidateLeadQueries()` in
  `Frontend/src/hooks/useCRM.ts`. Partial hand-rolled lists were a real bug.

## Measured facts about production (don't re-derive)

- 619 leads. 109 have no email — but **102 of those have a phone**. Only **7**
  have neither email nor phone.
- 8 leads have `@placeholder.local` emails. **All 8 have a phone.** They are real
  Egyptian businesses (gyms, dental/medical clinics). Null the email, don't
  delete the lead — then reachability routes them to WhatsApp/call.
- 1,042 sends across 430 leads. **2 replies.** 109 inbound messages processed.
- **Deliverability is FINE.** Tested 2026-08-05 from `team@seekersai.org` to a
  Gmail address: arrived in inbox. An earlier hypothesis that Namecheap was
  silently dropping outbound was WRONG. The ~0.5% reply rate is a copy and
  targeting problem, not infrastructure.
- 597+ leads still `new_lead`; all `deal_value` are 0.00.
- `clients.total_revenue` is stale and wrong (Backyard stores 10,000 vs 84,000
  actual). 60 transactions have a currency tag contradicting their magnitude.
  1 of 123 expenses is linked to a client — this is why per-client profitability
  cannot be built honestly.

## Open work, highest value first

1. **Verify `d058fa5` on live.** Kanban New Lead header should read ~612, and
   columns should sum to 619 — not 200. Previously each header counted the
   capped 200-row page.
2. **The 200-row cap itself.** Headers now tell the truth but you still cannot
   SEE 419 leads on the board. Raise the API cap or paginate per column.
   `crm.ts` GET /leads hard-caps at 200; `CRM.tsx` requests 200.
3. **The 107 non-reply inbound messages.** Likely bounces. ~10% bounce rate is
   the one thing here that can damage the sending domain. Note 0 leads carry
   `email_status='bounced'`, so bounces may be recorded as events without being
   written back — meaning dead addresses could be retried. Highest-value
   diagnostic remaining.
4. **UNANSWERED DECISION — stage model.** User proposed replacing stages with:
   1st email → 2nd email → 3rd email → Replied → Call scheduled → Proposal sent
   → Closed won → Closed lost. I recommended instead keeping sales stages and
   showing touch count as the existing ○●● strike dots, adding `Replied`
   (genuinely missing — 2 replies have nowhere to go) and dropping `negotiation`
   (0 leads). Reason: 1st/2nd/3rd email is automation state the system already
   knows from `outreach_sends`; as columns they either auto-move (board becomes a
   read-only progress bar) or go stale. Also loses `new_lead`, the most
   actionable column. **Do not migrate 619 live leads' stage enum without an
   explicit answer.**
5. **Two gaps the user asked about:**
   - Bulk-comment with type `email` does NOT increment strike dots. Strikes are
     per-lead only (`POST /crm/leads/:id/strikes`). User's mental model is "I
     contacted these 5" = a strike each.
   - The Sent-folder sweep records a timeline activity and bumps
     `last_activity` but does NOT change `stage`. User wants manual emails to
     update status. Suggested: auto-advance `new_lead` → `contacted` only.
6. **Cleanup, agreed but not executed:** delete `Frontend/vercel.json.md`,
   `Frontend/public/LOGOS_TODO.md`, `docs/superpowers/`, `.superpowers/`.
   Structural: move `public/n8n/` behind auth — `public/` is served verbatim and
   already leaked a credential once.
7. **7 uncontactable leads** (no email, no phone) safe to delete. **8
   placeholder emails** to null. Neither executed — awaiting go-ahead.

## Security note

`Frontend/public/n8n/SETUP.md` published the real production `AUTOMATION_API_KEY`
at a publicly fetchable URL (verified 200 unauthenticated; key matched
production `.env` exactly). Redacted in `2b80558`. **The user explicitly chose
NOT to rotate it.** That is their decision — do not re-litigate it, but be aware
anyone who fetched that page holds a working `X-API-Key` for the lead-ingest
webhook.

## Never do

- Never `pm2 restart` or apply migrations without the user's explicit go-ahead.
- Never delete leads on a premise the data contradicts. A previous session
  destroyed 735 leads proving a bulk-delete exploit; the guard is now Zod
  `.min(1)` plus an explicit refusal when no WHERE condition resolves. Keep it.
- Never claim a browser verification you didn't run.
