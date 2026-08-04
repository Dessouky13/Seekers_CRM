// What this pins: the panel must tell the truth about the CONFIGURED strike-3
// action before the user commits, and it must never claim data was destroyed.
// The warning wording is the only place the two policies differ visibly, so if
// the setting stopped reaching the UI these are the tests that would catch it.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrikePanel } from "./StrikePanel";
import { cairoToday } from "@/lib/dates";
import type { ApiLeadDetail, ApiLeadStrike, StrikeLimitAction } from "@/lib/types";

function strike(over: Partial<ApiLeadStrike> = {}): ApiLeadStrike {
  return {
    id: "s-1", leadId: "lead-1", channel: "whatsapp", note: null,
    date: "2026-08-05", createdBy: "u-1", createdAt: "2026-08-05T10:00:00Z",
    by_name: "Dessouky", ...over,
  };
}

function lead(over: Partial<ApiLeadDetail> = {}): ApiLeadDetail {
  return {
    id: "lead-1", name: "Jane Doe", company: "Acme", email: null, phone: null,
    source: null, category: null, dealValue: "0", stage: "contacted",
    assigneeId: "u-1", assignee_name: "Dessouky", lastActivity: null, notes: null,
    createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
    activities: [], strikes: [], strikeCount: 0, strikeLimit: 3,
    strikeLimitAction: "close_lost", ...over,
  };
}

function renderPanel(l: ApiLeadDetail) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StrikePanel lead={l} />
    </QueryClientProvider>,
  );
}

const openDialog = () => fireEvent.click(screen.getByRole("button", { name: /Record contact/ }));

describe("StrikePanel — the count and the dots", () => {
  it("shows 0/3 and an explanation when nothing has been recorded", () => {
    renderPanel(lead());
    expect(screen.getByText("0/3")).toBeInTheDocument();
    expect(screen.getByText(/No manual contact attempts recorded yet/)).toBeInTheDocument();
  });

  it("renders the history newest-first and numbers it downward", () => {
    // The API returns newest first, so the top row is the HIGHEST strike number.
    renderPanel(lead({
      strikeCount: 2,
      strikes: [
        strike({ id: "s-2", channel: "call",     note: "no answer", date: "2026-08-05" }),
        strike({ id: "s-1", channel: "whatsapp", note: "sent intro", date: "2026-08-02" }),
      ],
    }));
    const numbers = screen.getAllByText(/^#\d$/).map((n) => n.textContent);
    expect(numbers).toEqual(["#2", "#1"]);
  });

  it("names the person who recorded each strike", () => {
    // The activity timeline shows WHAT happened; this is where WHO lives.
    renderPanel(lead({ strikeCount: 1, strikes: [strike({ by_name: "Ahmed" })] }));
    expect(screen.getByText(/Ahmed/)).toBeInTheDocument();
  });

  it("labels the button with the strike about to be recorded", () => {
    renderPanel(lead({ strikeCount: 1, strikes: [strike()] }));
    openDialog();
    expect(screen.getByRole("button", { name: "Record strike 2/3" })).toBeInTheDocument();
  });
});

describe("StrikePanel — the last-strike warning matches the configured policy", () => {
  it("says nothing about the limit when the next strike is not the last", () => {
    renderPanel(lead({ strikeCount: 0 }));
    openDialog();
    expect(screen.queryByText(/This is the last strike/)).not.toBeInTheDocument();
  });

  it("warns about Closed Lost under the close_lost policy", () => {
    renderPanel(lead({
      strikeCount: 2, strikes: [strike({ id: "a" }), strike({ id: "b" })],
      strikeLimitAction: "close_lost",
    }));
    openDialog();
    const warning = screen.getByText(/This is the last strike/);
    expect(warning).toHaveTextContent("moved to Closed Lost");
    expect(warning).not.toHaveTextContent(/archiv/i);
  });

  it("warns about archiving under the archive policy", () => {
    // The two policies differ ONLY here in the UI. A stale prop would show the
    // wrong promise and the lead would vanish unexpectedly.
    renderPanel(lead({
      strikeCount: 2, strikes: [strike({ id: "a" }), strike({ id: "b" })],
      strikeLimitAction: "archive",
    }));
    openDialog();
    expect(screen.getByText(/This is the last strike/)).toHaveTextContent("archived out of the list");
  });

  it.each(["close_lost", "archive"] as StrikeLimitAction[])(
    "still warns past the limit under %s — a reopened lead can be struck again",
    (strikeLimitAction) => {
      renderPanel(lead({
        strikeCount: 4, strikeLimitAction,
        strikes: [strike({ id: "a" }), strike({ id: "b" }), strike({ id: "c" }), strike({ id: "d" })],
      }));
      openDialog();
      expect(screen.getByText(/This is the last strike/)).toBeInTheDocument();
    },
  );
});

describe("StrikePanel — an archived lead", () => {
  it("says the lead was archived and that nothing was deleted", () => {
    // The banner exists because "the lead disappeared from my list" is the only
    // symptom a user sees otherwise, and they will assume it was deleted.
    renderPanel(lead({
      strikeCount: 3, archivedAt: "2026-08-05T12:00:00Z", strikeLimitAction: "archive",
      strikes: [strike({ id: "a" }), strike({ id: "b" }), strike({ id: "c" })],
    }));
    expect(screen.getByText(/Archived after reaching 3 contact attempts/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was deleted/)).toBeInTheDocument();
  });

  it("shows no archived banner on a live lead", () => {
    renderPanel(lead({ strikeCount: 3, archivedAt: null }));
    expect(screen.queryByText(/Archived after reaching/)).not.toBeInTheDocument();
  });
});

describe("StrikePanel — the record dialog defaults", () => {
  it("defaults the date to the Cairo day, never the UTC day", () => {
    // Between Cairo midnight and 02:00 the UTC day is YESTERDAY, which would file
    // an evening WhatsApp against the previous day. Asserting the component uses
    // the shared helper rather than hand-rolling a date.
    renderPanel(lead());
    openDialog();
    expect(screen.getByLabelText("Date")).toHaveValue(cairoToday());
  });

  it("offers every channel a human might have used", () => {
    renderPanel(lead());
    openDialog();
    const select = screen.getByLabelText("How did you reach out?") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent))
      .toEqual(["WhatsApp", "Call", "Email", "Meeting", "Other"]);
  });
});
