import { useState } from "react";
import { DollarSign, TrendingUp, TrendingDown, Plus, Pencil, Trash2, Users, Wrench, RefreshCcw, Zap, Download } from "lucide-react";
import { StatCard } from "@/components/modules/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCardSkeleton, TableSkeleton } from "@/components/ui/skeletons";
import { toast } from "sonner";
import {
  useTransactions, useFinanceSummary, useCategories, useCategoryTotals,
  useCreateTransaction, useUpdateTransaction, useDeleteTransaction,
  useTools,
} from "@/hooks/useFinance";
import { useClients } from "@/hooks/useClients";
import { useUsers } from "@/hooks/useTasks";
import { CategoryMultiSelect } from "@/components/modules/CategoryMultiSelect";
import { MonthlyAnalytics } from "@/components/modules/finance/MonthlyAnalytics";
import { ToolsPanel } from "@/components/modules/finance/ToolsPanel";
import { CashPositionsPanel } from "@/components/modules/finance/CashPositionsPanel";
import { cn } from "@/lib/utils";
import { cairoToday } from "@/lib/dates";
import { useConfirm } from "@/components/ConfirmDialog";
import { exportCsv, type CsvColumn } from "@/lib/csv";
import type { ApiTransaction } from "@/lib/types";

const fmt = (n: number) =>
  `EGP ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;

const EGP_CATEGORIES = ["Client Setup Fee", "Client Recurring Fee", "Other Income", "Salary", "Tools", "Marketing", "Other"];

const CATEGORY_COLUMNS = ["Date", "Description", "Client", "Amount"];

const TRANSACTION_COLUMNS = ["Date", "Type", "Amount", "Categories", "Tool", "Client", "Held by", "Notes", ""];

// Spreadsheet columns for the CSV export. Amount stays numeric so totals can be
// summed in Excel; categories collapse to a single semicolon-joined cell.
const TX_CSV_COLUMNS: CsvColumn<ApiTransaction>[] = [
  { header: "Date",       value: (t) => t.date },
  { header: "Type",       value: (t) => t.type },
  { header: "Amount",     value: (t) => Number(t.amount) },
  { header: "Currency",   value: (t) => t.currency },
  { header: "Categories", value: (t) => (t.categories?.length ? t.categories.join("; ") : t.category) },
  { header: "Tool",       value: (t) => t.tool_name },
  { header: "Client",     value: (t) => t.clientName },
  { header: "Held by",    value: (t) => t.held_by_name },
  { header: "Settled",    value: (t) => (t.heldBy ? (t.settledAt ? "yes" : "no") : "") },
  { header: "Status",     value: (t) => t.status },
  { header: "Notes",      value: (t) => t.notes },
];

/** Small icon + label + total tile. Only the total is data, so only it loads. */
function MiniStat({ icon: Icon, iconBg, iconColor, label, value, loading }: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", iconBg)}>
        <Icon className={cn("h-4 w-4", iconColor)} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        {loading
          ? <Skeleton className="mt-1 h-6 w-24" />
          : <p className="text-lg font-semibold text-foreground">{value}</p>}
      </div>
    </div>
  );
}

function CategorySummary({ transactions, catLabel, icon: Icon, colorClass, loading }: {
  transactions: ApiTransaction[];
  catLabel: string;
  icon: React.ElementType;
  colorClass: string;
  loading?: boolean;
}) {
  const rows = transactions.filter((t) => t.category === catLabel);
  const total = rows.reduce((s, t) => s + Number(t.amount), 0);

  // An empty `transactions` array means "still fetching" just as often as it
  // means "nothing here" — the two used to collapse into the same empty state,
  // which read as a false negative on every page load.
  if (loading) return (
    <div className="space-y-1">
      <div className={cn("flex items-center justify-between px-4 py-3 rounded-lg mb-3", colorClass + "/10 border border-current/10")}>
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", colorClass)} />
          <span className="text-sm font-semibold">{catLabel}</span>
        </div>
        <Skeleton className="h-5 w-24" />
      </div>
      <TableSkeleton columns={CATEGORY_COLUMNS} rows={5} />
    </div>
  );

  if (rows.length === 0) return (
    <div className="flex flex-col items-center justify-center h-24 text-muted-foreground text-sm">
      No {catLabel.toLowerCase()} entries yet.
    </div>
  );
  return (
    <div className="space-y-1">
      <div className={cn("flex items-center justify-between px-4 py-3 rounded-lg mb-3", colorClass + "/10 border border-current/10")}>
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", colorClass)} />
          <span className="text-sm font-semibold">{catLabel}</span>
        </div>
        <span className={cn("font-bold tabular-nums", colorClass)}>{fmt(total)}</span>
      </div>
      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {CATEGORY_COLUMNS.map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 text-muted-foreground tabular-nums text-xs">{t.date}</td>
                <td className="px-4 py-2.5">{t.notes || t.category}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{t.clientName || "—"}</td>
                <td className={cn("px-4 py-2.5 font-medium tabular-nums", colorClass)}>
                  {fmt(Number(t.amount))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Finance() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [catFilter,  setCatFilter]  = useState("all");
  const [fromDate,   setFromDate]   = useState("");
  const [toDate,     setToDate]     = useState("");
  const [dateMode,   setDateMode]   = useState<"range" | "cumulative">("range");
  const [editTx, setEditTx]         = useState<ApiTransaction | null>(null);
  const [isOpen, setIsOpen]         = useState(false);
  // Controlled form state for the new multi-value fields
  const [formCats,   setFormCats]   = useState<string[]>([]);
  const [formType,   setFormType]   = useState<"income" | "expense">("income");
  const [formToolId, setFormToolId] = useState<string>("");
  const [formHeldBy, setFormHeldBy] = useState<string>("");
  const [section,    setSection]    = useState("overview");
  const confirm = useConfirm();

  // Which sub-tab of the overview is showing. Lifted out of the inner <Tabs>
  // so the expensive full-ledger fetch below can be tied to it.
  const [txTab, setTxTab] = useState("all");
  const needsAllTx = txTab !== "all";

  // The four KPI cards come from a server-side aggregate. They used to be
  // computed by downloading up to 2,000 transactions and summing four
  // categories in the browser on every page load — which also silently
  // under-reported once the ledger passed that limit.
  const { data: categoryTotals = [], isLoading: loadingTotals } = useCategoryTotals();
  const totalFor = (name: string) =>
    categoryTotals.find((t) => t.category === name)?.total ?? 0;

  // The per-category tables genuinely need the rows, so this still fetches —
  // but only once the user opens one of those tabs.
  const { data: allTxRes, isLoading: loadingAllTxRaw } =
    useTransactions({ limit: 2000 }, { enabled: needsAllTx });
  const allTransactions = allTxRes?.data ?? [];
  const loadingAllTx = needsAllTx && loadingAllTxRaw;

  const { data: txRes, isLoading } = useTransactions({
    type:     typeFilter !== "all" ? typeFilter : undefined,
    category: catFilter  !== "all" ? catFilter  : undefined,
    from:     fromDate || undefined,
    to:       toDate   || undefined,
    limit:    500,
  });
  const { data: summary, isLoading: loadingSummary } = useFinanceSummary({
    from: fromDate || undefined,
    to: toDate || undefined,
    mode: dateMode,
  });
  const { data: categories = [] } = useCategories();
  const { data: clients = [] } = useClients();
  const { data: tools = [] } = useTools();
  const { data: users = [] } = useUsers();

  // Load the record being edited into the controlled fields.
  const openDialog = (tx: ApiTransaction | null) => {
    setEditTx(tx);
    setFormCats(tx?.categories?.length ? tx.categories : tx?.category ? [tx.category] : []);
    setFormType(tx?.type ?? "income");
    setFormToolId(tx?.toolId ?? "");
    setFormHeldBy(tx?.heldBy ?? "");
    setIsOpen(true);
  };

  const createTx = useCreateTransaction();
  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();

  const transactions = txRes?.data ?? [];

  // Category breakdowns
  const totalSalary    = totalFor("Salary");
  const totalTools     = totalFor("Tools");
  const totalRecurring = totalFor("Client Recurring Fee");
  const totalSetup     = totalFor("Client Setup Fee");

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    if (formCats.length === 0) {
      toast.error("Pick at least one category");
      return;
    }

    const body = {
      date:        fd.get("date") as string,
      type:        formType,
      amount:      Number(fd.get("amount")),
      categories:  formCats,                 // categories[0] is the primary
      tool_id:     formToolId || null,
      held_by:     formHeldBy || null,
      client_id:   (fd.get("client_id") as string) || undefined,
      status:      "completed",
      notes:       (fd.get("notes") as string) || undefined,
    };
    if (editTx) {
      updateTx.mutate({ id: editTx.id, ...body }, {
        onSuccess: () => { setIsOpen(false); setEditTx(null); toast.success("Transaction updated"); },
        onError:   (err) => toast.error(err.message),
      });
    } else {
      createTx.mutate(body, {
        onSuccess: () => { setIsOpen(false); toast.success("Transaction added"); },
        onError:   (err) => toast.error(err.message),
      });
    }
  };

  const handleDelete = async (t: ApiTransaction) => {
    const ok = await confirm({
      title: "Delete this transaction?",
      description:
        `${t.type === "income" ? "Income" : "Expense"} of ${fmt(Number(t.amount))} ` +
        `on ${t.date}${t.clientName ? ` for ${t.clientName}` : ""}.\n` +
        "It is removed from every total and report. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    deleteTx.mutate(t.id, {
      onSuccess: () => toast.success("Transaction deleted"),
      onError:   (err) => toast.error(err.message),
    });
  };

  const income   = Number(summary?.total_income   ?? 0);
  const expenses = Number(summary?.total_expenses ?? 0);
  const profit   = Number(summary?.net_profit     ?? 0);
  const margin   = Number(summary?.profit_margin  ?? 0);

  const allCats = Array.from(new Set([...EGP_CATEGORIES, ...categories]));

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Finance</h1>
          <p className="hidden sm:block text-sm text-muted-foreground mt-0.5">Track income, expenses and profitability.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={transactions.length === 0}
            // Exports what the current filters produced, not the whole ledger —
            // the button sits next to the filters, so matching them is the
            // least surprising behaviour.
            onClick={() => exportCsv("transactions", transactions, TX_CSV_COLUMNS)}
            title={transactions.length ? `Export ${transactions.length} rows to CSV` : "Nothing to export"}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </Button>
        <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); if (!o) setEditTx(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5" onClick={() => openDialog(null)}>
              <Plus className="h-3.5 w-3.5" /> Add Transaction
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editTx ? "Edit" : "Add"} Transaction</DialogTitle></DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Type</Label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as "income" | "expense")}
                    className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
                <div><Label>Amount</Label><Input name="amount" type="number" step="0.01" min="0" defaultValue={editTx ? Number(editTx.amount) : undefined} required className="mt-1" /></div>
                <div className="col-span-2"><Label>Date</Label><Input name="date" type="date" defaultValue={editTx?.date ?? cairoToday()} required className="mt-1" /></div>
              </div>

              <div>
                <Label>Categories</Label>
                <div className="mt-1.5">
                  <CategoryMultiSelect value={formCats} onChange={setFormCats} suggestions={allCats} />
                </div>
              </div>

              {/* Tool picker — only meaningful for expenses */}
              {formType === "expense" && (
                <div>
                  <Label>Tool <span className="text-muted-foreground font-normal text-xs">(instead of typing it in notes)</span></Label>
                  <select
                    value={formToolId}
                    onChange={(e) => setFormToolId(e.target.value)}
                    className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— none —</option>
                    {tools.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}{t.kind ? ` · ${t.kind}` : ""}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <Label>
                  Held by <span className="text-muted-foreground font-normal text-xs">
                    ({formType === "income" ? "who collected this cash" : "who paid from their own pocket"})
                  </span>
                </Label>
                <select
                  value={formHeldBy}
                  onChange={(e) => setFormHeldBy(e.target.value)}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Company account — nothing outstanding</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                {formHeldBy && (
                  <p className="text-[10px] text-warning mt-1">
                    Will show as outstanding in <span className="font-medium">Cash</span> until you settle it.
                  </p>
                )}
              </div>

              <div>
                <Label>Client (optional)</Label>
                <select
                  name="client_id"
                  defaultValue={editTx?.clientId ?? ""}
                  className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.name} · {client.company}</option>
                  ))}
                </select>
              </div>
              <div><Label>Notes</Label><Textarea name="notes" defaultValue={editTx?.notes ?? undefined} rows={2} className="mt-1" /></div>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
                <Button type="submit" disabled={createTx.isPending || updateTx.isPending}>
                  {(createTx.isPending || updateTx.isPending) ? "Saving…" : editTx ? "Update" : "Add"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* ── Top-level sections ── */}
      <Tabs value={section} onValueChange={setSection}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="cash">Cash</TabsTrigger>
        </TabsList>

        <TabsContent value="monthly" className="mt-4"><MonthlyAnalytics /></TabsContent>
        <TabsContent value="tools"   className="mt-4"><ToolsPanel /></TabsContent>
        <TabsContent value="cash"    className="mt-4"><CashPositionsPanel /></TabsContent>

        <TabsContent value="overview" className="mt-4 space-y-6">
      {/* KPI cards — placeheld rather than showing EGP 0 before the numbers land */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(loadingSummary || loadingTotals) ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              title="Total Income"
              value={fmt(income)}
              icon={TrendingUp}
              changeType="positive"
              change={dateMode === "cumulative" && toDate ? `Until ${toDate}` : "All time"}
            />
            <StatCard
              title="Total Expenses"
              value={fmt(expenses)}
              icon={TrendingDown}
              changeType="negative"
              change={dateMode === "cumulative" && toDate ? `Until ${toDate}` : "All time"}
            />
            <StatCard
              title="Net Profit"
              value={fmt(profit)}
              icon={DollarSign}
              changeType="positive"
              change={`${margin}% margin`}
            />
            <StatCard
              title="Salaries Paid"
              value={fmt(totalSalary)}
              icon={Users}
              changeType="negative"
              change="All time"
            />
          </>
        )}
      </div>

      {/* Category summary row — icons/labels are static, only the totals load */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MiniStat icon={Wrench}    iconBg="bg-blue-500/10"   iconColor="text-blue-500"
                  label="Tools Spend"      value={fmt(totalTools)}     loading={loadingTotals} />
        <MiniStat icon={RefreshCcw} iconBg="bg-green-500/10"  iconColor="text-green-500"
                  label="Client Recurring" value={fmt(totalRecurring)} loading={loadingTotals} />
        <MiniStat icon={Zap}        iconBg="bg-violet-500/10" iconColor="text-violet-500"
                  label="Setup Fees"       value={fmt(totalSetup)}     loading={loadingTotals} />
      </div>

      {/* Tabs */}
      <Tabs value={txTab} onValueChange={setTxTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="all">All Transactions</TabsTrigger>
          <TabsTrigger value="salary">Salaries</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="recurring">Client Recurring</TabsTrigger>
          <TabsTrigger value="setup">Setup Fees</TabsTrigger>
        </TabsList>

        {/* ── ALL TRANSACTIONS ── */}
        <TabsContent value="all">
          {/* The category <SelectContent> used to contain the date-mode toggle
              and a set of date inputs instead of its options, so the category
              filter rendered zero options and was a dead control, while the
              Range/Cumulative toggle was trapped inside a dropdown popover and
              could not be reached. A second, duplicate pair of date inputs
              below it was the only one visible, and ignored the mode. */}
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="fin-type" className="text-[11px] text-muted-foreground">Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger id="fin-type" aria-label="Filter by type" className="mt-1 h-8 w-36 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="fin-cat" className="text-[11px] text-muted-foreground">Category</Label>
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger id="fin-cat" aria-label="Filter by category" className="mt-1 h-8 w-48 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Date mode — a two-option choice, so radio semantics rather than
                two buttons whose selected state a screen reader cannot infer. */}
            <div>
              <span className="text-[11px] text-muted-foreground">Dates</span>
              <div role="radiogroup" aria-label="Date filter mode" className="mt-1 flex gap-1 rounded-md border border-border bg-muted/30 p-0.5">
                {([["range", "Range"], ["cumulative", "Cumulative"]] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={dateMode === mode}
                    onClick={() => setDateMode(mode)}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                      dateMode === mode
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {dateMode === "range" && (
              <div>
                <Label htmlFor="fin-from" className="text-[11px] text-muted-foreground">From</Label>
                <Input
                  id="fin-from" type="date" value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="mt-1 h-8 w-36 text-sm"
                />
              </div>
            )}
            <div>
              <Label htmlFor="fin-to" className="text-[11px] text-muted-foreground">
                {dateMode === "range" ? "To" : "Up to"}
              </Label>
              <Input
                id="fin-to" type="date" value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1 h-8 w-36 text-sm"
              />
            </div>

            {(fromDate || toDate || catFilter !== "all" || typeFilter !== "all") && (
              <Button
                variant="ghost" size="sm" className="h-8 text-xs"
                onClick={() => { setFromDate(""); setToDate(""); setCatFilter("all"); setTypeFilter("all"); }}
              >
                Clear filters
              </Button>
            )}
          </div>

          {isLoading ? (
            <TableSkeleton columns={TRANSACTION_COLUMNS} rows={8} />
          ) : (
            <>
            {/* ── Phone: one card per transaction ──────────
                The nine-column table overflowed a 390px screen by 463px, so
                everything from Categories rightwards — including the actions —
                was off-screen and reachable only by dragging. */}
            <div className="space-y-2 md:hidden">
              {transactions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                  No transactions match these filters.
                </p>
              ) : transactions.map((t) => (
                <div key={t.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={cn("text-base font-semibold tabular-nums",
                        t.type === "income" ? "text-green-400" : "text-red-400")}>
                        {t.type === "expense" ? "−" : "+"}{fmt(Number(t.amount))}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-foreground">
                        {t.category}
                        {(t.categories ?? []).length > 1 && (
                          <span className="text-muted-foreground"> +{(t.categories ?? []).length - 1}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openDialog(t)}
                        aria-label={`Edit transaction of ${fmt(Number(t.amount))} on ${t.date}`}
                        className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground active:bg-muted"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(t)}
                        aria-label={`Delete transaction of ${fmt(Number(t.amount))} on ${t.date}`}
                        className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground active:bg-muted active:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">{t.date}</span>
                    {t.clientName && <span className="truncate">{t.clientName}</span>}
                    {t.tool_name && <span className="truncate">{t.tool_name}</span>}
                    {t.held_by_name && (
                      <span className={cn(t.settledAt ? "" : "text-warning")}>
                        held by {t.held_by_name}{t.settledAt ? "" : " · unsettled"}
                      </span>
                    )}
                    {t.status !== "completed" && (
                      <Badge variant="outline" className="text-[9px]">{t.status}</Badge>
                    )}
                  </div>

                  {t.notes && (
                    <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">{t.notes}</p>
                  )}
                </div>
              ))}
            </div>

            {/* ── Desktop: full table ── */}
            <div className="hidden rounded-xl border border-border md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {TRANSACTION_COLUMNS.map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No transactions match filters.</td></tr>
                    ) : transactions.map((t) => (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">{t.date}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn("text-[10px]",
                            t.type === "income" ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400",
                          )}>{t.type}</Badge>
                        </td>
                        <td className={cn("px-4 py-3 font-medium tabular-nums",
                          t.type === "income" ? "text-green-400" : "text-red-400",
                        )}>
                          {t.type === "expense" ? "−" : "+"}{fmt(Number(t.amount))}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-foreground">{t.category}</span>
                            {(t.categories ?? []).slice(1).map((c) => (
                              <Badge key={c} variant="outline" className="text-[9px] text-muted-foreground">{c}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {t.tool_name
                            ? <Badge variant="outline" className="text-[9px] border-primary/30 text-primary">{t.tool_name}</Badge>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{t.clientName ?? "—"}</td>
                        <td className="px-4 py-3 text-xs">
                          {t.held_by_name
                            ? (
                              <span className={cn("text-[11px]", t.settledAt ? "text-muted-foreground line-through" : "text-warning")}>
                                {t.held_by_name}
                              </span>
                            )
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[160px] truncate" title={t.notes ?? ""}>{t.notes ?? "—"}</td>
                        <td className="px-4 py-3">
                          {/* Were bare 22px <button>s with no accessible name.
                              Sized to a usable touch target and labelled. */}
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => openDialog(t)}
                              aria-label={`Edit transaction of ${fmt(Number(t.amount))} on ${t.date}`}
                              title="Edit"
                              className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-7 sm:w-7"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(t)}
                              aria-label={`Delete transaction of ${fmt(Number(t.amount))} on ${t.date}`}
                              title="Delete"
                              className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive sm:h-7 sm:w-7"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
                {transactions.length} entries
              </div>
            </div>
            <p className="px-1 pt-1 text-xs text-muted-foreground md:hidden">
              {transactions.length} entries
            </p>
            </>
          )}
        </TabsContent>

        {/* ── SALARIES ── */}
        <TabsContent value="salary">
          <CategorySummary transactions={allTransactions} catLabel="Salary" icon={Users} colorClass="text-orange-500" loading={loadingAllTx} />
        </TabsContent>

        {/* ── TOOLS ── */}
        <TabsContent value="tools">
          <CategorySummary transactions={allTransactions} catLabel="Tools" icon={Wrench} colorClass="text-blue-500" loading={loadingAllTx} />
        </TabsContent>

        {/* ── CLIENT RECURRING ── */}
        <TabsContent value="recurring">
          <CategorySummary transactions={allTransactions} catLabel="Client Recurring Fee" icon={RefreshCcw} colorClass="text-green-600" loading={loadingAllTx} />
        </TabsContent>

        {/* ── SETUP FEES ── */}
        <TabsContent value="setup">
          <CategorySummary transactions={allTransactions} catLabel="Client Setup Fee" icon={Zap} colorClass="text-violet-600" loading={loadingAllTx} />
        </TabsContent>
      </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
