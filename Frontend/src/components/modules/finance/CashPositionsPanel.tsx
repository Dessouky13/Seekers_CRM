import { Wallet, ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  useCashPositions, useSettleAllForUser, useSettleTransaction, useTransactions,
} from "@/hooks/useFinance";
import { cn } from "@/lib/utils";

const fmt = (n: number) =>
  `EGP ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;

/**
 * Who is holding company money right now.
 *   holding  = client fees they collected but haven't handed over
 *   fronted  = expenses they paid out of their own pocket
 *   net      = holding - fronted   (>0 → they owe the company that much)
 */
export function CashPositionsPanel() {
  const { data, isLoading } = useCashPositions();
  const settleAll = useSettleAllForUser();
  const settleOne = useSettleTransaction();

  // The individual unsettled entries behind the totals.
  const { data: unsettledRes } = useTransactions({ unsettled: true, limit: 200 });
  const unsettled = unsettledRes?.data ?? [];

  if (isLoading) return <p className="text-sm text-muted-foreground text-center py-16">Loading cash positions…</p>;

  const positions = data?.positions ?? [];

  const handleSettleAll = (userId: string, name: string, net: number) => {
    if (!confirm(
      `Settle everything for ${name}?\n\nThis marks all their outstanding entries as handed over / reimbursed (net ${fmt(net)}).`,
    )) return;
    settleAll.mutate(userId, {
      onSuccess: (r) => toast.success(`Settled ${r.settled} entr${r.settled === 1 ? "y" : "ies"} for ${name}`),
      onError:   (e) => toast.error(e.message),
    });
  };

  return (
    <div className="space-y-4">
      {/* Explainer */}
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-5 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <Wallet className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Cash held outside the company account</p>
          <p className="text-[11px] text-muted-foreground">
            When a fee is collected by you or Gomaa personally, tag the transaction with
            <span className="text-foreground"> “Held by”</span> — it shows here until you settle it.
          </p>
        </div>
        {data && data.total_outstanding !== 0 && (
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Outstanding</p>
            <p className="text-lg font-semibold tabular-nums text-warning">{fmt(data.total_outstanding)}</p>
          </div>
        )}
      </div>

      {positions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/10 p-10 text-center">
          <Wallet className="h-7 w-7 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-foreground font-medium">Everything is settled</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            No one is holding company cash. Next time a client pays you or Gomaa directly, set
            <span className="text-foreground"> “Held by”</span> on that transaction and the balance will appear here.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {positions.map((p) => {
            const owesCompany = p.net > 0;
            return (
              <div key={p.user_id ?? p.name} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{p.email ?? "—"}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("text-[9px] shrink-0", owesCompany ? "border-warning/40 text-warning" : "border-info/40 text-info")}
                  >
                    {owesCompany ? "OWES COMPANY" : "COMPANY OWES"}
                  </Badge>
                </div>

                <p className={cn("text-2xl font-semibold tabular-nums mt-3", owesCompany ? "text-warning" : "text-info")}>
                  {fmt(Math.abs(p.net))}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {owesCompany
                    ? `${p.name} should hand this over`
                    : `Reimburse ${p.name} this amount`}
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-muted/30 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Collected</p>
                    <p className="tabular-nums text-success font-medium">{fmt(p.holding)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Paid own pocket</p>
                    <p className="tabular-nums text-destructive font-medium">{fmt(p.fronted)}</p>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full mt-3 gap-1.5 h-8"
                  disabled={settleAll.isPending || !p.user_id}
                  onClick={() => p.user_id && handleSettleAll(p.user_id, p.name, p.net)}
                >
                  {settleAll.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Check className="h-3.5 w-3.5" />}
                  Settle all ({p.items})
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* The individual entries making up the balances */}
      {unsettled.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Outstanding Entries</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Settle individually once the money moves.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Date", "Description", "Held by", "Direction", "Amount", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unsettled.map((t) => {
                  const isIncome = t.type === "income";
                  return (
                    <tr key={t.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{t.date}</td>
                      <td className="px-4 py-2.5 truncate max-w-[220px]">{t.notes || t.category}</td>
                      <td className="px-4 py-2.5 text-xs">{t.held_by_name ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("inline-flex items-center gap-1 text-[11px]", isIncome ? "text-warning" : "text-info")}>
                          {isIncome ? "holds for company" : "company owes"}
                          <ArrowRight className="h-3 w-3" />
                        </span>
                      </td>
                      <td className={cn("px-4 py-2.5 tabular-nums font-medium", isIncome ? "text-success" : "text-destructive")}>
                        {fmt(Number(t.amount))}
                      </td>
                      <td className="px-4 py-2.5">
                        <Button
                          size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                          disabled={settleOne.isPending}
                          onClick={() => settleOne.mutate({ id: t.id, settled: true }, {
                            onSuccess: () => toast.success("Marked as settled"),
                            onError:   (e) => toast.error(e.message),
                          })}
                        >
                          <Check className="h-3 w-3" /> Settle
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
