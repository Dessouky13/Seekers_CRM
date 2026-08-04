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
| **A spreadsheet someone already has** | Exported from anywhere, or just typed up by hand. | Paste, CSV or Excel (.xlsx) — see below, no n8n needed |

All the n8n workflow files live in **Outreach → Setup & Ingestion**, each
with a one-line description and a **Download .json** button. Import the
`.json` into n8n, point it at your Apify/Apollo/Snov.io account, and it POSTs
straight into the CRM. Full setup steps: **Outreach → Setup & Ingestion →
Full setup guide**.

**You don't need any of this to get a list in today.** If you already have
one — from a scrape, an export, or a spreadsheet a client sent you — skip
straight to section 3.

---

## 3. Importing a list — paste, CSV, Excel, or API

Go to **Outreach → Setup & Ingestion**, scroll to **Import Leads**.

### Paste (fastest — recommended)

1. In Google Sheets or Excel, select the range you want (include the header
   row) and copy (**Ctrl/Cmd+C**).
2. In the CRM, make sure the **Paste** tab is selected, click into the box,
   and paste (**Ctrl/Cmd+V**).
3. Click **Preview import**.

Tabs, commas, and semicolons are all detected automatically — paste exactly
what you copied, no reformatting needed.

### CSV or Excel file

1. Switch to the **CSV / Excel** tab.
2. Drop a `.csv`, `.tsv` or `.xlsx` file onto the box, or click it to browse.
   Works from Apollo, Sales Navigator, Snov.io, ZoomInfo exports, or a
   spreadsheet someone just typed up in Excel or Google Sheets ("Download →
   Microsoft Excel (.xlsx)").

You don't need to convert an Excel file to CSV first. The workbook is opened
**in your browser** — nothing is uploaded anywhere until you press Import — and
the first sheet is used. A few Excel-specific things it handles for you:

- A **title row above your headers** is skipped; the real header row is found.
- The **hundreds of formatted-but-empty rows** an export leaves at the bottom
  are dropped instead of becoming hundreds of blank leads.
- A **phone column stored as a number** (`201001234567`) keeps every digit
  instead of turning into `2.01e+11`.
- A **date column** comes through as a plain `YYYY-MM-DD` date.

Password-protected workbooks can't be read — save an unprotected copy first.
`.xls` (the pre-2007 format) mostly works but re-saving as `.xlsx` is more
reliable.

### Either way — map columns, then import

Once rows are loaded you'll see a **column mapping** step: each column from
your sheet on the left, a dropdown on the right to say what it is (Name,
Company, Email, Phone, Source, Category/Niche, Deal value, Notes, or *Skip
column*). Common header names (`email`, `phone_number`, `full name`,
`company_name`, etc.) are auto-detected — you're just confirming or fixing.

Under the mapping you'll get a **row check** before anything is saved. It looks
at every row (the first 2,000 for very large files) and reports:

| What it finds | What happens |
|---|---|
| **Row is completely empty** — no name, company, email or phone | Left out of the import |
| **Invalid email** (`jane@`, `not-an-email`) | Left out of the import — see below |
| **Duplicate email** in your file, or already in the CRM | Imported once; the repeat is counted as *Skipped* or *Updated* |
| **Phone with no country code** (`0100 123 4567`) | Still imported and saved as text, but it can't be dialled or WhatsApp'd until someone fixes it |
| **Landline number** | Still imported — just be aware WhatsApp outreach skips it |
| **Phone already on a different lead** | ⚠️ **Imported as a second lead.** This is the one duplicate we detect but do not prevent — two people at one company can genuinely share a switchboard, so it's your call. Check the flagged rows. |

Why invalid emails are dropped rather than blocking the whole file: one
malformed email cell used to make the entire batch fail, so 499 good leads
never landed because of one typo in row 417. Now the bad rows are named, left
out, and everything else imports.

Below that you'll see a **preview** of the first few rows exactly as they'll be
saved, and an **"If a lead already exists"** control:

- **Update missing fields** (default) — fills in anything blank on the
  existing lead (phone, source, category); never overwrites what's already
  there.
- **Skip it** — leaves the existing lead completely untouched.

Click **Import N leads**. You'll get a result screen: **Created / Updated /
Skipped / Errors**, with a reason for every failed row if there are any.

### Handing the file to n8n as well

When you import an actual **file** (not a paste), there's a checkbox:
**"Also send \<filename\> to the n8n import workflow"**, on by default. That
hands the raw file to n8n for enrichment and follow-up automation, *after* the
leads are already saved in the CRM.

The two are deliberately independent:

- If n8n is down, times out, or rejects the file, **your leads still import.**
  The result screen says the handoff failed and why, with a **Retry handoff**
  button. You will never see a plain "success" when n8n didn't get the file.
- Sending the **same file twice within 30 minutes is blocked**, so a double-tap
  or a page refresh can't run the workflow twice. If you genuinely meant to
  resend, the button changes to **Send anyway**.
- Untick the box if you only want the leads in the CRM.

The n8n webhook is called by our own server, never by your browser, so its
credentials aren't in anything a visitor can read.

Limits of the duplicate-send block, honestly: it's remembered in the server's
memory, so a deploy or an API restart clears it, and it only matches the
**exact same file bytes** — re-exporting the same data from Excel produces a
slightly different file and will go through.

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

**The one gap: phone numbers.** Matching is on email, then name+company —
*never* on phone. A row with a brand-new email but a phone number you already
hold will create a second lead. The row check (section 3) flags exactly those
rows before you import so you can decide, but nothing removes them
automatically.

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
| Import a spreadsheet I already have | Outreach → Setup & Ingestion → **Import Leads** → Paste, or CSV / Excel |
| Import an Excel file | Same place — drop the `.xlsx` straight in, no need to convert to CSV |
| See what's wrong with my sheet before importing | Load it and read the **row check** under the column mapping |
| Stop a file being sent to n8n | Untick "Also send … to the n8n import workflow" before importing |
| Get a fresh list of businesses in a niche | Outreach → Setup & Ingestion → download the Apify Google Maps workflow |
| Check if importing twice is safe | Yes — see section 4. Try it: import, note the counts, import again, `Created` will be `0`. |
| Move a lead forward | Open the lead → change **Stage** |
| Turn a won deal into a client | Open the lead → **Stage: Closed Won** → **Convert to Client** button |
