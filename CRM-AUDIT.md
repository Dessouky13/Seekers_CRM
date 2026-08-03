# Seekers CRM — Audit

**Date:** 2026-08-03 · **Branch:** `crm-enhance` · **Scope:** backend (17 routes, 29 services, 13 migrations, 4 scripts) + frontend (19 pages, ~100 components, 19 hooks)

Method: static sweep of both trees, `EXPLAIN` against a local copy of the schema, and hands-on testing in Chrome at a true 375×812 iPhone viewport with touch, Fast 4G and 4× CPU throttling. Production was inspected read-only.

---

## Executive summary

**Production data is real and clean.** 600 leads, 6 clients (Genesis, Rajac, Dr. Hussein Clinic, Backyard), 164 transactions, 3 users. No seed fixtures reached it.

**Two Criticals could have destroyed that data.** Both are fixed and proven closed in this phase.

**The mobile story is better than expected in one way and worse in another.** A bottom tab bar, a quick-add FAB, pull-to-refresh and an error boundary already exist, and lead capture is already a 3-tap flow. But **two of the five core flows are outright impossible on a phone**, because the Kanban board is HTML5 drag-and-drop only — and Kanban is the default view on both Leads and Tasks.

**RTL/Arabic is absent, not partial.** No i18n layer of any kind. Separately, three Arabic *data* bugs exist today and are worth fixing regardless of translation.

---

## CRITICAL — fixed in this phase

### C1 · Bulk lead delete could issue `DELETE` with no `WHERE`, wiping all 600 leads
`backend/src/routes/crm.ts:321` (guard), `:333` (where), `:366` (delete)

The guard was `if (!body.keep_sources && !body.delete_sources)`. **`![]` is `false` in JavaScript**, so `{"keep_sources": [], "confirm": "DELETE_LEADS"}` passed it. Both `if (…length > 0)` branches then skipped, `conditions` stayed empty, `conditions[0]` was `undefined`, and Drizzle omitted the clause entirely — `DELETE FROM leads`, cascading to `lead_activities`, `outreach_enrollments` and `outreach_sends`. No undo.

**I confirmed this was live and exploitable** by sending that payload to a running server: it deleted all 735 leads from my local database in one request. Production was never touched.

**Fixed** — Zod `.min(1)` on both arrays, plus a `conditions.length === 0` refusal immediately before the statement is built (defence in depth, matching what the sibling `/outreach/sends/purge` already did). Verified: empty array, empty string element, and `delete_sources: []` all now return 400, a legitimate dry-run still works, and the row count is unchanged.

### C2 · `seed-dev.ts` would have reset all three production passwords
`backend/scripts/seed-dev.ts:15-20` (guard), `:41-57` (upserts)

Its only guard was "host must be localhost" — **which is true on the production VPS**, whose `DATABASE_URL` is `postgresql://seekers:…@localhost:5432/seekersai`. Running it there would have passed its own check, then `ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password` on `dessouky@`, `mostafa@` **and `gomaa@`** — resetting all three real accounts to known dev passwords and forcing roles — before injecting 5 fake clients, 24 fake leads and 30 fake EGP transactions into live P&L reporting.

`scripts/seed.ts` had **no guard at all** and is exposed as `npm run seed`.

**Fixed** — one shared `scripts/lib/seed-guard.ts` used by both scripts. Three independent checks: loopback host, `NODE_ENV !== production`, and *the database must contain no business records* — the last is the one the hostname check cannot make, since a loopback host can hold a restored production dump. The guards were duplicated before, which is exactly how they drifted; now there is one implementation. Verified: both scripts refuse a populated database by name and count.

---

## HIGH — prioritised, not yet fixed

| # | Where | Issue |
|---|---|---|
| H1 | `components/modules/KanbanBoard.tsx:48-72` | **Kanban DnD is HTML5-only, so it is dead on touch** — and it is the default view on Leads (`CRM.tsx:50`) and Tasks (`Tasks.tsx:49`). No DnD library in `package.json`, zero pointer/touch handlers. Cards show `cursor-grab` with no alternative. Changing a lead stage or a task status is therefore impossible by drag on a phone; the fallback is a 6-7 tap edit form. **Both optimistic mutations already exist** (`useCRM.ts:70`, `useTasks.ts:58`) — only a tappable control is missing. |
| H2 | `pages/CRM.tsx:207` + `hooks/useCRM.ts:31` | **Typing in lead search unmounts the search box.** `search` is inside the query key with no `placeholderData`, so every debounced term flips `isLoading`, which `return`s the page skeleton — destroying the input and **dismissing the phone keyboard** mid-word. |
| H3 | `routes/webhooks.ts:14`, `:95` | **Any member can read every webhook `secret`** and every delivery payload. `/webhooks` is not in `ADMIN_ONLY_MODULES`, `GET /webhooks` returns whole rows including the shared `X-Webhook-Secret`, and `GET /webhooks/:id/deliveries` leaks other users' lead data and phone numbers. Every *mutating* sibling is correctly `adminOnly`. |
| H4 | `db/schema.ts:249` | **No index on `leads.assignee_id`** — the tenant-isolation key. `EXPLAIN` confirms `Seq Scan`. Every member request scans all leads; the worklist does it five times per load. |
| H5 | `services/notifications.ts:77-112` + `index.ts:129` | **Notification flood: 723 rows created in one day**, 725 of 726 unread. One transaction per stale lead (719 locally), sweep every 10 min ⇒ ~103k transactions/day, and a fresh notification per lead *per day* forever. The bell is unusable. |
| H6 | `services/outreach.ts:773-820` | **Send recorded after SMTP with no transaction.** A crash between delivery and the `outreach_sends` insert re-sends the identical email and under-counts the daily cap — the only thing enforcing volume. |
| H7 | `services/outreach.ts:166-200` | **`enrollLead` is check-then-insert with no lock or unique constraint.** `schema.ts:504` explicitly leaves uniqueness to the service layer. Two concurrent enrols (double-tap, n8n retry) create two live enrollments — the shape of the documented 142-lead double-send incident. |
| H8 | `components/modules/CommandPalette.tsx:52`, `:130` | **The only good search has no touch entry point and its results don't open records.** Cmd+K only — no button anywhere. And `onSelect` discards the id (`go("/crm")`), despite both targets already reading `?lead=`/`?task=`. |
| H9 | `pages/Tasks.tsx:147` | **No way to mark a task done** except drag (dead on touch) or a 6-tap edit form. No checkbox on the card; the detail dialog shows status read-only. |
| H10 | 13 of 14 pages | **`isError` unhandled** — a failed request renders as "No tasks found." / "No clients found." with no retry. Only `Today.tsx:277` has an error branch. Users conclude their data is gone. |
| H11 | `pages/Vault.tsx:293` | **Vault edit/delete are hover-only inside a `min-w-[640px]` table** with no mobile fallback. An admin cannot manage a credential from a phone at all. |
| H12 | `components/modules/crm/BulkActionBar.tsx:28` | **Bulk-action bar unreachable on mobile** — `bottom-6` sits under the 56px tab bar, ~420px of non-wrapping content in 375px, and it is `fixed` inside a `translateZ(0)` container so it isn't viewport-pinned. Mobile selection *is* offered, so users select and then cannot act. |
| H13 | `pages/Notes.tsx:44-60` | **Autosave race silently reverts typed characters.** `isDirty` is cleared in `onSuccess` while a refetch is in flight, so the effect overwrites newer local text with the older server copy. |
| H14 | `pages/Notes.tsx:62` | **Success toast fires before the request resolves** — a failed save shows "Note saved" *and* an error. |
| H15 | `components/MotivationalBanner.tsx:44` | **Undismissable banner covers the top nav every 30s.** `fixed top-4 right-4` spans the full 375px width over the Topbar; line 46 resets `dismissed` each cycle so the X never sticks. WCAG 2.2.2. |
| H16 | `ui/tabs.tsx:15` | **Tab strips overflow 375px with no scroll** — Finance's 5 tabs ≈500px. "Client Recurring" and "Setup Fees" are unreachable. One line in the primitive fixes four call sites. |
| H17 | 5 dialogs | **`max-h-[90vh]` overrides the deliberate `dvh` cap**, reintroducing the unreachable-submit bug on mobile Safari where browser chrome counts toward `vh`. |
| H18 | `lib/api.ts:22` | **A 401 hard-reloads and discards the refresh token.** `refresh_token` is received and thrown away; `/auth/refresh` exists but is never called. A backgrounded phone loses a half-filled form and is told "Invalid credentials". |
| H19 | ~17 controls | **Icon-only buttons with no accessible name** on primary record actions — delete lead, delete task, reveal password. A screen reader announces "button". |
| H20 | `pages/CRM.tsx:88` | **Only 200 of 600 leads load**, with no pagination, while the header reports the true total from a separate endpoint. 400 leads unreachable by browsing. |

---

## MEDIUM (selected)

- **Three different date conventions in one codebase.** `toISOString().slice(0,10)` used as a Cairo date in `dashboard.ts:25`, `crm.ts:234/418`, `users.ts:29`, `services/outreach.ts:817/929/935` and 6 frontend sites — between 00:00 and 03:00 Cairo it yields *yesterday*. `QuickAdd.tsx:76` submits that value, misfiling money across month boundaries. Meanwhile `services/outreach.ts:366` does it correctly with `AT TIME ZONE`, and `crm.ts:565` uses a bare `::date` that depends on session TZ.
- **Finance and Dashboard report internally inconsistent numbers.** `revenue_by_month` (`finance.ts:320`) ignores `?from/&to` and uses calendar months while the headline totals honour the range and `/finance/monthly` buckets by the 21st cycle — "July" means two different ranges on two panels. `dashboard.ts:30` validates `?period=` then ignores it for the money KPIs while filtering `expense_by_category` by it.
- **`response_rate` divides unrelated populations** (`crm.ts:551`) — `sent` counts activities, `replied` counts leads in advanced stages. A stage drag increments "replied" with no reply.
- **`POST /outreach/scheduler/tick` can hold an HTTP request open for hours** (`outreach.ts:873`) — it awaits the full send loop including 90-240s sleeps.
- **`enroll-bulk` is ~4,000 sequential queries** for 500 leads (`outreach.ts:705`); `ingest-bulk` was already batched for this reason.
- **`catch { }` swallows every auto-enrolment failure** (`services/outreach.ts:1047`) — leads silently never enter a sequence.
- **Unvalidated uuid params surface as 500s** across ~30 endpoints (Postgres `22P02` → generic 500 instead of 400/404).
- **Password reset does not revoke refresh tokens** (`auth.ts:248`) — a stolen 30-day token survives the recovery flow.
- **No rate limiting on `/auth/login`** — failures are recorded but not throttled.
- **A member's self-service `signature` is injected as unescaped HTML into cold email** (`users.ts:328` → `services/outreach.ts:748`).
- **Four more missing indexes**: `lower(leads.email)`, `outreach_sends(status, sent_at)`, `lead_activities(created_by)` and `(lead_id, created_at)`, `events.created_at`.
- **iOS auto-zooms three inputs** that override the primitive's `text-base md:text-sm` with `text-sm`.
- **236 sub-12px text instances** across 44 files; **19 sub-40px tap targets** where the `max-sm:h-10 w-10` fix was started and abandoned after 8 uses.
- **10 clickable rows are `<div onClick>`** with no keyboard path, while `LeadTable.tsx:78` does it correctly in the same file.
- **Notifications poll every 15s indefinitely** (`useNotifications.ts:20`) — ~240 requests/hour/user, on mobile battery, for a 3-person team.

---

## LOW

- **~2,724 lines of dead frontend code.** `lib/mock-data.ts` (deleted this phase). Three unrouted pages: `Knowledge.tsx` (234 — see below), `Index.tsx`, `Placeholder.tsx`. The entire shadcn toast stack (324 lines, app is 100% sonner). 28 unused `ui/` primitives (2,167 lines), orphaning ~23 dependencies. `date-fns` has zero imports.
- **Dead backend exports**: `suppressions.ts:16 isSuppressed`, `storage.ts:11 ALLOWED_MIME_TYPES`, `auth.ts:44 verifyAccessToken`, `middleware/auth.ts:96 AuthedUser`.
- **Duplicated auth middleware with *different semantics*** — `apiKeyAuth`/`jwtOrApiKey`/`adminOrApiKey` exist in both `middleware/automation-auth.ts` and `routes/outreach.ts:36`. Swapping one for the other would silently open `/outreach/analytics` to members.
- **11 currency formatters producing 4 different strings** for the same number — `12000.5` renders as "EGP 12,000.5" on Clients and "EGP 12,001" on Finance.
- **Six stale-lead thresholds** (2d, 48h, 7d, 14d) across six surfaces that will disagree about the same lead.
- **Schema drift**: `idx_enrollments_awaiting` exists in the DB (migration 0012) but not in `schema.ts`, so the documented `db:push` workflow would drop it.

### Knowledge Base — not dead, just unreachable
`pages/Knowledge.tsx` has no route and no nav entry, but I verified the backend is **fully operational in production**: the router is registered and admin-gated, `kb_chunks.embedding` is a real pgvector `vector` column, the extension is installed, Redis is active, and `OPENAI_API_KEY` is a valid `sk-` key. It has 0 documents purely because nothing links to it. **Routing it is a one-line change that unlocks an already-built, already-paid-for feature** — a better outcome than deleting 234 working lines.

---

## RTL / Arabic — absent

No i18n layer exists: zero matches for `i18next`/`react-intl`/`useTranslation` across 159 source files, no `dir=` anywhere including `index.html`, no `rtl:` variants, no Radix `DirectionProvider`. **227 physical-direction classes, 0 logical** — Tailwind 3.4 ships `ms-`/`me-`/`ps-`/`pe-` natively and they are simply unused. 49% of that debt (111 occurrences) is in vendored `components/ui/` code.

Full i18n is a genuine migration: **~800 user-visible English strings** across 45-60 files, including 20+ hand-rolled `n === 1 ? "" : "s"` ternaries that must be *rewritten* as ICU plurals because Arabic has six plural categories — two of them inflect the verb or the stem, not just add a suffix.

**But three Arabic *data* bugs exist today and are cheap to fix, independent of translation:**
1. **`dir="auto"` is nowhere** — 96 `<Input>` and 14 `<Textarea>` call sites. An Arabic lead name renders its cursor and trailing punctuation on the wrong side.
2. **Arabic search silently misses.** `crm.ts:70` uses `ILIKE`; case folding is a no-op for Arabic and nothing normalises. A lead stored as `أحمد` is not found by typing `احمد`, and `شركة` won't match `شركه`.
3. **`lib/whatsapp.ts:35` strips Arabic-Indic digits** — `/[^\d]/g` without the `u` flag produces an empty `wa.me/` link with no error.

---

## Performance — measured, not assumed

On a true 375px iPhone viewport, Fast 4G, 4× CPU throttle, **production build**:

| Metric | Result |
|---|---|
| First Contentful Paint | **1,792ms** (Google "good" < 1,800ms) |
| Largest Contentful Paint | **1,944ms** (good < 2,500ms) |
| DOM interactive | 298ms |
| JS on the Today route | 1 chunk (code-splitting working) |
| Initial bundle | 485 kB / **148 kB gzip**, recharts split to a separate 368 kB chunk |

**Production performance is fine.** The Vite *dev server* reports FCP 4,484ms, but its slowest resources are individual `.tsx` modules — that is unbundled dev-mode loading and is not representative. Query caching is also sound: global `staleTime: 30_000` with `refetchOnWindowFocus: false`, shared keys dedupe, no waterfalls found.

The real waste is the 15s notification poll and the unbounded/N+1 queries listed above, which are fine at today's volumes and will not be at 100k sends.

---

## What is genuinely good (do not regress)

`QuickAdd.tsx` — 3-tap lead capture with correct `htmlFor`/`id` on all 9 fields, `inputMode` per field, company defaulting to name. `MobileTabBar.tsx` — Today/Leads/Tasks/Outreach one tap, everything else two. `ManualTouchCard.tsx` — the best flow in the product: call or WhatsApp plus outcome in two taps. `PullToRefresh.tsx` — all-passive listeners, rAF style writes. `ErrorBoundary.tsx` and `RouteFallback.tsx` — the latter's `aria-busy` + `aria-live` + `sr-only` is the pattern the rest of the app should copy. `outreach/StepFlow.tsx` — labelled icon buttons *and* explicit keyboard reorder alongside native DnD. Every `<img>` has `alt`; no duplicate ids; every Dialog has a title; every page has an `<h1>`; Enter-to-submit works in all 20 dialog forms; sonner toasts are announced.

Two categories came back clean: **SQL injection** (every raw `sql` binds; the only two `sql.raw` sites inline an integer clamped 1-28) and the **`ADMIN_ONLY_MODULES` guard itself** (verified Hono's wildcard matches arbitrarily deep paths, so `/finance/transactions/:id` really is gated).

---

## Fix order

**Done this phase:** C1, C2, dead `mock-data.ts`.

1. **H1** — tap-to-change stage/status on lead and task cards. Unblocks the two flows currently impossible on a phone; both optimistic mutations already exist.
2. **H3** — `adminOnly` on both webhook GETs. Two lines; closes a credential leak.
3. **H4** — index on `leads.assignee_id`. One line; removes a full scan from every member request.
4. **H2** — `placeholderData: keepPreviousData` + gate the skeleton on `isPending && !data`. Stops the keyboard dismissing mid-search.
5. **H8** — deep-link palette results and give it a touch entry point.
6. **H9** — checkbox on `TaskCard`. Six taps → one.
7. **H5** — one digest notification per user per day instead of one per lead.
8. **H16 / H17 / H12** — `overflow-x-auto` on `TabsList`, `vh`→`dvh` in five dialogs, portal the bulk bar above the tab bar.
9. **H10** — one shared `<QueryError onRetry>` wired into 13 pages.
10. **H6 / H7** — transaction around the post-SMTP writes; partial unique index on live enrollments.
11. **H13 / H14 / H15 / H18** — Notes autosave race, premature toast, the banner, refresh-token handling.
12. **H19 + the 19 small tap targets** — mechanical, follows patterns already in the repo.
13. Arabic data fixes (`dir="auto"`, search normalisation, whatsapp digits) and the single `cairoToday()` helper.
14. Delete the 2,724 lines of dead code and ~23 orphaned dependencies; route `Knowledge.tsx`.
