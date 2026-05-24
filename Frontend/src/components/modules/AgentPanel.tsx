import { useState } from "react";
import {
  Sparkles, Loader2, ChevronDown, Copy, CheckCheck, MessageSquarePlus,
  ListPlus, X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  useAgents, useAgentRuns, useRunAgent,
  useSaveRunAsActivity, useCreateTasksFromRun,
  type AgentScope, type AgentRun,
} from "@/hooks/useAgents";
import { cn } from "@/lib/utils";

interface AgentPanelProps {
  scope:         AgentScope;
  contextId?:    string | null;
  contextLabel?: string;
}

// Extract bullet-list candidates from markdown output for the "Create Tasks" picker.
// Picks lines that start with -, *, +, or 1./2./etc. — strips formatting + leading numbering.
function extractBullets(md: string): string[] {
  const lines = md.split(/\r?\n/);
  const bullets: string[] = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/);
    if (m) {
      const text = m[1]
        .replace(/^\*\*(.+?)\*\*[:\s—-]*/, "$1: ") // **Bold:** → "Bold: "
        .replace(/\*\*/g, "")
        .replace(/[*_`]/g, "")
        .trim();
      if (text.length > 3 && text.length < 280) bullets.push(text);
    }
  }
  return Array.from(new Set(bullets)); // dedupe
}

// Agents that meaningfully produce a draft message (worth saving as activity)
const SAVE_AS_ACTIVITY_AGENTS = new Set([
  "sales-outreach", "sales-discovery-coach", "sales-lead-enrichment",
]);

// Agents whose output is a list of deliverables/tasks
const CREATE_TASKS_AGENTS = new Set([
  "sales-proposal-strategist", "client-qbr",
]);

export function AgentPanel({ scope, contextId, contextLabel }: AgentPanelProps) {
  const { data: agents = [] } = useAgents();
  const { data: runs = [] }   = useAgentRuns({ scope, context_id: contextId ?? undefined });
  const runAgent              = useRunAgent();
  const saveAsActivity        = useSaveRunAsActivity();
  const createTasks           = useCreateTasksFromRun();

  const [copiedId,       setCopiedId]       = useState<string | null>(null);
  const [tasksDialogRun, setTasksDialogRun] = useState<AgentRun | null>(null);

  const availableAgents = agents.filter((a) => a.scope === scope);
  const needsContext    = scope !== "pipeline" && scope !== "global";

  const handleRun = (agentId: string) => {
    if (needsContext && !contextId) { toast.error("No context selected"); return; }
    runAgent.mutate(
      { agent_id: agentId, context_id: contextId ?? null },
      {
        onSuccess: () => toast.success("Agent finished"),
        onError:   (err) => toast.error(err.message),
      },
    );
  };

  const handleCopy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSaveAsActivity = (run: AgentRun, type: "email" | "call" | "note") => {
    saveAsActivity.mutate(
      { runId: run.id, type },
      {
        onSuccess: () => toast.success(`Saved as ${type} activity`),
        onError:   (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            AI Agents
          </p>
          {contextLabel && (
            <span className="text-[10px] text-muted-foreground">· {contextLabel}</span>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={runAgent.isPending || availableAgents.length === 0}>
              {runAgent.isPending ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Running…</>
              ) : (
                <><Sparkles className="h-3 w-3" /> Run Agent <ChevronDown className="h-3 w-3" /></>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {availableAgents.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">No agents for this scope.</div>
            ) : availableAgents.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                onClick={() => handleRun(agent.id)}
                className="flex-col items-start gap-0.5 py-2"
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-medium">{agent.name}</span>
                  {agent.tier === "premium" && (
                    <Badge variant="secondary" className="text-[9px] h-4 px-1.5">PRO</Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {agent.description}
                </p>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Run history */}
      {runs.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1">
          No agent runs yet. Click "Run Agent" to generate a draft.
        </p>
      ) : (
        <div className="space-y-2 max-h-[460px] overflow-y-auto">
          {runs.map((run) => {
            const agent          = agents.find((a) => a.id === run.agentId);
            const isLeadScope    = run.scope === "lead";
            const canSaveActivity = isLeadScope && SAVE_AS_ACTIVITY_AGENTS.has(run.agentId);
            const canCreateTasks  = CREATE_TASKS_AGENTS.has(run.agentId);
            const bullets        = canCreateTasks ? extractBullets(run.output) : [];

            return (
              <div
                key={run.id}
                className={cn(
                  "rounded-lg border bg-muted/30 p-3 space-y-2",
                  run.status === "error" ? "border-destructive/30 bg-destructive/5" : "border-border",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="h-3 w-3 text-primary shrink-0" />
                    <span className="text-xs font-semibold truncate">{agent?.name ?? run.agentId}</span>
                    {run.status === "error" && (
                      <Badge variant="destructive" className="text-[9px] h-4 px-1.5">FAILED</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {new Date(run.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {run.status === "success" && (
                      <button
                        onClick={() => handleCopy(run.id, run.output)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Copy output"
                      >
                        {copiedId === run.id ? <CheckCheck className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                </div>

                {run.status === "error" ? (
                  <p className="text-xs text-destructive">{run.error}</p>
                ) : (
                  <div className="agent-output text-xs leading-relaxed text-foreground">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: (p) => <h3 className="text-sm font-semibold mt-2 mb-1" {...p} />,
                        h2: (p) => <h4 className="text-xs font-semibold mt-2 mb-1 text-primary" {...p} />,
                        h3: (p) => <h5 className="text-xs font-semibold mt-2 mb-0.5" {...p} />,
                        p:  (p) => <p className="my-1.5" {...p} />,
                        ul: (p) => <ul className="list-disc pl-4 my-1.5 space-y-0.5" {...p} />,
                        ol: (p) => <ol className="list-decimal pl-4 my-1.5 space-y-0.5" {...p} />,
                        li: (p) => <li className="leading-snug" {...p} />,
                        strong: (p) => <strong className="font-semibold text-foreground" {...p} />,
                        code: (p) => <code className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono" {...p} />,
                      }}
                    >
                      {run.output}
                    </ReactMarkdown>
                  </div>
                )}

                {/* Write-back action row */}
                {run.status === "success" && (canSaveActivity || canCreateTasks) && (
                  <div className="flex items-center gap-2 pt-1.5 border-t border-border/40 flex-wrap">
                    {canSaveActivity && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="h-6 gap-1 text-[10px]" disabled={saveAsActivity.isPending}>
                            <MessageSquarePlus className="h-3 w-3" /> Save as Activity
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-32">
                          <DropdownMenuItem onClick={() => handleSaveAsActivity(run, "email")}>Email draft</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleSaveAsActivity(run, "call")}>Call notes</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleSaveAsActivity(run, "note")}>Note</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {canCreateTasks && bullets.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 text-[10px]"
                        onClick={() => setTasksDialogRun(run)}
                      >
                        <ListPlus className="h-3 w-3" /> Create Tasks ({bullets.length})
                      </Button>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground border-t border-border/40 pt-1.5">
                  <span>{run.model.split("/").pop()}</span>
                  <span>·</span>
                  <span>{run.tokensIn + run.tokensOut} tokens</span>
                  {Number(run.costUsd) > 0 && <><span>·</span><span>${Number(run.costUsd).toFixed(4)}</span></>}
                  {run.author_name && <><span>·</span><span>{run.author_name}</span></>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Task picker dialog */}
      {tasksDialogRun && (
        <CreateTasksDialog
          run={tasksDialogRun}
          onClose={() => setTasksDialogRun(null)}
          onCreate={(titles) => {
            createTasks.mutate(
              { runId: tasksDialogRun.id, titles },
              {
                onSuccess: ({ created }) => {
                  toast.success(`Created ${created} task${created === 1 ? "" : "s"}`);
                  setTasksDialogRun(null);
                },
                onError: (err) => toast.error(err.message),
              },
            );
          }}
          isPending={createTasks.isPending}
        />
      )}
    </div>
  );
}

// ─── Task picker dialog ───────────────────────────────────────
function CreateTasksDialog({ run, onClose, onCreate, isPending }: {
  run:       AgentRun;
  onClose:   () => void;
  onCreate:  (titles: string[]) => void;
  isPending: boolean;
}) {
  const bullets = extractBullets(run.output);
  const [selected, setSelected] = useState<Set<number>>(new Set(bullets.map((_, i) => i)));
  const [edits,    setEdits]    = useState<Record<number, string>>({});

  const toggle = (idx: number) => {
    const next = new Set(selected);
    next.has(idx) ? next.delete(idx) : next.add(idx);
    setSelected(next);
  };

  const finalTitles = bullets
    .map((b, i) => (selected.has(i) ? (edits[i] ?? b) : null))
    .filter((x): x is string => !!x && x.trim().length > 0);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Create Tasks from Output</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Pick which items to convert into tasks. You can edit each one before creating.
        </p>
        <div className="max-h-[400px] overflow-y-auto space-y-2 mt-2 pr-1">
          {bullets.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-4">
              No bullet-list items detected in the output.
            </p>
          ) : bullets.map((b, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md border border-border bg-card p-2">
              <Checkbox
                checked={selected.has(i)}
                onCheckedChange={() => toggle(i)}
                className="mt-0.5"
              />
              <input
                value={edits[i] ?? b}
                onChange={(e) => setEdits({ ...edits, [i]: e.target.value })}
                disabled={!selected.has(i)}
                className={cn(
                  "flex-1 bg-transparent text-xs outline-none border-0 focus:ring-0",
                  !selected.has(i) && "text-muted-foreground line-through",
                )}
                maxLength={280}
              />
            </div>
          ))}
        </div>
        <DialogFooter className="mt-3">
          <DialogClose asChild>
            <Button variant="ghost" size="sm" className="gap-1"><X className="h-3 w-3" /> Cancel</Button>
          </DialogClose>
          <Button
            size="sm"
            disabled={finalTitles.length === 0 || isPending}
            onClick={() => onCreate(finalTitles)}
          >
            {isPending ? "Creating…" : `Create ${finalTitles.length} Task${finalTitles.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
