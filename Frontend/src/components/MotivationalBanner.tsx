import { useState, useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

const MESSAGES = [
  "Every lead closed is a step toward our vision. Keep pushing!",
  "Great work is happening here. Stay focused, stay sharp!",
  "The best way to predict the future is to create it.",
  "Your effort today builds tomorrow's success.",
  "Excellence is not a skill, it's an attitude. You've got this!",
  "Small wins every day lead to big victories. Keep going!",
  "The team that hustles together, wins together.",
  "Today's hard work is tomorrow's results.",
  "Build something you're proud of. We're getting there!",
  "Focus. Execute. Repeat. That's how we win.",
  "Seekers AI is building something great — and you're part of it.",
  "Every client we help is proof of what this team is capable of.",
];

export function MotivationalBanner() {
  const [visible, setVisible]   = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [msgIdx, setMsgIdx]     = useState(0);

  useEffect(() => {
    // Show after 3s on first load
    const initial = setTimeout(() => {
      setMsgIdx(Math.floor(Math.random() * MESSAGES.length));
      setVisible(true);
      setDismissed(false);
    }, 3000);
    return () => clearTimeout(initial);
  }, []);

  useEffect(() => {
    if (!visible) return;
    // Auto-hide after 6 seconds
    const hide = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(hide);
  }, [visible]);

  useEffect(() => {
    // Re-show every 30 seconds with a new message — but never un-dismiss.
    //
    // This used to call setDismissed(false) on every cycle, so the X had no
    // lasting effect: close it and it was back 30 seconds later, forever. That
    // is a WCAG 2.2.2 failure, and on a 375px screen it mattered more than it
    // sounds — see the positioning note below.
    const cycle = setInterval(() => {
      setMsgIdx((i) => (i + 1) % MESSAGES.length);
      setVisible(true);
    }, 30_000);
    return () => clearInterval(cycle);
  }, []);

  const show = visible && !dismissed;

  // Unmount rather than fade to opacity-0.
  //
  // The old version stayed mounted permanently, so its dismiss button sat in the
  // tab order and its text in the accessibility tree on every page, invisible but
  // reachable. Returning null is also what makes the dismissal honest: there is
  // nothing left to re-appear.
  if (dismissed) return null;

  return (
    <div
      className={cn(
        // top-14 clears the Topbar (h-14). At `top-4 right-4` with max-w-xs this
        // spanned x=39..359 of a 375px viewport — the full width — sitting over
        // the hamburger, search, notification bell and user menu at z-50 against
        // the Topbar's z-30. For 6 seconds in every 30, the primary navigation
        // was covered by an inspirational quote that could not be closed.
        "fixed right-4 top-[calc(3.5rem+0.5rem)] z-20 max-w-xs transition-all duration-500",
        show ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 -translate-y-2 pointer-events-none",
      )}
    >
      <div className="rounded-xl border border-primary/30 bg-card/95 backdrop-blur-sm shadow-lg shadow-primary/10 p-4 pr-8">
        <div className="flex gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <p className="text-sm text-foreground leading-snug">{MESSAGES[msgIdx]}</p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          type="button"
          aria-label="Dismiss message"
          // 20x20 before — under half the 44px minimum, on the one control the
          // user most wants to hit.
          className="absolute right-1 top-1 grid h-11 w-11 place-items-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
