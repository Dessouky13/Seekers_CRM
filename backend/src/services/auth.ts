import bcrypt from "bcrypt";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
import { db } from "../db/client";
import { refreshTokens, passwordResetTokens } from "../db/schema";
import { eq, and, gt } from "drizzle-orm";
import type { Profile, SafeProfile } from "../types";

const BCRYPT_ROUNDS = 12;

// ── Secret key (cached — never log this) ─────────────────
function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

// ── Password helpers ──────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function comparePassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

// ── Access token ──────────────────────────────────────────

export async function signAccessToken(userId: string): Promise<string> {
  const expiresIn = process.env.JWT_EXPIRES_IN ?? "7d";
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret());
}

export async function verifyAccessToken(token: string) {
  return jwtVerify(token, getSecret());
}

// ── Refresh token ─────────────────────────────────────────

export async function createRefreshToken(userId: string): Promise<string> {
  const token = randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

  await db.insert(refreshTokens).values({ userId, token, expiresAt });
  return token;
}

export async function validateRefreshToken(
  token: string,
): Promise<string | null> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.token, token), gt(refreshTokens.expiresAt, now)))
    .limit(1);

  return row ? row.userId : null;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await db.delete(refreshTokens).where(eq(refreshTokens.token, token));
}

export async function rotateRefreshToken(
  oldToken: string,
  userId: string,
): Promise<string> {
  await revokeRefreshToken(oldToken);
  return createRefreshToken(userId);
}

// ── Password reset token ──────────────────────────────────

export async function createPasswordResetToken(
  userId: string,
): Promise<string> {
  // Invalidate any existing tokens for this user
  await db
    .delete(passwordResetTokens)
    .where(eq(passwordResetTokens.userId, userId));

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.insert(passwordResetTokens).values({ userId, token, expiresAt });
  return token;
}

export async function validatePasswordResetToken(
  token: string,
): Promise<string | null> {
  const now = new Date();
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.token, token),
        eq(passwordResetTokens.used, false),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .limit(1);

  return row ? row.userId : null;
}

export async function consumePasswordResetToken(token: string): Promise<void> {
  await db
    .update(passwordResetTokens)
    .set({ used: true })
    .where(eq(passwordResetTokens.token, token));
}

// ── Strip password from profile ───────────────────────────

export function toSafeProfile(profile: Profile): SafeProfile {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _pw, ...safe } = profile;
  return safe;
}
