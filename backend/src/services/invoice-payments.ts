/**
 * The Finance tie-in: an invoice marked **paid** writes an income row into
 * `transactions`, so it lands in the existing P&L with no extra step.
 *
 * The whole risk here is double-counting. Two clicks on "Mark paid", a retried
 * request, or a status PATCH that re-sends `paid` must not each add revenue.
 * The guard is `invoices.transaction_id`:
 *
 *   • it is written in the SAME transaction as the status change,
 *   • the invoice row is locked FOR UPDATE first, so two concurrent requests
 *     serialise instead of both reading NULL,
 *   • it carries a partial UNIQUE index, so even a bug elsewhere cannot point
 *     two invoices at one ledger row.
 *
 * The decision itself is a pure function in ./invoice-ledger (no database
 * import), so it is unit tested directly — see invoice-ledger.test.ts.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { invoices, transactions } from "../db/schema";
import { documentTotals, invoiceItemsFor } from "./documents";
import {
  ledgerActionFor, type InvoiceStatus, type LedgerAction,
} from "./invoice-ledger";
import { cairoToday } from "../utils/dates";

export type { InvoiceStatus, LedgerState, LedgerAction } from "./invoice-ledger";
export { ledgerActionFor } from "./invoice-ledger";

export interface ApplyResult {
  invoice:        typeof invoices.$inferSelect;
  action:         LedgerAction["kind"];
  transaction_id: string | null;
}

/**
 * Move an invoice to `next`, keeping the ledger in step. Everything runs in one
 * database transaction, and the invoice row is locked before its
 * `transaction_id` is read.
 */
export async function applyInvoiceStatus(
  invoiceId: string,
  next: InvoiceStatus,
  opts: { paidOn?: string; userId?: string | null } = {},
): Promise<ApplyResult | null> {
  const items = await invoiceItemsFor(invoiceId);

  return db.transaction(async (tx) => {
    // SELECT … FOR UPDATE. Two concurrent "mark paid" requests would otherwise
    // both read transaction_id = NULL and both insert an income row.
    const locked = await tx.execute(sql`
      SELECT "id", "status", "transaction_id"
        FROM "invoices"
       WHERE "id" = ${invoiceId}
         FOR UPDATE
    `);
    const row = locked.rows[0] as { id: string; status: InvoiceStatus; transaction_id: string | null } | undefined;
    if (!row) return null;

    const action = ledgerActionFor(
      { status: row.status, transactionId: row.transaction_id },
      next,
    );

    const [current] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    let transactionId = row.transaction_id;

    if (action.kind === "create") {
      const totals = documentTotals(current, items);
      // transactions.date is a Cairo calendar day, like every other date column
      // here. Paying an invoice at 00:30 local must not file the income into
      // yesterday — on the 1st of a month that moves it into the wrong P&L
      // period entirely.
      const date   = opts.paidOn ?? cairoToday();

      const [created] = await tx.insert(transactions).values({
        date,
        type:       "income",
        amount:     totals.total,
        currency:   current.currency,
        category:   invoiceCategory(current),
        categories: [invoiceCategory(current)],
        clientId:   current.clientId,
        clientName: current.clientCompany ?? current.clientName ?? null,
        status:     "completed",
        notes:      `Invoice ${current.number}${current.title ? ` — ${current.title}` : ""}`,
        createdBy:  opts.userId ?? current.createdBy ?? null,
      }).returning({ id: transactions.id });

      transactionId = created.id;
    }

    if (action.kind === "remove") {
      await tx.delete(transactions).where(eq(transactions.id, action.transactionId));
      transactionId = null;
    }

    const [updated] = await tx
      .update(invoices)
      .set({
        status:        next,
        paidAt:        next === "paid" ? (current.paidAt ?? new Date()) : null,
        transactionId,
        updatedAt:     new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning();

    return { invoice: updated, action: action.kind, transaction_id: transactionId };
  });
}

/**
 * Which P&L bucket the income lands in.
 *
 * Reuses the two categories the Finance page already has dedicated tiles for,
 * so invoiced revenue shows up in the existing breakdown instead of inventing a
 * third label nobody's reports know about. A retainer invoice is recurring
 * revenue; anything else is a setup fee.
 */
function invoiceCategory(invoice: { recurring: boolean; monthlyRetainer: string }): string {
  return invoice.recurring || Number(invoice.monthlyRetainer) > 0
    ? "Client Recurring Fee"
    : "Client Setup Fee";
}
