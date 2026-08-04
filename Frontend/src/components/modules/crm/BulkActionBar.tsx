// Floating bulk-action bar shown while rows are selected: selection count,
// "enroll in sequence" dropdown, edit, comment, admin-only bulk delete, and
// clear selection.

import { createPortal } from "react-dom";
import {
  Send, Trash2, ChevronDown as ChevronDownIcon, Loader2, Pencil, MessageSquarePlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { Sequence } from "@/hooks/useOutreach";

export function BulkActionBar({
  selectedCount, sequences, isLoadingSequences, onEnroll, isEnrolling,
  onEdit, isEditing, onComment, isCommenting,
  canDelete, isDeleting, onDelete, onClear,
}: {
  selectedCount:      number;
  sequences:          Sequence[];
  isLoadingSequences: boolean;
  onEnroll:           (sequenceId: string) => void;
  isEnrolling:        boolean;
  /** Opens the bulk-edit dialog. Available to members on their own leads. */
  onEdit:             () => void;
  isEditing:          boolean;
  /** Opens the bulk-comment dialog. */
  onComment:          () => void;
  isCommenting:       boolean;
  canDelete:          boolean;
  isDeleting:         boolean;
  onDelete:           () => void;
  onClear:            () => void;
}) {
  // Every action mutates the same selection, so one in flight disables the rest.
  // Without this, tapping Edit while a comment was still posting would fire a
  // second write against a selection the first one may already have changed.
  const busy = isEnrolling || isEditing || isCommenting || isDeleting;

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
            <Button size="sm" className="gap-1.5 h-8 min-h-11 md:min-h-0" disabled={busy || (!isLoadingSequences && sequences.length === 0)}>
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
        {/* Edit and Comment are NOT admin-gated: a member can already PATCH and
            comment on their own leads one at a time, and the server scopes these
            to exactly the same rows. Delete stays admin-only because it
            cascades and cannot be undone. */}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8 min-h-11 md:min-h-0"
          disabled={busy}
          onClick={onEdit}
        >
          {isEditing
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Editing…</>
            : <><Pencil className="h-3.5 w-3.5" /> Edit</>}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8 min-h-11 md:min-h-0"
          disabled={busy}
          onClick={onComment}
        >
          {isCommenting
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…</>
            : <><MessageSquarePlus className="h-3.5 w-3.5" /> Comment</>}
        </Button>
        {canDelete && (
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5 h-8 min-h-11 md:min-h-0"
            disabled={busy}
            onClick={onDelete}
          >
            {isDeleting
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Deleting…</>
              : <><Trash2 className="h-3.5 w-3.5" /> Delete</>}
          </Button>
        )}
        <button
          onClick={onClear}
          className="min-h-11 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground md:min-h-0"
        >
          Clear
        </button>
      </div>
    </div>,
    document.body,
  );
}
