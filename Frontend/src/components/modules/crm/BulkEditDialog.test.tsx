// The bulk-edit dialog's contract is "only what you chose changes". These tests
// pin the three things that would silently corrupt many leads at once if they
// broke: a field left alone must not appear in the patch, "clear" must be
// distinguishable from "leave alone", and Apply must be unreachable with nothing
// selected (the server refuses an empty patch, but a button that fires a doomed
// request reads as a broken feature).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BulkEditDialog } from "./BulkEditDialog";
import type { BulkLeadPatch } from "@/hooks/useCRM";

const USERS = [{ id: "u-1", name: "Dessouky" }, { id: "u-2", name: "Ahmed" }];

function setup(over: Partial<Parameters<typeof BulkEditDialog>[0]> = {}) {
  const onApply = vi.fn<(patch: BulkLeadPatch) => void>();
  render(
    <BulkEditDialog
      open
      onOpenChange={() => {}}
      selectedCount={12}
      users={USERS}
      categories={["Clinics"]}
      canReassign
      isPending={false}
      onApply={onApply}
      {...over}
    />,
  );
  return { onApply };
}

/**
 * Pick an option by the text the user sees, not by its internal value — the
 * KEEP/CLEAR sentinels are an implementation detail and a test that spelled them
 * out would keep passing if the visible labels became meaningless.
 */
function choose(fieldLabel: string, optionLabel: string) {
  const select = screen.getByLabelText(fieldLabel) as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => o.textContent === optionLabel);
  if (!option) throw new Error(`No option "${optionLabel}" in "${fieldLabel}"`);
  fireEvent.change(select, { target: { value: option.value } });
}

const applyButton = () => screen.getByRole("button", { name: /Apply|Choose a field/ });

describe("BulkEditDialog — nothing changes unless you choose it", () => {
  it("disables Apply until a field is chosen", () => {
    setup();
    expect(applyButton()).toBeDisabled();
    expect(applyButton()).toHaveTextContent("Choose a field to change");
  });

  it("sends ONLY the field that was changed", () => {
    const { onApply } = setup();
    choose("Stage", "Contacted");
    fireEvent.click(applyButton());
    // Not `{ stage, assignee_id: null, category: null, source: null }` — that
    // would wipe three columns on every selected lead.
    expect(onApply).toHaveBeenCalledWith({ stage: "contacted" });
  });

  it("sends several fields when several were changed", () => {
    const { onApply } = setup();
    choose("Stage", "Negotiation");
    choose("Category / Niche", "Clinics");
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith({ stage: "negotiation", category: "Clinics" });
  });

  it("counts the changes on the button so the blast radius is visible", () => {
    setup();
    choose("Stage", "Contacted");
    expect(applyButton()).toHaveTextContent("Apply 1 change");
    choose("Source", "Referral");
    expect(applyButton()).toHaveTextContent("Apply 2 changes");
  });
});

describe("BulkEditDialog — clearing a field is not the same as leaving it", () => {
  it("sends null for 'Clear category'", () => {
    const { onApply } = setup();
    choose("Category / Niche", "Clear category");
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith({ category: null });
  });

  it("sends null for 'Unassign'", () => {
    const { onApply } = setup();
    choose("Assigned to", "Unassign");
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith({ assignee_id: null });
  });

  it("sends a real id when a person is picked", () => {
    const { onApply } = setup();
    choose("Assigned to", "Ahmed");
    fireEvent.click(applyButton());
    expect(onApply).toHaveBeenCalledWith({ assignee_id: "u-2" });
  });

  it("offers no way to clear the stage — leads.stage is NOT NULL", () => {
    setup();
    const stage = screen.getByLabelText("Stage") as HTMLSelectElement;
    const labels = Array.from(stage.options).map((o) => o.textContent ?? "");
    expect(labels).toContain("Leave unchanged");
    expect(labels.some((l) => /clear/i.test(l))).toBe(false);
  });
});

describe("BulkEditDialog — role scoping is visible, not just enforced", () => {
  it("hides the assignee field from a member who cannot reassign", () => {
    // The server 403s a member's reassignment. Offering the control anyway would
    // make the whole edit fail on a field they never needed.
    setup({ canReassign: false });
    expect(screen.queryByLabelText("Assigned to")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Stage")).toBeInTheDocument();
  });
});

describe("BulkEditDialog — the pending state", () => {
  it("says how many leads are in flight and that there is no partial progress", () => {
    setup({ isPending: true });
    expect(screen.getByRole("status")).toHaveTextContent("Applying to 12 leads…");
    // The honest part: one SQL statement, so there is nothing to show a
    // percentage for.
    expect(screen.getByRole("status")).toHaveTextContent(/one database statement/);
  });

  it("disables Apply and Cancel while in flight", () => {
    setup({ isPending: true });
    expect(screen.getByRole("button", { name: /Applying/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
