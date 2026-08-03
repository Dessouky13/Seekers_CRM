// Floating bulk-action bar shown while rows are selected: selection count,
// "enroll in sequence" dropdown, admin-only bulk delete, and clear selection.

import { createPortal } from "react-dom";
import { Send, Trash2, ChevronDown as ChevronDownIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { Sequence } from "@/hooks/useOutreach";

export function BulkActionBar({
  selectedCount, sequences, isLoadingSequences, onEnroll, isEnrolling,
  canDelete, isDeleting, onDelete, onClear,
}: {
  selectedCount:      number;
  sequences:          Sequence[];
  isLoadingSequences: boolean;
  onEnroll:           (sequenceId: string) => void;
  isEnrolling:        boolean;
  canDelete:          boolean;
  isDeleting:         boolean;
  onDelete:           () => void;
  onClear:            () => void;
}) {
  // Rendered into document.body, not in place.
  //
  // Three things were wrong on a phone. It lived inside <main>, which carries
  // [transform:translateZ(0)] for smooth iOS scrolling — and a transform makes an
  // element a containing block for `position: fixed` descendants, so this bar was
  // pinned to the scroll container rather than the viewport and drifted with the
  // content. `bottom-6` (24px) also placed it underneath the 56px MobileTabBar,
  // and the single non-wrapping row was ~420px of content in a 375px viewport.
  // Mobile row selection is offered, so a user could select leads and then have
  // no reachable way to act on them.
  return createPortal(
    <div
      className="fixed left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 animate-fade-in
                 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] md:bottom-6 md:w-auto"
    >
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-2xl backdrop-blur-md md:flex-nowrap">
        <span className="text-sm text-foreground tabular-nums">
          <span className="font-bold text-primary">{selectedCount}</span> selected
        </span>
        <span className="text-border">·</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* Enabled while sequences load so the menu can show its loading
                state instead of the misleading "no sequences" message. */}
            <Button size="sm" className="gap-1.5 h-8" disabled={isEnrolling || (!isLoadingSequences && sequences.length === 0)}>
              {isEnrolling ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enrolling…</>
              ) : (
                <><Send className="h-3.5 w-3.5" /> Enroll in Sequence <ChevronDownIcon className="h-3.5 w-3.5" /></>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {isLoadingSequences ? (
              <>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Active sequences
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex flex-col items-start gap-1.5 px-2 py-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-2.5 w-24" />
                  </div>
                ))}
              </>
            ) : sequences.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                No active sequences. Create one in <strong>Outreach</strong>.
              </div>
            ) : (
              <>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Active sequences
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {sequences.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => onEnroll(s.id)}
                    className="flex-col items-start py-2"
                  >
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {s.step_count} step{s.step_count !== 1 ? "s" : ""}
                      {s.category && ` · ${s.category}`}
                    </span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {canDelete && (
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5 h-8"
            disabled={isDeleting}
            onClick={onDelete}
          >
            {isDeleting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…</>
              : <><Trash2 className="h-3.5 w-3.5" /> Delete</>}
          </Button>
        )}
        <button
          onClick={onClear}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear
        </button>
      </div>
    </div>,
    document.body,
  );
}
