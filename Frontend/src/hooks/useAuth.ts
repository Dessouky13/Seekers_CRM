import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { storeAuth, clearAuth, getStoredUser } from "@/lib/auth";
import type { ApiUser } from "@/lib/types";

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: ApiUser;
}

export function useCurrentUser() {
  return getStoredUser();
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
