// The frontend used to have no idea `awaiting_action` existed at all: the
// status filter didn't offer it, the badge colour map didn't have a key for
// it (so TypeScript wouldn't even compile once the union was widened), and —
// the part with real consequences — there was no cancel control anywhere in
// the app for an enrollment stuck in that state. Pause/resume don't apply
// (there's no timer running for a step that's waiting on a human), but cancel
// is the one escape hatch that has to exist. This test would fail on the old
// code, which rendered zero action buttons for an awaiting_action row.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EnrollmentsList } from "./EnrollmentsList";
import type { Enrollment } from "@/hooks/useOutreach";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "@/lib/api";

function enrollment(over: Partial<Enrollment> = {}): Enrollment {
  return {
    id:                  "enrollment-1",
    leadId:              "lead-1",
    sequenceId:          "seq-1",
    currentStep:         1,
    status:              "awaiting_action",
    enrolledAt:          "2026-08-01T00:00:00.000Z",
    nextSendAt:          null,
    lastStepCompletedAt: null,
    completedAt:         null,
    pausedReason:        null,
    enrolledBy:          null,
    lead_name:           "Jane Doe",
    lead_company:        "Acme Co",
    lead_email:          "jane@acme.test",
    sequence_name:       "Cold outbound",
    ...over,
  };
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EnrollmentsList />
    </QueryClientProvider>,
  );
}

describe("EnrollmentsList — awaiting_action row", () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue([enrollment()]);
  });

  it("offers Cancel for an awaiting_action enrollment", async () => {
    renderList();
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("does not offer Pause or Resume for awaiting_action — no timer is running", async () => {
    renderList();
    await screen.findByRole("button", { name: "Cancel" });
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
  });

  it("renders a status filter option for Awaiting Action", async () => {
    renderList();
    await screen.findByRole("button", { name: "Cancel" });
    // The Select's own trigger renders "Active" by default; open it to reach
    // the option list rather than assuming it's already in the DOM.
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    expect(await screen.findByText("Awaiting Action")).toBeInTheDocument();
  });
});
