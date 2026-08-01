// Auth for automation (n8n) endpoints. n8n only has the AUTOMATION_API_KEY —
// it cannot obtain a user JWT — so v2 ingest endpoints authenticate with the key.
import { createMiddleware } from "hono/factory";
import { authMiddleware } from "./auth";

function keyMatches(c: { req: { header: (k: string) => string | undefined } }): boolean {
  const expected = process.env.AUTOMATION_API_KEY;
  if (!expected || expected.startsWith("replace-")) return false;
  const provided = c.req.header("X-API-Key") ?? c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  return provided === expected;
}

/** Require a valid automation API key. */
export const apiKeyAuth = createMiddleware(async (c, next) => {
  const expected = process.env.AUTOMATION_API_KEY;
  if (!expected || expected.startsWith("replace-")) {
    return c.json({ error: "Automation is not configured (AUTOMATION_API_KEY missing)" }, 503);
  }
  if (!keyMatches(c)) return c.json({ error: "Invalid API key" }, 401);
  await next();
});

/** Accept the automation API key OR a logged-in user JWT (for future CRM UI reads). */
export const jwtOrApiKey = createMiddleware(async (c, next) => {
  if (keyMatches(c)) return next();
  return authMiddleware(c, next);
});

/**
 * Accept the automation API key OR an **admin** JWT.
 *
 * Use this on outbound-machine READ endpoints. They aggregate across every
 * lead in the company (intel, events, mailbox health, audits), so a `member`
 * — who is otherwise scoped to only their own leads — must not see them.
 * n8n keeps working because the API key short-circuits before the role check.
 */
export const adminOrApiKey = createMiddleware(async (c, next) => {
  if (keyMatches(c)) return next();

  // Resolve the JWT first. authMiddleware short-circuits with a 401 Response
  // when the token is missing/invalid; it only invokes its `next` on success,
  // which is how we detect that a user was actually injected.
  let authenticated = false;
  const unauthorized = await authMiddleware(c, async () => { authenticated = true; });
  if (!authenticated) return unauthorized;

  const user = c.get("user");
  if (!user || user.role !== "admin") {
    return c.json({ error: "Forbidden", message: "Admin access required" }, 403);
  }
  await next();
});
