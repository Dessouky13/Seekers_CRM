// Task templates — saved checklists, and applying one as real dated tasks.
//
//   GET    /task-templates            list templates + their items
//   POST   /task-templates            create (name + items)
//   PATCH  /task-templates/:id        rename / replace items
//   DELETE /task-templates/:id        admin only
//   POST   /task-templates/:id/apply  create the tasks
//
// The calendar arithmetic is not here — it is a pure function in
// services/task-templates.ts so the month-end cases have tests. This file is
// the database and the validation.
import { Hono } from "hono";
import { z } from "zod";
import { eq, asc, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { taskTemplates, taskTemplateItems, tasks } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { planTemplateTasks, templateSpanDays, type TemplateItem } from "../services/task-templates";
import { cairoToday } from "../utils/dates";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();

const itemSchema = z.object({
  title:      z.string().min(1).max(300),
  priority:   z.enum(["low", "medium", "high", "critical"]).optional(),
  // Bounded on both sides: a template is a checklist for a piece of work, not
  // a calendar. An unbounded offset would let one typo schedule a task in 2085.
  day_offset: z.number().int().min(-365).max(365).optional(),
});

const templateSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  // 50 is well past any real checklist and keeps one request from creating an
  // unbounded number of task rows.
  items:       z.array(itemSchema).min(1).max(50),
});

const applySchema = z.object({
  // Defaults to today in Cairo. Never `new Date().toISOString()` — between
  // local midnight and 03:00 that is yesterday, which would back-date the
  // whole checklist by a day.
  start_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  project_id:  z.string().uuid().nullable().optional(),
  client_id:   z.string().uuid().nullable().optional(),
});

/** Load templates with their items in one round trip, ordered for display. */
async function loadTemplates(ids?: string[]) {
  const rows = ids?.length
    ? await db.select().from(taskTemplates).where(inArray(taskTemplates.id, ids))
    : await db.select().from(taskTemplates).orderBy(asc(taskTemplates.name));
  if (rows.length === 0) return [];

  const items = await db
    .select().from(taskTemplateItems)
    .where(inArray(taskTemplateItems.templateId, rows.map((t) => t.id)))
    .orderBy(asc(taskTemplateItems.position));

  return rows.map((t) => {
    const own = items.filter((i) => i.templateId === t.id);
    return {
      ...t,
      items: own,
      item_count: own.length,
      span_days:  templateSpanDays(own as TemplateItem[]),
    };
  });
}

router.get("/", authMiddleware, async (c) => c.json(await loadTemplates()));

// Create and edit are open to any signed-in user, matching how projects work.
// This is a 3-person agency: making a member raise a ticket to save their own
// checklist would cost more time than the checklist saves.
router.post("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = templateSchema.parse(await c.req.json());

  const created = await db.transaction(async (tx) => {
    const [tpl] = await tx.insert(taskTemplates).values({
      name: body.name, description: body.description ?? null, createdBy: user.id,
    }).returning();

    await tx.insert(taskTemplateItems).values(body.items.map((i, idx) => ({
      templateId: tpl.id,
      title:      i.title,
      priority:   i.priority ?? "medium",
      dayOffset:  i.day_offset ?? 0,
      // Position comes from array order, not from the client — two items can
      // then never claim the same slot and render in an arbitrary order.
      position:   idx,
    })));

    return tpl;
  });

  const [full] = await loadTemplates([created.id]);
  return c.json(full, 201);
});

router.patch("/:id", authMiddleware, async (c) => {
  const id   = c.req.param("id");
  const body = templateSchema.partial().parse(await c.req.json());

  const [existing] = await db.select().from(taskTemplates).where(eq(taskTemplates.id, id)).limit(1);
  if (!existing) return c.json({ error: "Template not found" }, 404);

  await db.transaction(async (tx) => {
    await tx.update(taskTemplates).set({
      name:        body.name        ?? existing.name,
      description: body.description !== undefined ? body.description : existing.description,
      updatedAt:   new Date(),
    }).where(eq(taskTemplates.id, id));

    // Items are replaced wholesale rather than diffed. They carry no identity
    // worth preserving — nothing references a template item once the tasks are
    // created — and a diff would be a lot of code to reach the same state.
    if (body.items) {
      await tx.delete(taskTemplateItems).where(eq(taskTemplateItems.templateId, id));
      await tx.insert(taskTemplateItems).values(body.items.map((i, idx) => ({
        templateId: id,
        title:      i.title,
        priority:   i.priority ?? "medium",
        dayOffset:  i.day_offset ?? 0,
        position:   idx,
      })));
    }
  });

  const [full] = await loadTemplates([id]);
  return c.json(full);
});

// Destructive and shared across the team, so admin-only — same rule the other
// delete endpoints use.
router.delete("/:id", authMiddleware, adminOnly, async (c) => {
  const [deleted] = await db.delete(taskTemplates)
    .where(eq(taskTemplates.id, c.req.param("id"))).returning({ id: taskTemplates.id });
  if (!deleted) return c.json({ error: "Template not found" }, 404);
  return c.json({ deleted: true });
});

// ── Apply ─────────────────────────────────────────────────
router.post("/:id/apply", authMiddleware, async (c) => {
  const user = c.get("user");
  const id   = c.req.param("id");
  const body = applySchema.parse(await c.req.json().catch(() => ({})));

  const [tpl] = await db.select().from(taskTemplates).where(eq(taskTemplates.id, id)).limit(1);
  if (!tpl) return c.json({ error: "Template not found" }, 404);

  const items = await db.select().from(taskTemplateItems)
    .where(eq(taskTemplateItems.templateId, id))
    .orderBy(asc(taskTemplateItems.position));

  const planned = planTemplateTasks(items as TemplateItem[], body.start_date ?? cairoToday());
  if (planned.length === 0) {
    return c.json({ error: "This template has no items to apply" }, 400);
  }

  // Unassigned would drop every task straight into the orphan pile, so the
  // person applying the template owns the work unless they said otherwise.
  const assigneeId = body.assignee_id !== undefined ? body.assignee_id : user.id;

  const created = await db.insert(tasks).values(planned.map((t) => ({
    title:      t.title,
    priority:   t.priority,
    dueDate:    t.dueDate,
    assigneeId,
    projectId:  body.project_id ?? null,
    clientId:   body.client_id  ?? null,
    createdBy:  user.id,
    // "todo", not the "backlog" default: these were just deliberately
    // scheduled with due dates, which is the opposite of backlog.
    status:     "todo" as const,
  }))).returning();

  return c.json({
    template_id:   tpl.id,
    template_name: tpl.name,
    created:       created.length,
    tasks:         created.map((t) => ({ ...t, subtasks: [] })),
  }, 201);
});

export default router;
