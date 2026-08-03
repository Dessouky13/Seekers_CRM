import { describe, it, expect } from "vitest";
import { ledgerActionFor, type InvoiceStatus } from "./invoice-ledger";

const TX = "8f2c1b6e-0000-4000-8000-000000000001";

describe("ledgerActionFor — the double-counting guard", () => {
  it("writes an income row the FIRST time an invoice is marked paid", () => {
    expect(ledgerActionFor({ status: "sent", transactionId: null }, "paid"))
      .toMatchObject({ kind: "create" });
  });

  it("does NOTHING the second time — this is what stops revenue doubling", () => {
    // The realistic path: a double click, a retried request, or a PATCH that
    // re-sends the status it already has.
    const afterFirst = { status: "paid" as InvoiceStatus, transactionId: TX };
    expect(ledgerActionFor(afterFirst, "paid")).toMatchObject({ kind: "none" });
  });

  it("stays a no-op however many times paid is re-applied", () => {
    let state = { status: "sent" as InvoiceStatus, transactionId: null as string | null };
    const actions: string[] = [];

    for (let i = 0; i < 5; i++) {
      const action = ledgerActionFor(state, "paid");
      actions.push(action.kind);
      if (action.kind === "create") state = { status: "paid", transactionId: TX };
    }

    expect(actions).toEqual(["create", "none", "none", "none", "none"]);
  });

  it("removes the income row when an invoice stops being paid", () => {
    // Leaving it behind would inflate the P&L forever for money never received.
    for (const next of ["draft", "sent", "overdue", "void"] as InvoiceStatus[]) {
      expect(ledgerActionFor({ status: "paid", transactionId: TX }, next))
        .toMatchObject({ kind: "remove", transactionId: TX });
    }
  });

  it("does nothing when a never-paid invoice changes between unpaid statuses", () => {
    expect(ledgerActionFor({ status: "draft", transactionId: null }, "sent"))
      .toMatchObject({ kind: "none" });
    expect(ledgerActionFor({ status: "sent", transactionId: null }, "overdue"))
      .toMatchObject({ kind: "none" });
    expect(ledgerActionFor({ status: "sent", transactionId: null }, "void"))
      .toMatchObject({ kind: "none" });
  });

  it("re-writes the ledger row after a paid → unpaid → paid round trip, exactly once", () => {
    let state = { status: "sent" as InvoiceStatus, transactionId: null as string | null };

    const a1 = ledgerActionFor(state, "paid");
    expect(a1.kind).toBe("create");
    state = { status: "paid", transactionId: TX };

    const a2 = ledgerActionFor(state, "sent");
    expect(a2).toMatchObject({ kind: "remove", transactionId: TX });
    state = { status: "sent", transactionId: null };

    const a3 = ledgerActionFor(state, "paid");
    expect(a3.kind).toBe("create");
  });

  it("recovers if the status says paid but no ledger row was ever linked", () => {
    // Defensive: a row in that state is a bug, and re-marking it paid should
    // heal the ledger rather than silently leave the revenue missing.
    expect(ledgerActionFor({ status: "paid", transactionId: null }, "paid"))
      .toMatchObject({ kind: "create" });
  });
});
