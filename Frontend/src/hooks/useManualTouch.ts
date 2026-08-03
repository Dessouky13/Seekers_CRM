import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type TouchOutcome =
  | "sent" | "no_whatsapp" | "wrong_number" | "not_interested" | "replied";

export function useRecordTouchOutcome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ enrollmentId, outcome, notes }: {
      enrollmentId: string; outcome: TouchOutcome; notes?: string;
    }) =>
      apiFetch(`/outreach/enrollments/${enrollmentId}/touch-outcome`, {
        method: "POST",
        body:   JSON.stringify({ outcome, notes }),
      }),
    onSuccess: () => {
      // The item leaves the queue and the lead's channels may have changed.
      qc.invalidateQueries({ queryKey: ["worklist"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["outreach"] });
    },
  });
}
