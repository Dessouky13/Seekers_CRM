// The board must show every lead, not the first page of them.
//
// `useLeads` used to issue one request with `limit: 200` against a server that
// clamped `limit` to 200. With 619 leads in the database the Kanban drew 200
// cards and there was no scroll, no button and no message that could reach the
// other 419 — and once the column headers were fixed to count the real
// pipeline, the board displayed a column headed 612 containing 193 cards.
//
// These assert the paging itself: that a full page provokes the next request,
// that a short page ends it, that the pages are concatenated in order, and that
// the safety ceiling holds. `apiFetch` is the mocked boundary, so what is
// checked is the requests that would really be sent.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLeads, LEAD_PAGE_SIZE, LEAD_FETCH_CEILING, leadsTruncated } from "./useCRM";
import type { ApiLead } from "@/lib/types";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "@/lib/api";

const lead = (id: string): ApiLead => ({
  id, name: `Lead ${id}`, company: "Acme", email: null, phone: null,
  source: null, category: null, dealValue: "0", stage: "new_lead",
  assigneeId: null, assignee_name: null, lastActivity: null, notes: null,
  createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
  strikeCount: 0, strikeLimit: 3,
});

/** `total` leads spread over as many pages as the page size requires. */
function serverWith(total: number) {
  vi.mocked(apiFetch).mockImplementation(((path: string) => {
    const offset = Number(new URL(path, "http://x").searchParams.get("offset") ?? 0);
    const limit  = Number(new URL(path, "http://x").searchParams.get("limit")  ?? 50);
    const page = Array.from(
      { length: Math.max(0, Math.min(limit, total - offset)) },
      (_, i) => lead(`lead-${offset + i}`),
    );
    return Promise.resolve(page);
  }) as never);
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Every /crm/leads URL requested, in order. */
const requested = () =>
  vi.mocked(apiFetch).mock.calls.map((c) => c[0] as string).filter((p) => p.startsWith("/crm/leads"));

beforeEach(() => vi.clearAllMocks());

describe("useLeads — pages until the server runs out", () => {
  it("stops after one request when the first page is short", async () => {
    serverWith(12);
    const { result } = renderHook(() => useLeads(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(12));
    // A short page IS the end. Asking again would be a wasted round trip on
    // every load, which is the common case for a filtered view.
    expect(requested()).toHaveLength(1);
    expect(requested()[0]).toContain(`limit=${LEAD_PAGE_SIZE}`);
    expect(requested()[0]).toContain("offset=0");
  });

  it("fetches the second page when the first comes back full", async () => {
    // The regression that matters: 619 leads, page size 500. One request
    // returns 500 and the old code stopped there.
    serverWith(619);
    const { result } = renderHook(() => useLeads(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(619));
    expect(requested()).toHaveLength(2);
    expect(requested()[1]).toContain(`offset=${LEAD_PAGE_SIZE}`);
  });

  it("concatenates the pages in order, with no gaps and no repeats", async () => {
    serverWith(619);
    const { result } = renderHook(() => useLeads(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(619));
    const ids = result.current.data!.map((l) => l.id);
    expect(new Set(ids).size).toBe(619);
    expect(ids[0]).toBe("lead-0");
    expect(ids[618]).toBe("lead-618");
  });

  it("makes exactly one more request when the total lands on a page boundary", async () => {
    // Exactly 500 is indistinguishable from "500 and more behind it" until the
    // next page comes back empty, so the extra request is correct rather than
    // wasteful — the alternative silently drops everything past the boundary.
    serverWith(LEAD_PAGE_SIZE);
    const { result } = renderHook(() => useLeads(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(LEAD_PAGE_SIZE));
    expect(requested()).toHaveLength(2);
  });

  it("stops at the ceiling rather than pulling an unbounded table into the browser", async () => {
    serverWith(LEAD_FETCH_CEILING + LEAD_PAGE_SIZE);
    const { result } = renderHook(() => useLeads(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(LEAD_FETCH_CEILING));
    expect(requested()).toHaveLength(LEAD_FETCH_CEILING / LEAD_PAGE_SIZE);
    // And the page can tell, so it can say so instead of quietly showing a
    // subset — which is the exact failure this whole change is about.
    expect(leadsTruncated(result.current.data)).toBe(true);
  });

  it("does not report truncation for a list that simply ended", async () => {
    serverWith(619);
    const { result } = renderHook(() => useLeads(), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(619));
    expect(leadsTruncated(result.current.data)).toBe(false);
  });

  it("honours an explicit limit with a single request, for a caller that wants a handful", async () => {
    serverWith(619);
    const { result } = renderHook(() => useLeads({ limit: 5 }), { wrapper });

    await waitFor(() => expect(result.current.data).toHaveLength(5));
    expect(requested()).toHaveLength(1);
    expect(requested()[0]).toContain("limit=5");
    expect(requested()[0]).not.toContain("offset=");
  });

  it("carries the filters onto every page", async () => {
    // A second page fetched without the filters would append leads the user
    // explicitly filtered out — worse than showing too few.
    serverWith(619);
    const { result } = renderHook(
      () => useLeads({ stage: "new_lead", search: "clinic", reachability: "reachable" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(619));
    for (const url of requested()) {
      expect(url).toContain("stage=new_lead");
      expect(url).toContain("search=clinic");
      expect(url).toContain("reachability=reachable");
    }
  });
});
