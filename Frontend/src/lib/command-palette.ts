// Opening the command palette from anywhere.
//
// This lives outside CommandPalette.tsx so that file exports only its component
// (React Fast Refresh stops working for a module that mixes components with
// other exports). An event rather than context keeps the palette the sole owner
// of its own open state — no provider, no prop-drilling through AppLayout.

export const OPEN_COMMAND_PALETTE = "seekers:open-command-palette";

/** Reads as intent at the call site, rather than as an event dispatch. */
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE));
}
