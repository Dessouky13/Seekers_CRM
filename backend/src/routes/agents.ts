// AI Agents — list available, run, and read run history
import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { agentRuns, leadActivities, tasks, leads, clients } from "../db/schema";
import { AGENTS, findAgent, runAgent, listAgentRuns, type AgentScope } from "../services/agents";
import { authMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

const agentsRouter = new Hono<AppEnv>();

// GET /agents — list available agent definitions
agentsRouter.get("/", authMiddleware, (c) => {
  return c.json(AGENTS.map(({ id, name, description, scope, modelEnv }) => ({
    id, name, description, scope,
    tier: modelEnv === "heavy" ? "premium" : "standard",
  })));
});

// POST /agents/run — execute an agent
const runSchema = z.object({
  agent_id:   z.string().min(1),
  context_id: z.string().uuid().nullable().optional(),
});

agentsRouter.post("/run", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = runSchema.parse(await c.req.json());

  const agent = findAgent(body.agent_id);
  if (!agent) return c.json({ error: "Unknown agent" }, 404);

  // Some scopes require context, pipeline/global don't
  const needsContext = agent.scope !== "pipeline" && agent.scope !== "global";
  if (needsContext && !body.context_id) {
    return c.json({ error: `Agent '${agent.id}' requires a context_id (${agent.scope})` }, 400);
  }

  try {
    const run = await runAgent({
      agentId:   body.agent_id,
      contextId: body.context_id ?? null,
      userId:    user.id,
    });
    return c.json(run);
  } catch (err: any) {
    return c.json({ error: err?.message ?? "Agent run failed" }, 500);
  }
});

// GET /agents/runs — recent runs (optional scope/context filter)
agentsRouter.get("/runs", authMiddleware, async (c) => {
  const q = c.req.query() as Record<string, string>;
  const rows = await listAgentRuns({
    scope:     (q.scope as AgentScope) || undefined,
    contextId: q.context_id || undefined,
    limit:     q.limit ? Math.min(Number(q.limit), 200) : 50,
  });
  return c.json(rows.map(({ run, authorName }) => ({ ...run, author_name: authorName })));
});

// ── Write-back endpoints: turn agent output into CRM artifacts ────

async function getRun(id: string) {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
  return run;
}

// POST /agents/runs/:id/save-as-activity — save lead-scope agent output to lead activity timeline
const saveActivitySchema = z.object({
  type: z.enum(["email", "call", "meeting", "form", "note"]).default("note"),
});

agentsRouter.post("/runs/:id/save-as-activity", authMiddleware, async (c) => {
  const user = c.get("user");
  const run  = await getRun(c.req.param("id"));
  if (!run)                       return c.json({ error: "Run not found" }, 404);
  if (run.scope !== "lead")       return c.json({ error: "Only lead-scope runs can be saved as activity" }, 400);
  if (!run.contextId)             return c.json({ error: "Run has no lead context" }, 400);
  if (run.status !== "success")   return c.json({ error: "Cannot save a failed run" }, 400);

  const body = saveActivitySchema.parse(await c.req.json().catch(() => ({})));

  // Verify lead still exists
  const [lead] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, run.contextId)).limit(1);
  if (!lead) return c.json({ error: "Lead no longer exists" }, 404);

  const agent = findAgent(run.agentId);
  const prefix = agent ? `[AI: ${agent.name}] ` : "[AI] ";
  const description = (prefix + run.output).slice(0, 4000); // safety cap

  const [activity] = await db
    .insert(leadActivities)
    .values({
      leadId:      run.contextId,
      type:        body.type,
      description,
      createdBy:   user.id,
    })
    .returning();

  return c.json(activity, 201);
});

// POST /agents/runs/:id/create-tasks — bulk-create tasks from a list of titles
const createTasksSchema = z.object({
  titles:       z.array(z.string().min(1).max(300)).min(1).max(20),
  project_id:   z.string().uuid().optional(),
  priority:     z.enum(["low", "medium", "high", "critical"]).optional(),
});

agentsRouter.post("/runs/:id/create-tasks", authMiddleware, async (c) => {
  const user = c.get("user");
  const run  = await getRun(c.req.param("id"));
  if (!run)                     return c.json({ error: "Run not found" }, 404);
  if (run.status !== "success") return c.json({ error: "Cannot create tasks from a failed run" }, 400);

  const body = createTasksSchema.parse(await c.req.json());

  // Determine client linkage from run context
  let clientId: string | null = null;
  if (run.scope === "client" && run.contextId) {
    const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, run.contextId)).limit(1);
    if (client) clientId = client.id;
  }

  const created = await db
    .insert(tasks)
    .values(
      body.titles.map((title) => ({
        title:      title.trim().slice(0, 300),
        priority:   body.priority ?? "medium" as const,
        projectId:  body.project_id ?? null,
        clientId,
        createdBy:  user.id,
      })),
    )
    .returning();

  return c.json({ created: created.length, tasks: created }, 201);
});

export default agentsRouter;
