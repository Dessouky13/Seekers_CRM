// v2 Outbound Machine — automation ingest endpoints (n8n → CRM).
// All authenticated with the automation API key (X-API-Key). These are the
// contracts in GOMAA_TASKS.md. Additive; nothing here sends email or touches
// the sequencer.
import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { leads, events, mailboxes, audits } from "../db/schema";
import { apiKeyAuth, jwtOrApiKey } from "../middleware/automation-auth";
import { fireEventAsync } from "../services/webhooks";
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
  await db.update(leads).set({
    email:       best?.email       ? sql`COALESCE(${leads.email}, ${best.email})` : sql`${leads.email}`,
    emailStatus: best?.email_status ?? sql`${leads.emailStatus}`,
    phone:       best?.phone       ? sql`COALESCE(${leads.phone}, ${best.phone})` : sql`${leads.phone}`,
    signals:     sql`COALESCE(${leads.signals}, '{}'::jsonb) || ${JSON.stringify({ contacts: b.contacts })}::jsonb`,
    updatedAt:   new Date(),
  }).where(eq(leads.id, leadId));
  await logEvent(leadId, "enriched", { contacts: b.contacts.length });
  return c.json({ lead_id: leadId, ok: true, contacts: b.contacts.length });
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

eventsRouter.get("/", jwtOrApiKey, async (c) => {
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
    warmup_stage: z.string().max(40).optional(),
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

mailboxesRouter.get("/", jwtOrApiKey, async (c) => {
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

auditsRouter.get("/", jwtOrApiKey, async (c) => {
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
