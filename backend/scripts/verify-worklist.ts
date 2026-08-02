/**
 * Exercises the worklist + pipeline-health endpoints against a REAL Postgres,
 * in a throwaway schema, with realistic data.
 *
 * The ranking logic has unit tests; this covers the half those can't — that the
 * hand-written SQL actually parses, joins correctly, scopes members to their
 * own rows, and produces the numbers we claim. Compiling proves none of that.
 *
 * Run:  PGOPTIONS="-c search_path=wl_probe" npx tsx scripts/verify-worklist.ts
 * The caller is responsible for creating/dropping the schema.
 */
import "dotenv/config";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import worklistRouter from "../src/routes/worklist";
import crmRouter from "../src/routes/crm";
import tasksRouter from "../src/routes/tasks";
import { errorHandler } from "../src/middleware/error-handler";
import { signAccessToken } from "../src/services/auth";

const app = new Hono();
app.route("/api/v1/worklist", worklistRouter);
app.route("/api/v1/crm", crmRouter);
app.route("/api/v1/tasks", tasksRouter);
app.onError(errorHandler);

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") =>
  ok ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n} ${d}`));

async function get(path: string, token: string) {
  const r = await app.request(`/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}
async function post(path: string, token: string, body: unknown) {
  const r = await app.request(`/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

async function main() {
  const sp = String(((await db.execute(sql`SHOW search_path`)).rows[0] as any).search_path ?? "");
  if (!sp.includes("wl_probe")) throw new Error(`refusing to run outside the probe schema (got "${sp}")`);
  console.log(`(isolated schema: ${sp})\n`);

  // ── Seed a believable board ──
  const ids = (await db.execute(sql`
    WITH admin AS (
      INSERT INTO profiles (name, email, password, role)
      VALUES ('Dessouky','admin@probe.test','x','admin') RETURNING id),
    member AS (
      INSERT INTO profiles (name, email, password, role)
      VALUES ('Gomaa','gomaa@probe.test','x','member') RETURNING id)
    SELECT (SELECT id FROM admin) AS admin_id, (SELECT id FROM member) AS member_id`)).rows[0] as any;
  const adminId = ids.admin_id as string, memberId = ids.member_id as string;
  const adminTok = await signAccessToken(adminId), memberTok = await signAccessToken(memberId);

  await db.execute(sql`
    INSERT INTO leads (id, name, company, email, deal_value, stage, assignee_id, last_activity) VALUES
      ('11111111-1111-1111-1111-111111111111','Dr. Aya Mansour','Rajac Dental','aya@rajac.test',85000,'proposal_sent',${memberId}, CURRENT_DATE),
      ('22222222-2222-2222-2222-222222222222','Backyard Hospitality','Backyard','ops@backyard.test',120000,'contacted',${memberId}, CURRENT_DATE),
      ('33333333-3333-3333-3333-333333333333','Genesis School','Genesis','head@genesis.test',40000,'proposal_sent',${memberId}, CURRENT_DATE - 20),
      ('44444444-4444-4444-4444-444444444444','Admin Only Lead','AdminCo','a@admin.test',9000,'new_lead',${adminId}, CURRENT_DATE - 30),
      ('55555555-5555-5555-5555-555555555555','Orphan Lead','NoOwner','o@orphan.test',15000,'new_lead',NULL, NULL),
      ('66666666-6666-6666-6666-666666666666','Closed Deal','DoneCo','d@done.test',50000,'closed_won',${memberId}, CURRENT_DATE - 40)`);

  await db.execute(sql`
    INSERT INTO outreach_sequences (id, name) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001','GCC Clinics')`);

  // Rajac replied 3h ago and nobody has answered → must be the top action.
  await db.execute(sql`
    INSERT INTO outreach_enrollments (lead_id, sequence_id, status, completed_at, paused_reason) VALUES
      ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','replied', NOW() - INTERVAL '3 hours', 'Reply received')`);
  await db.execute(sql`
    INSERT INTO lead_activities (lead_id, type, description, created_by) VALUES
      ('11111111-1111-1111-1111-111111111111','email','[Reply received] Interesting — we do lose WhatsApp enquiries overnight.', NULL)`);

  // Backyard read its audit 5× → hot.
  await db.execute(sql`
    INSERT INTO audits (lead_id, slug, views, updated_at) VALUES
      ('22222222-2222-2222-2222-222222222222','backyard-audit',5, NOW() - INTERVAL '2 hours')`);

  // A frozen sequence (admin-only signal).
  await db.execute(sql`
    INSERT INTO outreach_enrollments (lead_id, sequence_id, status, paused_reason) VALUES
      ('44444444-4444-4444-4444-444444444444','aaaaaaaa-0000-0000-0000-000000000001','paused','Step 2 produced an empty body')`);

  await db.execute(sql`
    INSERT INTO tasks (title, status, priority, due_date, assignee_id) VALUES
      ('Ship Hydro onboarding','todo','high', CURRENT_DATE - 2, ${memberId}),
      ('Admin only task','todo','low', CURRENT_DATE, ${adminId})`);

  // ── Worklist: member ──
  console.log("GET /worklist — member");
  const m = await get("/worklist", memberTok);
  check("returns 200", m.status === 200, `-> ${m.status} ${JSON.stringify(m.json).slice(0, 300)}`);
  const mAll: any[] = [...(m.json.focus ?? []), ...(m.json.rest ?? [])];
  check("unanswered reply ranks first", mAll[0]?.type === "reply_waiting", `-> ${mAll[0]?.type}`);
  check("reply carries the lead's own words", typeof mAll[0]?.detail === "string" && mAll[0].detail.includes("WhatsApp"), `-> ${mAll[0]?.detail}`);
  check("strips our [Reply received] marker", !String(mAll[0]?.detail).includes("[Reply received]"));
  check("hot lead present", mAll.some((a) => a.type === "hot_lead"));
  check("stale lead present", mAll.some((a) => a.type === "stale_lead" && a.leadId === "33333333-3333-3333-3333-333333333333"));
  check("overdue task present", mAll.some((a) => a.type === "task_due"));
  check("closed-won lead excluded", !mAll.some((a) => a.leadId === "66666666-6666-6666-6666-666666666666"));

  console.log("\n  member scoping (the security-relevant part)");
  check("cannot see another user's lead", !mAll.some((a) => a.leadId === "44444444-4444-4444-4444-444444444444"));
  check("cannot see another user's task", !mAll.some((a) => a.title === "Admin only task"));
  check("cannot see unassigned leads", !mAll.some((a) => a.type === "unassigned_lead"));
  check("cannot see blocked sequences", !mAll.some((a) => a.type === "sequence_blocked"));

  // ── Worklist: admin ──
  console.log("\nGET /worklist — admin");
  const a = await get("/worklist", adminTok);
  const aAll: any[] = [...(a.json.focus ?? []), ...(a.json.rest ?? [])];
  check("returns 200", a.status === 200, `-> ${a.status}`);
  check("sees the unassigned lead", aAll.some((x) => x.type === "unassigned_lead"));
  check("sees the frozen sequence", aAll.some((x) => x.type === "sequence_blocked"), `-> ${aAll.map((x) => x.type).join(",")}`);
  check("sees everyone's work", aAll.length > mAll.length, `admin=${aAll.length} member=${mAll.length}`);
  check("focus caps at 5", (a.json.focus ?? []).length <= 5);
  check("counts add up", a.json.counts.total === aAll.length);

  // ── Pipeline health ──
  console.log("\nGET /worklist/pipeline-health");
  const denied = await get("/worklist/pipeline-health", memberTok);
  check("member is refused (403)", denied.status === 403, `-> ${denied.status}`);

  const h = await get("/worklist/pipeline-health", adminTok);
  check("admin gets 200", h.status === 200, `-> ${h.status} ${JSON.stringify(h.json).slice(0, 200)}`);
  check("counts only active leads", h.json.active_leads === 5, `-> ${h.json.active_leads}`);
  check("runway is null while nothing has sent", h.json.runway_days === null, `-> ${h.json.runway_days}`);
  check("says the machine is idle", /idle/i.test(h.json.headline ?? ""), `-> ${h.json.headline}`);

  // Now simulate a week of sending and re-check the runway maths.
  await db.execute(sql`
    INSERT INTO outreach_sends (enrollment_id, status, sent_at)
    SELECT e.id, 'sent', NOW() - (n || ' hours')::interval
      FROM outreach_enrollments e, generate_series(1, 14) n
     WHERE e.status = 'replied'`);
  const h2 = await get("/worklist/pipeline-health", adminTok);
  check("send rate computed from real sends", h2.json.sent_7d === 14, `-> ${h2.json.sent_7d}`);
  check("runway becomes a number", typeof h2.json.runway_days === "number", `-> ${h2.json.runway_days}`);
  check("starving flag set on a short runway", h2.json.starving === true, `-> runway=${h2.json.runway_days}`);
  check("headline names the shortfall", /run out of un-contacted leads/.test(h2.json.headline), `-> ${h2.json.headline}`);

  // ── Bulk delete ──
  console.log("\nPOST /crm/leads/bulk-delete — selection mode");
  const target = "55555555-5555-5555-5555-555555555555";
  const dry = await post("/crm/leads/bulk-delete", adminTok, { ids: [target], confirm: "DELETE_LEADS", dry_run: true });
  check("dry run reports a count", dry.status === 200 && dry.json.would_delete === 1, `-> ${JSON.stringify(dry.json)}`);
  check("dry run deletes nothing", dry.json.deleted === 0);
  const still = await db.execute(sql`SELECT 1 FROM leads WHERE id = ${target}`);
  check("row survives the dry run", still.rows.length === 1);

  const memberTry = await post("/crm/leads/bulk-delete", memberTok, { ids: [target], confirm: "DELETE_LEADS" });
  check("member is refused (403)", memberTry.status === 403, `-> ${memberTry.status}`);

  const noConfirm = await post("/crm/leads/bulk-delete", adminTok, { ids: [target] });
  check("missing confirm phrase -> 400", noConfirm.status === 400, `-> ${noConfirm.status}`);

  const done = await post("/crm/leads/bulk-delete", adminTok, { ids: [target], confirm: "DELETE_LEADS" });
  check("delete succeeds", done.status === 200 && done.json.deleted === 1, `-> ${JSON.stringify(done.json)}`);
  check("row is gone", (await db.execute(sql`SELECT 1 FROM leads WHERE id = ${target}`)).rows.length === 0);
  const audit = await db.execute(sql`SELECT payload FROM events WHERE type = 'leads_bulk_deleted'`);
  check("deletion is recorded in the events log", audit.rows.length === 1, `-> ${audit.rows.length} rows`);

  console.log("\nPOST /tasks/bulk-delete — scoped to the owner");
  const tRows = await db.execute(sql`SELECT id, title FROM tasks ORDER BY title`);
  const adminTask = (tRows.rows as any[]).find((r) => r.title === "Admin only task").id;
  const memberTask = (tRows.rows as any[]).find((r) => r.title === "Ship Hydro onboarding").id;

  const cross = await post("/tasks/bulk-delete", memberTok, { ids: [adminTask] });
  check("member cannot delete someone else's task", cross.status === 200 && cross.json.deleted === 0, `-> ${JSON.stringify(cross.json)}`);
  check("and is told it was skipped", cross.json.skipped === 1);
  check("the other task still exists", (await db.execute(sql`SELECT 1 FROM tasks WHERE id = ${adminTask}`)).rows.length === 1);

  const own = await post("/tasks/bulk-delete", memberTok, { ids: [memberTask] });
  check("member can delete their own task", own.json.deleted === 1, `-> ${JSON.stringify(own.json)}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
