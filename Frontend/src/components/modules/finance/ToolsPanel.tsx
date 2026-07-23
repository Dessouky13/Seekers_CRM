import { useState } from "react";
import { Wrench, Plus, Pencil, Trash2, TrendingUp, TrendingDown, Minus, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  useTools, useToolSpend, useCreateTool, useUpdateTool, useDeleteTool, type Tool,
} from "@/hooks/useFinance";
import { cn } from "@/lib/utils";

const fmt = (n: number) =>
  `EGP ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;

const KIND_COLORS: Record<string, string> = {
  AI:         "border-violet-500/30 text-violet-400 bg-violet-500/10",
  Infra:      "border-sky-500/30 text-sky-400 bg-sky-500/10",
  Automation: "border-amber-500/30 text-amber-400 bg-amber-500/10",
  Content:    "border-pink-500/30 text-pink-400 bg-pink-500/10",
  Messaging:  "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
};

export function ToolsPanel() {
  const { data: tools = [], isLoading } = useTools();
  const { data: spend } = useToolSpend({ months: 6 });
  const deleteTool = useDeleteTool();

  const [editing, setEditing] = useState<Tool | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleDelete = (t: Tool) => {
    if (!confirm(`Delete "${t.name}"?\n\nIts ${t.tx_count} transaction(s) stay intact — they just lose the tool link.`)) return;
    deleteTool.mutate(t.id, {
      onSuccess: () => toast.success(`${t.name} deleted`),
      onError:   (e) => toast.error(e.message),
    });
  };

  if (isLoading) return <p className="text-sm text-muted-foreground text-center py-16">Loading tools…</p>;

  const totalSpend = tools.reduce((s, t) => s + t.total_spend, 0);
  const activeCount = tools.filter((t) => t.active).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Wrench className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              {tools.length} tools · {activeCount} active
            </p>
            <p className="text-[11px] text-muted-foreground">
              {fmt(totalSpend)} total spend — no more typing names into notes
            </p>
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add Tool</Button>
          </DialogTrigger>
          <ToolDialog tool={editing} onDone={() => { setDialogOpen(false); setEditing(null); }} />
        </Dialog>
      </div>

      {/* Spend trend table */}
      {spend && spend.tools.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Spend per Tool</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Last {spend.periods.length} periods · {fmt(spend.total)} total
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tool</th>
                  {spend.periods.map((p) => (
                    <th key={p.key} className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {p.label.split(" ")[0]}
                    </th>
                  ))}
                  <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Trend</th>
                </tr>
              </thead>
              <tbody>
                {spend.tools.map((t) => (
                  <tr key={t.tool_id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="text-foreground font-medium">{t.name}</span>
                      {t.kind && (
                        <Badge variant="outline" className={cn("ml-2 text-[9px]", KIND_COLORS[t.kind] ?? "")}>
                          {t.kind}
                        </Badge>
                      )}
                    </td>
                    {spend.periods.map((p) => {
                      const v = t.by_period[p.key] ?? 0;
                      return (
                        <td key={p.key} className={cn("px-3 py-2.5 text-right tabular-nums text-xs", v === 0 && "text-muted-foreground/40")}>
                          {v === 0 ? "—" : fmt(v).replace("EGP ", "")}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmt(t.total)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <TrendChip pct={t.change_pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tool directory */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">All Tools</p>
        </div>
        {tools.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12 italic">
            No tools yet. Add one, then pick it when logging a Tools expense.
          </p>
        ) : (
          <div className="divide-y divide-border/50">
            {tools.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("text-sm font-medium", t.active ? "text-foreground" : "text-muted-foreground line-through")}>
                      {t.name}
                    </span>
                    {t.kind && (
                      <Badge variant="outline" className={cn("text-[9px]", KIND_COLORS[t.kind] ?? "")}>{t.kind}</Badge>
                    )}
                    {!t.active && <Badge variant="outline" className="text-[9px]">INACTIVE</Badge>}
                    {t.url && (
                      <a href={t.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t.vendor ? `${t.vendor} · ` : ""}
                    {t.tx_count} charge{t.tx_count === 1 ? "" : "s"}
                    {t.last_charged ? ` · last ${t.last_charged}` : ""}
                  </p>
                </div>
                <span className="tabular-nums text-sm font-semibold text-foreground shrink-0">{fmt(t.total_spend)}</span>
                <div className="flex gap-1 shrink-0">
                  <Button
                    size="sm" variant="ghost" className="h-7 w-7 p-0"
                    onClick={() => { setEditing(t); setDialogOpen(true); }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive"
                    onClick={() => handleDelete(t)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TrendChip({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[11px] text-muted-foreground">—</span>;
  const Icon = pct === 0 ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  // Rising tool cost is bad.
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums",
      pct === 0 ? "text-muted-foreground" : pct > 0 ? "text-destructive" : "text-success",
    )}>
      <Icon className="h-3 w-3" />{pct > 0 ? "+" : ""}{pct}%
    </span>
  );
}

function ToolDialog({ tool, onDone }: { tool: Tool | null; onDone: () => void }) {
  const createTool = useCreateTool();
  const updateTool = useUpdateTool();
  const saving = createTool.isPending || updateTool.isPending;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const budgetRaw = (fd.get("monthly_budget") as string)?.trim();
    const body = {
      name:           (fd.get("name") as string).trim(),
      vendor:         (fd.get("vendor") as string)?.trim() || null,
      url:            (fd.get("url") as string)?.trim() || null,
      kind:           (fd.get("kind") as string)?.trim() || null,
      monthly_budget: budgetRaw ? Number(budgetRaw) : null,
      active:         fd.get("active") === "on",
    };
    const onSuccess = () => { toast.success(tool ? "Tool updated" : "Tool added"); onDone(); };
    const onError   = (err: Error) => toast.error(err.message);
    if (tool) updateTool.mutate({ id: tool.id, ...body }, { onSuccess, onError });
    else      createTool.mutate(body, { onSuccess, onError });
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{tool ? "Edit" : "Add"} Tool</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Name</Label>
            <Input name="name" defaultValue={tool?.name} required className="mt-1" placeholder="e.g. Voiceflow" />
          </div>
          <div>
            <Label>Vendor</Label>
            <Input name="vendor" defaultValue={tool?.vendor ?? ""} className="mt-1" placeholder="e.g. Anthropic" />
          </div>
          <div>
            <Label>Kind</Label>
            <Input name="kind" list="tool-kinds" defaultValue={tool?.kind ?? ""} className="mt-1" placeholder="AI / Infra / …" />
            <datalist id="tool-kinds">
              {["AI", "Infra", "Automation", "Content", "Messaging"].map((k) => <option key={k} value={k} />)}
            </datalist>
          </div>
          <div>
            <Label>Monthly budget</Label>
            <Input
              name="monthly_budget" type="number" step="0.01" min="0"
              defaultValue={tool?.monthlyBudget ?? ""} className="mt-1" placeholder="optional"
            />
          </div>
        </div>
        <div>
          <Label>URL</Label>
          <Input name="url" defaultValue={tool?.url ?? ""} className="mt-1" placeholder="https://…" />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input type="checkbox" name="active" defaultChecked={tool?.active ?? true} className="h-3.5 w-3.5 accent-primary" />
          Active subscription
        </label>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : tool ? "Update" : "Add"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
