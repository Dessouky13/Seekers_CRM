// Pull down at the top of a page to refetch it.
//
// PERFORMANCE NOTE — this component was rewritten after the first version made
// the whole app feel slow and could swallow downward swipes. Two mistakes:
//
//   1. touchmove was registered with { passive: false } on the scroll
//      container. That tells the browser a handler might cancel the scroll, so
//      it cannot use the compositor fast path and must run JS before every
//      scroll frame — on every page, whether or not anyone was pulling.
//   2. It called setState on every touchmove. Since this component wraps all
//      page content, each finger movement re-rendered the entire page.
//
// Now: every listener is passive, nothing is ever preventDefault'ed, the browser
// suppresses its own bounce via overscroll-behavior in CSS, and the indicator is
// animated by writing to its style inside requestAnimationFrame. React state
// changes exactly twice per refresh (start and end) instead of ~60 times a
// second while dragging.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

/** Drag distance that triggers a refresh. */
const THRESHOLD = 70;
/** Cap on indicator travel, so the gesture feels damped. */
const MAX_PULL = 96;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const railRef = useRef<HTMLDivElement | null>(null);
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const startY  = useRef<number | null>(null);
  const pull     = useRef(0);
  const frame    = useRef(0);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Only what is mounted — leaves cached data for other pages alone.
      await qc.refetchQueries({ type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [qc]);

  useEffect(() => {
    const el = document.querySelector("main");
    if (!el) return;

    // Written straight to the DOM: no React involvement, so dragging costs one
    // style write per frame instead of a full page re-render.
    const paint = () => {
      frame.current = 0;
      const p = pull.current;
      if (railRef.current) railRef.current.style.height = `${p}px`;
      if (iconRef.current) {
        iconRef.current.style.opacity   = String(Math.min(1, p / 36));
        iconRef.current.style.transform = `rotate(${p * 3}deg)`;
      }
    };
    const schedule = () => {
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };

    const onStart = (e: TouchEvent) => {
      // Arm only at the very top, and only for a single finger — a two-finger
      // gesture is a zoom, not a pull.
      startY.current = el.scrollTop <= 0 && e.touches.length === 1
        ? e.touches[0].clientY
        : null;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const delta = e.touches[0].clientY - startY.current;

      // Finger moved up, or the page has begun scrolling: this is a scroll, not
      // a pull. Disarm and get out of the way for the rest of the gesture.
      if (delta <= 0 || el.scrollTop > 0) {
        startY.current = null;
        if (pull.current !== 0) { pull.current = 0; schedule(); }
        return;
      }

      // Square-root damping: responsive at first, then stiff, so it reads as
      // elastic rather than as the page detaching.
      pull.current = Math.min(MAX_PULL, Math.sqrt(delta) * 7);
      schedule();
    };

    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      const fired = pull.current >= THRESHOLD;
      pull.current = 0;
      schedule();
      if (fired) void refresh();
    };

    // All passive. The browser keeps its fast scrolling path, and this handler
    // can never block a scroll.
    const opts = { passive: true } as const;
    el.addEventListener("touchstart", onStart, opts);
    el.addEventListener("touchmove", onMove, opts);
    el.addEventListener("touchend", onEnd, opts);
    el.addEventListener("touchcancel", onEnd, opts);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [refresh]);

  return (
    <>
      <div
        ref={railRef}
        aria-hidden
        // Height is driven by the rAF writer while dragging; the transition only
        // covers the snap back, and is disabled during the drag by having no
        // class change. 0 at rest, so it never affects layout.
        className="pointer-events-none flex items-center justify-center overflow-hidden"
        style={{ height: refreshing ? THRESHOLD : 0, transition: "height 150ms" }}
      >
        <span
          ref={iconRef}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-sm"
          style={{ opacity: refreshing ? 1 : 0 }}
        >
          <RefreshCw className={`h-4 w-4 text-primary ${refreshing ? "animate-spin" : ""}`} />
        </span>
      </div>
      {children}
    </>
  );
}
