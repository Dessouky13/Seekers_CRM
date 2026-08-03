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
import { openCommandPalette } from "@/lib/command-palette";
import { cn } from "@/lib/utils";

export function Topbar() {
  const user    = useCurrentUser();
  const logout  = useLogout();
  const navigate = useNavigate();

  const { data: notifications = [] } = useNotifications();
  const markAllRead = useMarkAllRead();
  const markRead = useMarkRead();
  const deleteNotif = useDeleteNotification();

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleLogout = () => {
    logout.mutate(undefined, { onSettled: () => navigate("/login") });
  };

  const initials = user?.avatar ?? user?.name?.slice(0, 2).toUpperCase() ?? "?";

  // NAV_ITEMS, its filter and a second Ctrl+K handler used to live here. All
  // three are gone with the fake search box: the hardcoded page list never
  // searched records, and its Ctrl+K listener competed with the command
  // palette's own — two handlers racing for the same shortcut, one of which
  // opened a dropdown that could not find a lead.
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 backdrop-blur-sm px-4">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground">
        <Menu className="h-4 w-4" />
      </SidebarTrigger>

      {/* Opens the command palette rather than being its own search.
          This box used to filter a hardcoded NAV_ITEMS list and nothing else,
          while claiming via aria-label to "Search pages, leads, clients and
          tasks". Typing "clinic" against 600 real leads returned "No results".
          It was also stale — "Dashboard" pointed at "/", which is Today, and
          Today, Outreach, Outbound and Team were missing entirely.
          The palette already searches all three record types server-side; it
          just had no way in except Cmd+K, which a phone does not have. */}
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label="Search leads, clients and tasks"
        className="group relative flex min-h-11 flex-1 max-w-md items-center gap-2 rounded-md border
                   border-transparent bg-muted/50 px-3 text-left text-sm text-muted-foreground/70
                   transition-colors hover:bg-muted hover:border-border
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Search leads, clients, tasks…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border px-1.5 py-0.5
                        font-mono text-[10px] text-muted-foreground/70 sm:inline-block">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {/* Notifications bell */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"} className="relative h-8 w-8 text-muted-foreground hover:text-foreground">
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
