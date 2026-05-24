# Seekers Agency — Agents Playbook

**Source:** [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) (175+ agents, 14 divisions, Markdown specs)
**Goal:** Implement the highest-leverage agents inside the Seekers CRM so every CRM stage produces a concrete artifact (enriched lead, qualified opp, draft outreach, proposal, SOW, QBR, etc.).

---

## 1. The Core Principle

Don't install all 175. **The CRM is your spine** — only adopt agents that read from or write to a CRM object (Lead, Contact, Account, Opportunity, Activity, Ticket). Everything else is noise for an agency at your stage.

Recommended starting set: **~18 agents** mapped to 6 CRM stages.

---

## 2. The Tier-1 Roster (Implement First)

### Stage A — Inbound & Demand (fills `Lead`)
| Agent | CRM Trigger | Output written to CRM |
|---|---|---|
| `marketing-seo-specialist` | Weekly cron | Content brief → Activity on Campaign |
| `marketing-linkedin-content-creator` | On new case study | LinkedIn post draft → Campaign asset |
| `marketing-growth-hacker` | Monthly | Experiment plan → Campaign + KPIs |
| `marketing-content-creator` | On product update | Blog/landing copy → Campaign asset |

### Stage B — Outbound & Prospecting (creates `Lead`/`Contact`)
| Agent | CRM Trigger | Output |
|---|---|---|
| `sales-outbound-strategist` | New ICP target list | Sequenced outreach plan → Cadence |
| `specialized/sales-outreach` | New `Lead` created | First-touch email + LinkedIn DM draft |
| `specialized/sales-data-extraction-agent` | Lead enrichment | Firmographics + tech stack → Lead fields |

### Stage C — Discovery & Qualification (`Lead` → `Opportunity`)
| Agent | CRM Trigger | Output |
|---|---|---|
| `sales-discovery-coach` | Meeting booked | Pre-call brief + question list → Activity |
| `sales-engineer` | Stage = "Technical Eval" | Solution architecture sketch → Opp note |
| `sales-account-strategist` | Stage = "Qualified" | Account map + multi-thread plan → Opp |

### Stage D — Proposal & Close (`Opportunity` → Won)
| Agent | CRM Trigger | Output |
|---|---|---|
| `sales-proposal-strategist` | Stage = "Proposal" | Proposal + pricing → Opp attachment |
| `sales-deal-strategist` | Stage = "Negotiation" | Risk register + close plan → Opp |
| `support-legal-compliance-checker` | Before signature | Contract red-flag review → Opp note |

### Stage E — Delivery (`Project`/`Engagement`)
| Agent | CRM Trigger | Output |
|---|---|---|
| `engineering-rapid-prototyper` | Project kickoff | POC scaffold + repo plan |
| `engineering-ai-engineer` | Build phase | Model/prompt design notes → Project |
| `project-management-project-shepherd` | Weekly | Status report → Account activity |

### Stage F — Retention & Ops (`Account` post-Won)
| Agent | CRM Trigger | Output |
|---|---|---|
| `sales-pipeline-analyst` | Weekly | Pipeline health report → Dashboard |
| `support-executive-summary-generator` | Monthly per account | QBR deck draft → Account |
| `support-analytics-reporter` | Monthly | Usage + outcomes report → Account |

---

## 3. Implementation Plan (CRM Integration)

### Phase 1 — Manual & Reference (Week 1)
1. Fork the repo into a private Seekers repo: `seekers/agents`.
2. Keep only the ~18 Tier-1 specs above. Delete the rest to reduce cognitive load.
3. Install them into Claude Code for you and your teammate — both work from the same source of truth.
4. Add a `SEEKERS-CUSTOMIZATION.md` to each agent: ICP, tone, pricing tiers, case studies.

### Phase 2 — CRM Hooks (Weeks 2–3)
Wire each agent to a CRM trigger via webhook → small worker → Claude API → write-back.

```
CRM stage change  ──►  Webhook  ──►  Worker (Node/Python)
                                          │
                                          ├─ Loads matching agent .md
                                          ├─ Pulls CRM context (account, contacts, history)
                                          ├─ Calls Claude API (claude-sonnet-4-6 default,
                                          │   claude-opus-4-7 for proposals)
                                          └─ Writes output back as Note/Attachment/Task
```

Use **prompt caching** on the agent spec + account context (saves 70–90% on tokens since the spec is static per call type).

### Phase 3 — Lightweight UI (Month 2, only if needed)
Inside the CRM, add a single button per record: **"Run Agent ▾"** with a dropdown of agents valid for that stage. No separate frontend — embed it in the CRM you already have.

### Phase 4 — Measure & Prune (Month 3)
Track per agent: usage count, acceptance rate (did the human keep the output?), revenue influenced. **Kill any agent under 30% acceptance** — replace or tune.

---

## 4. What to Skip (For Now)

- **All China-market marketing agents** (WeChat, Douyin, Xiaohongshu, etc.) — unless that's your market.
- **Game development division** — irrelevant.
- **Spatial computing** — irrelevant.
- **Most `specialized/` vertical agents** (healthcare, legal, real estate) — only adopt if you pick a vertical focus.
- **Academic division** — irrelevant.
- **Most engineering agents** beyond the 3 listed — your delivery team uses their own tooling.

---

## 5. Quick Wins to Ship This Week

1. **`sales-discovery-coach`** wired to "Meeting Booked" stage → pre-call brief in every rep's inbox 1 hour before the call. *Single highest-ROI integration.*
2. **`sales-proposal-strategist`** on "Proposal" stage → first-draft proposal saves 3–4 hours per deal.
3. **`sales-pipeline-analyst`** weekly cron → forces honest pipeline review, surfaces stalled deals.

Build these three first. Prove the loop. Then expand.

---

## 6. Open Questions to Resolve Before Phase 2

- Which CRM is "Lexflow"? (HubSpot, Salesforce, custom?) — determines webhook + auth approach.
- Who on the team owns the agent-config repo? (Recommend: one of the founders, not delegated yet.)
- What's your monthly Claude API budget ceiling? (Sets caching aggressiveness and model tier defaults.)
- Vertical focus? (If yes, adds 2–4 `specialized/` agents to the roster.)
