// Manual contact strikes, on the lead detail sheet: the dot indicator, the
// button that records an attempt, and the history behind the dots.
//
// The history is rendered here as well as in the activity timeline on purpose.
// The timeline shows WHAT happened; this shows who did it and when, per strike,
// which is the question asked when deciding whether a lead is really finished.

import { useState } from "react";
import { Loader2, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cairoToday } from "@/lib/dates";
import { useAddLeadStrike, useDeleteLeadStrike } from "@/hooks/useCRM";
import { StrikeDots } from "./StrikeDots";
import type { ApiLeadDetail, StrikeChannel, StrikeLimitAction } from "@/lib/types";

const CHANNELS: { value: StrikeChannel; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "call",     label: "Call" },
  { value: "email",    label: "Email" },
  { value: "meeting",  label: "Meeting" },
  { value: "other",    label: "Other" },
];

/** What the UI promises will happen, worded the same way the backend behaves. */
function limitWarning(action: StrikeLimitAction): string {
  return action === "archive"
    ? "This is the last strike — the lead will be closed lost and archived out of the list."
    : "This is the last strike — the lead will be moved to Closed Lost.";
}

export function StrikePanel({ lead }: { lead: ApiLeadDetail }) {
  const addStrike    = useAddLeadStrike();
  const deleteStrike = useDeleteLeadStrike();
  const [open, setOpen] = useState(false);

  const count  = lead.strikeCount ?? 0;
  const limit  = lead.strikeLimit ?? 3;
  const action = lead.strikeLimitAction ?? "close_lost";
  // The strike about to be recorded is the one that trips the limit.
  const nextIsLast = count + 1 >= limit;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    addStrike.mutate(
      {
        leadId:  lead.id,
        channel: (fd.get("channel") as StrikeChannel) || undefined,
        note:    (fd.get("note") as string).trim() || null,
        // Never `new Date().toISOString().slice(0, 10)`: between Cairo midnight
        // and 02:00 that is YESTERDAY, and would file an evening WhatsApp
        // against the previous day.
        date:    (fd.get("date") as string) || cairoToday(),
      },
      {
        onSuccess: (res) => {
          setOpen(false);
          if (res.limit_applied === "archive") {
            toast.warning(`Strike ${res.strike_count}/${res.strike_limit} — lead archived`, {
              description: "It is out of the leads list. Filter by Archived to find it.",
            });
          } else if (res.limit_applied === "close_lost") {
            toast.warning(`Strike ${res.strike_count}/${res.strike_limit} — moved to Closed Lost`);
          } else {
            toast.success(`Strike ${res.strike_count}/${res.strike_limit} recorded`);
          }
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contact Strikes
          </p>
          <StrikeDots count={count} limit={limit} size="md" />
          <span className="text-xs tabular-nums text-muted-foreground">
            {count}/{limit}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          // min-h-11 gives a 44px touch target without changing the visual size.
          className="h-8 min-h-11 gap-1.5"
          onClick={() => setOpen(true)}
        >
          <Target className="h-3.5 w-3.5" /> Record contact
        </Button>
      </div>

      {lead.archivedAt && (
        <p className="rounded-md border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-xs text-rose-200">
          Archived after reaching {limit} contact attempts. Nothing was deleted —
          the lead and its history are intact.
        </p>
      )}

      {count === 0 ? (
        <p className="text-xs text-muted-foreground">
          No manual contact attempts recorded yet. Log one each time you reach out
          by hand — after {limit},{" "}
          {action === "archive" ? "the lead is archived" : "the lead is closed lost"}.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {lead.strikes.map((s, i) => {
            // Newest first from the API, so the newest row is the highest number.
            const number = lead.strikes.length - i;
            return (
              <li
                key={s.id}
                className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2"
              >
                <span className="mt-0.5 shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground">
                  #{number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground">
                    {CHANNELS.find((ch) => ch.value === s.channel)?.label ?? "Contact"}
                    {s.note && <span className="text-foreground/70"> — {s.note}</span>}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {s.date} · {s.by_name ?? "unknown"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove strike ${number}`}
                  title="Recorded by mistake? Remove it."
                  disabled={deleteStrike.isPending}
                  onClick={() =>
                    deleteStrike.mutate(
                      { leadId: lead.id, strikeId: s.id },
                      {
                        onSuccess: () => toast.success("Strike removed"),
                        onError:   (err) => toast.error(err.message),
                      },
                    )
                  }
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground
                             transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a contact attempt</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="strike-channel">How did you reach out?</Label>
              <select
                id="strike-channel"
                name="channel"
                defaultValue="whatsapp"
                className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {CHANNELS.map((ch) => (
                  <option key={ch.value} value={ch.value}>{ch.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="strike-note">Note (optional)</Label>
              <Input
                id="strike-note"
                name="note"
                maxLength={500}
                placeholder="e.g. no answer, left a voicemail"
                className="mt-1 min-h-11"
              />
            </div>
            <div>
              <Label htmlFor="strike-date">Date</Label>
              <Input
                id="strike-date"
                name="date"
                type="date"
                defaultValue={cairoToday()}
                className="mt-1 min-h-11"
              />
            </div>

            {nextIsLast && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                {limitWarning(action)}
              </p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={addStrike.isPending} className="gap-1.5">
                {addStrike.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Recording…</>
                  : `Record strike ${count + 1}/${limit}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
