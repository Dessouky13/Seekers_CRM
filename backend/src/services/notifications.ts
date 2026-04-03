import { and, eq, inArray, not, sql } from "drizzle-orm";
import { db } from "../db/client";
import { notifications, notificationEvents, leads } from "../db/schema";

export type NotificationPayload = {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
};

export async function createNotification(payload: NotificationPayload) {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      link: payload.link ?? null,
    })
    .returning();

  return row;
}

export async function createUniqueNotification(eventKey: string, payload: NotificationPayload) {
  return db.transaction(async (tx) => {
    const [existingEvent] = await tx
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(and(
        eq(notificationEvents.userId, payload.userId),
        eq(notificationEvents.eventKey, eventKey),
      ))
      .limit(1);

    if (existingEvent) return null;

    const [created] = await tx
      .insert(notifications)
      .values({
        userId: payload.userId,
        type: payload.type,
        title: payload.title,
        body: payload.body ?? null,
        link: payload.link ?? null,
      })
      .returning();

    await tx.insert(notificationEvents).values({
      userId: payload.userId,
      eventKey,
    });

    return created;
  });
}

export async function notifyTaskAssigned(args: {
  taskId: string;
  assigneeId: string;
  taskTitle: string;
  assignedByName: string;
}) {
  const eventKey = `task-assigned:${args.taskId}:${args.assigneeId}`;
  return createUniqueNotification(eventKey, {
    userId: args.assigneeId,
    type: "task_assigned",
    title: "New task assigned",
    body: `${args.assignedByName} assigned you: ${args.taskTitle}`,
    link: `/tasks?task=${args.taskId}`,
  });
}

export async function runStaleLeadNotificationSweep(hoursWithoutReply = 48) {
  const intervalExpr = `${hoursWithoutReply} hours`;

  const staleLeads = await db
    .select({
      id: leads.id,
      assigneeId: leads.assigneeId,
      name: leads.name,
      company: leads.company,
      stage: leads.stage,
      lastActivity: leads.lastActivity,
    })
    .from(leads)
    .where(and(
      not(inArray(leads.stage, ["closed_won", "closed_lost"])),
      sql`${leads.assigneeId} IS NOT NULL`,
      sql`(${leads.lastActivity} IS NULL OR ${leads.lastActivity}::date <= (CURRENT_DATE - (${intervalExpr})::interval)::date)`,
    ));

  const today = new Date().toISOString().slice(0, 10);

  for (const lead of staleLeads) {
    if (!lead.assigneeId) continue;

    const eventKey = `lead-no-response:${lead.id}:${today}`;
    await createUniqueNotification(eventKey, {
      userId: lead.assigneeId,
      type: "lead_no_response",
      title: "Lead needs follow-up",
      body: `${lead.name} (${lead.company}) has no reply in ${hoursWithoutReply}+ hours`,
      link: `/crm?lead=${lead.id}`,
    });
  }

  return staleLeads.length;
}
