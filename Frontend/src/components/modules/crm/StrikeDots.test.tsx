// The dot indicator is the whole visual language of the strike system, so what
// it renders IS the feature: three positions, filled up to the count. A regression
// here (four dots, a count that overflows, or an unlabelled group) is invisible in
// a typecheck and obvious to a user.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrikeDots } from "./StrikeDots";

/** The dots are aria-hidden decorations inside a labelled group. */
function dots(container: HTMLElement) {
  return Array.from(container.querySelectorAll("span[aria-hidden]"));
}

function filledCount(container: HTMLElement) {
  return dots(container).filter((d) => /bg-(amber|rose)-400/.test(d.className)).length;
}

describe("StrikeDots — how many dots, and how many are filled", () => {
  it("always draws exactly three positions", () => {
    for (const count of [0, 1, 2, 3, 7]) {
      const { container, unmount } = render(<StrikeDots count={count} />);
      expect(dots(container)).toHaveLength(3);
      unmount();
    }
  });

  it("fills none at zero — ○○○", () => {
    const { container } = render(<StrikeDots count={0} />);
    expect(filledCount(container)).toBe(0);
  });

  it("fills one, then two, then three — ●○○ ●●○ ●●●", () => {
    for (const count of [1, 2, 3]) {
      const { container, unmount } = render(<StrikeDots count={count} />);
      expect(filledCount(container)).toBe(count);
      unmount();
    }
  });

  it("clamps the dots when the count is past the limit", () => {
    // A lead reopened after the limit closed it and chased again really does have
    // more strikes than there are positions. Four filled dots is not an option.
    const { container } = render(<StrikeDots count={5} />);
    expect(filledCount(container)).toBe(3);
  });

  it("honours a non-default limit", () => {
    const { container } = render(<StrikeDots count={4} limit={5} />);
    expect(dots(container)).toHaveLength(5);
    expect(filledCount(container)).toBe(4);
  });
});

describe("StrikeDots — colour carries the warning", () => {
  it("uses amber below the limit", () => {
    const { container } = render(<StrikeDots count={2} />);
    expect(container.innerHTML).toContain("bg-amber-400");
    expect(container.innerHTML).not.toContain("bg-rose-400");
  });

  it("switches to rose at the limit", () => {
    // Someone scanning 200 rows needs "this is nearly over" to read at a glance;
    // a filled dot alone does not say that.
    const { container } = render(<StrikeDots count={3} />);
    expect(container.innerHTML).toContain("bg-rose-400");
  });
});

describe("StrikeDots — accessible name", () => {
  it("announces something for a lead that has been chased", () => {
    // The dots are the entire content, so without a group label a screen reader
    // announces nothing at all.
    render(<StrikeDots count={2} />);
    expect(screen.getByRole("img", { name: "2 contact attempts of 3" })).toBeInTheDocument();
  });

  it("says 'attempt' in the singular for one", () => {
    render(<StrikeDots count={1} />);
    expect(screen.getByRole("img", { name: "1 contact attempt of 3" })).toBeInTheDocument();
  });

  it("announces the TRUE count when it exceeds the limit, not the clamped one", () => {
    // "3 of 3" on a lead with five attempts would hide exactly the history
    // somebody went looking for.
    render(<StrikeDots count={5} />);
    expect(screen.getByRole("img", { name: "5 contact attempts of 3" })).toBeInTheDocument();
  });

  it("has a distinct label at zero rather than '0 attempts'", () => {
    render(<StrikeDots count={0} />);
    expect(screen.getByRole("img", { name: "No contact attempts" })).toBeInTheDocument();
  });
});
