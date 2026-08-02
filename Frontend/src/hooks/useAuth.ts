import { useMutation, useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { storeAuth, clearAuth, getStoredUser } from "@/lib/auth";
import type { ApiUser } from "@/lib/types";

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: ApiUser;
}

/**
 * The signed-in user as cached in localStorage.
 *
 * NOTE: this is a `StoredUser` — id, name, email, avatar, role only. It is
 * deliberately narrow so every page can read it synchronously with no request.
 * If you need `title`, `phone`, `signature` or the timestamps, use
 * `useCurrentProfile()` instead; reading them off this object yields undefined.
 */
export function useCurrentUser() {
  return getStoredUser();
}

/**
 * The signed-in user's FULL profile, fetched from the API.
 *
 * Settings' signature editor needs title/phone/signature, which are not in the
 * localStorage copy — it previously received the narrow StoredUser typed as
 * ApiUser, so those three fields were silently `undefined` and an existing
 * signature never loaded into the form.
 */
export function useCurrentProfile() {
  const stored = getStoredUser();
  return useQuery<ApiUser>({
    queryKey: ["profile", stored?.id],
    queryFn:  () => apiFetch(`/users/${stored!.id}`),
    enabled:  !!stored?.id,
    staleTime: 60_000,
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: async (creds: { email: string; password: string }) => {
      const res = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(creds),
      });
      storeAuth(res.access_token, res.user);
      return res;
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      try { await apiFetch("/auth/logout", { method: "POST" }); } catch { /* ignore */ }
      clearAuth();
    },
  });
}
