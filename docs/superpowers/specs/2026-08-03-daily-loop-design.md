# The Daily Loop + Lead Supply — design

**Date:** 2026-08-03 · **Author:** Dessouky (architecture) with Claude
**Status:** implemented

---

## Why

The CRM is deployed, holds real data, and the team has logins — and they still
don't open it. Dessouky's diagnosis: *"not enough leads, and the team doesn't
actually use the CRM because there is no benefit to it."*

Those two problems are linked. The app asks people to log activity, drag kanban
cards and keep records straight, and gives nothing back to the person doing the
typing. So the records rot, the pipeline looks empty, and nobody has a reason to
return. Low lead volume is partly a *symptom*: an empty CRM isn't worth opening,
and a CRM nobody opens never gets filled.

A member's app is four pages (Tasks, CRM, Outreach, Notes). Every one of them
opens with a database. None of them opens with an answer to *"what should I do
right now?"* — and before this change, members were actively redirected off `/`
because the dashboard was admin-only.

The engine is not the gap. Sequences, auto-enrolment, ingest, the IMAP reply
poller and a full webhook bus already exist. What's missing is a throttle, a
dashboard and a horn.

## What we're building

Both halves of one pipeline, viewed from opposite ends:

```
SOURCED → ENRICHED → ENROLLED → SENT → REPLIED → ACTIONED → WON
└──────── supply end: is enough flowing in? ─────┘
                          └──── action end: what's on my desk? ────┘
```

One data model, two views. That is what makes this one project rather than two
half-finished ones.

## Architecture

### The spine: a pure ranking function

`rankWorklist(inputs) → WorklistAction[]` in
`backend/src/services/worklist-ranking.ts`.

The file imports **nothing**. No database, no HTTP, no clock of its own (`now`
is passed in). This matters: the first version put the ranker and its SQL in one
file, and the tests couldn't even import it without a live `DATABASE_URL` — so
the claim "testable in isolation" was false until the two were split. The split
is load-bearing, not cosmetic.

- `worklist-ranking.ts` — pure scoring and copy. 24 unit tests.
- `worklist.ts` — the only part that touches the database.

### Six action types

| Type | Source | Why it earns attention |
|---|---|---|
| `reply_waiting` | enrolment `status='replied'` from the inbox poller | Speed-to-lead is the biggest single lever |
| `hot_lead` | `audits.views >= 3` | Real intent — call today |
| `sequence_blocked` | enrolment `paused`/`failed` | Silent revenue loss nobody was seeing |
| `task_due` | task due or overdue | Delivery work |
| `stale_lead` | assigned, active, no activity in N days | The existing leak |
| `unassigned_lead` | active lead with no owner | Leads landing with nobody on them |

**Scoring:** `base + valueBonus + ageBonus`.

- Base encodes the kind of thing it is.
- `valueBonus` is log-scaled and capped at 300, so a big deal outranks a small
  one without one whale burying the board.
- Age is what stops anything sitting at the bottom forever. An unanswered reply
  climbs fast (25/hour); a stale lead climbs slowly (8/day) because it has
  already gone cold. Hot leads *decay* with age — intent is perishable.

**Deduplication:** a lead occupies exactly one slot. A lead that replied *and*
went hot is one conversation; showing it twice teaches people to skim.

`stale_lead` and `unassigned_lead` are made disjoint in SQL rather than resolved
by score. Verification caught an ownerless lead surfacing as "chase this" when
the correct instruction was "give this an owner" — you cannot chase what nobody
owns.

### Access

`/worklist` is deliberately **not** in `ADMIN_ONLY_MODULES`. The entire point is
that a member lands somewhere that tells them what to do. Scoping happens
per-row inside `fetchWorklist` — members see only their own leads and tasks, and
the two company-level signals (blocked sequences, unassigned leads) are
admin-only. `/worklist/pipeline-health` is admin-gated at the route.

### The supply end: runway

`GET /worklist/pipeline-health` returns new leads, enrichment %, sends, replies
and reply rate — but the headline is **runway**:

> at the current send rate, how many days until we run out of leads we have
> never contacted.

That is the number that converts "we don't have enough leads" from a feeling
into a dated, ownable problem. Below `SUPPLY_RUNWAY_WARN_DAYS` it flags
`starving`. With nothing sent in 7 days runway is `null` — *undefined*, not
infinite — and the copy says the machine is idle rather than printing a
reassuring number nobody should trust.

### The horn: WhatsApp

Three new events on the existing webhook bus: `worklist.digest`,
`worklist.urgent`, `supply.starving`. The CRM decides and fires; n8n delivers
over WABA. Nothing in the CRM knows what WhatsApp is, so the "one sender" rule
holds.

The digest is **off** unless `DIGEST_ENABLED=true`, fires once per Cairo day at
`DIGEST_HOUR`, and skips anyone with an empty queue — a daily "you have nothing
to do" message is how a bot gets muted.

## The Today screen

New `/` for everyone; the admin financial dashboard moves to `/dashboard`.

Layout **C**, chosen from three mockups, capped at five like A:

- **One focus card** — the single next thing, fully loaded: who they are, the
  deal, their actual reply text, and the primary action.
- **A thin "up next" queue** beneath it.
- **Skip** reorders today only; it never mutates the lead, so anything skipped
  returns tomorrow if it still needs doing.
- **All-clear state** is a real state, not an empty list.
- Admins get the supply strip on top.

Capping at five is a product decision, not a technical one: a list that always
looks finishable gets worked; a list of sixty gets ignored.

## Bulk deletion

Requested mid-design. Shipped with rails, because this codebase had *already*
demonstrated silent irreversible deletion (see below).

- Leads: by explicit selection (max 1000) or by source filter. Admin only.
- Tasks: by selection, scoped by assignee in the query itself — a member cannot
  touch someone else's row even by guessing ids. The response reports
  `skipped`, so the UI can say "3 of 5" instead of quietly doing less.
- Always `dry_run` first for an exact count; the dialog states the blast radius
  (activities, enrolments, sends all cascade) and that there is no undo.
- Every real execution writes a `leads_bulk_deleted` row to `events` — who,
  when, how many.

**No fake undo.** Deletion cascades across four tables; an "undo" that restored
lead rows but not their history would be a lie. Honest prevention beats a
restore button that half-works.

## Deployment ordering

Vercel deploys the frontend the instant `main` moves; the API only updates when
someone runs `deploy.sh` on the VPS. So there is always a window where the new
UI is live against the old API.

Rather than choreograph the push, the Today page treats a missing endpoint as an
expected state: `retry: false`, and an explicit "the API hasn't picked up this
release yet" card with links to CRM and Tasks. Push order stops mattering.

## Testing

- **24 unit tests** on the pure ranker — ordering, decay, dedupe, copy, edges.
- **39 integration checks** (`scripts/verify-worklist.ts`) against real Postgres
  in a throwaway schema, covering member scoping, admin visibility, runway maths
  before and after sends, and every bulk-delete guard.

The integration pass exists because compiling proves nothing about hand-written
SQL. It immediately earned its keep by catching the stale/unassigned overlap.

## Context: the incident that shaped the safety rules

Booting the API during the audit **permanently deleted two completed tasks**.
Cause: task auto-cleanup hard-deleted anything finished more than 30 days ago,
on every boot and hourly, with no archive, no undo and no UI warning — running
on a built-in default nobody had configured. It is now strictly opt-in and warns
loudly when enabled.

That is why bulk deletion ships with dry-run counts, an explicit blast-radius
warning and an audit trail, rather than a fast path and a hope.

## Deliberately not built

- A prettier re-skin of the existing pages. The interface isn't hard to use, it
  is unrewarding; restyling the same screens would change nothing.
- A "mark as handled" button on the worklist. A reply clears when a human logs
  real activity, so the queue empties through normal work instead of needing its
  own state to drift out of sync.
- Soft-delete / trash. See above.

## Next

1. **Lead Supply, properly** — runway makes starvation visible; sourcing volume
   is Gomaa's n8n work and now has a number to aim at.
2. **Deliverability ops** (NEWPLAN Module 6).
3. **Draft-reply in the focus card** — the mockup shows an AI-drafted response;
   the agent exists, the wiring does not yet.
