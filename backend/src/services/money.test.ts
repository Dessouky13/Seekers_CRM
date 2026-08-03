import { describe, it, expect } from "vitest";
import {
  parseMoney, formatMoney, formatCurrency,
  multiplyByQuantity, applyPercent, computeTotals,
} from "./money";

describe("parseMoney", () => {
  it("parses plain and grouped decimal strings to minor units", () => {
    expect(parseMoney("0")).toBe(0n);
    expect(parseMoney("1234.56")).toBe(123456n);
    expect(parseMoney("1,234.56")).toBe(123456n);
    expect(parseMoney("1234.5")).toBe(123450n);
    expect(parseMoney("1234")).toBe(123400n);
  });

  it("parses a JS number that round-trips exactly at 2dp", () => {
    expect(parseMoney(19.99)).toBe(1999n);
    expect(parseMoney(0.1)).toBe(10n);
    // The classic float trap: 0.1 + 0.2 is 0.30000000000000004, and this is the
    // whole reason the module never keeps money in a float.
    expect(parseMoney(Number((0.1 + 0.2).toFixed(2)))).toBe(30n);
  });

  it("rejects more precision than 2dp rather than silently truncating", () => {
    expect(() => parseMoney("19.999")).toThrow(/2 decimal places/);
    expect(() => parseMoney(19.999)).toThrow(/2 decimal places/);
  });

  it("rejects garbage", () => {
    expect(() => parseMoney("abc")).toThrow();
    expect(() => parseMoney("")).toThrow();
    expect(() => parseMoney(NaN)).toThrow();
    expect(() => parseMoney(Infinity)).toThrow();
  });

  it("round-trips through formatMoney", () => {
    for (const v of ["0.00", "0.01", "9.99", "1234.56", "-45.20", "999999.99"]) {
      expect(formatMoney(parseMoney(v))).toBe(v);
    }
  });
});

describe("formatMoney / formatCurrency", () => {
  it("always emits exactly two decimals", () => {
    expect(formatMoney(0n)).toBe("0.00");
    expect(formatMoney(5n)).toBe("0.05");
    expect(formatMoney(50n)).toBe("0.50");
    expect(formatMoney(100n)).toBe("1.00");
  });

  it("groups thousands and keeps the currency in front", () => {
    expect(formatCurrency(123456n, "EGP")).toBe("EGP 1,234.56");
    expect(formatCurrency(100000000n, "EGP")).toBe("EGP 1,000,000.00");
    expect(formatCurrency(99n, "USD")).toBe("USD 0.99");
    expect(formatCurrency(-123456n, "EGP")).toBe("-EGP 1,234.56");
  });
});

describe("multiplyByQuantity", () => {
  it("multiplies whole quantities exactly", () => {
    expect(multiplyByQuantity(150000n, 3)).toBe(450000n);      // 3 × 1500.00
    expect(multiplyByQuantity(999n, 1)).toBe(999n);
    expect(multiplyByQuantity(123456n, 0)).toBe(0n);
  });

  it("supports fractional quantities", () => {
    expect(multiplyByQuantity(10000n, "1.5")).toBe(15000n);    // 1.5 × 100.00
    expect(multiplyByQuantity(33333n, "0.5")).toBe(16667n);    // 166.665 → half up
  });

  it("rounds half away from zero", () => {
    // 0.05 × 0.5 = 0.025 → 0.03, not 0.02.
    expect(multiplyByQuantity(5n, "0.5")).toBe(3n);
    // 0.15 × 0.5 = 0.075 → 0.08 (banker's rounding would give 0.08 too),
    // 0.25 × 0.5 = 0.125 → 0.13 (banker's rounding would give 0.12).
    expect(multiplyByQuantity(25n, "0.5")).toBe(13n);
  });

  it("rejects a negative quantity", () => {
    expect(() => multiplyByQuantity(1000n, "-1")).toThrow(/negative/);
  });
});

describe("applyPercent", () => {
  it("computes VAT-style percentages", () => {
    expect(applyPercent(10000n, "14")).toBe(1400n);            // 14% of 100.00
    expect(applyPercent(100000n, "10")).toBe(10000n);
    expect(applyPercent(123456n, "0")).toBe(0n);
  });

  it("supports fractional rates", () => {
    expect(applyPercent(100000n, "2.5")).toBe(2500n);          // 2.5% of 1000.00
    expect(applyPercent(100000n, "0.5")).toBe(500n);
  });

  it("rounds half away from zero at the piastre", () => {
    // 14% of 0.05 = 0.007 → 0.01
    expect(applyPercent(5n, "14")).toBe(1n);
    // 50% of 0.01 = 0.005 → 0.01, not 0.00
    expect(applyPercent(1n, "50")).toBe(1n);
    // 10% of 0.02 = 0.002 → 0.00
    expect(applyPercent(2n, "10")).toBe(0n);
  });

  it("rejects a negative rate", () => {
    expect(() => applyPercent(1000n, "-5")).toThrow(/negative/);
  });
});

// ── computeTotals ─────────────────────────────────────────

const base = {
  setupFee:        "0",
  monthlyRetainer: "0",
  retainerMonths:  0,
  items:           [] as { quantity: string | number; unitPrice: string | number; kind: "one_off" | "recurring" }[],
  discountType:    "none" as const,
  discountValue:   "0",
  taxRate:         "0",
};

describe("computeTotals — the shape of a Seekers deal", () => {
  it("totals a setup fee plus a 12-month retainer", () => {
    const t = computeTotals({
      ...base,
      setupFee:        "25000",
      monthlyRetainer: "8000",
      retainerMonths:  12,
    });
    expect(t.one_off_subtotal).toBe("25000.00");
    expect(t.monthly_total).toBe("8000.00");
    expect(t.recurring_subtotal).toBe("96000.00");
    expect(t.subtotal).toBe("121000.00");
    expect(t.total).toBe("121000.00");
  });

  it("bills a recurring line item every month and a one-off line once", () => {
    const t = computeTotals({
      ...base,
      monthlyRetainer: "5000",
      retainerMonths:  6,
      items: [
        { quantity: 1, unitPrice: "1500", kind: "recurring" },   // 1,500/mo → 9,000
        { quantity: 2, unitPrice: "2000", kind: "one_off"   },   // 4,000 once
      ],
    });
    expect(t.lines[0]).toEqual({ line_total: "1500.00", extended: "9000.00" });
    expect(t.lines[1]).toEqual({ line_total: "4000.00", extended: "4000.00" });
    expect(t.monthly_total).toBe("6500.00");          // 5,000 retainer + 1,500 recurring
    expect(t.recurring_subtotal).toBe("39000.00");    // × 6
    expect(t.one_off_subtotal).toBe("4000.00");
    expect(t.subtotal).toBe("43000.00");
  });

  it("contributes nothing for a retainer priced over zero months", () => {
    // Zero months is legal arithmetic, and the API layer is what refuses to
    // accept a priced retainer with no term — this asserts the maths does not
    // quietly invent a month.
    const t = computeTotals({ ...base, monthlyRetainer: "8000", retainerMonths: 0 });
    expect(t.recurring_subtotal).toBe("0.00");
    expect(t.subtotal).toBe("0.00");
  });

  it("keeps the printed line column adding up to the printed subtotal", () => {
    // Three lines that each round, on a quantity that is not a whole number.
    const t = computeTotals({
      ...base,
      items: [
        { quantity: "0.5", unitPrice: "33.33", kind: "one_off" },  // 16.665 → 16.67
        { quantity: "0.5", unitPrice: "33.33", kind: "one_off" },  // 16.67
        { quantity: "0.5", unitPrice: "33.33", kind: "one_off" },  // 16.67
      ],
    });
    const printed = t.lines.reduce((s, l) => s + Number(l.extended), 0);
    expect(t.lines.map((l) => l.extended)).toEqual(["16.67", "16.67", "16.67"]);
    expect(t.subtotal).toBe("50.01");
    expect(printed.toFixed(2)).toBe(t.subtotal);
  });
});

describe("computeTotals — discount", () => {
  it("applies a percent discount to the subtotal", () => {
    const t = computeTotals({
      ...base, setupFee: "10000", discountType: "percent", discountValue: "10",
    });
    expect(t.discount).toBe("1000.00");
    expect(t.taxable).toBe("9000.00");
    expect(t.total).toBe("9000.00");
  });

  it("applies a flat-amount discount", () => {
    const t = computeTotals({
      ...base, setupFee: "10000", discountType: "amount", discountValue: "1500.50",
    });
    expect(t.discount).toBe("1500.50");
    expect(t.total).toBe("8499.50");
  });

  it("rounds a percent discount half up", () => {
    // 7.5% of 100.10 = 7.5075 → 7.51
    const t = computeTotals({
      ...base, setupFee: "100.10", discountType: "percent", discountValue: "7.5",
    });
    expect(t.discount).toBe("7.51");
    expect(t.total).toBe("92.59");
  });

  it("clamps a flat discount that exceeds the subtotal — the total never goes negative", () => {
    const t = computeTotals({
      ...base, setupFee: "3000", discountType: "amount", discountValue: "5000",
    });
    expect(t.discount).toBe("3000.00");
    expect(t.taxable).toBe("0.00");
    expect(t.total).toBe("0.00");
  });

  it("clamps a percent discount above 100", () => {
    const t = computeTotals({
      ...base, setupFee: "3000", discountType: "percent", discountValue: "150",
    });
    expect(t.discount).toBe("3000.00");
    expect(t.total).toBe("0.00");
  });

  it("ignores the discount value entirely when the type is none", () => {
    const t = computeTotals({
      ...base, setupFee: "1000", discountType: "none", discountValue: "999",
    });
    expect(t.discount).toBe("0.00");
    expect(t.total).toBe("1000.00");
  });
});

describe("computeTotals — tax", () => {
  it("charges tax on the discounted subtotal, not the gross", () => {
    const t = computeTotals({
      ...base,
      setupFee: "10000", discountType: "percent", discountValue: "10", taxRate: "14",
    });
    expect(t.subtotal).toBe("10000.00");
    expect(t.discount).toBe("1000.00");
    expect(t.taxable).toBe("9000.00");
    expect(t.tax).toBe("1260.00");        // 14% of 9,000 — not of 10,000 (1,400)
    expect(t.total).toBe("10260.00");
  });

  it("rounds tax half up at the piastre", () => {
    // 14% of 100.01 = 14.0014 → 14.00 ; 14% of 100.05 = 14.007 → 14.01
    expect(computeTotals({ ...base, setupFee: "100.01", taxRate: "14" }).tax).toBe("14.00");
    expect(computeTotals({ ...base, setupFee: "100.05", taxRate: "14" }).tax).toBe("14.01");
  });

  it("keeps total = taxable + tax exactly, with no float drift", () => {
    const t = computeTotals({
      ...base, setupFee: "0.10", monthlyRetainer: "0.20", retainerMonths: 1, taxRate: "0",
    });
    // 0.10 + 0.20 must be 0.30, not 0.30000000000000004.
    expect(t.subtotal).toBe("0.30");
    expect(t.total).toBe("0.30");
  });
});

describe("computeTotals — a full realistic quotation", () => {
  it("prices setup + retainer + mixed line items with discount and VAT", () => {
    const t = computeTotals({
      setupFee:        "25000",
      monthlyRetainer: "8000",
      retainerMonths:  12,
      items: [
        { quantity: 1,     unitPrice: "4500",  kind: "one_off"   },  // discovery workshop
        { quantity: "2.5", unitPrice: "1200",  kind: "one_off"   },  // 3,000 integration days
        { quantity: 3,     unitPrice: "350",   kind: "recurring" },  // 1,050/mo support seats
      ],
      discountType:  "percent",
      discountValue: "5",
      taxRate:       "14",
    });

    expect(t.one_off_subtotal).toBe("32500.00");     // 25,000 + 4,500 + 3,000
    expect(t.monthly_total).toBe("9050.00");         // 8,000 + 1,050
    expect(t.recurring_subtotal).toBe("108600.00");  // × 12
    expect(t.subtotal).toBe("141100.00");
    expect(t.discount).toBe("7055.00");              // 5%
    expect(t.taxable).toBe("134045.00");
    expect(t.tax).toBe("18766.30");                  // 14%
    expect(t.total).toBe("152811.30");

    // The invariant a client will check with a calculator.
    expect(Number(t.taxable) + Number(t.tax)).toBeCloseTo(Number(t.total), 2);
    expect(Number(t.subtotal) - Number(t.discount)).toBeCloseTo(Number(t.taxable), 2);
  });

  it("returns all zeroes for an empty quotation instead of throwing", () => {
    const t = computeTotals(base);
    expect(t).toMatchObject({
      one_off_subtotal: "0.00", monthly_total: "0.00", recurring_subtotal: "0.00",
      subtotal: "0.00", discount: "0.00", taxable: "0.00", tax: "0.00", total: "0.00",
    });
    expect(t.lines).toEqual([]);
  });
});

describe("computeTotals — input guards", () => {
  it("rejects negative money", () => {
    expect(() => computeTotals({ ...base, setupFee: "-1" })).toThrow(/negative/);
    expect(() => computeTotals({ ...base, monthlyRetainer: "-1" })).toThrow(/negative/);
    expect(() => computeTotals({
      ...base, items: [{ quantity: 1, unitPrice: "-5", kind: "one_off" }],
    })).toThrow(/negative/);
  });

  it("rejects a non-integer or negative retainer term", () => {
    expect(() => computeTotals({ ...base, retainerMonths: 1.5 })).toThrow(/retainer months/);
    expect(() => computeTotals({ ...base, retainerMonths: -1 })).toThrow(/retainer months/);
  });
});
