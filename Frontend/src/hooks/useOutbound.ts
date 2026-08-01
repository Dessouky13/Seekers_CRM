/**
 * v2 Outbound Machine — read hooks for the Outbound control-center page.
 * All of these are populated by n8n via the API-key ingest endpoints
 * (/intel/*, /events, /mailboxes/health, /audits), so they are commonly
 * empty until the automations are wired up.
 */
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// ── Intel summary ─────────────────────────────────────────
export interface IntelSummary {
  total_leads:     number;
  enriched:        number;
  not_enriched:    number;
  with_intel:      number;
  scored:          number;
  avg_icp_score:   number | null;
  with_complaints: number;
  by_tag:          { tag: string; count: number }[];
}

export function useIntelSummary() {
  return useQuery<IntelSummary>({
    queryKey:  ["outbound", "intel", "summary"],
    queryFn:   () => apiFetch("/intel/summary"),
    staleTime: 30_000,
  });
}

// ── Intel leads ───────────────────────────────────────────
export type LeadStage =
  | "new_lead" | "contacted" | "call_scheduled" | "proposal_sent"
  | "negotiation" | "closed_won" | "closed_lost";

/** Free-form JSON written by the enrichment workflows. */
export type TechFingerprint = Record<string, unknown>;
export type ReviewStats     = Record<string, unknown>;

export interface IntelLead {
  id:              string;
  name:            string;
  company:         string;
  domain:          string | null;
  category:        string | null;
  stage:           LeadStage;
  icpScore:        number | null;
  techFingerprint: TechFingerprint | null;
  reviewStats:     ReviewStats | null;
  complaintTags:   string[] | null;
  updatedAt:       string;
}

export interface IntelLeadsResponse {
  data:   IntelLead[];
  total:  number;
  limit:  number;
  offset: number;
}

export interface IntelLeadsParams {
  /** true → only leads with a tech fingerprint. false → the enrichment worklist. */
  enriched?: boolean;
  limit?:    number;
  offset?:   number;
}

export function useIntelLeads(params: IntelLeadsParams = {}) {
  const qs = new URLSearchParams();
  if (params.enriched !== undefined) qs.set("enriched", String(params.enriched));
  if (params.limit    !== undefined) qs.set("limit",    String(params.limit));
  if (params.offset   !== undefined) qs.set("offset",   String(params.offset));
  const q = qs.toString();

  return useQuery<IntelLeadsResponse>({
    queryKey:  ["outbound", "intel", "leads", params],
    queryFn:   () => apiFetch(`/intel/leads${q ? `?${q}` : ""}`),
    staleTime: 30_000,
  });
}

// ── Events (append-only fact log) ─────────────────────────
export interface OutboundEvent {
  id:        string;
  leadId:    string | null;
  type:      string;
  payload:   Record<string, unknown> | null;
  source:    string | null;
  createdAt: string;
}

export interface EventsParams {
  lead_id?: string;
  type?:    string;
  limit?:   number;
}

export function useEvents(params: EventsParams = {}) {
  const qs = new URLSearchParams();
  if (params.lead_id) qs.set("lead_id", params.lead_id);
  if (params.type)    qs.set("type",    params.type);
  if (params.limit)   qs.set("limit",   String(params.limit));
  const q = qs.toString();

  return useQuery<OutboundEvent[]>({
    queryKey:  ["outbound", "events", params],
    queryFn:   () => apiFetch(`/events${q ? `?${q}` : ""}`),
    staleTime: 15_000,
  });
}

// ── Mailboxes (deliverability) ────────────────────────────
// numeric() columns arrive as strings from the pg driver.
export interface Mailbox {
  id:                string;
  address:           string;
  dailyCap:          number;
  sentToday:         number;
  healthScore:       number | null;
  warmupStage:       string | null;
  inboxPlacementPct: string | null;
  bounceRate:        string | null;
  dnsblListings:     string[] | null;
  seedResults:       Record<string, unknown> | null;
  lastCheckedAt:     string | null;
  createdAt:         string;
  updatedAt:         string;
}

export function useMailboxes() {
  return useQuery<Mailbox[]>({
    queryKey:  ["outbound", "mailboxes"],
    queryFn:   () => apiFetch("/mailboxes"),
    staleTime: 30_000,
  });
}

// ── Audits (lead-magnet + intent) ─────────────────────────
export interface Audit {
  id:        string;
  leadId:    string | null;
  slug:      string;
  score:     number | null;
  issues:    unknown[] | null;
  quickWins: unknown[] | null;
  pdfUrl:    string | null;
  pageUrl:   string | null;
  views:     number;
  hotFired:  boolean;
  createdAt: string;
  updatedAt: string;
}

export function useAudits() {
  return useQuery<Audit[]>({
    queryKey:  ["outbound", "audits"],
    queryFn:   () => apiFetch("/audits"),
    staleTime: 30_000,
  });
}
