// v2 Outbound Machine — automation ingest endpoints (n8n → CRM).
// All authenticated with the automation API key (X-API-Key). These are the
// contracts in GOMAA_TASKS.md. Additive; nothing here sends email or touches
// the sequencer.
import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { leads, events, mailboxes, audits } from "../db/schema";
import { apiKeyAuth, adminOrApiKey } from "../middleware/automation-auth";
import { fireEventAsync } from "../services/webhooks";
import { phoneFields } from "../services/phone";
import type { AppEnv } from "../types";

// Resolve a lead from lead_id | domain | email (in that order). Returns id or null.
async function resolveLeadId(opts: { lead_id?: string; domain?: string; email?: string }): Promise<string | null> {
  if (opts.lead_id) {
    const [l] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, opts.lead_id)).limit(1);
    return l?.id ?? null;
  }
  if (opts.domain) {
    const d = opts.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    const [l] = await db.select({ id: leads.id }).from(leads)
      .where(sql`LOWER(${leads.domain}) = ${d} OR LOWER(${leads.email}) LIKE ${"%@" + d}`).limit(1);
    return l?.id ?? null;
  }
  if (opts.email) {
    const [l] = await db.select({ id: leads.id }).from(leads)
      .where(sql`LOWER(${leads.email}) = ${opts.email.toLowerCase()}`).limit(1);
    return l?.id ?? null;
  }
  return null;
}

async function logEvent(leadId: string | null, type: string, payload: unknown, source = "n8n") {
  await db.insert(events).values({ leadId, type, payload: payload as any, source });
}

// ══════════════════════════════════════════════════════════
// /intel — enrichment ingest (fingerprint, reviews, enrichment)
// ══════════════════════════════════════════════════════════
export const intel = new Hono<AppEnv>();

const matchKeys = { lead_id: z.string().uuid().optional(), domain: z.string().max(255).optional(), email: z.string().max(320).optional() };

intel.post("/fingerprint", apiKeyAuth, async (c) => {
  const b = z.object({ ...matchKeys, tech_fingerprint: z.record(z.unknown()), pagespeed: z.record(z.unknown()).optional() })
    .parse(await c.req.json());
  const leadId = await resolveLeadId(b);
  if (!leadId) return c.json({ error: "No matching lead (send lead_id, domain, or email; ingest the lead first)" }, 404);

  const fingerprint = b.pagespeed ? { ...b.tech_fingerprint, pagespeed: b.pagespeed } : b.tech_fingerprint;
  await db.update(leads).set({
    techFingerprint: fingerprint as any,
    domain: b.domain ? b.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase() : sql`${leads.domain}`,
    updatedAt: new Date(),
  }).where(eq(leads.id, leadId));
  await logEvent(leadId, "fingerprinted", fingerprint);
  return c.json({ lead_id: leadId, ok: true });
});

intel.post("/reviews", apiKeyAuth, async (c) => {
  const b = z.object({
    ...matchKeys,
    review_stats: z.record(z.unknown()).optional(),
    complaint_tags: z.array(z.string()).max(20).optional(),
    hook: z.string().max(500).optional(),
  }).parse(await c.req.json());
  const leadId = await resolveLeadId(b);
  if (!leadId) return c.json({ error: "No matching lead" }, 404);

  await db.update(leads).set({
    reviewStats:   (b.review_stats ?? null) as any,
    complaintTags: b.complaint_tags ?? null,
    signals:       b.hook ? (sql`COALESCE(${leads.signals}, '{}'::jsonb) || ${JSON.stringify({ hook: b.hook })}::jsonb`) : sql`${leads.signals}`,
    updatedAt: new Date(),
  }).where(eq(leads.id, leadId));
  await logEvent(leadId, "reviewed", { review_stats: b.review_stats, complaint_tags: b.complaint_tags, hook: b.hook });
  return c.json({ lead_id: leadId, ok: true });
});

intel.post("/enrichment", apiKeyAuth, async (c) => {
  const b = z.object({
    company_domain: z.string().max(255).optional(),
    lead_id: z.string().uuid().optional(),
    email: z.string().max(320).optional(),
    contacts: z.array(z.object({
      name: z.string().optional(), title: z.string().optional(),
      email: z.string().optional(), email_status: z.string().optional(),
      linkedin_url: z.string().optional(), phone: z.string().optional(),
    })).default([]),
  }).parse(await c.req.json());

  const leadId = await resolveLeadId({ lead_id: b.lead_id, domain: b.company_domain, email: b.email });
  if (!leadId) return c.json({ error: "No matching lead" }, 404);

  // Prefer the first verified email as the lead's primary contact.
  const best = b.contacts.find((x) => x.email && (x.email_status === "verified" || !x.email_status)) ?? b.contacts[0];

  // phone/phone_e164/phone_type must move together, so this can't stay a bare
  // SQL COALESCE like the email fields below — that would leave phone_e164
  // describing whichever number the raw SQL happened to keep, not necessarily
  // the one `phone` ends up with. Read the current value, decide the winner in
  // JS (existing wins if non-null, same as COALESCE), then derive all three
  // from that single winning value.
  const [current] = await db.select({ phone: leads.phone }).from(leads).where(eq(leads.id, leadId)).limit(1);
  const winningPhone = current?.phone ?? best?.phone ?? null;
  const { phone, phoneE164, phoneType } = phoneFields(winningPhone);

  await db.update(leads).set({
    email:       best?.email       ? sql`COALESCE(${leads.email}, ${best.email})` : sql`${leads.email}`,
    emailStatus: best?.email_status ?? sql`${leads.emailStatus}`,
    phone, phoneE164, phoneType,
    signals:     sql`COALESCE(${leads.signals}, '{}'::jsonb) || ${JSON.stringify({ contacts: b.contacts })}::jsonb`,
    updatedAt:   new Date(),
  }).where(eq(leads.id, leadId));
  await logEvent(leadId, "enriched", { contacts: b.contacts.length });
  return c.json({ lead_id: leadId, ok: true, contacts: b.contacts.length });
});

// ── Read side (CRM Outbound page) ─────────────────────────
// "Has intel" = anything the outbound machine wrote back onto the lead.
const HAS_INTEL = sql`(
  ${leads.techFingerprint} IS NOT NULL
  OR ${leads.reviewStats}   IS NOT NULL
  OR ${leads.signals}       IS NOT NULL
  OR ${leads.icpScore}      IS NOT NULL
  OR (${leads.complaintTags} IS NOT NULL AND cardinality(${leads.complaintTags}) > 0)
)`;

// GET /intel/leads — leads carrying outbound intelligence.
//   ?limit  (default 50, max 200) / ?offset
//   ?enriched=true   → only leads WITH a tech fingerprint
//   ?enriched=false  → the enrichment worklist: every lead still MISSING one
//   (omitted)        → every lead that has any intel at all
intel.get("/leads", adminOrApiKey, async (c) => {
  const q      = c.req.query();
  const limit  = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const offset = Math.max(0, Number(q.offset) || 0);

  const where =
    q.enriched === "true"  ? sql`${leads.techFingerprint} IS NOT NULL` :
    q.enriched === "false" ? sql`${leads.techFingerprint} IS NULL`     :
    HAS_INTEL;

  // Total is counted over the same predicate — never derived from the page.
  const [{ total }] = await db
    .select({ total: sql<number>`CAST(COUNT(*) AS int)` })
    .from(leads)
    .where(where);

  const rows = await db.select({
    id:              leads.id,
    name:            leads.name,
    company:         leads.company,
    domain:          leads.domain,
    category:        leads.category,
    stage:           leads.stage,
    icpScore:        leads.icpScore,
    techFingerprint: leads.techFingerprint,
    reviewStats:     leads.reviewStats,
    complaintTags:   leads.complaintTags,
    updatedAt:       leads.updatedAt,
  })
    .from(leads)
    .where(where)
    .orderBy(sql`${leads.icpScore} DESC NULLS LAST`, desc(leads.updatedAt))
    .limit(limit)
    .offset(offset);

  return c.json({ data: rows, total: Number(total ?? 0), limit, offset });
});

// GET /intel/summary — header tiles for the Outbound page.
intel.get("/summary", adminOrApiKey, async (c) => {
  const [agg] = await db.select({
    total:           sql<number>`CAST(COUNT(*) AS int)`,
    enriched:        sql<number>`CAST(COUNT(*) FILTER (WHERE ${leads.techFingerprint} IS NOT NULL) AS int)`,
    with_intel:      sql<number>`CAST(COUNT(*) FILTER (WHERE ${HAS_INTEL}) AS int)`,
    with_complaints: sql<number>`CAST(COUNT(*) FILTER (WHERE ${leads.complaintTags} IS NOT NULL AND cardinality(${leads.complaintTags}) > 0) AS int)`,
    scored:          sql<number>`CAST(COUNT(${leads.icpScore}) AS int)`,
    avg_icp_score:   sql<number | null>`ROUND(AVG(${leads.icpScore}))`,
  }).from(leads);

  const tagRows = await db.execute(sql`
    SELECT tag, CAST(COUNT(*) AS int) AS count
    FROM leads, UNNEST(complaint_tags) AS tag
    WHERE complaint_tags IS NOT NULL
    GROUP BY tag
    ORDER BY count DESC, tag ASC
    LIMIT 12
  `);

  const total    = Number(agg?.total ?? 0);
  const enriched = Number(agg?.enriched ?? 0);

  return c.json({
    total_leads:     total,
    enriched:        enriched,
    not_enriched:    total - enriched,
    with_intel:      Number(agg?.with_intel ?? 0),
    scored:          Number(agg?.scored ?? 0),
    avg_icp_score:   agg?.avg_icp_score != null ? Number(agg.avg_icp_score) : null,
    with_complaints: Number(agg?.with_complaints ?? 0),
    by_tag: (tagRows.rows as { tag: string; count: number }[])
      .map((r) => ({ tag: r.tag, count: Number(r.count) })),
  });
});

// ══════════════════════════════════════════════════════════
// /events — append-only fact log
// ══════════════════════════════════════════════════════════
export const eventsRouter = new Hono<AppEnv>();

eventsRouter.post("/", apiKeyAuth, async (c) => {
  const b = z.object({
    lead_id: z.string().uuid().optional(),
    company_id: z.string().uuid().optional(),   // accepted for forward-compat; ignored until companies exist
    type: z.string().min(1).max(60),
    payload: z.record(z.unknown()).optional(),
    source: z.string().max(120).optional(),
  }).parse(await c.req.json());
  const [row] = await db.insert(events).values({
    leadId: b.lead_id ?? null, type: b.type, payload: (b.payload ?? null) as any, source: b.source ?? "n8n",
  }).returning({ id: events.id });
  return c.json({ id: row.id, ok: true }, 201);
});

eventsRouter.get("/", adminOrApiKey, async (c) => {
  const q = c.req.query();
  const conds = [];
  if (q.lead_id) conds.push(eq(events.leadId, q.lead_id));
  if (q.type)    conds.push(eq(events.type, q.type));
  const rows = await db.select().from(events)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(events.createdAt)).limit(Math.min(200, Number(q.limit) || 100));
  return c.json(rows);
});

// ══════════════════════════════════════════════════════════
// /mailboxes — deliverability health
// ══════════════════════════════════════════════════════════
export const mailboxesRouter = new Hono<AppEnv>();

mailboxesRouter.post("/health", apiKeyAuth, async (c) => {
  const b = z.object({
    address: z.string().email(),
    inbox_placement_pct: z.number().min(0).max(100).optional(),
    bounce_rate: z.number().min(0).max(100).optional(),
    dnsbl_listings: z.array(z.string()).optional(),
    seed_results: z.record(z.unknown()).optional(),
    daily_cap: z.number().int().min(0).optional(),
    // Enum, not a free string. A bare string let an automation payload post
    // warmup_stage:"active" onto a mailbox the scheduler had just downgraded to
    // "recovery" after a spam rejection — silently undoing the one safety
    // response this system has to being filtered. An unrecognised value was
    // worse still: it is cast to WarmupStage, matches neither the "recovery"
    // nor "active" branch of dailyCapFor, and so falls through to the warmup
    // ramp, quietly granting more volume than any real stage would.
    warmup_stage: z.enum(["recovery", "warmup", "active"]).optional(),
  }).parse(await c.req.json());

  // Simple health score: placement is the dominant signal, penalize bounces + listings.
  const placement = b.inbox_placement_pct ?? null;
  const bounce    = b.bounce_rate ?? 0;
  const listings  = b.dnsbl_listings?.length ?? 0;
  const health = placement != null
    ? Math.max(0, Math.min(100, Math.round(placement - bounce * 2 - listings * 15)))
    : null;

  const [row] = await db.insert(mailboxes).values({
    address: b.address.toLowerCase(),
    inboxPlacementPct: placement != null ? String(placement) : null,
    bounceRate: b.bounce_rate != null ? String(b.bounce_rate) : null,
    dnsblListings: (b.dnsbl_listings ?? null) as any,
    seedResults: (b.seed_results ?? null) as any,
    dailyCap: b.daily_cap ?? 0,
    warmupStage: b.warmup_stage ?? null,
    healthScore: health,
    lastCheckedAt: new Date(),
  }).onConflictDoUpdate({
    target: mailboxes.address,
    set: {
      inboxPlacementPct: placement != null ? String(placement) : sql`${mailboxes.inboxPlacementPct}`,
      bounceRate: b.bounce_rate != null ? String(b.bounce_rate) : sql`${mailboxes.bounceRate}`,
      dnsblListings: (b.dnsbl_listings ?? null) as any,
      seedResults: (b.seed_results ?? null) as any,
      // Was absent from this set block, so a cap posted here only ever landed on
      // a first INSERT — an operator updating it saw the request succeed and
      // nothing change. Safe to honour: effectiveDailyCap clamps any stored
      // value to ACTIVE_CEILING before it can authorise a send.
      dailyCap: b.daily_cap ?? sql`${mailboxes.dailyCap}`,
      warmupStage: b.warmup_stage ?? sql`${mailboxes.warmupStage}`,
      healthScore: health ?? sql`${mailboxes.healthScore}`,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    },
  }).returning();

  // Alert on a fresh blacklisting.
  if (listings > 0) fireEventAsync("lead.hot", { kind: "mailbox_blacklisted", address: b.address, listings: b.dnsbl_listings });
  return c.json({ ok: true, health_score: row.healthScore });
});

mailboxesRouter.get("/", adminOrApiKey, async (c) => {
  const rows = await db.select().from(mailboxes).orderBy(desc(mailboxes.healthScore));
  return c.json(rows);
});

// ══════════════════════════════════════════════════════════
// /audits + /intent — audit lead-magnet & intent tracking
// ══════════════════════════════════════════════════════════
export const auditsRouter = new Hono<AppEnv>();

auditsRouter.post("/", apiKeyAuth, async (c) => {
  const b = z.object({
    lead_id: z.string().uuid().optional(),
    slug: z.string().min(1).max(120),
    score: z.number().int().min(0).max(100).optional(),
    issues: z.array(z.unknown()).optional(),
    quick_wins: z.array(z.unknown()).optional(),
    pdf_url: z.string().max(500).optional(),
    page_url: z.string().max(500).optional(),
  }).parse(await c.req.json());

  const [row] = await db.insert(audits).values({
    leadId: b.lead_id ?? null, slug: b.slug, score: b.score ?? null,
    issues: (b.issues ?? null) as any, quickWins: (b.quick_wins ?? null) as any,
    pdfUrl: b.pdf_url ?? null, pageUrl: b.page_url ?? null,
  }).onConflictDoUpdate({
    target: audits.slug,
    set: {
      score: b.score ?? sql`${audits.score}`,
      issues: (b.issues ?? null) as any, quickWins: (b.quick_wins ?? null) as any,
      pdfUrl: b.pdf_url ?? sql`${audits.pdfUrl}`, pageUrl: b.page_url ?? sql`${audits.pageUrl}`,
      updatedAt: new Date(),
    },
  }).returning();
  return c.json({ id: row.id, slug: row.slug, ok: true }, 201);
});

auditsRouter.get("/", adminOrApiKey, async (c) => {
  const rows = await db.select().from(audits).orderBy(desc(audits.views)).limit(200);
  return c.json(rows);
});

// Intent pixel hit. Increments views; fires lead.hot once on the 3rd view.
export const intentRouter = new Hono<AppEnv>();
const HOT_VIEW_THRESHOLD = 3;

intentRouter.post("/", apiKeyAuth, async (c) => {
  const b = z.object({ slug: z.string().min(1).max(120), ip_hash: z.string().optional(), ua: z.string().optional() })
    .parse(await c.req.json());

  const [a] = await db.update(audits)
    .set({ views: sql`${audits.views} + 1`, updatedAt: new Date() })
    .where(eq(audits.slug, b.slug))
    .returning();
  if (!a) return c.json({ error: "Unknown audit slug" }, 404);

  await logEvent(a.leadId, "audit_view", { slug: b.slug });

  if (a.views >= HOT_VIEW_THRESHOLD && !a.hotFired) {
    await db.update(audits).set({ hotFired: true }).where(eq(audits.id, a.id));
    fireEventAsync("lead.hot", { kind: "audit_intent", slug: b.slug, views: a.views, lead_id: a.leadId });
  }
  return c.json({ ok: true, views: a.views });
});
