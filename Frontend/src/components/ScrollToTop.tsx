// Start each new page at the top.
//
// The browser does this for free on a normal document load, but a client-side
// router only swaps the component tree — the document keeps whatever scroll
// offset the previous page left behind. Measured before this existed: scroll
// 900px down /settings, click Finance, and you arrive 900px down Finance,
// halfway through the P&L with the page header off-screen. It reads as "the
// page is stuck" or "it opened in the wrong place", which is how it was
// reported.
//
// Three deliberate choices:
//
//   • Keyed on pathname ONLY, not the full location. Filter and search state
//     lives in the query string (?assignee=…&stage=…), so keying on `search`
//     too would yank the list back to the top on every keystroke in the search
//     box — the opposite of helpful.
//
//   • POP is left alone. Going back should return you to where you were, and
//     both the browser and the router already restore that offset; resetting
//     here would fight them and break the one case where remembering matters.
//
//   • `behavior: "instant"`. A new page has no visual relationship to the old
//     scroll offset, so animating between them just delays the content. This
//     also sidesteps prefers-reduced-motion, since nothing is animated.
import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

export function ScrollToTop() {
  const { pathname } = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    if (navType === "POP") return;
    // The document is the scroller (see the note in AppLayout). Guarded because
    // jsdom in tests has no scrollTo.
    window.scrollTo?.({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, navType]);

  return null;
}
