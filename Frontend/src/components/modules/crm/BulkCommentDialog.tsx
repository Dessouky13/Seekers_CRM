// Bulk comment: the same note against every selected lead.
//
// Written as one activity PER LEAD, not as a single shared record. The activity
// timeline is where anyone reviewing a lead months later looks, and a lead whose
// history pointed at a batch kept somewhere else would be unreadable — so each
// lead gets its own row, with its own author and date.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { cairoToday } from "@/lib/dates";
import { BulkPendingNote } from "./BulkPendingNote";

/**
 * The activity types `lead_activities.type` accepts. `note` is the default
 * because a comment applied to many leads at once is almost always an
 * observation ("all from the Cairo gyms list") rather than a claim that fifty
 * phone calls happened — and typing it as `call` would inflate the outreach
 * volume /crm/insights reports.
 */
const TYPES = ["note", "call", "email", "meeting", "form"] as const;

export function BulkCommentDialog({
  open, onOpenChange, selectedCount, isPending, onSubmit,
}: {
  open:          boolean;
  onOpenChange:  (open: boolean) => void;
  selectedCount: number;
  isPending:     boolean;
  onSubmit:      (body: { description: string; type: string; date: string }) => void;
}) {
  const [description, setDescription] = useState("");
  const trimmed = description.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) setDescription(""); }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Comment on {selectedCount} lead{selectedCount === 1 ? "" : "s"}
          </DialogTitle>
          <p className="pt-1 text-sm text-muted-foreground">
            Added to each lead’s own activity timeline, so every history stays
            complete on its own.
          </p>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            onSubmit({
              description: trimmed,
              type: fd.get("type") as string,
              // cairoToday(), never toISOString().slice(0,10): before 02:00
              // Cairo the UTC day is yesterday, and a comment logged at 00:30
              // would be filed against the previous day.
              date: (fd.get("date") as string) || cairoToday(),
            });
          }}
        >
          <div>
            <Label htmlFor="bulk-comment-text">Comment</Label>
            <Textarea
              id="bulk-comment-text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              required
              maxLength={1000}
              placeholder="e.g. Batch imported from the Cairo clinics list — verify numbers before calling"
              className="mt-1"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {trimmed.length} / 1000
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="bulk-comment-type">Type</Label>
              <select
                id="bulk-comment-type"
                name="type"
                defaultValue="note"
                className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="bulk-comment-date">Date</Label>
              <Input
                id="bulk-comment-date"
                name="date"
                type="date"
                defaultValue={cairoToday()}
                className="mt-1 min-h-11"
              />
            </div>
          </div>

          {isPending && <BulkPendingNote count={selectedCount} verb="Adding" />}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" type="button" disabled={isPending}>Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={trimmed.length === 0 || isPending} className="gap-1.5">
              {isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…</>
                : `Add to ${selectedCount} lead${selectedCount === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
