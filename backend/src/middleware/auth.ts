import { createMiddleware } from "hono/factory";
import { jwtVerify } from "jose";
import { db } from "../db/client";
import { profiles } from "../db/schema";
import { eq } from "drizzle-orm";

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
