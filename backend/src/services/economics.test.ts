import { describe, it, expect } from "vitest";
import {
  daysBetween, nameKey, median, paymentStatus, wholeMonthsObserved,
  buildRetainerReport, buildCostBase, buildCoverage, buildDataQuality,
  DORMANT_DAYS, ASSUMED_GAP_DAYS,
  type EconomicsTxn, type EconomicsClient, type EconomicsTool,
} from "./economics";

// ── Fixtures ──────────────────────────────────────────────

const TODAY = "2026-08-04";

function income(over: Partial<EconomicsTxn> & { amount: string; date: string }): EconomicsTxn {
  return {
    type: "income", category: "Client Recurring Fee",
    clientId: null, clientName: null, toolId: null, currency: "EGP",
    ...over,
  };
}

function expense(over: Partial<EconomicsTxn> & { amount: string; date: string }): EconomicsTxn {
  return {
    type: "expense", category: "Tools",
    clientId: null, clientName: null, toolId: null, currency: "EGP",
    ...over,
  };
}

/**
 * Mirrors the real `clients` table, INCLUDING the collision that matters: two
 * different clients are named "Rajac" and "Rajac Medical center", and both
 * carry the company "Rajac".
 */
const CLIENTS: EconomicsClient[] = [
  { id: "c-rajac",   name: "Rajac",                company: "Rajac",              status: "active" },
  { id: "c-rmc",     name: "Rajac Medical center", company: "Rajac",              status: "active" },
  { id: "c-genesis", name: "Genesis",              company: "Genesis",            status: "active" },
  { id: "c-hussein", name: "Dr. Hussein",          company: "Dr. Hussein Clinic", status: "active" },
];

// ── Small helpers ─────────────────────────────────────────

describe("daysBetween", () => {
  it("counts whole calendar days", () => {
    expect(daysBetween("2026-08-01", "2026-08-04")).toBe(3);
    expect(daysBetween("2026-08-04", "2026-08-04")).toBe(0);
    expect(daysBetween("2026-08-04", "2026-08-01")).toBe(-3);
  });

  it("crosses month and year boundaries", () => {
    expect(daysBetween("2026-07-31", "2026-08-01")).toBe(1);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
  });

  it("is unaffected by Cairo's DST shift", () => {
    // Cairo moves the clock during this window. Anchoring both ends at UTC
    // midnight is what keeps the answer a whole number of calendar days.
    expect(daysBetween("2026-04-20", "2026-05-20")).toBe(30);
  });
});

describe("nameKey", () => {
  it("normalises case and whitespace", () => {
    expect(nameKey("  Dr.  Hussein ")).toBe("dr. hussein");
    expect(nameKey("RAJAC")).toBe("rajac");
  });

  it("keeps 'Rajac' and 'Rajac Medical center' distinct", () => {
    // The whole reason matching is exact-after-normalisation rather than fuzzy:
    // these are two separate paying clients in the real database.
    expect(nameKey("Rajac")).not.toBe(nameKey("Rajac Medical center"));
  });
});

describe("median", () => {
  it("handles odd, even and empty", () => {
    expect(median([30])).toBe(30);
    expect(median([10, 20, 30])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([])).toBe(0);
  });

  it("is not dragged by an outlier the way a mean would be", () => {
    expect(median([30, 31, 29, 400])).toBe(31);         // mean would be 122
  });
});

describe("paymentStatus", () => {
  it("classifies against the client's own gap", () => {
    expect(paymentStatus(30, 30)).toBe("current");
    expect(paymentStatus(37, 30)).toBe("current");       // 1.23x, inside 1.25
    expect(paymentStatus(40, 30)).toBe("due");           // 1.33x
    expect(paymentStatus(61, 30)).toBe("lapsed");        // >2x
    expect(paymentStatus(null, 30)).toBe("no_payments");
  });

  it("does not nag a client whose own rhythm is slow", () => {
    // A quarterly payer at 80 days is fine; a monthly payer at 80 is lapsed.
    expect(paymentStatus(80, 90)).toBe("current");
    expect(paymentStatus(80, 30)).toBe("lapsed");
  });
});

describe("wholeMonthsObserved", () => {
  it("floors rather than rounds up a part month", () => {
    // Rounding up divides by more months than the data covers, which
    // understates the cost base — the direction that flatters the business.
    expect(wholeMonthsObserved(["2026-01-01", "2026-02-20"])).toBe(1);
    expect(wholeMonthsObserved(["2026-01-01", "2026-04-01"])).toBe(2);
  });

  it("never returns zero for a single day of history", () => {
    expect(wholeMonthsObserved(["2026-01-01"])).toBe(1);
    expect(wholeMonthsObserved([])).toBe(0);
  });
});

// ── Retainer report ───────────────────────────────────────

describe("buildRetainerReport — revenue attribution", () => {
  it("recovers revenue carried only by the free-text client_name", () => {
    // This is the real production shape: some rows carry client_id, some carry
    // only the text name. Keying on client_id alone reports 11,000 for a client
    // that has actually paid 76,800.
    const txns = [
      income({ amount: "11000.00", date: "2026-07-05", clientId: "c-rajac" }),
      income({ amount: "65800.00", date: "2026-06-02", clientName: "Rajac" }),
    ];
    const report = buildRetainerReport(txns, CLIENTS, TODAY);
    const rajac  = report.clients.find((c) => c.client_id === "c-rajac")!;

    expect(rajac.revenue).toBe("76800.00");
    expect(rajac.revenue_via_name).toBe("65800.00");
    expect(rajac.payments).toBe(2);
  });

  it("does not merge 'Rajac' into 'Rajac Medical center'", () => {
    const txns = [
      income({ amount: "11000.00", date: "2026-07-05", clientName: "Rajac" }),
      income({ amount: "5000.00",  date: "2026-08-02", clientName: "Rajac Medical center" }),
    ];
    const report = buildRetainerReport(txns, CLIENTS, TODAY);

    expect(report.clients.find((c) => c.client_id === "c-rajac")!.revenue).toBe("11000.00");
    expect(report.clients.find((c) => c.client_id === "c-rmc")!.revenue).toBe("5000.00");
  });

  it("lists a name with no client record for triage instead of dropping it", () => {
    const txns   = [income({ amount: "10000.00", date: "2026-06-20", clientName: "Digitivia" })];
    const report = buildRetainerReport(txns, CLIENTS, TODAY);

    expect(report.unlinked_payers).toHaveLength(1);
    expect(report.unlinked_payers[0]).toMatchObject({
      name: "Digitivia", amount: "10000.00", payments: 1, last_payment: "2026-06-20",
    });
    expect(report.unlinked_total).toBe("10000.00");
    // Not invented into a client, so it cannot distort anyone's share.
    expect(report.clients.some((c) => c.name === "Digitivia")).toBe(false);
    expect(report.attributed_revenue).toBe("0.00");
  });

  it("never lets an opening balance become the biggest client", () => {
    // "Starting 2026 amount" is a 77,339 opening balance sitting in the income
    // table with a client_name. Synthesising a client from that name made it
    // the largest "client" in the agency and took 87% of the revenue-share pie.
    const txns = [
      income({ amount: "77339.00", date: "2026-01-01", category: "Other", clientName: "Starting 2026 amount" }),
      income({ amount: "11000.00", date: "2026-07-05", clientId: "c-rajac" }),
    ];
    const report = buildRetainerReport(txns, CLIENTS, TODAY);

    expect(report.clients.some((c) => c.name === "Starting 2026 amount")).toBe(false);
    expect(report.unlinked_payers[0].name).toBe("Starting 2026 amount");
    expect(report.attributed_revenue).toBe("11000.00");
    expect(report.clients.find((c) => c.client_id === "c-rajac")!.share_pct).toBe(100);
  });

  it("resolves 'Rajac' by name even though two clients share the company 'Rajac'", () => {
    // The exact production shape. A flat name+company map makes "rajac"
    // ambiguous and rejects 65,800 EGP — the money this report exists to find.
    const txns = [
      income({ amount: "65800.00", date: "2026-03-03", clientName: "Rajac" }),
      income({ amount: "5000.00",  date: "2026-08-02", clientName: "Rajac Medical center" }),
    ];
    const report = buildRetainerReport(txns, CLIENTS, TODAY);

    expect(report.clients.find((c) => c.client_id === "c-rajac")!.revenue).toBe("65800.00");
    expect(report.clients.find((c) => c.client_id === "c-rmc")!.revenue).toBe("5000.00");
    expect(report.unlinked_payers).toEqual([]);
  });

  it("falls back to the company name when no client is named that", () => {
    // "Dr. Hussein Clinic" is a company, not a client name.
    const report = buildRetainerReport(
      [income({ amount: "6000.00", date: "2026-07-02", clientName: "Dr. Hussein Clinic" })],
      CLIENTS, TODAY,
    );
    expect(report.clients.find((c) => c.client_id === "c-hussein")!.revenue).toBe("6000.00");
  });

  it("refuses an ambiguous name shared by two clients", () => {
    const ambiguous: EconomicsClient[] = [
      { id: "a", name: "Acme", company: "Acme", status: "active" },
      { id: "b", name: "Acme", company: "Other", status: "active" },
    ];
    const report = buildRetainerReport(
      [income({ amount: "500.00", date: "2026-07-01", clientName: "Acme" })],
      ambiguous, TODAY,
    );
    // Picking a winner arbitrarily would attribute money to the wrong client.
    expect(report.attributed_revenue).toBe("0.00");
    expect(report.unlinked_payers[0]).toMatchObject({ name: "Acme", ambiguous: true });
  });

  it("prefers client_id over a conflicting client_name", () => {
    const report = buildRetainerReport(
      [income({ amount: "500.00", date: "2026-07-01", clientId: "c-genesis", clientName: "Rajac" })],
      CLIENTS, TODAY,
    );
    expect(report.clients.find((c) => c.client_id === "c-genesis")!.revenue).toBe("500.00");
    expect(report.clients.find((c) => c.client_id === "c-rajac")!.revenue).toBe("0.00");
  });

  it("ignores expenses entirely", () => {
    const report = buildRetainerReport(
      [expense({ amount: "1200.00", date: "2026-07-07", clientId: "c-rajac" })],
      CLIENTS, TODAY,
    );
    expect(report.attributed_revenue).toBe("0.00");
  });

  it("lists a client that has never paid rather than hiding it", () => {
    const report = buildRetainerReport([], CLIENTS, TODAY);
    const genesis = report.clients.find((c) => c.client_id === "c-genesis")!;

    expect(genesis.revenue).toBe("0.00");
    expect(genesis.payment_status).toBe("no_payments");
    expect(genesis.last_payment).toBeNull();
  });
});

describe("buildRetainerReport — cadence and health", () => {
  it("measures the gap from the client's own payment history", () => {
    const txns = [
      income({ amount: "6000.00", date: "2026-05-02", clientId: "c-genesis" }),
      income({ amount: "6000.00", date: "2026-06-02", clientId: "c-genesis" }),
      income({ amount: "6000.00", date: "2026-07-02", clientId: "c-genesis" }),
    ];
    const row = buildRetainerReport(txns, CLIENTS, TODAY).clients
      .find((c) => c.client_id === "c-genesis")!;

    expect(row.expected_gap_days).toBe(31);            // median of [31, 30]
    expect(row.cadence_known).toBe(true);
    expect(row.days_since_last_payment).toBe(33);      // 2026-07-02 → 2026-08-04
    expect(row.payment_status).toBe("current");        // 33 / 31 = 1.06
  });

  it("flags a monthly client that has gone quiet", () => {
    const txns = [
      income({ amount: "6000.00", date: "2026-03-02", clientId: "c-genesis" }),
      income({ amount: "6000.00", date: "2026-04-02", clientId: "c-genesis" }),
    ];
    const row = buildRetainerReport(txns, CLIENTS, TODAY).clients
      .find((c) => c.client_id === "c-genesis")!;

    expect(row.days_since_last_payment).toBe(124);
    expect(row.payment_status).toBe("lapsed");
  });

  it("marks the gap as assumed when there is only one payment", () => {
    const row = buildRetainerReport(
      [income({ amount: "6000.00", date: "2026-07-20", clientId: "c-genesis" })],
      CLIENTS, TODAY,
    ).clients.find((c) => c.client_id === "c-genesis")!;

    expect(row.cadence_known).toBe(false);
    expect(row.expected_gap_days).toBe(ASSUMED_GAP_DAYS);
  });

  it("counts only recurring-category income in the run rate", () => {
    const txns = [
      income({ amount: "9000.00",  date: "2026-07-10", clientId: "c-genesis" }),
      income({ amount: "20000.00", date: "2026-07-11", clientId: "c-genesis", category: "Client Setup Fee" }),
    ];
    const row = buildRetainerReport(txns, CLIENTS, TODAY).clients
      .find((c) => c.client_id === "c-genesis")!;

    // A one-off setup fee is not recurring revenue; counting it is how a
    // project business convinces itself it is a retainer business.
    expect(row.recurring_90d).toBe("9000.00");
    expect(row.revenue).toBe("29000.00");
  });

  it("excludes recurring income older than the 90-day window", () => {
    const row = buildRetainerReport(
      [income({ amount: "9000.00", date: "2026-01-10", clientId: "c-genesis" })],
      CLIENTS, TODAY,
    ).clients.find((c) => c.client_id === "c-genesis")!;

    expect(row.recurring_90d).toBe("0.00");
    expect(row.monthly_run_rate).toBe("0.00");
    expect(row.revenue).toBe("9000.00");
  });

  it("restates a 90-day window as a monthly figure", () => {
    const txns = [
      income({ amount: "6000.00", date: "2026-06-05", clientId: "c-genesis" }),
      income({ amount: "6000.00", date: "2026-07-05", clientId: "c-genesis" }),
      income({ amount: "6000.00", date: "2026-08-01", clientId: "c-genesis" }),
    ];
    const row = buildRetainerReport(txns, CLIENTS, TODAY).clients
      .find((c) => c.client_id === "c-genesis")!;

    expect(row.recurring_90d).toBe("18000.00");
    expect(row.monthly_run_rate).toBe("6000.00");       // 18000 × 30/90
  });
});

describe("buildRetainerReport — shares and concentration", () => {
  it("computes share against attributed revenue only", () => {
    const txns = [
      income({ amount: "60000.00", date: "2026-07-05", clientId: "c-rajac" }),
      income({ amount: "40000.00", date: "2026-07-06", clientId: "c-genesis" }),
      income({ amount: "77339.00", date: "2026-01-01", category: "Other" }),
    ];
    const report = buildRetainerReport(txns, CLIENTS, TODAY);

    // Shares must sum over the same population they divide by. Including the
    // opening balance in the denominator would make every share meaningless.
    expect(report.clients.find((c) => c.client_id === "c-rajac")!.share_pct).toBe(60);
    expect(report.clients.find((c) => c.client_id === "c-genesis")!.share_pct).toBe(40);
    expect(report.top_two_share_pct).toBe(100);
  });

  it("sorts biggest client first", () => {
    const txns = [
      income({ amount: "10000.00", date: "2026-07-05", clientId: "c-genesis" }),
      income({ amount: "90000.00", date: "2026-07-06", clientId: "c-rajac" }),
    ];
    const report = buildRetainerReport(txns, CLIENTS, TODAY);
    expect(report.clients[0].client_id).toBe("c-rajac");
  });

  it("survives an empty database without dividing by zero", () => {
    const report = buildRetainerReport([], [], TODAY);
    expect(report.attributed_revenue).toBe("0.00");
    expect(report.top_two_share_pct).toBe(0);
    expect(report.clients).toEqual([]);
  });
});

// ── Cost base ─────────────────────────────────────────────

const TOOLS: EconomicsTool[] = [
  { id: "t-vf",   name: "Voiceflow", vendor: "Voiceflow", kind: "AI",         active: true },
  { id: "t-n8n",  name: "n8n",       vendor: "n8n",       kind: "Automation", active: true },
  { id: "t-old",  name: "CapCut",    vendor: "ByteDance", kind: "Content",    active: false },
];

describe("buildCostBase", () => {
  it("totals expenses and splits by primary category", () => {
    const txns = [
      expense({ amount: "1000.00", date: "2026-07-20", category: "Tools" }),
      expense({ amount: "3000.00", date: "2026-07-20", category: "Salary" }),
    ];
    const report = buildCostBase(txns, TOOLS, TODAY);

    expect(report.total_expenses).toBe("4000.00");
    expect(report.by_category[0]).toEqual({ category: "Salary", amount: "3000.00", share_pct: 75 });
    expect(report.by_category[1].share_pct).toBe(25);
  });

  it("attributes spend per tool and ranks it", () => {
    const txns = [
      expense({ amount: "31935.44", date: "2026-07-20", toolId: "t-vf" }),
      expense({ amount: "11000.00", date: "2025-11-20", toolId: "t-n8n" }),
    ];
    const report = buildCostBase(txns, TOOLS, TODAY);

    expect(report.tools[0].name).toBe("Voiceflow");
    expect(report.tools[0].spend).toBe("31935.44");
    expect(report.tool_spend).toBe("42935.44");
  });

  it("does not smear untagged Tools spend across named tools", () => {
    const txns = [
      expense({ amount: "1000.00", date: "2026-07-20", toolId: "t-vf" }),
      expense({ amount: "9000.00", date: "2026-07-20", category: "Tools" }),   // no tool_id
    ];
    const report = buildCostBase(txns, TOOLS, TODAY);

    // The named tools total less than the Tools category, and that gap is
    // visible rather than quietly distributed.
    expect(report.tool_spend).toBe("1000.00");
    expect(report.by_category.find((c) => c.category === "Tools")!.amount).toBe("10000.00");
  });

  it("flags a tool still marked active but silent for two billing cycles", () => {
    const txns   = [expense({ amount: "11000.00", date: "2025-11-20", toolId: "t-n8n" })];
    const report = buildCostBase(txns, TOOLS, TODAY);
    const n8n    = report.tools.find((t) => t.name === "n8n")!;

    expect(n8n.days_since_last_charge).toBeGreaterThan(DORMANT_DAYS);
    expect(n8n.dormant).toBe(true);
    expect(report.dormant_tools).toBe(1);
  });

  it("does not flag a tool that is already marked inactive", () => {
    const txns   = [expense({ amount: "4200.00", date: "2026-03-11", toolId: "t-old" })];
    const report = buildCostBase(txns, TOOLS, TODAY);

    // Nothing to act on: the team already knows this one is gone.
    expect(report.tools.find((t) => t.name === "CapCut")!.dormant).toBe(false);
    expect(report.dormant_tools).toBe(0);
  });

  it("does not flag a tool charged this cycle", () => {
    const txns   = [expense({ amount: "5000.00", date: "2026-07-20", toolId: "t-vf" })];
    const report = buildCostBase(txns, TOOLS, TODAY);
    expect(report.tools[0].dormant).toBe(false);
  });

  it("averages the cost base over whole observed months", () => {
    const txns = [
      expense({ amount: "10000.00", date: "2026-01-01" }),
      expense({ amount: "10000.00", date: "2026-04-01" }),   // 90 days ≈ 2 whole months
    ];
    const report = buildCostBase(txns, TOOLS, TODAY);

    expect(report.months_observed).toBe(2);
    expect(report.monthly_cost_base).toBe("10000.00");
  });

  it("ignores income rows", () => {
    const report = buildCostBase([income({ amount: "50000.00", date: "2026-07-01" })], TOOLS, TODAY);
    expect(report.total_expenses).toBe("0.00");
    expect(report.months_observed).toBe(0);
  });

  it("survives an empty database", () => {
    const report = buildCostBase([], [], TODAY);
    expect(report.total_expenses).toBe("0.00");
    expect(report.tool_share_pct).toBe(0);
    expect(report.monthly_cost_base).toBe("0.00");
  });
});

// ── Coverage ──────────────────────────────────────────────

describe("buildCoverage", () => {
  it("reports the shortfall when retainers do not pay the bills", () => {
    const txns = [
      income({ amount: "30000.00", date: "2026-07-05", clientId: "c-rajac" }),
      expense({ amount: "40000.00", date: "2026-06-01" }),
      expense({ amount: "40000.00", date: "2026-08-01" }),
    ];
    const retainers = buildRetainerReport(txns, CLIENTS, TODAY);
    const costs     = buildCostBase(txns, TOOLS, TODAY);
    const coverage  = buildCoverage(retainers, costs);

    // 30,000 over 90 days = 10,000/month against a 40,000/month cost base.
    expect(coverage.monthly_recurring_revenue).toBe("10000.00");
    expect(coverage.monthly_cost_base).toBe("40000.00");
    expect(coverage.coverage_pct).toBe(25);
    expect(coverage.monthly_surplus).toBe("-30000.00");
    expect(coverage.contributing_clients).toBe(1);
  });

  it("reports a surplus above break-even", () => {
    const txns = [
      income({ amount: "45000.00", date: "2026-07-05", clientId: "c-rajac" }),
      expense({ amount: "10000.00", date: "2026-06-01" }),
      expense({ amount: "10000.00", date: "2026-08-01" }),
    ];
    const coverage = buildCoverage(
      buildRetainerReport(txns, CLIENTS, TODAY),
      buildCostBase(txns, TOOLS, TODAY),
    );
    // 45,000 over 90 days = 15,000/month against a 10,000/month cost base.
    expect(coverage.monthly_recurring_revenue).toBe("15000.00");
    expect(coverage.coverage_pct).toBe(150);
    expect(coverage.monthly_surplus).toBe("5000.00");
  });

  it("does not divide by zero when there are no expenses", () => {
    const txns     = [income({ amount: "9000.00", date: "2026-07-05", clientId: "c-rajac" })];
    const coverage = buildCoverage(
      buildRetainerReport(txns, CLIENTS, TODAY),
      buildCostBase(txns, TOOLS, TODAY),
    );
    expect(coverage.coverage_pct).toBe(0);
    expect(coverage.monthly_cost_base).toBe("0.00");
  });
});

// ── Data quality ──────────────────────────────────────────

describe("buildDataQuality", () => {
  it("counts the caveats rather than asserting them", () => {
    const txns = [
      income({ amount: "77339.00", date: "2026-01-01", category: "Other" }),
      expense({ amount: "7000.00", date: "2026-07-20", category: "Salary", currency: "USD" }),
      expense({ amount: "1200.00", date: "2026-07-07", category: "Other", clientId: "c-rajac" }),
      expense({ amount: "9000.00", date: "2026-07-20", category: "Tools" }),   // no tool_id
    ];
    const quality = buildDataQuality(txns, buildRetainerReport(txns, CLIENTS, TODAY), "EGP");

    expect(quality.unattributed_income_count).toBe(1);
    expect(quality.unattributed_income_amount).toBe("77339.00");
    expect(quality.foreign_currency_count).toBe(1);
    expect(quality.client_attributed_expense_count).toBe(1);
    expect(quality.expense_count).toBe(3);
    expect(quality.untagged_tool_spend).toBe("9000.00");
  });

  it("treats the reporting currency case-insensitively", () => {
    const txns    = [expense({ amount: "10.00", date: "2026-07-20", currency: "egp" })];
    const quality = buildDataQuality(txns, buildRetainerReport([], [], TODAY), "EGP");
    expect(quality.foreign_currency_count).toBe(0);
  });
});

// ── Money integrity ───────────────────────────────────────

describe("money integrity", () => {
  it("sums exactly where a float would drift", () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004. Ten of them is visibly wrong.
    const txns = Array.from({ length: 10 }, (_, i) =>
      income({ amount: i % 2 === 0 ? "0.10" : "0.20", date: "2026-08-01", clientId: "c-rajac" }),
    );
    const report = buildRetainerReport(txns, CLIENTS, TODAY);
    expect(report.clients.find((c) => c.client_id === "c-rajac")!.revenue).toBe("1.50");
  });

  it("keeps the real production totals exact", () => {
    // Tool spend from the live database, where the fractional piastres are the
    // part a float would round away.
    const txns = [
      expense({ amount: "31935.44", date: "2026-07-20", toolId: "t-vf" }),
      expense({ amount: "12039.54", date: "2026-07-20", toolId: "t-n8n" }),
      expense({ amount: "9112.01",  date: "2026-07-20", toolId: "t-old" }),
    ];
    expect(buildCostBase(txns, TOOLS, TODAY).tool_spend).toBe("53086.99");
  });

  it("rejects a malformed amount instead of coercing it to NaN", () => {
    expect(() =>
      buildCostBase([expense({ amount: "not-money", date: "2026-07-20" })], TOOLS, TODAY),
    ).toThrow(/Invalid transaction amount/);
  });
});
