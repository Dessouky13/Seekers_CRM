# Frontend Enhancement — Design

**Date:** 2026-08-03 · **Status:** approved, ready to implement
**Scope:** SEEKERS CRM frontend (`Frontend/`), four phases

---

## Problem

The CRM has grown fast and works, but four weaknesses were found by inspecting the
codebase rather than by guessing:

| Finding | Evidence |
|---|---|
| Page content is not responsive | 36 responsive utility classes across ~7,000 lines of `pages/*.tsx`. `Tasks`, `Today`, `Team`, `Clients` have no `overflow-x-auto` on their tables. |
| Loading states flash blank | `Skeleton` exists (`components/ui/skeleton.tsx`) but is used only by `sidebar.tsx`. Pages contain 65 raw `isLoading` branches rendering text or nothing. |
| Two components are too large to change safely | `CRM.tsx` 1,031 lines · `Outreach.tsx` 1,090 lines. |
| No data export; command palette is stale | No CSV export anywhere. `CommandPalette` **does** exist, is wired in `AppLayout`, and searches real leads/clients/tasks — but its page list predates `Today`, `Outbound` and `Team`. |

Navigation on mobile is **not** a problem: the shadcn sidebar already renders a `Sheet`
drawer via `useIsMobile`, and the viewport meta tag is correct.

---

## Goals

1. The CRM is usable on a phone — specifically, acting on a reply alert away from a desk.
2. The app feels responsive: no blank flashes, immediate feedback on repeated actions.
3. Data can leave the system (CSV) and be found quickly (refreshed palette).
4. The daily path — Today → lead → reply → task — has no dead ends.

## Non-goals

- No visual redesign or rebrand.
- No new backend endpoints except where CSV export genuinely requires one.
- No new npm dependencies.
- No unrelated refactoring. Only the two oversized files are split, because
  Phase 3 adds features to them.

---

## Phase 1 — Mobile

**Why first:** it is the largest measured gap and it is independent of the others.

- Wrap every data table in a horizontal-scroll container. Missing on `Tasks`,
  `Today`, `Team`, `Clients`; already present in `CRM`, `Finance`, `Outreach`.
- Collapse multi-column KPI/stat grids to a single column below `sm`.
- Make dialogs usable on small screens (full height, scrollable body, reachable
  footer buttons).
- Enlarge tap targets in the Today queue and any icon-only buttons to ≥40px.
- Verify the sidebar drawer does not trap focus or overlay content.

**Done when:** every page renders without horizontal body scroll at 375px width,
and the Today → lead → action path is completable by touch.

## Phase 2 — Polish & speed

**Why second:** the file split it contains is a prerequisite for Phase 3.

- Replace raw `isLoading` text/blank branches with `Skeleton` layouts that match
  the real content shape. Prioritise Today, CRM, Finance, Outbound.
- Add optimistic updates to the highest-frequency mutations: lead stage moves,
  task status changes, notification read.
- Ensure every list has a genuine empty state that says what will fill it.
- Split `CRM.tsx` and `Outreach.tsx` into focused child components under
  `components/modules/`, preserving behaviour exactly. No logic changes in the
  same commit as the split.

**Done when:** no page flashes blank on load; both files are under ~400 lines;
typecheck and tests still pass.

## Phase 3 — Capabilities

- Refresh `CommandPalette`: add `Today`, `Outbound`, `Team` to its page list, and
  add quick actions (new lead, log expense, new task).
- CSV export on Finance transactions, CRM leads, and Clients. Client-side
  generation from data already fetched — no backend change unless a full dataset
  beyond the current page is required, in which case one paginated read is added.
- Saved filter views on CRM (persisted to `localStorage`, no schema change).
- Bulk actions made consistent where partially present.

**Done when:** a user can find any record from the palette, and export each of the
three datasets to a spreadsheet.

## Phase 4 — Flow fixes

**Why last:** it audits the surfaces the earlier phases change.

- Walk Today → lead detail → reply → create task and remove dead ends,
  missing back-links, and unnecessary clicks.
- Ensure every deep link from Today lands on the right record, not just the page.
- Consistent breadcrumbs/back affordances on detail views.

**Done when:** the daily path is completable without using the browser back
button, and every Today item deep-links to its exact record.

---

## Testing & rollout

- `npx tsc --noEmit` (both `backend/` and `Frontend/`) and `npx vitest run` after
  every phase. Currently 31 tests pass; that must not regress.
- Phase 1 additionally verified at 375px width.
- **Deploy per phase, not as one batch**, so direction can be corrected early.
- Each phase is its own commit with its rationale in the message.

## Risks

| Risk | Mitigation |
|---|---|
| Splitting 1,000-line files silently changes behaviour | Split is mechanical and committed separately from any logic change. |
| Optimistic updates desync from the server | Only applied to mutations with a clear rollback; invalidate on settle. |
| CSV export leaks data across roles | Export reuses the existing role-scoped API responses; no new unscoped query. |
| Scope creep across four phases | Non-goals listed above are binding. |
