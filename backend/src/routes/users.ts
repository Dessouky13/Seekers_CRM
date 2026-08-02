// Sprint 2 — Users / Team endpoints
import { Hono } from "hono";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../db/client";
import {
  profiles, teamInvites, leads, tasks, leadActivities,
  outreachEnrollments, outreachSends,
} from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { updateProfileSchema, inviteUserSchema, emailInput } from "../utils/validators";
import { sendInviteEmail } from "../services/email";
import { toSafeProfile, hashPassword } from "../services/auth";
import { randomUUID } from "crypto";
import { z } from "zod";
import type { AppEnv } from "../types";

const users = new Hono<AppEnv>();

// GET /users — list all team members
users.get("/", authMiddleware, async (c) => {
  const all = await db.select().from(profiles).orderBy(profiles.createdAt);
  return c.json(all.map(toSafeProfile));
});

// ── GET /users/work-summary ───────────────────────────────
// Per-person workload + output, for the admin Team page.
// MUST be declared before "/:id" or that route swallows it.
users.get("/work-summary", authMiddleware, adminOnly, async (c) => {
  const staleCutoff = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

  const [people, leadRows, taskRows, enrollRows, sendRows, activityRows] = await Promise.all([
    db.select().from(profiles).orderBy(profiles.createdAt),

    // Leads per assignee
    db.select({
      userId:    leads.assigneeId,
      total:     sql<number>`COUNT(*)::int`,
      open:      sql<number>`COUNT(CASE WHEN ${leads.stage} NOT IN ('closed_won','closed_lost') THEN 1 END)::int`,
      won:       sql<number>`COUNT(CASE WHEN ${leads.stage} = 'closed_won'  THEN 1 END)::int`,
      lost:      sql<number>`COUNT(CASE WHEN ${leads.stage} = 'closed_lost' THEN 1 END)::int`,
      pipeline:  sql<number>`COALESCE(SUM(CASE WHEN ${leads.stage} NOT IN ('closed_won','closed_lost') THEN ${leads.dealValue}::numeric ELSE 0 END), 0)`,
      wonValue:  sql<number>`COALESCE(SUM(CASE WHEN ${leads.stage} = 'closed_won' THEN ${leads.dealValue}::numeric ELSE 0 END), 0)`,
      stale:     sql<number>`COUNT(CASE WHEN ${leads.stage} NOT IN ('closed_won','closed_lost') AND (${leads.lastActivity} IS NULL OR ${leads.lastActivity} < ${staleCutoff}) THEN 1 END)::int`,
    }).from(leads).where(sql`${leads.assigneeId} IS NOT NULL`).groupBy(leads.assigneeId),

    // Tasks per assignee
    db.select({
      userId:      tasks.assigneeId,
      total:       sql<number>`COUNT(*)::int`,
      done:        sql<number>`COUNT(CASE WHEN ${tasks.status} = 'done' THEN 1 END)::int`,
      inProgress:  sql<number>`COUNT(CASE WHEN ${tasks.status} = 'in_progress' THEN 1 END)::int`,
      overdue:     sql<number>`COUNT(CASE WHEN ${tasks.status} <> 'done' AND ${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} < CURRENT_DATE THEN 1 END)::int`,
      doneThisWeek: sql<number>`COUNT(CASE WHEN ${tasks.completedAt} > NOW() - INTERVAL '7 days' THEN 1 END)::int`,
    }).from(tasks).where(sql`${tasks.assigneeId} IS NOT NULL`).groupBy(tasks.assigneeId),

    // Outreach enrollments on their leads
    db.select({
      userId:   leads.assigneeId,
      enrolled: sql<number>`COUNT(*)::int`,
      replied:  sql<number>`COUNT(CASE WHEN ${outreachEnrollments.status} = 'replied' THEN 1 END)::int`,
    })
      .from(outreachEnrollments)
      .innerJoin(leads, eq(outreachEnrollments.leadId, leads.id))
      .where(sql`${leads.assigneeId} IS NOT NULL`)
      .groupBy(leads.assigneeId),

    // Emails actually sent on their leads
    db.select({
      userId: leads.assigneeId,
      sends:  sql<number>`COUNT(*)::int`,
    })
      .from(outreachSends)
      .innerJoin(outreachEnrollments, eq(outreachSends.enrollmentId, outreachEnrollments.id))
      .innerJoin(leads, eq(outreachEnrollments.leadId, leads.id))
      .where(and(sql`${leads.assigneeId} IS NOT NULL`, eq(outreachSends.status, "sent")))
      .groupBy(leads.assigneeId),

    // Last logged activity by that person (proxy for "last active")
    db.select({
      userId: leadActivities.createdBy,
      last:   sql<string>`MAX(${leadActivities.createdAt})::text`,
      count7: sql<number>`COUNT(CASE WHEN ${leadActivities.createdAt} > NOW() - INTERVAL '7 days' THEN 1 END)::int`,
    }).from(leadActivities).where(sql`${leadActivities.createdBy} IS NOT NULL`).groupBy(leadActivities.createdBy),
  ]);

  const byId = <T extends { userId: string | null }>(rows: T[]) =>
    new Map(rows.filter((r) => r.userId).map((r) => [r.userId as string, r]));

  const leadMap     = byId(leadRows);
  const taskMap     = byId(taskRows);
  const enrollMap   = byId(enrollRows);
  const sendMap     = byId(sendRows);
  const activityMap = byId(activityRows);

  return c.json(people.map((p) => {
    const l = leadMap.get(p.id);
    const t = taskMap.get(p.id);
    const e = enrollMap.get(p.id);
    const s = sendMap.get(p.id);
    const a = activityMap.get(p.id);
    const taskTotal = Number(t?.total ?? 0);
    const taskDone  = Number(t?.done ?? 0);
    return {
      ...toSafeProfile(p),
      leads: {
        total:      Number(l?.total ?? 0),
        open:       Number(l?.open ?? 0),
        won:        Number(l?.won ?? 0),
        lost:       Number(l?.lost ?? 0),
        stale:      Number(l?.stale ?? 0),
        pipeline:   Number(l?.pipeline ?? 0),
        won_value:  Number(l?.wonValue ?? 0),
      },
      tasks: {
        total:           taskTotal,
        done:            taskDone,
        in_progress:     Number(t?.inProgress ?? 0),
        overdue:         Number(t?.overdue ?? 0),
        done_this_week:  Number(t?.doneThisWeek ?? 0),
        completion_rate: taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0,
      },
      outreach: {
        enrolled: Number(e?.enrolled ?? 0),
        replied:  Number(e?.replied ?? 0),
        sends:    Number(s?.sends ?? 0),
      },
      activity: {
        last_at:         a?.last ?? null,
        logged_last_7d:  Number(a?.count7 ?? 0),
      },
    };
  }));
});

// ── GET /users/:id/work ───────────────────────────────────
// Drill-in: what this person is actually working on right now.
users.get("/:id/work", authMiddleware, adminOnly, async (c) => {
  const id = c.req.param("id");
  const [person] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
  if (!person) return c.json({ error: "User not found" }, 404);

  const [theirLeads, theirTasks, recentActivity] = await Promise.all([
    db.select({
      id: leads.id, name: leads.name, company: leads.company, stage: leads.stage,
      dealValue: leads.dealValue, lastActivity: leads.lastActivity, category: leads.category,
    }).from(leads).where(eq(leads.assigneeId, id)).orderBy(desc(leads.updatedAt)).limit(50),

    db.select({
      id: tasks.id, title: tasks.title, status: tasks.status, priority: tasks.priority,
      dueDate: tasks.dueDate, completedAt: tasks.completedAt,
    }).from(tasks).where(eq(tasks.assigneeId, id)).orderBy(desc(tasks.updatedAt)).limit(50),

    db.select({
      id: leadActivities.id, type: leadActivities.type, description: leadActivities.description,
      date: leadActivities.date, createdAt: leadActivities.createdAt,
      lead_name: leads.name, lead_company: leads.company,
    })
      .from(leadActivities)
      .leftJoin(leads, eq(leadActivities.leadId, leads.id))
      .where(eq(leadActivities.createdBy, id))
      .orderBy(desc(leadActivities.createdAt))
      .limit(40),
  ]);

  return c.json({
    user:     toSafeProfile(person),
    leads:    theirLeads,
    tasks:    theirTasks,
    activity: recentActivity,
  });
});

// GET /users/:id — get profile
users.get("/:id", authMiddleware, async (c) => {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, c.req.param("id")))
    .limit(1);

  if (!profile) return c.json({ error: "User not found" }, 404);
  return c.json(toSafeProfile(profile));
});

// PATCH /users/:id — update name / avatar (own or admin)
users.patch("/:id", authMiddleware, async (c) => {
  const currentUser = c.get("user");
  const targetId    = c.req.param("id");

  if (currentUser.id !== targetId && currentUser.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = updateProfileSchema.parse(await c.req.json());

  // Only admins may change a role, and never at the cost of the last admin.
  if (body.role !== undefined) {
    if (currentUser.role !== "admin") {
      return c.json({ error: "Forbidden", message: "Only admins can change roles" }, 403);
    }
    if (body.role === "member") {
      const [{ admins }] = await db
        .select({ admins: sql<number>`COUNT(*)::int` })
        .from(profiles)
        .where(eq(profiles.role, "admin"));
      const [target] = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, targetId)).limit(1);
      if (target?.role === "admin" && Number(admins) <= 1) {
        return c.json({ error: "Cannot demote the last admin" }, 400);
      }
    }
  }

  const [updated] = await db
    .update(profiles)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(profiles.id, targetId))
    .returning();

  if (!updated) return c.json({ error: "User not found" }, 404);
  return c.json(toSafeProfile(updated));
});

// DELETE /users/:id — admin only
users.delete("/:id", authMiddleware, adminOnly, async (c) => {
  const targetId = c.req.param("id");
  const self     = c.get("user");

  if (self.id === targetId) {
    return c.json({ error: "You cannot delete yourself" }, 400);
  }

  const [deleted] = await db
    .delete(profiles)
    .where(eq(profiles.id, targetId))
    .returning({ id: profiles.id });

  if (!deleted) return c.json({ error: "User not found" }, 404);
  return new Response(null, { status: 204 });
});

// POST /users/invite — admin only
users.post("/invite", authMiddleware, adminOnly, async (c) => {
  const body      = inviteUserSchema.parse(await c.req.json());   // email is lowercased by the schema
  const inviter   = c.get("user");
  const token     = randomUUID();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  // Inviting someone who already has an account produces a token that can only
  // ever 409 at accept time — fail fast with a message the admin can act on.
  const [alreadyMember] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`LOWER(${profiles.email}) = ${body.email}`)
    .limit(1);
  if (alreadyMember) {
    return c.json({ error: "That email already belongs to a team member" }, 409);
  }

  await db.insert(teamInvites).values({
    email:     body.email,
    role:      body.role,
    token,
    invitedBy: inviter.id,
    expiresAt,
  });

  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:8080";
  const inviteUrl   = `${frontendUrl}/accept-invite?token=${token}`;

  // The invite row is already committed and valid at this point. Letting an SMTP
  // failure bubble up returned a 500, so the admin assumed nothing happened and
  // re-invited — piling up duplicate tokens for an invite that was live all
  // along. Report the delivery outcome instead and hand back the link so the
  // invite can always be passed along by hand (matches /auth/password-reset).
  let emailed = true;
  let emailError: string | null = null;
  try {
    await sendInviteEmail(body.email, inviteUrl, body.role);
  } catch (err) {
    emailed = false;
    emailError = (err as Error).message;
    console.error("[users/invite] invite created but email failed:", emailError);
  }

  return c.json({
    message: emailed
      ? "Invite sent"
      : "Invite created, but the email could not be delivered — share the link manually.",
    emailed,
    email_error: emailError,
    invite_url:  inviteUrl,
    expires_at:  expiresAt.toISOString(),
  }, 200);
});

// POST /users/create — admin only, create user directly with password
users.post("/create", authMiddleware, adminOnly, async (c) => {
  const schema = z.object({
    name:     z.string().min(1),
    email:    emailInput,                      // trimmed + lowercased before validation
    password: z.string().min(6),
    role:     z.enum(["admin", "member"]).default("member"),
  });
  const body = schema.parse(await c.req.json());

  // Case-insensitive so "Bob@x.com" can't shadow an existing "bob@x.com" row
  // created before emails were normalised.
  const [existing] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`LOWER(${profiles.email}) = ${body.email}`)
    .limit(1);
  if (existing) return c.json({ error: "Email already in use" }, 409);

  const password = await hashPassword(body.password);
  const [created] = await db
    .insert(profiles)
    .values({ name: body.name, email: body.email, password, role: body.role })
    .returning();

  return c.json(toSafeProfile(created), 201);
});

export default users;
