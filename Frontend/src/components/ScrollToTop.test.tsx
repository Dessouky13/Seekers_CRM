// Locks in the two halves of the scroll-reset rule. Both are easy to break by
// "simplifying" the component, and each failure mode is invisible in a unit test
// that only checks the happy path:
//
//   • forward navigation MUST reset — the bug this fixed was arriving 800px down
//     a page you had just opened.
//   • Back MUST NOT reset — resetting on POP fights the browser's own
//     restoration and loses your place, which is the one case where remembering
//     the offset is the whole point.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { ScrollToTop } from "./ScrollToTop";

function Nav({ to, action }: { to: string; action: "push" | "back" }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (action === "back") navigate(-1);
    else navigate(to);
  }, [navigate, to, action]);
  return null;
}

describe("ScrollToTop", () => {
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollTo = vi.fn();
    // jsdom has no scrollTo; the component calls it optionally for that reason.
    Object.defineProperty(window, "scrollTo", { value: scrollTo, writable: true });
  });

  afterEach(() => vi.restoreAllMocks());

  it("resets scroll on a forward navigation", () => {
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <ScrollToTop />
        <Routes>
          <Route path="/a" element={<Nav to="/b" action="push" />} />
          <Route path="/b" element={<div>b</div>} />
        </Routes>
      </MemoryRouter>,
    );

    // Called with an explicit top: 0 — not just "called at all", so a future
    // change to a partial scroll would fail here.
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0, behavior: "instant" }),
    );
  });

  it("does not reset scroll when going Back", () => {
    render(
      <MemoryRouter initialEntries={["/a", "/b"]} initialIndex={1}>
        <ScrollToTop />
        <Routes>
          <Route path="/a" element={<div>a</div>} />
          <Route path="/b" element={<Nav to="/a" action="back" />} />
        </Routes>
      </MemoryRouter>,
    );

    // The initial render is a POP-free mount, and the navigate(-1) that follows
    // is a POP. Neither may scroll: the mount has nothing to reset and the POP
    // must keep the offset the browser is about to restore.
    const popCalls = scrollTo.mock.calls.length;
    expect(popCalls).toBe(0);
  });
});
