import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { MobileTabBar } from "./MobileTabBar";
import { MotivationalBanner } from "@/components/MotivationalBanner";
import { CommandPalette } from "@/components/modules/CommandPalette";
import { PullToRefresh } from "@/components/PullToRefresh";
import { QuickAdd } from "@/components/QuickAdd";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      {/* 100dvh, not 100vh: on mobile Safari the browser chrome is counted in
          vh, so a 100vh layout is always taller than the visible viewport. */}
      <div className="relative z-10 flex min-h-[100dvh] w-full">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main
            className={[
              "flex-1 overflow-auto",
              // Tighter gutters on a phone: 24px each side of a 375px screen
              // spends 13% of the width on nothing.
              "p-4 sm:p-6",
              // Clear the fixed tab bar (56px) plus the home indicator.
              "pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6",
            ].join(" ")}
          >
            <PullToRefresh>{children}</PullToRefresh>
          </main>
        </div>
      </div>
      <QuickAdd />
      <MobileTabBar />
      <MotivationalBanner />
      <CommandPalette />
    </SidebarProvider>
  );
}
