# Outreach that produces conversations — Design

**Date:** 2026-08-03 · **Status:** approved, not yet implemented
**Scope:** two slices shipped together — sending discipline, and WhatsApp/phone as
first-class channels.

---

## Problem

Measured against production on 2026-08-03:

| | |
|---|---|
| Emails sent | **871** |
| Replies | **0** |
| Enrollments that ran every step | 387 |
| Send failures | 30 (all Namecheap's own outbound filter, `554 … JFE040023`) |
| Leads in `new_lead` | **599** |
| Leads in any later stage | **1** |
| Tasks ever created | 4 |

Two independent failures, and the second is the one nobody was looking at.

**The mail does not arrive.** Namecheap Private Email is a mailbox product. Its
ToS prohibits bulk sending and its outbound filter already rejected 30 messages.
Everything is sent in a single batch at noon Cairo, which is itself a
bulk-sender signal.

**Nothing is worked by a human.** 871 machine touches produced 1 lead marked
`contacted` and 4 tasks. A reply nobody works is worth the same as no reply, so
fixing delivery alone would not have produced revenue.

A third fact reframes the whole thing: **575 leads have a phone and only 517
have an email**, and the list is Gulf-heavy rather than Egyptian —

| Country | Leads | | Country | Leads |
|---|---|---|---|---|
| 🇦🇪 UAE `+971` | 137 | | 🇯🇴 Jordan `+962` | 38 |
| 🇪🇬 Egypt `+20` | 122 | | 🇬🇧🇺🇸🇪🇺 other | ~34 |
| 🇸🇦 Saudi `+966` | 66 | | 🇺🇸 US, no country code | 130 |
| 🇶🇦 Qatar `+974` | 47 | | | |

410 of the 445 internationally-formatted numbers are MENA/Gulf, where WhatsApp
penetration runs 80–95%. Phone is the stronger asset, and it is entirely unused.

## Goal

Produce human conversations. Email becomes a safe, low-volume door-opener;
WhatsApp and phone carry the load.

**Not** "make the 871 sends land." That target is unreachable under the
constraints below, and pretending otherwise would set up a second month of
disappointment.

---

## Decisions taken, and what they cost

| Decision | Chosen | Consequence accepted |
|---|---|---|
| Delivery strategy | Hybrid — low-volume email, human-driven WhatsApp/phone | Email is a capped channel by design |
| Sending transport | **Keep the existing Namecheap mailbox, add caps only** | Zero cost and no new vendor. The ToS position is unchanged and `seekersai.org` keeps absorbing the reputation damage already done |
| WhatsApp mechanism | **Click-to-send deep links, human presses send** | Free, no API, no template approval, compliant because a person initiates each message. Not automated |
| Number verification | **Dialling-plan filter + learn from outcomes** | No paid lookup. `+1` numbers cannot be classified at all |

### Two requests I could not implement as asked

**"Make sure it is a working WhatsApp number before."** There is no compliant
free way to check WhatsApp presence. The unofficial methods scrape
`web.whatsapp.com`, breach WhatsApp's ToS, and get the sending number banned —
out of scope on purpose. The achievable version is deterministic
mobile-vs-landline classification (which catches the real concern: Egyptian
`02`/`03` landlines never have WhatsApp) plus recording the human's observation
on first contact, so the list cleans itself.

**"Make it a link for WhatsApp Business."** There is no separate public deep
link for the Business app. `wa.me` and `whatsapp://send` open whichever WhatsApp
is installed on the device, so a phone running WhatsApp Business gets WhatsApp
Business. The requirement is satisfied, just not through a distinct URL.

---

## Architecture

Two slices over one shared idea: **a lead has channels, and every channel has an
eligibility state with a human-readable reason.**

```
                    ┌─────────────────────────────┐
   phone string ──► │  phone.ts (pure)            │
                    │  normalise → E.164          │
                    │  classify → mobile/landline │
                    └──────────┬──────────────────┘
                               ▼
  ┌──────────────────────────────────────────────────┐
  │  channels.ts (pure)                              │
  │  lead → { whatsapp, email, call } + why / why-not │
  │  priority: whatsapp(mobile) > email > call        │
  └──────────┬───────────────────────────┬───────────┘
             ▼                           ▼
  ┌────────────────────┐      ┌──────────────────────┐
  │ SLICE 1            │      │ SLICE 2              │
  │ sending discipline │      │ manual channels      │
  │                    │      │                      │
  │ • per-mailbox caps │      │ • whatsapp/call steps │
  │ • spread + jitter  │      │   become Today items  │
  │ • suppression list │      │ • pre-written message │
  │ • failure classify │      │   + wa.me deep link   │
  │ • SPF/DKIM/DMARC   │      │ • outcome capture →   │
  │   DNS health check │      │   learns whatsapp y/n │
  └────────────────────┘      └──────────────────────┘
```

`phone.ts` and `channels.ts` are pure and unit-tested without a database,
matching the existing `sequence-readiness.ts` and `outreach-subject.ts`.

---

## Slice 1 — Sending discipline

### Mailbox registry and volume

`mailboxes` already exists with `dailyCap`, `sentToday`, `healthScore`,
`warmupStage`, `bounceRate` and `dnsblListings`, and has **0 rows**. Seed it from
`EMAIL_FROM` on boot, idempotently.

The authoritative "how many have gone out today" is **derived** by counting
`outreach_sends` for the current Cairo day — never read from a stored counter,
because a counter drifts across restarts and double-sends, and this is the
number that decides whether a cap is breached. The existing `mailboxes.sentToday`
column is kept and refreshed by the scheduler for display only; no decision ever
reads it.

Volume by `warmupStage`:

| Stage | Daily cap | When |
|---|---|---|
| `recovery` | 5 | After a spam rejection, and **the starting stage** — the domain is already burned |
| `warmup` | 10, +5 per clean week | Once a week passes with no spam rejection |
| `active` | 40 ceiling | Sustained clean sending |

Downgrade to `recovery` automatically on any `spam_reject`.

### Pacing

Replace the single noon batch with a spread across 09:00–17:00 Africa/Cairo:
a randomised 90–240 s gap between sends, an hourly ceiling, and each scheduler
tick releasing at most `floor(remaining ÷ slots_left)`. Friday/Saturday skipping
is existing behaviour and stays.

### Suppression

New table:

```sql
suppressions(
  address     text PRIMARY KEY,
  reason      text NOT NULL,   -- hard_bounce | spam_reject | complaint
                               -- unsubscribe | manual
  source      text,            -- inbox_poller | scheduler | ui
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
)
```

Checked before every send. This replaces today's behaviour, where a hard bounce
**nulls `leads.email`** — destroying the address and any chance of ever
correcting it. Bounces now add a suppression and set `leads.email_status =
'bounced'` (the column already exists), keeping the address intact.

### Failure classification

`isPermanentSendError` and `isRecoverableInfraError` already exist. Add
`isSpamRejection` (`554`, `JFE`, `blocked`, `spam`), and store the verdict in a
new `outreach_sends.failure_kind` so the UI can explain *why* a send failed
rather than only that it did.

### Domain authentication check

SPF, DKIM selector and DMARC lookups through Node's built-in `dns/promises` —
no dependency, no cost. Surfaced as pass/fail with the actual record and what is
wrong with it. Expectation: DMARC is absent entirely.

### UI

A Deliverability panel on Outbound, which is currently an almost-empty page:
mailbox usage against cap, warmup stage, the three DNS records, suppression
count with a browsable list, and recent failures grouped by `failure_kind`
showing the real SMTP response.

---

## Slice 2 — WhatsApp and phone as channels

### `phone.ts` (pure)

`normalise(raw)` → E.164 or `null`. There is deliberately **no default country**:
guessing one would silently mangle a Gulf list that spans five dialling codes.
The rules, in order:

1. Already `+`-prefixed → strip formatting, keep as-is.
2. Matches the North-American shape (`(NNN) NNN-NNNN` or 10 bare digits with a
   valid area code) → `+1`. This is the 130 US leads.
3. Anything else → `null`, and the lead's phone channels are ineligible with the
   reason "number has no country code". Better to say so than to invent one.

`classify(e164)` → `mobile | landline | unknown` from a compact dialling-plan
table:

| Country | Mobile prefixes |
|---|---|
| `+971` UAE | 50, 52, 54, 55, 56, 58 |
| `+20` Egypt | 10, 11, 12, 15 |
| `+966` Saudi | 5x |
| `+974` Qatar | 3, 5, 6, 7 |
| `+962` Jordan | 7x |
| `+44` UK | 7x |
| `+33` France | 6, 7 |
| `+31` Netherlands | 6 |
| `+41` Switzerland | 7x |
| `+1` US/Canada | **`unknown` by design** — mobile and landline share the numbering space |

### `channels.ts` (pure)

`resolveChannels(lead)` returns an ordered list of
`{ channel, eligible, reason }`, priority **WhatsApp (mobile) > email > call**,
with reasons written for a human:

```
whatsapp  eligible    mobile · +971 5x
email     eligible
call      eligible

whatsapp  ineligible  landline — WhatsApp not available
email     ineligible  suppressed after hard bounce
```

**When no channel is eligible** — no email or it is suppressed, and no usable
number — the eligible list comes back empty. Such a lead cannot be enrolled in
any sequence, and enrolment refuses with that specific reason rather than
accepting it and failing silently three days later. The Leads page gets an
**"unreachable"** filter so the set is visible and fixable; today a lead with no
working contact detail looks identical to one that is simply waiting its turn.

### Manual sequence steps

`outreach_steps.channel` gains `whatsapp` and `call` alongside the existing
`email`/`linkedin`/`note`.

A due manual step does **not** send. It moves the enrollment to a new
`awaiting_action` status and raises a Today item. It **blocks**: the next step
does not fire until a human resolves it. A cadence that silently skips its
manual touches is not the cadence the author designed.

`awaiting_action` is distinct from `paused` so a waiting-on-a-human enrollment
is never confused with a failed one.

### The action card

Rendered in the Today queue and the lead detail sheet. Shows the lead, the
message with variables already substituted, and one primary control:

- WhatsApp → `https://wa.me/<digits>?text=<url-encoded message>`
- Call → `tel:<e164>`
- Copy-to-clipboard as a fallback for desktop without WhatsApp installed

Outcomes: **Sent · No WhatsApp · Wrong number · Not interested · Replied**

| Outcome | Effect |
|---|---|
| Sent | Advance the enrollment to the next step. On a WhatsApp step this also sets `whatsapp_status = 'yes'` — the message going through *is* the confirmation the number is on WhatsApp, so the list learns from success as well as failure |
| No WhatsApp | `whatsapp_status = 'no'`, re-route this lead to email if eligible |
| Wrong number | Clear `phone`, disable both phone channels |
| Not interested | Stop the enrollment, stage → `closed_lost` |
| Replied | Stop the enrollment, raise a reply-waiting item |

Every outcome writes a `lead_activity`, so the timeline finally reflects human
work rather than only machine sends.

### Backfill

A one-off migration normalises and classifies all 575 existing phones and
reports the resulting counts per country and per type.

---

## Data model changes

| Change | Reason |
|---|---|
| `leads.phone_e164`, `leads.phone_type`, `leads.whatsapp_status` | Normalise once on write; `whatsapp_status` (`unknown`/`yes`/`no`) is the outcome-learning field |
| new `suppressions` table | Non-destructive, permanent replacement for nulling `leads.email` |
| `outreach_sends.failure_kind` | Lets the UI say why a send failed |
| `outreach_steps.channel` += `whatsapp`, `call` | Additive to an existing text column |
| `outreach_enrollments.status` += `awaiting_action` | Distinguishes waiting-on-a-human from failed |
| seed `mailboxes` from `EMAIL_FROM` | Table exists, is empty, and caps have nowhere to live without a row |

No table is rewritten and no column is dropped.

---

## Non-goals

- WhatsApp Business API, message templates, automated WhatsApp sending
- Any telephony or dialler integration
- A separate sending domain, or any new paid service
- Enrichment / Outbound intel (0 rows today, left alone)
- Sub-project 3, the pipeline UX that gets leads out of `new_lead` — a
  follow-on, and mostly UX on top of this work

---

## Testing

| Suite | Covers |
|---|---|
| `phone.test.ts` | All ten country codes with real production samples; the US-without-country-code shape; garbage and empty input; idempotent re-normalisation |
| `channels.test.ts` | Every priority ordering and every ineligibility reason, including a lead with both email and mobile choosing WhatsApp |
| `sending-policy.test.ts` | Cap enforcement, the derived `sentToday` count, spread arithmetic, suppression blocking a send, warmup ramp and the automatic downgrade to `recovery` |
| Integration | A due manual step does not send, sets `awaiting_action`, and raises exactly one Today item |

Existing suites must not regress: 28 frontend, 31 backend at time of writing.

## Rollout

1. Migrations and the phone backfill, reporting counts before anything changes behaviour.
2. Slice 1 behind the existing scheduler — caps and suppression first, since they only ever *reduce* sending and so cannot make things worse.
3. Slice 2 channel resolution and the read-only UI, before any sequence uses a manual step.
4. Manual steps last, once the action card is proven on a single lead.

Deploy per slice, not as one batch. `scripts/deploy.sh` now runs migrations from
`src/db/migrations` with a recorded ledger, typechecks before restarting, and
takes a `pg_dump` first.

## Risks and honest expectations

**Email will still not produce many replies.** The mailbox and domain are
unchanged by explicit decision. This work makes email safe, paced and honest —
it does not make it land. Judge this project on WhatsApp conversations, not on
email reply rate.

**`+1` numbers stay unclassified** — roughly 137 leads, left to human judgement.

**Manual channels need a human every day.** A blocking manual step converts an
automated sequence into a work queue. If nobody works the queue, sequences stall
in `awaiting_action` — which is visible and honest, but still stalled. The Today
queue and the existing WhatsApp digest are how that stays in front of someone.

**Deep links depend on the device.** `wa.me` needs WhatsApp installed on
whatever device the CRM is open on. The copy-to-clipboard fallback covers the
desktop case.
