// The one thing every page shows when its data does not load.
//
// Thirteen of fourteen pages destructured only `isLoading` and defaulted their
// data with `= []`, so a 500, an expired session or a dropped connection fell
// straight through the loading branch into the empty state: "No tasks found.",
// "No clients found.", "No entries yet." A person reading that concludes their
// data is gone, and there is nothing on screen to press.
//
// The distinction this component exists to make is between "there is nothing"
// and "we could not find out". Those are different sentences and only one of
// them needs a button.
//
// Accessibility follows RouteFallback, which is the best example in this
// codebase: an `sr-only` label and a live region so the state change is
// announced rather than only drawn. `role="alert"` (assertive) rather than
// RouteFallback's `aria-live="polite"`, because unlike a skeleton this is
// terminal — nothing further will happen unless the user acts.
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface QueryErrorProps {
  /** What failed to load, as a noun phrase: "leads", "your transactions". */
  what?: string;
  /** Overrides the generated headline entirely. */
  title?: string;
  /** The query's own error, so the underlying message is not hidden from the user. */
  error?: unknown;
  /** Usually the query's `refetch`. Omit and no button is rendered. */
  onRetry?: () => void;
  /** The query's `isRefetching`, so the button reflects the retry in flight. */
  isRetrying?: boolean;
  /** `inline` sits inside an existing card/table; `page` stands alone. */
  variant?: "inline" | "page";
  className?: string;
}

export function QueryError({
  what = "this",
  title,
  error,
  onRetry,
  isRetrying = false,
  variant = "inline",
  className,
}: QueryErrorProps) {
  const headline = title ?? `Couldn't load ${what}`;
  // Show the real reason when there is one. "Failed to fetch" is more useful to
  // someone on a train than a reassuring sentence that explains nothing.
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : null;

  return (
    <Card
      role="alert"
      aria-live="assertive"
      className={cn("p-4", variant === "page" && "mx-auto mt-6 max-w-lg p-6", className)}
    >
      <span className="sr-only">Error: {headline}.</span>
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-destructive/10"
        >
          <AlertTriangle className="h-4 w-4 text-destructive" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{headline}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your data is safe — this request didn't get through. It's usually a
            dropped connection or an expired session.
          </p>
          {detail && (
            <p className="mt-1 break-words text-xs text-muted-foreground/70">{detail}</p>
          )}
          {onRetry && (
            <Button
              variant="outline"
              size="sm"
              // min-h-9 keeps a usable touch target without changing the desktop
              // look, matching the pattern used on the other small controls.
              className="mt-2.5 h-7 min-h-9 gap-1.5 text-xs"
              onClick={() => onRetry()}
              disabled={isRetrying}
              aria-busy={isRetrying}
            >
              <RefreshCw aria-hidden="true" className={cn("h-3 w-3", isRetrying && "animate-spin")} />
              {isRetrying ? "Retrying…" : "Try again"}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
