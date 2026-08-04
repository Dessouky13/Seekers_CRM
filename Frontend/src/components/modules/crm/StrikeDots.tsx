// The strike indicator: three dots, filled for each manual contact attempt.
//
//   ○○○  never contacted      ●○○  one attempt
//   ●●○  two attempts         ●●●  three — the limit
//
// One component, used in the lead table, the mobile lead card and the detail
// sheet, so the three surfaces cannot drift into three different renderings of
// the same fact.

import { cn } from "@/lib/utils";

/**
 * `count` is the raw total from the API and may exceed `limit`: a lead reopened
 * after the limit closed it and then chased again really does have four strikes.
 * The dots clamp — there are only three positions — but the accessible label
 * says the true number, because "3 of 3" on a lead with five attempts would hide
 * exactly the history someone is looking for.
 */
export function StrikeDots({
  count, limit = 3, size = "sm", className,
}: {
  count:      number;
  limit?:     number;
  size?:      "sm" | "md";
  className?: string;
}) {
  const filled = Math.min(count, limit);
  const atLimit = count >= limit;
  const dot = size === "md" ? "h-2.5 w-2.5" : "h-2 w-2";

  return (
    <span
      className={cn("inline-flex items-center gap-1 align-middle", className)}
      // The dots are the whole content, so the group carries the meaning. Without
      // this a screen reader announces nothing at all for a lead that has been
      // chased three times.
      role="img"
      aria-label={
        count === 0
          ? "No contact attempts"
          : `${count} contact attempt${count === 1 ? "" : "s"} of ${limit}`
      }
      title={
        count === 0
          ? "No manual contact attempts yet"
          : `${count} of ${limit} manual contact attempts`
      }
    >
      {Array.from({ length: limit }).map((_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "rounded-full border transition-colors",
            dot,
            i < filled
              // Amber up to the last strike, rose on the third: the colour is the
              // warning, since a filled dot alone does not say "this is nearly
              // over" to someone glancing at a list of 200 rows.
              ? atLimit
                ? "border-rose-400/60 bg-rose-400"
                : "border-amber-400/60 bg-amber-400"
              : "border-muted-foreground/40 bg-transparent",
          )}
        />
      ))}
    </span>
  );
}
