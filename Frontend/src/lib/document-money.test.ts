import { describe, it, expect } from "vitest";
import {
  computeTotals, formatMoney, formatCurrency, formatGrouped, parseMoneyLoose,
  type TotalsInput,
} from "./document-money";

/**
 * These are the SAME worked examples as backend/src/services/money.test.ts.
 * The browser copy of the totals engine exists only to drive the live preview;
 * if it ever drifts from the server, one of the two suites has to fail, and
 * these shared cases are what makes that true.
 */

const base: TotalsInput = {
  setupFee: "0", monthlyRetainer: "0", retainerMonths: 0,
  items: [], discountType: "none", discountValue: "0", taxRate: "0",
};

describe("parseMoneyLoose — tolerant of half-typed input", () => {
  it("parses complete values exactly", () => {
    expect(parseMoneyLoose("1234.56")).toBe(123456n);
    expect(parseMoneyLoose("1,234.56")).toBe(123456n);
    expect(parseMoneyLoose(19.99)).toBe(1999n);
  });

  it("treats blank and mid-keystroke input as zero rather than throwing", () => {
    // The server rejects these; the form must not blow up while the user types.
    expect(parseMoneyLoose("")).toBe(0n);
    expect(parseMoneyLoose(null)).toBe(0n);
    expect(parseMoneyLoose(undefined)).toBe(0n);
    expect(parseMoneyLoose("abc")).toBe(0n);
    expect(parseMoneyLoose(".")).toBe(0n);
  });

  it("reads a trailing decimal point as the whole part", () => {
    expect(parseMoneyLoose("12.")).toBe(1200n);
    expect(parseMoneyLoose("12.5")).toBe(1250n);
  });

  it("truncates beyond 2dp instead of rejecting", () => {
    expect(parseMoneyLoose("19.999")).toBe(1999n);
  });
});

describe("formatting", () => {
  it("always shows two decimals and groups thousands", () => {
    expect(formatMoney(5n)).toBe("0.05");
    expect(formatGrouped(100000000n)).toBe("1,000,000.00");
    expect(formatCurrency(123456n, "EGP")).toBe("EGP 1,234.56");
    expect(formatCurrency(-123456n, "EGP")).toBe("-EGP 1,234.56");
  });
});

describe("computeTotals — matches the server", () => {
  it("totals a setup fee plus a 12-month retainer", () => {
    const t = computeTotals({ ...base, setupFee: "25000", monthlyRetainer: "8000", retainerMonths: 12 });
    expect(formatMoney(t.recurringSubtotal)).toBe("96000.00");
    expect(formatMoney(t.subtotal)).toBe("121000.00");
    expect(formatMoney(t.total)).toBe("121000.00");
  });

  it("bills a recurring line every month and a one-off line once", () => {
    const t = computeTotals({
      ...base, monthlyRetainer: "5000", retainerMonths: 6,
      items: [
        { quantity: 1, unitPrice: "1500", kind: "recurring" },
        { quantity: 2, unitPrice: "2000", kind: "one_off" },
      ],
    });
    expect(formatMoney(t.lines[0].lineTotal)).toBe("1500.00");
    expect(formatMoney(t.lines[0].extended)).toBe("9000.00");
    expect(formatMoney(t.lines[1].extended)).toBe("4000.00");
    expect(formatMoney(t.monthlyTotal)).toBe("6500.00");
    expect(formatMoney(t.subtotal)).toBe("43000.00");
  });

  it("charges tax on the discounted subtotal, not the gross", () => {
    const t = computeTotals({
      ...base, setupFee: "10000", discountType: "percent", discountValue: "10", taxRate: "14",
    });
    expect(formatMoney(t.discount)).toBe("1000.00");
    expect(formatMoney(t.taxable)).toBe("9000.00");
    expect(formatMoney(t.tax)).toBe("1260.00");
    expect(formatMoney(t.total)).toBe("10260.00");
  });

  it("rounds half away from zero", () => {
    // 7.5% of 100.10 = 7.5075 → 7.51
    expect(formatMoney(computeTotals({
      ...base, setupFee: "100.10", discountType: "percent", discountValue: "7.5",
    }).discount)).toBe("7.51");
    // 14% of 100.05 = 14.007 → 14.01
    expect(formatMoney(computeTotals({ ...base, setupFee: "100.05", taxRate: "14" }).tax)).toBe("14.01");
  });

  it("clamps a discount that exceeds the subtotal", () => {
    const t = computeTotals({ ...base, setupFee: "3000", discountType: "amount", discountValue: "5000" });
    expect(formatMoney(t.discount)).toBe("3000.00");
    expect(formatMoney(t.total)).toBe("0.00");
  });

  it("has no float drift on the classic 0.1 + 0.2", () => {
    const t = computeTotals({ ...base, setupFee: "0.10", monthlyRetainer: "0.20", retainerMonths: 1 });
    expect(formatMoney(t.subtotal)).toBe("0.30");
  });

  it("prices the full realistic quotation identically to the server", () => {
    // Byte-for-byte the same expectations as the backend suite.
    const t = computeTotals({
      setupFee: "25000", monthlyRetainer: "8000", retainerMonths: 12,
      items: [
        { quantity: 1,     unitPrice: "4500", kind: "one_off" },
        { quantity: "2.5", unitPrice: "1200", kind: "one_off" },
        { quantity: 3,     unitPrice: "350",  kind: "recurring" },
      ],
      discountType: "percent", discountValue: "5", taxRate: "14",
    });

    expect(formatMoney(t.oneOffSubtotal)).toBe("32500.00");
    expect(formatMoney(t.monthlyTotal)).toBe("9050.00");
    expect(formatMoney(t.recurringSubtotal)).toBe("108600.00");
    expect(formatMoney(t.subtotal)).toBe("141100.00");
    expect(formatMoney(t.discount)).toBe("7055.00");
    expect(formatMoney(t.taxable)).toBe("134045.00");
    expect(formatMoney(t.tax)).toBe("18766.30");
    expect(formatMoney(t.total)).toBe("152811.30");
  });

  it("returns zeroes for an empty form", () => {
    const t = computeTotals(base);
    expect(formatMoney(t.total)).toBe("0.00");
    expect(t.lines).toEqual([]);
  });

  it("ignores a retainer priced over zero months, like the server", () => {
    const t = computeTotals({ ...base, monthlyRetainer: "8000", retainerMonths: 0 });
    expect(formatMoney(t.subtotal)).toBe("0.00");
  });

  it("never produces a negative line from negative input", () => {
    // The form's number inputs have min="0", but a paste can still get through.
    const t = computeTotals({
      ...base, setupFee: "-500", items: [{ quantity: "-2", unitPrice: "100", kind: "one_off" }],
    });
    expect(formatMoney(t.total)).toBe("0.00");
  });
});
