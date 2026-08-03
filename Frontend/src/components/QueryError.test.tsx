import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryError } from "./QueryError";

// The bug this guards: 13 of 14 pages rendered a failed request as their EMPTY
// state — "No tasks found.", "No clients found.", "No entries yet." — so a 500
// was indistinguishable from having no data, and there was nothing to press.

describe("QueryError", () => {
  it("says the data could not be loaded, not that there is none", () => {
    render(<QueryError what="your tasks" />);
    expect(screen.getByText("Couldn't load your tasks")).toBeInTheDocument();
    // The exact wording that made this a bug.
    expect(screen.queryByText(/no tasks found/i)).not.toBeInTheDocument();
  });

  it("reassures that the data still exists", () => {
    render(<QueryError what="your clients" />);
    expect(screen.getByText(/your data is safe/i)).toBeInTheDocument();
  });

  it("is announced to a screen reader as an error", () => {
    render(<QueryError what="your leads" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveTextContent("Error: Couldn't load your leads.");
  });

  it("calls the query's refetch when Try again is pressed", () => {
    const onRetry = vi.fn();
    render(<QueryError what="your leads" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders no button when there is nothing to retry with", () => {
    render(<QueryError what="your leads" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("disables and marks the button busy while a retry is in flight", () => {
    render(<QueryError what="your leads" onRetry={() => {}} isRetrying />);
    const button = screen.getByRole("button", { name: /retrying/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("surfaces the underlying error message rather than hiding it", () => {
    render(<QueryError what="your leads" error={new Error("Failed to fetch")} />);
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
  });

  it("accepts a plain string error", () => {
    render(<QueryError what="your leads" error="503 Service Unavailable" />);
    expect(screen.getByText("503 Service Unavailable")).toBeInTheDocument();
  });

  it("does not render an empty detail line for a non-Error rejection", () => {
    const { container } = render(<QueryError what="your leads" error={{ weird: true }} />);
    expect(container.textContent).not.toContain("[object Object]");
  });

  it("lets a caller override the headline entirely", () => {
    render(<QueryError title="The outreach scheduler is offline" />);
    expect(screen.getByText("The outreach scheduler is offline")).toBeInTheDocument();
  });
});
