import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { profiles, teamInvites } from "../db/schema";
import {
  hashPassword,
  comparePassword,
  signAccessToken,
  createRefreshToken,
  validateRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  createPasswordResetToken,
  validatePasswordResetToken,
  consumePasswordResetToken,
  toSafeProfile,
} from "../services/auth";
import { sendPasswordResetEmail, sendInviteEmail } from "../services/email";
import {
  loginSchema,
  registerSchema,
  acceptInviteSchema,
  passwordResetRequestSchema,
  passwordUpdateSchema,
  refreshTokenSchema,
} from "../utils/validators";
import { authMiddleware } from "../middleware/auth";
import type { AppEnv } from "../types";

const auth = new Hono<AppEnv>();

// ── POST /auth/login ──────────────────────────────────────
auth.post("/login", async (c) => {
  const body = loginSchema.parse(await c.req.json());

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.email, body.email.toLowerCase()))
    .limit(1);

  // Constant-time check: always run compare even on miss to prevent timing attacks
  const dummyHash = "$2b$12$invalidhashfortimingprotection000000000000000";
  const passwordMatch = profile
    ? await comparePassword(body.password, profile.password)
    : await comparePassword(body.password, dummyHash).then(() => false);

  if (!profile || !passwordMatch) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const access_token  = await signAccessToken(profile.id);
  const refresh_token = await createRefreshToken(profile.id);

  return c.json({ access_token, refresh_token, user: toSafeProfile(profile) }, 200);
});

// ── POST /auth/register ───────────────────────────────────
// Allowed only if NO profiles exist yet (bootstraps the first admin)
auth.post("/register", async (c) => {
  const body = registerSchema.parse(await c.req.json());

  // Guard: only first user allowed via this endpoint
  const [existing] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .limit(1);

  if (existing) {
    return c.json(
      { error: "Forbidden", message: "Registration is invite-only. Use /auth/accept-invite." },
      403,
    );
  }

  const password = await hashPassword(body.password);
  const [profile] = await db
    .insert(profiles)
    .values({
      name:     body.name,
      email:    body.email.toLowerCase(),
      password,
      role:     "admin", // first user is always admin
    })
    .returning();

  const access_token  = await signAccessToken(profile.id);
  const refresh_token = await createRefreshToken(profile.id);

  return c.json({ access_token, refresh_token, user: toSafeProfile(profile) }, 201);
});

// ── POST /auth/accept-invite ──────────────────────────────
auth.post("/accept-invite", async (c) => {
  const body = acceptInviteSchema.parse(await c.req.json());

  const now = new Date();
  const [invite] = await db
    .select()
    .from(teamInvites)
    .where(eq(teamInvites.token, body.invite_token))
    .limit(1);

  if (!invite) {
    return c.json({ error: "Invalid invite token" }, 400);
  }
  if (invite.used) {
    return c.json({ error: "Invite has already been used" }, 400);
  }
  if (invite.expiresAt < now) {
    return c.json({ error: "Invite has expired" }, 400);
  }

  // Check email not already registered
  const [existingUser] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.email, invite.email))
    .limit(1);

  if (existingUser) {
    return c.json({ error: "An account with this email already exists" }, 409);
  }

  const password = await hashPassword(body.password);
  const [profile] = await db
    .insert(profiles)
    .values({
      name:     body.name,
      email:    invite.email,
      password,
      role:     invite.role,
    })
    .returning();

  // Mark invite as used
  await db
    .update(teamInvites)
    .set({ used: true })
    .where(eq(teamInvites.token, body.invite_token));

  const access_token  = await signAccessToken(profile.id);
  const refresh_token = await createRefreshToken(profile.id);

  return c.json({ access_token, refresh_token, user: toSafeProfile(profile) }, 201);
});

// ── POST /auth/logout ─────────────────────────────────────
auth.post("/logout", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const refreshToken = (body as any).refresh_token as string | undefined;

  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }

  return c.json({ message: "Logged out" }, 200);
});

// ── GET /auth/me ──────────────────────────────────────────
auth.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");
  return c.json(toSafeProfile(user), 200);
});

// ── POST /auth/refresh ────────────────────────────────────
auth.post("/refresh", async (c) => {
  const body = refreshTokenSchema.parse(await c.req.json());

  const userId = await validateRefreshToken(body.refresh_token);
  if (!userId) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }

  // Rotate: delete old token, issue new one
  const newRefreshToken  = await rotateRefreshToken(body.refresh_token, userId);
  const newAccessToken   = await signAccessToken(userId);

  return c.json(
    { access_token: newAccessToken, refresh_token: newRefreshToken },
    200,
  );
});

// ── POST /auth/password-reset ─────────────────────────────
auth.post("/password-reset", async (c) => {
  const body = passwordResetRequestSchema.parse(await c.req.json());

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.email, body.email.toLowerCase()))
    .limit(1);

  // Always respond 200 to prevent email enumeration
  if (!profile) {
    return c.json({ message: "If that email exists, a reset link has been sent." }, 200);
  }

  const token    = await createPasswordResetToken(profile.id);
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:8080";
  const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

  try {
    await sendPasswordResetEmail(profile.email, resetUrl);
  } catch (err) {
    console.error("[auth] Failed to send password reset email:", (err as Error).message);
  }

  return c.json({ message: "If that email exists, a reset link has been sent." }, 200);
});

// ── POST /auth/password-update ────────────────────────────
auth.post("/password-update", async (c) => {
  const body = passwordUpdateSchema.parse(await c.req.json());

  const userId = await validatePasswordResetToken(body.token);
  if (!userId) {
    return c.json({ error: "Invalid or expired reset token" }, 400);
  }

  const newHash = await hashPassword(body.password);

  await db
    .update(profiles)
    .set({ password: newHash, updatedAt: new Date() })
    .where(eq(profiles.id, userId));

  await consumePasswordResetToken(body.token);

  return c.json({ message: "Password updated successfully" }, 200);
});

export default auth;
