import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// ── Stale-deploy recovery ─────────────────────────────────
//
// Route chunks are content-hashed, so a deploy replaces every filename. A tab
// that loaded index.html before the deploy still holds the previous hashes, and
// its next lazy route import asks for a file that no longer exists. The import
// rejects and the page renders nothing — with no clue that the cause is simply
// an out-of-date tab.
//
// Reload once to pick up the new index.html. The sessionStorage flag makes it
// once per tab: if the reload does not fix it the cause is something else, and
// looping would replace a broken page with an unusable one.
const RELOADED_KEY = "seekers_reloaded_for_stale_chunk";

function recoverFromStaleChunk(reason: unknown): boolean {
  const message = String(
    (reason as { message?: string } | undefined)?.message ?? reason ?? "",
  );
  const isChunkFailure =
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    // Chrome's wording when a .js request comes back as text/html — exactly what
    // a stale chunk produced before the /assets/ rewrite exclusion was added.
    /Expected a JavaScript(-or-Wasm)? module script/i.test(message);

  if (!isChunkFailure) return false;
  if (sessionStorage.getItem(RELOADED_KEY)) return false;

  sessionStorage.setItem(RELOADED_KEY, "1");
  window.location.reload();
  return true;
}

// Vite raises this for a failed preload before the import itself rejects.
// The error is on `payload`, not `detail`.
window.addEventListener("vite:preloadError", (e) => {
  if (recoverFromStaleChunk(e.payload)) e.preventDefault();
});

window.addEventListener("unhandledrejection", (e) => {
  if (recoverFromStaleChunk(e.reason)) e.preventDefault();
});

// Clear the flag only once the app has been up for a while without a chunk
// failure, so a later deploy can still earn its one reload.
//
// Deliberately NOT cleared at startup: the reloaded page runs this same code
// before its first route import, so clearing immediately would make the flag
// absent again when that import failed — and each failure would trigger another
// reload, forever.
setTimeout(() => sessionStorage.removeItem(RELOADED_KEY), 15_000);

createRoot(document.getElementById("root")!).render(<App />);
