# Seekers CRM × n8n — Setup Guide

This guide gets you from zero to **automated outreach with reply detection** in about 15 minutes.

## What this workflow does

```
Lead sources ─► n8n webhook ─► Map fields ─► POST /outreach/leads/ingest ─► CRM
                                                                              │
                                                                              ▼
                                                                    Auto-enrolled in
                                                                    matching sequence
                                                                              │
                                                                              ▼
                                                            AI agent writes per-lead email
                                                            Brevo SMTP sends it
                                                                              │
Inbox ─► n8n IMAP (every 5 min) ─► Filter "Re:" ─► POST /outreach/webhooks/reply ─► Pauses sequence
                                                                                   + Moves stage
                                                                                   + Logs activity
```

Two pieces in one workflow:
1. **Lead Ingestion** — public webhook URL you give to Apollo / Instantly / Make / a Google Form / a scraper / curl. Posts a lead → CRM creates/dedupes it → if a matching active "auto-enroll" sequence exists, the lead is enrolled and the scheduler sends the first email at the configured day offset.
2. **Reply Detection** — IMAP trigger polls your sales inbox every 5 min for unread emails whose subject starts with `Re:` or `Fwd:`. Hits the CRM reply webhook → pauses all active enrollments for that lead and moves the stage to `contacted`.

---

## Prerequisites

- n8n running (self-hosted or cloud account — version 1.0+)
- Your Seekers CRM AUTOMATION_API_KEY (we generated one for you, in the IngestDocs tab and in the deploy logs)
- An email account with IMAP enabled (Gmail: enable IMAP in Settings → See all settings → Forwarding and POP/IMAP; Outlook: enabled by default)

---

## Step 1 — Add two credentials in n8n

In n8n, go to **Credentials → New**.

### Credential A: Seekers CRM API Key

| Field | Value |
|---|---|
| Credential Type | **Header Auth** |
| Name | `Seekers CRM API Key` *(exact name matters — workflow looks it up by name)* |
| Header Name | `X-API-Key` |
| Header Value | `<your AUTOMATION_API_KEY>` (e.g. `1e45849503f7445ab294ab5147cdec9d60a196d313719f7ce9794e53cd2dede7`) |

### Credential B: Outreach Email IMAP

| Field | Namecheap PE (recommended) | Gmail | Outlook |
|---|---|---|---|
| Credential Type | **IMAP** | **IMAP** | **IMAP** |
| Name | `Outreach Email IMAP` *(exact name matters)* | `Outreach Email IMAP` | `Outreach Email IMAP` |
| User | team@seekersai.org | your-email@gmail.com | your-email@outlook.com |
| Password | your PE mailbox password | **App Password** (see below) | your password |
| Host | `mail.privateemail.com` | `imap.gmail.com` | `outlook.office365.com` |
| Port | `993` | `993` | `993` |
| SSL/TLS | enabled | enabled | enabled |

**Gmail app password:** Google Account → Security → 2-Step Verification (must be on) → App passwords → generate one for "Mail". Use that 16-char string here.

**Namecheap PE:** Just use your normal mailbox password from when you created the email account. No app password needed.

---

## Step 2 — Set the API base as an n8n environment variable

The workflow references `$env.SEEKERS_API_BASE` so you don't have to hardcode the URL in two places.

**Self-hosted n8n:** edit your `.env` (or `docker-compose.yml`) and add:
```bash
SEEKERS_API_BASE=https://agency.seekersai.org/api/v1
```
Restart n8n.

**n8n Cloud:** Settings → Variables → add `SEEKERS_API_BASE` = `https://agency.seekersai.org/api/v1`.

---

## Step 3 — Import the workflow

1. Download [`seekers-crm-automation.json`](./seekers-crm-automation.json) (the link is in your CRM under **Outreach → Setup & Ingestion**).
2. In n8n → top-right menu → **Import from File** → pick the downloaded JSON.
3. The workflow appears with two trigger nodes:
   - **Webhook: New Lead** (top branch)
   - **IMAP: Check for Replies** (bottom branch)

If credentials show a red warning, click each HTTP Request / IMAP node and re-select the credential you created in Step 1 (n8n matches by name but sometimes the link is empty after import).

---

## Step 4 — Activate the workflow

Toggle **Active** in the top-right. n8n will:
- Reserve a public webhook URL (visible by clicking the "Webhook: New Lead" node → click the URL to copy it)
- Start the 5-minute IMAP polling

Your webhook URL will look like:
```
https://your-n8n-host/webhook/seekers-lead-ingest
```

---

## Step 5 — Send your first lead

Test the ingestion from your local terminal:
```bash
curl -X POST https://your-n8n-host/webhook/seekers-lead-ingest \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Lead",
    "company": "Acme SaaS",
    "email": "test@acme.com",
    "category": "SaaS",
    "source": "manual-test"
  }'
```

Expected response: `{ "ok": true, "lead": { "id": "...", "created": true, "deduped": false } }`.

Open your CRM → **CRM** page → you'll see "Test Lead — Acme SaaS" with source `manual-test` and category `SaaS`. ✅

---

## Step 6 — Wire your real lead sources

### A. Apollo (Lists with webhook export) — recommended

**Apollo has a dedicated workflow with cleaner field mapping.** Download it from your CRM:
- [`seekers-apollo-workflow.json`](./seekers-apollo-workflow.json) — Apollo-specific fields (`first_name`, `last_name`, `organization_name`, `industry`, `title`, `linkedin_url`)
- Imports the same way as the main workflow
- Creates a separate webhook path so you can keep both running side-by-side

**Apollo setup:**
1. In Apollo, build a saved search (e.g., "Founders, SaaS, 10-200 employees, Egypt + UAE + Germany")
2. Save it as a **Sequence** (Apollo's term for a campaign — you don't have to enroll them in Apollo's email steps; just use it as a webhook trigger)
3. Sequence → Settings → **Webhooks** → "New webhook"
4. Method: POST · URL: your n8n webhook URL from this Apollo workflow
5. Trigger: "Contact enrolled in sequence"
6. Save → enroll contacts → they flow into Seekers CRM

**What lands in your CRM:**
- `name` = first_name + last_name
- `company` = organization_name
- `email` = email
- `category` = industry (used for auto-enrollment in matching sequences)
- `source` = "apollo"
- `notes` = title + seniority + employee count + location + LinkedIn URL (gold for sales context)
- contacts without an email are auto-skipped (returns 422 to Apollo)

### B. Snov.io — recommended free supplement (50 credits/mo)

Download [`seekers-snov-workflow.json`](./seekers-snov-workflow.json). Same import flow as Apollo. Snov.io has webhook support on the free tier.

1. Snov.io → **Account Settings → Webhooks** → New webhook
2. URL: your n8n Snov webhook URL (visible after import)
3. Trigger: "New contact added to list" or "New contact in drip campaign"
4. Save → start adding contacts → they flow into Seekers CRM

### C. Apify — Google Maps scraper (best for MENA local businesses)

Download [`seekers-apify-google-maps.json`](./seekers-apify-google-maps.json). This one is **scheduled** rather than webhook-triggered — runs every Monday 9am by default.

1. Sign up at https://apify.com (free $5 starter credit)
2. Generate an API token: Settings → Integrations → Personal API tokens
3. In n8n, create a credential called `Apify API Token` (Header Auth, header `Authorization`, value `Bearer YOUR_TOKEN`)
4. Import the workflow → edit the **Run Apify Actor** node → change `searchStringsArray` to your niche+location, e.g.:
   - `"marketing agencies Cairo Egypt"`
   - `"dental clinics Dubai UAE"`
   - `"SaaS startups Berlin Germany"`
5. Set `maxCrawledPlacesPerSearch` to control cost (~$0.001 per result)
6. Activate → results auto-flow into your CRM weekly

### D. RB2B — anonymous website visitor identification (truly free)

Download [`seekers-rb2b-workflow.json`](./seekers-rb2b-workflow.json). RB2B identifies anonymous visitors on your site and pushes them to a webhook.

1. Sign up at https://rb2b.com (free plan, no credit card)
2. Install their snippet on `seekersai.org` (one `<script>` tag in `<head>`)
3. In RB2B → **Settings → Integrations → Webhook** → paste your n8n RB2B webhook URL
4. Visitors who match B2B databases get sent through. They're tagged `source: rb2b-inbound` in the CRM so you can prioritize warm traffic over cold outbound.

### E. Manual CSV bulk import — for one-shot lists

For scraped CSVs, conference attendee lists, partner intros, etc.: go to **CRM → Outreach → Setup & Ingestion** → scroll down to the **Import Leads from CSV** panel. Drag a CSV in, the UI auto-detects columns, you confirm the mapping, hit Import. Idempotent — re-uploading the same list won't create duplicates.

### F. Instantly / Lemlist / SalesQL / Hunter
Same approach as the others — set your tool's webhook URL to the **Main workflow's** n8n endpoint. The `Map Fields` node has fallbacks for the common field names.

### C. Google Sheet (cold lists)
- Build a separate n8n workflow: **Google Sheets trigger → Map Fields → HTTP Request to /outreach/leads/ingest** (you can copy nodes from our workflow).

### D. Manual paste / CSV
Use the curl command above, or build a small form in n8n with a webhook trigger.

---

## Step 7 — Build an AI-powered sequence in the CRM

This is the magic part. Go to your CRM → **Outreach → Sequences → New Sequence**.

**Example: "Cold AI Outreach — SaaS"**

| Step | Day | Channel | Subject template | Body | Agent |
|---|---|---|---|---|---|
| 1 | 0 | email | *(leave blank — agent provides it)* | *(leave blank)* | **sales-outreach** |
| 2 | 3 | email | Quick follow-up — {{company}} | *(leave blank)* | **sales-outreach** |
| 3 | 7 | email | Last note — {{company}} | *(leave blank)* | **sales-outreach** |

- **Active:** ON
- **Auto-enroll category:** ON (with category = "SaaS")

When you save:
- Any new lead ingested with `"category": "SaaS"` auto-enrolls in this sequence.
- The first email goes out within ~5 min (the scheduler tick interval).
- The `sales-outreach` AI agent **writes a completely unique email for each lead** based on their name, company, niche, source, and recent activity. It produces both the subject and body — fully personalized, not a template.
- Days 3 and 7 send follow-ups, also AI-written.
- If the lead replies any time, IMAP catches it → sequence pauses → you get the lead handed back to a human.

---

## How AI-per-lead emails work (under the hood)

When a step has an `agent_id` set:
1. Scheduler picks up the due enrollment.
2. Loads the lead's full record (name, company, category, source, deal value, notes, last 10 activities).
3. Calls OpenRouter with the `sales-outreach` agent prompt, sending the lead context.
4. The agent returns:
   ```
   Subject: <unique subject for this lead>

   <unique 4-6 sentence body referencing their niche + a concrete value prop + soft CTA>

   — The Seekers team
   ```
5. Parsed subject + body sent via Brevo SMTP.
6. Logged to `outreach_sends` + lead activity timeline (so you can see exactly what was sent to whom).

**Cost per email:** ~$0.0005 (gemini-2.0-flash-001) — basically free. 1000 leads/month ≈ $0.50.

---

## Step 8 — Watch it run

In your CRM:
- **Outreach → Live Enrollments**: see which leads are currently in which sequence and when their next email goes out.
- **Outreach → Analytics**: reply rate, sends per day, per-sequence performance.
- **Lead detail sheet**: each lead shows their active enrollments + the AI-generated emails appear in their activity timeline.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| n8n shows `Cannot read credential` for the API key | Credential name must be **exactly** `Seekers CRM API Key`. Re-select it on each HTTP node. |
| IMAP node fails to connect | For Gmail, you must use an **App Password**, not your normal password. 2-Step Verification must be on. |
| Webhook returns 401 from CRM | The API key is wrong or has typos. Check the value in the credential matches `AUTOMATION_API_KEY` on the VPS exactly. |
| Lead created but no email sent | Make sure a sequence with the matching `category` is **Active** AND has **Auto-enroll category** turned on. Or enroll the lead manually from the lead detail page. |
| Email sent but reply not detected | (a) Check the inbox you set in IMAP is actually receiving the replies — Brevo "from" defaults to `Team@seekersai.org`, so the inbox needs to receive mail to that address. (b) Make sure the workflow is **Active**. (c) Check the IMAP polling has run at least once — wait 5 min after the first reply. |
| Replies are coming to a different inbox | Either set `replyTo` in `services/email.ts` to your sales inbox, or use Brevo's "Reply-To" override (set per-campaign in Brevo). |

---

## Reference: API endpoints

| Method | URL | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/outreach/leads/ingest` | X-API-Key | Push a lead in |
| POST | `/api/v1/outreach/webhooks/reply` | X-API-Key | Notify of a reply |
| POST | `/api/v1/outreach/scheduler/tick` | JWT (admin) | Force a scheduler tick — for debugging |
| GET  | `/api/v1/outreach/sequences` | JWT | List sequences |
| GET  | `/api/v1/outreach/enrollments` | JWT | List enrollments |
| GET  | `/api/v1/outreach/analytics` | JWT | Pull the analytics dashboard data |

---

## Next steps after this works

- Add open-rate tracking (Brevo built-in, or a 1x1 pixel)
- Add per-rep email signatures via lead.assigneeId → reps.signature
- Add a "Reschedule next send" button on each enrollment
- Connect n8n to Slack so reps get pinged in real-time when a lead replies
