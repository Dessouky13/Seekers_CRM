// A promise-based replacement for window.confirm().
//
// Nine destructive actions across the app used the native dialog. It cannot be
// styled, it renders as an OS-level browser alert that reads like an error
// rather than part of the product, it blocks the main thread, and Chrome
// suppresses it entirely in some contexts — in which case the action would
// proceed or silently abort with no way to tell which.
//
// Usage keeps the same shape as the call sites it replaces:
//
//   const confirm = useConfirm();
//   if (!await confirm({ title: "Delete this?", destructive: true })) return;
//
import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title:        string;
  /** Consequences. Say what will actually happen, including to related records. */
  description?: string;
  confirmLabel?: string;
  cancelLabel?:  string;
  /** Styles the confirm button as destructive. Use for anything irreversible. */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  // Held in a ref so resolving does not depend on render timing.
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const settle = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={!!opts}
        // Covers Escape and overlay clicks as well as the Cancel button, so the
        // promise can never be left dangling.
        onOpenChange={(open) => { if (!open) settle(false); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
            {opts?.description && (
              <AlertDialogDescription className="whitespace-pre-line">
                {opts.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {opts?.cancelLabel ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(true)}
              className={cn(opts?.destructive &&
                "bg-destructive-solid text-destructive-foreground hover:bg-destructive-solid/90")}
            >
              {opts?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}
