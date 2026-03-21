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
    const status = (err as any).status as ContentfulStatusCode;
    return c.json({ error: err.message }, status);
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
