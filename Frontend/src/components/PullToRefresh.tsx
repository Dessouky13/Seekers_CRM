// Pull down at the top of a page to refetch it — the gesture people expect
// from a phone app.
//
// The data here goes stale on its own (a lead replies, a task falls overdue),
// and refetchOnWindowFocus is deliberately off to avoid duplicate traffic. On
// desktop there is a browser reload button; on a phone in standalone PWA mode
// there is no chrome at all, so without this there is no way to say "check
// again" short of navigating away and back.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Drag distance that triggers a refresh. Short enough to be easy, long enough
 *  not to fire while someone is just scrolling back up. */
const THRESHOLD = 72;
/** Cap on how far the indicator travels, so the gesture feels damped. */
const MAX_PULL = 110;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const scroller = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Only what is actually on screen — refetchType "active" leaves cached
      // data for unmounted pages alone.
      await qc.refetchQueries({ type: "active" });
    } finally {
      setRefreshing(false);
      setPull(0);
    }
  }, [qc]);

  useEffect(() => {
    // The scrolling element is <main>, not the window.
    const el = document.querySelector("main");
    if (!el) return;
    scroller.current = el;

    const onStart = (e: TouchEvent) => {
      // Only arm the gesture when already at the very top, otherwise it fights
      // normal upward scrolling.
      if (el.scrollTop > 0) { startY.current = null; return; }
      startY.current = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current === null || refreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) { setPull(0); return; }
      // Square-root damping: responsive at first, increasingly stiff, so it
      // reads as elastic rather than as the page detaching.
      const damped = Math.min(MAX_PULL, Math.sqrt(delta) * 8);
      setPull(damped);
      // Suppress the browser's own overscroll only once this is clearly a pull.
      if (damped > 8 && e.cancelable) e.preventDefault();
    };

    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      setPull((current) => {
        if (current >= THRESHOLD) { void refresh(); return THRESHOLD; }
        return 0;
      });
    };

    // passive:false on move so preventDefault can suppress overscroll.
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [refresh, refreshing]);

  const armed = pull >= THRESHOLD;

  return (
    <>
      {/* Only occupies space while pulling, so it cannot shift the layout at
          rest. aria-hidden: the gesture is touch-only and the refreshed content
          is announced by the pages themselves. */}
      <div
        aria-hidden
        className="pointer-events-none flex items-center justify-center overflow-hidden transition-[height] duration-150"
        style={{ height: refreshing ? THRESHOLD : pull }}
      >
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-sm",
            armed && !refreshing && "border-primary/50",
          )}
          style={{ opacity: Math.min(1, pull / 40) || (refreshing ? 1 : 0) }}
        >
          <RefreshCw
            className={cn("h-4 w-4", armed || refreshing ? "text-primary" : "text-muted-foreground",
              refreshing && "animate-spin")}
            style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          />
        </span>
      </div>
      {children}
    </>
  );
}
