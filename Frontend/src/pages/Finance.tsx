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
} from "@/hooks/useFinance";
import { cn } from "@/lib/utils";
import type { ApiTransaction } from "@/lib/types";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

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
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
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
  const [editTx, setEditTx]         = useState<ApiTransaction | null>(null);
  const [isOpen, setIsOpen]         = useState(false);

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
  const { data: summary } = useFinanceSummary({ from: fromDate || undefined, to: toDate || undefined });
  const { data: categories = [] } = useCategories();

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
    const body = {
      date:        fd.get("date") as string,
      type:        fd.get("type") as string,
      amount:      Number(fd.get("amount")),
      category:    fd.get("category") as string,
      client_name: (fd.get("client_name") as string) || undefined,
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
            <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add Transaction</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editTx ? "Edit" : "Add"} Transaction</DialogTitle></DialogHeader>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Type</Label>
                  <select name="type" defaultValue={editTx?.type ?? "income"} className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
                <div><Label>Amount</Label><Input name="amount" type="number" step="0.01" min="0" defaultValue={editTx ? Number(editTx.amount) : undefined} required className="mt-1" /></div>
                <div><Label>Date</Label><Input name="date" type="date" defaultValue={editTx?.date ?? new Date().toISOString().slice(0, 10)} required className="mt-1" /></div>
                <div>
                  <Label>Category</Label>
                  <Input name="category" list="cat-list" defaultValue={editTx?.category} required className="mt-1" placeholder="e.g. Tools" />
                  <datalist id="cat-list">{allCats.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
              </div>
              <div><Label>Client (optional)</Label><Input name="client_name" defaultValue={editTx?.clientName ?? undefined} className="mt-1" /></div>
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

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Income"   value={fmt(income)}   icon={TrendingUp}   changeType="positive" change="All time" />
        <StatCard title="Total Expenses" value={fmt(expenses)} icon={TrendingDown} changeType="negative" change="All time" />
        <StatCard title="Net Profit"     value={fmt(profit)}   icon={DollarSign}   changeType="positive" change={`${margin}% margin`} />
        <StatCard title="Salaries Paid"  value={fmt(totalSalary)} icon={Users} changeType="negative" change="All time" />
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
                <SelectItem value="all">All Categories</SelectItem>
                {allCats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Date", "Type", "Amount", "Category", "Client", "Notes", ""].map((h) => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No transactions match filters.</td></tr>
                    ) : transactions.map((t) => (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground tabular-nums text-xs">{t.date}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn("text-[10px]",
                            t.type === "income" ? "border-green-300 bg-green-50 text-green-700" : "border-red-300 bg-red-50 text-red-700",
                          )}>{t.type}</Badge>
                        </td>
                        <td className={cn("px-4 py-3 font-medium tabular-nums",
                          t.type === "income" ? "text-green-600" : "text-red-600",
                        )}>
                          {t.type === "expense" ? "−" : "+"}{fmt(Number(t.amount))}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{t.category}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{t.clientName ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[160px] truncate" title={t.notes ?? ""}>{t.notes ?? "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <button onClick={() => { setEditTx(t); setIsOpen(true); }} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
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
    </div>
  );
}
