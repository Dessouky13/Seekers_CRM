// The Economics page renders numbers an owner will make decisions on, so these
// tests are less about markup than about the guarantees the page makes:
//
//   - money is rendered from the server's exact decimal string, never a float;
//   - the caveats that qualify a figure appear next to it;
//   - a client who has gone quiet is visibly flagged;
//   - the page never claims a per-client profit, because the data cannot support
//     one, and it says so.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Economics from "./Economics";
import { useEconomics, fmtMoney, type EconomicsSummary } from "@/hooks/useEconomics";

vi.mock("@/hooks/useEconomics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useEconomics")>();
  return { ...actual, useEconomics: vi.fn() };
});

// Recharts measures its container, which jsdom reports as 0×0 — it would render
// nothing and log warnings. The chart's job is the visual; the figures it is
// built from are asserted directly from the data instead.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="chart">{children}</div>
    ),
  };
});

/** Production-shaped response: the real numbers, names and data problems. */
function summary(over: Partial<EconomicsSummary> = {}): EconomicsSummary {
  return {
    as_of: "2026-08-04", currency: "EGP", from: null, truncated: false,
    retainers: {
      clients: [
        {
          client_id: "c-rajac", name: "Rajac", status: "active",
          revenue: "109800.00", revenue_via_name: "65800.00", payments: 9,
          first_payment: "2025-10-01", last_payment: "2026-07-05",
          days_since_last_payment: 30, expected_gap_days: 33, cadence_known: true,
          payment_status: "current", recurring_90d: "33000.00",
          monthly_run_rate: "11000.00", share_pct: 31.12,
        },
        {
          client_id: "c-abdallah", name: "abdallah Osman", status: "prospect",
          revenue: "13000.00", revenue_via_name: "0.00", payments: 2,
          first_payment: "2026-06-20", last_payment: "2026-07-07",
          days_since_last_payment: 28, expected_gap_days: 17, cadence_known: true,
          payment_status: "due", recurring_90d: "0.00",
          monthly_run_rate: "0.00", share_pct: 3.68,
        },
      ],
      unlinked_payers: [
        { name: "Starting 2026 amount", amount: "77339.00", payments: 1, last_payment: "2025-09-10", ambiguous: false },
        { name: "Digitivia",            amount: "10000.00", payments: 1, last_payment: "2025-11-03", ambiguous: false },
      ],
      unlinked_total: "87339.00",
      unattributed_income: "28661.00", unattributed_count: 3,
      attributed_revenue: "352800.00", top_two_share_pct: 56.63,
      thresholds: { due_ratio: 1.25, lapsed_ratio: 2, assumed_gap_days: 30 },
    },
    costs: {
      total_expenses: "326499.46",
      by_category: [
        { category: "Tools",     amount: "169169.46", share_pct: 51.81 },
        { category: "Salary",    amount: "100000.00", share_pct: 30.62 },
      ],
      tool_spend: "169169.46", tool_share_pct: 51.81,
      tools: [
        {
          tool_id: "t-vf", name: "Voiceflow", vendor: "Voiceflow", kind: "AI", active: true,
          spend: "59093.44", charges: 11, first_charge: "2025-09-14", last_charge: "2026-07-20",
          days_since_last_charge: 15, dormant: false, share_pct: 34.93,
        },
        {
          tool_id: "t-n8n", name: "n8n", vendor: "n8n", kind: "Automation", active: true,
          spend: "11000.00", charges: 3, first_charge: "2025-09-26", last_charge: "2025-11-20",
          days_since_last_charge: 257, dormant: true, share_pct: 6.5,
        },
      ],
      dormant_tools: 1,
      monthly_cost_base: "32649.94", months_observed: 10,
      thresholds: { dormant_days: 75 },
    },
    coverage: {
      monthly_recurring_revenue: "35999.99", monthly_cost_base: "32649.94",
      coverage_pct: 110.26, monthly_surplus: "3350.05",
      window_days: 90, contributing_clients: 5,
    },
    data_quality: {
      unattributed_income_count: 3, unattributed_income_amount: "28661.00",
      client_attributed_expense_count: 1, expense_count: 123,
      foreign_currency_count: 60, reporting_currency: "EGP",
      untagged_tool_spend: "0.00",
    },
    ...over,
  };
}

function mock(state: Partial<ReturnType<typeof useEconomics>>) {
  vi.mocked(useEconomics).mockReturnValue({
    data: undefined, isLoading: false, isError: false, error: null,
    refetch: vi.fn(), isRefetching: false,
    ...state,
  } as ReturnType<typeof useEconomics>);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Economics /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

// ── fmtMoney ──────────────────────────────────────────────

describe("fmtMoney", () => {
  it("groups thousands and drops a zero fraction", () => {
    expect(fmtMoney("109800.00")).toBe("109,800");
    expect(fmtMoney("0.00")).toBe("0");
    expect(fmtMoney("999.00")).toBe("999");
  });

  it("keeps a non-zero fraction", () => {
    expect(fmtMoney("326499.46")).toBe("326,499.46");
    expect(fmtMoney("3350.05")).toBe("3,350.05");
  });

  it("handles negatives", () => {
    expect(fmtMoney("-30000.00")).toBe("-30,000");
    expect(fmtMoney("-1234.56")).toBe("-1,234.56");
  });

  it("formats from the string, so a value too large for a float stays exact", () => {
    // 9007199254740993 is 2^53+1 — not representable as a JS number.
    expect(fmtMoney("9007199254740993.01")).toBe("9,007,199,254,740,993.01");
  });
});

// ── States ────────────────────────────────────────────────

describe("Economics — states", () => {
  it("shows a skeleton while loading", () => {
    mock({ isLoading: true });
    const { container } = renderPage();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows a retry on error rather than an empty report", () => {
    // The distinction that matters: "we could not find out" is not "there is
    // nothing", and only one of those needs a button.
    const refetch = vi.fn();
    mock({ isError: true, error: new Error("boom"), refetch });
    renderPage();

    expect(screen.getAllByText(/could not|couldn't|failed|unable/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("warns when the report is truncated", () => {
    mock({ data: summary({ truncated: true }) });
    renderPage();
    expect(screen.getByText(/Partial report/i)).toBeInTheDocument();
  });
});

// ── Coverage ──────────────────────────────────────────────

describe("Economics — coverage", () => {
  it("leads with the coverage percentage and the surplus", () => {
    mock({ data: summary() });
    renderPage();

    expect(screen.getByText("110.26%")).toBeInTheDocument();
    expect(screen.getByText("3,350.05")).toBeInTheDocument();
    expect(screen.getByText(/Surplus \/ mo/i)).toBeInTheDocument();
  });

  it("calls a shortfall a shortfall", () => {
    mock({ data: summary({
      coverage: { ...summary().coverage, coverage_pct: 74.2, monthly_surplus: "-8420.00" },
    }) });
    renderPage();

    expect(screen.getByText(/Shortfall \/ mo/i)).toBeInTheDocument();
    expect(screen.getByText("-8,420")).toBeInTheDocument();
    expect(screen.queryByText(/Surplus \/ mo/i)).not.toBeInTheDocument();
  });

  it("states both windows, because they differ", () => {
    mock({ data: summary() });
    renderPage();
    // A reader must be able to see that revenue is 90-day and cost is all-time.
    // Stated in both the coverage panel and the method panel, hence getAllByText.
    expect(screen.getAllByText(/last 90 days/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/10 months of recorded history/i)).toBeInTheDocument();
  });

  it("says setup fees are excluded from recurring revenue", () => {
    mock({ data: summary() });
    renderPage();
    expect(screen.getByText(/Setup fees are excluded/i)).toBeInTheDocument();
  });
});

// ── Retainer health ───────────────────────────────────────

describe("Economics — retainer health", () => {
  it("renders each client's real revenue and share", () => {
    mock({ data: summary() });
    renderPage();

    expect(screen.getByText("Rajac")).toBeInTheDocument();
    expect(screen.getByText("109,800")).toBeInTheDocument();
    expect(screen.getByText("31.12% of revenue")).toBeInTheDocument();
  });

  it("discloses how much revenue was matched by name rather than by link", () => {
    // Without this the figure silently disagrees with the Clients page.
    mock({ data: summary() });
    renderPage();
    expect(screen.getByText(/65,800 matched by name/i)).toBeInTheDocument();
  });

  it("flags a client that is overdue against its own rhythm", () => {
    mock({ data: summary() });
    renderPage();

    expect(screen.getByText(/Payments overdue against their own rhythm/i)).toBeInTheDocument();
    // Named twice on purpose: once in the callout, once in its own row.
    expect(screen.getAllByText("abdallah Osman")).toHaveLength(2);
    expect(screen.getByText("Due")).toBeInTheDocument();
    expect(screen.getByText("Needs a nudge")).toBeInTheDocument();
  });

  it("marks an assumed cadence as assumed", () => {
    mock({ data: summary({
      retainers: {
        ...summary().retainers,
        clients: [{
          ...summary().retainers.clients[0],
          payments: 1, cadence_known: false, expected_gap_days: 30,
        }],
      },
    }) });
    renderPage();
    // An assumed 30 days must never look like an observed one.
    expect(screen.getByText(/every ~30d \(assumed\)/i)).toBeInTheDocument();
  });

  it("lists money with no client record separately from client revenue", () => {
    mock({ data: summary() });
    renderPage();

    expect(screen.getByText(/Money with no client record/i)).toBeInTheDocument();
    expect(screen.getByText("Starting 2026 amount")).toBeInTheDocument();
    expect(screen.getByText("Digitivia")).toBeInTheDocument();
  });

  it("never presents an opening balance as a client", () => {
    // The bug this guards: synthesising a client from the text name made
    // "Starting 2026 amount" the agency's largest client.
    mock({ data: summary() });
    renderPage();

    const clientHeadings = screen.getAllByText(/of revenue$/);
    expect(clientHeadings).toHaveLength(2);           // Rajac + abdallah only
    expect(screen.getByText(/excluded.*from every client figure/i)).toBeInTheDocument();
  });

  it("explains that matching is exact, not fuzzy", () => {
    mock({ data: summary() });
    renderPage();
    expect(screen.getByText(/Rajac Medical center.*two different clients/i)).toBeInTheDocument();
  });
});

// ── Costs ─────────────────────────────────────────────────

describe("Economics — cost base and tools", () => {
  it("shows the tool share of the cost base", () => {
    mock({ data: summary() });
    renderPage();
    expect(screen.getByText("169,169.46 (51.81%)")).toBeInTheDocument();
  });

  it("flags a subscription still marked active with no recent charge", () => {
    mock({ data: summary() });
    renderPage();

    expect(screen.getByText(/1 tool marked active with no recent charge/i)).toBeInTheDocument();
    expect(screen.getByText(/n8n \(257d\)/)).toBeInTheDocument();
    // Stated as a prompt to check, not an accusation of waste.
    expect(screen.getByText(/Annually-billed items/i)).toBeInTheDocument();
  });

  it("does not offer an expander for a short tool list", () => {
    mock({ data: summary() });
    renderPage();
    expect(screen.queryByRole("button", { name: /Show all/i })).not.toBeInTheDocument();
  });

  it("expands a long tool list, and the toggle is a 44px target", () => {
    const base  = summary();
    const tools = Array.from({ length: 19 }, (_, i) => ({
      ...base.costs.tools[0], tool_id: `t-${i}`, name: `Tool ${i}`,
    }));
    mock({ data: summary({ costs: { ...base.costs, tools } }) });
    renderPage();

    const toggle = screen.getByRole("button", { name: /Show all 19 tools/i });
    expect(toggle.className).toMatch(/min-h-\[44px\]/);
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /Show top 8 only/i })).toBeInTheDocument();
  });

  it("says untagged Tools spend is not smeared across vendors", () => {
    mock({ data: summary() });
    renderPage();
    expect(screen.getByText(/left visible rather than smeared/i)).toBeInTheDocument();
  });
});

// ── The honesty panel ─────────────────────────────────────

describe("Economics — method disclosures", () => {
  it("refuses per-client profit and explains why", () => {
    mock({ data: summary() });
    renderPage();

    expect(screen.getByText(/There is no per-client profit here, on purpose/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 123 expense rows/i)).toBeInTheDocument();
    // The specific trap: revenue-share allocation is degenerate.
    expect(screen.getByText(/identical margin percentage by construction/i)).toBeInTheDocument();
  });

  it("discloses the mis-tagged currency rows", () => {
    mock({ data: summary() });
    renderPage();

    expect(screen.getByText(/60 rows are not tagged EGP/i)).toBeInTheDocument();
    expect(screen.getByText(/fiftyfold/i)).toBeInTheDocument();
  });

  it("discloses income that names no payer", () => {
    mock({ data: summary() });
    renderPage();
    expect(screen.getByText(/28,661 of income names no payer at all/i)).toBeInTheDocument();
  });

  it("says only completed transactions count", () => {
    mock({ data: summary() });
    renderPage();
    expect(screen.getByText(/Only completed transactions count/i)).toBeInTheDocument();
  });

  it("omits a caveat that does not apply", () => {
    mock({ data: summary({
      data_quality: { ...summary().data_quality, foreign_currency_count: 0 },
    }) });
    renderPage();
    expect(screen.queryByText(/not tagged EGP/i)).not.toBeInTheDocument();
  });
});

// ── Empty database ────────────────────────────────────────

describe("Economics — empty database", () => {
  it("renders without dividing by zero or inventing a caveat", () => {
    mock({ data: summary({
      retainers: {
        clients: [], unlinked_payers: [], unlinked_total: "0.00",
        unattributed_income: "0.00", unattributed_count: 0,
        attributed_revenue: "0.00", top_two_share_pct: 0,
        thresholds: { due_ratio: 1.25, lapsed_ratio: 2, assumed_gap_days: 30 },
      },
      costs: {
        total_expenses: "0.00", by_category: [], tool_spend: "0.00", tool_share_pct: 0,
        tools: [], dormant_tools: 0, monthly_cost_base: "0.00", months_observed: 0,
        thresholds: { dormant_days: 75 },
      },
      coverage: {
        monthly_recurring_revenue: "0.00", monthly_cost_base: "0.00", coverage_pct: 0,
        monthly_surplus: "0.00", window_days: 90, contributing_clients: 0,
      },
      data_quality: {
        unattributed_income_count: 0, unattributed_income_amount: "0.00",
        client_attributed_expense_count: 0, expense_count: 0,
        foreign_currency_count: 0, reporting_currency: "EGP", untagged_tool_spend: "0.00",
      },
    }) });
    renderPage();

    expect(screen.getByText("No clients recorded yet.")).toBeInTheDocument();
    // Coverage and top-two concentration both read 0% on an empty database.
    expect(screen.getAllByText("0%").length).toBeGreaterThan(0);
    expect(screen.queryByText(/NaN|Infinity|undefined/)).not.toBeInTheDocument();
  });
});
