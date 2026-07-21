import { Navigate } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useAuth";

/**
 * Route guard: renders children only for admins. Members are redirected to
 * `fallback` (default /crm — their home screen).
 *
 * This is a UX guard, NOT the security boundary. The same modules are blocked
 * server-side in backend/src/index.ts (ADMIN_ONLY_MODULES), so a member who
 * types the URL or calls the API directly still gets a 403.
 */
export function AdminOnly({
  children,
  fallback = "/crm",
}: {
  children: React.ReactNode;
  fallback?: string;
}) {
  const user = useCurrentUser();

  // Still resolving the session — render nothing rather than flashing a redirect.
  if (!user) return null;

  if (user.role !== "admin") return <Navigate to={fallback} replace />;

  return <>{children}</>;
}
