// "What should I do next" — derived from real data, not a scripted tour.
//
// The app has a lot of surface and no explanation of the order things happen in:
// leads come in, they go into a sequence, the sequence has to have steps, and it
// has to be switched on before anything sends. Miss any one of those and nothing
// happens, with no error to explain why.
//
// A conventional coach-mark tour would narrate the UI once and then be wrong
// forever. This reads the actual state instead, so it always describes the next
// real gap — and a step that is already satisfied is shown as done rather than
// explained at someone who has moved past it.
import { useMemo } from "react";
import { usePipelineSummary } from "./useCRM";
import { useSequences } from "./useOutreach";
import { useCurrentUser } from "./useAuth";

export interface GuideStep {
  id:      string;
  title:   string;
  /** One sentence on why it matters. Consequence, not description. */
  why:     string;
  done:    boolean;
  /** Where to go to do it. */
  to:      string;
  cta:     string;
  /** Shown instead of `why` once done, when there is something worth saying. */
  doneNote?: string;
}

export interface Guide {
  steps:      GuideStep[];
  nextStep:   GuideStep | null;
  doneCount:  number;
  complete:   boolean;
  /** False until the underlying queries resolve, so nothing flashes "not done". */
  ready:      boolean;
}

const DISMISS_KEY = "seekers_guide_dismissed";

export function isGuideDismissed(): boolean {
  return localStorage.getItem(DISMISS_KEY) === "1";
}
export function dismissGuide() {
  localStorage.setItem(DISMISS_KEY, "1");
}
export function restoreGuide() {
  localStorage.removeItem(DISMISS_KEY);
}

export function useGuide(): Guide {
  const user = useCurrentUser();
  const isAdmin = user?.role === "admin";

  const { data: pipeline, isSuccess: pipeOk } = usePipelineSummary();
  // Sequence authoring is admin-only, so a member's guide stops at the lead steps.
  const { data: sequences, isSuccess: seqOk } = useSequences();

  return useMemo(() => {
    const ready = pipeOk && (!isAdmin || seqOk);

    const leadCount = (pipeline ?? []).reduce((s, r) => s + Number(r.count ?? 0), 0);
    const seqs      = sequences ?? [];
    const withSteps = seqs.filter((s) => s.step_count > 0);
    const live      = withSteps.filter((s) => s.isActive);
    const enrolled  = seqs.reduce((s, q) => s + Number(q.active_enrollments ?? 0), 0);

    const steps: GuideStep[] = [
      {
        id: "leads",
        title: "Add some leads",
        why: "Everything else works on leads. Add one by hand, import a CSV, or run the scraper.",
        done: leadCount > 0,
        doneNote: `${leadCount} lead${leadCount === 1 ? "" : "s"} in the pipeline.`,
        to: "/crm",
        cta: "Go to Leads",
      },
      ...(isAdmin ? [
        {
          id: "sequence",
          title: "Build a sequence",
          why: "A sequence is the cadence of emails sent automatically after a lead is enrolled. Start from the 3-touch template.",
          done: withSteps.length > 0,
          doneNote: `${withSteps.length} sequence${withSteps.length === 1 ? "" : "s"} with steps.`,
          to: "/outreach",
          cta: "Go to Outreach",
        },
        {
          id: "activate",
          // The single most common reason "it isn't sending".
          title: "Switch a sequence on",
          why: "New sequences are created switched off so template copy cannot go out unread. Nothing sends until one is live.",
          done: live.length > 0,
          doneNote: `${live.length} sequence${live.length === 1 ? "" : "s"} live.`,
          to: "/outreach",
          cta: "Review sequences",
        },
        {
          id: "enroll",
          title: "Enrol leads into it",
          why: "Select leads on the Leads page and use Enrol, or set the sequence to auto-enrol a niche.",
          done: enrolled > 0,
          doneNote: `${enrolled} lead${enrolled === 1 ? "" : "s"} currently enrolled.`,
          to: "/crm",
          cta: "Pick leads",
        },
      ] : []),
    ];

    const doneCount = steps.filter((s) => s.done).length;
    return {
      steps,
      // While loading, claim nothing — otherwise the panel briefly tells a
      // fully set-up user to go and add their first lead.
      nextStep: ready ? (steps.find((s) => !s.done) ?? null) : null,
      doneCount,
      complete: ready && doneCount === steps.length,
      ready,
    };
  }, [pipeline, sequences, isAdmin, pipeOk, seqOk]);
}
