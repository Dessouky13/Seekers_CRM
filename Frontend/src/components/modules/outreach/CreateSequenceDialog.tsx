// Sequence creation: name + niche + a starter cadence, in one step.
//
// Replaces a dialog that collected only name/description/category and dropped
// the user into an empty editor, where building a working 3-touch sequence
// meant three more dialogs and knowing that `day_offset` counts from enrolment.
// Picking a template here creates the steps in the same request.
import { useState } from "react";
import { Plus, Check, AlertTriangle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useCreateSequence } from "@/hooks/useOutreach";
import { useLeadCategories } from "@/hooks/useCRM";
import { SEQUENCE_TEMPLATES, type SequenceTemplate } from "./sequence-templates";
import { cn } from "@/lib/utils";

export function CreateSequenceDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const createSeq = useCreateSequence();
  const { data: categories = [] } = useLeadCategories();
  const [open, setOpen]         = useState(false);
  const [templateId, setTemplate] = useState<string>("three-touch");
  const [name, setName]         = useState("");
  const [category, setCategory] = useState("");
  const [description, setDesc]  = useState("");

  const template = SEQUENCE_TEMPLATES.find((t) => t.id === templateId) ?? SEQUENCE_TEMPLATES[0];

  const reset = () => {
    setTemplate("three-touch"); setName(""); setCategory(""); setDesc("");
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("Give the sequence a name"); return; }

    createSeq.mutate(
      {
        name:        name.trim(),
        description: description.trim() || undefined,
        category:    category.trim()    || undefined,
        // Always created switched off. A sequence that goes live the instant it
        // is created would start sending template copy the author has not read,
        // which is exactly how generic drafts reach real prospects.
        is_active:   false,
        steps:       template.steps,
      },
      {
        onSuccess: (created) => {
          setOpen(false); reset();
          toast.success(
            template.steps.length
              ? `Created with ${template.steps.length} step${template.steps.length === 1 ? "" : "s"} — review the copy, then switch it on`
              : "Sequence created — add your first step",
          );
          onCreated(created.id);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New Sequence</Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-2xl"
        description="Name the sequence, pick who it targets, and choose a starter cadence."
      >
        <DialogHeader><DialogTitle>New sequence</DialogTitle></DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="seq-name">Name</Label>
              <Input
                id="seq-name" value={name} onChange={(e) => setName(e.target.value)}
                required autoFocus className="mt-1"
                placeholder="Cairo dentists — cold open"
              />
            </div>
            <div>
              <Label htmlFor="seq-cat">Niche <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="seq-cat" value={category} onChange={(e) => setCategory(e.target.value)}
                className="mt-1" list="seq-categories"
                placeholder="dentist"
              />
              {/* Existing lead categories, so the value actually matches
                  something and auto-enroll has a chance of firing. */}
              <datalist id="seq-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          <div>
            <Label htmlFor="seq-desc">What it's for <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              id="seq-desc" value={description} onChange={(e) => setDesc(e.target.value)}
              rows={2} className="mt-1"
              placeholder="Who this targets and what we're offering them"
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-foreground">Starter cadence</legend>
            <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
              Creates the steps for you with draft copy. Edit everything afterwards.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SEQUENCE_TEMPLATES.map((t) => (
                <TemplateCard
                  key={t.id} template={t}
                  selected={t.id === templateId}
                  onSelect={() => setTemplate(t.id)}
                />
              ))}
            </div>
          </fieldset>

          {template.caveat && (
            <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <p className="text-[11px] text-foreground/85">{template.caveat}</p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createSeq.isPending}>
              {createSeq.isPending
                ? "Creating…"
                : template.steps.length
                  ? `Create with ${template.steps.length} step${template.steps.length === 1 ? "" : "s"}`
                  : "Create empty"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({ template, selected, onSelect }: {
  template: SequenceTemplate; selected: boolean; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "relative rounded-lg border p-3 text-left transition-colors",
        selected ? "border-primary/60 bg-primary/5" : "border-border hover:border-border/80 hover:bg-muted/30",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{template.name}</span>
        {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
      </div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{template.summary}</p>
      <div className="mt-2 flex items-center gap-1.5">
        <Mail className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {template.cadence}
        </span>
        {template.recommended && (
          <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
            Recommended
          </span>
        )}
      </div>
    </button>
  );
}
