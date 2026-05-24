// AI Agents — list available, run, and read run history
import { Hono } from "hono";
import { z } from "zod";
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

export default agentsRouter;
