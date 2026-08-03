import { useState } from "react";
import {
  Radar, Sparkles, Activity, Mail, AlertTriangle, ShieldAlert, Inbox,
  Database, Target,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable } from "@/components/ui/responsive-table";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/ui/skeletons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useIntelSummary, useIntelLeads, useEvents, useMailboxes,
  type IntelLead, type OutboundEvent, type Mailbox, type TechFingerprint, type ReviewStats,
} from "@/hooks/useOutbound";
import { cn } from "@/lib/utils";

// ══════════════════════════════════════════════════════════
// Fingerprint → sales talking points
// ══════════════════════════════════════════════════════════
// The enrichment workflows write free-form JSON onto leads.techFingerprint.
// Nobody on the sales floor should ever read raw JSON, so every KNOWN key is
// translated into a short human chip with a tone; unknown keys are dropped
// silently rather than dumped on screen.

type ChipTone = "bad" | "warn" | "good" | "neutral";
interface Chip { label: string; tone: ChipTone }

const toneClass: Record<ChipTone, string> = {
  bad:     "bg-destructive/15 text-destructive border-destructive/30",
  warn:    "bg-warning/15 text-warning border-warning/30",
  good:    "bg-success/15 text-success border-success/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

/** Values the scrapers use to say "this isn't there". */
const ABSENT_VALUES = new Set(["", "none", "no", "false", "absent", "missing", "not_found", "unknown", "n/a", "null", "0"]);

function isAbsent(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0) return true;
  if (typeof v === "string") return ABSENT_VALUES.has(v.trim().toLowerCase());
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

const BRANDS: Record<string, string> = {
  wordpress: "WordPress", woocommerce: "WooCommerce", shopify: "Shopify", wix: "Wix",
  squarespace: "Squarespace", webflow: "Webflow", hubspot: "HubSpot", intercom: "Intercom",
  drift: "Drift", tawk: "Tawk.to", "tawk.to": "Tawk.to", crisp: "Crisp", zendesk: "Zendesk",
  calendly: "Calendly", whatsapp: "WhatsApp", ga4: "GA4", gtm: "GTM", godaddy: "GoDaddy",
};

function pretty(v: unknown): string {
  const raw = String(v).trim();
  const hit = BRANDS[raw.toLowerCase()];
  if (hit) return hit;
  return raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

interface FeatureSpec {
  /** All accepted key spellings — first one present in the payload wins. */
  keys:     string[];
  /** Chip when the feature is missing. Omit to stay quiet about absence. */
  missing?: Chip;
  /** Chip when the feature is present. Omit to stay quiet about presence. */
  present?: (value: unknown) => Chip;
}

const FEATURES: FeatureSpec[] = [
  {
    keys:    ["chat_widget", "chat", "live_chat", "chatbot"],
    missing: { label: "No chat widget", tone: "bad" },
    present: (v) => ({ label: v === true ? "Has chat widget" : `Chat: ${pretty(v)}`, tone: "good" }),
  },
  {
    keys:    ["booking", "booking_tool", "online_booking", "scheduler", "appointment_booking"],
    missing: { label: "No online booking", tone: "bad" },
    present: (v) => ({ label: v === true ? "Online booking" : `Booking: ${pretty(v)}`, tone: "good" }),
  },
  {
    keys:    ["csr_only", "client_side_rendered", "spa_only", "is_csr"],
    missing: { label: "Server-rendered", tone: "good" },
    present: () => ({ label: "CSR-only (bad for SEO)", tone: "bad" }),
  },
  {
    keys:    ["ga4", "has_ga4", "analytics", "google_analytics"],
    missing: { label: "No analytics", tone: "bad" },
    present: (v) => ({ label: v === true ? "Analytics installed" : `Analytics: ${pretty(v)}`, tone: "good" }),
  },
  {
    keys:    ["gtm", "tag_manager", "google_tag_manager"],
    missing: { label: "No tag manager", tone: "warn" },
    present: () => ({ label: "Tag Manager", tone: "good" }),
  },
  {
    keys:    ["meta_pixel", "facebook_pixel", "pixel"],
    missing: { label: "No ad pixel", tone: "warn" },
    present: () => ({ label: "Ad pixel installed", tone: "good" }),
  },
  {
    keys:    ["ssl", "https", "ssl_valid"],
    missing: { label: "No valid HTTPS", tone: "bad" },
    present: () => ({ label: "HTTPS", tone: "good" }),
  },
  {
    keys:    ["mobile_friendly", "responsive", "mobile"],
    missing: { label: "Not mobile-friendly", tone: "bad" },
    present: () => ({ label: "Mobile-friendly", tone: "good" }),
  },
  {
    keys:    ["contact_form", "forms", "lead_form"],
    missing: { label: "No contact form", tone: "bad" },
    present: () => ({ label: "Contact form", tone: "good" }),
  },
  {
    keys:    ["click_to_call", "phone_link", "tel_link"],
    missing: { label: "No click-to-call", tone: "warn" },
    present: () => ({ label: "Click-to-call", tone: "good" }),
  },
  {
    keys:    ["whatsapp", "whatsapp_link"],
    missing: { label: "No WhatsApp link", tone: "warn" },
    present: () => ({ label: "WhatsApp link", tone: "good" }),
  },
  {
    keys:    ["schema_markup", "structured_data", "schema"],
    missing: { label: "No schema markup", tone: "warn" },
    present: () => ({ label: "Schema markup", tone: "good" }),
  },
  {
    keys:    ["blog", "content_hub"],
    missing: { label: "No blog / content", tone: "warn" },
    present: () => ({ label: "Has a blog", tone: "good" }),
  },
  {
    keys:    ["dmarc"],
    missing: { label: "No DMARC record", tone: "warn" },
    present: () => ({ label: "DMARC set", tone: "good" }),
  },
  {
    keys:    ["spf"],
    missing: { label: "No SPF record", tone: "warn" },
    present: () => ({ label: "SPF set", tone: "good" }),
  },
  {
    keys:    ["cms", "platform"],
    present: (v) => ({ label: `CMS: ${pretty(v)}`, tone: "neutral" }),
  },
  {
    keys:    ["ecommerce", "cart", "store"],
    present: (v) => ({ label: v === true ? "E-commerce site" : `Store: ${pretty(v)}`, tone: "neutral" }),
  },
  {
    keys:    ["running_ads", "google_ads", "ads"],
    present: () => ({ label: "Running paid ads", tone: "neutral" }),
  },
];

/** Pull the first numeric score out of whatever shape `pagespeed` arrived in. */
function pagespeedScore(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  if (v && typeof v === "object") {
    for (const k of ["performance", "score", "mobile", "mobile_score", "desktop", "desktop_score"]) {
      const n = (v as Record<string, unknown>)[k];
      if (typeof n === "number") return n;
      if (typeof n === "string" && n.trim() !== "" && !Number.isNaN(Number(n))) return Number(n);
    }
  }
  return null;
}

/** Turn a raw fingerprint blob into ordered, human chips. Unknown keys ignored. */
function fingerprintChips(fp: TechFingerprint | null | undefined): Chip[] {
  if (!fp || typeof fp !== "object") return [];
  const chips: Chip[] = [];

  for (const spec of FEATURES) {
    const key = spec.keys.find((k) => k in fp);
    if (key === undefined) continue;
    const value = fp[key];
    const chip  = isAbsent(value) ? spec.missing : spec.present?.(value);
    if (chip) chips.push(chip);
  }

  const ps = pagespeedScore(fp.pagespeed ?? fp.page_speed ?? fp.lighthouse);
  if (ps !== null) {
    const rounded = Math.round(ps <= 1 ? ps * 100 : ps);
    chips.push({
      label: `PageSpeed ${rounded}/100${rounded < 50 ? " — very slow" : rounded < 90 ? " — sluggish" : ""}`,
      tone:  rounded < 50 ? "bad" : rounded < 90 ? "warn" : "good",
    });
  }

  // Problems first — they're the ones that open a conversation.
  const order: Record<ChipTone, number> = { bad: 0, warn: 1, neutral: 2, good: 3 };
  return chips.sort((a, b) => order[a.tone] - order[b.tone]);
}

const COMPLAINT_LABELS: Record<string, string> = {
  slow_response:     "Slow to respond",
  no_response:       "Never responds",
  booking_chaos:     "Booking chaos",
  rude_staff:        "Rude staff",
  pricing:           "Pricing complaints",
  overpriced:        "Seen as overpriced",
  quality:           "Quality complaints",
  wait_times:        "Long wait times",
  no_show:           "No-shows / cancellations",
  hard_to_reach:     "Hard to reach",
  bad_website:       "Website complaints",
  poor_communication:"Poor communication",
};

function complaintLabel(tag: string): string {
  return COMPLAINT_LABELS[tag.toLowerCase()] ?? pretty(tag);
}

/** Review stats → readable "4.2★ · 128 reviews · Google" style fragments. */
function reviewFragments(rs: ReviewStats | null | undefined): string[] {
  if (!rs || typeof rs !== "object") return [];
  const out: string[] = [];
  const pick = (...keys: string[]) => keys.map((k) => rs[k]).find((v) => v !== undefined && v !== null);

  const rating = pick("rating", "average_rating", "score", "stars");
  if (rating !== undefined) out.push(`${Number(rating).toFixed(1)}★`);

  const count = pick("review_count", "count", "total", "reviews");
  if (count !== undefined && typeof count !== "object") out.push(`${count} reviews`);

  const negative = pick("negative_count", "recent_negative", "one_star");
  if (negative !== undefined && typeof negative !== "object") out.push(`${negative} negative`);

  const source = pick("source", "platform", "provider");
  if (source !== undefined && typeof source !== "object") out.push(pretty(source));

  return out;
}

// ══════════════════════════════════════════════════════════
// Shared bits
// ══════════════════════════════════════════════════════════
function ChipRow({ chips }: { chips: Chip[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip, i) => (
        <span
          key={`${chip.label}-${i}`}
          className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", toneClass[chip.tone])}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, hint }: {
  icon: typeof Mail; label: string; value: string | number; hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <p className="text-2xl font-semibold text-foreground tabular-nums">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

/** Mirrors KpiCard: label + icon row, big number, optional hint line. */
function KpiCardSkeleton({ withHint = false }: { withHint?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-1.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3.5 w-3.5 rounded" />
      </div>
      <Skeleton className="h-8 w-16" />
      {withHint && <Skeleton className="mt-1 h-3 w-24" />}
    </div>
  );
}

function EmptyState({ icon: Icon, title, hint }: { icon: typeof Mail; title: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-12 text-center">
      <Icon className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">{hint}</p>
    </div>
  );
}

function IcpBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <span className="text-xs text-muted-foreground tabular-nums">—</span>;
  }
  const tone = score >= 70 ? "bg-success/15 text-success" : score >= 40 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums", tone)}>{score}</span>
  );
}

function EnrichedPill({ enriched }: { enriched: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px]", enriched ? "border-success/30 text-success" : "border-warning/30 text-warning")}
    >
      {enriched ? "ENRICHED" : "NEEDS ENRICHMENT"}
    </Badge>
  );
}

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// ══════════════════════════════════════════════════════════
// Page
// ══════════════════════════════════════════════════════════
export default function Outbound() {
  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Outbound</h1>
          <p className="hidden sm:block text-sm text-muted-foreground mt-0.5">
            Lead intelligence, deliverability health, and the raw event log from the outbound machine.
          </p>
        </div>
      </div>

      <Tabs defaultValue="pipeline">
        <TabsList className="mb-4">
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
          <TabsTrigger value="deliverability">Deliverability</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline"><PipelineTab /></TabsContent>
        <TabsContent value="intelligence"><IntelligenceTab /></TabsContent>
        <TabsContent value="deliverability"><DeliverabilityTab /></TabsContent>
        <TabsContent value="activity"><ActivityTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ── Pipeline ──────────────────────────────────────────────
type LeadFilter = "all" | "enriched" | "missing";

const INTEL_LEAD_COLUMNS = ["Lead", "Niche", "Stage", "ICP", "Intel", "Updated"];

function PipelineTab() {
  const [filter, setFilter] = useState<LeadFilter>("all");
  const { data: summary, isLoading: loadingSummary } = useIntelSummary();
  const { data: leadsRes, isLoading: loadingLeads } = useIntelLeads({
    limit:    200,
    enriched: filter === "all" ? undefined : filter === "enriched",
  });

  const leads = leadsRes?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loadingSummary ? (
          <>
            <KpiCardSkeleton />
            <KpiCardSkeleton withHint />
            <KpiCardSkeleton withHint />
            <KpiCardSkeleton withHint />
          </>
        ) : (
          <>
            <KpiCard icon={Database} label="Total leads"   value={summary?.total_leads ?? 0} />
            <KpiCard icon={Sparkles} label="Enriched"      value={summary?.enriched ?? 0}
                     hint="has a tech fingerprint" />
            <KpiCard icon={AlertTriangle} label="Not enriched" value={summary?.not_enriched ?? 0}
                     hint="waiting on the scraper" />
            <KpiCard icon={Target} label="Avg ICP score"
                     value={summary?.avg_icp_score ?? "—"}
                     hint={summary ? `${summary.scored} lead${summary.scored === 1 ? "" : "s"} scored` : undefined} />
          </>
        )}
      </div>

      {summary && summary.by_tag.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
            Most common complaints — {summary.with_complaints} lead{summary.with_complaints === 1 ? "" : "s"} tagged
          </p>
          <div className="flex flex-wrap gap-1.5">
            {summary.by_tag.map((t) => (
              <span key={t.tag} className="rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-[11px] text-destructive">
                {complaintLabel(t.tag)} <span className="tabular-nums opacity-70">· {t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Select value={filter} onValueChange={(v) => setFilter(v as LeadFilter)}>
          <SelectTrigger className="w-52 h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Leads with intel</SelectItem>
            <SelectItem value="enriched">Enriched only</SelectItem>
            <SelectItem value="missing">Needs enrichment</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground tabular-nums">
          {leadsRes ? `${leads.length} of ${leadsRes.total}` : ""}
        </span>
      </div>

      {loadingLeads ? (
        <TableSkeleton columns={INTEL_LEAD_COLUMNS} rows={8} />
      ) : leads.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="No intel yet"
          hint="Enrichment runs via n8n once configured — it posts to /intel/fingerprint, /intel/reviews and /intel/enrichment with the automation API key. Every lead it touches appears here with an ICP score."
        />
      ) : (
        // Table on desktop, stacked cards on a phone. This table overflowed a
        // 390px screen by 254px, hiding the ICP score and enrichment state —
        // the two columns the page exists to show.
        <ResponsiveTable
          rows={leads}
          rowKey={(l) => l.id}
          caption="Leads with enrichment intelligence"
          columns={[
            {
              header: "Lead", priority: "primary",
              cell: (l) => <span className="font-medium text-foreground">{l.name}</span>,
            },
            {
              header: "Company", priority: "secondary",
              cell: (l) => <>{l.company}{l.domain ? ` · ${l.domain}` : ""}</>,
            },
            {
              header: "Niche", priority: "meta",
              cell: (l) => l.category ?? "—",
            },
            {
              header: "Stage", priority: "meta", hideLabelOnMobile: true,
              cell: (l) => (
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {l.stage.replace(/_/g, " ")}
                </Badge>
              ),
            },
            {
              header: "ICP", priority: "meta", hideLabelOnMobile: true,
              cell: (l) => <IcpBadge score={l.icpScore} />,
            },
            {
              header: "Enriched", priority: "meta", hideLabelOnMobile: true,
              cell: (l) => <EnrichedPill enriched={!!l.techFingerprint} />,
            },
            {
              header: "Updated", priority: "meta",
              className: "text-xs text-muted-foreground tabular-nums",
              cell: (l) => relTime(l.updatedAt),
            },
          ]}
        />
      )}
    </div>
  );
}

// ── Intelligence ──────────────────────────────────────────
/** Mirrors an intel card: company/name line, domain line, ICP pill, chip row. */
function IntelCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="mt-1 h-3.5 w-1/4" />
        </div>
        <Skeleton className="h-5 w-9 shrink-0 rounded-md" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["w-24", "w-28", "w-20", "w-32"].map((w) => (
          <Skeleton key={w} className={cn("h-5 rounded-full", w)} />
        ))}
      </div>
    </div>
  );
}

function IntelligenceTab() {
  const { data: leadsRes, isLoading } = useIntelLeads({ limit: 200, enriched: true });
  const [selected, setSelected] = useState<IntelLead | null>(null);
  const leads = leadsRes?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-72" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <IntelCardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No enriched leads yet"
        hint="Once the n8n fingerprint workflow scrapes a lead's website, its tech stack, review profile and complaint themes land here as ready-to-use talking points — no chat widget, CSR-only, missing analytics, and so on."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {leads.length} enriched lead{leads.length === 1 ? "" : "s"} — click a row for the full talking-point breakdown.
      </p>

      <div className="space-y-2">
        {leads.map((l) => {
          const chips = fingerprintChips(l.techFingerprint);
          const pains = chips.filter((ch) => ch.tone === "bad" || ch.tone === "warn");
          return (
            <div
              key={l.id}
              onClick={() => setSelected(l)}
              className="rounded-xl border border-border bg-card p-4 space-y-2.5 hover:border-primary/40 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {l.company}
                    <span className="text-muted-foreground font-normal"> · {l.name}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {l.domain ?? "no domain"}{l.category ? ` · ${l.category}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <IcpBadge score={l.icpScore} />
                </div>
              </div>

              {pains.length > 0 ? (
                <ChipRow chips={pains.slice(0, 6)} />
              ) : (
                <p className="text-[11px] text-muted-foreground italic">
                  No weaknesses detected — fingerprint came back clean.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <LeadIntelDialog lead={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function LeadIntelDialog({ lead, onClose }: { lead: IntelLead | null; onClose: () => void }) {
  const chips    = fingerprintChips(lead?.techFingerprint);
  const reviews  = reviewFragments(lead?.reviewStats);
  const tags     = lead?.complaintTags ?? [];

  return (
    <Dialog open={!!lead} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {lead.company}
                <IcpBadge score={lead.icpScore} />
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {lead.name}{lead.domain ? ` · ${lead.domain}` : ""}{lead.category ? ` · ${lead.category}` : ""}
              </p>
            </DialogHeader>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Website & tech</p>
              {chips.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Nothing recognisable in this lead's fingerprint yet.
                </p>
              ) : (
                <ChipRow chips={chips} />
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reputation</p>
              {reviews.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No review data collected for this lead.</p>
              ) : (
                <p className="text-sm text-foreground tabular-nums">{reviews.join("  ·  ")}</p>
              )}
              {tags.length > 0 && (
                <ChipRow chips={tags.map((t) => ({ label: complaintLabel(t), tone: "bad" as ChipTone }))} />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Deliverability ────────────────────────────────────────
function healthTone(score: number | null): { text: string; bar: string; label: string } {
  if (score === null || score === undefined) return { text: "text-muted-foreground", bar: "bg-muted-foreground/40", label: "Unchecked" };
  if (score >= 70) return { text: "text-success",     bar: "bg-success",     label: "Healthy" };
  if (score >= 50) return { text: "text-warning",     bar: "bg-warning",     label: "At risk" };
  return              { text: "text-destructive", bar: "bg-destructive", label: "Critical" };
}

/** Mirrors MailboxCard: address block, score, health bar, 3 metric tiles. */
function MailboxCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-1 h-3.5 w-1/2" />
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <Skeleton className="h-8 w-10" />
          <Skeleton className="h-3 w-14" />
        </div>
      </div>

      <Skeleton className="h-1.5 w-full rounded-full" />

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        {["Inbox", "Bounce", "Sent today"].map((label) => (
          <div key={label} className="rounded-lg border border-border bg-muted/10 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <Skeleton className="mt-1 h-5 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

function DeliverabilityTab() {
  const { data: mailboxes = [], isLoading } = useMailboxes();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <MailboxCardSkeleton key={i} />)}
      </div>
    );
  }

  if (mailboxes.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No mailboxes reporting"
        hint="Deliverability appears once the n8n seed-test workflow POSTs to /mailboxes/health with the automation API key. It reports inbox placement, bounce rate and DNSBL listings per sending address."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {mailboxes.map((mb) => <MailboxCard key={mb.id} mailbox={mb} />)}
    </div>
  );
}

function MailboxCard({ mailbox: mb }: { mailbox: Mailbox }) {
  const tone     = healthTone(mb.healthScore);
  const listings = mb.dnsblListings ?? [];
  const placement = mb.inboxPlacementPct != null ? Number(mb.inboxPlacementPct) : null;
  const bounce    = mb.bounceRate != null ? Number(mb.bounceRate) : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{mb.address}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {mb.warmupStage ? pretty(mb.warmupStage) : "No warmup stage"}
            {" · "}
            {mb.lastCheckedAt ? `checked ${relTime(mb.lastCheckedAt)}` : "never checked"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={cn("text-2xl font-semibold tabular-nums", tone.text)}>{mb.healthScore ?? "—"}</p>
          <p className={cn("text-[10px] uppercase tracking-wider", tone.text)}>{tone.label}</p>
        </div>
      </div>

      <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
        <div className={cn("h-full transition-all", tone.bar)} style={{ width: `${Math.max(0, Math.min(100, mb.healthScore ?? 0))}%` }} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
        <div className="rounded-lg border border-border bg-muted/10 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Inbox</p>
          <p className="text-sm font-semibold tabular-nums text-foreground">{placement != null ? `${placement}%` : "—"}</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/10 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Bounce</p>
          <p className={cn("text-sm font-semibold tabular-nums", bounce != null && bounce >= 3 ? "text-destructive" : "text-foreground")}>
            {bounce != null ? `${bounce}%` : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/10 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Sent today</p>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {mb.sentToday}<span className="text-muted-foreground font-normal">/{mb.dailyCap || "∞"}</span>
          </p>
        </div>
      </div>

      {listings.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 flex items-start gap-2.5">
          <ShieldAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="text-xs text-foreground">
            <span className="font-semibold text-destructive">
              Blacklisted on {listings.length} DNSBL{listings.length === 1 ? "" : "s"}.
            </span>{" "}
            Pause this mailbox and request delisting — {listings.join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Activity ──────────────────────────────────────────────
const EVENT_TONE: Record<string, string> = {
  reply:         "bg-success/15 text-success",
  won:           "bg-success/15 text-success",
  meeting:       "bg-success/15 text-success",
  sent:          "bg-primary/10 text-primary",
  open:          "bg-info/15 text-info",
  click:         "bg-info/15 text-info",
  audit_view:    "bg-warning/15 text-warning",
  bounce:        "bg-destructive/15 text-destructive",
  unsub:         "bg-destructive/15 text-destructive",
  error:         "bg-destructive/15 text-destructive",
  lost:          "bg-destructive/15 text-destructive",
  fingerprinted: "bg-muted text-muted-foreground",
  enriched:      "bg-muted text-muted-foreground",
  reviewed:      "bg-muted text-muted-foreground",
};

/** A short, readable line from an event payload — never the raw blob. */
function payloadSummary(payload: Record<string, unknown> | null): string | null {
  if (!payload || typeof payload !== "object") return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (v === null || typeof v === "object") continue;
    parts.push(`${pretty(k)}: ${String(v)}`);
    if (parts.length === 4) break;
  }
  return parts.length ? parts.join("  ·  ") : null;
}

function ActivityTab() {
  const { data: events = [], isLoading } = useEvents({ limit: 200 });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-56" />
        <div className="rounded-xl border border-border bg-card divide-y divide-border/50">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-2.5">
              <Skeleton className="h-4 w-16 shrink-0 mt-0.5 rounded-md" />
              <div className="flex-1 min-w-0 space-y-1">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <Skeleton className="h-3 w-12 shrink-0 mt-0.5" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No events logged yet"
        hint="Every fact the outbound machine observes — sourced, verified, sent, opened, bounced, replied, audit viewed — is appended here via /events. The log is the training data for the learning loop, so it fills up as soon as the n8n workflows run."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{events.length} most recent events, newest first.</p>
      <div className="rounded-xl border border-border bg-card divide-y divide-border/50">
        {events.map((ev) => <EventRow key={ev.id} event={ev} />)}
      </div>
    </div>
  );
}

function EventRow({ event: ev }: { event: OutboundEvent }) {
  const summary = payloadSummary(ev.payload);
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <Badge
        variant="outline"
        className={cn("text-[10px] uppercase shrink-0 mt-0.5", EVENT_TONE[ev.type] ?? "bg-muted text-muted-foreground")}
      >
        {ev.type.replace(/_/g, " ")}
      </Badge>
      <div className="flex-1 min-w-0">
        {summary
          ? <p className="text-xs text-foreground break-words">{summary}</p>
          : <p className="text-xs text-muted-foreground italic">No detail recorded.</p>}
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {ev.source ?? "unknown source"}{ev.leadId ? ` · lead ${ev.leadId.slice(0, 8)}` : " · no lead"}
        </p>
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 mt-0.5">{relTime(ev.createdAt)}</span>
    </div>
  );
}
