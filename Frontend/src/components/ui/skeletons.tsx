import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared loading shapes.
 *
 * Only shapes repeated across three or more pages live here — anything used by
 * a single page stays local to that page so its skeleton can track the real
 * markup without a round-trip through this file.
 */

// Deterministic per-column widths. Uniform bars read as a grid of blocks;
// varying them reads as text, which is what actually arrives.
const CELL_WIDTHS = ["w-24", "w-16", "w-20", "w-28", "w-16", "w-24", "w-20", "w-28", "w-12"];

export type SkeletonColumn = string | { label?: string; className?: string };

/**
 * Placeholder for a bordered data table. The real <thead> is rendered — column
 * labels are static, so there is nothing to load and the column widths settle
 * before the rows arrive.
 */
export function TableSkeleton({
  columns,
  rows = 6,
  className,
  tableClassName = "min-w-[640px]",
}: {
  columns: SkeletonColumn[];
  rows?: number;
  /** Applied to the bordered wrapper — e.g. `bg-card` where the real table has it. */
  className?: string;
  tableClassName?: string;
}) {
  const cols = columns.map((c) => (typeof c === "string" ? { label: c } : c));

  return (
    <div className={cn("rounded-xl border border-border overflow-x-auto", className)}>
      <table className={cn("w-full text-sm", tableClassName)}>
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {cols.map((c, i) => (
              <th
                key={`${c.label ?? ""}-${i}`}
                className={cn(
                  "text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider",
                  c.className,
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-border/50 last:border-0">
              {cols.map((c, i) => (
                <td key={i} className={cn("px-4 py-3", c.className)}>
                  <Skeleton className={cn("h-4", CELL_WIDTHS[i % CELL_WIDTHS.length])} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Placeholder matching `StatCard` — same padding, same line heights, so a KPI
 * row keeps its exact height when the numbers land.
 */
export function StatCardSkeleton({ withIcon = true }: { withIcon?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-16" />
        </div>
        {withIcon && <Skeleton className="h-9 w-9 rounded-lg" />}
      </div>
    </div>
  );
}
