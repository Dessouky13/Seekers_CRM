import { useState } from "react";
import {
  FileText, Plus, Download, Link2, Copy, Trash2, Pencil, MoreHorizontal,
  ArrowRightLeft, CheckCircle2, Send, CalendarPlus, ExternalLink, Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { TableSkeleton } from "@/components/ui/skeletons";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { useClients } from "@/hooks/useClients";
import {
  useQuotations, useCreateQuotation, useUpdateQuotation, useQuotationStatus,
  useDuplicateQuotation, useDeleteQuotation, useConvertQuotation,
  useInvoices, useInvoiceStatus, useNextInvoice, useDeleteInvoice,
  useCompanySettings, downloadDocumentPdf,
} from "@/hooks/useQuotations";
import {
  DocumentForm, blankDraft, draftFromQuotation, draftToPayload,
  type DraftDocument,
} from "@/components/modules/quotations/DocumentForm";
import { formatCurrency, parseMoneyLoose } from "@/lib/document-money";
import { cn } from "@/lib/utils";
import type { ApiQuotation, ApiInvoice, QuotationStatus, InvoiceStatus } from "@/lib/types";

const QUOTATION_STATUS: Record<QuotationStatus, string> = {
  draft:    "border-muted-foreground/30 bg-muted text-muted-foreground",
  sent:     "border-blue-500/30 bg-blue-500/10 text-blue-400",
  accepted: "border-green-500/30 bg-green-500/10 text-green-400",
  rejected: "border-red-500/30 bg-red-500/10 text-red-400",
  expired:  "border-orange-500/30 bg-orange-500/10 text-orange-400",
};

const INVOICE_STATUS: Record<InvoiceStatus, string> = {
  draft:   "border-muted-foreground/30 bg-muted text-muted-foreground",
  sent:    "border-blue-500/30 bg-blue-500/10 text-blue-400",
  paid:    "border-green-500/30 bg-green-500/10 text-green-400",
  overdue: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  void:    "border-red-500/30 bg-red-500/10 text-red-400",
};

const money = (amount: string, currency: string) =>
  formatCurrency(parseMoneyLoose(amount), currency);

function recipient(doc: { clientCompany: string | null; clientName: string | null }) {
  return doc.clientCompany || doc.clientName || "—";
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Share link copied", { description: "Anyone with the link can view this document." });
  } catch {
    // clipboard is blocked outside a secure context — show the link so it can
    // still be copied by hand rather than failing silently.
    toast.info("Copy this link", { description: url, duration: 15000 });
  }
}

export default function Quotations() {
  const [tab, setTab]         = useState("quotations");
  const [search, setSearch]   = useState("");
  const [status, setStatus]   = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApiQuotation | null>(null);
  const [draft, setDraft]     = useState<DraftDocument>(() =>
    blankDraft({ currency: "EGP", taxRate: "", terms: "" }));
  const [formError, setFormError] = useState<string | null>(null);

  const confirm = useConfirm();
  const { data: settings }              = useCompanySettings();
  const { data: clients = [] }          = useClients();
  const { data: quotations = [], isLoading: loadingQuotations } = useQuotations({ search, status });
  const { data: invoices  = [], isLoading: loadingInvoices }    = useInvoices();

  const createQuotation  = useCreateQuotation();
  const updateQuotation  = useUpdateQuotation();
  const setQuotationStatus = useQuotationStatus();
  const duplicate        = useDuplicateQuotation();
  const removeQuotation  = useDeleteQuotation();
  const convert          = useConvertQuotation();
  const setInvoiceStatus = useInvoiceStatus();
  const nextInvoice      = useNextInvoice();
  const removeInvoice    = useDeleteInvoice();

  const openNew = () => {
    setEditing(null);
    setDraft(blankDraft({
      currency: settings?.defaultCurrency ?? "EGP",
      taxRate:  settings && Number(settings.defaultTaxRate) > 0 ? String(Number(settings.defaultTaxRate)) : "",
      terms:    settings?.defaultPaymentTerms ?? "",
    }));
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (q: ApiQuotation) => {
    setEditing(q);
    setDraft(draftFromQuotation(q));
    setFormError(null);
    setFormOpen(true);
  };

  const submit = () => {
    const payload = draftToPayload(draft);

    if (!payload.client_id && !payload.client_company && !payload.client_name) {
      setFormError("Pick a client or type a company name.");
      return;
    }
    // The API refuses this too; catching it here means the user sees it next to
    // the field rather than as a toast after a round trip.
    if (Number(payload.monthly_retainer) > 0 && payload.retainer_months < 1) {
      setFormError("A monthly retainer needs a term of at least 1 month.");
      return;
    }
    setFormError(null);

    const done = (verb: string) => () => {
      setFormOpen(false);
      setEditing(null);
      toast.success(`Quotation ${verb}`);
    };
    const fail = (err: Error) => setFormError(err.message);

    if (editing) {
      updateQuotation.mutate({ id: editing.id, ...payload }, { onSuccess: done("saved"), onError: fail });
    } else {
      createQuotation.mutate(payload, { onSuccess: done("created"), onError: fail });
    }
  };

  const download = async (kind: "quotations" | "invoices", id: string, number: string) => {
    try {
      await downloadDocumentPdf(kind, id, `Seekers-${number}.pdf`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // ── Quotation columns ──
  const quotationColumns: ResponsiveColumn<ApiQuotation>[] = [
    {
      header: "Number", priority: "primary",
      cell: (q) => (
        <span className="font-medium tabular-nums">{q.number}</span>
      ),
    },
    {
      header: "Client", priority: "secondary",
      cell: (q) => (
        <span>
          {recipient(q)}
          {q.title && <span className="text-muted-foreground"> · {q.title}</span>}
        </span>
      ),
    },
    {
      header: "Status", priority: "meta", hideLabelOnMobile: true,
      cell: (q) => (
        <Badge variant="outline" className={cn("text-[10px]", QUOTATION_STATUS[q.status])}>
          {q.is_expired && q.status !== "accepted" && q.status !== "rejected" ? "expired" : q.status}
        </Badge>
      ),
    },
    {
      header: "Total", priority: "meta", hideLabelOnMobile: true,
      className: "tabular-nums font-medium",
      cell: (q) => money(q.totals.total, q.currency),
    },
    {
      header: "Valid until", priority: "detail",
      className: "text-xs text-muted-foreground tabular-nums",
      cell: (q) => q.validUntil ?? "—",
    },
    {
      header: "Invoice", priority: "detail",
      cell: (q) => (q.invoice_number
        ? <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">{q.invoice_number}</Badge>
        : <span className="text-xs text-muted-foreground">—</span>),
    },
  ];

  const invoiceColumns: ResponsiveColumn<ApiInvoice>[] = [
    { header: "Number", priority: "primary", cell: (i) => <span className="font-medium tabular-nums">{i.number}</span> },
    {
      header: "Client", priority: "secondary",
      cell: (i) => (
        <span>
          {recipient(i)}
          {i.recurring && (
            <span className="text-muted-foreground">
              {" · "}month {i.recurrenceIndex}{i.recurrenceTotal ? ` of ${i.recurrenceTotal}` : ""}
            </span>
          )}
        </span>
      ),
    },
    {
      header: "Status", priority: "meta", hideLabelOnMobile: true,
      cell: (i) => (
        <Badge variant="outline" className={cn("text-[10px]", INVOICE_STATUS[i.is_overdue ? "overdue" : i.status])}>
          {i.is_overdue ? "overdue" : i.status}
        </Badge>
      ),
    },
    {
      header: "Total", priority: "meta", hideLabelOnMobile: true,
      className: "tabular-nums font-medium",
      cell: (i) => money(i.totals.total, i.currency),
    },
    { header: "Issued", priority: "detail", className: "text-xs text-muted-foreground tabular-nums", cell: (i) => i.issueDate },
    { header: "Due",    priority: "detail", className: "text-xs text-muted-foreground tabular-nums", cell: (i) => i.dueDate ?? "—" },
  ];

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Quotations &amp; Invoices</h1>
          <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
            Price a deal, send a branded PDF, and turn an accepted quotation into invoiced revenue.
          </p>
        </div>
        <Dialog open={formOpen} onOpenChange={(o) => { setFormOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-11 shrink-0 gap-1.5 sm:h-9" onClick={openNew}>
              <Plus className="h-4 w-4" />
              <span className="hidden xs:inline sm:inline">New quotation</span>
              <span className="xs:hidden sm:hidden">New</span>
            </Button>
          </DialogTrigger>
          <DocumentForm
            draft={draft}
            onChange={setDraft}
            clients={clients}
            editing={!!editing}
            saving={createQuotation.isPending || updateQuotation.isPending}
            onSubmit={submit}
            error={formError}
          />
        </Dialog>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="quotations" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Quotations
          </TabsTrigger>
          <TabsTrigger value="invoices" className="gap-1.5">
            <Receipt className="h-3.5 w-3.5" /> Invoices
          </TabsTrigger>
        </TabsList>

        {/* ── QUOTATIONS ── */}
        <TabsContent value="quotations" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor="q-search" className="text-[11px] text-muted-foreground">Search</Label>
              <Input
                id="q-search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Number, client or title" className="mt-1 h-11 sm:h-9"
              />
            </div>
            <div>
              <Label htmlFor="q-status" className="text-[11px] text-muted-foreground">Status</Label>
              <select
                id="q-status" value={status} onChange={(e) => setStatus(e.target.value)}
                className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:h-9 sm:w-40"
              >
                <option value="all">All statuses</option>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          </div>

          {loadingQuotations ? (
            <TableSkeleton columns={["Number", "Client", "Status", "Total", ""]} rows={5} />
          ) : (
            <ResponsiveTable
              rows={quotations}
              columns={quotationColumns}
              rowKey={(q) => q.id}
              caption="Quotations"
              empty={
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
                  <FileText className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {search || status !== "all" ? "No quotations match these filters." : "No quotations yet."}
                  </p>
                  {!search && status === "all" && (
                    <Button size="sm" className="mt-4 h-11 gap-1.5 sm:h-9" onClick={openNew}>
                      <Plus className="h-4 w-4" /> New quotation
                    </Button>
                  )}
                </div>
              }
              actions={(q) => (
                <div className="flex items-center gap-1">
                  <IconAction
                    label={`Download ${q.number} as PDF`}
                    icon={Download}
                    onClick={() => download("quotations", q.id, q.number)}
                  />
                  <IconAction
                    label={`Copy the share link for ${q.number}`}
                    icon={Link2}
                    onClick={() => copyLink(q.share_url)}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`More actions for ${q.number}`}
                        className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => window.open(q.share_url, "_blank", "noopener")}>
                        <ExternalLink className="mr-2 h-3.5 w-3.5" /> Open share page
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openEdit(q)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => duplicate.mutate(q.id, {
                          onSuccess: (copy) => toast.success(`Duplicated as ${copy.number}`),
                          onError:   (err) => toast.error(err.message),
                        })}
                      >
                        <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      {q.status !== "sent" && (
                        <DropdownMenuItem onClick={() => changeQuotationStatus(q, "sent")}>
                          <Send className="mr-2 h-3.5 w-3.5" /> Mark as sent
                        </DropdownMenuItem>
                      )}
                      {q.status !== "accepted" && (
                        <DropdownMenuItem onClick={() => changeQuotationStatus(q, "accepted")}>
                          <CheckCircle2 className="mr-2 h-3.5 w-3.5 text-green-500" /> Mark as accepted
                        </DropdownMenuItem>
                      )}
                      {q.status !== "rejected" && (
                        <DropdownMenuItem onClick={() => changeQuotationStatus(q, "rejected")}>
                          <Trash2 className="mr-2 h-3.5 w-3.5" /> Mark as rejected
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        disabled={q.status !== "accepted" || !!q.invoice_id}
                        onClick={() => convertToInvoice(q)}
                      >
                        <ArrowRightLeft className="mr-2 h-3.5 w-3.5 text-primary" />
                        {q.invoice_id ? `Invoiced (${q.invoice_number})` : "Convert to invoice"}
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem className="text-destructive" onClick={() => deleteQuotation(q)}>
                        <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            />
          )}
        </TabsContent>

        {/* ── INVOICES ── */}
        <TabsContent value="invoices" className="mt-4 space-y-4">
          {loadingInvoices ? (
            <TableSkeleton columns={["Number", "Client", "Status", "Total", ""]} rows={5} />
          ) : (
            <ResponsiveTable
              rows={invoices}
              columns={invoiceColumns}
              rowKey={(i) => i.id}
              caption="Invoices"
              empty={
                <div className="rounded-xl border border-dashed border-border/60 px-4 py-12 text-center">
                  <Receipt className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No invoices yet.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Accept a quotation and convert it — the invoice inherits its pricing.
                  </p>
                </div>
              }
              actions={(i) => (
                <div className="flex items-center gap-1">
                  {i.status !== "paid" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-11 gap-1.5 px-2.5 text-xs sm:h-9"
                      disabled={setInvoiceStatus.isPending}
                      onClick={() => markPaid(i)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      <span className="hidden sm:inline">Mark paid</span>
                      <span className="sm:hidden">Paid</span>
                    </Button>
                  ) : (
                    <IconAction
                      label={`Download ${i.number} as PDF`}
                      icon={Download}
                      onClick={() => download("invoices", i.id, i.number)}
                    />
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`More actions for ${i.number}`}
                        className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onClick={() => download("invoices", i.id, i.number)}>
                        <Download className="mr-2 h-3.5 w-3.5" /> Download PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => copyLink(i.share_url)}>
                        <Link2 className="mr-2 h-3.5 w-3.5" /> Copy share link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => window.open(i.share_url, "_blank", "noopener")}>
                        <ExternalLink className="mr-2 h-3.5 w-3.5" /> Open share page
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      {i.status !== "sent" && i.status !== "paid" && (
                        <DropdownMenuItem onClick={() => changeInvoiceStatus(i, "sent")}>
                          <Send className="mr-2 h-3.5 w-3.5" /> Mark as sent
                        </DropdownMenuItem>
                      )}
                      {i.status === "paid" && (
                        <DropdownMenuItem onClick={() => unpay(i)}>
                          <ArrowRightLeft className="mr-2 h-3.5 w-3.5" /> Mark as unpaid
                        </DropdownMenuItem>
                      )}
                      {i.recurring && (
                        <DropdownMenuItem onClick={() => spawnNext(i)}>
                          <CalendarPlus className="mr-2 h-3.5 w-3.5 text-primary" /> Generate next month
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuSeparator />

                      <DropdownMenuItem onClick={() => changeInvoiceStatus(i, "void")}>
                        <Trash2 className="mr-2 h-3.5 w-3.5" /> Void
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => deleteInvoice(i)}>
                        <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );

  // ── Actions ─────────────────────────────────────────────

  function changeQuotationStatus(q: ApiQuotation, next: QuotationStatus) {
    setQuotationStatus.mutate({ id: q.id, status: next }, {
      onSuccess: () => toast.success(`${q.number} marked ${next}`),
      onError:   (err) => toast.error(err.message),
    });
  }

  function convertToInvoice(q: ApiQuotation) {
    convert.mutate(q.id, {
      onSuccess: (invoice) => {
        setTab("invoices");
        toast.success(
          invoice.already_existed
            ? `Already invoiced as ${invoice.number}`
            : `Created invoice ${invoice.number}`,
          {
            description: invoice.recurring
              ? "Setup fee plus the first month. Generate the next month when it is due."
              : undefined,
          },
        );
      },
      onError: (err) => toast.error(err.message),
    });
  }

  async function deleteQuotation(q: ApiQuotation) {
    const ok = await confirm({
      title: `Delete ${q.number}?`,
      description:
        `${recipient(q)} · ${money(q.totals.total, q.currency)}.\n` +
        "Its share link stops working immediately. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    removeQuotation.mutate(q.id, {
      onSuccess: () => toast.success(`${q.number} deleted`),
      onError:   (err) => toast.error(err.message),
    });
  }

  async function markPaid(invoice: ApiInvoice) {
    const ok = await confirm({
      title: `Mark ${invoice.number} as paid?`,
      description:
        `This records ${money(invoice.totals.total, invoice.currency)} as income for ` +
        `${recipient(invoice)}, so it appears in Finance and the P&L straight away.`,
      confirmLabel: "Mark paid",
    });
    if (!ok) return;

    setInvoiceStatus.mutate({ id: invoice.id, status: "paid" }, {
      onSuccess: (updated) => toast.success(
        `${invoice.number} marked paid`,
        {
          description: updated.ledger_action === "create"
            ? `${money(invoice.totals.total, invoice.currency)} added to Finance.`
            : "It was already recorded in Finance — nothing was counted twice.",
        },
      ),
      onError: (err) => toast.error(err.message),
    });
  }

  async function unpay(invoice: ApiInvoice) {
    const ok = await confirm({
      title: `Mark ${invoice.number} as unpaid?`,
      description:
        "The income row this invoice wrote is removed from Finance, so the P&L stops " +
        "counting money that was not received.",
      confirmLabel: "Mark unpaid",
      destructive: true,
    });
    if (!ok) return;
    changeInvoiceStatus(invoice, "sent");
  }

  function changeInvoiceStatus(invoice: ApiInvoice, next: InvoiceStatus) {
    setInvoiceStatus.mutate({ id: invoice.id, status: next }, {
      onSuccess: (updated) => toast.success(
        `${invoice.number} marked ${next}`,
        updated.ledger_action === "remove"
          ? { description: "Its income row was removed from Finance." }
          : undefined,
      ),
      onError: (err) => toast.error(err.message),
    });
  }

  function spawnNext(invoice: ApiInvoice) {
    nextInvoice.mutate(invoice.id, {
      onSuccess: (created) => toast.success(
        created.already_existed
          ? `Next month already exists: ${created.number}`
          : `Created ${created.number} for ${created.issueDate}`,
      ),
      onError: (err) => toast.error(err.message),
    });
  }

  async function deleteInvoice(invoice: ApiInvoice) {
    const ok = await confirm({
      title: `Delete ${invoice.number}?`,
      description: invoice.transactionId
        ? "This invoice has revenue in the P&L. Void it instead — the API will refuse the delete."
        : `${recipient(invoice)} · ${money(invoice.totals.total, invoice.currency)}. This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    removeInvoice.mutate(invoice.id, {
      onSuccess: () => toast.success(`${invoice.number} deleted`),
      onError:   (err) => toast.error(err.message),
    });
  }
}

/** 44px touch target on a phone, tighter on a pointer device. */
function IconAction({ label, icon: Icon, onClick }: {
  label: string;
  icon: typeof Download;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
