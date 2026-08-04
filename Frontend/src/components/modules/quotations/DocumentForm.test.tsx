/**
 * The live total is the number the owner reads before committing to a price,
 * and draftToPayload is what actually reaches the API. Both are worth pinning:
 * a preview that silently disagrees with the saved document is worse than no
 * preview at all.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Dialog } from "@/components/ui/dialog";
import { useState } from "react";
import {
  DocumentForm, blankDraft, draftToPayload, type DraftDocument,
} from "./DocumentForm";
import type { ApiClient } from "@/lib/types";

const clients: ApiClient[] = [
  {
    id: "client-1", name: "Omar Hassan", company: "CairoFit Studios",
    email: "omar@cairofit.example", phone: "+20 101 234 5678",
    status: "active", industry: null, totalRevenue: "0", notes: null,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    project_count: 0,
  },
];

/** Mounts the form open, with the draft held in real state so edits stick. */
function renderForm(initial?: Partial<DraftDocument>) {
  let latest: DraftDocument = { ...blankDraft({ currency: "EGP", taxRate: "", terms: "" }), ...initial };

  function Harness() {
    const [draft, setDraft] = useState(latest);
    latest = draft;
    return (
      <Dialog open>
        <DocumentForm
          draft={draft}
          onChange={(next) => { latest = next; setDraft(next); }}
          clients={clients}
          editing={false}
          saving={false}
          onSubmit={() => {}}
          error={null}
        />
      </Dialog>
    );
  }

  const utils = render(<Harness />);
  return { ...utils, draft: () => latest };
}

const totalsPanel = () => screen.getByText("Total").closest("section")!;
/** The grand total, which can hold the same string as the subtotal. */
const total = () => screen.getByRole("status", { name: "Total" });

describe("DocumentForm — live total preview", () => {
  it("starts at zero", () => {
    renderForm();
    expect(total()).toHaveTextContent("EGP 0.00");
  });

  it("adds a setup fee and a retainer term as the user types", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Setup fee"), { target: { value: "18000" } });
    fireEvent.change(screen.getByLabelText("Monthly retainer"), { target: { value: "6500" } });
    fireEvent.change(screen.getByLabelText("Months"), { target: { value: "6" } });

    // 18,000 + 6,500 x 6 = 57,000
    expect(total()).toHaveTextContent("EGP 57,000.00");
    expect(screen.getByText(/Includes EGP 6,500.00 per month for 6 months/)).toBeInTheDocument();
  });

  it("shows the discount rate and charges tax on the discounted subtotal", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Setup fee"), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText("Months"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "percent" } });
    fireEvent.change(screen.getByLabelText("Discount value"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Tax %"), { target: { value: "14" } });

    const panel = within(totalsPanel());
    expect(panel.getByText("Discount (10%)")).toBeInTheDocument();
    expect(panel.getByText("− EGP 1,000.00")).toBeInTheDocument();
    // 14% of 9,000, NOT of 10,000 — the tax-on-gross bug would print 1,400.
    expect(panel.getByText("Tax (14%)")).toBeInTheDocument();
    expect(panel.getByText("EGP 1,260.00")).toBeInTheDocument();
    expect(total()).toHaveTextContent("EGP 10,260.00");
  });

  it("never previews a negative total when the discount exceeds the subtotal", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Setup fee"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Months"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Discount"), { target: { value: "amount" } });
    fireEvent.change(screen.getByLabelText("Discount value"), { target: { value: "5000" } });

    expect(total()).toHaveTextContent("EGP 0.00");
  });

  it("bills a recurring line every month of the term", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Months"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));

    fireEvent.change(screen.getByLabelText("Line 1 description"), { target: { value: "Support seat" } });
    fireEvent.change(screen.getByLabelText("Line 1 quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Line 1 unit price"), { target: { value: "450" } });
    fireEvent.click(screen.getByRole("radio", { name: /monthly/i }));

    // Qty 2 x 450 = 900/mo, x 6 months = 5,400. The per-line hint spells the
    // monthly figure out so the reader can see where the extension came from.
    expect(screen.getByText(/900\.00\/mo/)).toBeInTheDocument();
    expect(total()).toHaveTextContent("EGP 5,400.00");
  });

  it("removes a line and drops its amount from the total", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /add line/i }));
    fireEvent.change(screen.getByLabelText("Line 1 description"), { target: { value: "Workshop" } });
    fireEvent.change(screen.getByLabelText("Line 1 unit price"), { target: { value: "4500" } });
    expect(total()).toHaveTextContent("EGP 4,500.00");

    fireEvent.click(screen.getByRole("button", { name: /remove line 1/i }));
    expect(total()).toHaveTextContent("EGP 0.00");
  });
});

describe("DocumentForm — picking a client", () => {
  it("fills the snapshot fields from the selected client", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Existing client"), { target: { value: "client-1" } });

    expect(screen.getByLabelText("Company")).toHaveValue("CairoFit Studios");
    expect(screen.getByLabelText("Contact name")).toHaveValue("Omar Hassan");
    expect(screen.getByLabelText("Email")).toHaveValue("omar@cairofit.example");
  });
});

describe("draftToPayload", () => {
  const base = blankDraft({ currency: "EGP", taxRate: "", terms: "" });

  it("sends money as strings and blanks as zero, never as a float", () => {
    const payload = draftToPayload({ ...base, setupFee: "", monthlyRetainer: "8000.50", retainerMonths: "12" });
    expect(payload.setup_fee).toBe("0");
    expect(payload.monthly_retainer).toBe("8000.50");
    expect(typeof payload.monthly_retainer).toBe("string");
    expect(payload.retainer_months).toBe(12);
  });

  it("zeroes the discount value when the type is none, so a stale figure cannot apply", () => {
    const payload = draftToPayload({ ...base, discountType: "none", discountValue: "999" });
    expect(payload.discount_value).toBe("0");
  });

  it("drops line items with no description", () => {
    const payload = draftToPayload({
      ...base,
      items: [
        { key: "a", description: "Real line", quantity: "1", unitPrice: "100", kind: "one_off" },
        { key: "b", description: "   ",       quantity: "1", unitPrice: "50",  kind: "one_off" },
      ],
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].description).toBe("Real line");
  });

  it("nulls empty optional text rather than sending empty strings", () => {
    const payload = draftToPayload(base);
    expect(payload.title).toBeNull();
    expect(payload.client_id).toBeNull();
    expect(payload.valid_until).toBeNull();
  });
});
