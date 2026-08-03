// Quotations — create, price, share, and convert into an invoice.
//
// Admin-gated as a module (see ADMIN_ONLY_MODULES in src/index.ts). The public
// share link lives on a separate router (routes/public-documents.ts) so it is
// outside that prefix by construction rather than by an exception.
import { Hono } from "hono";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  quotations, quotationItems, invoices, invoiceItems, clients,
} from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import {
  createQuotationSchema, updateQuotationSchema,
  quotationStatusSchema, convertQuotationSchema,
} from "../utils/validators";
import {
  getCompanySettings, nextDocumentNumber, newShareToken,
  documentTotals, quotationItemsFor, invoiceItemsFor, renderableQuotation,
  pdfFileName, isQuotationExpired,
  type DocumentItemRow,
} from "../services/documents";
import { renderDocumentPdf } from "../services/document-pdf";
import { shareUrlFor } from "../services/document-links";
// Seekers is a Cairo agency and these are financial documents: an invoice
// created at 00:30 local must not carry yesterday's issue date. Never
// `new Date().toISOString().slice(0, 10)` for "today" — see utils/dates.ts.
import { cairoToday, addCalendarDays, addCalendarMonths } from "../utils/dates";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();

type QuotationRow = typeof quotations.$inferSelect;

// ── Helpers ───────────────────────────────────────────────

/** Normalise the incoming items array into insertable rows, keeping order. */
function itemRows(
  items: NonNullable<ReturnType<typeof createQuotationSchema.parse>["items"]>,
): Omit<typeof quotationItems.$inferInsert, "quotationId">[] {
  return items.map((item, position) => ({
    description: item.description,
    quantity:    item.quantity   ?? "1.00",
    unitPrice:   item.unit_price ?? "0.00",
    kind:        item.kind       ?? "one_off",
    position,
  }));
}

/**
 * A priced retainer with a zero-month term silently vanishes from the total —
 * the user sees "8,000/month" in the form and a total that does not include it.
 * Refused at the API rather than quietly corrected, because guessing 12 months
 * on their behalf is worse.
 */
function retainerTermError(monthlyRetainer: string, retainerMonths: number): string | null {
  if (Number(monthlyRetainer) > 0 && retainerMonths < 1) {
    return "A monthly retainer needs a term of at least 1 month";
  }
  if (Number(monthlyRetainer) === 0 && retainerMonths > 0) return null;   // harmless
  return null;
}

/** The shape every quotation endpoint returns: the row + its items + its money. */
async function present(row: QuotationRow, items?: DocumentItemRow[]) {
  const lineItems = items ?? await quotationItemsFor(row.id);
  const totals    = documentTotals(row, lineItems);
  return {
    ...row,
    items:      lineItems,
    totals,
    share_url:  shareUrlFor("quotation", row.shareToken),
    is_expired: isQuotationExpired(row),
  };
}

/** Client snapshot fields, filled in from the linked client when not supplied. */
async function resolveRecipient(body: {
  client_id?: string | null;
  client_name?: string | null;
  client_company?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  client_address?: string | null;
}) {
  if (!body.client_id) {
    return {
      clientId:      null,
      clientName:    body.client_name    ?? null,
      clientCompany: body.client_company ?? null,
      clientEmail:   body.client_email   || null,
      clientPhone:   body.client_phone   ?? null,
      clientAddress: body.client_address ?? null,
    };
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, body.client_id)).limit(1);
  if (!client) throw Object.assign(new Error("Invalid client_id"), { status: 400 });

  return {
    clientId:      client.id,
    clientName:    body.client_name    ?? client.name,
    clientCompany: body.client_company ?? client.company,
    clientEmail:   body.client_email   || client.email,
    clientPhone:   body.client_phone   ?? client.phone,
    clientAddress: body.client_address ?? null,
  };
}

// ── GET /quotations ───────────────────────────────────────
router.get("/", authMiddleware, async (c) => {
  const q = c.req.query() as Record<string, string>;

  const conditions = [];
  if (q.status && q.status !== "all") {
    conditions.push(eq(quotations.status, q.status as QuotationRow["status"]));
  }
  if (q.client_id) conditions.push(eq(quotations.clientId, q.client_id));
  if (q.search) {
    conditions.push(or(
      ilike(quotations.number,        `%${q.search}%`),
      ilike(quotations.clientCompany, `%${q.search}%`),
      ilike(quotations.clientName,    `%${q.search}%`),
      ilike(quotations.title,         `%${q.search}%`),
    )!);
  }

  const rows = await db
    .select()
    .from(quotations)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(quotations.createdAt))
    .limit(Math.min(500, Math.max(1, Number(q.limit ?? 200) || 200)));

  if (rows.length === 0) return c.json([]);

  // One query for every item across every listed quotation — the list needs
  // totals, and totals need items, so fetching them per row would be N+1.
  const ids   = rows.map((r) => r.id);
  const items = await db
    .select()
    .from(quotationItems)
    .where(sql`${quotationItems.quotationId} = ANY(${sql.raw(`ARRAY[${ids.map((i) => `'${i}'::uuid`).join(",")}]`)})`)
    .orderBy(quotationItems.position);

  const byQuotation = new Map<string, DocumentItemRow[]>();
  for (const item of items) {
    const list = byQuotation.get(item.quotationId) ?? [];
    list.push(item);
    byQuotation.set(item.quotationId, list);
  }

  // Which invoices already exist for these quotations, so the UI can hide
  // "Convert" on one that has been converted.
  const converted = await db
    .select({ quotationId: invoices.quotationId, invoiceId: invoices.id, number: invoices.number })
    .from(invoices)
    .where(sql`${invoices.quotationId} = ANY(${sql.raw(`ARRAY[${ids.map((i) => `'${i}'::uuid`).join(",")}]`)})`);
  const invoiceByQuotation = new Map(converted.map((r) => [r.quotationId!, r]));

  return c.json(rows.map((row) => {
    const lineItems = byQuotation.get(row.id) ?? [];
    const invoice   = invoiceByQuotation.get(row.id);
    return {
      ...row,
      items:      lineItems,
      totals:     documentTotals(row, lineItems),
      share_url:  shareUrlFor("quotation", row.shareToken),
      is_expired: isQuotationExpired(row),
      invoice_id:     invoice?.invoiceId ?? null,
      invoice_number: invoice?.number ?? null,
    };
  }));
});

// ── POST /quotations ──────────────────────────────────────
router.post("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = createQuotationSchema.parse(await c.req.json());
  const settings = await getCompanySettings();

  let recipient;
  try {
    recipient = await resolveRecipient(body);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  if (!recipient.clientId && !recipient.clientCompany && !recipient.clientName) {
    return c.json({ error: "Pick a client or type a company name" }, 400);
  }

  const monthlyRetainer = body.monthly_retainer ?? "0.00";
  const retainerMonths  = body.retainer_months ?? 0;
  const termError = retainerTermError(monthlyRetainer, retainerMonths);
  if (termError) return c.json({ error: termError }, 400);

  const created = await db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "quotation", settings.quotationPrefix);

    const [row] = await tx.insert(quotations).values({
      number,
      title:           body.title ?? null,
      ...recipient,
      status:          body.status ?? "draft",
      currency:        body.currency ?? settings.defaultCurrency,
      setupFee:        body.setup_fee ?? "0.00",
      monthlyRetainer,
      retainerMonths,
      discountType:    body.discount_type ?? "none",
      discountValue:   body.discount_value ?? "0.00",
      taxRate:         body.tax_rate ?? settings.defaultTaxRate,
      notes:           body.notes ?? null,
      terms:           body.terms ?? settings.defaultPaymentTerms,
      validUntil:      body.valid_until ?? null,
      shareToken:      newShareToken(),
      sentAt:          body.status === "sent" ? new Date() : null,
      createdBy:       user.id,
    }).returning();

    if (body.items?.length) {
      await tx.insert(quotationItems).values(
        itemRows(body.items).map((i) => ({ ...i, quotationId: row.id })),
      );
    }

    return row;
  });

  return c.json(await present(created), 201);
});

// ── GET /quotations/:id ───────────────────────────────────
router.get("/:id", authMiddleware, async (c) => {
  const [row] = await db.select().from(quotations).where(eq(quotations.id, c.req.param("id"))).limit(1);
  if (!row) return c.json({ error: "Quotation not found" }, 404);
  return c.json(await present(row));
});

// ── PATCH /quotations/:id ─────────────────────────────────
router.patch("/:id", authMiddleware, async (c) => {
  const id   = c.req.param("id");
  const body = updateQuotationSchema.parse(await c.req.json());

  const [existing] = await db.select().from(quotations).where(eq(quotations.id, id)).limit(1);
  if (!existing) return c.json({ error: "Quotation not found" }, 404);

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (has(body, "client_id") || has(body, "client_name") || has(body, "client_company")
      || has(body, "client_email") || has(body, "client_phone") || has(body, "client_address")) {
    try {
      Object.assign(patch, await resolveRecipient({
        client_id:      has(body, "client_id")      ? body.client_id      : existing.clientId,
        client_name:    has(body, "client_name")    ? body.client_name    : existing.clientName,
        client_company: has(body, "client_company") ? body.client_company : existing.clientCompany,
        client_email:   has(body, "client_email")   ? body.client_email   : existing.clientEmail,
        client_phone:   has(body, "client_phone")   ? body.client_phone   : existing.clientPhone,
        client_address: has(body, "client_address") ? body.client_address : existing.clientAddress,
      }));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  }

  if (has(body, "title"))            patch.title           = body.title ?? null;
  if (has(body, "currency"))         patch.currency        = body.currency;
  if (has(body, "setup_fee"))        patch.setupFee        = body.setup_fee;
  if (has(body, "monthly_retainer")) patch.monthlyRetainer = body.monthly_retainer;
  if (has(body, "retainer_months"))  patch.retainerMonths  = body.retainer_months;
  if (has(body, "discount_type"))    patch.discountType    = body.discount_type;
  if (has(body, "discount_value"))   patch.discountValue   = body.discount_value;
  if (has(body, "tax_rate"))         patch.taxRate         = body.tax_rate;
  if (has(body, "notes"))            patch.notes           = body.notes ?? null;
  if (has(body, "terms"))            patch.terms           = body.terms ?? null;
  if (has(body, "valid_until"))      patch.validUntil      = body.valid_until ?? null;

  if (has(body, "status")) {
    patch.status = body.status;
    if (body.status === "sent" && !existing.sentAt) patch.sentAt = new Date();
    if (body.status === "accepted" || body.status === "rejected") patch.decidedAt = new Date();
  }

  const termError = retainerTermError(
    String(patch.monthlyRetainer ?? existing.monthlyRetainer),
    Number(patch.retainerMonths  ?? existing.retainerMonths),
  );
  if (termError) return c.json({ error: termError }, 400);

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(quotations).set(patch as never).where(eq(quotations.id, id)).returning();

    // Items are replaced wholesale when the key is present. A diff/merge on an
    // ordered, positional list is far more code and buys nothing — the editor
    // always submits the full list.
    if (body.items) {
      await tx.delete(quotationItems).where(eq(quotationItems.quotationId, id));
      if (body.items.length) {
        await tx.insert(quotationItems).values(
          itemRows(body.items).map((i) => ({ ...i, quotationId: id })),
        );
      }
    }

    return row;
  });

  return c.json(await present(updated));
});

// ── POST /quotations/:id/status ───────────────────────────
router.post("/:id/status", authMiddleware, async (c) => {
  const { status } = quotationStatusSchema.parse(await c.req.json());
  const id = c.req.param("id");

  const [existing] = await db.select().from(quotations).where(eq(quotations.id, id)).limit(1);
  if (!existing) return c.json({ error: "Quotation not found" }, 404);

  const [updated] = await db.update(quotations).set({
    status,
    sentAt:    status === "sent" ? (existing.sentAt ?? new Date()) : existing.sentAt,
    decidedAt: status === "accepted" || status === "rejected" ? new Date() : existing.decidedAt,
    updatedAt: new Date(),
  }).where(eq(quotations.id, id)).returning();

  return c.json(await present(updated));
});

// ── POST /quotations/:id/duplicate ────────────────────────
router.post("/:id/duplicate", authMiddleware, async (c) => {
  const user = c.get("user");
  const id   = c.req.param("id");

  const [source] = await db.select().from(quotations).where(eq(quotations.id, id)).limit(1);
  if (!source) return c.json({ error: "Quotation not found" }, 404);

  const items    = await quotationItemsFor(id);
  const settings = await getCompanySettings();

  const copy = await db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "quotation", settings.quotationPrefix);

    const [row] = await tx.insert(quotations).values({
      number,
      title:           source.title,
      clientId:        source.clientId,
      clientName:      source.clientName,
      clientCompany:   source.clientCompany,
      clientEmail:     source.clientEmail,
      clientPhone:     source.clientPhone,
      clientAddress:   source.clientAddress,
      // A duplicate always starts as a fresh draft with its own share token —
      // reusing the original's token would let an old recipient watch the new
      // version change under them.
      status:          "draft",
      currency:        source.currency,
      setupFee:        source.setupFee,
      monthlyRetainer: source.monthlyRetainer,
      retainerMonths:  source.retainerMonths,
      discountType:    source.discountType,
      discountValue:   source.discountValue,
      taxRate:         source.taxRate,
      notes:           source.notes,
      terms:           source.terms,
      validUntil:      source.validUntil,
      shareToken:      newShareToken(),
      createdBy:       user.id,
    }).returning();

    if (items.length) {
      await tx.insert(quotationItems).values(items.map((i, position) => ({
        quotationId: row.id,
        description: i.description,
        quantity:    i.quantity,
        unitPrice:   i.unitPrice,
        kind:        i.kind,
        position,
      })));
    }

    return row;
  });

  return c.json(await present(copy), 201);
});

// ── POST /quotations/:id/convert → invoice ────────────────
router.post("/:id/convert", authMiddleware, async (c) => {
  const user = c.get("user");
  const id   = c.req.param("id");
  const body = convertQuotationSchema.parse(await c.req.json().catch(() => ({})));

  const [quotation] = await db.select().from(quotations).where(eq(quotations.id, id)).limit(1);
  if (!quotation) return c.json({ error: "Quotation not found" }, 404);

  if (quotation.status !== "accepted") {
    return c.json({ error: "Only an accepted quotation can be converted to an invoice" }, 409);
  }

  // Converting twice must not produce two invoices for one deal. Returning the
  // existing one (rather than erroring) keeps a double click harmless.
  const [already] = await db.select().from(invoices).where(eq(invoices.quotationId, id)).limit(1);
  if (already) {
    return c.json({ ...already, items: await invoiceItemsFor(already.id), already_existed: true });
  }

  const items    = await quotationItemsFor(id);
  const settings = await getCompanySettings();

  const startRecurring = body.start_recurring ?? (Number(quotation.monthlyRetainer) > 0);
  const issueDate = body.issue_date ?? cairoToday();
  const dueDate   = body.due_date !== undefined ? body.due_date : addCalendarDays(issueDate, 14);

  const invoice = await db.transaction(async (tx) => {
    // A quotation can precede the client record. Converting is the moment the
    // deal is real, so this is where the client gets created and linked — on
    // the quotation as well, so both documents point at the same account.
    let clientId = quotation.clientId;
    if (!clientId) {
      const [client] = await tx.insert(clients).values({
        name:    quotation.clientName ?? quotation.clientCompany ?? "New client",
        company: quotation.clientCompany ?? quotation.clientName ?? "New client",
        email:   quotation.clientEmail,
        phone:   quotation.clientPhone,
        status:  "active",
        notes:   `Created from quotation ${quotation.number}`,
      }).returning({ id: clients.id });
      clientId = client.id;
      await tx.update(quotations).set({ clientId, updatedAt: new Date() }).where(eq(quotations.id, id));
    }

    const number = await nextDocumentNumber(tx, "invoice", settings.invoicePrefix);

    // The first invoice of a retainer bills the setup fee plus ONE month, and
    // the series continues from there. Billing all 12 months up front would
    // misstate both the invoice and the P&L.
    const retainerMonths = startRecurring ? Math.min(1, quotation.retainerMonths) : 0;

    const [row] = await tx.insert(invoices).values({
      number,
      title:           quotation.title,
      clientId,
      quotationId:     quotation.id,
      clientName:      quotation.clientName,
      clientCompany:   quotation.clientCompany,
      clientEmail:     quotation.clientEmail,
      clientPhone:     quotation.clientPhone,
      clientAddress:   quotation.clientAddress,
      status:          "draft",
      issueDate,
      dueDate,
      currency:        quotation.currency,
      setupFee:        quotation.setupFee,
      monthlyRetainer: quotation.monthlyRetainer,
      retainerMonths,
      discountType:    quotation.discountType,
      discountValue:   quotation.discountValue,
      taxRate:         quotation.taxRate,
      notes:           quotation.notes,
      terms:           quotation.terms ?? settings.defaultPaymentTerms,
      recurring:        startRecurring && quotation.retainerMonths > 0,
      recurrenceMonths: 1,
      recurrenceIndex:  1,
      recurrenceTotal:  startRecurring && quotation.retainerMonths > 0 ? quotation.retainerMonths : null,
      nextInvoiceDate:  startRecurring && quotation.retainerMonths > 1 ? addCalendarMonths(issueDate, 1) : null,
      shareToken:       newShareToken(),
      createdBy:        user.id,
    }).returning();

    // Only the FIRST invoice carries the one-off items. Recurring items ride
    // along every month; that is handled when the next invoice is spawned.
    if (items.length) {
      await tx.insert(invoiceItems).values(items.map((i, position) => ({
        invoiceId:   row.id,
        description: i.description,
        quantity:    i.quantity,
        unitPrice:   i.unitPrice,
        kind:        i.kind,
        position,
      })));
    }

    return row;
  });

  return c.json({ ...invoice, items: await invoiceItemsFor(invoice.id) }, 201);
});

// ── GET /quotations/:id/pdf ───────────────────────────────
router.get("/:id/pdf", authMiddleware, async (c) => {
  const [row] = await db.select().from(quotations).where(eq(quotations.id, c.req.param("id"))).limit(1);
  if (!row) return c.json({ error: "Quotation not found" }, 404);

  const [items, settings] = await Promise.all([quotationItemsFor(row.id), getCompanySettings()]);
  const pdf = await renderDocumentPdf(renderableQuotation(row, items, settings));

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(row)}"`,
      "Content-Length":      String(pdf.length),
      "Cache-Control":       "no-store",
    },
  });
});

// ── DELETE /quotations/:id ────────────────────────────────
router.delete("/:id", authMiddleware, async (c) => {
  const [deleted] = await db
    .delete(quotations)
    .where(eq(quotations.id, c.req.param("id")))
    .returning({ id: quotations.id });

  if (!deleted) return c.json({ error: "Quotation not found" }, 404);
  return new Response(null, { status: 204 });
});

// ── utils ─────────────────────────────────────────────────

function has<T extends object>(obj: T, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export default router;
