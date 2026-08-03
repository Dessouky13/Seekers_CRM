/**
 * Money arithmetic for quotations and invoices.
 *
 * ── Why not `number` ──────────────────────────────────────
 * Every amount in this module is a bigint count of MINOR UNITS (piastres for
 * EGP, cents for USD) — never a JS float. `0.1 + 0.2` is 0.30000000000000004,
 * and a quotation total that is one piastre out is a quotation the client
 * queries. Values cross the wire and live in Postgres as fixed-precision
 * strings (`numeric(12,2)`); this module is the only place they become numbers,
 * and they become integers when they do.
 *
 * Everything here is pure — no db, no clock, no env — so the maths is unit
 * tested directly (money.test.ts).
 */

/** Minor units: 1 EGP = 100. */
const SCALE = 100n;

// ── Parsing ───────────────────────────────────────────────

/**
 * "1234.56" | "1,234.5" | 1234.56 → 123456n
 *
 * Accepts at most 2 decimal places and rejects anything else outright rather
 * than silently truncating — a request carrying `19.999` is a bug in the
 * caller, and rounding it here would hide that.
 */
export function parseMoney(value: string | number, field = "amount"): bigint {
  const raw = typeof value === "number" ? formatNumberInput(value, field) : value.trim().replace(/,/g, "");

  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error(`Invalid ${field}: "${value}" — expected a number with at most 2 decimal places`);
  }

  const negative = raw.startsWith("-");
  const [whole, frac = ""] = (negative ? raw.slice(1) : raw).split(".");
  const minor = BigInt(whole) * SCALE + BigInt(frac.padEnd(2, "0"));
  return negative ? -minor : minor;
}

/**
 * A JS number arriving over JSON is already a float, so it can only be trusted
 * to 2dp if it round-trips exactly. 19.99 does; 19.999 and 1e21 do not.
 */
function formatNumberInput(value: number, field: string): string {
  if (!Number.isFinite(value)) throw new Error(`Invalid ${field}: ${value}`);
  const fixed = value.toFixed(2);
  if (Math.abs(Number(fixed) - value) > 1e-9) {
    throw new Error(`Invalid ${field}: ${value} — more precision than 2 decimal places`);
  }
  return fixed;
}

/** 123456n → "1234.56" — the exact form Postgres `numeric(12,2)` wants. */
export function formatMoney(minor: bigint): string {
  const negative = minor < 0n;
  const abs      = negative ? -minor : minor;
  const whole    = abs / SCALE;
  const frac     = abs % SCALE;
  return `${negative ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}`;
}

/** 123456n → "1,234.56" — thousands-grouped, no currency code. */
export function formatGrouped(minor: bigint): string {
  const plain    = formatMoney(minor);
  const negative = plain.startsWith("-");
  const [whole, frac] = (negative ? plain.slice(1) : plain).split(".");
  return `${negative ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

/**
 * 123456n, "EGP" → "EGP 1,234.56".
 *
 * ASCII hyphen for negatives on purpose: the PDF uses the standard Helvetica
 * font, whose WinAnsi encoding has no U+2212 MINUS SIGN — a typographic minus
 * came out of the renderer as a stray double quote.
 */
export function formatCurrency(minor: bigint, currency: string): string {
  const grouped = formatGrouped(minor);
  return grouped.startsWith("-")
    ? `-${currency} ${grouped.slice(1)}`
    : `${currency} ${grouped}`;
}

// ── Rounding ──────────────────────────────────────────────

/**
 * Integer division rounding half AWAY FROM ZERO, so 0.005 → 0.01 and
 * -0.005 → -0.01. Banker's rounding would be defensible too, but "round half
 * up" is what an Egyptian accountant checking the arithmetic by hand expects,
 * and it is what Excel does.
 */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator   < 0n ? -numerator   : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * n + d) / (2n * d);
  return negative ? -q : q;
}

// ── Rates and quantities ──────────────────────────────────

/**
 * Quantity × unit price. Quantity carries up to 2dp (so "1.5 hours" works) and
 * is parsed through the same integer path as money.
 */
export function multiplyByQuantity(unitPriceMinor: bigint, quantity: string | number): bigint {
  const qtyMinor = parseMoney(quantity, "quantity");
  if (qtyMinor < 0n) throw new Error(`Invalid quantity: ${quantity} — must not be negative`);
  return divRoundHalfUp(unitPriceMinor * qtyMinor, SCALE);
}

/** base × percent%, e.g. applyPercent(10000n, "14") → 1400n (14% VAT on 100.00). */
export function applyPercent(baseMinor: bigint, percent: string | number): bigint {
  const rateMinor = parseMoney(percent, "percent");
  if (rateMinor < 0n) throw new Error(`Invalid percent: ${percent} — must not be negative`);
  return divRoundHalfUp(baseMinor * rateMinor, SCALE * 100n);
}

// ── Quotation / invoice totals ────────────────────────────

export type DiscountType = "none" | "percent" | "amount";
export type LineKind     = "one_off" | "recurring";

export interface TotalsLine {
  description?: string;
  quantity:     string | number;
  unitPrice:    string | number;
  /** one_off bills once; recurring bills every month of the retainer term. */
  kind:         LineKind;
}

export interface TotalsInput {
  /** One-time setup / onboarding fee. */
  setupFee:        string | number;
  /** Monthly retainer, charged `retainerMonths` times. */
  monthlyRetainer: string | number;
  retainerMonths:  number;
  items:           TotalsLine[];
  discountType:    DiscountType;
  discountValue:   string | number;
  /** Percent, e.g. "14" for Egyptian VAT. */
  taxRate:         string | number;
}

export interface LineTotal {
  /** qty × unit price — the per-occurrence amount, i.e. per month for a recurring line. */
  line_total: string;
  /** What the line contributes to the subtotal (× retainerMonths when recurring). */
  extended:   string;
}

export interface Totals {
  /** Billed once: setup fee + one_off line items. */
  one_off_subtotal:   string;
  /** Billed every month: monthly retainer + recurring line items. */
  monthly_total:      string;
  /** monthly_total × retainerMonths. */
  recurring_subtotal: string;
  subtotal:           string;
  discount:           string;
  /** subtotal − discount, i.e. what tax is charged on. */
  taxable:            string;
  tax:                string;
  total:              string;
  lines:              LineTotal[];
}

/**
 * The single source of truth for what a quotation or an invoice costs.
 *
 *   one_off_subtotal   = setupFee + Σ(one_off qty × price)
 *   monthly_total      = monthlyRetainer + Σ(recurring qty × price)
 *   recurring_subtotal = monthly_total × retainerMonths
 *   subtotal           = one_off_subtotal + recurring_subtotal
 *   discount           = percent ? subtotal × v% : min(v, subtotal)      [never > subtotal]
 *   tax                = (subtotal − discount) × taxRate%
 *   total              = subtotal − discount + tax
 *
 * Each line is rounded to the piastre BEFORE being summed, which is what makes
 * the printed column add up to the printed subtotal. Summing exact products
 * and rounding once at the end is more "accurate" and produces a PDF whose
 * visible numbers do not add up — the wrong trade for a client-facing document.
 */
export function computeTotals(input: TotalsInput): Totals {
  const months = normaliseMonths(input.retainerMonths);

  const setup   = parseMoney(input.setupFee,        "setup fee");
  const monthly = parseMoney(input.monthlyRetainer, "monthly retainer");
  if (setup   < 0n) throw new Error("Setup fee must not be negative");
  if (monthly < 0n) throw new Error("Monthly retainer must not be negative");

  const lines: LineTotal[] = [];
  let oneOffItems  = 0n;
  let recurringPer = 0n;

  for (const item of input.items) {
    const unit  = parseMoney(item.unitPrice, "unit price");
    if (unit < 0n) throw new Error("Unit price must not be negative");
    const line  = multiplyByQuantity(unit, item.quantity);
    const times = item.kind === "recurring" ? BigInt(months) : 1n;

    if (item.kind === "recurring") recurringPer += line;
    else                          oneOffItems  += line;

    lines.push({ line_total: formatMoney(line), extended: formatMoney(line * times) });
  }

  const oneOffSubtotal   = setup + oneOffItems;
  const monthlyTotal     = monthly + recurringPer;
  const recurringSubtotal = monthlyTotal * BigInt(months);
  const subtotal         = oneOffSubtotal + recurringSubtotal;

  const discount = clampDiscount(subtotal, input.discountType, input.discountValue);
  const taxable  = subtotal - discount;
  const tax      = applyPercent(taxable, input.taxRate);

  return {
    one_off_subtotal:   formatMoney(oneOffSubtotal),
    monthly_total:      formatMoney(monthlyTotal),
    recurring_subtotal: formatMoney(recurringSubtotal),
    subtotal:           formatMoney(subtotal),
    discount:           formatMoney(discount),
    taxable:            formatMoney(taxable),
    tax:                formatMoney(tax),
    total:              formatMoney(taxable + tax),
    lines,
  };
}

function normaliseMonths(months: number): number {
  if (!Number.isFinite(months) || !Number.isInteger(months) || months < 0) {
    throw new Error(`Invalid retainer months: ${months} — expected a non-negative integer`);
  }
  return months;
}

/**
 * A discount can never exceed the subtotal. Without the clamp a fat-fingered
 * "5000" flat discount on a 3,000 quotation produces a negative total, then
 * negative tax, then — once the invoice is paid — a negative income row in the
 * P&L.
 */
function clampDiscount(subtotal: bigint, type: DiscountType, value: string | number): bigint {
  if (type === "none") return 0n;

  const raw = type === "percent"
    ? applyPercent(subtotal, value)
    : parseMoney(value, "discount");

  if (raw < 0n) throw new Error("Discount must not be negative");
  return raw > subtotal ? subtotal : raw;
}
