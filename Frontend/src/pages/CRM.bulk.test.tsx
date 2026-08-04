// The seam between "which rows are ticked" and "what the request contains".
//
// `selectedIds` is a Set. `JSON.stringify(new Set(["a"]))` is `{}` — so passing
// it straight through instead of `Array.from(...)` produces a request with NO
// ids, which the backend correctly refuses, and the UI shows an error for a
// selection the user can plainly see is not empty. Nothing else in this repo
// tests that conversion, and a typecheck cannot: `ids: string[]` is satisfied by
// neither shape until it is serialised.
//
// The boundary mocked here is `apiFetch`, not the hooks, so what is asserted is
// the request that would really be sent.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import CRM from "./CRM";
import type { ApiLead } from "@/lib/types";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "@/lib/api";

vi.mock("@/hooks/useAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useAuth")>();
  return { ...actual, useCurrentUser: vi.fn(() => ({ id: "u-1", name: "Dessouky", role: "admin" })) };
});

function lead(over: Partial<ApiLead> = {}): ApiLead {
  return {
    id: "lead-1", name: "Jane Doe", company: "Acme", email: null, phone: null,
    source: null, category: null, dealValue: "1000", stage: "new_lead",
    assigneeId: "u-1", assignee_name: "Dessouky", lastActivity: null, notes: null,
    createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
    strikeCount: 0, strikeLimit: 3, ...over,
  };
}

const LEADS = [lead(), lead({ id: "lead-2", name: "Omar Said", company: "Beta" })];

/** Route every request by URL so the page can mount with real hooks. */
function mockApi() {
  vi.mocked(apiFetch).mockImplementation(((path: string, init?: RequestInit) => {
    if (path.startsWith("/crm/leads?") || path === "/crm/leads") return Promise.resolve(LEADS);
    if (path === "/crm/pipeline-summary")   return Promise.resolve([]);
    if (path === "/crm/categories")         return Promise.resolve(["Clinics"]);
    if (path === "/users")                  return Promise.resolve([{ id: "u-1", name: "Dessouky" }]);
    if (path === "/outreach/sequences")     return Promise.resolve([]);
    if (path === "/crm/leads/bulk-update")  return Promise.resolve({ updated: 2, skipped: 0, fields: ["stage"] });
    if (path === "/crm/leads/bulk-comment") return Promise.resolve({ commented: 2, skipped: 0 });
    void init;
    return Promise.resolve([]);
  }) as never);
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><CRM /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Switch to the table view (checkboxes live there) and tick both rows. */
async function selectBothLeads() {
  renderPage();
  await screen.findByText("Jane Doe");
  fireEvent.click(screen.getByRole("button", { name: /Table/ }));
  // The desktop table and the mobile card list both render, so each lead has two
  // checkboxes. Ticking the first of each is enough — selection is by id.
  fireEvent.click((await screen.findAllByLabelText("Select Jane Doe"))[0]);
  fireEvent.click((await screen.findAllByLabelText("Select Omar Said"))[0]);
  // The floating action bar is the proof the selection landed. It only mounts
  // while something is selected.
  await screen.findByRole("button", { name: /^Edit$/ });
}

/** The body of the last call to a given endpoint. */
function bodyOf(path: string) {
  const call = vi.mocked(apiFetch).mock.calls.filter((c) => c[0] === path).pop();
  if (!call) throw new Error(`${path} was never called`);
  return JSON.parse((call[1] as RequestInit).body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
});

describe("CRM bulk actions — the selection reaches the request", () => {
  it("sends the ticked ids as a real array to bulk-update", async () => {
    await selectBothLeads();

    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    const stage = await screen.findByLabelText("Stage");
    const contacted = Array.from((stage as HTMLSelectElement).options)
      .find((o) => o.textContent === "Contacted")!;
    fireEvent.change(stage, { target: { value: contacted.value } });
    fireEvent.click(screen.getByRole("button", { name: /Apply 1 change/ }));

    await waitFor(() => expect(bodyOf("/crm/leads/bulk-update")).toBeTruthy());
    const body = bodyOf("/crm/leads/bulk-update");
    // A Set serialises to `{}`. This is the assertion that catches it.
    expect(Array.isArray(body.ids)).toBe(true);
    expect(body.ids.sort()).toEqual(["lead-1", "lead-2"]);
    expect(body.patch).toEqual({ stage: "contacted" });
  });

  it("sends the ticked ids as a real array to bulk-comment", async () => {
    await selectBothLeads();

    fireEvent.click(screen.getByRole("button", { name: /^Comment$/ }));
    fireEvent.change(await screen.findByLabelText("Comment"), {
      target: { value: "Imported from the Cairo clinics list" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add to 2 leads/ }));

    await waitFor(() => expect(bodyOf("/crm/leads/bulk-comment")).toBeTruthy());
    const body = bodyOf("/crm/leads/bulk-comment");
    expect(body.ids.sort()).toEqual(["lead-1", "lead-2"]);
    expect(body.description).toBe("Imported from the Cairo clinics list");
    // Defaults to `note`, not `call`: a comment on fifty leads at once is an
    // observation, and typing it as a call would inflate outreach volume.
    expect(body.type).toBe("note");
  });

  it("offers no bulk actions at all with nothing selected, so no empty request is possible", async () => {
    renderPage();
    await screen.findByText("Jane Doe");
    fireEvent.click(screen.getByRole("button", { name: /Table/ }));
    // The action bar only mounts while the selection is non-empty — the first of
    // the three layers that stop an unfiltered bulk statement.
    expect(screen.queryByRole("button", { name: /^Edit$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Comment$/ })).not.toBeInTheDocument();
  });
});
