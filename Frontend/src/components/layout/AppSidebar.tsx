import { LayoutDashboard, DollarSign, CheckSquare, Users, Target, StickyNote, Settings, ChevronLeft, Building2, Lock, Send } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useAuth";

// SEEKERS-TODO: Replace /logo-white.png with actual logo file uploaded to /public/logo-white.png
// SEEKERS-TODO: Replace /logo-symbol.png with the Seekers symbol mark (square icon variant) uploaded to /public/logo-symbol.png

// `memberOk: true` → visible to non-admin members. Everything else is
// admin-only and is ALSO blocked server-side (see ADMIN_ONLY_MODULES in
// backend/src/index.ts) — hiding it here is convenience, not the security
// boundary.
const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Finance", url: "/finance", icon: DollarSign },
  { title: "Tasks", url: "/tasks", icon: CheckSquare, memberOk: true },
  { title: "Clients", url: "/clients", icon: Building2 },
  { title: "CRM", url: "/crm", icon: Users, memberOk: true },
  { title: "Outreach", url: "/outreach", icon: Send, memberOk: true },
  { title: "Goals", url: "/goals", icon: Target },
  { title: "Notes", url: "/notes", icon: StickyNote, memberOk: true },
  { title: "Vault", url: "/vault", icon: Lock },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const user = useCurrentUser();
  const isAdmin = user?.role === "admin";
  const visibleNavItems = isAdmin ? navItems : navItems.filter((i) => i.memberOk);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 overflow-hidden">
            {/* Seekers AI Logo */}
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg overflow-hidden bg-primary/20 ring-1 ring-primary/30">
              <img
                src="/logo-symbol.png"
                alt="Seekers AI"
                className="h-5 w-5 object-contain"
              />
            </div>
            {!collapsed && (
              <span className="text-sm font-semibold text-foreground whitespace-nowrap">
                AI Agency OS
              </span>
            )}
          </div>
          {!collapsed && (
            <button onClick={toggleSidebar} className="text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleNavItems.map((item) => {
                const isActive = item.url === "/" ? location.pathname === "/" : location.pathname.startsWith(item.url);
                const isPlaceholder = false;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild className={cn(
                      "transition-all duration-150",
                      isActive && "bg-sidebar-accent text-foreground font-medium",
                      isPlaceholder && "opacity-50"
                    )}>
                      <NavLink to={item.url} end={item.url === "/"} activeClassName="">
                        <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4">
        {!collapsed && (
          <div className="rounded-lg bg-muted/50 p-3 space-y-0.5">
            <p className="text-xs font-medium text-foreground">Seekers AI</p>
            <p className="text-xs text-muted-foreground">MVP · 4 seats</p>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
