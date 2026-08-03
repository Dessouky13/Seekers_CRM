// Shown while a lazily-loaded route chunk is in flight.
//
// Deliberately neutral rather than a spinner: on a warm cache a chunk resolves
// in a few milliseconds, and a spinner that flashes for one frame reads as a
// glitch. This is the generic shape shared by every page — a title, a stat
// strip and a content block — so the layout does not jump when the real page
// takes over.
import { Skeleton } from "@/components/ui/skeleton";

export function RouteFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page…</span>
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
