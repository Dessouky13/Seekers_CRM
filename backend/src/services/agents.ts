// Agent registry — Tier-1 sales agents from SEEKERS_AGENTS_PLAYBOOK.md
// Each agent is a system prompt + a user-prompt builder that pulls
// the relevant CRM context. Runs are logged to agent_runs.

import { eq, sql, desc, and, ne, gte } from "drizzle-orm";
import { db } from "../db/client";
import {
  leads, leadActivities, clients, transactions, tasks,
  agentRuns, profiles,
} from "../db/schema";
import { orChat, type ORMessage } from "./openrouter";

// ── Types ─────────────────────────────────────────────────
export type AgentScope = "lead" | "client" | "task" | "pipeline" | "global";

export interface AgentDef {
  id:          string;
  name:        string;
  description: string;
  scope:       AgentScope;
  modelEnv?:   "default" | "heavy";    // default uses OPENROUTER_MODEL, heavy uses OPENROUTER_MODEL_HEAVY
  temperature?: number;
  buildPrompt: (contextId: string | null) => Promise<{
    label:       string;
    inputSummary: string;
    messages:    ORMessage[];
  }>;
}

const SEEKERS_CONTEXT = `You are an AI assistant at Seekers AI Automation Solutions — a Cairo-based AI/automation agency.
ICP: SMBs and mid-market companies (50-500 employees) in MENA + Europe needing AI workflows, internal tools, RAG/chatbots, and process automation.
Tone: confident, technical, pragmatic. No fluff. Lead with outcomes.
Pricing: setup fees (one-time) + monthly recurring retainers. We sell automation that pays for itself within 90 days.
When you produce drafts, format clearly with sections / bullet points and stay under 250 words unless asked otherwise.`;

// ── Helpers ───────────────────────────────────────────────
async function getLead(id: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) throw new Error("Lead not found");
  const activities = await db
    .select()
    .from(leadActivities)
    .where(eq(leadActivities.leadId, id))
    .orderBy(desc(leadActivities.createdAt))
    .limit(10);
  return { lead, activities };
}

async function getClient(id: string) {
  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) throw new Error("Client not found");
  const recentTx = await db
    .select()
    .from(transactions)
    .where(eq(transactions.clientId, id))
    .orderBy(desc(transactions.date))
    .limit(10);
  const clientTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.clientId, id))
    .orderBy(desc(tasks.createdAt))
    .limit(10);
  return { client, recentTx, tasks: clientTasks };
}

// ── Agent Definitions ─────────────────────────────────────
export const AGENTS: AgentDef[] = [
  {
    id:          "sales-outreach",
    name:        "Outreach Drafter",
    description: "Drafts a first-touch cold email + LinkedIn DM for a lead.",
    scope:       "lead",
    temperature: 0.7,
    async buildPrompt(leadId) {
      if (!leadId) throw new Error("leadId required");
      const { lead, activities } = await getLead(leadId);
      const recent = activities.slice(0, 5).map((a) => `- ${a.date} [${a.type}] ${a.description}`).join("\n") || "(no activity yet)";
      const summary = `${lead.name} @ ${lead.company} (${lead.category ?? "no niche"}) — stage: ${lead.stage}`;
      const userPrompt = `Draft outbound outreach for this lead.

LEAD:
- Name: ${lead.name}
- Company: ${lead.company}
- Email: ${lead.email ?? "—"}
- Niche/Category: ${lead.category ?? "unknown"}
- Source: ${lead.source ?? "unknown"}
- Current stage: ${lead.stage}
- Deal value (if estimated): ${Number(lead.dealValue) > 0 ? `$${lead.dealValue}` : "—"}
- Notes: ${lead.notes ?? "—"}

Recent activity:
${recent}

Produce:
1. **Cold Email** — 5 sentences max. Specific opener tied to their niche. One concrete value prop with a measurable outcome. Soft CTA (15-min call this week).
2. **LinkedIn DM** — 3 sentences max. Less salesy than the email. Curiosity-driven.
3. **Follow-up trigger** — one line: when to nudge if no reply.`;

      return {
        label:        summary,
        inputSummary: summary,
        messages: [
          { role: "system", content: SEEKERS_CONTEXT },
          { role: "user",   content: userPrompt },
        ],
      };
    },
  },

  {
    id:          "sales-discovery-coach",
    name:        "Discovery Brief",
    description: "Pre-call briefing: questions to ask, hypotheses, what to listen for.",
    scope:       "lead",
    temperature: 0.4,
    async buildPrompt(leadId) {
      if (!leadId) throw new Error("leadId required");
      const { lead, activities } = await getLead(leadId);
      const recent = activities.slice(0, 8).map((a) => `- ${a.date} [${a.type}] ${a.description}`).join("\n") || "(no activity)";
      const summary = `Discovery brief — ${lead.name} @ ${lead.company}`;
      const userPrompt = `Build a pre-call discovery brief for an upcoming meeting with this lead.

LEAD:
- ${lead.name} (${lead.company})
- Niche: ${lead.category ?? "unknown"}
- Stage: ${lead.stage}
- Source: ${lead.source ?? "unknown"}
- Notes: ${lead.notes ?? "—"}

Activity history:
${recent}

Produce in this order, brief and scannable:
1. **Hypothesis** — what are their likely top 2 pain points based on niche + stage?
2. **Goals of this call** — 3 bullet points.
3. **Questions to ask** — 6-8 sharp discovery questions, ordered: situation → problem → impact → budget/timeline.
4. **Red flags to listen for** — 3 signals this is not a fit.
5. **Possible objections** — 2 likely objections + a one-line response to each.`;

      return {
        label:        summary,
        inputSummary: summary,
        messages: [
          { role: "system", content: SEEKERS_CONTEXT },
          { role: "user",   content: userPrompt },
        ],
      };
    },
  },

  {
    id:          "sales-proposal-strategist",
    name:        "Proposal Draft",
    description: "First-draft proposal with scope, pricing tiers, and timeline.",
    scope:       "lead",
    modelEnv:    "heavy",
    temperature: 0.5,
    async buildPrompt(leadId) {
      if (!leadId) throw new Error("leadId required");
      const { lead, activities } = await getLead(leadId);
      const recent = activities.slice(0, 10).map((a) => `- ${a.date} [${a.type}] ${a.description}`).join("\n") || "(no activity)";
      const summary = `Proposal — ${lead.name} @ ${lead.company}`;
      const userPrompt = `Draft a proposal for this lead. Output should be ready to copy into a doc with light edits.

LEAD:
- ${lead.name} (${lead.company})
- Niche: ${lead.category ?? "—"}
- Stage: ${lead.stage}
- Estimated deal value: ${Number(lead.dealValue) > 0 ? `$${lead.dealValue}` : "TBD"}
- Notes: ${lead.notes ?? "—"}

Conversation history:
${recent}

Structure the proposal:
1. **Executive Summary** (2-3 sentences — the outcome they buy).
2. **Scope of Work** — 4-6 concrete deliverables.
3. **Approach & Timeline** — 3-phase plan with weeks.
4. **Pricing** — 3 tiers (Starter / Standard / Premium) with setup fee + monthly retainer. Anchor the middle tier as recommended.
5. **What's Excluded** — 2-3 lines so scope is clear.
6. **Next Steps** — 2 lines.

Keep the entire proposal under 500 words. Be specific to their niche — no generic AI agency boilerplate.`;

      return {
        label:        summary,
        inputSummary: summary,
        messages: [
          { role: "system", content: SEEKERS_CONTEXT },
          { role: "user",   content: userPrompt },
        ],
      };
    },
  },

  {
    id:          "sales-pipeline-analyst",
    name:        "Pipeline Health Report",
    description: "Weekly snapshot of the full pipeline: stalled deals, where to focus.",
    scope:       "pipeline",
    temperature: 0.3,
    async buildPrompt() {
      // Pull pipeline snapshot
      const stageRows = await db
        .select({
          stage: leads.stage,
          count: sql<number>`COUNT(*)::int`,
          value: sql<number>`SUM(${leads.dealValue}::numeric)`,
        })
        .from(leads)
        .where(ne(leads.stage, "closed_lost"))
        .groupBy(leads.stage);

      // Stale leads — no activity in 14 days
      const fourteenAgo = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
      const staleRows = await db
        .select({ id: leads.id, name: leads.name, company: leads.company, stage: leads.stage, lastActivity: leads.lastActivity, dealValue: leads.dealValue })
        .from(leads)
        .where(and(
          ne(leads.stage, "closed_won"),
          ne(leads.stage, "closed_lost"),
          sql`(${leads.lastActivity} IS NULL OR ${leads.lastActivity} < ${fourteenAgo})`,
        ))
        .orderBy(desc(leads.dealValue))
        .limit(15);

      // Won in last 30d (for momentum context)
      const thirtyAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      const wonRecently = await db
        .select({ count: sql<number>`COUNT(*)::int`, value: sql<number>`SUM(${leads.dealValue}::numeric)` })
        .from(leads)
        .where(and(eq(leads.stage, "closed_won"), gte(leads.updatedAt, new Date(thirtyAgo) as any)));

      const stages = stageRows.map((s) => `- ${s.stage}: ${s.count} leads · $${Number(s.value ?? 0).toFixed(0)}`).join("\n") || "(empty)";
      const stale  = staleRows.map((l) => `- ${l.name} (${l.company}) · ${l.stage} · last: ${l.lastActivity ?? "never"} · $${l.dealValue}`).join("\n") || "(none)";
      const wonStr = wonRecently[0] ? `${wonRecently[0].count} deals · $${Number(wonRecently[0].value ?? 0).toFixed(0)}` : "0";

      const summary = `Pipeline analyst: ${stageRows.reduce((s, r) => s + r.count, 0)} open leads, ${staleRows.length} stale`;

      const userPrompt = `Produce a weekly pipeline health report for the Seekers AI sales team.

PIPELINE BY STAGE:
${stages}

STALE LEADS (no activity 14d+):
${stale}

WON LAST 30 DAYS: ${wonStr}

Output sections:
1. **Headline** — one sentence of the current state.
2. **Health Score** — Green / Yellow / Red, with a one-line reason.
3. **Top 5 Deals to Push** — pick highest-leverage deals from the stale list, with the next action for each.
4. **Pattern Spotted** — one trend worth flagging.
5. **This Week's Focus** — 3 specific actions for the team.

Be direct. No filler. The team is small and time-constrained.`;

      return {
        label:        summary,
        inputSummary: summary,
        messages: [
          { role: "system", content: SEEKERS_CONTEXT },
          { role: "user",   content: userPrompt },
        ],
      };
    },
  },

  {
    id:          "sales-lead-enrichment",
    name:        "Lead Enrichment",
    description: "Best-guess firmographics + opportunity signals based on lead's company.",
    scope:       "lead",
    temperature: 0.3,
    async buildPrompt(leadId) {
      if (!leadId) throw new Error("leadId required");
      const { lead } = await getLead(leadId);
      const summary = `Enrich ${lead.company}`;

      const userPrompt = `Enrich this lead with the most useful information for sales prep. Use general knowledge + reasonable inference. Mark guesses with "(estimate)".

LEAD:
- Name: ${lead.name}
- Company: ${lead.company}
- Niche we've tagged: ${lead.category ?? "—"}
- Email domain: ${lead.email?.split("@")[1] ?? "—"}

Output:
1. **Company snapshot** — likely size (employees), HQ region, industry, business model.
2. **Tech stack signals** — what they likely use today (CRM, marketing, ops tools).
3. **Automation opportunities** — top 3 places we could win them based on their niche.
4. **Decision-maker hypothesis** — what role this contact likely holds; who else needs to be involved.
5. **Suggested next touch** — one specific, non-generic outreach hook.`;

      return {
        label:        summary,
        inputSummary: summary,
        messages: [
          { role: "system", content: SEEKERS_CONTEXT },
          { role: "user",   content: userPrompt },
        ],
      };
    },
  },

  {
    id:          "client-qbr",
    name:        "Quarterly Business Review",
    description: "Draft QBR for an existing client based on tasks delivered + revenue.",
    scope:       "client",
    modelEnv:    "heavy",
    temperature: 0.4,
    async buildPrompt(clientId) {
      if (!clientId) throw new Error("clientId required");
      const { client, recentTx, tasks: clientTasks } = await getClient(clientId);
      const income  = recentTx.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
      const done    = clientTasks.filter((t) => t.status === "done").length;
      const open    = clientTasks.filter((t) => t.status !== "done").length;
      const summary = `QBR — ${client.name} @ ${client.company}`;

      const userPrompt = `Draft a quarterly business review (QBR) for this client. The tone should be: outcome-focused, data-led, looking ahead.

CLIENT:
- ${client.name} @ ${client.company}
- Status: ${client.status}
- Industry: ${client.industry ?? "—"}
- Notes: ${client.notes ?? "—"}

RECENT METRICS (last 90 days, approx):
- Revenue collected: $${income.toFixed(0)}
- Tasks delivered: ${done}
- Tasks open: ${open}

Output:
1. **Wins this quarter** — 3-4 bullet points.
2. **By the Numbers** — 3 metric callouts.
3. **What didn't ship / blockers** — honest, 2-3 lines.
4. **Recommendations for next quarter** — 3 prioritized initiatives with rough effort/impact.
5. **Asks from the client** — 2 things we need from them to accelerate.`;

      return {
        label:        summary,
        inputSummary: summary,
        messages: [
          { role: "system", content: SEEKERS_CONTEXT },
          { role: "user",   content: userPrompt },
        ],
      };
    },
  },
];

export function findAgent(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

// ── Execution ─────────────────────────────────────────────
export interface RunAgentOptions {
  agentId:   string;
  contextId: string | null;
  userId:    string | null;
}

export async function runAgent(opts: RunAgentOptions) {
  const agent = findAgent(opts.agentId);
  if (!agent) throw new Error(`Unknown agent: ${opts.agentId}`);

  const model = agent.modelEnv === "heavy"
    ? (process.env.OPENROUTER_MODEL_HEAVY ?? process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.5-haiku")
    : (process.env.OPENROUTER_MODEL ?? "google/gemini-2.0-flash-001");

  let label = "";
  let inputSummary = "";
  try {
    const { messages, label: l, inputSummary: s } = await agent.buildPrompt(opts.contextId);
    label = l; inputSummary = s;

    const result = await orChat({ messages, model, temperature: agent.temperature });

    const [row] = await db.insert(agentRuns).values({
      agentId:      agent.id,
      scope:        agent.scope,
      contextId:    opts.contextId,
      contextLabel: label,
      inputSummary,
      output:       result.output,
      model:        result.model,
      tokensIn:     result.tokensIn,
      tokensOut:    result.tokensOut,
      costUsd:      String(result.costUsd),
      status:       "success",
      createdBy:    opts.userId,
    }).returning();

    return row;
  } catch (err: any) {
    const errorMsg = err?.message ?? String(err);
    const [row] = await db.insert(agentRuns).values({
      agentId:      opts.agentId,
      scope:        agent.scope,
      contextId:    opts.contextId,
      contextLabel: label,
      inputSummary,
      output:       "",
      model,
      status:       "error",
      error:        errorMsg,
      createdBy:    opts.userId,
    }).returning();
    throw new Error(errorMsg);
  }
}

export async function listAgentRuns(opts: { scope?: AgentScope; contextId?: string | null; limit?: number } = {}) {
  const conditions = [];
  if (opts.scope)     conditions.push(eq(agentRuns.scope, opts.scope));
  if (opts.contextId) conditions.push(eq(agentRuns.contextId, opts.contextId));

  return db
    .select({
      run: agentRuns,
      authorName: profiles.name,
    })
    .from(agentRuns)
    .leftJoin(profiles, eq(agentRuns.createdBy, profiles.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentRuns.createdAt))
    .limit(opts.limit ?? 50);
}
