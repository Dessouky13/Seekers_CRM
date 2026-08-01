# SEEKERS Outbound Machine v2.0 — Gomaa's Work (n8n + Infra)

**Companion to [NEWPLAN.md](NEWPLAN.md). Owner: Gomaa · Architecture review: Dessouky**

This is everything that **cannot** live inside the SEEKERS CRM app and must run in
**n8n / infrastructure**. The CRM (agency.seekersai.org) owns all *data, scheduling,
scoring, UI and AI drafting*. Your job is everything that **touches the outside world**:
scraping, HTTP fetching, email verification, WhatsApp/LinkedIn, PDF rendering, DNS/IMAP
checks, and infra (backups, alerting).

---

## GROUND RULES (read first — these prevent disasters)

1. **The CRM is the single brain.** It decides *who* to contact, *what* step, and *when*.
   You never run a second sequencer or a second sending scheduler. You **execute**
   actions the CRM asks for and **push data back**. Two senders = double-emailed leads =
   burned domain.
2. **Everything is idempotent.** Every workflow that can run twice must be safe to run
   twice. Key sends/actions by `(contact_id, step)`. A re-run must never double-send.
3. **You POST results to the CRM; you don't hold the source of truth.** The Google Sheet
   is being killed. Postgres (inside the CRM) is the record.
4. **The 2-week rule (from NEWPLAN):** Do **not** build Module 2+ enrichment until v1.0 has
   been sending for 2 full weeks. Start with the foundation tasks (Section A) + migrating
   the sheet. Complexity before volume is procrastination.
5. **Public data only.** No scraping behind login walls (no LinkedIn logged-in scraping).
   Search-engine / public-page queries only.
6. **Every workflow has an error branch** (see Module 8). No silent failures.

---

## SHARED INTERFACE — CRM endpoints you call

Base URL: `https://agency.seekersai.org/api/v1`
Auth: `X-API-Key: <AUTOMATION_API_KEY>` (from Dessouky; n8n **Header Auth** credential
`Seekers CRM API Key` — same one the Firecrawl flow uses).

> ⚠️ **Hard constraint — verified against the codebase:** n8n can ONLY reach endpoints
> that accept the API key. **Exactly four exist today.** Everything else in the CRM
> requires a human login (JWT) and is unreachable from n8n. So any new v2 endpoint you
> depend on must be built by Dessouky with **`apiKeyAuth`** — flag it explicitly when you
> request it.

**✅ LIVE + API-key-reachable (use today):**
| Endpoint | Purpose | Body |
|---|---|---|
| `POST /outreach/leads/ingest` | create/patch one lead (idempotent by email) | `{ name, company, email?, phone?, source?, category?, notes? }` |
| `POST /outreach/webhooks/reply` | report inbound reply → CRM pauses sequence | `{ from_email, subject?, body_preview? }` |
| `GET /outreach/analytics` | read outreach metrics | — |
| `GET /outreach/analytics/sequence/:id` | per-sequence funnel | — |

**🔒 Exists but JWT-only — you CANNOT call these from n8n** (they're for the app/humans):
`/crm/*`, `/finance/*`, `/tasks/*`, `/users/*`, `/outreach/sequences|enroll|enrollments`,
`/outreach/leads/ingest-bulk` (admin), `/dashboard`, `/goals`, `/notes`, `/vault`,
`/knowledge`, `/webhooks`. If you think you need one of these, tell Dessouky — the answer
is usually "the CRM does that, not you."

**🟢 LIVE NOW — built + verified in production (use the same `X-API-Key`).**
To match a lead, send **any one** of `lead_id`, `domain`, or `email` (ingest the lead
first if it doesn't exist). Every call also appends an `events` row automatically.
| Endpoint | Body | Feeds |
|---|---|---|
| `POST /intel/fingerprint` | `{ lead_id\|domain\|email, tech_fingerprint{}, pagespeed?{} }` | B1 |
| `POST /intel/reviews` | `{ lead_id\|domain\|email, review_stats{}, complaint_tags[], hook }` | B3 |
| `POST /intel/enrichment` | `{ lead_id\|company_domain\|email, contacts:[{ name, title, email, email_status, linkedin_url, phone }] }` | B2/B4 |
| `POST /events` · `GET /events?lead_id=&type=` | `{ lead_id?, type, payload?, source? }` · type ∈ sourced\|verified\|sent\|bounce\|open\|click\|reply\|unsub\|meeting\|won\|lost\|… | B/D/F, learning loop |
| `POST /mailboxes/health` · `GET /mailboxes` | `{ address, inbox_placement_pct?, bounce_rate?, dnsbl_listings?[], seed_results?{}, daily_cap?, warmup_stage? }` (health score auto-computed; a non-empty `dnsbl_listings` fires an alert) | E |
| `POST /audits` · `GET /audits` | `{ lead_id?, slug, score?, issues?[], quick_wins?[], pdf_url?, page_url? }` (upsert by `slug`) | C |
| `POST /intent` | `{ slug, ip_hash?, ua? }` (increments views; fires `lead.hot` on the 3rd) | C3 |

**🟡 Still to ADD (need `apiKeyAuth` — request from Dessouky when you reach that module):**
| Endpoint | Body | Feeds |
|---|---|---|
| `POST /webhooks/cal` | Cal.com booking passthrough | F |
| `POST /ops/freeze` | `{ reason }` — circuit breaker halts all sends | G |

**📤 CRM → you (outbound webhooks). Subscribe your n8n webhook URL via the CRM webhooks UI.
Live events: `lead.created`, `lead.replied`, `outreach.sent`, and now `lead.hot`.**
| Event | Payload | Status |
|---|---|---|
| `lead.hot` | `{ kind, slug?, views?, lead_id?, address?, listings? }` — audit-intent (3+ views) **or** a mailbox blacklisting | 🟢 LIVE |
| `outreach.send.channel` | `{ contact_id, channel:whatsapp\|linkedin\|call, market, message?, task_hint?, lead }` | 🟡 to add (D) |
| `demo.booked` | `{ contact_id, brief }` | 🟡 to add (F) |

> **One rule:** produces **data** → you `POST` it to the CRM. performs an **action**
> (WhatsApp, PDF, LinkedIn) → the CRM triggers **you** via an outbound webhook.

---

## SECTION A — FOUNDATION (do now, before the 2-week rule kicks in)

> **▶ THIS WEEK — 3 deliverables, IN THIS ORDER. Do nothing from Sections B–G yet.**
> 1. **A3 first** (error backbone) — so everything after it is observable.
> 2. **A1** (kill the sheet) — migrate leads into the CRM.
> 3. **A4** (nightly backup) — the lead DB is now the company asset.
> A2 only if you actually queue inside n8n. Report to Dessouky when all 3 gates pass.

### A3. Error backbone — DO THIS FIRST
- **Outcome:** no workflow can ever fail silently again.
- [ ] Build one reusable **Error Workflow**; attach it to every workflow you own.
- [ ] On failure → WhatsApp alert to ops group with: workflow name, failed node, error
      message, payload sample. Also append a row to your own `n8n_errors` Postgres table.
- **DoD:** force a failure in a throwaway workflow → WhatsApp arrives within 1 min + row logged.

### A1. Kill the Google Sheet
- **Outcome:** every sheet lead lives in the CRM; the sheet is read-only history.
- [ ] Export sheet → CSV.
- [ ] Workflow: CSV → map to `{ name, company, email, phone, source, category, notes }` →
      `POST /outreach/leads/ingest` (20 rows/batch, 1s delay, attach the A3 error handler).
- [ ] Rejects → a `migration-errors` sheet for manual fix + re-run (ingest is idempotent by
      email, so re-running is safe).
- **DoD:** CRM `leads` count = sheet count − rejects; you spot-check 10 rows by hand.

### A4. Nightly backup
- **Outcome:** losing the server never loses the lead database.
- [ ] `pg_dump` the CRM DB nightly → Hetzner storage box, 14-day retention, A3 error handler attached.
- **DoD:** restore last night's dump into a scratch DB and it opens clean.

### A2. Redis namespacing (only if you queue inside n8n)
- **Outcome:** your keys never collide with the CRM's.
- [ ] Confirm Redis reachable from n8n; prefix all your keys `n8n:*`.
- **DoD:** a `n8n:test` key set + read from an n8n Redis node.

---

## SECTION B — MODULE 2: LEAD INTELLIGENCE (after 2-week rule)

> **Outcome:** every A/B lead arrives at the sequencer already researched — tech gaps,
> a verified email, and a review-based hook — with **zero paid credits** on the bulk.
> **Gate to start:** v1 has sent for 2 full weeks. You **fetch**; the CRM stores + scores.
> **Engine: [Scrapling](https://github.com/d4vinci/Scrapling)** (Python) does all the
> actual fetching/parsing in B1–B4 — see B0. Raw n8n HTTP nodes can't render CSR-only
> sites or get past Cloudflare; Scrapling can, and its adaptive selectors survive site
> redesigns (so these workflows don't break every month).

### B0. Stand up the Scrapling scraper service (do before B1–B4)
- [ ] On the VPS, create a small **Python FastAPI microservice** that wraps Scrapling
      (`pip install "scrapling[fetchers]" fastapi uvicorn` → `scrapling install` for browsers).
- [ ] Expose internal endpoints n8n will call (not public; bind localhost / private net):
      `GET /fingerprint?url=`, `GET /reviews?url=`, `GET /contacts?url=`, `GET /page?url=`
      (each returns clean JSON). Use `DynamicFetcher` for JS/CSR sites, `StealthyFetcher`
      for Cloudflare-protected ones, plain `Fetcher` otherwise.
- [ ] Run under pm2/systemd with the Module 8 error handler + a `/health` route.
- [ ] **DoD:** `curl localhost:PORT/fingerprint?url=<a real client site>` returns JSON with
      the tech signals; a known CSR-only site is correctly flagged `csr_only:true`.
- [ ] n8n stays the **orchestrator** (tier logic, dedupe, rate-limit); it calls this
      service, then POSTs to the CRM. The service only scrapes — it never writes to the CRM.

### B1. Tech Fingerprinting (Scrapling)
- [ ] Input: a domain (from a CRM webhook or a poll of A/B-tier leads).
- [ ] Call the scraper service `GET /fingerprint?url=` → chat widget (Tawk/Intercom/WhatsApp
      btn/none), booking (Calendly/custom/none), CMS/framework (WordPress/Wix/custom React +
      **CSR-only** flag via the browser fetcher), analytics (GA4/Meta pixel/none), SSL,
      mobile viewport, Arabic support.
- [ ] Also call **Google PageSpeed Insights API** (free key) for the performance score.
- [ ] `POST /intel/fingerprint` with the assembled `tech_fingerprint` JSON.
- [ ] **DoD:** 100 leads fingerprinted; each stored JSON has ≥6 signals; CSR-only sites
      flagged correctly (this is the audit's headline finding — it must be reliable).

### B2. Waterfall Email Enrichment (the "free Clay")
- [ ] Build a cascade that stops at first **verified** hit:
  1. Email scraped from the site via Scrapling `GET /contacts?url=` (contact/about pages).
  2. Pattern guesses `{first}@`, `{first}.{last}@`, `info@` → **SMTP-verify each** (self-hosted
     verifier; RCPT-TO check, no send — Scrapling scrapes, it does **not** verify deliverability).
  3. Hunter.io free credits — **A-tier only** (25/mo cap; track usage).
  4. Apollo credit — **A-tier GCC/EU with title match only**.
- [ ] Record which source won + verification status.
- [ ] `POST /intel/enrichment` with contacts + `email_status` (verified|risky|invalid).
- [ ] **DoD:** ≥60% of a 100-lead batch get a **verified** email with **zero paid credits**
      (paid sources only for the A-tier remainder).

### B3. Review Mining (Arabic + English)
- [ ] For Maps-sourced leads: pull top ~20 reviews (Scrapling `GET /reviews?url=`, browser
      fetcher for paginated/JS review widgets).
- [ ] Send to Claude (via your AI node) with a fixed prompt → return structured complaint tags
      from a **closed set**: `slow_response, phone_unanswered, booking_chaos, billing_dispute, staff_overload`
      + a 1-line paraphrased icebreaker hook.
- [ ] `POST /intel/reviews` with `review_stats` + `complaint_tags` + the hook.
- [ ] **Acceptance:** 50 Maps leads tagged; tags come only from the closed set; hooks read naturally.

### B4. Decision-Maker Triangulation (GCC/EU companies only)
- [ ] Scrape `/team` + `/about` pages via Scrapling `GET /contacts?url=` → candidate names/titles.
- [ ] Cross-check via **public** search-engine queries for LinkedIn public profiles (no login).
- [ ] Feed the best owner/ops-lead candidate into B2's waterfall.
- [ ] **Acceptance:** for 20 GCC/EU companies, a plausible decision-maker identified for ≥12.

---

## SECTION C — MODULE 3: AUTO-AUDIT + LANDING PAGES + INTENT

> **Outcome:** each A-tier lead gets a personalized audit PDF + a live landing page at
> `audits.seekersai.co/{slug}`, and a 3rd view fires a "call today" alert.
> You own rendering, hosting, and the pixel; the CRM owns the content + hot-lead logic.

### C1. Audit PDF renderer
- [ ] Webhook receives `{ contact, score, issues[], quick_wins[], language, brand }` from the CRM.
- [ ] Render a branded 1-page PDF with the existing docx/Playwright pipeline.
- [ ] Upload to `audits.seekersai.co/{slug}.pdf`.
- [ ] `POST /audits` back with `pdf_url`.
- [ ] **Acceptance:** 10 real audit PDFs generated, on-brand, correct language.

### C2. Dynamic per-lead landing page
- [ ] Generate static HTML per lead (company name in H1, score gauge, Cal.com embed).
- [ ] Push to an Nginx-served folder → `audits.seekersai.co/{slug}`.
- [ ] `POST /audits` with `page_url`.
- [ ] **Acceptance:** 10 pages live, each personalized, Cal.com embed works.

### C3. First-party intent pixel
- [ ] Add a 1×1 pixel (our domain only) to each audit page → on load `POST /intent { slug }`.
- [ ] (The CRM counts views and fires `lead.hot` on the 3rd — you just report the hit.)
- [ ] **Acceptance:** load a page 3× → CRM fires `lead.hot` → WhatsApp alert lands (C wiring below).

---

## SECTION D — MODULE 4: CHANNEL EXECUTION (email stays in the CRM)

> **Outcome:** when the CRM says "WhatsApp this Egypt lead" or "LinkedIn-touch this GCC
> lead," it happens — and the result is logged back so the CRM's one state machine stays
> in sync. You execute non-email channels only; the CRM decides the path and sends all email.

### D1. WhatsApp (WABA) sender
- [ ] Subscribe an n8n webhook to `outreach.send.channel` where `channel="whatsapp"`.
- [ ] Send the approved WABA **template** message to `lead.phone`.
- [ ] `POST /events { contact_id, type:"sent", payload:{ channel:"whatsapp", template } }`.
- [ ] On inbound WhatsApp reply → `POST /outreach/webhooks/reply` (so the CRM pauses the sequence).
- [ ] **Acceptance:** an Egypt lead flows email→WhatsApp→(reply pauses it) end-to-end.

### D2. LinkedIn touch (semi-automatic — human-in-loop)
- [ ] On `channel="linkedin"`: create a **task card** (the CRM already models tasks; it will
      create the card and include a pre-written comment/DM in `task_hint`). Your job is only to
      surface it to Gomaa's daily batch (e.g. a WhatsApp digest at 9am of that day's LinkedIn tasks).
- [ ] After Gomaa acts, mark done → `POST /events { type:"sent", payload:{ channel:"linkedin" } }`.
- [ ] **Acceptance:** LinkedIn tasks appear in the morning digest; marking done logs an event.

### D3. Call task prep
- [ ] On `channel="call"`: the CRM will attach AI talking points. Deliver them to Gomaa
      (WhatsApp) as a call card. Log outcome back via `POST /events`.
- [ ] **Acceptance:** a call card with talking points arrives before the due time.

### D4. Holiday / send-window calendar (data you maintain, CRM consumes)
- [ ] Maintain a shared calendar table (GCC Fri–Sat, Egypt Fri–Sat, EU Sat–Sun, Ramadan
      window shift to 22:00–01:00 for EG/GCC, EU August throttle). Provide it to the CRM
      (a JSON the CRM reads, or a `GET` you host). **The CRM's scheduler checks it before every send.**
- [ ] **Acceptance:** during a blackout window the CRM defers sends (verify with Dessouky).

---

## SECTION E — MODULE 6: DELIVERABILITY OPS (you run the outside checks; CRM stores/scores)

> **Outcome:** we can *prove* ≥80% inbox placement per mailbox and catch a blacklisting or
> auth failure the day it happens — measured, not guessed. You run the external checks and
> `POST /mailboxes/health`; the CRM scores + displays.

### E1. Seed-list inbox-placement test (weekly)
- [ ] Each mailbox emails a seed list (our own Gmail/Outlook/Yahoo accounts).
- [ ] n8n checks via IMAP which folder each landed in → compute inbox-placement %.
- [ ] `POST /mailboxes/health { address, inbox_placement_pct, seed_results }`.
- [ ] **Acceptance:** weekly run posts a placement % per box; ≥80% target visible on CRM dashboard.

### E2. Blacklist (DNSBL) monitor (daily)
- [ ] Free DNS queries against major DNSBLs for each sending domain + IP.
- [ ] `POST /mailboxes/health { address, dnsbl_listings }`; WhatsApp alert on any new listing.
- [ ] **Acceptance:** a known-listed test IP triggers an alert.

### E3. DMARC aggregate report ingestion (weekly)
- [ ] Parse aggregate DMARC XML from the reporting mailbox → surface auth/spoofing failures.
- [ ] `POST /events type="dmarc"` summary (or a dedicated endpoint if Dessouky adds one).
- [ ] **Acceptance:** one week of reports parsed; failures listed.

### E4. Bounce processing
- [ ] On hard bounce → `POST /outreach/webhooks/reply`-style bounce (Dessouky to confirm the
      bounce endpoint) so the CRM invalidates the contact; if `{first}.{last}@` bounces across a
      domain, record the pattern as bad so B2 stops guessing it there.
- [ ] **Acceptance:** a hard bounce marks the contact invalid in the CRM.

### E5. Mailbox provisioning + warm-up SOP
- [ ] Document the SOP: spin a new box, 14-day warm-up, hot-swap when health is unrecoverable.
- [ ] **Acceptance:** SOP written; one spare box warmed and ready.

---

## SECTION F — MODULE 7: MEETING INTELLIGENCE (rendering + delivery only)

> **Outcome:** every booked demo lands a 1-page prep brief in the WhatsApp group 12h
> before the call, and every outcome (won/lost + reason) is logged. You forward the
> booking, render + deliver the brief, and capture the outcome; the CRM writes the content.

- [ ] Forward the **Cal.com** booking webhook → `POST /webhooks/cal` (CRM assembles the brief data
      + AI-writes it).
- [ ] On `demo.booked` webhook from the CRM (brief content attached): render the 1-page **demo brief**
      PDF + calendar attachment → deliver to the WhatsApp group **12h before** the call.
- [ ] Post-call: a WhatsApp voice-note bot → transcribe → `POST /events type="won"|"lost"` + reason.
- [ ] **Acceptance:** a real booking produces a brief in the group before the call; an outcome
      voice-note logs a won/lost event.

---

## SECTION G — MODULE 8: RELIABILITY (infra you own end-to-end)

> **Outcome:** the machine runs unattended — retries transient failures, freezes itself on
> danger (bounce spike / quota), and shouts on WhatsApp the moment it stalls.

- [ ] **Dead-letter queue:** failed sends/API calls → `n8n:queue:retry` (Redis) with exponential
      backoff (3 attempts) → then a `dead_letter` table for manual review.
- [ ] **Circuit breakers:** Google API quota near limit → pause sourcing; bounce spike >5%/hour →
      tell the CRM to freeze sends (call a CRM `POST /ops/freeze`, Dessouky to add) + alert.
- [ ] **Heartbeat:** if a workflow that should run hourly processes 0 items for 6 business hours →
      "machine is down" alert.
- [ ] (Error workflow + backups already done in Section A.)

---

## SECRETS / ACCOUNTS TO GATHER (store all in n8n credentials, never in workflow JSON)

- [ ] `AUTOMATION_API_KEY` (from Dessouky) — the CRM API key.
- [ ] Firecrawl API key (already have).
- [ ] Google PageSpeed Insights API key (free).
- [ ] Hunter.io account (free tier).
- [ ] Apollo access (MCP/API) — A-tier only.
- [ ] WhatsApp Business API (WABA) credentials + approved templates.
- [ ] Cal.com webhook signing secret.
- [ ] Seed-list mailbox IMAP credentials (Gmail/Outlook/Yahoo test accounts).
- [ ] Hetzner storage box credentials (for `pg_dump`).
- [ ] The ops WhatsApp group/bot endpoint for alerts.

---

## BUILD ORDER (maps to NEWPLAN weeks 5–9)

| Week | You build | Acceptance gate |
|---|---|---|
| **Now** | Section A (kill sheet, error backbone, backups) | Sheet migrated; forced-failure alerts; restore test passes |
| 5 | Wire outbound webhooks with the CRM; Module 8 DLQ + circuit breakers | Double-run a send workflow → no double-send (idempotency proven) |
| 6 | Module 2 (B1–B4) | 100 leads enriched; ≥60% verified email, no paid credits |
| 7 | Module 3 (C1–C3) | 10 audit pages live; `lead.hot` fires on 3rd view |
| 8 | Module 4 (D1–D4) + Module 6 (E1–E5) | Egypt lead email→WhatsApp→call end-to-end; seed test ≥80% inbox |
| 9 | Module 7 (F) | First demo brief auto-delivered before a real call |

**Gate:** don't start Week 6 until v1.0 has sent for 2 full weeks.

---

## WHAT YOU DO **NOT** BUILD (owned by the CRM — don't duplicate)

- ❌ NocoDB / any admin grid — the CRM is the admin UI.
- ❌ A second sequencer / send scheduler — the CRM schedules and sends email.
- ❌ ICP scoring, A/B winner math, objection library, ICP recalibration — CRM (data + AI).
- ❌ Storing leads/contacts/events as the source of truth — you POST, the CRM stores.
- ❌ Hot-lead threshold logic — you report pixel hits; the CRM decides "hot".

If something isn't clearly "reach the outside world" or "render/deliver," it's probably the
CRM's job — ask Dessouky before building it.
