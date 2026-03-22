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
import Login from "./pages/Login";
import Goals from "./pages/Goals";
import Notes from "./pages/Notes";
import Vault from "./pages/Vault";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

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
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/finance" element={<Finance />} />
                    <Route path="/tasks" element={<Tasks />} />
                    <Route path="/clients" element={<Clients />} />
                    <Route path="/crm" element={<CRM />} />
                    <Route path="/goals" element={<Goals />} />
                    <Route path="/notes" element={<Notes />} />
                    <Route path="/vault" element={<Vault />} />
                    <Route path="/settings" element={<Settings />} />
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
