import { cors } from "hono/cors";

const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:8080",
  "http://localhost:3000",
];

export const corsMiddleware = cors({
  origin: (origin) => {
    // Support comma-separated list of allowed origins: FRONTEND_URL=https://a.com,https://b.com
    const frontendUrls = (process.env.FRONTEND_URL ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    const allowed = [...DEV_ORIGINS, ...frontendUrls];
    if (process.env.NODE_ENV === "development") return origin;
    return allowed.includes(origin) ? origin : null;
  },
  credentials:    true,
  allowHeaders:   ["Authorization", "Content-Type"],
  allowMethods:   ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  exposeHeaders:  ["Content-Length"],
  maxAge:         600,
});
