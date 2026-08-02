import { useState } from "react";
import { DollarSign, TrendingUp, TrendingDown, Plus, Pencil, Trash2, Users, Wrench, RefreshCcw, Zap } from "lucide-react";
import { StatCard } from "@/components/modules/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  useTransactions, useFinanceSummary, useCategories,
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
import type { ApiTransaction } from "@/lib/types";

const fmt = (n: number) =>
  `EGP ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;

const EGP_CATEGORIES = ["Client Setup Fee", "Client Recurring Fee", "Other Income", "Salary", "Tools", "Marketing", "Other"];

function CategorySummary({ transactions, catLabel, icon: Icon, colorClass }: {
  transactions: ApiTransaction[];
  catLabel: string;
  icon: React.ElementType;
  colorClass: string;
}) {
  const rows = transactions.filter((t) => t.category === catLabel);
  const total = rows.reduce((s, t) => s + Number(t.amount), 0);
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
              {["Date", "Description", "Client", "Amount"].map((h) => (
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

  // All transactions for category breakdowns (no filter)
  const { data: allTxRes }  = useTransactions({ limit: 2000 });
  const allTransactions = allTxRes?.data ?? [];

  const { data: txRes, isLoading } = useTransactions({
    type:     typeFilter !== "all" ? typeFilter : undefined,
    category: catFilter  !== "all" ? catFilter  : undefined,
    from:     fromDate || undefined,
    to:       toDate   || undefined,
    limit:    500,
  });
  const { data: summary } = useFinanceSummary({ 
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
  const totalSalary   = allTransactions.filter((t) => t.category === "Salary").reduce((s, t) => s + Number(t.amount), 0);
  const totalTools    = allTransactions.filter((t) => t.category === "Tools").reduce((s, t) => s + Number(t.amount), 0);
  const totalRecurring = allTransactions.filter((t) => t.category === "Client Recurring Fee").reduce((s, t) => s + Number(t.amount), 0);
  const totalSetup    = allTransactions.filter((t) => t.category === "Client Setup Fee").reduce((s, t) => s + Number(t.amount), 0);

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

  const handleDelete = (id: string) => {
    if (!confirm("Delete this transaction?")) return;
    deleteTx.mutate(id, {
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
          <p className="text-sm text-muted-foreground mt-0.5">Track income, expenses and profitability.</p>
        </div>
        <Dialog open={isOpen} onOpenChange={(o) => { setIsOpen(o); if (!o) setEditTx(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5" onClick={() => openDialog(null)}>
              <Plus className="h-3.5 w-3.5" /> Add Transaction
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
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
                <div className="col-span-2"><Label>Date</Label><Input name="date" type="date" defaultValue={editTx?.date ?? new Date().toISOString().slice(0, 10)} required className="mt-1" /></div>
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
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
      </div>

      {/* Category summary row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
            <Wrench className="h-4 w-4 text-blue-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tools Spend</p>
            <p className="text-lg font-semibold text-foreground">{fmt(totalTools)}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
            <RefreshCcw className="h-4 w-4 text-green-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Client Recurring</p>
            <p className="text-lg font-semibold text-foreground">{fmt(totalRecurring)}</p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
            <Zap className="h-4 w-4 text-violet-500" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Setup Fees</p>
            <p className="text-lg font-semibold text-foreground">{fmt(totalSetup)}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="all">
        <TabsList className="mb-4">
          <TabsTrigger value="all">All Transactions</TabsTrigger>
          <TabsTrigger value="salary">Salaries</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="recurring">Client Recurring</TabsTrigger>
          <TabsTrigger value="setup">Setup Fees</TabsTrigger>
        </TabsList>

        {/* ── ALL TRANSACTIONS ── */}
        <TabsContent value="all">
          <div className="flex gap-3 flex-wrap items-center mb-4">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
              </SelectContent>
            </Select>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="w-48 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
            
            {/* Date Mode Toggle */}
            <div className="flex gap-1 rounded-md border border-border p-0.5 bg-muted/30">
              <button
                onClick={() => setDateMode("range")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                  dateMode === "range" 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Range
              </button>
              <button
                onClick={() => setDateMode("cumulative")}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                  dateMode === "cumulative" 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Cumulative
              </button>
            </div>

            {dateMode === "range" ? (
              <>
                <Input 
                  type="date" 
                  value={fromDate} 
                  onChange={(e) => setFromDate(e.target.value)} 
                  className="h-8 text-sm w-36" 
                  placeholder="From date"
                />
                <Input 
                  type="date" 
                  value={toDate} 
                  onChange={(e) => setToDate(e.target.value)} 
                  className="h-8 text-sm w-36" 
                  placeholder="To date"
                />
              </>
            ) : (
              <Input 
                type="date" 
                value={toDate} 
                onChange={(e) => setToDate(e.target.value)} 
                className="h-8 text-sm w-36" 
                placeholder="Until date"
              />
            )}
            
              </SelectContent>
            </Select>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 text-sm w-36" />
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 text-sm w-36" />
            {(fromDate || toDate || catFilter !== "all" || typeFilter !== "all") && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFromDate(""); setToDate(""); setCatFilter("all"); setTypeFilter("all"); }}>
                Clear
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading…</div>
          ) : (
            <div className="rounded-xl border border-border overflow-x-auto">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Date", "Type", "Amount", "Categories", "Tool", "Client", "Held by", "Notes", ""].map((h) => (
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
                          <div className="flex gap-1">
                            <button onClick={() => openDialog(t)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDelete(t.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
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
          )}
        </TabsContent>

        {/* ── SALARIES ── */}
        <TabsContent value="salary">
          <CategorySummary transactions={allTransactions} catLabel="Salary" icon={Users} colorClass="text-orange-500" />
        </TabsContent>

        {/* ── TOOLS ── */}
        <TabsContent value="tools">
          <CategorySummary transactions={allTransactions} catLabel="Tools" icon={Wrench} colorClass="text-blue-500" />
        </TabsContent>

        {/* ── CLIENT RECURRING ── */}
        <TabsContent value="recurring">
          <CategorySummary transactions={allTransactions} catLabel="Client Recurring Fee" icon={RefreshCcw} colorClass="text-green-600" />
        </TabsContent>

        {/* ── SETUP FEES ── */}
        <TabsContent value="setup">
          <CategorySummary transactions={allTransactions} catLabel="Client Setup Fee" icon={Zap} colorClass="text-violet-600" />
        </TabsContent>
      </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
