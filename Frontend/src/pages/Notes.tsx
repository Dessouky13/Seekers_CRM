import { useState, useEffect, useRef } from "react";
import { Save, StickyNote, Lightbulb, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface NoteResponse { content: string; updatedAt: string | null }
interface IdeaCard { id: string; content: string; color: string; authorName: string | null; createdAt: string }

const COLORS = [
  { key: "yellow", bg: "bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-700/40" },
  { key: "blue",   bg: "bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-700/40" },
  { key: "green",  bg: "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700/40" },
  { key: "pink",   bg: "bg-pink-50 border-pink-200 dark:bg-pink-900/20 dark:border-pink-700/40" },
  { key: "purple", bg: "bg-purple-50 border-purple-200 dark:bg-purple-900/20 dark:border-purple-700/40" },
] as const;

type ColorKey = typeof COLORS[number]["key"];

function colorBg(color: string) {
  return COLORS.find((c) => c.key === color)?.bg ?? COLORS[0].bg;
}

// ── Personal notepad ─────────────────────────────────────────────────────────
function MyNotes() {
  const currentUser = useCurrentUser();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = useQuery<NoteResponse>({
    queryKey: ["notes", "my"],
    queryFn:  () => apiFetch("/notes/my"),
  });

  useEffect(() => {
    if (data && !isDirty) setText(data.content);
  }, [data, isDirty]);

  const save = useMutation({
    mutationFn: (content: string) =>
      apiFetch("/notes/my", { method: "PUT", body: JSON.stringify({ content }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notes", "my"] }); setIsDirty(false); },
    onError: (err) => toast.error(err.message),
  });

  const handleChange = (val: string) => {
    setText(val);
    setIsDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save.mutate(val), 2000);
  };

  const handleManualSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    save.mutate(text);
    toast.success("Note saved");
  };

  const lastSaved = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Personal to {currentUser?.name ?? "you"} · Auto-saves as you type
        </p>
        <div className="flex items-center gap-3">
          {lastSaved && (
            <span className="text-xs text-muted-foreground hidden sm:block">Saved {lastSaved}</span>
          )}
          {isDirty && (
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 text-xs">Unsaved</Badge>
          )}
          <Button size="sm" onClick={handleManualSave} disabled={save.isPending || !isDirty}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save
          </Button>
        </div>
      </div>
      <div className="flex-1 rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
        ) : (
          <Textarea
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={`Jot down anything — ideas, meeting notes, reminders, links…\n\nThis notepad is just for you.`}
            className="h-full min-h-[500px] resize-none border-0 rounded-xl text-sm leading-relaxed focus-visible:ring-0 bg-card p-5 font-mono"
          />
        )}
      </div>
    </div>
  );
}

// ── Shared Team Board ─────────────────────────────────────────────────────────
function TeamBoard() {
  const currentUser = useCurrentUser();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newColor, setNewColor] = useState<ColorKey>("yellow");

  const { data: cards = [], isLoading } = useQuery<IdeaCard[]>({
    queryKey: ["notes", "board"],
    queryFn:  () => apiFetch("/notes/board"),
    refetchInterval: 30_000, // live refresh every 30s
  });

  const addCard = useMutation({
    mutationFn: (body: { content: string; color: string }) =>
      apiFetch("/notes/board", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes", "board"] });
      setAddOpen(false);
      setNewContent("");
      setNewColor("yellow");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteCard = useMutation({
    mutationFn: (id: string) => apiFetch(`/notes/board/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notes", "board"] }),
    onError:   (err) => toast.error(err.message),
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    addCard.mutate({ content: newContent, color: newColor });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Shared with the whole team · Refreshes every 30s
        </p>
        <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Add Idea
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading board…</div>
      ) : cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-16 text-center">
          <Lightbulb className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No ideas yet. Be the first to add one!</p>
        </div>
      ) : (
        <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
          {cards.map((card) => (
            <div
              key={card.id}
              className={cn(
                "break-inside-avoid rounded-xl border p-4 space-y-3 transition-shadow hover:shadow-md group",
                colorBg(card.color),
              )}
            >
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{card.content}</p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground font-medium">
                  {card.authorName ?? "Team"} · {new Date(card.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
                {(card.authorName === currentUser?.name || currentUser?.role === "admin") && (
                  <button
                    onClick={() => deleteCard.mutate(card.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-all"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Idea to Board</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Your idea</label>
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="Share an idea, resource, inspiration, or anything useful for the team…"
                rows={4}
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Color</label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setNewColor(c.key)}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition-all",
                      colorBg(c.key),
                      newColor === c.key ? "border-foreground scale-110" : "border-transparent",
                    )}
                  />
                ))}
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
              <Button type="submit" disabled={addCard.isPending || !newContent.trim()}>
                {addCard.isPending ? "Posting…" : "Post Idea"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Notes() {
  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-8rem)] space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <StickyNote className="h-5 w-5 text-primary" /> Notes
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your personal notepad + shared team board.</p>
      </div>

      <Tabs defaultValue="my" className="flex-1 flex flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="my" className="gap-1.5">
            <StickyNote className="h-3.5 w-3.5" /> My Notes
          </TabsTrigger>
          <TabsTrigger value="board" className="gap-1.5">
            <Lightbulb className="h-3.5 w-3.5" /> Team Board
          </TabsTrigger>
        </TabsList>

        <TabsContent value="my" className="flex-1 mt-4">
          <MyNotes />
        </TabsContent>
        <TabsContent value="board" className="mt-4">
          <TeamBoard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
