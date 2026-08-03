import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface AuthRecord {
  record: "SPF" | "DKIM" | "DMARC";
  pass: boolean;
  value: string | null;
  problem: string | null;
}

export interface Deliverability {
  mailbox: {
    address: string;
    domain: string;
    warmup_stage: "recovery" | "warmup" | "active";
    daily_cap: number;
    sent_today: number;
    slots_left: number;
  };
  auth: AuthRecord[];
  suppressions: { total: number; by_reason: { reason: string; count: number }[] };
  failures: { kind: string; count: number; example: string | null }[];
}

export function useDeliverability() {
  return useQuery<Deliverability>({
    queryKey: ["outreach", "deliverability"],
    queryFn:  () => apiFetch("/outreach/deliverability"),
    // DNS answers and daily counts do not change minute to minute.
    staleTime: 5 * 60_000,
  });
}
