import { useState, useRef, useEffect } from "react";
import { Search, Bell, ChevronDown, Menu, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser, useLogout } from "@/hooks/useAuth";
import { useNotifications, useMarkAllRead, useDeleteNotification, useMarkRead } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";

export function Topbar() {
  const user    = useCurrentUser();
  const logout  = useLogout();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);

  const { data: notifications = [] } = useNotifications();
  const markAllRead = useMarkAllRead();
  const markRead = useMarkRead();
  const deleteNotif = useDeleteNotification();

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleLogout = () => {
    logout.mutate(undefined, { onSettled: () => navigate("/login") });
  };

  const initials = user?.avatar ?? user?.name?.slice(0, 2).toUpperCase() ?? "?";

  const NAV_ITEMS = [
    { label: "Dashboard", path: "/", keywords: "home overview kpis" },
    { label: "Finance", path: "/finance", keywords: "transactions income expense money" },
    { label: "Tasks", path: "/tasks", keywords: "kanban todo projects work" },
    { label: "Clients", path: "/clients", keywords: "customers contacts company" },
    { label: "CRM", path: "/crm", keywords: "leads pipeline sales deals" },
    { label: "Goals", path: "/goals", keywords: "okr targets progress" },
    { label: "Notes", path: "/notes", keywords: "team notes board" },
    { label: "Vault", path: "/vault", keywords: "passwords secrets secure" },
    { label: "Settings", path: "/settings", keywords: "team users profile account" },
  ];

  const filtered = searchQuery.trim()
    ? NAV_ITEMS.filter((item) =>
        `${item.label} ${item.keywords}`.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : NAV_ITEMS;

  // Close search on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keyboard shortcut: Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 backdrop-blur-sm px-4">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground">
        <Menu className="h-4 w-4" />
      </SidebarTrigger>

      <div className="relative flex-1 max-w-md" ref={searchRef}>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search pages… (Ctrl+K)"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
          onFocus={() => setSearchOpen(true)}
          className="pl-9 h-8 bg-muted/50 border-transparent text-sm placeholder:text-muted-foreground/60 focus:bg-muted focus:border-border"
        />
        {searchOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-border bg-popover shadow-lg z-50 overflow-hidden">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-muted-foreground">No results</div>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.path}
                  onClick={() => { navigate(item.path); setSearchOpen(false); setSearchQuery(""); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors text-left"
                >
                  <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  {item.label}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Notifications bell */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-8 w-8 text-muted-foreground hover:text-foreground">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Notifications {unreadCount > 0 && `(${unreadCount})`}
              </span>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  className="text-xs text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">No notifications</div>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <div key={n.id} className={cn("px-3 py-2.5 border-b border-border/50 hover:bg-muted/30 flex items-start justify-between gap-2", !n.read && "bg-primary/5")}>
                  <button
                    onClick={() => {
                      if (!n.read) markRead.mutate({ id: n.id, read: true });
                      if (n.link) navigate(n.link);
                    }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <p className={cn("text-xs font-medium truncate", !n.read && "text-foreground")}>{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">{n.createdAt.slice(0, 10)}</p>
                  </button>
                  <button onClick={() => deleteNotif.mutate(n.id)} className="shrink-0 p-0.5 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 gap-2 px-2 text-sm text-muted-foreground hover:text-foreground">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
                {initials}
              </div>
              <span className="hidden sm:inline">{user?.name ?? "…"}</span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem className="text-xs text-muted-foreground" disabled>
              {user?.email}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/settings")}>Profile & Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={handleLogout}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
