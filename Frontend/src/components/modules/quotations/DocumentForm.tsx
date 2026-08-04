/**
 * The quotation editor: recipient, setup fee, retainer, repeatable line items,
 * discount, tax, validity, terms — and a live total that updates as you type.
 *
 * The preview is computed in the browser (lib/document-money.ts) rather than by
 * round-tripping the server on every keystroke. The server still recomputes
 * every total on save and is the only thing the PDF is rendered from, so the
 * preview can never become the number that ships; the two implementations share
 * the same test cases so a drift fails a suite.
 */
import { useMemo } from "react";
import { Plus, Trash2, Repeat, CircleDollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { computeTotals, formatCurrency } from "@/lib/document-money";
import { cn } from "@/lib/utils";
import type { ApiClient, ApiQuotation, DiscountType, LineKind } from "@/lib/types";

export interface DraftItem {
  key:         string;
  description: string;
  quantity:    string;
  unitPrice:   string;
  kind:        LineKind;
}

export interface DraftDocument {
  clientId:        string;
  clientName:      string;
  clientCompany:   string;
  clientEmail:     string;
  clientPhone:     string;
  clientAddress:   string;
  title:           string;
  currency:        string;
  setupFee:        string;
  monthlyRetainer: string;
  retainerMonths:  string;
  discountType:    DiscountType;
  discountValue:   string;
  taxRate:         string;
  validUntil:      string;
  notes:           string;
  terms:           string;
  items:           DraftItem[];
}

let itemSeq = 0;
const newItemKey = () => `item-${++itemSeq}`;

export function blankDraft(defaults: { currency: string; taxRate: string; terms: string }): DraftDocument {
  return {
    clientId: "", clientName: "", clientCompany: "", clientEmail: "", clientPhone: "", clientAddress: "",
    title: "", currency: defaults.currency, setupFee: "", monthlyRetainer: "", retainerMonths: "12",
    discountType: "none", discountValue: "", taxRate: defaults.taxRate, validUntil: "",
    notes: "", terms: defaults.terms,
    items: [],
  };
}

export function draftFromQuotation(q: ApiQuotation): DraftDocument {
  const trim = (v: string) => (Number(v) === 0 ? "" : String(Number(v)));
  return {
    clientId:        q.clientId ?? "",
    clientName:      q.clientName ?? "",
    clientCompany:   q.clientCompany ?? "",
    clientEmail:     q.clientEmail ?? "",
    clientPhone:     q.clientPhone ?? "",
    clientAddress:   q.clientAddress ?? "",
    title:           q.title ?? "",
    currency:        q.currency,
    setupFee:        trim(q.setupFee),
    monthlyRetainer: trim(q.monthlyRetainer),
    retainerMonths:  String(q.retainerMonths),
    discountType:    q.discountType,
    discountValue:   trim(q.discountValue),
    taxRate:         trim(q.taxRate),
    validUntil:      q.validUntil ?? "",
    notes:           q.notes ?? "",
    terms:           q.terms ?? "",
    items: q.items.map((i) => ({
      key: newItemKey(),
      description: i.description,
      quantity:    String(Number(i.quantity)),
      unitPrice:   trim(i.unitPrice) || "0",
      kind:        i.kind,
    })),
  };
}

/** Everything the API wants, with money as strings and blanks as "0". */
export function draftToPayload(d: DraftDocument) {
  const money = (v: string) => (v.trim() === "" ? "0" : v.trim());
  return {
    title:           d.title.trim() || null,
    client_id:       d.clientId || null,
    client_name:     d.clientName.trim() || null,
    client_company:  d.clientCompany.trim() || null,
    client_email:    d.clientEmail.trim() || null,
    client_phone:    d.clientPhone.trim() || null,
    client_address:  d.clientAddress.trim() || null,
    currency:        d.currency,
    setup_fee:        money(d.setupFee),
    monthly_retainer: money(d.monthlyRetainer),
    retainer_months:  Math.max(0, Math.trunc(Number(d.retainerMonths) || 0)),
    discount_type:    d.discountType,
    discount_value:   d.discountType === "none" ? "0" : money(d.discountValue),
    tax_rate:         money(d.taxRate),
    valid_until:      d.validUntil || null,
    notes:            d.notes.trim() || null,
    terms:            d.terms.trim() || null,
    items: d.items
      .filter((i) => i.description.trim())
      .map((i) => ({
        description: i.description.trim(),
        quantity:    money(i.quantity) || "1",
        unit_price:  money(i.unitPrice),
        kind:        i.kind,
      })),
  };
}

interface Props {
  draft:      DraftDocument;
  onChange:   (next: DraftDocument) => void;
  clients:    ApiClient[];
  editing:    boolean;
  saving:     boolean;
  onSubmit:   () => void;
  /** Non-null when the form should show a validation problem inline. */
  error:      string | null;
}

export function DocumentForm({ draft, onChange, clients, editing, saving, onSubmit, error }: Props) {
  const set = <K extends keyof DraftDocument>(key: K, value: DraftDocument[K]) =>
    onChange({ ...draft, [key]: value });

  // Picking a client fills the snapshot fields, but never overwrites something
  // already typed — an address entered by hand for this one quotation should
  // survive re-selecting the same client.
  const pickClient = (id: string) => {
    const client = clients.find((c) => c.id === id);
    onChange({
      ...draft,
      clientId:      id,
      clientName:    client ? client.name    : draft.clientName,
      clientCompany: client ? client.company : draft.clientCompany,
      clientEmail:   client ? (client.email ?? "") : draft.clientEmail,
      clientPhone:   client ? (client.phone ?? "") : draft.clientPhone,
    });
  };

  const totals = useMemo(() => computeTotals({
    setupFee:        draft.setupFee,
    monthlyRetainer: draft.monthlyRetainer,
    retainerMonths:  Number(draft.retainerMonths) || 0,
    items:           draft.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, kind: i.kind })),
    discountType:    draft.discountType,
    discountValue:   draft.discountValue,
    taxRate:         draft.taxRate,
  }), [draft]);

  const money = (v: bigint) => formatCurrency(v, draft.currency || "EGP");

  const addItem = () => set("items", [
    ...draft.items,
    { key: newItemKey(), description: "", quantity: "1", unitPrice: "", kind: "one_off" },
  ]);

  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    set("items", draft.items.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const removeItem = (key: string) =>
    set("items", draft.items.filter((i) => i.key !== key));

  return (
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit quotation" : "New quotation"}</DialogTitle>
      </DialogHeader>

      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
        className="space-y-5"
      >
        {/* ── Client ── */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</h3>

          <div>
            <Label htmlFor="q-client">Existing client</Label>
            <select
              id="q-client"
              value={draft.clientId}
              onChange={(e) => pickClient(e.target.value)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">— none yet, type the details below —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.company} · {c.name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              A quotation can go out before the client exists. Converting an accepted one creates the record.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="q-company">Company</Label>
              <Input id="q-company" value={draft.clientCompany}
                     onChange={(e) => set("clientCompany", e.target.value)}
                     placeholder="Nile Dental Clinic" className="mt-1 h-11" />
            </div>
            <div>
              <Label htmlFor="q-name">Contact name</Label>
              <Input id="q-name" value={draft.clientName}
                     onChange={(e) => set("clientName", e.target.value)}
                     placeholder="Dr. Mariam Fahmy" className="mt-1 h-11" />
            </div>
            <div>
              <Label htmlFor="q-email">Email</Label>
              <Input id="q-email" type="email" value={draft.clientEmail}
                     onChange={(e) => set("clientEmail", e.target.value)} className="mt-1 h-11" />
            </div>
            <div>
              <Label htmlFor="q-phone">Phone</Label>
              <Input id="q-phone" value={draft.clientPhone}
                     onChange={(e) => set("clientPhone", e.target.value)} className="mt-1 h-11" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="q-address">Address</Label>
              <Input id="q-address" value={draft.clientAddress}
                     onChange={(e) => set("clientAddress", e.target.value)}
                     placeholder="12 El-Merghany St, Heliopolis, Cairo" className="mt-1 h-11" />
            </div>
          </div>
        </section>

        {/* ── Scope ── */}
        <section className="space-y-3 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pricing</h3>

          <div>
            <Label htmlFor="q-title">Title</Label>
            <Input id="q-title" value={draft.title}
                   onChange={(e) => set("title", e.target.value)}
                   placeholder="WhatsApp booking automation + AI receptionist" className="mt-1 h-11" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="q-setup">Setup fee</Label>
              <Input id="q-setup" inputMode="decimal" value={draft.setupFee}
                     onChange={(e) => set("setupFee", e.target.value)}
                     placeholder="0" className="mt-1 h-11 tabular-nums" />
            </div>
            <div>
              <Label htmlFor="q-retainer">Monthly retainer</Label>
              <Input id="q-retainer" inputMode="decimal" value={draft.monthlyRetainer}
                     onChange={(e) => set("monthlyRetainer", e.target.value)}
                     placeholder="0" className="mt-1 h-11 tabular-nums" />
            </div>
            <div>
              <Label htmlFor="q-months">Months</Label>
              <Input id="q-months" inputMode="numeric" value={draft.retainerMonths}
                     onChange={(e) => set("retainerMonths", e.target.value.replace(/\D/g, ""))}
                     className="mt-1 h-11 tabular-nums" />
            </div>
            <div>
              <Label htmlFor="q-currency">Currency</Label>
              <Input id="q-currency" value={draft.currency} maxLength={3}
                     onChange={(e) => set("currency", e.target.value.toUpperCase())}
                     className="mt-1 h-11 uppercase" />
            </div>
          </div>
        </section>

        {/* ── Line items ── */}
        <section className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line items</h3>
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5" onClick={addItem}>
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
          </div>

          {draft.items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
              Setup fee and retainer above are already itemised on the PDF. Add lines for anything else.
            </p>
          ) : (
            <div className="space-y-3">
              {draft.items.map((item, index) => {
                const line = totals.lines[index];
                return (
                  <div key={item.key} className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="flex items-start gap-2">
                      <Input
                        aria-label={`Line ${index + 1} description`}
                        value={item.description}
                        onChange={(e) => updateItem(item.key, { description: e.target.value })}
                        placeholder="What is being delivered"
                        className="h-11 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeItem(item.key)}
                        aria-label={`Remove line ${index + 1}`}
                        className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Ids are per-line so each visible label is actually bound
                        to its own input — "Qty" repeated five times with no
                        htmlFor is five unlabelled boxes to a screen reader. */}
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div>
                        <Label htmlFor={`${item.key}-qty`} className="text-[11px] text-muted-foreground">Qty</Label>
                        <Input id={`${item.key}-qty`} inputMode="decimal" value={item.quantity}
                               aria-label={`Line ${index + 1} quantity`}
                               onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
                               className="mt-1 h-11 tabular-nums" />
                      </div>
                      <div>
                        <Label htmlFor={`${item.key}-price`} className="text-[11px] text-muted-foreground">Unit price</Label>
                        <Input id={`${item.key}-price`} inputMode="decimal" value={item.unitPrice}
                               aria-label={`Line ${index + 1} unit price`}
                               onChange={(e) => updateItem(item.key, { unitPrice: e.target.value })}
                               placeholder="0" className="mt-1 h-11 tabular-nums" />
                      </div>
                      <div className="col-span-2">
                        <Label className="text-[11px] text-muted-foreground">Billing</Label>
                        {/* Two options, so radio semantics rather than two
                            buttons whose selected state is invisible to AT. */}
                        <div
                          role="radiogroup"
                          aria-label={`Line ${index + 1} billing`}
                          className="mt-1 flex gap-1 rounded-md border border-border bg-background p-0.5"
                        >
                          {([
                            ["one_off",   "One-time", CircleDollarSign],
                            ["recurring", "Monthly",  Repeat],
                          ] as const).map(([kind, label, Icon]) => (
                            <button
                              key={kind}
                              type="button"
                              role="radio"
                              aria-checked={item.kind === kind}
                              onClick={() => updateItem(item.key, { kind })}
                              className={cn(
                                "flex h-10 flex-1 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors",
                                item.kind === kind
                                  ? "bg-primary text-primary-foreground shadow-sm"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" /> {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {line && (
                      <p className="mt-2 text-right text-[11px] text-muted-foreground tabular-nums">
                        {item.kind === "recurring"
                          ? `${money(line.lineTotal)}/mo × ${Number(draft.retainerMonths) || 0} = `
                          : ""}
                        <span className="font-medium text-foreground">{money(line.extended)}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Adjustments ── */}
        <section className="space-y-3 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Discount, tax & validity</h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Label htmlFor="q-disc-type">Discount</Label>
              <div className="mt-1 flex gap-2">
                <select
                  id="q-disc-type"
                  value={draft.discountType}
                  onChange={(e) => set("discountType", e.target.value as DiscountType)}
                  className="h-11 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="none">None</option>
                  <option value="percent">Percent</option>
                  <option value="amount">Amount</option>
                </select>
                <Input
                  aria-label="Discount value"
                  inputMode="decimal"
                  value={draft.discountValue}
                  disabled={draft.discountType === "none"}
                  onChange={(e) => set("discountValue", e.target.value)}
                  placeholder={draft.discountType === "percent" ? "5" : "0"}
                  className="h-11 flex-1 tabular-nums"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="q-tax">Tax %</Label>
              <Input id="q-tax" inputMode="decimal" value={draft.taxRate}
                     onChange={(e) => set("taxRate", e.target.value)}
                     placeholder="0" className="mt-1 h-11 tabular-nums" />
            </div>
            <div>
              <Label htmlFor="q-valid">Valid until</Label>
              <Input id="q-valid" type="date" value={draft.validUntil}
                     onChange={(e) => set("validUntil", e.target.value)} className="mt-1 h-11" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="q-notes">Notes</Label>
              <Textarea id="q-notes" rows={3} value={draft.notes}
                        onChange={(e) => set("notes", e.target.value)}
                        placeholder="What the scope covers." className="mt-1" />
            </div>
            <div>
              <Label htmlFor="q-terms">Terms</Label>
              <Textarea id="q-terms" rows={3} value={draft.terms}
                        onChange={(e) => set("terms", e.target.value)} className="mt-1" />
            </div>
          </div>
        </section>

        {/* ── Live total ── */}
        <section className="rounded-xl border border-primary/25 bg-primary/5 p-4">
          <div className="space-y-1.5 text-sm">
            <Row label="Subtotal" value={money(totals.subtotal)} />
            {totals.discount > 0n && (
              <Row
                label={draft.discountType === "percent" ? `Discount (${draft.discountValue || 0}%)` : "Discount"}
                value={`− ${money(totals.discount)}`}
              />
            )}
            {totals.tax > 0n && <Row label={`Tax (${draft.taxRate || 0}%)`} value={money(totals.tax)} />}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-primary/20 pt-3">
            <span id="q-total-label" className="text-xs font-semibold uppercase tracking-wide text-primary">Total</span>
            {/* <output> is implicitly a live region, so the figure is announced
                as it changes instead of silently updating behind the keystroke
                that caused it. It also gives the total a name distinct from the
                subtotal, which can hold the identical string. */}
            <output
              aria-labelledby="q-total-label"
              className="text-lg font-bold tabular-nums text-foreground"
            >
              {money(totals.total)}
            </output>
          </div>
          {totals.monthlyTotal > 0n && Number(draft.retainerMonths) > 0 && (
            <p className="mt-1 text-right text-[11px] text-muted-foreground">
              Includes {money(totals.monthlyTotal)} per month for {Number(draft.retainerMonths)} month
              {Number(draft.retainerMonths) === 1 ? "" : "s"}.
            </p>
          )}
        </section>

        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" type="button" className="h-11 sm:h-10">Cancel</Button>
          </DialogClose>
          <Button type="submit" disabled={saving} className="h-11 sm:h-10">
            {saving ? "Saving…" : editing ? "Save quotation" : "Create quotation"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}

