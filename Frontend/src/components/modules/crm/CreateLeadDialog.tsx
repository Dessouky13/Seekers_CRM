// "New" lead dialog: owns the trigger button and the create-lead form fields.
// Submission is handled by the page (which owns the useCreateLead mutation).

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_SOURCES, LEAD_CATEGORIES } from "./constants";
import type { ApiUser } from "@/lib/types";

export function CreateLeadDialog({
  open, onOpenChange, users, onSubmit, isPending,
}: {
  open:         boolean;
  onOpenChange: (open: boolean) => void;
  users:        ApiUser[];
  onSubmit:     (e: React.FormEvent<HTMLFormElement>) => void;
  isPending:    boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 h-8">
          <Plus className="h-3.5 w-3.5" /> New
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Lead</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><Label>Name</Label><Input name="name" required className="mt-1" placeholder="Contact name" /></div>
            <div>
              <Label>Company <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input name="company" className="mt-1" placeholder="Defaults to the name" />
            </div>
            <div><Label>Email</Label><Input name="email" type="email" className="mt-1" /></div>
            <div><Label>Phone</Label><Input name="phone" className="mt-1" placeholder="+20..." /></div>
            <div>
              <Label>Source</Label>
              <select name="source" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">None</option>
                {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <Label>Niche</Label>
              <select name="category" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">None</option>
                {LEAD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><Label>Deal Value (EGP)</Label><Input name="deal_value" type="number" min="0" className="mt-1" /></div>
            <div>
              <Label>Assigned To</Label>
              <select name="assignee_id" className="w-full mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>
          <div><Label>Notes</Label><Textarea name="notes" rows={2} placeholder="Any context about this lead…" className="mt-1" /></div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add Lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
