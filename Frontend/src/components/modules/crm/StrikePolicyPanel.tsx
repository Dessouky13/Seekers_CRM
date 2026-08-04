// Settings → what happens on a lead's third manual-contact strike.
//
// Stored in the SAME `company_settings` row as the branding and document
// defaults (see BrandingPanel.tsx) rather than in a second settings store — this
// is already the single-row company config table, and a strike policy is company
// policy. Admin-only, because /company-settings is admin-gated as a module.

import { useState, useEffect } from "react";
import { Loader2, Save, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCompanySettings, useUpdateCompanySettings } from "@/hooks/useQuotations";
import { QueryError } from "@/components/QueryError";
import type { StrikeLimitAction } from "@/lib/types";

const OPTIONS: {
  value:  StrikeLimitAction;
  label:  string;
  detail: string;
  safest?: boolean;
}[] = [
  {
    value:  "close_lost",
    label:  "Move to Closed Lost",
    detail:
      "The lead stays in the list, searchable and reportable, and one stage " +
      "change puts it back. It stops appearing in Today's queue and the " +
      "stale-lead list, because those already skip closed stages.",
    safest: true,
  },
  {
    value:  "archive",
    label:  "Close lost and archive",
    detail:
      "Also hides the lead from the leads list. Nothing is deleted — the lead, " +
      "its timeline and its strikes all remain, and the “Archived only” filter " +
      "on the Leads page brings it back.",
  },
];

export function StrikePolicyPanel() {
  const { data: settings, isLoading, isError, error, refetch, isRefetching } = useCompanySettings();
  const update = useUpdateCompanySettings();

  const [choice, setChoice] = useState<StrikeLimitAction>("close_lost");

  // Sync once the row lands, and after every save, so the radio reflects what is
  // actually stored rather than an optimistic guess.
  useEffect(() => {
    if (settings?.strikeLimitAction) setChoice(settings.strikeLimitAction);
  }, [settings?.strikeLimitAction]);

  const dirty = !!settings && choice !== settings.strikeLimitAction;

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Contact Strikes</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Every manual contact attempt logged on a lead counts as a strike. On the
          third, the CRM takes this action automatically. Neither option deletes
          anything.
        </p>
      </div>

      {isLoading ? (
        <p className="text-xs italic text-muted-foreground">Loading…</p>
      ) : isError ? (
        // Never render a failed request as "the policy is close_lost" — an admin
        // would trust a value that was never read.
        <QueryError
          what="your strike policy" error={error} onRetry={refetch} isRetrying={isRefetching}
        />
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="sr-only">Action on the third strike</legend>
            {OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={cn(
                  // min-h-11 keeps the whole row a 44px tap target on a phone.
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  choice === opt.value
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-muted/20 hover:border-border/80",
                )}
              >
                <input
                  type="radio"
                  name="strike-limit-action"
                  value={opt.value}
                  checked={choice === opt.value}
                  onChange={() => setChoice(opt.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                    {opt.label}
                    {opt.safest && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                        Default · safest
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{opt.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="flex justify-end border-t border-border pt-3">
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!dirty || update.isPending}
              onClick={() =>
                update.mutate(
                  { strike_limit_action: choice },
                  {
                    onSuccess: () => toast.success("Strike policy saved"),
                    onError:   (err) => toast.error(err.message),
                  },
                )
              }
            >
              {update.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                : <><Save className="h-3.5 w-3.5" /> Save policy</>}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
