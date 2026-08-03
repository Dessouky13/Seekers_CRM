/**
 * Shared plumbing for quotations and invoices: company settings, human-readable
 * numbering, share tokens, and the flattening step that turns a database row
 * plus its line items into the thing the PDF/HTML renderers draw.
 *
 * Both document types carry the same money shape, so both go through
 * `computeTotals()` in services/money.ts — there is exactly one place where a
 * total is decided.
 */
import { randomBytes } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  companySettings, quotations, quotationItems, invoices, invoiceItems,
} from "../db/schema";
import {
  computeTotals, formatCurrency, formatGrouped, parseMoney,
  type Totals, type LineKind,
} from "./money";
import { cairoToday } from "../utils/dates";

export type DocumentKind = "quotation" | "invoice";

export type CompanySettings = typeof companySettings.$inferSelect;

// ── Company settings ──────────────────────────────────────

/**
 * The single settings row, created on first read if the migration seed has not
 * run (a fresh local database built with `db:push` rather than the numbered
 * migrations). `singleton` is uniquely indexed, so the insert is a safe no-op
 * when a row already exists.
 */
export async function getCompanySettings(): Promise<CompanySettings> {
  const [existing] = await db.select().from(companySettings).limit(1);
  if (existing) return existing;

  await db.execute(sql`
    INSERT INTO company_settings (singleton) VALUES (true)
    ON CONFLICT (singleton) DO NOTHING
  `);
  const [created] = await db.select().from(companySettings).limit(1);
  return created;
}

// ── Share tokens ──────────────────────────────────────────

/**
 * 32 random bytes, base64url — 43 characters, 256 bits of entropy.
 *
 * The share link is the ONLY thing authenticating a public reader, so it has to
 * be unguessable. A uuid would be 122 bits and, worse, v4 uuids are easy to
 * mistake for enumerable ids elsewhere in this API.
 */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

// ── Numbering ─────────────────────────────────────────────

/**
 * `SQ-2026-0001` / `INV-2026-0001` — sequential within the calendar year.
 *
 * Runs inside the caller's transaction behind a transaction-scoped advisory
 * lock, so two concurrent creates cannot read the same MAX and mint the same
 * number. The UNIQUE constraint on `number` is the backstop if that ever fails.
 */
export async function nextDocumentNumber(
  tx: { execute: typeof db.execute },
  kind: DocumentKind,
  prefix: string,
  year = new Date().getFullYear(),
): Promise<string> {
  const table = kind === "quotation" ? "quotations" : "invoices";
  const scope = `${table}:${year}`;
  const head  = `${prefix}-${year}-`;

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${scope}))`);

  // Only rows that match this exact prefix+year shape are counted, so changing
  // the prefix in Settings starts a fresh sequence instead of colliding.
  const rows = await tx.execute(sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(right("number", 4), '\\D', '', 'g'), '')::int), 0) AS max_seq
      FROM ${sql.raw(`"${table}"`)}
     WHERE "number" LIKE ${`${head}%`}
       AND "number" ~ ${`^${escapeRegex(head)}\\d{4}$`}
  `);

  const maxSeq = Number((rows.rows[0] as { max_seq: number | string })?.max_seq ?? 0);
  return `${head}${String(maxSeq + 1).padStart(4, "0")}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Totals ────────────────────────────────────────────────

export interface DocumentItemRow {
  description: string;
  quantity:    string;
  unitPrice:   string;
  kind:        LineKind;
  position:    number;
}

export interface DocumentMoneyRow {
  currency:        string;
  setupFee:        string;
  monthlyRetainer: string;
  retainerMonths:  number;
  discountType:    "none" | "percent" | "amount";
  discountValue:   string;
  taxRate:         string;
}

export function documentTotals(row: DocumentMoneyRow, items: DocumentItemRow[]): Totals {
  return computeTotals({
    setupFee:        row.setupFee,
    monthlyRetainer: row.monthlyRetainer,
    retainerMonths:  row.retainerMonths,
    items:           items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, kind: i.kind })),
    discountType:    row.discountType,
    discountValue:   row.discountValue,
    taxRate:         row.taxRate,
  });
}

// ── Renderable document ───────────────────────────────────

export interface RenderLine {
  description: string;
  /** Second, smaller line — e.g. "Recurring · × 12 months". */
  detail:      string | null;
  quantity:    string;
  unitPrice:   string;
  amount:      string;
}

export interface RenderableDocument {
  kind:        DocumentKind;
  heading:     string;              // "QUOTATION" | "INVOICE"
  number:      string;
  title:       string | null;
  status:      string;
  currency:    string;
  /** Header key/value pairs, e.g. Issued / Valid until. */
  meta:        { label: string; value: string }[];
  client:      { name: string | null; company: string | null; email: string | null; phone: string | null; address: string | null };
  lines:       RenderLine[];
  totals:      Totals;
  /** Pre-formatted "EGP 1,234.56" strings, so renderers never format money. */
  money: {
    subtotal: string; discount: string; tax: string; total: string; monthly: string | null;
  };
  /** "Discount (5%)" or plain "Discount" — the reader should see the rate applied. */
  discountLabel: string;
  taxLabel:      string;
  retainerMonths: number;
  notes:       string | null;
  terms:       string | null;
  bankDetails: string | null;
  footer:      string | null;
  company:     CompanySettings;
  /** Rendered as a faint diagonal stamp: PAID / DRAFT / VOID / REJECTED. */
  stamp:       string | null;
}

/** dd MMM yyyy — unambiguous for an Egyptian reader, unlike 03/08/2026. */
export function formatDocumentDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

type QuotationRow = typeof quotations.$inferSelect;
type InvoiceRow   = typeof invoices.$inferSelect;

/**
 * Flattens the setup fee and the monthly retainer into the line-item list so
 * the printed table itemises the WHOLE deal. Showing a table of extras and then
 * a total that is 100k bigger than the table is the single most common way a
 * generated quotation loses the reader's trust.
 */
function buildLines(
  row: DocumentMoneyRow,
  items: DocumentItemRow[],
  totals: Totals,
): RenderLine[] {
  const lines: RenderLine[] = [];
  const months = row.retainerMonths;

  // Amounts in the table are bare grouped numbers; the column header carries
  // the currency once. Repeating "EGP" on twenty cells is noise, and the
  // totals block below still spells it out in full.
  if (parseMoney(row.setupFee) > 0n) {
    lines.push({
      description: "Setup & onboarding",
      detail:      "One-time",
      quantity:    "1",
      unitPrice:   formatGrouped(parseMoney(row.setupFee)),
      amount:      formatGrouped(parseMoney(row.setupFee)),
    });
  }

  if (parseMoney(row.monthlyRetainer) > 0n && months > 0) {
    const per = parseMoney(row.monthlyRetainer);
    lines.push({
      description: "Monthly retainer",
      detail:      `Recurring · ${months} month${months === 1 ? "" : "s"}`,
      quantity:    String(months),
      unitPrice:   formatGrouped(per),
      amount:      formatGrouped(per * BigInt(months)),
    });
  }

  items.forEach((item, i) => {
    const line = totals.lines[i];
    lines.push({
      description: item.description,
      detail: item.kind === "recurring"
        ? `Recurring · ${formatGrouped(parseMoney(line.line_total))} × ${months} month${months === 1 ? "" : "s"}`
        : null,
      quantity:  trimQuantity(item.quantity),
      unitPrice: formatGrouped(parseMoney(item.unitPrice)),
      amount:    formatGrouped(parseMoney(line.extended)),
    });
  });

  return lines;
}

/** "3.00" → "3", "2.50" → "2.5" — a quantity column full of ".00" reads as noise. */
function trimQuantity(q: string): string {
  return q.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** "14.00" → "14", "2.50" → "2.5" — for rate labels like "Discount (5%)". */
function trimRate(rate: string): string {
  return trimQuantity(rate);
}

function discountLabelFor(row: DocumentMoneyRow): string {
  return row.discountType === "percent"
    ? `Discount (${trimRate(row.discountValue)}%)`
    : "Discount";
}

function taxLabelFor(row: DocumentMoneyRow): string {
  return Number(row.taxRate) > 0 ? `Tax (${trimRate(row.taxRate)}%)` : "Tax";
}

export function renderableQuotation(
  row: QuotationRow,
  items: DocumentItemRow[],
  settings: CompanySettings,
): RenderableDocument {
  const totals = documentTotals(row, items);
  const cur    = row.currency;

  return {
    kind:    "quotation",
    heading: "QUOTATION",
    number:  row.number,
    title:   row.title,
    status:  row.status,
    currency: cur,
    meta: [
      { label: "Issued",      value: formatDocumentDate(row.createdAt) },
      { label: "Valid until", value: formatDocumentDate(row.validUntil) },
    ],
    client: {
      name:    row.clientName,
      company: row.clientCompany,
      email:   row.clientEmail,
      phone:   row.clientPhone,
      address: row.clientAddress,
    },
    lines:  buildLines(row, items, totals),
    totals,
    money: {
      subtotal: formatCurrency(parseMoney(totals.subtotal), cur),
      discount: formatCurrency(parseMoney(totals.discount), cur),
      tax:      formatCurrency(parseMoney(totals.tax), cur),
      total:    formatCurrency(parseMoney(totals.total), cur),
      monthly:  parseMoney(totals.monthly_total) > 0n
        ? formatCurrency(parseMoney(totals.monthly_total), cur)
        : null,
    },
    discountLabel: discountLabelFor(row),
    taxLabel:      taxLabelFor(row),
    retainerMonths: row.retainerMonths,
    notes:       row.notes,
    terms:       row.terms ?? settings.defaultPaymentTerms,
    bankDetails: null,
    footer:      settings.quotationFooter,
    company:     settings,
    stamp:       row.status === "accepted" ? "ACCEPTED"
               : row.status === "rejected" ? "REJECTED"
               : row.status === "expired"  ? "EXPIRED"
               : row.status === "draft"    ? "DRAFT"
               : null,
  };
}

export function renderableInvoice(
  row: InvoiceRow,
  items: DocumentItemRow[],
  settings: CompanySettings,
): RenderableDocument {
  const totals = documentTotals(row, items);
  const cur    = row.currency;

  const meta = [
    { label: "Issued", value: formatDocumentDate(row.issueDate) },
    { label: "Due",    value: formatDocumentDate(row.dueDate) },
  ];
  if (row.recurring) {
    meta.push({
      label: "Recurring",
      value: row.recurrenceTotal
        ? `${row.recurrenceIndex} of ${row.recurrenceTotal}`
        : `#${row.recurrenceIndex} · monthly`,
    });
  }

  return {
    kind:    "invoice",
    heading: "INVOICE",
    number:  row.number,
    title:   row.title,
    status:  row.status,
    currency: cur,
    meta,
    client: {
      name:    row.clientName,
      company: row.clientCompany,
      email:   row.clientEmail,
      phone:   row.clientPhone,
      address: row.clientAddress,
    },
    lines:  buildLines(row, items, totals),
    totals,
    money: {
      subtotal: formatCurrency(parseMoney(totals.subtotal), cur),
      discount: formatCurrency(parseMoney(totals.discount), cur),
      tax:      formatCurrency(parseMoney(totals.tax), cur),
      total:    formatCurrency(parseMoney(totals.total), cur),
      monthly:  parseMoney(totals.monthly_total) > 0n
        ? formatCurrency(parseMoney(totals.monthly_total), cur)
        : null,
    },
    discountLabel: discountLabelFor(row),
    taxLabel:      taxLabelFor(row),
    retainerMonths: row.retainerMonths,
    notes:       row.notes,
    terms:       row.terms ?? settings.defaultPaymentTerms,
    bankDetails: settings.bankDetails,
    footer:      settings.invoiceFooter,
    company:     settings,
    stamp:       row.status === "paid"  ? "PAID"
               : row.status === "void"  ? "VOID"
               : row.status === "draft" ? "DRAFT"
               : null,
  };
}

// ── Lookup helpers used by several routes ─────────────────

export async function quotationItemsFor(quotationId: string): Promise<DocumentItemRow[]> {
  return db
    .select({
      description: quotationItems.description,
      quantity:    quotationItems.quantity,
      unitPrice:   quotationItems.unitPrice,
      kind:        quotationItems.kind,
      position:    quotationItems.position,
    })
    .from(quotationItems)
    .where(eq(quotationItems.quotationId, quotationId))
    .orderBy(quotationItems.position);
}

export async function invoiceItemsFor(invoiceId: string): Promise<DocumentItemRow[]> {
  return db
    .select({
      description: invoiceItems.description,
      quantity:    invoiceItems.quantity,
      unitPrice:   invoiceItems.unitPrice,
      kind:        invoiceItems.kind,
      position:    invoiceItems.position,
    })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, invoiceId))
    .orderBy(invoiceItems.position);
}

/** Content-Disposition-safe file name: "Seekers-SQ-2026-0001.pdf". */
export function pdfFileName(doc: { number: string }): string {
  return `Seekers-${doc.number.replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`;
}

/**
 * Whether a quotation has passed its validity date, so a stale row never
 * displays as "valid". Compared against the CAIRO calendar day: `valid_until`
 * is a date the team typed, and between local midnight and 02:00 the UTC day is
 * still yesterday — which would keep a quotation alive for an extra couple of
 * hours after it should have lapsed.
 */
export function isQuotationExpired(
  row: { status: string; validUntil: string | null },
  today: string = cairoToday(),
): boolean {
  if (!row.validUntil) return false;
  if (row.status === "accepted" || row.status === "rejected") return false;
  return row.validUntil < today;
}
