// Bulk edit: apply one set of field changes to every selected lead.
//
// Only fields that exist on `leads` and that are meaningful to set to a single
// shared value are offered. Notably NOT offered, because the columns do not
// exist rather than because they were skipped:
//
//   • Priority — `leads` has no priority column (tasks do; leads do not).
//   • Tags     — `leads` has no user-editable tag column. `complaint_tags` is
//                written by the n8n enrichment ingest and describes what
//                customers complain about, not a label a salesperson applies.
//
// Per-lead fields (name, phone, deal value, notes) are excluded on purpose:
// writing one phone number across a hundred leads is only ever a mistake.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { LEAD_STAGES, LEAD_SOURCES, LEAD_CATEGORIES } from "./constants";
import { BulkPendingNote } from "./BulkPendingNote";
import type { BulkLeadPatch } from "@/hooks/useCRM";

/**
 * Sentinels for the three-way selects.
 *
 * Every field has three states: leave alone, set to a value, and clear. A plain
 * "" cannot express both "leave alone" and "clear" at once, and conflating them
 * is how a dialog silently wipes the category of every lead somebody only meant
 * to restage.
 */
const KEEP  = "__keep__";
const CLEAR = "__clear__";

export function BulkEditDialog({
  open, onOpenChange, selectedCount, users, categories, canReassign, isPending, onApply,
}: {
  open:          boolean;
  onOpenChange:  (open: boolean) => void;
  selectedCount: number;
  users:         { id: string; name: string }[];
  /** Categories already in use, so the list matches the filter bar. */
  categories:    string[];
  /** Members cannot reassign leads — the server refuses it with a 403. */
  canReassign:   boolean;
  isPending:     boolean;
  onApply:       (patch: BulkLeadPatch) => void;
}) {
  const [stage,    setStage]    = useState(KEEP);
  const [assignee, setAssignee] = useState(KEEP);
  const [category, setCategory] = useState(KEEP);
  const [source,   setSource]   = useState(KEEP);

  // The union of the canonical list and whatever is actually in the database, so
  // a category that arrived via CSV import is still selectable here.
  const categoryOptions = Array.from(new Set([...LEAD_CATEGORIES, ...categories])).sort();

  const buildPatch = (): BulkLeadPatch => {
    const patch: BulkLeadPatch = {};
    if (stage    !== KEEP) patch.stage       = stage;
    if (assignee !== KEEP) patch.assignee_id = assignee === CLEAR ? null : assignee;
    if (category !== KEEP) patch.category    = category === CLEAR ? null : category;
    if (source   !== KEEP) patch.source      = source   === CLEAR ? null : source;
    return patch;
  };

  const changeCount = Object.keys(buildPatch()).length;

  const reset = () => {
    setStage(KEEP); setAssignee(KEEP); setCategory(KEEP); setSource(KEEP);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Edit {selectedCount} lead{selectedCount === 1 ? "" : "s"}
          </DialogTitle>
          <p className="pt-1 text-sm text-muted-foreground">
            Every field left on “Leave unchanged” is not touched.
          </p>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); onApply(buildPatch()); }}
        >
          <Field id="bulk-stage" label="Stage" value={stage} onChange={setStage}>
            {LEAD_STAGES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </Field>

          {canReassign && (
            <Field
              id="bulk-assignee" label="Assigned to" value={assignee} onChange={setAssignee}
              clearLabel="Unassign"
            >
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Field>
          )}

          <Field
            id="bulk-category" label="Category / Niche" value={category} onChange={setCategory}
            clearLabel="Clear category"
          >
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </Field>

          <Field
            id="bulk-source" label="Source" value={source} onChange={setSource}
            clearLabel="Clear source"
          >
            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Field>

          {isPending && <BulkPendingNote count={selectedCount} verb="Applying" />}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button" disabled={isPending}>Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={changeCount === 0 || isPending} className="gap-1.5">
              {isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying…</>
                : changeCount === 0
                  ? "Choose a field to change"
                  : `Apply ${changeCount} change${changeCount === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One three-way select: leave unchanged / a value / clear.
 *
 * `clearLabel` is omitted for stage because `leads.stage` is NOT NULL with a
 * seven-value enum — there is no "no stage" to set, so offering to clear it
 * would be offering something the database refuses.
 */
function Field({
  id, label, value, onChange, clearLabel, children,
}: {
  id:          string;
  label:       string;
  value:       string;
  onChange:    (value: string) => void;
  clearLabel?: string;
  children:    React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value={KEEP}>Leave unchanged</option>
        {clearLabel && <option value={CLEAR}>{clearLabel}</option>}
        {children}
      </select>
    </div>
  );
}
