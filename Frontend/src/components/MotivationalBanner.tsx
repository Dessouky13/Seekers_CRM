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
    // Re-show every 30 seconds with a new message
    const cycle = setInterval(() => {
      setMsgIdx((i) => (i + 1) % MESSAGES.length);
      setDismissed(false);
      setVisible(true);
    }, 30_000);
    return () => clearInterval(cycle);
  }, []);

  const show = visible && !dismissed;

  return (
    <div
      className={cn(
        "fixed top-4 right-4 z-50 max-w-xs transition-all duration-500",
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
          className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
