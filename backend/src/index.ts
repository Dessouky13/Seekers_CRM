import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/error-handler";
import authRouter         from "./routes/auth";
import usersRouter        from "./routes/users";
import clientsRouter      from "./routes/clients";
import tasksRouter, { projectsRouter } from "./routes/tasks";
import financeRouter      from "./routes/finance";
import crmRouter          from "./routes/crm";
import goalsRouter        from "./routes/goals";
import dashboardRouter    from "./routes/dashboard";
import knowledgeRouter    from "./routes/knowledge";
import notificationsRouter from "./routes/notifications";
import notesRouter         from "./routes/notes";
import vaultRouter         from "./routes/vault";
import { runStaleLeadNotificationSweep } from "./services/notifications";
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

api.route("/auth",          authRouter);
api.route("/users",         usersRouter);
api.route("/clients",       clientsRouter);
api.route("/tasks",         tasksRouter);
api.route("/projects",      projectsRouter);
api.route("/finance",       financeRouter);
api.route("/crm",           crmRouter);
api.route("/goals",         goalsRouter);
api.route("/dashboard",     dashboardRouter);
api.route("/knowledge",     knowledgeRouter);
api.route("/notifications", notificationsRouter);
api.route("/notes",         notesRouter);
api.route("/vault",         vaultRouter);

app.route("/api/v1", api);

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
    const count = await runStaleLeadNotificationSweep(Number(process.env.LEAD_NO_RESPONSE_HOURS ?? 48));
    if (count > 0) {
      console.log(`[notifications] stale lead sweep processed ${count} leads`);
    }
  } catch (error) {
    console.error("[notifications] stale lead sweep failed", error);
  }
}, Math.max(1, staleLeadSweepMinutes) * 60_000);

export default app;
