// Sequences tab — grid of sequence cards plus the "New Sequence" creation
// dialog. Owns the sequence list query and create mutation; opening a card
// is delegated upward via `onOpen` so the page shell can swap in the editor.
import { useState } from "react";
import { Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useSequences, useCreateSequence } from "@/hooks/useOutreach";
import { cn } from "@/lib/utils";

export function SequencesList({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: sequences = [], isLoading } = useSequences();
  const createSeq = useCreateSequence();
  const [isOpen, setIsOpen] = useState(false);

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createSeq.mutate(
      {
        name:        fd.get("name") as string,
        description: (fd.get("description") as string) || undefined,
        category:    (fd.get("category") as string)    || undefined,
      },
      {
        onSuccess: (created) => {
          setIsOpen(false);
          toast.success("Sequence created");
          onOpen(created.id);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{sequences.length} sequence{sequences.length !== 1 ? "s" : ""}</p>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> New Sequence</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Sequence</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div><Label>Name</Label><Input name="name" required className="mt-1" placeholder="E.g. Cold outreach — SaaS founders" /></div>
              <div><Label>Description</Label><Textarea name="description" rows={2} className="mt-1" placeholder="What this sequence is for" /></div>
              <div><Label>Niche / Category (optional)</Label><Input name="category" className="mt-1" placeholder="E.g. SaaS, agency, e-commerce" /></div>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                <Button type="submit" disabled={createSeq.isPending}>
                  {createSeq.isPending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <SequencesListSkeleton />
      ) : sequences.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <Send className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No sequences yet. Create your first outreach sequence above.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sequences.map((seq) => (
            <div
              key={seq.id}
              onClick={() => onOpen(seq.id)}
              className="rounded-xl border border-border bg-card p-4 space-y-3 hover:border-primary/40 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{seq.name}</p>
                  {seq.category && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">{seq.category}</p>
                  )}
                </div>
                <Badge variant="outline" className={cn("text-[10px]", seq.isActive ? "border-success/30 text-success" : "border-muted text-muted-foreground")}>
                  {seq.isActive ? "ACTIVE" : "INACTIVE"}
                </Badge>
              </div>
              {seq.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{seq.description}</p>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
                <span className="text-muted-foreground">{seq.step_count} step{seq.step_count !== 1 ? "s" : ""}</span>
                <span className="text-primary font-semibold tabular-nums">{seq.active_enrollments} active</span>
              </div>
              {seq.autoEnrollOnCategory && (
                <Badge variant="secondary" className="text-[9px]">AUTO-ENROLL</Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Mirrors the sequence card grid above: title + niche, status pill,
// two-line description, and the step-count / active-count footer.
function SequencesListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-2.5 w-20" />
            </div>
            <Skeleton className="h-4 w-16 rounded-full" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
