// The "how do I actually use this" panel.
//
// Sits at the top of Today until the setup steps are done, then disappears. Each
// step reads real state, so it is never narrating something the user has already
// finished, and each one carries the button that does the thing rather than
// describing where to find it.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check, ChevronRight, Compass, X, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useGuide, dismissGuide, isGuideDismissed } from "@/hooks/useGuide";
import { cn } from "@/lib/utils";

export function GettingStarted() {
  const guide = useGuide();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(isGuideDismissed);
  const [open, setOpen] = useState(true);

  // Nothing until the data lands, so a configured account never flashes a
  // "add your first lead" prompt.
  if (hidden || !guide.ready || guide.complete || guide.steps.length === 0) return null;

  const next = guide.nextStep;

  return (
    <Card className="overflow-hidden border-primary/25 bg-primary/[0.03]">
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10">
          <Compass className="h-4 w-4 text-primary" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {next ? next.title : "Finish setting up"}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {next?.why}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { dismissGuide(); setHidden(true); }}
              aria-label="Dismiss the setup guide"
              className="-m-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {next && (
              <Button size="sm" className="gap-1.5" onClick={() => navigate(next.to)}>
                {next.cta} <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="sm" variant="ghost"
              className="gap-1 text-xs"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {guide.doneCount} of {guide.steps.length} done
              <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
            </Button>
          </div>
        </div>
      </div>

      {open && (
        <ol className="border-t border-border/50">
          {guide.steps.map((s, i) => (
            <li
              key={s.id}
              className={cn(
                "flex items-start gap-3 px-4 py-2.5",
                i > 0 && "border-t border-border/30",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                  s.done
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "border border-border text-muted-foreground",
                )}
              >
                {s.done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn(
                  "text-xs font-medium",
                  s.done ? "text-muted-foreground line-through" : "text-foreground",
                )}>
                  {s.title}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {s.done && s.doneNote ? s.doneNote : s.why}
                </p>
              </div>
              {!s.done && (
                <button
                  type="button"
                  onClick={() => navigate(s.to)}
                  className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/5"
                >
                  Open
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
