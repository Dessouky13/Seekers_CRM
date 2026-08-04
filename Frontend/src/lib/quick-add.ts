// Opening the quick-add sheet from anywhere, on a chosen form.
//
// Same shape and the same reasoning as command-palette.ts: an event rather than
// context, and kept out of QuickAdd.tsx so that file exports only its component
// (React Fast Refresh stops working for a module that mixes the two).
//
// The extra argument here is the point. QuickAdd already owned the three create
// forms the team uses most, but the only way in was its floating button — which
// is `md:hidden`, so on a desktop there was no quick-create at all, and even on
// a phone it always opened on the "what kind of thing?" menu. Naming the kind up
// front turns "new lead" into one keystroke that lands on a focused input.

export type QuickAddKind = "lead" | "task" | "expense";

export const OPEN_QUICK_ADD = "seekers:open-quick-add";

/** Reads as intent at the call site, rather than as an event dispatch. */
export function openQuickAdd(kind?: QuickAddKind) {
  window.dispatchEvent(new CustomEvent<QuickAddKind | undefined>(OPEN_QUICK_ADD, { detail: kind }));
}
