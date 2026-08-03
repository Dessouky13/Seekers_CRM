// The outcome-button set is the whole point of this card (see the file's own
// header comment): the wrong buttons appearing — or the right ones silently
// doing nothing — is exactly the "looks like nothing happened" failure mode
// this component exists to avoid. These tests would fail if someone removed
// the channel filter on "No WhatsApp" (F1/F3 review finding) or the
// enrollment-id guard on the outcome buttons (F2 review finding).
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ManualTouchCard } from "./ManualTouchCard";
import type { WorklistAction } from "@/hooks/useWorklist";

function action(over: Partial<WorklistAction> = {}): WorklistAction {
  return {
    id:        "action-1",
    type:      "manual_touch",
    urgency:   "now",
    score:     0,
    title:     "Jane Doe",
    subtitle:  "Acme Co",
    reason:    "Manual touch due",
    detail:    null,
    deepLink:  "/crm/leads/lead-1",
    leadId:    "lead-1",
    taskId:    null,
    dealValue: 0,
    ageHours:  1,
    enrollmentId: "enrollment-1",
    channel:      "whatsapp",
    message:      "Hi {{first_name}}, checking in about {{company}}.",
    phoneE164:    "+15551234567",
    ...over,
  };
}

function renderCard(a: WorklistAction) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ManualTouchCard action={a} />
    </QueryClientProvider>,
  );
}

describe("ManualTouchCard outcome buttons", () => {
  it("offers 'No WhatsApp' for a whatsapp action", () => {
    renderCard(action({ channel: "whatsapp" }));
    expect(screen.getByRole("button", { name: "No WhatsApp" })).toBeInTheDocument();
  });

  it("does not offer 'No WhatsApp' for a call action — it is meaningless there", () => {
    renderCard(action({ channel: "call" }));
    expect(screen.queryByRole("button", { name: "No WhatsApp" })).not.toBeInTheDocument();
  });

  it.each(["whatsapp", "call"] as const)(
    "offers the other four outcomes for a %s action",
    (channel) => {
      renderCard(action({ channel }));
      for (const label of ["Sent", "They replied", "Wrong number", "Not interested"]) {
        expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      }
    },
  );

  it("disables every outcome button when enrollmentId is missing, instead of a silent no-op", () => {
    renderCard(action({ channel: "whatsapp", enrollmentId: undefined }));
    for (const label of ["Sent", "They replied", "No WhatsApp", "Wrong number", "Not interested"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
  });

  it("leaves outcome buttons enabled when enrollmentId is present", () => {
    renderCard(action({ channel: "whatsapp", enrollmentId: "enrollment-1" }));
    expect(screen.getByRole("button", { name: "Sent" })).toBeEnabled();
  });
});

describe("ManualTouchCard message block", () => {
  it("shows the message as a 'Call script' for a call action", () => {
    renderCard(action({ channel: "call", message: "Ask about their renewal date." }));
    expect(screen.getByText("Call script")).toBeInTheDocument();
    expect(screen.getByText("Ask about their renewal date.")).toBeInTheDocument();
  });

  it("shows the message as 'Message to send' for a whatsapp action", () => {
    renderCard(action({ channel: "whatsapp", message: "Ask about their renewal date." }));
    expect(screen.getByText("Message to send")).toBeInTheDocument();
    expect(screen.queryByText("Call script")).not.toBeInTheDocument();
  });
});
