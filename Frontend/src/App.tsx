import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { SeekersBackground } from "@/components/SeekersBackground";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RouteFallback } from "@/components/RouteFallback";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { isAuthenticated } from "@/lib/auth";
import { AdminOnly } from "./components/AdminOnly";

// Today and Login are eager: one of them is always the first paint, so lazily
// loading them would only add a round trip before anything appears.
import Today from "./pages/Today";
import Login from "./pages/Login";

// Everything else is split per route. The app shipped as a single 1.4 MB chunk,
// so opening Today downloaded Finance, the KB and every chart library with it.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Finance   = lazy(() => import("./pages/Finance"));
const Economics = lazy(() => import("./pages/Economics"));
const Tasks     = lazy(() => import("./pages/Tasks"));
const CRM       = lazy(() => import("./pages/CRM"));
const Clients   = lazy(() => import("./pages/Clients"));
const Outreach  = lazy(() => import("./pages/Outreach"));
const Outbound  = lazy(() => import("./pages/Outbound"));
const Goals     = lazy(() => import("./pages/Goals"));
const Quotations = lazy(() => import("./pages/Quotations"));
const Notes     = lazy(() => import("./pages/Notes"));
const Vault     = lazy(() => import("./pages/Vault"));
const Settings  = lazy(() => import("./pages/Settings"));
const Team      = lazy(() => import("./pages/Team"));
const NotFound  = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      // The default refetch-on-focus fires a full page's worth of queries every
      // time the user alt-tabs back. With a 30s staleTime the data is fresh
      // anyway, so this was pure duplicate traffic.
      refetchOnWindowFocus: false,
    },
  },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />;
}

/** Boundary + suspense per route, reset by pathname so navigating away recovers. */
function AppRoutes() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKeys={[pathname]} label="This page">
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Everyone lands on Today — the ranked "what needs you now"
              queue. Members previously got bounced off / to /crm, so
              they had nowhere that answered that question. The admin
              financial dashboard moved to /dashboard. */}
          <Route path="/"          element={<Today />} />
          <Route path="/dashboard" element={<AdminOnly><Dashboard /></AdminOnly>} />
          <Route path="/finance"  element={<AdminOnly><Finance /></AdminOnly>} />
          <Route path="/economics" element={<AdminOnly><Economics /></AdminOnly>} />
          <Route path="/tasks"    element={<Tasks />} />
          <Route path="/clients"  element={<AdminOnly><Clients /></AdminOnly>} />
          <Route path="/crm"      element={<CRM />} />
          <Route path="/outreach" element={<Outreach />} />
          <Route path="/outbound" element={<AdminOnly><Outbound /></AdminOnly>} />
          <Route path="/goals"    element={<AdminOnly><Goals /></AdminOnly>} />
          {/* Prices, discounts and the P&L rows a paid invoice writes — admin only,
              matching ADMIN_ONLY_MODULES on the server. The public share pages are
              served by the API at /q/:token, not by this SPA. */}
          <Route path="/quotations" element={<AdminOnly><Quotations /></AdminOnly>} />
          <Route path="/notes"    element={<Notes />} />
          <Route path="/vault"    element={<AdminOnly><Vault /></AdminOnly>} />
          <Route path="/team"     element={<AdminOnly><Team /></AdminOnly>} />
          <Route path="/settings" element={<AdminOnly><Settings /></AdminOnly>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ConfirmProvider>
      <Sonner />
      <SeekersBackground />
      {/* Opt in to the v7 behaviours now. Both were logging warnings on every
          page load, and adopting them early means the eventual upgrade is not
          a behavioural change. */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <AppLayout>
                  <AppRoutes />
                </AppLayout>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
      </ConfirmProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
