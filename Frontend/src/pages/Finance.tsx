import { useState } from "react";
import { DollarSign, TrendingUp, TrendingDown, Plus, Pencil, Trash2 } from "lucide-react";
import { StatCard } from "@/components/modules/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  useTransactions, useFinanceSummary, useCategories,
  useCreateTransaction, useUpdateTransaction, useDeleteTransaction,
} from "@/hooks/useFinance";
import { cn } from "@/lib/utils";
import type { ApiTransaction } from "@/lib/types";

const fmt = (n: number) => `$${n.toLocaleString()}`;

export default function Finance() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [catFilter,  setCatFilter]  = useState("all");
  const [fromDate,   setFromDate]   = useState("");
  const [toDate,     setToDate]     = useState("");
  const [editTx, setEditTx]         = useState<ApiTransaction | null>(null);
  const [isOpen, setIsOpen]         = useState(false);

  const { data: txRes, isLoading } = useTransactions({
    type:     typeFilter,
    category: catFilter,
    from:     fromDate || undefined,
    to:       toDate   || undefined,
    limit:    200,
  });
  const { data: summary } = useFinanceSummary({ from: fromDate || undefined, to: toDate || undefined });
  const { data: categories = [] }  = useCategories();

  const createTx = useCreateTransaction();
  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();

  const transactions = txRes?.data ?? [];

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
      updateTx.mutate(
        { id: editTx.id, ...body },
        {
          onSuccess: () => { setIsOpen(false); setEditTx(null); toast.success("Transaction updated"); },
          onError:   (err) => toast.error(err.message),
        },
      );
    } else {
      createTx.mutate(body, {
        onSuccess: () => { setIsOpen(false); toast.success("Transaction added"); },
        onError:   (err) => toast.error(err.message),
      });
    }
  };

  const handleDelete = (id: string) => {
    deleteTx.mutate(id, {
      onSuccess: () => toast.success("Transaction deleted"),
      onError:   (err) => toast.error(err.message),
    });
  };

  const income   = summary?.total_income   ?? 0;
  const expenses = summary?.total_expenses ?? 0;
  const profit   = summary?.net_profit     ?? 0;
  const margin   = summary?.profit_margin  ?? 0;

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
                <div><Label>Amount</Label><Input name="amount" type="number" step="0.01" defaultValue={editTx ? Number(editTx.amount) : undefined} required className="mt-1" /></div>
                <div><Label>Date</Label><Input name="date" type="date" defaultValue={editTx?.date ?? new Date().toISOString().slice(0, 10)} required className="mt-1" /></div>
                <div>
                  <Label>Category</Label>
                  <Input name="category" list="category-list" defaultValue={editTx?.category} required className="mt-1" placeholder="e.g. Services" />
                  <datalist id="category-list">
                    {categories.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>
              <div><Label>Client (optional)</Label><Input name="client_name" defaultValue={editTx?.clientName ?? undefined} className="mt-1" /></div>
              <div><Label>Notes</Label><Textarea name="notes" defaultValue={editTx?.notes ?? undefined} rows={2} className="mt-1" /></div>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <Button type="submit" disabled={createTx.isPending || updateTx.isPending}>
                  {(createTx.isPending || updateTx.isPending) ? "Saving…" : editTx ? "Update" : "Add"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Income"   value={fmt(income)}   icon={TrendingUp}   changeType="positive" change="All time" />
        <StatCard title="Total Expenses" value={fmt(expenses)} icon={TrendingDown} changeType="negative" change="All time" />
        <StatCard title="Net Profit"     value={fmt(profit)}   icon={DollarSign}   changeType="positive" change={`${margin}% margin`} />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="income">Income</SelectItem>
            <SelectItem value="expense">Expense</SelectItem>
          </SelectContent>
        </Select>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-44 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
          className="h-8 text-sm w-36" title="From date" />
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
          className="h-8 text-sm w-36" title="To date" />
        {(fromDate || toDate) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs"
            onClick={() => { setFromDate(""); setToDate(""); }}>
            Clear dates
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading transactions…</div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden animate-fade-in">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Date", "Type", "Amount", "Category", "Client", "Status", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No transactions yet. Add your first one above.</td></tr>
                ) : transactions.map((t) => (
                  <tr key={t.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{t.date}</td>
                    <td className="px-4 py-3">
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full",
                        t.type === "income" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
                      )}>{t.type}</span>
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums">
                      {t.type === "expense" ? "-" : ""}{fmt(Number(t.amount))}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.category}</td>
                    <td className="px-4 py-3 text-muted-foreground">{t.clientName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full",
                        t.status === "completed" ? "bg-success/10 text-success"
                          : t.status === "pending" ? "bg-warning/10 text-warning"
                          : "bg-muted text-muted-foreground",
                      )}>{t.status}</span>
                    </td>
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
        </div>
      )}
    </div>
  );
}
