import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

export function errorHandler(err: Error, c: Context) {
  // Zod validation error → 400
  if (err instanceof ZodError) {
    return c.json(
      {
        error:   "Validation error",
        details: err.errors.map((e) => ({
          field:   e.path.join("."),
          message: e.message,
        })),
      },
      400 as ContentfulStatusCode,
    );
  }

  // Known HTTP-like errors with a status property
  if ("status" in err && typeof (err as any).status === "number") {
    const upstream = (err as any).status as number;

    // Only proxy client-side error statuses (4xx) that are safe to surface.
    // Upstream 401/403 (from OpenAI, OpenRouter, Brevo, etc.) must NOT be passed
    // through — the frontend treats 401 as "user logged out" and would auto-logout.
    if (upstream >= 400 && upstream < 500 && upstream !== 401 && upstream !== 403) {
      return c.json({ error: err.message }, upstream as ContentfulStatusCode);
    }

    // Auth / forbidden / server-side errors from upstream APIs → 502 Bad Gateway
    console.error(`[upstream-${upstream}]`, err.message);
    return c.json(
      { error: "Upstream service error", upstream_status: upstream },
      502 as ContentfulStatusCode,
    );
  }

  // Generic server error — never expose internal details to clients
  const isDev = process.env.NODE_ENV === "development";
  console.error("[error]", err.stack ?? err.message);

  return c.json(
    {
      error:   "Internal server error",
      message: isDev ? err.message : "Something went wrong",
    },
    500 as ContentfulStatusCode,
  );
}
