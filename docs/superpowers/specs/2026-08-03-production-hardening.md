# Production hardening pass — 2026-08-03

Full-application audit and fix pass: the three reported bugs, plus everything
found while verifying them in a browser against a seeded local database.

**Status:** 6 commits on `main`, unpushed. See *Deployment* at the end.

---

## The three reported bugs

### 1. Today → "Chase" opened a blank page

Not a routing problem. `LeadDetailSheet` rendered the create-task dialog
*outside* its `{lead && …}` guard while reading `lead.name`, `lead.company` and
`lead.assigneeId`. While the detail query was in flight `lead` was `undefined`,
so the dereference threw during render, React unmounted the whole tree, and the
user got a white page. This fired on **every** lead open, not only from Today.

Three things had to be true for a one-line mistake to become a blank page, and
all three are now fixed:

| Cause | Fix |
|---|---|
| Unguarded dereference | Guarded the dialog on `lead` |
| No compile-time null safety — `tsconfig.app.json` had `strict: false` | Enabled `strictNullChecks`; verified it flags exactly this error |
| No `ErrorBoundary` anywhere in the app | Added one per route, reset on pathname |

Enabling `strictNullChecks` across the whole frontend cost **one** pre-existing
error, so there is no suppression backlog. The boundary was then verified by
injecting a deliberate render fault: the sidebar stays usable, the panel names
the error, navigating away clears it, and returning shows it again.

### 2. Team page had no real activity data

"Active 3 days ago" was derived from the most recent lead note a person had
written — which says nothing about whether they had opened the app. Someone
reviewing dashboards all week looked inactive, and an account that had never
been used was indistinguishable from one that had.

Added `login_events` (every attempt, success and failure) and
`profiles.last_seen_at`, touched by the auth middleware at most once every three
minutes so presence costs roughly one write per user per session rather than one
per request.

The page now shows: online-now presence, last sign-in, counts for 7d/30d/total,
failed attempts in the last 24h as a brute-force signal, never-signed-in as its
own state, a full sign-in history with IP and device, and a unified activity
timeline.

The timeline is a `UNION` over every table that already records authorship
(lead activities, tasks created and completed, enrolments, transactions, agent
runs, sign-ins) rather than a new write-time audit log. That choice means it has
complete history from the day it ships instead of starting empty. Its one
limitation — edits made in place to an existing row are not attributed — is
stated in the UI rather than left for someone to discover.

### 3. Sequence builder was too hard to use

Building a working sequence took four dialogs, and required knowing that
`day_offset` counts from enrolment rather than from the previous step. Nothing
validated the result, so the common failure — a sequence that sends once and
stops — was only discoverable by noticing the absence of follow-ups.

- **Templates.** 3-touch / 5-touch / single / empty, created with their steps in
  one atomic request. New sequences are always created switched **off**, so
  template copy nobody has read cannot start reaching prospects.
- **Flow view.** Steps render with explicit wait connectors ("3 days later")
  between them, anchored by "Lead is enrolled" and "Sequence ends". The old flat
  Day-N list showed absolute offsets but hid the cadence people reason about.
- **Reordering.** Drag, plus arrow buttons because native drag-and-drop is
  mouse-only. The server rewrites offsets to preserve the *gaps*: keeping the
  original numbers would let a later step sit before an earlier one, which the
  scheduler reads as "both overdue" and fires back to back.
- **Readiness panel.** Missing subject or body, duplicate day offsets, steps out
  of order, auto-enrol with no category, and the auto-enrol-all rule that caused
  142 leads to be double-emailed. Blockers disable the "turn on" button.
  19 unit tests.
- Adding a step pre-fills the next offset by continuing the spacing already
  established, instead of defaulting to 0 and stacking two steps on one day.

---

## Found while testing — not reported, all user-facing

| What | Impact |
|---|---|
| **Finance category filter was a dead control** | Its `<SelectContent>` contained the date-mode toggle and a duplicate set of date inputs instead of its options. Zero options, empty label, and the Range/Cumulative toggle was trapped inside a dropdown popover. |
| **Category filtering returned nothing** | Three queries read only the `categories` array and ignored the legacy scalar column, so every pre-multiselect transaction was invisible to `/finance/categories`, to `?category=` filtering, and to the totals. |
| **Setting a goal's progress to 0 was silently ignored** | `body.current ? … : undefined` — zero is falsy, so the update was dropped and the old value stayed. Reproduced: a goal at 40 stayed at 40. |
| **Goal progress saved on every keystroke** | Typing "150" sent three PATCHes and persisted each intermediate value; clearing the field to retype wrote a 0. Now commits on blur or Enter. |
| **`active_enrollments` missing from the sequence detail API** | The editor header rendered "· active" with no number, and its delete confirmation compared `undefined > 0` — so it always claimed no leads were enrolled, on a sequence that could have hundreds. |
| **The app was rendering in system fonts** | The Google Fonts `@import` sat after the `@tailwind` directives, which CSS forbids, so it was silently discarded. |
| **Bulk lead ingest was O(n) round trips** | ~4 serial queries per row, ~2,500 at the 500-row cap. Measured A/B: **1137ms → 276ms** for 200 leads, on localhost where latency is near zero. |

---

## Cross-cutting work

**Performance**
- Route-level code splitting: initial JS **1,413 kB → 449 kB** (gzip 386 → 140).
  Recharts and the agent panel now load only where used.
- `refetchOnWindowFocus` disabled — with a 30s `staleTime` it only produced
  duplicate traffic on every alt-tab.
- Finance no longer downloads up to 2,000 transactions on load to compute four
  sums; a server-side aggregate replaces it, and the row-level fetch is deferred
  until a category tab is actually opened.
- Verified: no duplicate requests on any page, nothing over 300ms locally.

**Accessibility** — Lighthouse 88 → **100** on Finance, 93 → **100** on CRM, and
a per-route sweep reports all 13 routes free of unlabelled controls and
heading-order jumps.
- Contrast: `--muted-foreground` was 4.24:1 and `--destructive` 3.89:1 as text.
  One destructive token cannot serve both uses on a dark theme — as text it must
  be light, as a filled button dark enough for white text — so it was split into
  `--destructive` (66%) and `--destructive-solid` (45%).
- Every remaining control labelled; kanban headings corrected from `h3` to `h2`.

**Consistency** — nine `window.confirm()` calls replaced with a promise-based
`useConfirm()`. Each prompt now states the real consequence: which transaction
and for how much, how many transactions a tool deletion orphans, that removing
someone unassigns rather than deletes their leads.

---

## Verified

- Frontend and backend typecheck: **0 errors** each.
- Tests: 28 frontend (19 new), 31 backend. All pass.
- CRUD create/update/delete exercised against the real API for clients, tasks,
  subtasks, goals and leads, including that a stage change auto-logs an activity
  and completing a task sets `completed_at`.
- **Permissions**: all seven admin-only modules return 403 to a member; row
  scoping confirmed (member saw 10 of their own leads, admin 200). IDOR probes
  on another user's lead and task return 404/403, and a member cannot promote
  themselves.
- Responsive: all 13 routes free of horizontal overflow at 375px.

A note on that last one: the first responsive pass used `resize_page`, which did
not actually change the viewport — `innerWidth` stayed at 929. That run was
measured at the wrong width and was meaningless. The figures above come from a
re-run under real device emulation.

---

## Deployment — needs your action

Six commits are on local `main`. **`git push` was blocked by the permission
system**, so nothing has shipped.

The production database is backed up already:
`/root/db-backups/seekersai-20260803-015124.dump` (2.5 MB, 475 leads,
451 enrolments, 901 sends).

Order matters, because Vercel deploys the frontend from `main` while the API is
restarted separately:

1. `git push origin main`
2. Immediately: `ssh root@128.140.65.42 '/var/www/seekersai/deploy.sh'`

`deploy.sh` runs `drizzle-kit push:pg`, which will create `login_events` and add
`profiles.last_seen_at`. Both are additive. If push proves interactive, apply
`backend/src/db/migrations/0011_login_telemetry.sql` by hand first — it is
idempotent (`IF NOT EXISTS` throughout) and backfills `last_seen_at` from
existing activity so the Team page is not empty on day one.

The Team page tolerates the gap between the two deploys: if `session` is absent
because the API has not restarted yet, it falls back rather than throwing.

## Still open

- `Knowledge.tsx` — 228 lines, no route, no nav entry. Unreachable. Route it or
  delete it; that is a product call.
- Saved filter views on CRM, and a bulk-actions consistency pass. Both were
  deferred in the previous pass and remain undone.
- Deliverability: 32 enrolments still sit failed from `554 spam` rejections.
  That needs a separate sending domain and real cold-email infrastructure, not
  a code change.
