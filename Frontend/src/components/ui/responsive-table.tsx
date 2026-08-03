// One dataset, two presentations: a table on desktop, stacked cards on a phone.
//
// Every list in the app was a <table> in an overflow-x-auto wrapper. That stops
// the page sliding sideways, but on a 375px screen a seven-column table still
// means dragging a viewport across a grid to read one row — the columns off to
// the right are effectively invisible, and it is the worst way to present a
// list on a touch device.
//
// Columns declare a `priority`, which is what lets the same definition drive
// both layouts:
//   primary   — the card's title line
//   secondary — the line beneath it
//   meta      — a chip row (status, dates, amounts)
//   detail    — desktop table only; too minor to earn card space
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ResponsiveColumn<T> {
  /** Table header, and the label used for meta chips on mobile. */
  header: string;
  /** Cell content for both layouts. */
  cell: (row: T) => ReactNode;
  priority?: "primary" | "secondary" | "meta" | "detail";
  /** Extra classes for the desktop cell (alignment, tabular-nums…). */
  className?: string;
  /** Hide the label on the mobile chip when the value speaks for itself. */
  hideLabelOnMobile?: boolean;
}

interface Props<T> {
  rows: T[];
  columns: ResponsiveColumn<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Rendered in place of the list when there is nothing to show. */
  empty?: ReactNode;
  /** Trailing cell/section, e.g. row actions. */
  actions?: (row: T) => ReactNode;
  className?: string;
  /** Accessible name for the table. */
  caption?: string;
}

export function ResponsiveTable<T>({
  rows, columns, rowKey, onRowClick, empty, actions, className, caption,
}: Props<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  const primary   = columns.find((c) => c.priority === "primary")   ?? columns[0];
  const secondary = columns.find((c) => c.priority === "secondary");
  const meta      = columns.filter((c) => c.priority === "meta");

  return (
    <>
      {/* ── Phone: stacked cards ── */}
      <div className={cn("space-y-2 md:hidden", className)}>
        {rows.map((row) => {
          const Wrapper = onRowClick ? "button" : "div";
          return (
            <Wrapper
              key={rowKey(row)}
              {...(onRowClick
                ? { type: "button" as const, onClick: () => onRowClick(row) }
                : {})}
              className={cn(
                "w-full rounded-xl border border-border bg-card p-3 text-left",
                onRowClick && "transition-colors active:bg-muted/50",
              )}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {primary.cell(row)}
                  </div>
                  {secondary && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {secondary.cell(row)}
                    </div>
                  )}
                  {meta.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {meta.map((c) => (
                        <span key={c.header} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          {!c.hideLabelOnMobile && (
                            <span className="uppercase tracking-wide opacity-60">{c.header}</span>
                          )}
                          <span className="text-foreground/90">{c.cell(row)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {actions
                  ? <div className="shrink-0" onClick={(e) => e.stopPropagation()}>{actions(row)}</div>
                  : onRowClick && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />}
              </div>
            </Wrapper>
          );
        })}
      </div>

      {/* ── Desktop: the full table ── */}
      <div className={cn("hidden overflow-x-auto rounded-xl border border-border md:block", className)}>
        <table className="w-full text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {columns.map((c) => (
                <th
                  key={c.header}
                  scope="col"
                  className={cn(
                    "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
              {actions && <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b border-border/50 last:border-0",
                  onRowClick && "cursor-pointer transition-colors hover:bg-muted/20",
                )}
              >
                {columns.map((c) => (
                  <td key={c.header} className={cn("px-4 py-2.5", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
                {actions && (
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    {actions(row)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
