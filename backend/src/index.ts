import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { and, eq, lt, sql } from "drizzle-orm";
import { corsMiddleware } from "./middleware/cors";
import { authMiddleware, adminOnly } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import authRouter         from "./routes/auth";
import usersRouter        from "./routes/users";
import clientsRouter      from "./routes/clients";
import tasksRouter, { projectsRouter } from "./routes/tasks";
import taskTemplatesRouter from "./routes/task-templates";
import financeRouter      from "./routes/finance";
import crmRouter          from "./routes/crm";
import goalsRouter        from "./routes/goals";
import dashboardRouter    from "./routes/dashboard";
import knowledgeRouter    from "./routes/knowledge";
import notificationsRouter from "./routes/notifications";
import notesRouter         from "./routes/notes";
import vaultRouter         from "./routes/vault";
import agentsRouter        from "./routes/agents";
import outreachRouter      from "./routes/outreach";
import leadImportsRouter   from "./routes/lead-imports";
import webhooksRouter      from "./routes/webhooks";
import worklistRouter      from "./routes/worklist";
import quotationsRouter    from "./routes/quotations";
import invoicesRouter      from "./routes/invoices";
import companySettingsRouter from "./routes/company-settings";
import economicsRouter     from "./routes/economics";
import { publicQuotations, publicInvoices } from "./routes/public-documents";
import {
  intel as intelRouter, eventsRouter, mailboxesRouter,
  auditsRouter, intentRouter,
} from "./routes/automation";
import { db } from "./db/client";
import { tasks } from "./db/schema";
import { runStaleLeadNotificationSweep } from "./services/notifications";
import { processDueSends } from "./services/outreach";
import { sweepIntervalMinutes } from "./services/sending-policy";
import { configuredSenderAddress } from "./services/mailbox";
import { pollInbox } from "./services/inbox";
import { syncManualSentEmails } from "./services/sent-sync";
import { maybeSendDailyDigest } from "./services/digest";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// ── Global middleware ─────────────────────────────────────
app.use("/*", corsMiddleware);

// ── Health check ──────────────────────────────────────────
app.get("/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString(), service: "seekers-ai-api" }),
);

// ── API routes ────────────────────────────────────────────
const api = new Hono<AppEnv>();

// ── Module-level access control ───────────────────────────
// Members (non-admins) are scoped to their OWN leads, tasks and notes (plus
// outreach on their own leads — enforced inside the outreach router). Every
// module below exposes company-wide or sensitive data and is admin-only.
// Registered BEFORE the routers so the guard runs first.
//
// NOTE: /vault previously listed credentials to ANY authenticated user.
const ADMIN_ONLY_MODULES = [
  "/finance",    // revenue, expenses, P&L
  "/clients",    // client directory + revenue
  "/goals",      // company OKRs
  "/dashboard",  // company-wide KPI aggregates
  "/knowledge",  // internal knowledge base / RAG
  "/vault",      // stored credentials — most sensitive
  "/agents",     // paid AI agent runs
  // Webhook subscriptions carry the shared X-Webhook-Secret this CRM signs
  // outbound events with, and the delivery log stores full event payloads —
  // other users' lead names, deal values, phone numbers, and for the digest
  // event another person's entire ranked action list. Every MUTATING route on
  // that router was already adminOnly, but both GETs were authMiddleware only,
  // so any member could read the credential and the payloads. Gating the module
  // closes both at once and keeps the rule in one place.
  "/webhooks",   // automation credentials + delivered event payloads
  // Client-facing money documents: prices, discounts, tax numbers and the P&L
  // rows an invoice writes when it is paid.
  //
  // The PUBLIC share links are NOT here — they live at /q/:token and /i/:token,
  // outside this prefix by construction rather than as an exception carved into
  // the guard.
  "/quotations",
  "/invoices",
  "/company-settings",   // branding + bank details printed on every document
  // Per-client revenue, the cost base and the margin between them — the same
  // class of data as /finance, and the concentration figures are arguably more
  // sensitive than either side on its own.
  "/economics",
] as const;

for (const mod of ADMIN_ONLY_MODULES) {
  api.use(mod,          authMiddleware, adminOnly);   // exact, e.g. GET /vault
  api.use(`${mod}/*`,   authMiddleware, adminOnly);   // nested, e.g. GET /vault/:id
}

api.route("/auth",          authRouter);
api.route("/users",         usersRouter);
api.route("/clients",       clientsRouter);
api.route("/tasks",         tasksRouter);
api.route("/projects",      projectsRouter);
// Deliberately not admin-gated: a member's own repeated checklist is exactly
// the thing this is for, and applying a template only ever creates tasks they
// could already create one at a time. Only DELETE is adminOnly, at the route.
api.route("/task-templates", taskTemplatesRouter);
api.route("/finance",       financeRouter);
api.route("/crm",           crmRouter);
api.route("/goals",         goalsRouter);
api.route("/dashboard",     dashboardRouter);
api.route("/knowledge",     knowledgeRouter);
api.route("/notifications", notificationsRouter);
api.route("/notes",         notesRouter);
api.route("/vault",         vaultRouter);
api.route("/agents",        agentsRouter);
api.route("/outreach",      outreachRouter);
// Bulk-import support: pre-flight row validation + the server-side proxy that
// holds the n8n secret. Both routes are adminOnly at the route, matching
// /outreach/leads/ingest-bulk, rather than via ADMIN_ONLY_MODULES.
api.route("/lead-imports",  leadImportsRouter);
api.route("/webhooks",      webhooksRouter);
// Not in ADMIN_ONLY_MODULES on purpose — the whole point is that a member
// lands somewhere that tells them what to do. Rows are scoped per-user inside
// the service; only /worklist/pipeline-health is admin-gated, at the route.
api.route("/worklist",      worklistRouter);

api.route("/quotations",       quotationsRouter);
api.route("/invoices",         invoicesRouter);
api.route("/company-settings", companySettingsRouter);
api.route("/economics",        economicsRouter);

// v2 Outbound Machine — automation ingest (API-key auth; for n8n)
api.route("/intel",      intelRouter);
api.route("/events",     eventsRouter);
api.route("/mailboxes",  mailboxesRouter);
api.route("/audits",     auditsRouter);
api.route("/intent",     intentRouter);

app.route("/api/v1", api);

// ── Public share links (no auth) ──────────────────────────
// Deliberately mounted at the ROOT, not under /api/v1: these are pages a client
// opens from WhatsApp, and a short link is the point. Being outside the /api/v1
// tree also puts them outside every module guard registered above.
//   GET /q/:token       → branded quotation page
//   GET /q/:token/pdf   → the same document as a PDF
//   GET /i/:token[/pdf] → the invoice equivalents
app.route("/q", publicQuotations);
app.route("/i", publicInvoices);

// ── 404 fallback ──────────────────────────────────────────
app.notFound((c) => c.json({ error: "Not found" }, 404));

// ── Global error handler ──────────────────────────────────
app.onError(errorHandler);

// ── Start server ──────────────────────────────────────────
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, () => {
  console.log(`🚀 Seekers AI OS API running on port ${port}`);
  console.log(`   Health: http://localhost:${port}/health`);
  console.log(`   API:    http://localhost:${port}/api/v1`);
  console.log(`   Mode:   ${process.env.NODE_ENV ?? "development"}`);
});

const staleLeadSweepMinutes = Number(process.env.STALE_LEAD_SWEEP_MINUTES ?? 10);
setInterval(async () => {
  try {
    const result = await runStaleLeadNotificationSweep(Number(process.env.LEAD_NO_RESPONSE_HOURS ?? 48));
    // Only log when the sweep actually wrote something. It runs 144 times a day
    // and the steady state is "nothing changed" — a line per run is noise that
    // hides the runs that mattered.
    if (result.created > 0 || result.refreshed > 0) {
      console.log(
        `[notifications] stale-lead digest: ${result.created} created, ${result.refreshed} refreshed ` +
        `(${result.staleLeads} stale leads across ${result.users} people)`,
      );
    }
  } catch (error) {
    console.error("[notifications] stale lead sweep failed", error);
  }
}, Math.max(1, staleLeadSweepMinutes) * 60_000);

// ── Task auto-cleanup: delete tasks completed > N days ago ────────────
//
// OPT-IN. This is a hard DELETE that also cascades to subtasks — there is no
// archive, no undo and nothing in the UI that warns a task will disappear.
// It used to default to 30 days, so simply starting the API silently destroyed
// finished work (observed: a boot removed 2 completed tasks). Retention now
// only runs when TASK_AUTO_DELETE_DAYS is explicitly set to a positive number.
async function runTaskCleanupSweep(retentionDays: number) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const deleted = await db
    .delete(tasks)
    .where(and(
      eq(tasks.status, "done"),
      sql`${tasks.completedAt} IS NOT NULL`,
      lt(tasks.completedAt, sql`NOW() - (${retentionDays} || ' days')::interval`),
    ))
    .returning({ id: tasks.id });
  return deleted.length;
}

const taskCleanupMinutes = Number(process.env.TASK_CLEANUP_SWEEP_MINUTES ?? 60);
// Unset (or <= 0) → retention disabled, completed tasks are kept forever.
const taskRetentionDays  = Number(process.env.TASK_AUTO_DELETE_DAYS ?? 0);

if (taskRetentionDays > 0) {
  console.warn(
    `[tasks] ⚠ auto-delete ENABLED: completed tasks older than ${taskRetentionDays} days ` +
    `will be permanently deleted (TASK_AUTO_DELETE_DAYS). This cannot be undone.`,
  );

  setInterval(async () => {
    try {
      const count = await runTaskCleanupSweep(taskRetentionDays);
      if (count > 0) {
        console.log(`[tasks] auto-deleted ${count} completed tasks older than ${taskRetentionDays}d`);
      }
    } catch (error) {
      console.error("[tasks] auto-cleanup sweep failed", error);
    }
  }, Math.max(1, taskCleanupMinutes) * 60_000);

  // Run once on boot
  runTaskCleanupSweep(taskRetentionDays).then((count) => {
    if (count > 0) console.log(`[tasks] boot cleanup removed ${count} completed tasks`);
  }).catch((err) => console.error("[tasks] boot cleanup failed", err));
}

// ── Outreach scheduler: send due sequence steps every N minutes ─────
// The interval comes from sending-policy, not from a local read of the env var:
// the release budget is computed from how many sweeps remain before the Cairo
// window shuts, so the policy and the timer must agree by construction.
const outreachSweepMinutes = sweepIntervalMinutes();
setInterval(async () => {
  try {
    const result = await processDueSends(50);
    if (result.processed > 0) {
      console.log(`[outreach] tick: processed=${result.processed} sent=${result.sent} failed=${result.failed}`);
    }
  } catch (error) {
    console.error("[outreach] sweep failed", error);
  }
}, Math.max(1, outreachSweepMinutes) * 60_000);

// ── Daily Loop: morning digest of each person's worklist ────────────
// Ticks often, fires once per Cairo day at DIGEST_HOUR. The CRM decides what
// matters; n8n subscribes to `worklist.digest` and delivers it over WhatsApp.
// Disabled unless DIGEST_ENABLED=true so nobody gets surprise messages.
if (process.env.DIGEST_ENABLED === "true") {
  const digestCheckMinutes = Number(process.env.DIGEST_CHECK_MINUTES ?? 15);
  setInterval(async () => {
    try {
      await maybeSendDailyDigest();
    } catch (error) {
      console.error("[digest] sweep failed", error);
    }
  }, Math.max(1, digestCheckMinutes) * 60_000);
  console.log(`[digest] enabled — fires at ${process.env.DIGEST_HOUR ?? 9}:00 Africa/Cairo`);
}

// The mailboxes table exists but ships empty, and the daily cap has nowhere to
// live without a row. Idempotent: only ever inserts the configured sender.
//
// The address MUST be the canonical (lowercased) form. Seeding
// process.env.EMAIL_FROM verbatim — production is `Team@seekersai.org` — put a
// mixed-case row in a table whose unique index is on raw text, so the first
// POST /mailboxes/health from n8n (which lowercases) inserted a SECOND row for
// the same mailbox and the daily cap started coming from whichever row a
// `LIMIT 1` happened to return.
void (async () => {
  if (!process.env.EMAIL_FROM) return;
  const address = configuredSenderAddress();
  try {
    await db.execute(sql`
      INSERT INTO mailboxes (address, daily_cap, warmup_stage)
      VALUES (${address}, 0, 'recovery')
      ON CONFLICT (address) DO NOTHING
    `);
  } catch (e: any) {
    console.error("[boot] could not seed mailbox:", e?.message);
  }
})();

// ── Mailbox poller: INBOX replies/bounces + manual Sent mail every N mins ──
// Runs tighter than the outreach sweep so a reply pauses the sequence before
// the next scheduled touch goes out.
//
// Both sweeps share this one tick rather than getting a timer each: they hit the
// same IMAP server with the same single credential pair, and two independent
// intervals would eventually overlap into concurrent logins on a mailbox that
// allows very few. Sequential, and the Sent sweep is awaited separately so a
// failure in either one still lets the other run.
const inboxPollMinutes = Number(process.env.INBOX_POLL_MINUTES ?? 2);
setInterval(async () => {
  try {
    const result = await pollInbox();
    if (result.processed > 0) {
      console.log(`[inbox] tick: processed=${result.processed} replies=${result.replies} bounces=${result.bounces}`);
    }
  } catch (error) {
    console.error("[inbox] poll failed", error);
  }

  try {
    const sent = await syncManualSentEmails();
    if (sent.imported > 0 || sent.processed > 0) {
      console.log(`[sent] tick: processed=${sent.processed} imported=${sent.imported} crm_sends=${sent.crmSends}`);
    }
  } catch (error) {
    console.error("[sent] manual-send sweep failed", error);
  }
}, Math.max(1, inboxPollMinutes) * 60_000);

export default app;
