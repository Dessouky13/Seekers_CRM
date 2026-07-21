import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { SeekersBackground } from "@/components/SeekersBackground";
import { isAuthenticated } from "@/lib/auth";
import Dashboard from "./pages/Dashboard";
import Finance from "./pages/Finance";
import Tasks from "./pages/Tasks";
import CRM from "./pages/CRM";
import Clients from "./pages/Clients";
import Outreach from "./pages/Outreach";
import Login from "./pages/Login";
import Goals from "./pages/Goals";
import Notes from "./pages/Notes";
import Vault from "./pages/Vault";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import { AdminOnly } from "./components/AdminOnly";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RequireAuth({ children }: { children: React.ReactNode }) {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <SeekersBackground />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <AppLayout>
                  <Routes>
                    {/* Members land on CRM; the admin dashboard shows company financials */}
                    <Route path="/"         element={<AdminOnly fallback="/crm"><Dashboard /></AdminOnly>} />
                    <Route path="/finance"  element={<AdminOnly><Finance /></AdminOnly>} />
                    <Route path="/tasks"    element={<Tasks />} />
                    <Route path="/clients"  element={<AdminOnly><Clients /></AdminOnly>} />
                    <Route path="/crm"      element={<CRM />} />
                    <Route path="/outreach" element={<Outreach />} />
                    <Route path="/goals"    element={<AdminOnly><Goals /></AdminOnly>} />
                    <Route path="/notes"    element={<Notes />} />
                    <Route path="/vault"    element={<AdminOnly><Vault /></AdminOnly>} />
                    <Route path="/settings" element={<AdminOnly><Settings /></AdminOnly>} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </AppLayout>
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
