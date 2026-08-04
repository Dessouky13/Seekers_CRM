// Invoices — issue, mark paid (which writes the P&L row), and roll a retainer
// forward one month at a time.
//
// Admin-gated as a module (ADMIN_ONLY_MODULES in src/index.ts). The public share
// link lives on routes/public-documents.ts, outside that prefix.
import { Hono } from "hono";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { invoices, invoiceItems, clients } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import {
  createInvoiceSchema, updateInvoiceSchema, invoiceStatusSchema,
} from "../utils/validators";
import {
  getCompanySettings, nextDocumentNumber, newShareToken,
  documentTotals, invoiceItemsFor, renderableInvoice, pdfFileName,
  type DocumentItemRow,
} from "../services/documents";
import { renderDocumentPdf } from "../services/document-pdf";
import { shareUrlFor } from "../services/document-links";
import { applyInvoiceStatus } from "../services/invoice-payments";
// Cairo calendar days, not UTC. An invoice issued at 00:30 local would
// otherwise carry yesterday's date, and its due date and overdue flag would
// both be computed a day early — on a document the client pays against.
import { cairoToday, addCalendarDays, addCalendarMonths } from "../utils/dates";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();

type InvoiceRow = typeof invoices.$inferSelect;

async function present(row: InvoiceRow, items?: DocumentItemRow[]) {
  const lineItems = items ?? await invoiceItemsFor(row.id);
  return {
    ...row,
    items:     lineItems,
    totals:    documentTotals(row, lineItems),
    share_url: shareUrlFor("invoice", row.shareToken),
    is_overdue: isOverdue(row),
  };
}

/** Unpaid and past its due date — computed, never a stored status that drifts. */
function isOverdue(row: InvoiceRow, today = cairoToday()): boolean {
  if (!row.dueDate) return false;
  if (row.status === "paid" || row.status === "void" || row.status === "draft") return false;
  return row.dueDate < today;
}

function itemRows(items: NonNullable<ReturnType<typeof createInvoiceSchema.parse>["items"]>) {
  return items.map((item, position) => ({
    description: item.description,
    quantity:    item.quantity   ?? "1.00",
    unitPrice:   item.unit_price ?? "0.00",
    kind:        item.kind       ?? "one_off",
    position,
  }));
}

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

// ── GET /invoices ─────────────────────────────────────────
router.get("/", authMiddleware, async (c) => {
  const q = c.req.query() as Record<string, string>;

  const conditions = [];
  if (q.status && q.status !== "all") {
    if (q.status === "overdue") {
      // "Overdue" is a view over unpaid invoices past their due date, not a
      // stored status that some sweep has to keep truthful.
      conditions.push(sql`${invoices.status} IN ('sent','overdue')
                          AND ${invoices.dueDate} IS NOT NULL
                          AND ${invoices.dueDate} < CURRENT_DATE`);
    } else {
      conditions.push(eq(invoices.status, q.status as InvoiceRow["status"]));
    }
  }
  if (q.client_id) conditions.push(eq(invoices.clientId, q.client_id));
  if (q.search) {
    conditions.push(or(
      ilike(invoices.number,        `%${q.search}%`),
      ilike(invoices.clientCompany, `%${q.search}%`),
      ilike(invoices.clientName,    `%${q.search}%`),
      ilike(invoices.title,         `%${q.search}%`),
    )!);
  }

  const rows = await db
    .select()
    .from(invoices)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt))
    .limit(Math.min(500, Math.max(1, Number(q.limit ?? 200) || 200)));

  if (rows.length === 0) return c.json([]);

  const ids   = rows.map((r) => r.id);
  const items = await db
    .select()
    .from(invoiceItems)
    .where(sql`${invoiceItems.invoiceId} = ANY(${sql.raw(`ARRAY[${ids.map((i) => `'${i}'::uuid`).join(",")}]`)})`)
    .orderBy(invoiceItems.position);

  const byInvoice = new Map<string, DocumentItemRow[]>();
  for (const item of items) {
    const list = byInvoice.get(item.invoiceId) ?? [];
    list.push(item);
    byInvoice.set(item.invoiceId, list);
  }

  return c.json(rows.map((row) => {
    const lineItems = byInvoice.get(row.id) ?? [];
    return {
      ...row,
      items:      lineItems,
      totals:     documentTotals(row, lineItems),
      share_url:  shareUrlFor("invoice", row.shareToken),
      is_overdue: isOverdue(row),
    };
  }));
});

// ── POST /invoices ────────────────────────────────────────
router.post("/", authMiddleware, async (c) => {
  const user     = c.get("user");
  const body     = createInvoiceSchema.parse(await c.req.json());
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
  if (Number(monthlyRetainer) > 0 && retainerMonths < 1) {
    return c.json({ error: "A monthly retainer needs a term of at least 1 month" }, 400);
  }

  const issueDate = body.issue_date ?? cairoToday();
  const dueDate   = body.due_date !== undefined ? body.due_date : addCalendarDays(issueDate, 14);
  const recurring = body.recurring ?? false;

  const created = await db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "invoice", settings.invoicePrefix);

    const [row] = await tx.insert(invoices).values({
      number,
      title:           body.title ?? null,
      ...recipient,
      status:          body.status ?? "draft",
      issueDate,
      dueDate,
      currency:        body.currency ?? settings.defaultCurrency,
      setupFee:        body.setup_fee ?? "0.00",
      monthlyRetainer,
      retainerMonths,
      discountType:    body.discount_type ?? "none",
      discountValue:   body.discount_value ?? "0.00",
      taxRate:         body.tax_rate ?? settings.defaultTaxRate,
      notes:           body.notes ?? null,
      terms:           body.terms ?? settings.defaultPaymentTerms,
      recurring,
      recurrenceMonths: body.recurrence_months ?? 1,
      recurrenceIndex:  1,
      recurrenceTotal:  body.recurrence_total ?? null,
      nextInvoiceDate:  recurring ? addCalendarMonths(issueDate, body.recurrence_months ?? 1) : null,
      shareToken:       newShareToken(),
      createdBy:        user.id,
    }).returning();

    if (body.items?.length) {
      await tx.insert(invoiceItems).values(itemRows(body.items).map((i) => ({ ...i, invoiceId: row.id })));
    }
    return row;
  });

  // A directly-created invoice can be born paid (recording a payment already
  // received), and that still has to write exactly one ledger row.
  if (created.status === "paid") {
    const applied = await applyInvoiceStatus(created.id, "paid", { userId: user.id });
    if (applied) return c.json(await present(applied.invoice), 201);
  }

  return c.json(await present(created), 201);
});

// ── GET /invoices/:id ─────────────────────────────────────
router.get("/:id", authMiddleware, async (c) => {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, c.req.param("id"))).limit(1);
  if (!row) return c.json({ error: "Invoice not found" }, 404);
  return c.json(await present(row));
});

// ── PATCH /invoices/:id ───────────────────────────────────
router.patch("/:id", authMiddleware, async (c) => {
  const id   = c.req.param("id");
  const body = updateInvoiceSchema.parse(await c.req.json());

  const [existing] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!existing) return c.json({ error: "Invoice not found" }, 404);

  // A paid invoice's amounts are already in the P&L. Editing them here would
  // silently desynchronise the two, so the money is frozen once it is paid —
  // un-pay it first if the figures were wrong.
  const touchesMoney = ["setup_fee", "monthly_retainer", "retainer_months",
                        "discount_type", "discount_value", "tax_rate", "items", "currency"]
    .some((k) => has(body, k));
  if (existing.status === "paid" && touchesMoney) {
    return c.json({ error: "This invoice is paid and already in the P&L. Mark it unpaid before changing amounts." }, 409);
  }

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
  if (has(body, "issue_date"))       patch.issueDate       = body.issue_date;
  if (has(body, "due_date"))         patch.dueDate         = body.due_date ?? null;
  if (has(body, "setup_fee"))        patch.setupFee        = body.setup_fee;
  if (has(body, "monthly_retainer")) patch.monthlyRetainer = body.monthly_retainer;
  if (has(body, "retainer_months"))  patch.retainerMonths  = body.retainer_months;
  if (has(body, "discount_type"))    patch.discountType    = body.discount_type;
  if (has(body, "discount_value"))   patch.discountValue   = body.discount_value;
  if (has(body, "tax_rate"))         patch.taxRate         = body.tax_rate;
  if (has(body, "notes"))            patch.notes           = body.notes ?? null;
  if (has(body, "terms"))            patch.terms           = body.terms ?? null;
  if (has(body, "recurring"))        patch.recurring       = body.recurring;
  if (has(body, "recurrence_months")) patch.recurrenceMonths = body.recurrence_months;
  if (has(body, "recurrence_total"))  patch.recurrenceTotal  = body.recurrence_total ?? null;

  const monthly = String(patch.monthlyRetainer ?? existing.monthlyRetainer);
  const months  = Number(patch.retainerMonths  ?? existing.retainerMonths);
  if (Number(monthly) > 0 && months < 1) {
    return c.json({ error: "A monthly retainer needs a term of at least 1 month" }, 400);
  }

  // Status changes go through the ledger-aware path, never a bare column write.
  const nextStatus = has(body, "status") ? body.status : undefined;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(invoices).set(patch as never).where(eq(invoices.id, id)).returning();
    if (body.items) {
      await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
      if (body.items.length) {
        await tx.insert(invoiceItems).values(itemRows(body.items).map((i) => ({ ...i, invoiceId: id })));
      }
    }
    return row;
  });

  if (nextStatus && nextStatus !== updated.status) {
    const applied = await applyInvoiceStatus(id, nextStatus, { userId: c.get("user").id });
    if (applied) return c.json(await present(applied.invoice));
  }

  return c.json(await present(updated));
});

// ── POST /invoices/:id/status ─────────────────────────────
// The only route that touches the ledger. Marking an already-paid invoice paid
// again is a no-op by construction — see services/invoice-payments.ts.
router.post("/:id/status", authMiddleware, async (c) => {
  const body = invoiceStatusSchema.parse(await c.req.json());
  const applied = await applyInvoiceStatus(c.req.param("id"), body.status, {
    paidOn: body.paid_on,
    userId: c.get("user").id,
  });
  if (!applied) return c.json({ error: "Invoice not found" }, 404);

  return c.json({
    ...(await present(applied.invoice)),
    ledger_action: applied.action,          // create | none | remove
  });
});

// ── POST /invoices/:id/next ───────────────────────────────
// Spawn the following month of a retainer series.
//
// Deliberately a rolling series rather than N pre-created drafts: an Egyptian
// retainer is usually open-ended and re-priced mid-term, and twelve stale
// drafts sitting in the list would be twelve wrong numbers to clean up when the
// client churns. One invoice at a time is always current.
router.post("/:id/next", authMiddleware, async (c) => {
  const user = c.get("user");
  const id   = c.req.param("id");

  const [source] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!source) return c.json({ error: "Invoice not found" }, 404);
  if (!source.recurring) return c.json({ error: "This invoice is not part of a recurring series" }, 409);

  // Idempotent: an invoice can only ever have one successor.
  const [child] = await db.select().from(invoices).where(eq(invoices.parentInvoiceId, id)).limit(1);
  if (child) {
    return c.json({ ...(await present(child)), already_existed: true });
  }

  if (source.recurrenceTotal && source.recurrenceIndex >= source.recurrenceTotal) {
    return c.json({ error: `The retainer term has finished (${source.recurrenceTotal} of ${source.recurrenceTotal} invoiced)` }, 409);
  }

  const items    = await invoiceItemsFor(id);
  const settings = await getCompanySettings();
  const step      = Math.max(1, source.recurrenceMonths);
  const issueDate = source.nextInvoiceDate ?? addCalendarMonths(source.issueDate, step);
  const dueDate   = addCalendarDays(issueDate, 14);
  const nextIndex = source.recurrenceIndex + 1;
  const hasMore   = !source.recurrenceTotal || nextIndex < source.recurrenceTotal;

  const created = await db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "invoice", settings.invoicePrefix);

    const [row] = await tx.insert(invoices).values({
      number,
      title:           source.title,
      clientId:        source.clientId,
      quotationId:     source.quotationId,
      clientName:      source.clientName,
      clientCompany:   source.clientCompany,
      clientEmail:     source.clientEmail,
      clientPhone:     source.clientPhone,
      clientAddress:   source.clientAddress,
      status:          "draft",
      issueDate,
      dueDate,
      currency:        source.currency,
      // The setup fee was a one-time charge on invoice #1 and must never repeat.
      setupFee:        "0.00",
      monthlyRetainer: source.monthlyRetainer,
      retainerMonths:  1,
      discountType:    source.discountType,
      discountValue:   source.discountValue,
      taxRate:         source.taxRate,
      notes:           source.notes,
      terms:           source.terms,
      recurring:        true,
      recurrenceMonths: step,
      recurrenceIndex:  nextIndex,
      recurrenceTotal:  source.recurrenceTotal,
      nextInvoiceDate:  hasMore ? addCalendarMonths(issueDate, step) : null,
      parentInvoiceId:  source.id,
      shareToken:       newShareToken(),
      createdBy:        user.id,
    }).returning();

    // Recurring lines carry over; one-off lines were billed on the first invoice.
    const carried = items.filter((i) => i.kind === "recurring");
    if (carried.length) {
      await tx.insert(invoiceItems).values(carried.map((i, position) => ({
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

  return c.json(await present(created), 201);
});

// ── POST /invoices/:id/rotate-share ───────────────────────
// Revoke a share link. See the equivalent on quotations for the reasoning; it
// matters slightly more here, because an invoice carries payment terms and the
// amount owed.
router.post("/:id/rotate-share", authMiddleware, async (c) => {
  const id = c.req.param("id");

  const [updated] = await db.update(invoices)
    .set({ shareToken: newShareToken(), updatedAt: new Date() })
    .where(eq(invoices.id, id))
    .returning();

  if (!updated) return c.json({ error: "Invoice not found" }, 404);

  return c.json({
    ok:        true,
    share_url: shareUrlFor("invoice", updated.shareToken),
    note:      "The previous link no longer works.",
  });
});

// ── POST /invoices/:id/duplicate ──────────────────────────
router.post("/:id/duplicate", authMiddleware, async (c) => {
  const user = c.get("user");
  const id   = c.req.param("id");

  const [source] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!source) return c.json({ error: "Invoice not found" }, 404);

  const items    = await invoiceItemsFor(id);
  const settings = await getCompanySettings();
  const issueDate = cairoToday();

  const copy = await db.transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, "invoice", settings.invoicePrefix);
    const [row] = await tx.insert(invoices).values({
      number,
      title:           source.title,
      clientId:        source.clientId,
      quotationId:     null,
      clientName:      source.clientName,
      clientCompany:   source.clientCompany,
      clientEmail:     source.clientEmail,
      clientPhone:     source.clientPhone,
      clientAddress:   source.clientAddress,
      status:          "draft",
      issueDate,
      dueDate:         addCalendarDays(issueDate, 14),
      currency:        source.currency,
      setupFee:        source.setupFee,
      monthlyRetainer: source.monthlyRetainer,
      retainerMonths:  source.retainerMonths,
      discountType:    source.discountType,
      discountValue:   source.discountValue,
      taxRate:         source.taxRate,
      notes:           source.notes,
      terms:           source.terms,
      // A copy is a standalone document — it must not inherit the original's
      // place in a series, or two invoices would claim the same month.
      recurring:        false,
      recurrenceMonths: 1,
      recurrenceIndex:  1,
      shareToken:       newShareToken(),
      createdBy:        user.id,
    }).returning();

    if (items.length) {
      await tx.insert(invoiceItems).values(items.map((i, position) => ({
        invoiceId: row.id, description: i.description, quantity: i.quantity,
        unitPrice: i.unitPrice, kind: i.kind, position,
      })));
    }
    return row;
  });

  return c.json(await present(copy), 201);
});

// ── GET /invoices/:id/pdf ─────────────────────────────────
router.get("/:id/pdf", authMiddleware, async (c) => {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, c.req.param("id"))).limit(1);
  if (!row) return c.json({ error: "Invoice not found" }, 404);

  const [items, settings] = await Promise.all([invoiceItemsFor(row.id), getCompanySettings()]);
  const pdf = await renderDocumentPdf(renderableInvoice(row, items, settings));

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${pdfFileName(row)}"`,
      "Content-Length":      String(pdf.length),
      "Cache-Control":       "no-store",
    },
  });
});

// ── DELETE /invoices/:id ──────────────────────────────────
router.delete("/:id", authMiddleware, async (c) => {
  const [existing] = await db.select().from(invoices).where(eq(invoices.id, c.req.param("id"))).limit(1);
  if (!existing) return c.json({ error: "Invoice not found" }, 404);

  // Deleting a paid invoice would orphan its income row in the P&L with nothing
  // left pointing at it. Void it instead — that removes the revenue and keeps
  // the numbered document, which is what an audit trail needs anyway.
  if (existing.transactionId) {
    return c.json({ error: "This invoice has revenue in the P&L. Mark it void first." }, 409);
  }

  await db.delete(invoices).where(eq(invoices.id, existing.id));
  return new Response(null, { status: 204 });
});

function has<T extends object>(obj: T, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export default router;
