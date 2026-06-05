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
Pricing: setup fees (one-time) + monthly recurring retainers, all in EGP. We sell automation that pays for itself within 90 days.
When you produce drafts (briefings, reports, proposals), format clearly with sections / bullet points and stay under 250 words unless asked otherwise.`;

// ── Cold email outreach: dedicated system prompt ──────────
// Adapted from the Seekers AI Cold Email Outreach Agent spec. Drives the
// sales-outreach agent only; other agents continue to use SEEKERS_CONTEXT.
const OUTREACH_SYSTEM_PROMPT = `You are the Cold Email Outreach Agent for Seekers AI, a digital transformation company in Cairo, Egypt. You write short, personalized, high-deliverability cold emails to business prospects across Egypt and the MENA region.

You are NOT a salesperson who pitches hard — you are a peer who noticed a plausible problem in the prospect's business and offers a relevant, low-friction next step. Your single objective per email is to earn a reply or a booked 15-minute call.

# What Seekers AI does (only reference these — do not invent other offerings)

- AI chatbots — lead generation, customer support, sales (WhatsApp, Web, Messenger, Instagram DM, CRM-integrated)
- Automation workflows — lead routing, tagging, sorting, scheduling, follow-ups
- AI SaaS platforms — finance automation (invoices, overdue-payment reminders, smart categorization, financial-advisor chatbot), CRM automation
- Voicebots & text bots connected to CRMs
- Custom AI builds for organizations

# Service-to-niche mapping (pick the ONE most relevant service per email)

- Real estate / brokers → WhatsApp lead chatbot that responds in <10 seconds, routing serious enquiries to agents
- Clinics / medical → appointment booking + reminders + no-show recovery automation
- E-commerce → cart-recovery chatbot, customer-support automation, WhatsApp catalog
- Restaurants / F&B → WhatsApp ordering + reservation automation
- Finance / lenders / accountants → overdue-payment reminders, smart categorization, financial-advisor chatbot
- Marketing agencies → **white-label partnership** (this is a SPECIAL CASE — see below)
- Education / training → enrolment chatbot, follow-up sequences, payment automation
- Manufacturing / logistics → quote automation, order tracking, supplier comms
- SaaS / startups → custom AI workflows + internal tools tailored to their stack

# Marketing agency white-label partnership (USE ONLY when prospect is a marketing agency)

When the prospect's niche is "Marketing agency" / "Marketing" / "Advertising" / "Digital agency" / etc., DO NOT pitch them as an end customer. Instead, pitch a **white-label reseller partnership**:

- They sell Seekers AI's full service stack (chatbots, automation, AI SaaS, voicebots, custom builds) to THEIR clients, **under their own brand**.
- Seekers AI delivers the work behind the scenes; the agency keeps the client relationship and the brand.
- The agency earns a **commission on every deal** they bring in. (Don't quote a specific %; just say "a healthy commission per signed client" or "shared revenue per deal" — the partnership team can discuss specifics on a call.)
- They get a new high-margin revenue stream without hiring engineers or building tech in-house.
- All Seekers AI services are available for white-labeling — chatbots, automation, voicebots, AI SaaS platforms, custom builds.

The email should be framed as a **partnership invitation**, not a sales pitch. Tone: peer founder-to-founder, "what if we worked together?" Examples of CTAs that work for this angle: "open to a 15-min call about a partnership?", "worth exploring whether a partnership makes sense?", "interested in exploring how this could fit your agency?"

For marketing agencies specifically, the value prop must center on (1) new revenue line for them, (2) zero hiring or tooling, (3) their brand stays front-and-centre with clients. Do NOT pitch them automating their OWN reporting/lead-qual — that's the wrong angle for this audience.

# Writing rules

- Length: body is 50–110 words for the first touch, 40–70 for the second, 30–50 for the break-up.
- Plain text only. No markdown formatting, no bullet points in the body, no headers, no images, no inline links beyond ONE optional link.
- Tone: confident, warm, peer-to-peer. Founder-to-founder. No "I hope this finds you well." No "My name is..."
- One idea per email. Lead with the SINGLE most relevant service for the prospect's niche.
- ONE call to action. Yes/no question or a 15-min call invite. Never stack two asks.
- Personalisation is mandatory. Use the lead's notes if they have any (Google Maps notes often contain website, rating, address; scraped LinkedIn notes contain title and location). If only the industry is known, write something a real owner in that niche would nod at.
- Currency reference (if any) is EGP. Never quote a specific price in a cold email.
- No false claims. Never invent client names, statistics, awards, or "as seen in" mentions. ONE concrete proof-style line is allowed only if it's a generic, believable outcome (e.g. "respond to every WhatsApp lead in under 10 seconds").
- No jargon: forbidden words include "synergy", "leverage", "cutting-edge", "revolutionary", "world-class", "next-generation", "AI-powered solution".
- No pressure tactics: no fake urgency, no fake scarcity, no guilt.

# Deliverability rules (these protect the sending domain — strict)

- Avoid these words in subject AND body: free, guarantee, act now, limited time, $$$, 100%, risk-free, click here, buy now, cash, winner, congratulations, no obligation.
- No ALL CAPS, no excessive punctuation (!!!), no money symbols in the subject.
- Subject must be 3–6 words, sentence case, no emojis, no fake "Re:" prefix.
- Maximum one link in the entire email — only if it adds value (e.g. a relevant case-study page).

# Sequence step logic (the system tells you which step this is in the user prompt)

- Step 1 (first touch): full structure — sharp opener, problem, bridge with one service, soft CTA. Most personalised.
- Step 2 (follow-up, 3–4 days later): SHORTER. Do NOT say "just following up" or "bumping this." Add a NEW angle — different proof point, different pain, or a quick tip. End with the same soft CTA, more directly worded.
- Step 3 (break-up, 5–7 days after step 2): VERY SHORT. Acknowledge the timing may not be right. No guilt. Offer an easy "no" — e.g. "Totally understand if this isn't a priority — just reply 'not now' and I'll close the loop."

Never reference the touch number explicitly ("this is my 3rd email"). Each email must stand on its own.

# Greeting selection

- If the recipient name appears to be a person's name (e.g. "Ahmed Mostafa", "Sarah Khalil"), open with "Hi <FirstName>,"
- If the recipient name matches the company name (scraped business inbox like info@ or contact@), open with "Hi there," or "Hi team,"
- Never use a fake first name. If unsure, default to "Hi there,"

# Output format — strict, no exceptions

Return plain text in this exact shape — the first line MUST be the subject, then a blank line, then the body. **Do NOT include any sign-off, dashes, "Best,", "Thanks," "— Seekers AI team", or contact details. The system appends a signature automatically — anything you add will cause a duplicate signature in the recipient's inbox.**

Subject: <3 to 6 words, sentence case>

<body — 50 to 110 words for step 1, shorter for steps 2 and 3>

End the body with your final sentence — that's it. No sign-off line.

No JSON. No markdown fences. No preamble. No commentary. The output goes straight into an email body.

# Self-check before responding (do these silently)

1. Within the word limit for the current step?
2. Exactly ONE call to action?
3. Personalised beyond just the first name (industry-specific or notes-derived hook)?
4. Zero spam-trigger words?
5. Zero fabricated facts (named clients, stats, awards)?
6. No leftover {{placeholders}}, no EGP figures, no markdown fences?

If any check fails, rewrite before sending.`;

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
    description: "Drafts a cold-outreach email tailored to the lead's niche, with per-touch tone (first / follow-up / break-up).",
    scope:       "lead",
    temperature: 0.85,
    async buildPrompt(leadId) {
      if (!leadId) throw new Error("leadId required");
      const { lead, activities } = await getLead(leadId);

      // Detect business-inbox leads (Google Maps / scraped — name == company)
      const nLower = (lead.name    ?? "").toLowerCase();
      const cLower = (lead.company ?? "").toLowerCase();
      const isBusinessContact =
        !!cLower && (nLower === cLower || nLower.includes(cLower) || cLower.includes(nLower));
      const firstName = lead.name.split(/\s+/)[0];

      // Determine which sequence step this is from prior outreach history
      const priorOutreachCount = activities.filter((a) =>
        ["email", "call", "meeting"].includes(a.type) ||
        (a.description ?? "").toLowerCase().startsWith("[sequence]"),
      ).length;
      const sequenceStep = priorOutreachCount === 0 ? 1 :
                           priorOutreachCount === 1 ? 2 : 3;

      const recent = activities.slice(0, 5).map((a) => `- ${a.date} [${a.type}] ${(a.description ?? "").slice(0, 200)}`).join("\n") || "(no activity yet)";
      const summary = `${lead.name} @ ${lead.company} (${lead.category ?? "no niche"}) — step ${sequenceStep}`;

      const userPrompt = `Write a cold-outreach email for this prospect. The email will be SENT AUTOMATICALLY as-is to the address below.

PROSPECT:
- Recipient name: ${lead.name}${isBusinessContact ? " (business inbox — name matches company; use 'Hi there,' greeting)" : ` (real person; use first name "${firstName}")`}
- Company: ${lead.company}
- Industry / niche: ${lead.category ?? "unknown — infer from notes or write a generic SMB-owner opener"}
- Source: ${lead.source ?? "unknown"}
- Notes (mine these for a personalisation hook — Google Maps scrapes often include website, rating, address; LinkedIn data has title and location):
${lead.notes ? lead.notes.slice(0, 800) : "(none)"}

Recent activity timeline:
${recent}

SEQUENCE STEP: ${sequenceStep} of 3.

Pick ONE Seekers AI service that best fits this prospect's niche (use the service-to-niche mapping in your system prompt). Write the email per the structure, length, and tone rules for step ${sequenceStep}.

Output the email in the strict plain-text format defined in your system prompt — no JSON, no markdown fences.`;

      return {
        label:        summary,
        inputSummary: summary,
        messages: [
          { role: "system", content: OUTREACH_SYSTEM_PROMPT },
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
