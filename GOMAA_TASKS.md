# Gomaa — n8n Build Plan (Seekers Outbound Machine)

**Owner:** Gomaa · **Architecture:** Dessouky · **Updated:** 2026-08-01
Companion to [NEWPLAN.md](NEWPLAN.md), which explains the *strategy*. This file is the *build instructions*.

---

## 1. WHAT THIS IS — read this first

We are building a machine that finds businesses, researches each one automatically, emails them something specific enough to get a reply, and tells us the moment someone answers.

**Two systems, one job:**

| | **SEEKERS CRM** (Dessouky) | **n8n** (you) |
|---|---|---|
| Role | The **brain** | The **hands** |
| Owns | The database, who to contact, what step, when to send, all email sending, all AI writing, scoring, the UI | Everything that touches the outside world: fetching web pages, verifying emails, WhatsApp, LinkedIn, rendering PDFs, DNS/IMAP checks, backups |

**The rule that prevents disasters:** the CRM decides, you execute. You never build a second
sender or a second scheduler — two senders means leads get double-emailed and our domain
gets burned. If a task produces **data**, you `POST` it to the CRM. If a task performs an
**action**, the CRM triggers **you** via a webhook.

### The flow, end to end

```
 ①  SOURCE            ②  RESEARCH              ③  DECIDE + WRITE        ④  SEND
 (you, n8n)           (you, n8n)               (CRM — already built)    (CRM sends email)
 ─────────────        ─────────────            ─────────────────        ──────────────
 Google Maps    ─┐    tech fingerprint  ─┐     stores everything        email  → CRM
 OpenStreetMap  ─┼─►  reviews/complaints ─┼──► scores the lead     ────► WhatsApp → YOU
 Firecrawl web  ─┘    find + verify email┘     AI writes the email      LinkedIn → YOU
                                                                         call task → YOU
        │                     │                                               │
        └── POST /leads/ingest└── POST /intel/*                               │
                                                                              ▼
 ⑥  ALERT  ◄──────────────────  ⑤  REPLY DETECTED
 WhatsApp to us                 CRM reads the inbox itself, auto-pauses the sequence
 (you wire this)                ⚠️ NEW — you no longer build reply detection
```

### ⚠️ What changed this week (two things came off your plate)

1. **Reply detection is now the CRM's job.** Dessouky is building an IMAP inbox poller
   inside the CRM. It reads the inbox every ~2 minutes, matches the sender to a lead,
   pauses their sequence, and fires the `lead.replied` webhook. **You do not build an
   email-watcher workflow.** You only subscribe to the webhook and send the WhatsApp alert.
2. **Scrapling is Dessouky's to set up.** It'll be an internal HTTP service. You will just
   call it with an HTTP Request node. No Python, no browsers, nothing to host on your side.

---

## 2. HOW MANY WORKFLOWS — 10 total

Build them in this order. **W1–W3 are this week.** The rest are gated (see §5).

| # | Workflow | Trigger | What it does exactly | Status |
|---|---|---|---|---|
| **W1** | **Error Handler** | Called on any failure | Catches a failure from any other workflow → sends WhatsApp alert (workflow name, node, error, sample payload) → writes a row to an `n8n_errors` table. Attach it to **every** workflow you build. | 🔨 Build first |
| **W2** | **Sheet Migration** | Manual, one-off | Reads the old Google Sheet → maps columns → `POST /outreach/leads/ingest` per row (batches of 20, 1s delay) → failures go to a `migration-errors` sheet. Then the sheet is dead. | 🔨 This week |
| **W3** | **Nightly Backup** | Cron 03:00 | `pg_dump` the CRM database → upload to Hetzner storage box → keep 14 days. | 🔨 This week |
| **W4** | **OSM Lead Sourcing** | Webhook `/seekers-osm` | Free lead source. Takes `{area, category}` → queries the OpenStreetMap Overpass API (no API key, no anti-bot, legal open data) → maps POIs to leads → `POST /outreach/leads/ingest`. **JSON is being written for you — import it.** | ⏳ Ready soon |
| **W5** | **Enrichment Pipeline** | Webhook or cron over un-enriched leads | The "90-second SDR". Per lead: call Scrapling `/fingerprint` + `/contacts` + `/reviews` → call Google PageSpeed API → run the email waterfall (scraped → pattern-guess + SMTP verify → Hunter → Apollo) → send reviews to Claude for complaint tags → `POST /intel/fingerprint`, `/intel/reviews`, `/intel/enrichment`. | 🔒 Needs Scrapling URL |
| **W6** | **Audit Renderer** | CRM webhook `audit.requested` | Receives audit content from the CRM → renders a branded 1-page PDF → generates a personalised HTML landing page → publishes both to `audits.seekersai.co/{slug}` → `POST /audits` with the URLs. Page includes a 1×1 pixel that calls `POST /intent`. | 🔒 After W5 |
| **W7** | **WhatsApp Sender** | CRM webhook `outreach.send.channel` (channel=whatsapp) | Sends the approved WABA template to the lead → `POST /events` type `sent`. On an inbound WhatsApp reply → `POST /outreach/webhooks/reply` so the CRM pauses the sequence. | 🔒 Gated |
| **W8** | **Alerts & Task Digest** | CRM webhooks `lead.replied`, `lead.hot`, `outreach.send.channel` (linkedin/call) | **The one you actually want most.** A reply, a hot lead (3+ audit views), or a blacklisted mailbox → instant WhatsApp. Plus a 9am digest of that day's LinkedIn/call tasks. | 🔨 Build after W1 |
| **W9** | **Deliverability Checks** | Cron: weekly + daily | Weekly: each mailbox emails a seed list → IMAP-check which folder it landed in → `POST /mailboxes/health` with inbox-placement %. Daily: DNSBL blacklist lookups → post + alert. Weekly: parse DMARC XML reports. | 🔒 Gated |
| **W10** | **Demo Brief** | Cal.com webhook + CRM `demo.booked` | Forwards the Cal.com booking to `POST /webhooks/cal` → CRM writes the brief → you render it to PDF → WhatsApp it to the group 12h before the call. After the call, a voice note → transcribe → `POST /events` won/lost. | 🔒 Last |

---

## 3. ENDPOINTS, URLS AND CREDENTIALS

### 3.1 CRM API — `https://agency.seekersai.org/api/v1`

Every call needs the header `X-API-Key: <AUTOMATION_API_KEY>`.
In n8n create **one** Header Auth credential named **`Seekers CRM API Key`** and reuse it everywhere.

> ⚠️ **You can only call endpoints that accept the API key.** Everything else in the CRM
> requires a human login and will return 401 from n8n. The full list you *can* call is below —
> if you need something not on this list, ask Dessouky rather than working around it.

**Lead intake**
| Method | Endpoint | Body |
|---|---|---|
| POST | `/outreach/leads/ingest` | `{ name, company, email?, phone?, source?, category?, notes? }` — idempotent by email; accepts a lead with **any one** of name/company/email/phone; long fields are truncated, not rejected |
| POST | `/outreach/webhooks/reply` | `{ from_email, subject?, body_preview? }` — use for **WhatsApp** replies (email replies are now auto-detected by the CRM) |

**Lead intelligence** — match a lead with any one of `lead_id`, `domain`, or `email`. Each call also auto-appends an `events` row.
| Method | Endpoint | Body |
|---|---|---|
| POST | `/intel/fingerprint` | `{ lead_id\|domain\|email, tech_fingerprint{}, pagespeed?{} }` |
| POST | `/intel/reviews` | `{ lead_id\|domain\|email, review_stats{}, complaint_tags[], hook }` |
| POST | `/intel/enrichment` | `{ lead_id\|company_domain\|email, contacts:[{ name, title, email, email_status, linkedin_url, phone }] }` |

**Events, mailboxes, audits**
| Method | Endpoint | Body / notes |
|---|---|---|
| POST | `/events` | `{ lead_id?, type, payload?, source? }` · type ∈ sourced, verified, sent, bounce, open, click, reply, unsub, meeting, won, lost |
| GET | `/events?lead_id=&type=` | read the activity feed |
| POST | `/mailboxes/health` | `{ address, inbox_placement_pct?, bounce_rate?, dnsbl_listings?[], seed_results?{}, daily_cap?, warmup_stage? }` — health score is computed for you; a non-empty `dnsbl_listings` auto-fires an alert |
| GET | `/mailboxes` | current mailbox health |
| POST | `/audits` | `{ lead_id?, slug, score?, issues?[], quick_wins?[], pdf_url?, page_url? }` — upsert by `slug` |
| GET | `/audits` | list audits + view counts |
| POST | `/intent` | `{ slug, ip_hash?, ua? }` — pixel hit; the CRM counts views and fires `lead.hot` on the 3rd |

**Read-only metrics**
`GET /outreach/analytics` · `GET /outreach/analytics/sequence/:id`

**Not built yet** (ask when you reach W9/W10): `POST /webhooks/cal`, `POST /ops/freeze`.

### 3.2 CRM → n8n webhooks (the CRM calls *you*)

Subscribe your n8n webhook URLs in the CRM's **Settings → Webhooks** UI.

| Event | Fires when | Status |
|---|---|---|
| `lead.created` | a lead is ingested | 🟢 live |
| `lead.replied` | **someone replies to an email** (now auto-detected by the CRM) | 🟢 live |
| `outreach.sent` | an outreach email goes out | 🟢 live |
| `lead.hot` | 3+ audit-page views, **or** a mailbox gets blacklisted | 🟢 live |
| `outreach.send.channel` | CRM wants a WhatsApp/LinkedIn/call action | 🟡 to add (W7) |
| `demo.booked` | a demo is booked | 🟡 to add (W10) |

### 3.3 Other URLs and services

| Service | URL / detail |
|---|---|
| n8n | `https://n8n.srv1131703.hstgr.cloud` |
| Existing scrape router webhook | `/webhook/3f8ea5dc-2c42-4ec8-ada8-f1f1c6ec713e` |
| Overpass API (free, no key) | `https://overpass-api.de/api/interpreter` |
| Google PageSpeed Insights | `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` (free key) |
| Scrapling service | ⏳ Dessouky will send base URL + API key |
| Audit hosting | `audits.seekersai.co` |

### 3.4 Credentials to set up in n8n (never paste keys into workflow JSON)

- [ ] `Seekers CRM API Key` — Header Auth, `X-API-Key` *(get from Dessouky)*
- [ ] `Scrapling` — Header Auth *(coming from Dessouky)*
- [ ] Firecrawl API key *(you already have)*
- [ ] Google PageSpeed API key *(free — create)*
- [ ] Hunter.io *(free tier, 25/mo)*
- [ ] Apollo *(A-tier leads only)*
- [ ] WhatsApp Business API + approved templates
- [ ] Seed-list mailbox IMAP logins (Gmail / Outlook / Yahoo test accounts)
- [ ] Hetzner storage box *(for backups)*
- [ ] Cal.com webhook secret
- [ ] Ops WhatsApp group / bot endpoint for alerts

---

## 4. STEP BY STEP — how to actually build it

### ▶ Step 1 — W1: Error Handler *(do this before anything else)*
1. New workflow → **Error Trigger** node.
2. Add a **WhatsApp** node → message: workflow name, failed node, error message, first 200 chars of payload.
3. Add a **Postgres** node → insert into your own `n8n_errors` table (`workflow, node, error, payload, created_at`).
4. In **every** other workflow: Settings → *Error Workflow* → select this one.
5. ✅ **Done when:** you deliberately break a throwaway workflow and the WhatsApp arrives within a minute.

### ▶ Step 2 — W8: Alerts *(the highest-value one — do it early)*
1. New workflow → **Webhook** node (POST), copy its URL.
2. In the CRM → Settings → Webhooks → add a subscription for `lead.replied` pointing at that URL.
3. **Switch** node on the event type → branch for `lead.replied`, `lead.hot`.
4. Each branch → **WhatsApp** node. For a reply: *"📬 REPLY — {{lead name}} ({{company}}) just replied: {{preview}}"*. For hot: *"🔥 {{lead name}} opened their audit {{views}}× — call today."*
5. Repeat the subscription for `lead.hot`.
6. ✅ **Done when:** you reply to a test outreach email from another address and get a WhatsApp within ~3 minutes.

### ▶ Step 3 — W2: Kill the Google Sheet
1. Export the sheet to CSV.
2. New workflow → manual trigger → **Read CSV** → **Split In Batches** (20).
3. **Set** node → map to `{ name, company, email, phone, source, category, notes }`.
4. **HTTP Request** → POST `https://agency.seekersai.org/api/v1/outreach/leads/ingest`, credential `Seekers CRM API Key`, `neverError: true`.
5. **Wait** 1s per batch. Route failures to a `migration-errors` sheet.
6. Attach the W1 error workflow.
7. ✅ **Done when:** CRM lead count = sheet rows − rejects, and you've eyeballed 10 rows. Re-running is safe (ingest is idempotent).

### ▶ Step 4 — W3: Nightly Backup
1. New workflow → **Cron** 03:00 daily.
2. **Execute Command** → `pg_dump` the CRM DB to a timestamped file.
3. Upload to the Hetzner storage box; delete anything older than 14 days.
4. ✅ **Done when:** you restore last night's dump into a scratch database and it opens clean.

### ▶ Step 5 — W4: OSM Lead Sourcing
1. Download `seekers-osm-leads.json` (Dessouky is preparing it) and **import** it into n8n.
2. Confirm the `Seekers CRM API Key` credential is attached to the ingest node.
3. Activate it and POST a test: `{ "area": "Cairo", "category": "dentist", "limit": 50 }`.
4. Check the CRM CRM page for leads with source `openstreetmap`.
5. ✅ **Done when:** 50 real Cairo dentists land in the CRM, most with a phone number.
6. ⚠️ Overpass is a free shared service — keep a delay between calls and don't hammer it.

### ▶ Steps 6+ — gated work
W5 (enrichment) starts when Dessouky sends the Scrapling URL **and** v1 has been sending
for two full weeks. Then W6 → W7 → W9 → W10 in that order. Full acceptance criteria for
each are in the table in §2 and in NEWPLAN.md.

---

## 5. THE SEQUENCING RULE (from NEWPLAN — this is not optional)

> **Do not start W5 or later until v1.0 has been sending for two full weeks.**

Reason: right now there are ~18 leads enrolled and **zero replies**. Enriching 18 leads
proves nothing. Volume first, then intelligence — data from the simple version tells us
where the complexity actually pays. Building enrichment now is procrastination in disguise.

**What that means practically:** W1, W2, W3, W4, W8 now. Everything else waits.

---

## 6. DO **NOT** BUILD THESE (the CRM owns them)

- ❌ **An email reply watcher** — the CRM polls the inbox itself now.
- ❌ **The Scrapling service** — Dessouky hosts it; you just call it over HTTP.
- ❌ **A second sequencer or send scheduler** — the CRM schedules and sends all email.
- ❌ **NocoDB or any admin grid** — the CRM is the admin UI.
- ❌ **ICP scoring, A/B winner maths, the objection library** — CRM + AI.
- ❌ **Storing leads/events as the source of truth** — you POST, the CRM stores.
- ❌ **Hot-lead threshold logic** — you report pixel hits, the CRM decides what's hot.

If a task isn't clearly *"reach the outside world"* or *"render and deliver something"*,
it's probably the CRM's job. Ask before you build it.
