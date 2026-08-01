# SEEKERS AI — OUTBOUND MACHINE v2.0: ADVANCED MODULES
### Extends the v1.0 build plan. Owner: Gomaa | Architecture review: Dessouky
**Philosophy shift:** v1.0 is a sender. v2.0 is an *intelligence system* that researches every lead like a human SDR with 2 hours per prospect — compressed into 90 seconds of compute — and gets smarter every week from its own results.

---

## MODULE 1 — PRODUCTION DATA ARCHITECTURE (kill the Google Sheet)

Sheets breaks past ~5k leads and can't do relational logic. We already run PostgreSQL + Redis — use them.

**PostgreSQL schema (Dessouky reviews, Gomaa implements):**

```sql
companies      (id, domain UNIQUE, name, market, niche, city, country, size_est,
                tech_fingerprint JSONB, review_stats JSONB, signals JSONB,
                icp_score, status, created_at)
contacts       (id, company_id FK, email, email_status, name, title, language,
                linkedin_url, phone, timezone, do_not_contact BOOL)
sequences      (id, contact_id FK, template_set, current_step, next_send_at,
                mailbox_id, state ENUM[queued|active|paused|replied|finished|suppressed])
events         (id, contact_id FK, type ENUM[sourced|verified|sent|bounce|open|click|
                reply|unsub|meeting|won|lost], payload JSONB, created_at)   -- append-only
mailboxes      (id, address, daily_cap, health_score, warmup_stage, sent_today)
experiments    (id, hypothesis, variant_a, variant_b, metric, status, winner)
suppression    (email/domain, reason, added_at)
```

**Redis usage:**
- `queue:send` — sorted set scored by `next_send_at` (the sequencer pops from here; no more cron-scanning a sheet)
- `ratelimit:mailbox:{id}` — daily counters with TTL
- `dedupe:domain` — bloom-filter-style fast dedupe before hitting Postgres

**UI:** NocoDB (self-hosted, free) on top of Postgres = instant admin panel for Gomaa. Later this becomes a native Agency OS module — the schema above is designed to port directly.

**Why this matters:** the `events` table is append-only and becomes the training data for Module 5 (the learning loop). Sheets can never do that.

---

## MODULE 2 — LEAD INTELLIGENCE LAYER ("the 90-second SDR")

Between sourcing and scoring, every A/B-tier lead passes through a research pipeline:

### 2.1 Tech Fingerprinting (free, pure n8n)
Fetch the lead's site → Code node inspects HTML + headers → detect:
- Chat widget present? (Tawk, Intercom, WhatsApp button, none)
- Booking system? (Calendly, custom, none)
- CMS/framework (WordPress, Wix, custom React — and **CSR-only rendering**, our signature audit finding)
- Pixel/analytics maturity (GA4, Meta pixel, none)
- Page speed via Google PageSpeed Insights API (free)
- SSL, mobile viewport, Arabic language support

Output → `tech_fingerprint JSONB`. **Every gap is a talking point.** "No WhatsApp button + 4.6 stars + 200 reviews" writes its own email.

### 2.2 Waterfall Enrichment (Clay-style, but free)
Email discovery cascades through sources cheapest-first, stopping at first verified hit:
```
1. Scraped from website (free)
2. Pattern guess: {first}@, {first}.{last}@, info@ → SMTP-verify each (free, self-hosted)
3. Hunter.io free credits (25/mo — only for A-tier)
4. Apollo credit (only for A-tier GCC/EU with title match)
```
This is exactly what Clay charges $149+/mo for. We rebuild it in one n8n workflow.

### 2.3 Review Mining (Arabic + English)
For Maps-sourced leads: pull top 20 reviews → Claude extracts complaint themes into structured tags: `slow_response`, `phone_unanswered`, `booking_chaos`, `billing_dispute`, `staff_overload`. Tags drive template selection AND appear verbatim (paraphrased) in the icebreaker: *"Noticed a few of your reviewers mention waiting days for a reply on WhatsApp…"* — this line alone will outperform everything else we write.

### 2.4 Decision-Maker Triangulation (GCC/EU)
For companies (not shops): scrape the site's /team + /about pages, cross-check LinkedIn public pages via search-engine queries in n8n (no LinkedIn API, no scraping login-walls — public data only) → identify the likely owner/ops lead → feed to waterfall enrichment.

---

## MODULE 3 — PERSONALIZED AUDIT LEAD MAGNET (our unfair advantage)

This is the module competitors can't copy, because it productizes our proven audit methodology (Hydro 38/100, Backyard CSR findings).

**Workflow: "Auto-Auditor"**
```
[A-tier lead enters sequence]
  → [Compile tech_fingerprint + PageSpeed + review mining + a branded-search check]
  → [Claude generates a 1-page mini-audit: score /100, top 3 issues, top 3 quick wins,
     in the lead's language, in Seekers brand voice]
  → [Render to branded PDF (Node docx/Playwright pipeline we already use)]
  → [Upload to sending domain: audits.seekersai.co/{slug}]
  → [Email 2 of the sequence links THE LEAD'S OWN AUDIT instead of a generic Loom]
```

**Dynamic landing page per lead:** the audit lives on a personalized page — their company name in the H1, their score as a gauge, a Cal.com embed below. Static HTML generated per lead by n8n, pushed to a folder Nginx serves. Zero hosting cost, maximum "how did they make this for *us*?" effect.

**Intent tracking:** a first-party pixel on audit pages only (our domain, our data — not EU-problematic like email pixels). Page view → event logged → **lead who opened their audit 3+ times gets a WhatsApp alert to Gomaa: "hot — call them today."** Optionally cross-reference with the Apollo website visitor domain tracker already on seekersai.org to catch leads who later browse our main site.

---

## MODULE 4 — MULTI-CHANNEL ORCHESTRATION (email is only the spine)

Sequence becomes a state machine across channels, chosen per market:

| Step | Egypt | GCC | Europe |
|---|---|---|---|
| 1 | Email (icebreaker) | Email | Email |
| 2 | **WhatsApp template msg** (we run WABA already) referencing email | Email (audit link) | Email (audit link) |
| 3 | Email (audit link) | **LinkedIn touch** (semi-auto: n8n creates a task card with pre-written comment/DM; Gomaa executes in 10 min/day batch) | Email (case study) |
| 4 | **Call task** for Gomaa with AI-prepped talking points | Email (case study) | Email (breakup) |
| 5 | Email (breakup) | Email (breakup) | — (strict volume discipline) |

Rules engine in n8n decides the path from `market + tier + signals`. Egypt leads convert on WhatsApp/phone, not inboxes — the machine respects that instead of pretending everyone reads email.

**Ramadan/holiday awareness:** a calendar table (GCC weekends Fri–Sat vs Egypt Fri–Sat vs EU Sat–Sun, Ramadan send-window shift to 10pm–1am for EG/GCC, EU summer holidays in August → auto-throttle). The sequencer checks it before every send. Small detail, massive reply-rate difference, and nobody else in our market does it.

---

## MODULE 5 — THE LEARNING LOOP (the machine improves itself)

### 5.1 A/B Experiment Engine
- `experiments` table holds live tests: subject lines, icebreaker styles, CTA phrasing, send hours, audit-vs-loom in step 2.
- Sequencer assigns variants 50/50 per new lead; `events` records outcomes.
- Weekly cron: compute reply-rate per variant; declare winner only at n ≥ 100 sends per arm AND a meaningful gap (guardrail vs. noise); loser retired; **Claude reads the winner + all reply text from the week and proposes 2 new challenger variants** → pushed to Gomaa for 1-click approval.
- Result: copy evolves every single week from real data, forever.

### 5.2 ICP Score Recalibration
Monthly job: Claude analyzes `events` joined with `companies` — which niches/cities/signals/sizes actually replied and booked? → Outputs updated scoring weights + a plain-language memo ("Dubai dental clinics reply 4×; Egyptian real estate is dead — reallocate the sourcing queue"). The sourcing queue tab reorders itself accordingly. **The machine hunts where the fish are, automatically.**

### 5.3 Objection Library
Every NOT_NOW / negative reply → Claude extracts the objection → appended to a living library → future drafts pre-empt the top 3 objections per market. Compounds monthly.

---

## MODULE 6 — DELIVERABILITY OPS (run it like infrastructure)

- **Mailbox health score** (0–100) per box, recomputed nightly: bounce rate, spam-folder seed-test results, reply rate, age, volume. Score < 70 → auto-halve that box's cap; < 50 → pull from rotation into warm-up-only mode. Rotation weight ∝ health.
- **Seed-list placement testing:** weekly, each box emails a seed list of our own accounts on Gmail/Outlook/Yahoo → n8n checks via IMAP which folder it landed in → inbox-placement % on the dashboard.
- **Blacklist monitor:** daily MXToolbox-style DNSBL checks (free DNS queries from n8n) on domain + IP → WhatsApp alert on any listing.
- **DMARC report ingestion:** aggregate reports parsed weekly → spoofing/auth failures surfaced.
- **Auto bounce processing:** hard bounce → contact invalidated + pattern fed back (if `{first}.{last}@` bounces across a domain, stop guessing that pattern there).
- **Mailbox regeneration playbook:** documented SOP — when a box's health is unrecoverable, spin a replacement, warm 14 days, hot-swap. Boxes are cattle, not pets.

---

## MODULE 7 — MEETING INTELLIGENCE (close the loop to revenue)

When a demo is booked (Cal.com webhook):
```
→ [Pull everything: audit, reviews, tech gaps, email thread, objections, LinkedIn notes]
→ [Claude writes a 1-page DEMO BRIEF: who they are, their pain evidence, which of our
   case studies to lead with (Rajac for clinics, Backyard for hospitality, Genesis/AcademiX
   for schools), pricing tier to anchor, predicted objections + answers]
→ [PDF to WhatsApp group 12h before the call + calendar attachment]
→ [After call: Dessouky/Gomaa voice-note the outcome to a WhatsApp bot → transcribed →
   logged to events as won/lost + reason → feeds Module 5]
```
Every demo starts over-prepared; every outcome makes the machine smarter.

---

## MODULE 8 — RELIABILITY & SELF-HEALING (this must run unattended)

- **Error workflow** attached to every workflow: failure → structured log to Postgres + WhatsApp alert with workflow name, node, payload sample.
- **Dead-letter queue:** failed sends/API calls → `queue:retry` in Redis with exponential backoff (3 attempts) → then dead-letter table for manual review.
- **Idempotency:** every send keyed by `(contact_id, step)` — a re-run can never double-email anyone.
- **Circuit breakers:** Google API quota near limit → sourcing pauses itself; bounce spike > 5% in any hour → global send freeze + alert.
- **Heartbeat:** if the sequencer processes zero items for 6 business hours → "the machine is down" alert.
- **Nightly `pg_dump`** to Hetzner storage box. The lead database becomes a real company asset — treat it like one.

---

## UPDATED BUILD SCHEDULE (weeks 5–9, after v1.0 core is live)

| Week | Module | Acceptance test |
|---|---|---|
| 5 | Module 1 (Postgres/Redis/NocoDB migration) + Module 8 basics | v1 workflows run against DB; kill the sheet; forced-failure test alerts correctly |
| 6 | Module 2 (fingerprinting, waterfall, review mining) | 100 leads fully enriched; waterfall finds verified email for ≥ 60% |
| 7 | Module 3 (auto-audits + landing pages + intent pixel) | 10 real audit pages live; hot-lead alert fires on 3rd view |
| 8 | Module 4 (multi-channel state machine + holiday calendar) + Module 6 | Egypt lead flows email→WhatsApp→call-task end-to-end; seed test shows ≥ 80% inbox |
| 9 | Modules 5 + 7 (experiments, recalibration, demo briefs) | First A/B live; first demo brief auto-delivered before a real call |

**Sequencing rule: do NOT start Module 2+ until v1.0 has sent for 2 full weeks.** Data from the simple version tells us where complexity pays. Complexity before volume is procrastination in disguise.

---

## v2.0 KPI DELTAS (vs v1.0 targets)

| Metric | v1.0 | v2.0 target |
|---|---|---|
| Reply rate | 3–5% | **6–9%** (signals + audits + multi-channel) |
| Waterfall email-find rate | — | ≥ 60% without paid credits |
| Inbox placement (seed test) | unknown | ≥ 80% measured |
| Demos/month | 5–8 | **10–15** |
| Audit-page hot leads (3+ views) | — | 15+/month |
| Human hours/week to operate | ~5 | **≤ 3** (batch LinkedIn + reply approvals + call tasks) |
| New subscription cost | $15–25/mo | unchanged — every module above is self-hosted/free-tier |