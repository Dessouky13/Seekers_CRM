// Bottom tab bar — the primary navigation on phones.
//
// The sidebar collapses to a hamburger drawer on mobile, which is a desktop
// pattern shrunk down: every navigation costs two taps (open drawer, choose)
// and the targets sit at the top of the screen, the hardest place to reach
// one-handed. A native app puts its main destinations along the bottom edge,
// permanently visible and inside thumb reach.
//
// Five slots, because a sixth stops being tappable at 375px. Four destinations
// plus "More", which opens the full drawer for everything else.
import { Sun, Users, CheckSquare, Send, MoreHorizontal } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";
import { useCurrentUser } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

/** Member-visible by design: these four are the daily loop for every role. */
const TABS = [
  { title: "Today",    url: "/",         icon: Sun },
  { title: "Leads",    url: "/crm",      icon: Users },
  { title: "Tasks",    url: "/tasks",    icon: CheckSquare },
  { title: "Outreach", url: "/outreach", icon: Send },
];

export function MobileTabBar() {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const user = useCurrentUser();

  // Rendered for every role — the four tabs are all member-accessible, and
  // "More" only ever lists what the sidebar already filters by role.
  if (!user) return null;

  return (
    <nav
      aria-label="Primary"
      // pb uses the safe-area inset so the bar clears the home indicator on a
      // notched phone instead of sitting under it.
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "border-t border-border/80 bg-background/95 backdrop-blur-lg",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="flex items-stretch">
        {TABS.map((tab) => {
          const active = tab.url === "/"
            ? pathname === "/"
            : pathname.startsWith(tab.url);
          const Icon = tab.icon;
          return (
            <li key={tab.url} className="flex-1">
              <NavLink
                to={tab.url}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {/* The pill behind the active icon is what makes the current
                    tab readable at a glance without relying on colour alone. */}
                <span className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                  active && "bg-primary/12",
                )}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[10px] font-medium leading-none">{tab.title}</span>
              </NavLink>
            </li>
          );
        })}

        <li className="flex-1">
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            aria-label="More pages"
            className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-muted-foreground transition-colors active:text-foreground"
          >
            <span className="flex h-7 w-12 items-center justify-center rounded-full">
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
