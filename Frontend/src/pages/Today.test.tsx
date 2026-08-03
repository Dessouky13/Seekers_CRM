// Today.tsx only ever rendered ManualTouchCard for `focus` (live[0]). Anything
// further down fell through to QueueRow, whose click handler navigated to
// /crm?lead=… — a dead end, because the lead detail sheet has no manual-touch
// UI. So a second whatsapp/call touch waiting the same day was completely
// unreachable: no outcome buttons, nowhere to record what happened. These
// tests would fail on the old code, where clicking that row just called
// `navigate()` and rendered nothing but a plain title/reason line.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Today from "./Today";
import type { WorklistAction, WorklistResponse } from "@/hooks/useWorklist";
import { useWorklist } from "@/hooks/useWorklist";
import { useCurrentUser } from "@/hooks/useAuth";

vi.mock("@/hooks/useWorklist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useWorklist")>();
  return { ...actual, useWorklist: vi.fn(), usePipelineHealth: vi.fn() };
});
vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useAuth")>();
  return { ...actual, useCurrentUser: vi.fn() };
});
// GettingStarted pulls in its own set of hooks/queries that are irrelevant to
// this test and would otherwise need mocking just to keep it from crashing.
vi.mock("@/components/GettingStarted", () => ({ GettingStarted: () => null }));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

const hotLead: WorklistAction = {
  id: "hot:lead-1", type: "hot_lead", urgency: "now", score: 800,
  title: "Hot Lead Co", subtitle: "Acme", reason: "Opened their audit 3x",
  detail: null, deepLink: "/crm?lead=lead-1", leadId: "lead-1", taskId: null,
  dealValue: 5000, ageHours: 2,
};

const manualTouch: WorklistAction = {
  id: "manual:enr-2", type: "manual_touch", urgency: "now", score: 900,
  title: "Second Lead Co", subtitle: "Beta Inc", reason: "WhatsApp message ready to send",
  detail: "Hi {{first_name}}, checking in.", deepLink: "/crm?lead=lead-2",
  leadId: "lead-2", taskId: null, dealValue: 0, ageHours: 5,
  enrollmentId: "enr-2", channel: "whatsapp",
  message: "Hi {{first_name}}, checking in about {{company}}.",
  phoneE164: "+15559876543",
};

function mockWorklist(focus: WorklistAction[]) {
  const response: WorklistResponse = {
    focus,
    rest: [],
    counts: { total: focus.length, now: focus.length, today: 0, week: 0, replies: 0 },
    all_clear: focus.length === 0,
  };
  vi.mocked(useWorklist).mockReturnValue({
    data: response, isLoading: false, isError: false, error: null,
  } as unknown as ReturnType<typeof useWorklist>);
}

function renderToday() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Today />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Today — a manual touch that isn't the top item", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.mocked(useCurrentUser).mockReturnValue({
      id: "u1", name: "Test User", email: "t@test.com", avatar: null, role: "member",
    });
    // hotLead outranks manualTouch, so manualTouch lands in the queue, not focus.
    mockWorklist([hotLead, manualTouch]);
  });

  it("renders the second manual touch as a plain queue row with no outcome buttons yet", () => {
    renderToday();
    expect(screen.getByText("Second Lead Co")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sent" })).not.toBeInTheDocument();
  });

  it("expands the queue row into the actionable card on click, instead of navigating away", async () => {
    renderToday();
    // Once expanded, "Second Lead Co" also appears as the card's own <h2>, so
    // always target the queue row's copy specifically (first in DOM order).
    fireEvent.click(screen.getAllByText("Second Lead Co")[0]);

    // The real ManualTouchCard is now mounted in place — its outcome buttons exist.
    expect(await screen.findByRole("button", { name: "Sent" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "No WhatsApp" })).toBeInTheDocument();
    // And critically, it did NOT fall back to the old dead-end behaviour of
    // deep-linking to a CRM sheet with no manual-touch UI.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("collapses back on a second click", async () => {
    renderToday();
    fireEvent.click(screen.getByText("Second Lead Co"));
    await screen.findByRole("button", { name: "Sent" });
    // Once expanded, "Second Lead Co" also appears as the card's own <h2>, so
    // always target the queue row's copy specifically (first in DOM order).
    fireEvent.click(screen.getAllByText("Second Lead Co")[0]);
    expect(screen.queryByRole("button", { name: "Sent" })).not.toBeInTheDocument();
  });

  it("offers Skip on the expanded card, and skipping removes it from the queue", async () => {
    renderToday();
    // Once expanded, "Second Lead Co" also appears as the card's own <h2>, so
    // always target the queue row's copy specifically (first in DOM order).
    fireEvent.click(screen.getAllByText("Second Lead Co")[0]);
    await screen.findByRole("button", { name: "Sent" });

    // Two "Skip for now" buttons exist once expanded: FocusCard's own (for the
    // hot lead) and the expanded ManualTouchCard's. Scope to the queue Card so
    // this test can't accidentally pass by clicking the wrong one.
    const queueCard = screen.getByText("Up next").closest("div")!;
    const skipButton = within(queueCard).getByRole("button", { name: "Skip for now" });
    fireEvent.click(skipButton);

    expect(screen.queryByText("Second Lead Co")).not.toBeInTheDocument();
  });
});
