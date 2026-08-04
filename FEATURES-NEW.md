# New features — Agency Economics

Built on branch `crm-enhance`, August 2026.

Everything below was designed against the **live production database**, queried
read-only before anything was written. The numbers quoted are the real ones as of
2026-08-04. That mattered more than usual here, because two of the four features
originally suggested turned out to have no data to stand on, and one of them
could only have been built as a lie. Those decisions are in
[What was deliberately not built](#what-was-deliberately-not-built), and that
section is as important as the features.

**Where it lives:** a new admin-only page at **`/economics`** ("Economics" in the
sidebar, under Finance), served by one endpoint, `GET /api/v1/economics/summary`.

---

## The shape of this business, from its own data

Everything that follows is grounded in these facts, all measured, not assumed:

| | |
|---|---|
| Income recorded | 468,800 EGP across 41 transactions |
| Expenses recorded | 326,499.46 EGP across 123 transactions |
| Largest cost category | **Tools — 169,169.46 EGP, 51.8% of all spend** |
| Expense rows linked to a client | **1 of 123** (1,200 EGP, 0.4%) |
| Client revenue reachable only by typed name | **139,800 EGP** |
| Income rows that are not revenue at all | 77,339 EGP opening balance |
| Rows whose currency tag contradicts their magnitude | 60 |
| Leads in the pipeline | 600 — of which **597 still `new_lead`, 0 `closed_won`, all deal values 0** |

The last row killed one proposed feature outright. The row above it shaped how
every figure on the page is qualified.

---

## Feature 1 — Recurring coverage

### The question it answers

> *"If I win no new business this month, do the retainers I already have pay the
> bills?"*

The Finance page reports income and expenses for a period. It cannot answer this,
because the answer needs recurring revenue separated from one-off revenue, and
needs it compared against a normalised monthly cost base. Both sides are
derivable from what is already recorded; neither existed anywhere in the product.

This is the first thing on the page on purpose. The agency runs at roughly a 10%
operating margin, and at that margin whether the retainers clear the cost base
matters more than any individual client's number.

### How the metric is defined

```
recurring revenue (MRR) = income in category "Client Recurring Fee"
                          over the trailing 90 days, x 30/90
monthly cost base       = total expenses / whole months of expense history
coverage %              = MRR / cost base        (100% = break-even)
monthly surplus         = MRR - cost base
```

**What it excludes, and why:**

- **Setup fees.** They are one-off. Counting them is precisely how a project
  business convinces itself it is a retainer business.
- **Pending and cancelled transactions.** Those are intentions, not money that
  moved.
- **Income that cannot be tied to a client** (see Feature 2) — including the
  77,339 EGP opening balance, which is not revenue.

**The two sides use different windows, deliberately.** Revenue uses 90 days
because what matters is what is being billed *now* — a client who churned in
January must not prop up today's coverage. Cost uses the full history because the
expense record is lumpy (annual domain renewals, irregular tool invoices), and a
90-day cost window swings wildly with whatever happened to be invoiced inside it.
Both windows are stated on the page rather than left for the reader to assume.

**Known weakness, stated plainly:** the cost base is a mean, not a forecast. A
single large one-off lifts it, and it makes no attempt to separate fixed from
variable cost — nothing in the data marks that distinction, and inventing one
would be guessing. Part-months are floored rather than rounded up, so the cost
base is never flattered by dividing across a longer period than the data covers.

### How to use it

Read the percentage. Above 100% the retainers cover the cost base and the surplus
is what is actually accruing per month. Below 100% the shortfall is being funded
by setup fees, one-offs, or reserves — which is survivable, but it is a different
business than it looks like from the Finance page, and it is worth knowing which
one you are running.

---

## Feature 2 — Clients & retainer health

### The question it answers

> *"What has each client actually paid me, and has one of them quietly stopped
> paying?"*

Neither half of that was answerable before, for two separate reasons.

**Reason one: the stored figure is wrong.** `clients.total_revenue` has drifted
badly out of step with the transaction ledger — it reads 10,000 for Backyard,
which has actually paid 84,000, and 123,000 for Rajac, which has paid 109,800.
Nothing keeps it in sync. This feature ignores it and derives revenue from the
ledger every time.

**Reason two: a lot of the money is not linked.** Only 23 of 41 income rows carry
a `client_id`. The rest carry the client's name as free text. A report keyed on
the foreign key alone shows Rajac at 44,000 when it has been paid 109,800 —
**139,800 EGP of real client revenue across three clients is invisible** to any
view that does not read the text name.

### How the metric is defined

**Revenue** is all completed income matched to the client, either by `client_id`
or by its typed `client_name`. Name matching is **exact after normalising case
and whitespace** — never fuzzy, never prefix-based, for a concrete reason: this
database contains both "Rajac" and "Rajac Medical center" as separate paying
clients, and any substring rule merges them and doubles one client's revenue.

Matching runs in two tiers, `name` before `company`. This is load-bearing rather
than tidy: both of those clients carry the **company** "Rajac", so a single flat
lookup makes the key ambiguous and rejects exactly the 65,800 EGP the feature
exists to recover. An ambiguous tier stops the search rather than falling through
to the next one — if two clients genuinely share a name, breaking the tie on
their companies is picking a winner on evidence the transaction never offered.

**Health** compares days since the last payment against **that client's own
median gap between payments**, not a fixed calendar month:

| | |
|---|---|
| Current | within 1.25× the client's median gap |
| Due | over 1.25× |
| Lapsed | over 2× |
| Never paid | no payments on record |

A flat "30 days" rule would nag Rajac (pays around the 5th) every month and never
catch Backyard (pays around the 19th) at all. Where a client has fewer than two
payments no gap can be measured, 30 days is assumed, and the page labels it
**"(assumed)"** — an assumed cadence must never be readable as an observed one.

**What it excludes:** all costs. There is no per-client profit here, and
[that is a deliberate refusal](#1-per-client-profitability-the-headline-refusal).

**Money that names a payer with no client record is listed separately**, never
folded into a client. Two very different things land there and the report cannot
tell them apart: a real client who was never added to the CRM (Digitivia, 10,000
EGP), and a bookkeeping row that is not a client at all ("Starting 2026 amount",
a 77,339 EGP opening balance). Inventing a client from the text name made that
opening balance the agency's single largest "client" and handed it a third of the
revenue-share pie — a bug caught by a unit test, now pinned by one.

### How to use it

The "Needs a nudge" count and the amber callout are the actionable part: those
clients are overdue *against their own rhythm*. Revenue and share tell you your
concentration risk — the top two clients are 56.6% of attributed revenue. The
"matched by name" badge tells you which figures will disagree with the Clients
page, and why.

---

## Feature 3 — Cost base & tool spend

### The question it answers

> *"Where does the money actually go, and am I still paying for tools I stopped
> using?"*

Tools are **51.8% of everything this agency spends** — 169,169 EGP, more than
salaries. There was no view of it anywhere. `transactions.tool_id` has been
populated on 94 of 95 Tools rows for months and nothing read it.

What that unlocks immediately: **Voiceflow alone is 59,093 EGP, 34.9% of all tool
spend** and roughly 16% of operating revenue. Voiceflow and Convocore together
are 78,866 EGP on two overlapping conversational-AI platforms. And ten
subscriptions are still flagged active with no charge recorded for over 75 days,
including n8n (last charged 257 days ago) and Hamsa (235 days).

### How the metric is defined

**Tool spend** is the sum of expenses carrying that tool's `tool_id`. Expenses in
the "Tools" category with **no** tool attached are counted in the total and in
the category split but against no named vendor, so the tool table can add up to
less than the Tools category. That gap is left visible rather than smeared across
the named tools — currently it is 0, and if it grows it will show rather than
hide.

**Quiet ("dormant")** means still marked `active` with no charge for over **75
days** — two missed monthly billing cycles, chosen because the books close on the
20th and monthly tool invoices land on the 20th.

It is a prompt to check, not a claim of waste, and the page says so. There are two
innocent explanations and the data cannot distinguish them: the subscription is
gone and the record is stale, or it is still being charged somewhere that is not
being recorded. **Annually-billed items legitimately appear here** — Namecheap
and the domain renewal are false positives by design, and the UI names that
caveat next to the list rather than letting the reader discover it.

### How to use it

Sort is by spend, so the top bar is where the money is. Grey bars are the quiet
ones. For each quiet tool, either cancel it, or find the charge that is not being
recorded — both outcomes improve the numbers on this page. The category split
reconciles exactly to total expenses, so it can be read against the Finance P&L
without arithmetic.

---

## Honesty mechanics

Every figure on this page is derived from genuinely messy data, so the page
states its own caveats inline instead of in a document nobody opens. The closing
panel, **"How these numbers are built"**, is computed from the data rather than
asserted in prose, so it cannot drift out of date:

- how few expense rows carry a client (and therefore why there is no per-client
  profit) — currently **1 of 123**;
- how much income names no payer at all — **28,661 EGP over 3 rows** — excluded
  from every client figure and from the revenue-share denominator;
- how much names a payer with no client record — **87,339 EGP** — likewise
  excluded, and listed for triage;
- **the 60 rows whose currency tag disagrees with their own magnitude.** This one
  deserves its own note.

### The currency finding

60 of 164 transactions are tagged `USD`. They are almost certainly **EGP amounts
with the wrong tag**, and the evidence is in the magnitudes: salaries of exactly
"7,000 USD" sitting alongside salaries of 3,000–14,000 EGP, and tool invoices of
"8,024 USD" alongside 8,000 EGP. A genuine 7,000 USD monthly salary in Cairo, or
a genuine 8,024 USD tool invoice at this revenue, is not credible.

So **every total on this page treats all amounts as EGP**, which is also what the
existing `/finance/summary` does. Converting them at a real rate would inflate
the cost base roughly fiftyfold. The count is surfaced on the page so the
mis-tagging gets fixed at source rather than silently carried by every report
that reads this table.

### Money is never a float

Amounts cross the wire as `numeric(12,2)` strings and are summed as bigint minor
units through the existing `services/money.ts` engine from the quotations work —
no second money engine was written. The frontend formats from the string and
never parses it into a `number`, so a value too large to be a JS float still
renders exactly. There is a test for that.

---

## What was deliberately not built

### 1. Per-client profitability — the headline refusal

This was the strongest suggestion, and it is the one thing here that **cannot be
built honestly today**. It is not a scope decision; it is an arithmetic one.

**Only 1 of 123 expense rows carries a `client_id`** — 1,200 EGP out of 326,499.
Cost per client is not tracked, so it cannot be measured. The obvious workaround
is to allocate shared overhead by revenue share. That workaround is worthless,
and provably so:

```
allocated_i = Pool x (R_i / R_total)
profit_i    = R_i - Pool x (R_i / R_total) = R_i x (1 - Pool / R_total)
margin_i    = profit_i / R_i              = 1 - Pool / R_total
```

The margin percentage is **identical for every client, by construction**. It
contains no information about any client, yet it renders as a confident
per-client margin column that someone would fire a client over. A dashboard like
that is worse than no dashboard.

So the page shows revenue, contribution and health per client, states that it
does not allocate cost, and says exactly what would make the real number
possible: **tag expenses to clients.** Once even a third of expense rows carry a
`client_id`, direct-cost margin becomes real and this module can answer it
without changing shape.

### 2. Proposal-to-close tracking — no data exists

Genuinely valuable, and currently unbuildable:

- The `quotations` and `invoices` tables **do not exist in production**.
  Migration 0015 has not been deployed, so there are zero quotations to measure.
- The lead pipeline cannot substitute: **597 of 600 leads are still `new_lead`,
  3 are `contacted`, and `closed_won` is empty.**
- **Every `deal_value` in the database is 0.00**, so average deal size and
  weighted pipeline have no numerator.
- 1,005 outreach emails produced **0 replies**, and `lead_activities` contains no
  reply events at all.

Close rate, time-to-close and average deal size would each be a division by zero
dressed up as a chart. This becomes worth building once migration 0015 is
deployed and a dozen quotations have been sent — the data model already supports
it, and `draft/sent/accepted/rejected` is the right shape.

### 3. Client health scoring — over-engineering at this scale

A weighted 0–100 score over **six clients**, two of which are the same
organisation (Rajac and Rajac Medical center), would be a model with more
parameters than data points. Any weighting would be invented, and a score of
"73" communicates less than "last paid 33 days ago, normally pays every 30".

The underlying question — *which client has gone quiet* — is real, so it was
built as **payment recency against each client's own median cadence**: a directly
observed signal, no tuned weights, and every input visible on the card. That is
Feature 2. The scoring model was rejected; the question it was reaching for was
not.

### 4. An AI assistant over CRM data — a distraction, for now

The plumbing genuinely exists (`services/openrouter.ts` with a fallback chain, an
`agents` system, pgvector live in production). It was still the wrong thing to
build this round.

The bottleneck is not the interface to the numbers, it is that **the numbers did
not exist and the data underneath them is mis-tagged**. An assistant over this
data in its current state would confidently report Rajac's revenue as 44,000, or
sum the 77,339 opening balance into revenue, or add EGP to mis-tagged USD — and
it would do it in fluent prose, which makes the error *harder* to catch than a
wrong number in a table. Grounding an LLM on figures that are themselves wrong
industrialises the error.

Deterministic, reconciling, self-documenting metrics come first. They are now
here, they are unit tested, and they are exactly the grounding an assistant would
need. This is a strong next step, not a rejected idea.

### 5. Routing the orphaned Knowledge page — one line, deliberately not pulled

`Frontend/src/pages/Knowledge.tsx` exists and has **no route in `App.tsx`**, so
the Knowledge Base is unreachable. Production has Redis active and pgvector
working with a real `vector` column. The change is genuinely one line:

```tsx
const Knowledge = lazy(() => import("./pages/Knowledge"));
<Route path="/knowledge" element={<AdminOnly><Knowledge /></AdminOnly>} />
```

It was not shipped because its primary action cannot be verified from here.
`OPENAI_API_KEY` in production is **32 characters** — shorter than a valid OpenAI
key — and embedding is what upload depends on. `kb_documents` and `kb_chunks` are
both empty, so there is nothing to query either. Routing it would expose a page
whose upload button fails, which is worse than a page that is not there.

**To enable it:** confirm `OPENAI_API_KEY` is a live key, upload one document,
confirm `kb_documents.status` reaches `ready`, then add the two lines above.

---

## Reference

| | |
|---|---|
| Endpoint | `GET /api/v1/economics/summary` — optional `?from=YYYY-MM-DD` |
| Access | Admin only, via `ADMIN_ONLY_MODULES` in `backend/src/index.ts` |
| Page | `/economics`, admin-only route, "Economics" in the sidebar |
| Calculations | `backend/src/services/economics.ts` — pure, no db/clock/env |
| Tests | `backend/src/services/economics.test.ts` (47), `Frontend/src/pages/Economics.test.tsx` (29) |
| Migration | `0019_economics_indexes.sql` — three read-path indexes, idempotent, no new columns |
| Timezone | `cairoToday()` throughout; no `toISOString().slice(0,10)` as "today" |

### What would make these numbers better

In priority order, and all of it data entry rather than engineering:

1. **Tag expenses to clients.** Unlocks real per-client margin (Feature 1's
   refusal disappears).
2. **Fix the 60 mis-tagged USD rows**, or record a real rate if any are genuinely
   USD.
3. **Link income to clients** via `client_id` rather than the typed name, and add
   Digitivia as a client.
4. **Move the opening balance out** of the income table, or into a category the
   P&L excludes.
5. **Deploy migration 0015** so proposal-to-close becomes measurable.
