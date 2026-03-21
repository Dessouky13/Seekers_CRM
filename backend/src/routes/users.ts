// Sprint 2 — Users / Team endpoints
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { profiles, teamInvites } from "../db/schema";
import { authMiddleware, adminOnly } from "../middleware/auth";
import { updateProfileSchema, inviteUserSchema } from "../utils/validators";
import { sendInviteEmail } from "../services/email";
import { toSafeProfile } from "../services/auth";
import { randomUUID } from "crypto";
import type { AppEnv } from "../types";

const users = new Hono<AppEnv>();

// GET /users — list all team members
users.get("/", authMiddleware, async (c) => {
  const all = await db.select().from(profiles).orderBy(profiles.createdAt);
  return c.json(all.map(toSafeProfile));
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
  const body      = inviteUserSchema.parse(await c.req.json());
  const inviter   = c.get("user");
  const token     = randomUUID();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  await db.insert(teamInvites).values({
    email:     body.email,
    role:      body.role,
    token,
    invitedBy: inviter.id,
    expiresAt,
  });

  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:8080";
  const inviteUrl   = `${frontendUrl}/accept-invite?token=${token}`;

  await sendInviteEmail(body.email, inviteUrl, body.role);

  return c.json({ message: "Invite sent" }, 200);
});

export default users;
