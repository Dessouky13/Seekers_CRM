import { useState } from "react";
import { Sparkles, Loader2, ChevronDown, Copy, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useAgents, useAgentRuns, useRunAgent, type AgentScope } from "@/hooks/useAgents";
import { cn } from "@/lib/utils";

interface AgentPanelProps {
  scope:        AgentScope;
  contextId?:   string | null;
  contextLabel?: string;
}

export function AgentPanel({ scope, contextId, contextLabel }: AgentPanelProps) {
  const { data: agents = [] } = useAgents();
  const { data: runs = [] }   = useAgentRuns({ scope, context_id: contextId ?? undefined });
  const runAgent              = useRunAgent();

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const availableAgents = agents.filter((a) => a.scope === scope);
  const needsContext    = scope !== "pipeline" && scope !== "global";

  const handleRun = (agentId: string) => {
    if (needsContext && !contextId) {
      toast.error("No context selected");
      return;
    }
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
        <div className="space-y-2 max-h-[420px] overflow-y-auto">
          {runs.map((run) => {
            const agent = agents.find((a) => a.id === run.agentId);
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
                  <pre className="text-xs whitespace-pre-wrap font-sans text-foreground leading-relaxed">
                    {run.output}
                  </pre>
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
    </div>
  );
}
