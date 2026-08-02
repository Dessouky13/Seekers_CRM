// CRM shared constants: pipeline stage metadata + chip styles, the source and
// category option lists used by the lead forms/filters, activity-type icons and
// the currency formatter. Extracted verbatim from CRM.tsx.

import { Mail, Phone, Calendar, Globe } from "lucide-react";
import type { LeadStage } from "@/lib/types";

export interface LeadStageMeta {
  key:   LeadStage;
  label: string;
  color: string;
  chip:  string;
}

export const LEAD_STAGES: LeadStageMeta[] = [
  { key: "new_lead",       label: "New Lead",        color: "text-zinc-300",   chip: "bg-zinc-500/15 text-zinc-300 ring-1 ring-inset ring-zinc-500/20" },
  { key: "contacted",      label: "Contacted",       color: "text-blue-300",   chip: "bg-blue-500/15 text-blue-300 ring-1 ring-inset ring-blue-500/20" },
  { key: "call_scheduled", label: "Call Scheduled",  color: "text-violet-300", chip: "bg-violet-500/15 text-violet-300 ring-1 ring-inset ring-violet-500/20" },
  { key: "proposal_sent",  label: "Proposal Sent",   color: "text-amber-300",  chip: "bg-amber-500/15 text-amber-300 ring-1 ring-inset ring-amber-500/20" },
  { key: "negotiation",    label: "Negotiation",     color: "text-orange-300", chip: "bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-500/20" },
  { key: "closed_won",     label: "Closed Won",      color: "text-emerald-300", chip: "bg-emerald-500/15 text-emerald-300 ring-1 ring-inset ring-emerald-500/20" },
  { key: "closed_lost",    label: "Closed Lost",     color: "text-rose-300",   chip: "bg-rose-500/15 text-rose-300 ring-1 ring-inset ring-rose-500/20" },
];

export const CATEGORY_CHIP = "bg-fuchsia-500/12 text-fuchsia-300 ring-1 ring-inset ring-fuchsia-500/20";
export const SOURCE_CHIP   = "bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-500/15";

export const LEAD_SOURCES = [
  "Instagram", "Facebook", "TikTok", "LinkedIn",
  "Email", "Website", "Phone", "Referral", "Other",
] as const;

export const LEAD_CATEGORIES = [
  "E-commerce", "Healthcare", "Real Estate", "Education", "Retail",
  "Food & Beverage", "Manufacturing", "Financial Services", "Legal",
  "Marketing Agency", "SaaS", "Logistics", "Media", "Automotive", "Other",
] as const;

export const activityIcons: Record<string, typeof Mail> = {
  email: Mail, call: Phone, meeting: Calendar, form: Globe,
};

export const fmt = (n: number | string) => `EGP ${Number(n).toLocaleString()}`;
