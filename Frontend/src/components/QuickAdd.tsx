// Floating quick-capture — add a lead, task or expense from anywhere.
//
// Creating anything previously meant navigating to the right page first, then
// finding its "New" button in the header. On a phone that is three taps and a
// page load before you can type, which is enough friction that things get
// written down elsewhere and never make it in.
//
// The button sits above the tab bar in the thumb arc. Phone only: on desktop
// the per-page buttons are already one click away and the command palette
// (Ctrl+K) covers the keyboard path.
import { useState } from "react";
import { Plus, Users, CheckSquare, Receipt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { useCreateLead } from "@/hooks/useCRM";
import { useCreateTask } from "@/hooks/useTasks";
import { useCreateTransaction } from "@/hooks/useFinance";
import { useCurrentUser } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type Kind = "lead" | "task" | "expense";

export function QuickAdd() {
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);

  const createLead = useCreateLead();
  const createTask = useCreateTask();
  const createTx   = useCreateTransaction();

  if (!user) return null;
  const isAdmin = user.role === "admin";

  // Expenses live behind the admin-only finance module, so a member seeing the
  // option would just get a 403.
  const kinds: { key: Kind; label: string; icon: typeof Users; hint: string }[] = [
    { key: "lead",    label: "Lead",    icon: Users,      hint: "Name and company" },
    { key: "task",    label: "Task",    icon: CheckSquare, hint: "Something to do" },
    ...(isAdmin
      ? [{ key: "expense" as const, label: "Expense", icon: Receipt, hint: "Money out" }]
      : []),
  ];

  const close = () => { setOpen(false); setKind(null); };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const done = (what: string) => { close(); toast.success(`${what} added`); };
    const fail = (err: Error) => toast.error(err.message);

    if (kind === "lead") {
      const name = (fd.get("name") as string).trim();
      createLead.mutate(
        { name, company: (fd.get("company") as string).trim() || name,
          phone: (fd.get("phone") as string) || undefined },
        { onSuccess: () => done("Lead"), onError: fail },
      );
    } else if (kind === "task") {
      createTask.mutate(
        { title: (fd.get("title") as string).trim(),
          due_date: (fd.get("due_date") as string) || undefined,
          assignee_id: user.id },
        { onSuccess: () => done("Task"), onError: fail },
      );
    } else if (kind === "expense") {
      createTx.mutate(
        { type: "expense",
          amount: Number(fd.get("amount")),
          date: (fd.get("date") as string) || new Date().toISOString().slice(0, 10),
          category: (fd.get("category") as string) || "Other",
          notes: (fd.get("notes") as string) || undefined },
        { onSuccess: () => done("Expense"), onError: fail },
      );
    }
  };

  const pending = createLead.isPending || createTask.isPending || createTx.isPending;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick add"
        className={cn(
          "fixed right-4 z-40 grid h-14 w-14 place-items-center rounded-full md:hidden",
          "bg-primary text-primary-foreground shadow-lg shadow-primary/25",
          "transition-transform active:scale-95",
          // Clears the 56px tab bar and the home indicator.
          "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]",
        )}
      >
        <Plus className="h-6 w-6" />
      </button>

      <Sheet open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="text-left">
            <SheetTitle>{kind ? `New ${kind}` : "Quick add"}</SheetTitle>
          </SheetHeader>

          {!kind ? (
            <div className="mt-4 grid gap-2">
              {kinds.map((k) => {
                const Icon = k.icon;
                return (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => setKind(k.key)}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors active:bg-muted/50"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{k.label}</span>
                      <span className="block text-xs text-muted-foreground">{k.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-4">
              {kind === "lead" && (
                <>
                  <div>
                    <Label htmlFor="qa-name">Name</Label>
                    {/* autoFocus so the keyboard is already up — the whole point
                        of quick capture is that typing starts immediately. */}
                    <Input id="qa-name" name="name" required autoFocus className="mt-1" placeholder="Contact name" />
                  </div>
                  <div>
                    <Label htmlFor="qa-company">Company <span className="text-muted-foreground">(optional)</span></Label>
                    <Input id="qa-company" name="company" className="mt-1" placeholder="Defaults to the name" />
                  </div>
                  <div>
                    <Label htmlFor="qa-phone">Phone <span className="text-muted-foreground">(optional)</span></Label>
                    <Input id="qa-phone" name="phone" type="tel" inputMode="tel" className="mt-1" />
                  </div>
                </>
              )}

              {kind === "task" && (
                <>
                  <div>
                    <Label htmlFor="qa-title">What needs doing</Label>
                    <Input id="qa-title" name="title" required autoFocus className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="qa-due">Due <span className="text-muted-foreground">(optional)</span></Label>
                    <Input id="qa-due" name="due_date" type="date" className="mt-1" />
                  </div>
                  <p className="text-[11px] text-muted-foreground">Assigned to you.</p>
                </>
              )}

              {kind === "expense" && (
                <>
                  <div>
                    <Label htmlFor="qa-amount">Amount (EGP)</Label>
                    {/* decimal keypad rather than the full keyboard */}
                    <Input id="qa-amount" name="amount" type="number" inputMode="decimal" step="0.01" min="0" required autoFocus className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="qa-category">Category</Label>
                    <Input id="qa-category" name="category" className="mt-1" defaultValue="Other" list="qa-categories" />
                    <datalist id="qa-categories">
                      {["Software", "Hosting", "Salaries", "Ads", "Tools", "Other"].map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <Label htmlFor="qa-date">Date</Label>
                    <Input id="qa-date" name="date" type="date" className="mt-1" defaultValue={new Date().toISOString().slice(0, 10)} />
                  </div>
                  <div>
                    <Label htmlFor="qa-notes">Note <span className="text-muted-foreground">(optional)</span></Label>
                    <Input id="qa-notes" name="notes" className="mt-1" />
                  </div>
                </>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" className="flex-1" onClick={() => setKind(null)}>
                  Back
                </Button>
                <Button type="submit" className="flex-1" disabled={pending}>
                  {pending ? "Saving…" : "Add"}
                </Button>
              </div>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
