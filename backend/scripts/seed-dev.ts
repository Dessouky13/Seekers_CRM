// Development seed — a realistic dataset for local UI work and manual QA.
//
// Differs from scripts/seed.ts, which only creates the first admin. This one
// fills every surface the app renders (pipeline stages, an outreach sequence
// mid-flight, overdue tasks, a finance cycle that straddles the 21st boundary)
// so pages can be reviewed with plausible content instead of empty states.
//
// Purely additive: it never deletes. Re-running is a no-op once the marker
// client exists, so it cannot stack duplicates either. To start over, drop the
// local database by hand.
//
// ⚠️  It also UPSERTS PASSWORDS for dessouky@, mostafa@ and gomaa@. Its previous
// guard was "host must be localhost" — which is true ON THE PRODUCTION VPS,
// whose DATABASE_URL is `…@localhost:5432/seekersai`. Running this there would
// have passed that check and then reset all three real accounts' credentials and
// injected fictional revenue. It now uses the shared guard, which also refuses
// any database that already contains business records.
import "dotenv/config";
import { Client } from "pg";
import bcrypt from "bcrypt";
import { assertSafeToSeed } from "./lib/seed-guard";

const URL_ = process.env.DATABASE_URL!;

const c = new Client({ connectionString: URL_ });

/** Days from now as an ISO date (negative = past). */
const day = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Hours from now as a timestamp. */
const hour = (n: number) => new Date(Date.now() + n * 3600_000).toISOString();

async function main() {
  await assertSafeToSeed({ scriptName: "seed-dev.ts" });
  await c.connect();
  console.log("seeding", new URL(URL_).hostname);

  // ── People ──────────────────────────────────────────────
  const pw = await bcrypt.hash("admin123!", 12);
  const pwMember = await bcrypt.hash("Mostafa123", 12);

  const { rows: [admin] } = await c.query(
    `INSERT INTO profiles (name, email, password, role, title, phone)
     VALUES ('Dessouky', 'dessouky@seekersai.org', $1, 'admin', 'Founder', '+20 100 000 0000')
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, role = 'admin'
     RETURNING id`, [pw]);

  const { rows: [member] } = await c.query(
    `INSERT INTO profiles (name, email, password, role, title)
     VALUES ('Mostafa', 'mostafa@seekersai.org', $1, 'member', 'SDR')
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, role = 'member'
     RETURNING id`, [pwMember]);

  const { rows: [gomaa] } = await c.query(
    `INSERT INTO profiles (name, email, password, role, title)
     VALUES ('Gomaa', 'gomaa@seekersai.org', $1, 'member', 'Automation Engineer')
     ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
     RETURNING id`, [pwMember]);

  console.log("  profiles: 3");

  // Additive only, and resumable: each section checks its own marker rather
  // than one global flag, so a run that fails halfway can be re-run to fill in
  // just the missing parts.
  const done = async (sql: string, params: unknown[] = []) =>
    (await c.query(sql, params)).rows.length > 0;

  const haveClients = await done(`SELECT 1 FROM clients WHERE company='Nile Dental Group' LIMIT 1`);
  const haveLeads   = await done(`SELECT 1 FROM leads WHERE company='Company 1' LIMIT 1`);
  const haveSeq     = await done(`SELECT 1 FROM outreach_sequences WHERE name='Dentist cold open' LIMIT 1`);
  const haveTx      = await done(`SELECT 1 FROM transactions WHERE notes LIKE '%monthly' LIMIT 1`);
  const haveGoals   = await done(`SELECT 1 FROM goals WHERE title='Monthly recurring revenue' LIMIT 1`);
  const haveNotifs  = await done(`SELECT 1 FROM notifications WHERE type='lead.replied' LIMIT 1`);

  // ── Clients ─────────────────────────────────────────────
  const clients: string[] = [];
  for (const [name, company, status, industry, rev] of [
    ["Karim Adel",   "Nile Dental Group",   "active",   "Healthcare", "185000"],
    ["Yasmin Fouad", "Zamalek Realty",      "active",   "Real Estate", "92000"],
    ["Omar Hassan",  "CairoFit Studios",    "prospect", "Fitness",     "0"],
    ["Layla Mansour","Delta Logistics",     "active",   "Logistics",  "240000"],
    ["Tarek Nabil",  "Heliopolis Clinic",   "inactive", "Healthcare",  "31000"],
  ] as const) {
    if (haveClients) break;
    const { rows: [r] } = await c.query(
      `INSERT INTO clients (name, company, email, phone, status, industry, total_revenue, notes)
       VALUES ($1,$2,$3,'+20 101 234 5678',$4,$5,$6,'Seeded for local QA') RETURNING id`,
      [name, company, `${name.split(" ")[0].toLowerCase()}@example.com`, status, industry, rev]);
    clients.push(r.id);
  }
  if (haveClients) {
    clients.push(...(await c.query(
      `SELECT id FROM clients WHERE notes='Seeded for local QA' ORDER BY created_at`)).rows.map((r) => r.id));
  }
  console.log(`  clients: ${clients.length}${haveClients ? " (existing)" : ""}`);

  // ── Projects + tasks ────────────────────────────────────
  const projects: string[] = [];
  if (haveClients) {
    projects.push(...(await c.query(`SELECT id FROM projects ORDER BY created_at LIMIT 3`)).rows.map((r) => r.id));
  }
  for (const [i, pname] of ["Website revamp", "WhatsApp bot", "Lead-gen engine"].entries()) {
    if (haveClients) break;
    const { rows: [p] } = await c.query(
      `INSERT INTO projects (name, client_id) VALUES ($1,$2) RETURNING id`,
      [pname, clients[i]]);
    projects.push(p.id);
  }

  // Deliberately includes overdue and due-today rows so the Today queue and the
  // dashboard's overdue KPI have something real to rank.
  const taskRows: Array<[string, string, string, string, string | null, string]> = [
    ["Send Nile Dental the revised proposal", "high",     "in_progress", day(-3), projects[0], admin.id],
    ["Fix WhatsApp webhook retry loop",       "critical", "todo",        day(-1), projects[1], member.id],
    ["QA the lead scraper output",            "medium",   "todo",        day(0),  projects[2], member.id],
    ["Draft Q3 case study",                   "low",      "backlog",     day(6),  projects[0], admin.id],
    ["Migrate mailbox warmup schedule",       "high",     "review",      day(2),  projects[2], gomaa.id],
    ["Archive 2025 invoices",                 "low",      "done",        day(-9), null,        admin.id],
  ];
  for (const [title, priority, status, due, projectId, assignee] of taskRows) {
    if (haveClients) break;
    const { rows: [t] } = await c.query(
      `INSERT INTO tasks (title, description, assignee_id, priority, status, due_date,
                          project_id, client_id, created_by, completed_at)
       VALUES ($1,'Seeded task for local QA.',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [title, assignee, priority, status, due, projectId, clients[0], admin.id,
       status === "done" ? hour(-48) : null]);
    if (status !== "done") {
      await c.query(
        `INSERT INTO subtasks (task_id, title, done, position)
         VALUES ($1,'Gather requirements',true,0), ($1,'Draft',false,1), ($1,'Review',false,2)`,
        [t.id]);
    }
  }
  console.log("  projects: 3, tasks: 6");

  // ── Leads across every stage ────────────────────────────
  const stages = ["new_lead","contacted","call_scheduled","proposal_sent","negotiation","closed_won","closed_lost"];
  const cats   = ["dentist","real_estate","gym","clinic","restaurant"];
  const leadIds: string[] = [];
  if (haveLeads) {
    leadIds.push(...(await c.query(
      `SELECT id FROM leads WHERE company LIKE 'Company %' ORDER BY created_at`)).rows.map((r) => r.id));
  }
  for (let i = 0; i < 24 && !haveLeads; i++) {
    const stage = stages[i % stages.length];
    const cat   = cats[i % cats.length];
    // Every third lead has no email — exercises the "phone/social only" path
    // and the sequence eligibility filter.
    const email = i % 3 === 0 ? null : `contact${i}@lead${i}.example.com`;
    const { rows: [l] } = await c.query(
      `INSERT INTO leads (name, company, email, phone, source, category, deal_value, stage,
                          assignee_id, last_activity, notes, icp_score, domain, email_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [`Lead ${i + 1}`, `Company ${i + 1}`, email, `+20 12${String(i).padStart(8, "0")}`,
       ["osm","referral","website","cold"][i % 4], cat,
       String(5000 + i * 1500), stage,
       i % 2 === 0 ? admin.id : (i % 5 === 0 ? null : member.id),
       day(-(i % 21)), i % 4 === 0 ? "Asked to follow up after Ramadan." : null,
       40 + (i * 7) % 60, `lead${i}.example.com`,
       email ? "valid" : null]);
    leadIds.push(l.id);

    await c.query(
      `INSERT INTO lead_activities (lead_id, type, description, date, created_by)
       VALUES ($1,'note','Lead created from seed',$2,$3),
              ($1,$4,$5,$6,$3)`,
      [l.id, day(-(i % 21) - 2), admin.id,
       ["email","call","meeting"][i % 3],
       `Logged a ${["email","call","meeting"][i % 3]} with the contact`,
       day(-(i % 21))]);
  }
  console.log(`  leads: ${leadIds.length}${haveLeads ? " (existing)" : " (+48 activities)"}`);

  // ── Outreach: one healthy 3-step sequence, one single-step trap ──
  if (haveSeq) console.log("  sequences: existing");
  else {
  const { rows: [seqA] } = await c.query(
    `INSERT INTO outreach_sequences (name, description, category, is_active, created_by)
     VALUES ('Dentist cold open','3-touch intro for dental clinics','dentist',true,$1) RETURNING id`,
    [admin.id]);
  const { rows: [seqB] } = await c.query(
    `INSERT INTO outreach_sequences (name, description, category, is_active, created_by)
     VALUES ('Gym one-shot','Single email, no follow-up (intentionally incomplete)','gym',false,$1) RETURNING id`,
    [admin.id]);

  const stepIds: string[] = [];
  for (const [pos, off, subj, body] of [
    [0, 0,  "Quick question about {{company}}", "Hi {{first_name}},\n\nNoticed {{company}} is in {{category}}. We automate patient follow-up for clinics like yours.\n\nWorth a look?"],
    [1, 3,  "Following up, {{first_name}}",     "Hi {{first_name}},\n\nCircling back on the note above — happy to send a 2-minute walkthrough."],
    [2, 7,  "Closing the loop",                 "Hi {{first_name}},\n\nLast note from me. If the timing is off I'll leave it there."],
  ] as const) {
    const { rows: [s] } = await c.query(
      `INSERT INTO outreach_steps (sequence_id, position, day_offset, channel, subject_template, body_template)
       VALUES ($1,$2,$3,'email',$4,$5) RETURNING id`, [seqA.id, pos, off, subj, body]);
    stepIds.push(s.id);
  }
  await c.query(
    `INSERT INTO outreach_steps (sequence_id, position, day_offset, channel, subject_template, body_template)
     VALUES ($1,0,0,'email','Hello from Seekers','Hi {{first_name}} — one-off note.')`, [seqB.id]);

  // Enrollments in every status so the analytics panel has a real distribution.
  const emailLeads = leadIds.filter((_, i) => i % 3 !== 0);
  const statuses = ["active","active","active","paused","completed","replied","failed"];
  for (const [i, leadId] of emailLeads.slice(0, 14).entries()) {
    const status = statuses[i % statuses.length];
    const { rows: [e] } = await c.query(
      `INSERT INTO outreach_enrollments
         (lead_id, sequence_id, current_step, status, enrolled_at, next_send_at,
          last_step_completed_at, completed_at, paused_reason, enrolled_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [leadId, seqA.id, i % 3, status, hour(-24 * (i + 1)),
       status === "active" ? hour(i * 6 - 12) : null,
       hour(-24 * i - 6),
       ["completed","replied","failed"].includes(status) ? hour(-12) : null,
       status === "paused" ? "Mailbox rejected the subject line (554)" : null,
       admin.id]);

    for (let k = 0; k <= i % 3; k++) {
      await c.query(
        `INSERT INTO outreach_sends (enrollment_id, step_id, channel, subject, body, sent_at, status, error)
         VALUES ($1,$2,'email',$3,$4,$5,$6,$7)`,
        [e.id, stepIds[k], `Quick question about Company ${i + 1}`,
         "Seeded send body.", hour(-24 * (i + 1) + k * 72),
         status === "failed" && k === i % 3 ? "failed" : "sent",
         status === "failed" && k === i % 3 ? "554 5.7.1 message rejected" : null]);
    }
  }
  console.log("  sequences: 2, enrollments: 14");
  }

  // ── Finance: straddles the 21st cycle boundary on purpose ──
  const tools = ["OpenRouter","n8n Cloud","Namecheap PE","Hetzner VPS"];
  for (let i = 0; i < 30 && !haveTx; i++) {
    const isIncome = i % 3 === 0;
    await c.query(
      `INSERT INTO transactions (date, type, amount, currency, category, client_id, client_name,
                                 status, notes, created_by, held_by)
       VALUES ($1,$2,$3,'EGP',$4,$5,$6,$7,$8,$9,$10)`,
      [day(-i * 3), isIncome ? "income" : "expense",
       isIncome ? String(15000 + i * 900) : String(400 + i * 120),
       isIncome ? "Retainer" : ["Software","Hosting","Salaries","Ads"][i % 4],
       isIncome ? clients[i % clients.length] : null,
       isIncome ? "Nile Dental Group" : null,
       i % 7 === 0 ? "pending" : "completed",
       isIncome ? null : `${tools[i % tools.length]} monthly`,
       admin.id,
       // held_by is a profile FK: who is physically holding the cash. null =
       // it landed in the company account. Rotating admin/gomaa here gives the
       // cash-position panel a non-trivial split to render.
       isIncome ? [null, admin.id, gomaa.id][i % 3] : null]);
  }
  console.log(`  transactions: ${haveTx ? "existing" : 30}`);

  // ── Goals + notifications ───────────────────────────────
  for (const [title, cur, tgt, unit, period] of haveGoals ? [] : [
    ["Monthly recurring revenue", "185000", "300000", "EGP", "2026-Q3"],
    ["New clients closed",        "4",      "10",     "clients", "2026-Q3"],
    ["Replies per 100 sends",     "2",      "8",      "%",    "2026-Q3"],
  ] as const) {
    await c.query(
      `INSERT INTO goals (title, description, current, target, unit, period, owner_id)
       VALUES ($1,'Seeded goal',$2,$3,$4,$5,$6)`, [title, cur, tgt, unit, period, admin.id]);
  }

  for (const [i, [type, title, body]] of (haveNotifs ? [] : [
    ["lead.replied", "Lead 5 replied",        "“Sounds interesting, can you send pricing?”"],
    ["task.overdue", "Task overdue",          "Fix WhatsApp webhook retry loop is 1 day late"],
    ["sequence.paused","Sequence paused",     "Dentist cold open paused an enrollment (554)"],
  ] as const).entries()) {
    await c.query(
      `INSERT INTO notifications (user_id, type, title, body, read, link, created_at)
       VALUES ($1,$2,$3,$4,$5,'/crm',$6)`,
      [admin.id, type, title, body, i === 2, hour(-i * 5 - 1)]);
  }
  console.log(`  goals: ${haveGoals ? "existing" : 3}, notifications: ${haveNotifs ? "existing" : 3}`);

  await c.end();
  console.log("\ndone. login: dessouky@seekersai.org / admin123!  (member: mostafa@seekersai.org / Mostafa123)");
}

main().catch((e) => { console.error(e); process.exit(1); });
