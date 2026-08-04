/**
 * Quotation / invoice totals — the browser-side copy.
 *
 * ── Why this exists twice ─────────────────────────────────
 * The server is the authority: it recomputes every total on save and on read,
 * and the PDF is rendered from ITS numbers, never from anything posted by the
 * browser. This copy exists only so the form can show a live total while the
 * user types, without a round trip per keystroke.
 *
 * It is a deliberate, tested duplicate of `backend/src/services/money.ts`.
 * `document-money.test.ts` asserts the same worked examples as the backend's
 * `money.test.ts`, so if the two implementations ever drift, one of the two
 * suites fails.
 *
 * Same rule as the server: money is a bigint count of minor units (piastres),
 * never a JS float.
 */

const SCALE = 100n;

export type DiscountType = "none" | "percent" | "amount";
export type LineKind     = "one_off" | "recurring";

/** "1,234.56" | 1234.56 → 123456n. Returns 0n for blank/garbage input. */
export function parseMoneyLoose(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined || value === "") return 0n;

  const raw = (typeof value === "number" ? value.toFixed(2) : String(value).trim().replace(/,/g, ""));
  const match = /^(-?)(\d*)(?:\.(\d{0,2})\d*)?$/.exec(raw);
  // Unlike the server, a half-typed value must not throw — the user is mid-
  // keystroke and the preview should simply show what they have so far.
  if (!match || (!match[2] && !match[3])) return 0n;

  const [, sign, whole, frac = ""] = match;
  const minor = BigInt(whole || "0") * SCALE + BigInt(frac.padEnd(2, "0") || "0");
  return sign === "-" ? -minor : minor;
}

/** 123456n → "1234.56" */
export function formatMoney(minor: bigint): string {
  const negative = minor < 0n;
  const abs      = negative ? -minor : minor;
  return `${negative ? "-" : ""}${abs / SCALE}.${(abs % SCALE).toString().padStart(2, "0")}`;
}

/** 123456n → "1,234.56" */
export function formatGrouped(minor: bigint): string {
  const plain    = formatMoney(minor);
  const negative = plain.startsWith("-");
  const [whole, frac] = (negative ? plain.slice(1) : plain).split(".");
  return `${negative ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

/** 123456n, "EGP" → "EGP 1,234.56" */
export function formatCurrency(minor: bigint, currency = "EGP"): string {
  const grouped = formatGrouped(minor);
  return grouped.startsWith("-") ? `-${currency} ${grouped.slice(1)}` : `${currency} ${grouped}`;
}

/** Rounds half away from zero, matching the server. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator   < 0n ? -numerator   : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * n + d) / (2n * d);
  return negative ? -q : q;
}

export function multiplyByQuantity(unitPriceMinor: bigint, quantity: string | number): bigint {
  const qty = parseMoneyLoose(quantity);
  return qty < 0n ? 0n : divRoundHalfUp(unitPriceMinor * qty, SCALE);
}

export function applyPercent(baseMinor: bigint, percent: string | number): bigint {
  const rate = parseMoneyLoose(percent);
  return rate < 0n ? 0n : divRoundHalfUp(baseMinor * rate, SCALE * 100n);
}

export interface TotalsLineInput {
  quantity:  string | number;
  unitPrice: string | number;
  kind:      LineKind;
}

export interface TotalsInput {
  setupFee:        string | number;
  monthlyRetainer: string | number;
  retainerMonths:  number;
  items:           TotalsLineInput[];
  discountType:    DiscountType;
  discountValue:   string | number;
  taxRate:         string | number;
}

export interface Totals {
  oneOffSubtotal:    bigint;
  monthlyTotal:      bigint;
  recurringSubtotal: bigint;
  subtotal:          bigint;
  discount:          bigint;
  taxable:           bigint;
  tax:               bigint;
  total:             bigint;
  /** Per line: [per-occurrence amount, amount contributed to the subtotal]. */
  lines:             { lineTotal: bigint; extended: bigint }[];
}

/** Mirrors `computeTotals` in backend/src/services/money.ts. */
export function computeTotals(input: TotalsInput): Totals {
  const months = Number.isFinite(input.retainerMonths) && input.retainerMonths > 0
    ? Math.trunc(input.retainerMonths)
    : 0;

  const setup   = max0(parseMoneyLoose(input.setupFee));
  const monthly = max0(parseMoneyLoose(input.monthlyRetainer));

  const lines: Totals["lines"] = [];
  let oneOffItems  = 0n;
  let recurringPer = 0n;

  for (const item of input.items) {
    const unit  = max0(parseMoneyLoose(item.unitPrice));
    const line  = multiplyByQuantity(unit, item.quantity);
    const times = item.kind === "recurring" ? BigInt(months) : 1n;

    if (item.kind === "recurring") recurringPer += line;
    else                           oneOffItems  += line;

    lines.push({ lineTotal: line, extended: line * times });
  }

  const oneOffSubtotal    = setup + oneOffItems;
  const monthlyTotal      = monthly + recurringPer;
  const recurringSubtotal = monthlyTotal * BigInt(months);
  const subtotal          = oneOffSubtotal + recurringSubtotal;

  const discount = clampDiscount(subtotal, input.discountType, input.discountValue);
  const taxable  = subtotal - discount;
  const tax      = applyPercent(taxable, input.taxRate);

  return {
    oneOffSubtotal, monthlyTotal, recurringSubtotal,
    subtotal, discount, taxable, tax, total: taxable + tax,
    lines,
  };
}

function max0(v: bigint): bigint {
  return v < 0n ? 0n : v;
}

/** Never lets a discount exceed the subtotal — the total must not go negative. */
function clampDiscount(subtotal: bigint, type: DiscountType, value: string | number): bigint {
  if (type === "none") return 0n;
  const raw = type === "percent" ? applyPercent(subtotal, value) : max0(parseMoneyLoose(value));
  return raw > subtotal ? subtotal : raw;
}
