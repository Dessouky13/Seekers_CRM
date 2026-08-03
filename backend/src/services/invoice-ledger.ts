/**
 * The rule that decides what an invoice status change does to the P&L.
 *
 * Kept in its own module with NO database import so it is a pure function the
 * tests can exercise directly — the applier that runs it against Postgres lives
 * in invoice-payments.ts.
 */

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "void";

export interface LedgerState {
  status: InvoiceStatus;
  /** The income row this invoice already wrote, if any. */
  transactionId: string | null;
}

export type LedgerAction =
  | { kind: "none"; reason: string }
  | { kind: "create"; reason: string }
  | { kind: "remove"; transactionId: string; reason: string };

/**
 * What should happen to the ledger when an invoice moves to `next`.
 *
 *   → paid   with no linked row   → write one income transaction
 *   → paid   with a linked row    → NOTHING (this is the idempotency rule)
 *   → other  with a linked row    → remove it; the money was not received after
 *                                   all, and leaving it inflates the P&L forever
 *   → other  with no linked row   → nothing
 *
 * `transaction_id` — not the status — is the marker, because the status can be
 * re-sent with the value it already holds and a status-only check would then
 * write a second income row.
 */
export function ledgerActionFor(current: LedgerState, next: InvoiceStatus): LedgerAction {
  if (next === "paid") {
    return current.transactionId
      ? { kind: "none", reason: "already recorded in the ledger" }
      : { kind: "create", reason: "first time this invoice is marked paid" };
  }

  return current.transactionId
    ? { kind: "remove", transactionId: current.transactionId, reason: `no longer paid (now ${next})` }
    : { kind: "none", reason: "nothing was ever recorded for this invoice" };
}
