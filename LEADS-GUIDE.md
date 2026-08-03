# Leads Guide — getting leads into the Seekers AI CRM

A short, practical guide for the team: how to get leads, how to get them into
the CRM, and how to work them through to a client. No engineering background
required.

---

## 1. The fastest way to add ONE lead

Tap the **round + button** at the bottom of the screen (phone) or the **New**
button on the Leads page (desktop) → **Lead**. Type a name, optionally a
company (it defaults to the name if you skip it), optionally a phone number.
Tap **Add**. Three taps, done.

Use this for: a lead from a phone call, a walk-in, a DM, anything you're
capturing live.

---

## 2. Getting a LIST of leads (where leads come from)

You rarely add leads one at a time when working a niche. These are the ways
a list gets built:

| Source | What it is | Where |
|---|---|---|
| **Google Maps scraper** | Apify pulls every business matching a niche + location (e.g. "dentists in Cairo"). ~$5 for ~5,000 leads. Tags leads with source `google-maps`. | Outreach → Setup & Ingestion → download `seekers-apify-google-maps.json`, import into n8n |
| **LinkedIn employees** | Give it company LinkedIn URLs, get every employee back with title + profile. | `seekers-apify-linkedin-employees.json` |
| **Apollo / Snov.io** | Native webhook from your Apollo sequence or Snov.io export. | `seekers-apollo-workflow.json`, `seekers-snov-workflow.json` |
| **Firecrawl search** | Web search + AI extraction — good for niche directories or blog roundups nothing else covers. | `seekers-firecrawl-search.json` |
| **RB2B** | Identifies anonymous website visitors as inbound leads. | `seekers-rb2b-workflow.json` |
| **A spreadsheet someone already has** | Exported from anywhere, or just typed up by hand. | Paste or CSV — see below, no n8n needed |

All the n8n workflow files live in **Outreach → Setup & Ingestion**, each
with a one-line description and a **Download .json** button. Import the
`.json` into n8n, point it at your Apify/Apollo/Snov.io account, and it POSTs
straight into the CRM. Full setup steps: **Outreach → Setup & Ingestion →
Full setup guide**.

**You don't need any of this to get a list in today.** If you already have
one — from a scrape, an export, or a spreadsheet a client sent you — skip
straight to section 3.

---

## 3. Importing a list — paste, CSV, or API

Go to **Outreach → Setup & Ingestion**, scroll to **Import Leads**.

### Paste (fastest — recommended)

1. In Google Sheets or Excel, select the range you want (include the header
   row) and copy (**Ctrl/Cmd+C**).
2. In the CRM, make sure the **Paste** tab is selected, click into the box,
   and paste (**Ctrl/Cmd+V**).
3. Click **Preview import**.

Tabs, commas, and semicolons are all detected automatically — paste exactly
what you copied, no reformatting needed.

### CSV file

1. Switch to the **CSV file** tab.
2. Drop a `.csv` file onto the box, or click it to browse. Works from Apollo,
   Sales Navigator, Snov.io, ZoomInfo exports, or anything else that exports
   CSV.

### Either way — map columns, then import

Once rows are loaded you'll see a **column mapping** step: each column from
your sheet on the left, a dropdown on the right to say what it is (Name,
Company, Email, Phone, Source, Category/Niche, Deal value, Notes, or *Skip
column*). Common header names (`email`, `phone_number`, `full name`,
`company_name`, etc.) are auto-detected — you're just confirming or fixing.

Below the mapping you'll see a **preview** of the first few rows exactly as
they'll be saved, and an **"If a lead already exists"** control:

- **Update missing fields** (default) — fills in anything blank on the
  existing lead (phone, source, category); never overwrites what's already
  there.
- **Skip it** — leaves the existing lead completely untouched.

Click **Import N leads**. You'll get a result screen: **Created / Updated /
Skipped / Errors**, with a reason for every failed row if there are any.

### API (for n8n or your own scripts)

```bash
curl -X POST https://<your-api-host>/api/v1/outreach/leads/ingest \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <your AUTOMATION_API_KEY>" \
  -d '{
    "name": "Jane Doe",
    "company": "Acme Corp",
    "email": "jane@acme.com",
    "phone": "+1 555-555-1234",
    "source": "apollo",
    "category": "SaaS",
    "deal_value": 5000,
    "notes": "Reached out via LinkedIn first"
  }'
```

Response: `{ "id": "uuid", "created": true, "deduped": false }`

Only `name`, `company`, `email`, or `phone` — you need at least ONE of them,
the rest are optional. `AUTOMATION_API_KEY` is set on the server (ask an
admin). This is the endpoint every n8n workflow above already uses.

For pushing many leads at once from your own script (not n8n — that's what
paste/CSV are for in the app), there's also `POST
/outreach/leads/ingest-bulk` (requires being logged in as an admin, JWT
`Authorization: Bearer` token, max 500 leads per call):

```bash
curl -X POST https://<your-api-host>/api/v1/outreach/leads/ingest-bulk \
  -H "Authorization: Bearer <your JWT access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "update",
    "leads": [
      { "name": "Jane Doe", "company": "Acme Corp", "email": "jane@acme.com" },
      { "name": "Bob Lee",  "company": "Widgets Co", "phone": "+201001234567" }
    ]
  }'
```

Response: `{ "total": 2, "created": 2, "updated": 0, "skipped": 0, "errors": 0, "created_ids": [...], "error_rows": [] }`

`mode` is `"update"` (default) or `"skip"` — same meaning as the dropdown in
the UI.

---

## 4. How duplicates are handled (dedup)

**You cannot create duplicates by importing the same list twice.** This is
the part that's guaranteed to work, and here's exactly how:

1. **Match key: email first.** If a row has an email, it's matched
   case-insensitively (`jane@acme.com` = `Jane@ACME.com`) against every
   existing lead's email.
2. **No email? Match on name + company** (exact match) instead.
3. **A row repeating an earlier row in the SAME paste/file** (you pasted the
   same lead twice, or your export has a duplicate row) is caught too — it
   only ever creates or updates the lead once, and the repeat is counted as
   *skipped*.
4. Whatever isn't matched is a **new** lead — created and counted as
   *Created*.

So importing the exact same spreadsheet a second time always produces
`Created: 0` — everything either **Updates** (fills in blanks) or **Skips**
(if you chose "Skip it" mode), never duplicates. Every write path — the
single API endpoint, the bulk API endpoint, paste, and CSV — goes through
this exact same rule, so it behaves identically no matter which door you
came in.

---

## 5. Working a lead: qualify → convert to client

Open any lead (tap the row) to see its **detail sheet**:

- **Stage** is a dropdown right at the top — change it and it saves
  immediately, no separate "Save" step. Move a lead through the pipeline
  (`New Lead` → `Contacted` → `Call Scheduled` → `Proposal Sent` →
  `Negotiation` → `Closed Won` / `Closed Lost`) with one tap each time.
- Right under Stage: once a lead reaches **Closed Won**, a green **Convert to
  Client** button appears — full width, one tap, impossible to miss. It
  creates the client record and logs it on the lead's timeline
  automatically. Before Closed Won, that same spot just tells you what to do
  next ("Move the stage above to Closed Won to convert this lead into a
  client").
- **Create follow-up task** — turns a reply or a call outcome into a task
  without leaving the sheet.
- **Activity Timeline** — every stage change, note, call, and email is
  logged automatically, newest first.

That's the whole loop: get a list in (section 2–3) → work it stage by stage
(section 5) → convert the wins into clients, with the CRM keeping the record
straight the entire way.

---

## 6. Quick reference

| I want to... | Do this |
|---|---|
| Add one lead right now | Round **+** button (phone) or **New** (desktop) → Lead |
| Add a lead with more detail (source, category, deal value, assignee) | Leads page → **New** |
| Import a spreadsheet I already have | Outreach → Setup & Ingestion → **Import Leads** → Paste or CSV |
| Get a fresh list of businesses in a niche | Outreach → Setup & Ingestion → download the Apify Google Maps workflow |
| Check if importing twice is safe | Yes — see section 4. Try it: import, note the counts, import again, `Created` will be `0`. |
| Move a lead forward | Open the lead → change **Stage** |
| Turn a won deal into a client | Open the lead → **Stage: Closed Won** → **Convert to Client** button |
