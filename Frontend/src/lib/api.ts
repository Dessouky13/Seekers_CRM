/**
 * Seekers AI — API client
 * Injects Bearer token from localStorage on every request.
 * Redirects to /login on 401.
 */
import { getStoredToken, clearAuth } from "./auth";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();

  // A FormData body must NOT carry a hand-set Content-Type. The browser derives
  // `multipart/form-data; boundary=…` from the body itself, and a literal
  // "application/json" (or even a manual multipart value, which has no boundary)
  // makes the upload unparseable server-side — Hono's parseBody() sees no parts
  // and the file arrives as undefined. Used by the lead-import file handoff.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401) {
    clearAuth();
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new Error("Invalid credentials");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    // The status and the parsed body ride along on the Error. Callers that only
    // read `.message` are unaffected; the lead-import panel needs to tell a 409
    // ("you already sent this file") apart from a 502 ("n8n is down") to offer
    // the right recovery, and re-deriving that from message text is guesswork.
    throw Object.assign(
      new Error(err.error ?? err.message ?? `HTTP ${res.status}`),
      { status: res.status, body: err },
    );
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}
