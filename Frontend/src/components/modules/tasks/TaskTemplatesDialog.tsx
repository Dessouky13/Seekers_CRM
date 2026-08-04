// Task templates — pick one and apply it, or write a new one.
//
// One dialog with two modes rather than two dialogs: the moment you discover
// you have no template for the thing you are about to do by hand is the moment
// you want to write one, and making that a second trip through a different
// button is how the feature goes unused.
import { useState } from "react";
import { Layers, Plus, Trash2, CalendarDays, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cairoToday, addCalendarDays } from "@/lib/dates";
import { useCurrentUser } from "@/hooks/useAuth";
import {
  useTaskTemplates, useCreateTaskTemplate, useApplyTaskTemplate, useDeleteTaskTemplate,
  type TaskTemplate,
} from "@/hooks/useTaskTemplates";

type Draft = { title: string; priority: string; day_offset: string };

const EMPTY_ROW: Draft = { title: "", priority: "medium", day_offset: "0" };

/** A saved template, with what applying it would produce. */
function TemplateRow({ tpl, startDate, onApplied }: {
  tpl: TaskTemplate;
  startDate: string;
  onApplied: () => void;
}) {
  const apply    = useApplyTaskTemplate();
  const remove   = useDeleteTaskTemplate();
  const user     = useCurrentUser();
  const isAdmin  = user?.role === "admin";
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-medium text-foreground">{tpl.name}</span>
          <span className="block text-xs text-muted-foreground">
            {tpl.item_count} task{tpl.item_count === 1 ? "" : "s"}
            {tpl.span_days > 0 && ` · over ${tpl.span_days} days`}
            {tpl.description && ` · ${tpl.description}`}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {isAdmin && (
            <Button
              variant="ghost" size="icon"
              className="h-7 min-h-11 min-w-11 text-muted-foreground hover:text-destructive"
              aria-label={`Delete ${tpl.name}`} title="Delete template"
              disabled={remove.isPending}
              onClick={() => remove.mutate(tpl.id, {
                onSuccess: () => toast.success("Template deleted"),
                onError:   (e) => toast.error(e.message),
              })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            className="min-h-11"
            disabled={apply.isPending}
            onClick={() => apply.mutate(
              { id: tpl.id, start_date: startDate },
              {
                onSuccess: (r) => { toast.success(`${r.created} tasks added from ${r.template_name}`); onApplied(); },
                onError:   (e) => toast.error(e.message),
              },
            )}
          >
            {apply.isPending ? "Adding…" : "Apply"}
          </Button>
        </div>
      </div>

      {/* Preview the real dates, not the offsets — "+14d" is not something
          anyone can sanity-check, "13 Sep" is. */}
      {open && (
        <ul className="mt-3 space-y-1 border-t border-border/50 pt-2">
          {tpl.items.map((i) => (
            <li key={i.id} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-foreground/85">{i.title}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {addCalendarDays(startDate, i.dayOffset)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TaskTemplatesDialog() {
  const [open, setOpen]           = useState(false);
  const [creating, setCreating]   = useState(false);
  const [startDate, setStartDate] = useState(cairoToday());
  const [name, setName]           = useState("");
  const [rows, setRows]           = useState<Draft[]>([{ ...EMPTY_ROW }]);

  // Only fetch once the dialog is actually opened — this sits in the Tasks
  // header and most visits never touch it.
  const { data: templates = [], isLoading } = useTaskTemplates(open);
  const create = useCreateTaskTemplate();

  const reset = () => { setCreating(false); setName(""); setRows([{ ...EMPTY_ROW }]); };

  const setRow = (idx: number, patch: Partial<Draft>) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const items = rows
      .filter((r) => r.title.trim())
      .map((r) => ({
        title:      r.title.trim(),
        priority:   r.priority as "low" | "medium" | "high" | "critical",
        day_offset: Number(r.day_offset) || 0,
      }));
    if (items.length === 0) { toast.error("Add at least one task"); return; }

    create.mutate({ name: name.trim(), items }, {
      onSuccess: () => { toast.success("Template saved"); reset(); },
      onError:   (err) => toast.error(err.message),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5">
          <Layers className="h-3.5 w-3.5" /> Templates
        </Button>
      </DialogTrigger>

      {/* DialogContent already caps at 90dvh and scrolls, so no height override
          here — see components/ui/dialog.tsx. */}
      <DialogContent
        className="max-w-lg"
        description="Save a repeatable checklist and apply it as dated tasks."
      >
        <DialogHeader>
          <DialogTitle>{creating ? "New template" : "Task templates"}</DialogTitle>
        </DialogHeader>

        {!creating ? (
          <div className="space-y-3">
            {/* The start date drives every due date, so it is chosen once,
                above the list, and previewed inside each template. */}
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Label htmlFor="tpl-start" className="shrink-0 text-xs text-muted-foreground">Start</Label>
              <Input
                id="tpl-start" type="date" value={startDate}
                onChange={(e) => setStartDate(e.target.value || cairoToday())}
                className="h-11"
              />
            </div>

            {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}

            {!isLoading && templates.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <p className="text-sm text-foreground">No templates yet.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Save the checklist you retype every time — onboarding a client, launching a campaign.
                </p>
              </div>
            )}

            {templates.map((t) => (
              <TemplateRow key={t.id} tpl={t} startDate={startDate} onApplied={() => setOpen(false)} />
            ))}

            <Button variant="outline" className="w-full gap-1.5" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New template
            </Button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div>
              <Label htmlFor="tpl-name">Template name</Label>
              <Input
                id="tpl-name" value={name} onChange={(e) => setName(e.target.value)}
                required autoFocus className="mt-1" placeholder="Client onboarding"
              />
            </div>

            <div className="space-y-2">
              <Label>Tasks</Label>
              {rows.map((row, idx) => (
                // Stacks on a phone, one line on a desktop — a fixed 3-column
                // grid would squeeze the title field to nothing at 375px.
                <div key={idx} className="flex flex-col gap-2 rounded-md border border-border p-2 sm:flex-row sm:items-center">
                  <Input
                    value={row.title}
                    onChange={(e) => setRow(idx, { title: e.target.value })}
                    placeholder={idx === 0 ? "Kickoff call" : "Next step"}
                    className="flex-1"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={row.priority}
                      onChange={(e) => setRow(idx, { priority: e.target.value })}
                      aria-label="Priority"
                      className="h-11 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {["low", "medium", "high", "critical"].map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number" inputMode="numeric" value={row.day_offset}
                        onChange={(e) => setRow(idx, { day_offset: e.target.value })}
                        aria-label="Days after start"
                        className="w-16 text-center"
                      />
                      <span className="text-xs text-muted-foreground">d</span>
                    </div>
                    {rows.length > 1 && (
                      <Button
                        type="button" variant="ghost" size="icon"
                        className="h-9 min-h-11 min-w-11 text-muted-foreground"
                        aria-label="Remove this task"
                        onClick={() => setRows((r) => r.filter((_, i) => i !== idx))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <Button
                type="button" variant="ghost" size="sm" className="min-h-11 gap-1.5"
                onClick={() => setRows((r) => [...r, { ...EMPTY_ROW }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add task
              </Button>
              <p className="text-[11px] text-muted-foreground">
                “d” is days after the start date you pick when applying. 0 means due that day.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={reset}>Back</Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Saving…" : "Save template"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
