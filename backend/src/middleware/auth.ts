import { createMiddleware } from "hono/factory";
import { jwtVerify } from "jose";
import { db } from "../db/client";
import { profiles } from "../db/schema";
import { eq, sql } from "drizzle-orm";

// How stale presence is allowed to get before we spend a write refreshing it.
// Every authenticated request could touch last_seen_at, but a busy page fires a
// dozen queries at once and none of them need second-level accuracy — the Team
// page renders "online now" from a 5-minute window anyway.
const PRESENCE_REFRESH_MS = 3 * 60_000;

/** userId -> last time we wrote presence, to avoid a write per request. */
const presenceTouched = new Map<string, number>();

function touchPresence(userId: string, lastSeenAt: Date | null) {
  const now = Date.now();
  const localLast = presenceTouched.get(userId) ?? 0;
  if (now - localLast < PRESENCE_REFRESH_MS) return;

  // The in-process map is only a fast path; the WHERE clause is what actually
  // guarantees one write per interval across restarts and multiple workers.
  presenceTouched.set(userId, now);
  if (presenceTouched.size > 5_000) presenceTouched.clear();  // unbounded-growth guard

  void db.update(profiles)
    .set({ lastSeenAt: new Date() })
    .where(sql`${profiles.id} = ${userId} AND (${profiles.lastSeenAt} IS NULL
               OR ${profiles.lastSeenAt} < NOW() - INTERVAL '3 minutes')`)
    .catch(() => { /* presence is best-effort and must never fail a request */ });
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  return new TextEncoder().encode(secret);
}

/**
 * Verifies the Bearer JWT and injects `user` (full Profile row) into Hono context.
 * Responds 401 on missing or invalid token.
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return c.json({ error: "Unauthorized", message: "Missing Bearer token" }, 401);
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const userId = payload.sub as string;

    if (!userId) {
      return c.json({ error: "Unauthorized", message: "Invalid token payload" }, 401);
    }

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile) {
      return c.json({ error: "Unauthorized", message: "User not found" }, 401);
    }

    c.set("user", profile);
    touchPresence(profile.id, profile.lastSeenAt);
    await next();
  } catch {
    return c.json({ error: "Unauthorized", message: "Invalid or expired token" }, 401);
  }
});

/**
 * Must be used AFTER authMiddleware.
 * Responds 403 if the authenticated user is not an admin.
 */
export const adminOnly = createMiddleware(async (c, next) => {
  const user = c.get("user");
  if (!user || user.role !== "admin") {
    return c.json({ error: "Forbidden", message: "Admin access required" }, 403);
  }
  await next();
});

// ── Row-level scoping helpers ─────────────────────────────
// Members only ever see records assigned to them. Admins see everything.
// These are enforced SERVER-SIDE — never trust a client-supplied assignee
// filter, or a member could just drop the query param and see all records.

export interface AuthedUser {
  id:   string;
  role: "admin" | "member";
  name: string;
  email: string;
}

export function isAdmin(user: { role?: string } | null | undefined): boolean {
  return user?.role === "admin";
}

/**
 * Returns the assignee id a query MUST be filtered by, or null when the caller
 * is an admin (no restriction). Use in list endpoints:
 *   const forced = forcedAssigneeId(user);
 *   if (forced) conditions.push(eq(table.assigneeId, forced));
 */
export function forcedAssigneeId(user: { id: string; role?: string }): string | null {
  return isAdmin(user) ? null : user.id;
}

/**
 * True when the caller may act on a record owned by `ownerId`.
 * Admins always may; members only for their own records.
 */
export function canAccessOwned(
  user: { id: string; role?: string },
  ownerId: string | null | undefined,
): boolean {
  if (isAdmin(user)) return true;
  return !!ownerId && ownerId === user.id;
}
