// ── Users ──
export const users = [
  { id: "u1", name: "Mara Chen", avatar: "MC", role: "admin" as const, email: "mara@agency.ai" },
  { id: "u2", name: "Jordan Reeves", avatar: "JR", role: "member" as const, email: "jordan@agency.ai" },
  { id: "u3", name: "Priya Nair", avatar: "PN", role: "member" as const, email: "priya@agency.ai" },
  { id: "u4", name: "Leo Brandt", avatar: "LB", role: "member" as const, email: "leo@agency.ai" },
];

// ── Finance ──
export type Transaction = {
  id: string; date: string; type: "income" | "expense"; amount: number;
  currency: string; category: string; client: string; status: "completed" | "pending" | "cancelled"; notes?: string;
};

export const transactions: Transaction[] = [
  { id: "t1", date: "2026-03-01", type: "income", amount: 12500, currency: "USD", category: "Consulting", client: "NovaTech", status: "completed" },
  { id: "t2", date: "2026-03-03", type: "expense", amount: 2400, currency: "USD", category: "Software", client: "", status: "completed" },
  { id: "t3", date: "2026-03-05", type: "income", amount: 8750, currency: "USD", category: "Development", client: "Meridian Corp", status: "completed" },
  { id: "t4", date: "2026-03-07", type: "expense", amount: 1850, currency: "USD", category: "Marketing", client: "", status: "pending" },
  { id: "t5", date: "2026-03-09", type: "income", amount: 4200, currency: "USD", category: "Training", client: "Apex Labs", status: "completed" },
  { id: "t6", date: "2026-03-11", type: "expense", amount: 980, currency: "USD", category: "Utilities", client: "", status: "completed" },
  { id: "t7", date: "2026-03-13", type: "income", amount: 15800, currency: "USD", category: "AI Integration", client: "FutureScale", status: "pending" },
  { id: "t8", date: "2026-03-15", type: "expense", amount: 3200, currency: "USD", category: "Contractor", client: "", status: "completed" },
  { id: "t9", date: "2026-03-17", type: "income", amount: 6300, currency: "USD", category: "Consulting", client: "BrightPath", status: "completed" },
  { id: "t10", date: "2026-03-19", type: "expense", amount: 750, currency: "USD", category: "Office", client: "", status: "completed" },
  { id: "t11", date: "2026-03-20", type: "income", amount: 9400, currency: "USD", category: "Development", client: "Orbit AI", status: "completed" },
  { id: "t12", date: "2026-03-21", type: "expense", amount: 1600, currency: "USD", category: "Software", client: "", status: "pending" },
];

export const categories = ["Consulting", "Development", "AI Integration", "Training", "Software", "Marketing", "Utilities", "Contractor", "Office"];

// ── Tasks ──
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "review" | "done";

export type Task = {
  id: string; title: string; description: string; assignee: string;
  priority: TaskPriority; status: TaskStatus; dueDate: string;
  project: string; clientId?: string; subtasks: { id: string; title: string; done: boolean }[];
};

// ── Clients ──
export type Client = {
  id: string; name: string; company: string; email: string; phone: string;
  status: "active" | "inactive" | "prospect"; industry: string;
  totalRevenue: number; projectIds: string[]; notes: string;
  createdAt: string;
};

export const clients: Client[] = [
  { id: "c1", name: "Sarah Kim", company: "NovaTech", email: "sarah@novatech.io", phone: "+1 415-555-0142", status: "active", industry: "Technology", totalRevenue: 24000, projectIds: ["AI Chatbot v2"], notes: "Key account — chatbot for support team", createdAt: "2025-11-15" },
  { id: "c2", name: "Tom Hadley", company: "Meridian Corp", email: "tom@meridian.co", phone: "+1 212-555-0198", status: "active", industry: "Finance", totalRevenue: 18500, projectIds: ["Client Portal"], notes: "Needs custom training data pipeline", createdAt: "2025-12-03" },
  { id: "c3", name: "Anita Rao", company: "Apex Labs", email: "anita@apexlabs.com", phone: "+49 30-555-0167", status: "prospect", industry: "Biotech", totalRevenue: 4200, projectIds: [], notes: "Met at AI Summit Berlin", createdAt: "2026-01-20" },
  { id: "c4", name: "Marcus Webb", company: "FutureScale", email: "marcus@futurescale.ai", phone: "+1 650-555-0134", status: "active", industry: "AI/ML", totalRevenue: 32000, projectIds: ["AI Chatbot v2", "Internal Tools"], notes: "Enterprise inquiry — high value", createdAt: "2026-02-10" },
  { id: "c5", name: "Elise Park", company: "BrightPath", email: "elise@brightpath.org", phone: "+1 310-555-0156", status: "active", industry: "Education", totalRevenue: 14700, projectIds: ["Client Portal"], notes: "Non-profit — education platform", createdAt: "2026-01-08" },
  { id: "c6", name: "Kenji Mori", company: "Orbit AI", email: "kenji@orbitai.jp", phone: "+81 3-555-0189", status: "active", industry: "Technology", totalRevenue: 21000, projectIds: ["Internal Tools"], notes: "Contract signed — starting April 1", createdAt: "2025-10-22" },
];

export const projects = ["AI Chatbot v2", "Client Portal", "Internal Tools"];

export const tasks: Task[] = [
  { id: "tk1", title: "Design conversation flow", description: "Map out the full conversation tree for the chatbot including fallback paths", assignee: "u1", priority: "high", status: "in_progress", dueDate: "2026-03-22", project: "AI Chatbot v2", clientId: "c1", subtasks: [{ id: "s1", title: "Map happy path", done: true }, { id: "s2", title: "Define fallbacks", done: false }] },
  { id: "tk2", title: "Set up vector database", description: "Configure Pinecone index for embeddings storage", assignee: "u3", priority: "critical", status: "todo", dueDate: "2026-03-23", project: "AI Chatbot v2", clientId: "c4", subtasks: [] },
  { id: "tk3", title: "Build auth module", description: "Implement JWT-based authentication", assignee: "u2", priority: "high", status: "review", dueDate: "2026-03-20", project: "Client Portal", clientId: "c2", subtasks: [{ id: "s3", title: "Login endpoint", done: true }, { id: "s4", title: "Refresh token logic", done: true }, { id: "s5", title: "Middleware guard", done: false }] },
  { id: "tk4", title: "Create invoice template", description: "Design PDF invoice generation template", assignee: "u4", priority: "medium", status: "backlog", dueDate: "2026-03-28", project: "Client Portal", clientId: "c5", subtasks: [] },
  { id: "tk5", title: "API rate limiter", description: "Implement rate limiting on public endpoints", assignee: "u2", priority: "medium", status: "todo", dueDate: "2026-03-25", project: "Internal Tools", clientId: "c6", subtasks: [] },
  { id: "tk6", title: "Fine-tune GPT model", description: "Prepare dataset and run fine-tuning job", assignee: "u1", priority: "critical", status: "in_progress", dueDate: "2026-03-19", project: "AI Chatbot v2", clientId: "c4", subtasks: [{ id: "s6", title: "Clean dataset", done: true }, { id: "s7", title: "Run training", done: false }] },
  { id: "tk7", title: "Dashboard analytics", description: "Build analytics widgets for client portal", assignee: "u3", priority: "low", status: "backlog", dueDate: "2026-04-01", project: "Client Portal", clientId: "c2", subtasks: [] },
  { id: "tk8", title: "Migrate to edge functions", description: "Move serverless functions to edge runtime", assignee: "u4", priority: "medium", status: "done", dueDate: "2026-03-15", project: "Internal Tools", clientId: "c6", subtasks: [] },
  { id: "tk9", title: "Write integration tests", description: "Cover critical paths with integration tests", assignee: "u2", priority: "high", status: "todo", dueDate: "2026-03-24", project: "AI Chatbot v2", clientId: "c1", subtasks: [] },
  { id: "tk10", title: "Client onboarding flow", description: "Build step-by-step onboarding wizard", assignee: "u1", priority: "medium", status: "backlog", dueDate: "2026-04-05", project: "Client Portal", clientId: "c5", subtasks: [] },
];

// ── CRM ──
export type LeadStage = "new_lead" | "contacted" | "call_scheduled" | "proposal_sent" | "negotiation" | "closed_won" | "closed_lost";

export type Lead = {
  id: string; name: string; company: string; email: string; source: string;
  dealValue: number; stage: LeadStage; assignee: string; lastActivity: string;
  notes: string;
  activities: { id: string; date: string; type: string; description: string }[];
};

export const leadStages: { key: LeadStage; label: string }[] = [
  { key: "new_lead", label: "New Lead" },
  { key: "contacted", label: "Contacted" },
  { key: "call_scheduled", label: "Call Scheduled" },
  { key: "proposal_sent", label: "Proposal Sent" },
  { key: "negotiation", label: "Negotiation" },
  { key: "closed_won", label: "Closed Won" },
  { key: "closed_lost", label: "Closed Lost" },
];

export const leads: Lead[] = [
  { id: "l1", name: "Sarah Kim", company: "NovaTech", email: "sarah@novatech.io", source: "Referral", dealValue: 24000, stage: "proposal_sent", assignee: "u1", lastActivity: "2026-03-20", notes: "Interested in chatbot for support team", activities: [{ id: "a1", date: "2026-03-18", type: "email", description: "Sent initial proposal" }, { id: "a2", date: "2026-03-20", type: "call", description: "Follow-up call — positive" }] },
  { id: "l2", name: "Tom Hadley", company: "Meridian Corp", email: "tom@meridian.co", source: "LinkedIn", dealValue: 18500, stage: "negotiation", assignee: "u2", lastActivity: "2026-03-19", notes: "Needs custom training data pipeline", activities: [{ id: "a3", date: "2026-03-15", type: "meeting", description: "Discovery call" }, { id: "a4", date: "2026-03-19", type: "email", description: "Sent revised quote" }] },
  { id: "l3", name: "Anita Rao", company: "Apex Labs", email: "anita@apexlabs.com", source: "Conference", dealValue: 9200, stage: "contacted", assignee: "u3", lastActivity: "2026-03-17", notes: "Met at AI Summit Berlin", activities: [{ id: "a5", date: "2026-03-17", type: "email", description: "Intro email sent" }] },
  { id: "l4", name: "Marcus Webb", company: "FutureScale", email: "marcus@futurescale.ai", source: "Website", dealValue: 32000, stage: "new_lead", assignee: "u1", lastActivity: "2026-03-21", notes: "Submitted contact form — enterprise inquiry", activities: [{ id: "a6", date: "2026-03-21", type: "form", description: "Inbound via website" }] },
  { id: "l5", name: "Elise Park", company: "BrightPath", email: "elise@brightpath.org", source: "Referral", dealValue: 14700, stage: "call_scheduled", assignee: "u4", lastActivity: "2026-03-20", notes: "Call booked for March 23", activities: [{ id: "a7", date: "2026-03-18", type: "email", description: "Exchanged requirements doc" }, { id: "a8", date: "2026-03-20", type: "call", description: "Brief intro — scheduled deep dive" }] },
  { id: "l6", name: "Kenji Mori", company: "Orbit AI", email: "kenji@orbitai.jp", source: "LinkedIn", dealValue: 21000, stage: "closed_won", assignee: "u2", lastActivity: "2026-03-14", notes: "Contract signed — starting April 1", activities: [{ id: "a9", date: "2026-03-10", type: "meeting", description: "Final negotiation" }, { id: "a10", date: "2026-03-14", type: "email", description: "Contract sent & signed" }] },
  { id: "l7", name: "Rita Vasquez", company: "SilverLine", email: "rita@silverline.co", source: "Cold Outreach", dealValue: 7800, stage: "closed_lost", assignee: "u3", lastActivity: "2026-03-12", notes: "Budget constraints — revisit Q3", activities: [{ id: "a11", date: "2026-03-12", type: "call", description: "Deal lost — no budget this quarter" }] },
];

// ── Dashboard Metrics ──
export const revenueData = [
  { month: "Oct", revenue: 38200 }, { month: "Nov", revenue: 42800 },
  { month: "Dec", revenue: 35600 }, { month: "Jan", revenue: 48100 },
  { month: "Feb", revenue: 51300 }, { month: "Mar", revenue: 56950 },
];

export const expenseBreakdown = [
  { name: "Software", value: 4000 }, { name: "Marketing", value: 1850 },
  { name: "Contractors", value: 3200 }, { name: "Utilities", value: 980 },
  { name: "Office", value: 750 },
];

export const goalsData = [
  { title: "Q1 Revenue Target", current: 147100, target: 160000 },
  { title: "New Clients", current: 6, target: 8 },
  { title: "Client Retention", current: 92, target: 95 },
];
