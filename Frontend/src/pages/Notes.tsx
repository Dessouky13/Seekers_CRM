import { useState, useEffect, useRef } from "react";
import { Save, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useCurrentUser } from "@/hooks/useAuth";

interface NoteResponse { content: string; updatedAt: string | null }

export default function Notes() {
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes", "my"] });
      setIsDirty(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleChange = (val: string) => {
    setText(val);
    setIsDirty(true);
    // Auto-save after 2s idle
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      save.mutate(val);
    }, 2000);
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
    <div className="flex flex-col h-full max-h-[calc(100vh-8rem)] space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <StickyNote className="h-5 w-5 text-primary" />
            My Notes
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Personal notepad for {currentUser?.name ?? "you"}. Auto-saves as you type.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSaved && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              Saved {lastSaved}
            </span>
          )}
          {isDirty && (
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 text-xs">
              Unsaved changes
            </Badge>
          )}
          <Button
            size="sm"
            onClick={handleManualSave}
            disabled={save.isPending || !isDirty}
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            Save
          </Button>
        </div>
      </div>

      {/* Notepad */}
      <div className="flex-1 rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Loading your notes...
          </div>
        ) : (
          <Textarea
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={`Jot down anything — ideas, meeting notes, reminders, links...\n\nThis notepad is just for you. Only you can see it.`}
            className="h-full min-h-[500px] resize-none border-0 rounded-xl text-sm leading-relaxed focus-visible:ring-0 bg-card p-5 font-mono"
          />
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Auto-saves 2s after you stop typing · Only visible to you
      </p>
    </div>
  );
}
