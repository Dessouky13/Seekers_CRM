import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Topbar } from "./Topbar";
import { MobileTabBar } from "./MobileTabBar";
import { MotivationalBanner } from "@/components/MotivationalBanner";
import { CommandPalette } from "@/components/modules/CommandPalette";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ScrollToTop } from "@/components/ScrollToTop";
import { QuickAdd } from "@/components/QuickAdd";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <ScrollToTop />
      {/* 100dvh, not 100vh: on mobile Safari the browser chrome is counted in
          vh, so a 100vh layout is always taller than the visible viewport. */}
      <div className="relative z-10 flex min-h-[100dvh] w-full">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main
            className={[
              // The PAGE scrolls, not this element.
              //
              // This used to carry `overflow-auto overscroll-y-contain
              // [transform:translateZ(0)] [-webkit-overflow-scrolling:touch]`,
              // which reads like a scroll container but never was one. Its
              // ancestors are all `min-h-*` and never a definite height, so
              // `flex-1` resolved against content: on /settings this element
              // measured clientHeight === scrollHeight === 2635px inside a 900px
              // viewport. An element that never overflows never scrolls, so
              // every one of those four declarations was inert while the
              // document did the scrolling. Three bugs came out of the gap
              // between what the CSS claimed and what the browser did:
              //
              //   1. PullToRefresh read main.scrollTop as its "am I at the top?"
              //      test. On a non-scrolling element that is permanently 0, so
              //      the gesture armed at ANY position and its disarm check
              //      could never fire — a downward drag, which is how you scroll
              //      up, was captured as a pull instead.
              //   2. translateZ(0) made this a containing block, so
              //      `position: fixed` children anchored here instead of the
              //      viewport (see BulkActionBar, which now portals to body).
              //   3. Nothing reset scroll between routes, because the code was
              //      watching the wrong scroller.
              //
              // `flex-1` stays: it makes short pages fill the viewport so empty
              // states sit where you expect. Only the scroll lie is gone.
              "flex-1",
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
