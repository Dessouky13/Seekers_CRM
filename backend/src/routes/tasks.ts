// Sprint 2 — Tasks & Projects endpoints
import { Hono } from "hono";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { tasks, subtasks, projects, profiles, clients } from "../db/schema";
import { authMiddleware, forcedAssigneeId, canAccessOwned, isAdmin } from "../middleware/auth";
import { notifyTaskAssigned } from "../services/notifications";
import {
  createTaskSchema, updateTaskSchema,
  createSubtaskSchema, createProjectSchema,
} from "../utils/validators";
import type { AppEnv } from "../types";

const tasksRouter = new Hono<AppEnv>();

// ── Projects ──────────────────────────────────────────────

tasksRouter.get("/projects", authMiddleware, async (c) => {
  const rows = await db
    .select({ project: projects, clientName: clients.name })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .orderBy(projects.createdAt);
  return c.json(rows.map(({ project, clientName }) => ({ ...project, client_name: clientName ?? null })));
});

tasksRouter.post("/projects", authMiddleware, async (c) => {
  const body = createProjectSchema.parse(await c.req.json());
  const [project] = await db
    .insert(projects)
    .values({ name: body.name, clientId: body.client_id ?? null })
    .returning();
  return c.json(project, 201);
});

// ── Tasks ─────────────────────────────────────────────────

// GET /tasks — with JOIN for names + subtasks
tasksRouter.get("/", authMiddleware, async (c) => {
  const q = c.req.query() as Record<string, string>;

  // Build conditions
  const conditions = [];
  if (q.status)      conditions.push(eq(tasks.status,      q.status as any));
  if (q.assignee_id) conditions.push(eq(tasks.assigneeId,  q.assignee_id));
  if (q.project_id)  conditions.push(eq(tasks.projectId,   q.project_id));
  if (q.client_id)   conditions.push(eq(tasks.clientId,    q.client_id));

  // Members only ever see tasks assigned to them. Enforced server-side so it
  // cannot be widened by dropping/altering the assignee_id query param.
  const forcedTask = forcedAssigneeId(c.get("user"));
  if (forcedTask) conditions.push(eq(tasks.assigneeId, forcedTask));

  const rows = await db
    .select({
      task:         tasks,
      assigneeName: profiles.name,
      assigneeAvatar: profiles.avatar,
      projectName:  projects.name,
      clientName:   clients.name,
    })
    .from(tasks)
    .leftJoin(profiles, eq(tasks.assigneeId, profiles.id))
    .leftJoin(projects, eq(tasks.projectId,  projects.id))
    .leftJoin(clients,  eq(tasks.clientId,   clients.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(tasks.createdAt);

  // Attach subtasks for each task
  const taskIds = rows.map((r) => r.task.id);
  const allSubtasks =
    taskIds.length > 0
      ? await db
          .select()
          .from(subtasks)
          .where(inArray(subtasks.taskId, taskIds))
          .orderBy(subtasks.position)
      : [];

  const subtaskMap = allSubtasks.reduce<Record<string, typeof allSubtasks>>(
    (acc, s) => {
      if (!acc[s.taskId]) acc[s.taskId] = [];
      acc[s.taskId].push(s);
      return acc;
    },
    {},
  );

  const data = rows.map(({ task, assigneeName, assigneeAvatar, projectName, clientName }) => ({
    ...task,
    assignee_name:   assigneeName,
    assignee_avatar: assigneeAvatar,
    project_name:    projectName,
    client_name:     clientName,
    subtasks:        subtaskMap[task.id] ?? [],
  }));

  return c.json({ data });
});

// POST /tasks
tasksRouter.post("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = createTaskSchema.parse(await c.req.json());

  const [task] = await db
    .insert(tasks)
    .values({
      title:       body.title,
      description: body.description ?? null,
      assigneeId:  body.assignee_id ?? null,
      priority:    body.priority    ?? "medium",
      dueDate:     body.due_date    ?? null,
      projectId:   body.project_id  ?? null,
      clientId:    body.client_id   ?? null,
      createdBy:   user.id,
    })
    .returning();

  if (task.assigneeId && task.assigneeId !== user.id) {
    await notifyTaskAssigned({
      taskId: task.id,
      assigneeId: task.assigneeId,
      taskTitle: task.title,
      assignedByName: user.name,
    });
  }

  return c.json({ ...task, subtasks: [] }, 201);
});

// GET /tasks/:id — with subtasks
tasksRouter.get("/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");

  const [row] = await db
    .select({
      task:         tasks,
      assigneeName: profiles.name,
      projectName:  projects.name,
      clientName:   clients.name,
    })
    .from(tasks)
    .leftJoin(profiles, eq(tasks.assigneeId, profiles.id))
    .leftJoin(projects, eq(tasks.projectId,  projects.id))
    .leftJoin(clients,  eq(tasks.clientId,   clients.id))
    .where(eq(tasks.id, id))
    .limit(1);

  if (!row) return c.json({ error: "Task not found" }, 404);

  // Members may only open tasks assigned to them.
  if (!canAccessOwned(c.get("user"), row.task.assigneeId)) {
    return c.json({ error: "Task not found" }, 404);
  }

  const taskSubtasks = await db
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, id))
    .orderBy(subtasks.position);

  return c.json({
    ...row.task,
    assignee_name: row.assigneeName,
    project_name:  row.projectName,
    client_name:   row.clientName,
    subtasks:      taskSubtasks,
  });
});

// PATCH /tasks/:id
tasksRouter.patch("/:id", authMiddleware, async (c) => {
  const id   = c.req.param("id");
  const user = c.get("user");
  const body = updateTaskSchema.parse(await c.req.json());

  const [existing] = await db
    .select({ id: tasks.id, assigneeId: tasks.assigneeId, title: tasks.title })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);

  if (!existing) return c.json({ error: "Task not found" }, 404);
  // Members may only edit tasks assigned to them, and cannot hand a task to
  // someone else (which would make it disappear from their own view).
  if (!canAccessOwned(user, existing.assigneeId)) {
    return c.json({ error: "Task not found" }, 404);
  }
  if (!isAdmin(user) && (body as any).assignee_id && (body as any).assignee_id !== user.id) {
    return c.json({ error: "Forbidden", message: "You cannot reassign tasks" }, 403);
  }

  // Map snake_case request fields onto columns, distinguishing "not sent"
  // (leave alone) from an explicit null (clear it). `x ?? undefined` collapsed
  // both cases to undefined, so a task's assignee, project, client or due date
  // could never be removed once set.
  const raw = body as Record<string, unknown>;
  const sent = (k: string) => Object.prototype.hasOwnProperty.call(raw, k);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (sent("title"))       updateData.title       = raw.title;
  if (sent("description")) updateData.description = raw.description ?? null;
  if (sent("priority"))    updateData.priority    = raw.priority;
  if (sent("status"))      updateData.status      = raw.status;
  if (sent("assignee_id")) updateData.assigneeId  = raw.assignee_id ?? null;
  if (sent("project_id"))  updateData.projectId   = raw.project_id  ?? null;
  if (sent("client_id"))   updateData.clientId    = raw.client_id   ?? null;
  if (sent("due_date"))    updateData.dueDate     = raw.due_date    ?? null;

  // Track completedAt: set when entering "done", clear when leaving "done"
  if (body.status === "done") updateData.completedAt = new Date();
  else if (body.status !== undefined) updateData.completedAt = null;

  const [updated] = await db
    .update(tasks)
    .set(updateData as any)
    .where(eq(tasks.id, id))
    .returning();

  const assigneeChanged = existing.assigneeId !== updated.assigneeId;
  if (assigneeChanged && updated.assigneeId && updated.assigneeId !== user.id) {
    await notifyTaskAssigned({
      taskId: updated.id,
      assigneeId: updated.assigneeId,
      taskTitle: updated.title,
      assignedByName: user.name,
    });
  }

  return c.json(updated);
});

// DELETE /tasks/:id
tasksRouter.delete("/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");

  // Members may only delete their own tasks.
  const [existing] = await db
    .select({ assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);
  if (!existing) return c.json({ error: "Task not found" }, 404);
  if (!canAccessOwned(c.get("user"), existing.assigneeId)) {
    return c.json({ error: "Task not found" }, 404);
  }

  const [deleted] = await db
    .delete(tasks)
    .where(eq(tasks.id, id))
    .returning({ id: tasks.id });

  if (!deleted) return c.json({ error: "Task not found" }, 404);
  return new Response(null, { status: 204 });
});

// ── Subtasks ──────────────────────────────────────────────

// Subtasks inherit their parent task's ownership. Returns true when the caller
// may act on this task's subtasks.
async function mayTouchTask(user: { id: string; role?: string }, taskId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const [t] = await db
    .select({ assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  return !!t && canAccessOwned(user, t.assigneeId);
}

// POST /tasks/:id/subtasks
tasksRouter.post("/:id/subtasks", authMiddleware, async (c) => {
  const taskId = c.req.param("id");
  if (!(await mayTouchTask(c.get("user"), taskId))) {
    return c.json({ error: "Task not found" }, 404);
  }
  const body = createSubtaskSchema.parse(await c.req.json());

  const [sub] = await db
    .insert(subtasks)
    .values({ taskId, title: body.title, position: body.position ?? 0 })
    .returning();
  return c.json(sub, 201);
});

// PATCH /tasks/:id/subtasks/:subId — toggle done
//
// Every subtask query below is scoped by BOTH ids. Authorising `:id` and then
// mutating by `:subId` alone let anyone who owned a single task edit or delete
// the subtasks of ANY task by passing a foreign subtask id.
tasksRouter.patch("/:id/subtasks/:subId", authMiddleware, async (c) => {
  const taskId = c.req.param("id");
  if (!(await mayTouchTask(c.get("user"), taskId))) {
    return c.json({ error: "Subtask not found" }, 404);
  }
  const subId = c.req.param("subId");
  const body  = await c.req.json().catch(() => ({}));

  const [current] = await db
    .select()
    .from(subtasks)
    .where(and(eq(subtasks.id, subId), eq(subtasks.taskId, taskId)))
    .limit(1);

  if (!current) return c.json({ error: "Subtask not found" }, 404);

  const newDone = typeof body.done === "boolean" ? body.done : !current.done;

  const [updated] = await db
    .update(subtasks)
    .set({ done: newDone })
    .where(and(eq(subtasks.id, subId), eq(subtasks.taskId, taskId)))
    .returning();

  return c.json(updated);
});

// DELETE /tasks/:id/subtasks/:subId
tasksRouter.delete("/:id/subtasks/:subId", authMiddleware, async (c) => {
  const taskId = c.req.param("id");
  if (!(await mayTouchTask(c.get("user"), taskId))) {
    return c.json({ error: "Subtask not found" }, 404);
  }
  const [deleted] = await db
    .delete(subtasks)
    .where(and(
      eq(subtasks.id,     c.req.param("subId")),
      eq(subtasks.taskId, taskId),
    ))
    .returning({ id: subtasks.id });

  if (!deleted) return c.json({ error: "Subtask not found" }, 404);
  return new Response(null, { status: 204 });
});

export default tasksRouter;

// ── Standalone router mounted at /api/v1/projects ─────────
export const projectsRouter = new Hono<AppEnv>();

projectsRouter.get("/", authMiddleware, async (c) => {
  const rows = await db
    .select({ project: projects, clientName: clients.name })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .orderBy(projects.createdAt);
  return c.json(rows.map(({ project, clientName }) => ({ ...project, client_name: clientName ?? null })));
});

projectsRouter.post("/", authMiddleware, async (c) => {
  const body = createProjectSchema.parse(await c.req.json());
  const [project] = await db
    .insert(projects)
    .values({ name: body.name, clientId: body.client_id ?? null })
    .returning();
  return c.json(project, 201);
});
