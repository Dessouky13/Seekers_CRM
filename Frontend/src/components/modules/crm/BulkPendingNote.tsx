// The progress indicator for a bulk operation — and the reason it is not a bar.
//
// Both bulk endpoints apply their change in a SINGLE SQL statement:
// `UPDATE leads ... WHERE id IN (...)` and one multi-row INSERT into
// lead_activities. There is no per-lead round trip, so the server has no
// intermediate milestone it could report and the client has nothing to count.
//
// A percentage bar here would therefore be driven by a timer rather than by
// work — it would show 60% while the statement had either finished or not
// started, and on a slow connection it would sit at 100% waiting. That is worse
// than no bar: it teaches people to read a number that means nothing, and it
// hides the one fact that actually matters about these operations, which is that
// they are atomic. All N leads change together, or none of them do.
//
// So this is a determinate-looking indeterminate state: the count of what is in
// flight, an animated bar with no claimed position, and a plain sentence saying
// the batch is applied in one go.

import { cn } from "@/lib/utils";

export function BulkPendingNote({
  count, verb = "Applying", className,
}: {
  count:      number;
  /** "Applying" / "Adding" — whatever the caller is doing. */
  verb?:      string;
  className?: string;
}) {
  return (
    <div
      className={cn("space-y-1.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5", className)}
      // Announced once, not on every frame: the text does not change, and
      // "assertive" would interrupt whatever the user was reading.
      role="status"
      aria-live="polite"
    >
      <p className="text-xs font-medium text-foreground">
        {verb} to {count} lead{count === 1 ? "" : "s"}…
      </p>
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted">
        {/* Indeterminate on purpose — the bar never claims a position. */}
        <div className="absolute inset-y-0 w-1/3 animate-progress-sweep rounded-full bg-primary" />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Applied in one database statement, so there is no partial progress to
        report — the whole batch succeeds or none of it does.
      </p>
    </div>
  );
}
