// Bulk delete confirmation. Deliberately states the blast radius in full:
// this cascades and there is no undo. `deleteCount === null` means the dry-run
// that establishes the exact count is still in flight.

import { Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function BulkDeleteDialog({
  open, onOpenChange, deleteCount, selectedCount, isPending, onConfirm,
}: {
  open:          boolean;
  onOpenChange:  (open: boolean) => void;
  deleteCount:   number | null;
  selectedCount: number;
  isPending:     boolean;
  onConfirm:     () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {deleteCount ?? selectedCount} lead{(deleteCount ?? selectedCount) === 1 ? "" : "s"}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {deleteCount === null ? (
                <span className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking exactly what would be removed…
                </span>
              ) : (
                <>
                  <p>
                    This permanently removes {deleteCount} lead{deleteCount === 1 ? "" : "s"} along with
                    their activity timeline, outreach enrolments and send history.
                  </p>
                  <p className="font-medium text-destructive">This cannot be undone.</p>
                  {deleteCount !== selectedCount && (
                    <p className="text-xs">
                      Note: you selected {selectedCount}, but {deleteCount} still exist.
                    </p>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            disabled={deleteCount === null || deleteCount === 0 || isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Deleting…</>
              : `Delete ${deleteCount ?? ""}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
