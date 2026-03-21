/**
 * Seed script — bootstraps the first admin user and sample data.
 * Run: npx tsx scripts/seed.ts  (from /backend directory)
 *      or: npm run seed
 */
import "dotenv/config";
import { db } from "../backend/src/db/client";
import {
  profiles, clients, projects, tasks, subtasks,
  transactions, leads, leadActivities, goals,
} from "../backend/src/db/schema";
import { hashPassword } from "../backend/src/services/auth";

async function seed() {
  console.log("🌱 Seeding Seekers AI OS database...\n");

  // ── Admin user ────────────────────────────────────────────
  const adminPassword = await hashPassword("admin123!");
  const [admin] = await db
    .insert(profiles)
    .values({
      name:     "Dessouky",
      email:    "dessouky@seekersai.org",
      password: adminPassword,
      role:     "admin",
      avatar:   "DA",
    })
    .onConflictDoNothing()
    .returning();

  if (!admin) {
    console.log("⚠️  Admin already exists — skipping user creation");
  } else {
    console.log("✅ Admin user created:", admin.email);
  }

  // ── Team members ──────────────────────────────────────────
  const memberData = [
    { name: "Jordan Reeves", email: "jordan@seekersai.org", avatar: "JR" },
    { name: "Priya Nair",    email: "priya@seekersai.org",  avatar: "PN" },
    { name: "Leo Brandt",    email: "leo@seekersai.org",    avatar: "LB" },
  ];
  const memberPassword = await hashPassword("member123!");
  const insertedMembers = await db
    .insert(profiles)
    .values(memberData.map((m) => ({ ...m, password: memberPassword, role: "member" as const })))
    .onConflictDoNothing()
    .returning();
  console.log(`✅ ${insertedMembers.length} team members created`);

  // ── Clients ───────────────────────────────────────────────
  const [c1, c2, c3, c4, c5, c6] = await db
    .insert(clients)
    .values([
      { name: "Sarah Kim",    company: "NovaTech",    email: "sarah@novatech.io",    phone: "+1 415-555-0142", status: "active" as const,   industry: "Technology",  totalRevenue: "24000", notes: "Key account — chatbot for support team" },
      { name: "Tom Hadley",   company: "Meridian Corp", email: "tom@meridian.co",   phone: "+1 212-555-0198", status: "active" as const,   industry: "Finance",     totalRevenue: "18500", notes: "Needs custom training data pipeline" },
      { name: "Anita Rao",    company: "Apex Labs",   email: "anita@apexlabs.com",  phone: "+49 30-555-0167", status: "prospect" as const, industry: "Biotech",     totalRevenue: "4200",  notes: "Met at AI Summit Berlin" },
      { name: "Marcus Webb",  company: "FutureScale", email: "marcus@futurescale.ai",phone: "+1 650-555-0134",status: "active" as const,   industry: "AI/ML",       totalRevenue: "32000", notes: "Enterprise inquiry — high value" },
      { name: "Elise Park",   company: "BrightPath",  email: "elise@brightpath.org", phone: "+1 310-555-0156",status: "active" as const,   industry: "Education",   totalRevenue: "14700", notes: "Non-profit — education platform" },
      { name: "Kenji Mori",   company: "Orbit AI",    email: "kenji@orbitai.jp",    phone: "+81 3-555-0189",  status: "active" as const,   industry: "Technology",  totalRevenue: "21000", notes: "Contract signed — starting April 1" },
    ])
    .onConflictDoNothing()
    .returning();
  console.log(`✅ ${[c1,c2,c3,c4,c5,c6].filter(Boolean).length} clients created`);

  if (!c1) {
    console.log("⚠️  Clients already exist — skipping rest of seed");
    process.exit(0);
  }

  // ── Projects ──────────────────────────────────────────────
  const [p1, p2, p3] = await db
    .insert(projects)
    .values([
      { name: "AI Chatbot v2",   clientId: c1.id },
      { name: "Client Portal",   clientId: c2.id },
      { name: "Internal Tools",  clientId: c6.id },
    ])
    .returning();
  console.log("✅ 3 projects created");

  // Get all team profile IDs for assignments
  const allProfiles = await db.select({ id: profiles.id, email: profiles.email }).from(profiles);
  const u1 = allProfiles.find((u) => u.email === "dessouky@seekersai.org")!;
  const u2 = allProfiles.find((u) => u.email === "jordan@seekersai.org")!;
  const u3 = allProfiles.find((u) => u.email === "priya@seekersai.org")!;
  const u4 = allProfiles.find((u) => u.email === "leo@seekersai.org")!;

  // ── Transactions ──────────────────────────────────────────
  await db.insert(transactions).values([
    { date: "2026-03-01", type: "income" as const,  amount: "12500", category: "Consulting",    clientId: c1.id, clientName: "NovaTech",    status: "completed" as const, createdBy: u1.id },
    { date: "2026-03-03", type: "expense" as const, amount: "2400",  category: "Software",                                                   status: "completed" as const, createdBy: u1.id },
    { date: "2026-03-05", type: "income" as const,  amount: "8750",  category: "Development",   clientId: c2.id, clientName: "Meridian Corp", status: "completed" as const, createdBy: u1.id },
    { date: "2026-03-07", type: "expense" as const, amount: "1850",  category: "Marketing",                                                   status: "pending" as const,   createdBy: u1.id },
    { date: "2026-03-09", type: "income" as const,  amount: "4200",  category: "Training",      clientId: c3.id, clientName: "Apex Labs",     status: "completed" as const, createdBy: u1.id },
    { date: "2026-03-11", type: "expense" as const, amount: "980",   category: "Utilities",                                                   status: "completed" as const, createdBy: u1.id },
    { date: "2026-03-13", type: "income" as const,  amount: "15800", category: "AI Integration", clientId: c4.id, clientName: "FutureScale",  status: "pending" as const,   createdBy: u1.id },
    { date: "2026-03-15", type: "expense" as const, amount: "3200",  category: "Contractor",                                                   status: "completed" as const, createdBy: u1.id },
    { date: "2026-03-17", type: "income" as const,  amount: "6300",  category: "Consulting",    clientId: c5.id, clientName: "BrightPath",   status: "completed" as const, createdBy: u1.id },
    { date: "2026-03-19", type: "expense" as const, amount: "750",   category: "Office",                                                       status: "completed" as const, createdBy: u1.id },
    { date: "2026-03-20", type: "income" as const,  amount: "9400",  category: "Development",   clientId: c6.id, clientName: "Orbit AI",      status: "completed" as const, createdBy: u1.id },
    { date: "2026-03-21", type: "expense" as const, amount: "1600",  category: "Software",                                                     status: "pending" as const,   createdBy: u1.id },
  ]);
  console.log("✅ 12 transactions created");

  // ── Tasks ─────────────────────────────────────────────────
  const [tk1, tk2, tk3] = await db.insert(tasks).values([
    { title: "Design conversation flow",  description: "Map full chatbot conversation tree", assigneeId: u1.id, priority: "high" as const,     status: "in_progress" as const, dueDate: "2026-03-22", projectId: p1.id, clientId: c1.id, createdBy: u1.id },
    { title: "Set up vector database",    description: "Configure pgvector index",            assigneeId: u3.id, priority: "critical" as const, status: "todo" as const,        dueDate: "2026-03-23", projectId: p1.id, clientId: c4.id, createdBy: u1.id },
    { title: "Build auth module",         description: "JWT-based authentication",            assigneeId: u2.id, priority: "high" as const,     status: "review" as const,      dueDate: "2026-03-20", projectId: p2.id, clientId: c2.id, createdBy: u1.id },
    { title: "Create invoice template",   description: "PDF invoice generation",              assigneeId: u4.id, priority: "medium" as const,   status: "backlog" as const,     dueDate: "2026-03-28", projectId: p2.id, clientId: c5.id, createdBy: u1.id },
    { title: "API rate limiter",          description: "Rate limiting on public endpoints",   assigneeId: u2.id, priority: "medium" as const,   status: "todo" as const,        dueDate: "2026-03-25", projectId: p3.id, clientId: c6.id, createdBy: u1.id },
    { title: "Fine-tune GPT model",       description: "Prepare dataset and run fine-tuning", assigneeId: u1.id, priority: "critical" as const, status: "in_progress" as const, dueDate: "2026-03-19", projectId: p1.id, clientId: c4.id, createdBy: u1.id },
  ]).returning();

  if (tk1) await db.insert(subtasks).values([
    { taskId: tk1.id, title: "Map happy path",    done: true,  position: 0 },
    { taskId: tk1.id, title: "Define fallbacks",  done: false, position: 1 },
  ]);
  if (tk3) await db.insert(subtasks).values([
    { taskId: tk3.id, title: "Login endpoint",      done: true,  position: 0 },
    { taskId: tk3.id, title: "Refresh token logic", done: true,  position: 1 },
    { taskId: tk3.id, title: "Middleware guard",     done: false, position: 2 },
  ]);
  console.log("✅ Tasks and subtasks created");

  // ── Leads ─────────────────────────────────────────────────
  const [l1, l2, l3, l4, l5] = await db.insert(leads).values([
    { name: "Sarah Kim",   company: "NovaTech",    email: "sarah@novatech.io",     source: "Referral",       dealValue: "24000", stage: "proposal_sent" as const, assigneeId: u1.id, lastActivity: "2026-03-20", notes: "Interested in chatbot for support team" },
    { name: "Tom Hadley",  company: "Meridian Corp",email: "tom@meridian.co",      source: "LinkedIn",       dealValue: "18500", stage: "negotiation" as const,   assigneeId: u2.id, lastActivity: "2026-03-19", notes: "Needs custom training data pipeline" },
    { name: "Anita Rao",   company: "Apex Labs",   email: "anita@apexlabs.com",   source: "Conference",     dealValue: "9200",  stage: "contacted" as const,     assigneeId: u3.id, lastActivity: "2026-03-17", notes: "Met at AI Summit Berlin" },
    { name: "Marcus Webb", company: "FutureScale", email: "marcus@futurescale.ai", source: "Website",        dealValue: "32000", stage: "new_lead" as const,      assigneeId: u1.id, lastActivity: "2026-03-21", notes: "Submitted contact form" },
    { name: "Elise Park",  company: "BrightPath",  email: "elise@brightpath.org",  source: "Referral",       dealValue: "14700", stage: "call_scheduled" as const,assigneeId: u4.id, lastActivity: "2026-03-20", notes: "Call booked for March 23" },
    { name: "Kenji Mori",  company: "Orbit AI",    email: "kenji@orbitai.jp",      source: "LinkedIn",       dealValue: "21000", stage: "closed_won" as const,    assigneeId: u2.id, lastActivity: "2026-03-14", notes: "Contract signed" },
    { name: "Rita Vasquez",company: "SilverLine",  email: "rita@silverline.co",    source: "Cold Outreach",  dealValue: "7800",  stage: "closed_lost" as const,   assigneeId: u3.id, lastActivity: "2026-03-12", notes: "Budget constraints — revisit Q3" },
  ]).returning();

  if (l1) await db.insert(leadActivities).values([
    { leadId: l1.id, type: "email" as const, description: "Sent initial proposal",    date: "2026-03-18", createdBy: u1.id },
    { leadId: l1.id, type: "call"  as const, description: "Follow-up call — positive", date: "2026-03-20", createdBy: u1.id },
  ]);
  console.log("✅ Leads and activities created");

  // ── Goals ─────────────────────────────────────────────────
  await db.insert(goals).values([
    { title: "Q1 Revenue Target", current: "147100", target: "160000", unit: "$",       period: "Q1 2026", ownerId: u1.id },
    { title: "New Clients",        current: "6",      target: "8",      unit: "clients", period: "Q1 2026", ownerId: u1.id },
    { title: "Client Retention",   current: "92",     target: "95",     unit: "%",       period: "Q1 2026", ownerId: u1.id },
  ]);
  console.log("✅ Goals created");

  console.log("\n🎉 Seed complete!");
  console.log("   Admin login: dessouky@seekersai.org / admin123!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
