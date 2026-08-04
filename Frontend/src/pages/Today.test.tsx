// Today.tsx only ever rendered ManualTouchCard for `focus` (live[0]). Anything
// further down fell through to QueueRow, whose click handler navigated to
// /crm?lead=… — a dead end, because the lead detail sheet has no manual-touch
// UI. So a second whatsapp/call touch waiting the same day was completely
// unreachable: no outcome buttons, nowhere to record what happened. These
// tests would fail on the old code, where clicking that row just called
// `navigate()` and rendered nothing but a plain title/reason line.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Today from "./Today";
import type { WorklistAction, WorklistResponse } from "@/hooks/useWorklist";
import { useWorklist } from "@/hooks/useWorklist";
import { useCurrentUser } from "@/hooks/useAuth";
import { cairoToday, addCalendarDays } from "@/lib/dates";

// The snooze buttons go through the real useCRM hook, so the boundary mocked
// here is the fetch itself — that way the test proves the request that would
// actually be sent, not just that a mocked hook was called.
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "@/lib/api";

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

// Today's "Skip for now" is React state — reload and the card is back. So a
// lead you had consciously decided to chase next week had to be skipped again
// every single day. These cover the snooze row that writes a real follow-up
// date instead, and the rule about which cards can have one.
describe("Today — snoozing a card to a real date", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue({});
    vi.mocked(useCurrentUser).mockReturnValue({
      id: "u1", name: "Test User", email: "t@test.com", avatar: null, role: "member",
    });
  });

  it("offers three one-tap reminders on a lead-bearing focus card", () => {
    mockWorklist([hotLead]);
    renderToday();
    expect(screen.getByText("Not today — remind me")).toBeInTheDocument();
    for (const label of ["Tomorrow", "3 days", "Next week"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("PATCHes a follow-up date onto the lead, not just local state", async () => {
    // The whole point: this has to survive a reload, so it must reach the API.
    mockWorklist([hotLead]);
    renderToday();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));

    // react-query dispatches the mutation asynchronously.
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [path, init] = vi.mocked(apiFetch).mock.calls[0];
    expect(path).toBe("/crm/leads/lead-1");
    expect(init?.method).toBe("PATCH");
    const body = JSON.parse(String(init?.body));
    // Tomorrow, in Cairo — never the UTC day.
    expect(body.follow_up_at).toBe(addCalendarDays(cairoToday(), 1));
  });

  it("sends the matching offset for each button", async () => {
    mockWorklist([hotLead]);
    renderToday();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(body.follow_up_at).toBe(addCalendarDays(cairoToday(), 7));
  });

  it("shows no snooze row on a card with no lead behind it", () => {
    // A follow-up date lives on the lead, so there is nowhere to write one for
    // a task or a blocked sequence. Offering the buttons anyway would be a
    // control that silently does nothing.
    const task: WorklistAction = {
      id: "task:t1", type: "task_due", urgency: "today", score: 420,
      title: "Ship the thing", subtitle: null, reason: "Due today",
      detail: null, deepLink: "/tasks?task=t1", leadId: null, taskId: "t1",
      dealValue: 0, ageHours: 0,
    };
    mockWorklist([task]);
    renderToday();
    expect(screen.queryByText("Not today — remind me")).not.toBeInTheDocument();
  });

  it("renders a follow_up_due card with its badge and note", () => {
    // Guards the frontend ActionType union against drifting from the backend:
    // an unknown type makes STYLE[type] undefined and blanks the card.
    const followUp: WorklistAction = {
      id: "followup:lead-9", type: "follow_up_due", urgency: "today", score: 700,
      title: "FutureScale", subtitle: "Hany Sabry",
      reason: "Follow-up due today · Negotiation",
      detail: "Said to call back after their board meeting",
      deepLink: "/crm?lead=lead-9", leadId: "lead-9", taskId: null,
      dealValue: 50000, ageHours: 0,
    };
    mockWorklist([followUp]);
    renderToday();
    expect(screen.getByText("Follow-up")).toBeInTheDocument();
    expect(screen.getByText("Follow-up due today · Negotiation")).toBeInTheDocument();
    expect(screen.getByText(/Said to call back after their board meeting/)).toBeInTheDocument();
  });
});
