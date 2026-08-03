# ENHANCE-LOG

Running log for the `crm-enhance` branch. Newest phase last.

---

## Phase 0 — Audit · 2026-08-03

**Deliverable:** [`CRM-AUDIT.md`](CRM-AUDIT.md) — findings by severity with `file:line`, plus a 14-step prioritised fix order.

**How it was audited.** Static sweep of both trees; `EXPLAIN` against a local copy of the schema; hands-on testing in Chrome at a **true 375×812 iPhone viewport** with touch emulation, Fast 4G and 4× CPU throttling; production inspected read-only over SSH.

### Fixed

**C1 · Bulk lead delete could `DELETE` with no `WHERE`.** `crm.ts:321`'s guard was `!body.keep_sources && !body.delete_sources`, and `![]` is `false`, so `{"keep_sources": [], "confirm": "DELETE_LEADS"}` passed it, contributed no SQL condition, and produced an unfiltered delete cascading to activities, enrollments and sends.

I confirmed it was live by sending that payload to a running server — **it deleted all 735 leads from my local database in one request.** Production was never touched. Fixed with Zod `.min(1)` plus a `conditions.length === 0` refusal immediately before the statement is built. Verified: empty array, empty-string element and `delete_sources: []` all return 400; a legitimate dry-run still works; row count unchanged.

**C2 · `seed-dev.ts` would have reset all three production passwords.** Its only guard was "host must be localhost" — *true on the VPS*, since production's `DATABASE_URL` is `…@localhost:5432/seekersai`. It would have passed its own check, then upserted `password = EXCLUDED.password` on `dessouky@`, `mostafa@` and `gomaa@`, and injected fake clients, leads and EGP transactions into live P&L. `seed.ts` had no guard at all and is exposed as `npm run seed`.

Root cause was duplicated guards that drifted — I fixed one script first and missed the other, which is the same mistake in miniature. Both now share `scripts/lib/seed-guard.ts` with three independent checks: loopback host, `NODE_ENV`, and **no business records present** (the check a hostname cannot make, since loopback can hold a production restore). Verified: both refuse a populated database by name and count.

**H3 · Any member could read every webhook `secret`.** `/webhooks` was absent from `ADMIN_ONLY_MODULES`; `GET /webhooks` returned whole rows including the shared `X-Webhook-Secret`, and `GET /webhooks/:id/deliveries` leaked other users' lead data and phone numbers. Every *mutating* sibling was already `adminOnly`. Gated the module.

**H4 · `leads.assignee_id` was unindexed** — the tenant-isolation key that every member-scoped read filters on, five times per worklist request. Added to `schema.ts` plus migration `0014`. Applies cleanly from scratch, idempotent on re-run, and verified usable (`Index Scan using idx_leads_assignee`). **Not applied to the live VPS DB — awaiting your approval.**

**Dead code:** removed `Frontend/src/lib/mock-data.ts` (121 lines, zero importers).

### Corrections to my own working assumptions

- **The brief's premise that mobile navigation needs a drawer is out of date.** A `MobileTabBar`, a quick-add FAB, pull-to-refresh and an error boundary already exist, and lead capture is already 3 taps. Phase 1 is refinement, not construction.
- **My first tap-target measurement was wrong.** A crude selector reported "77/83 controls under 40px" on Team; a screenshot showed the page looks fine. Re-measuring with labels found the real issue: 11 of 19 controls, and it is *height* (`h-7` = 28px on secondary actions like "View work"), not count.
- **Dev-server performance is not production performance.** Vite dev reported FCP 4,484ms; the production build on the same throttled phone is **FCP 1,792ms / LCP 1,944ms**, both inside Google's "good" thresholds. I did not report the dev number as a finding.

### Biggest finding not yet fixed

**Kanban drag-and-drop is HTML5-only, so it is dead on touch** — and Kanban is the default view on both Leads and Tasks. Changing a lead's stage or marking a task done is therefore *impossible by drag on a phone*; the fallback is a 6-7 tap edit form. Both optimistic mutations already exist; only a tappable control is missing. This is fix #1 in the audit's order and the opening item of Phase 1.

### Verification

| Check | Result |
|---|---|
| Backend typecheck | 0 errors |
| Backend tests | **147 passed** |
| Frontend typecheck (`-p tsconfig.app.json`) | 0 errors |
| Frontend tests | **57 passed** |
| Frontend lint | 24 problems (was 25) — pre-existing, mostly vendored `ui/`; catalogued in the audit |
| Production build | succeeds, 485 kB / 148 kB gzip initial |

**Assumptions logged:** commits on this branch are authored `Dessouky13 <abd.dessouky@gmail.com>` with no co-author trailer, per the brief. No live-DB migration has been applied.

---

## Phase 1 (partial) — Mobile blockers · 2026-08-04

Pushed Phase 0, deployed the API (migration `0014`), then tested **production**
in Chrome at a true 375×812 viewport with touch, Fast 4G and 4× CPU throttle.

### Deployment

`main` deployed. Migration `0014` applied cleanly and the planner now genuinely
uses the index at 600 rows — `Index Scan using idx_leads_assignee`, which my
24-row local copy could not demonstrate. Data verified intact after: 600 leads,
6 clients, 164 transactions, 3 profiles.

One self-inflicted bug on the way: the `deploy.sh` I had scp'd from Windows
carried **CRLF endings**, so the server's shell rejected `set -o pipefail`. It
failed loudly rather than half-running. Stripped on the server.

### Live baseline

All 13 routes on production: render, no horizontal scroll, no error boundary, no
false-empty states, **zero console errors, zero failed requests**. Every API
module responds in ~0.24s.

### Fixed and verified on live

| Bug | Evidence before | Verified after |
|---|---|---|
| **Stage was a label, not a control.** Kanban DnD is HTML5-only and dead on touch, so moving a lead took 6 taps through an edit form | `hasSelectElement: 0` in the lead sheet | Real `<select>`, 7 stages, **130×44px**, labelled, wired. Mutation proved locally: `new_lead → proposal_sent` + activity logged |
| **Topbar search never searched records.** Filtered a hardcoded page list while its `aria-label` promised leads/clients/tasks; also stale, and registered a *second* Ctrl+K racing the palette's | Typed "clinic" against 600 leads → **"No results"** | Now a 240×44 button opening the real palette; "clinic" returns **Angie Clinic, Lushelle Clinic** |
| **Palette results discarded the record id** | `onSelect → go("/crm")` | Search "Angie" → select → `/crm?lead=41449b27-…`, sheet opens on Angie Clinic |
| **Unlabelled icon buttons** — a screen reader said "button" for *delete lead* | 5 unlabelled, one 12×12 | "Edit this lead"/"Delete this lead" at 44×44; **0 unlabelled remaining** |

### Fixed and verified on the production bundle

| Bug | Evidence before | Verified after |
|---|---|---|
| **Marking a task done cost 6 taps** | no control on the card | One-tap checkbox, **44×44**, `aria-pressed`, named per task. Toggled and **persisted**: status `done`, `completed_at` set |
| **Tab strips clipped their last tabs** | inner Finance strip: **507px of tabs in 343px**, `overflow: hidden` | Now `overflow-x: auto`; scrolled 164px and **"Setup Fees" activates** |
| **Five dialogs overrode the `dvh` cap** with `vh`, putting Save below the fold on mobile Safari | 5 files | all converted; zero `vh` height caps remain |
| **Bulk-action bar unreachable** — rendered inside `main`'s `translateZ(0)` containing block, so `fixed` tracked the scroller; `bottom-6` sat under the 56px tab bar; ~420px row in 375px | — | portals to `document.body`, sits above the tab bar + safe-area inset, wraps below `md` |

Desktop (1440×900) re-verified across all 13 routes: no horizontal scroll, no
clipped tab strips, mobile bar correctly hidden, zero console errors.

### Four findings I disproved rather than "fixed"

Worth recording, because acting on any of them would have been churn:

1. **"Search unmounts the input and dismisses the keyboard."** Sampled every
   100ms through the debounce window: **0/20 frames showed a skeleton**, the
   input never lost focus or identity. Does not reproduce.
2. **"Lead cards aren't tappable."** My synthetic click hit the draggable
   wrapper; the `onClick` is on a child. A correct hit-test opens the sheet.
3. **"93% of Team's controls are under 40px."** A crude selector; a screenshot
   showed the page is fine. Real figure: 11 of 19, and it is button *height*
   (`h-7` = 28px), not count.
4. **"Tabs don't switch."** Radix activates on `mousedown`, which my synthetic
   events omitted. Keyboard and `mousedown` both work.

The recurring lesson: synthetic DOM events are not taps. Three of the four
false alarms came from dispatching the wrong event on the wrong node.

### Not app bugs

Vercel's **Security Checkpoint** ("Code 21") began blocking the automated
browser after rapid scripted navigation, which invalidated one desktop run.
Re-verified against the identical production bundle served locally.

### Verification

Backend **147 tests** / 0 TS errors · Frontend **57 tests** / 0 TS errors · lint
at its prior baseline · production build succeeds.
