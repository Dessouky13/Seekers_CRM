// Public share links — the only unauthenticated routes in this feature.
//
// Mounted at /q/:token and /i/:token, deliberately OUTSIDE the /quotations and
// /invoices prefixes that ADMIN_ONLY_MODULES guards, so "public" is a property
// of where the route lives rather than an exception carved into the guard.
//
// ── What a token exposes ──────────────────────────────────
// Exactly one document: its number, title, the recipient details as typed on
// it, the line items, the totals, the terms/notes, and the company's own
// branding and contact details. It does NOT expose internal ids, the author,
// the client record, any other document, or any endpoint that mutates
// something. Holding a token is read-only access to one page.
//
// The token is 256 bits of CSPRNG output, and both handlers 404 on a miss
// without saying whether the row exists — there is nothing to enumerate.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { quotations, invoices } from "../db/schema";
import {
  getCompanySettings, quotationItemsFor, invoiceItemsFor,
  renderableQuotation, renderableInvoice, pdfFileName,
  type RenderableDocument,
} from "../services/documents";
import { renderDocumentPdf } from "../services/document-pdf";
import { renderSharePage } from "../services/document-html";
import { sharePdfUrlFor } from "../services/document-links";
import type { AppEnv } from "../types";

const notFoundPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link not found</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#1E1B4B; color:#E0E7FF;
         font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  div { text-align:center; padding:32px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0; color:#A5B4FC; font-size:14px; }
</style></head>
<body><div>
  <h1>This link is no longer available</h1>
  <p>Ask whoever sent it for an up-to-date link.</p>
</div></body></html>`;

function htmlNotFound() {
  return new Response(notFoundPage, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}

/** Neither the page nor the PDF should ever be indexed or cached by a proxy. */
const PAGE_HEADERS = {
  "Content-Type":  "text/html; charset=utf-8",
  "X-Robots-Tag":  "noindex, nofollow",
  "Cache-Control": "no-store",
  // The page is fully self-contained (inline CSS, data-URI logo), so it can
  // afford the strictest policy going.
  "Content-Security-Policy":
    "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; " +
    "script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
} as const;

async function loadQuotation(token: string): Promise<RenderableDocument | null> {
  const [row] = await db.select().from(quotations).where(eq(quotations.shareToken, token)).limit(1);
  if (!row) return null;
  const [items, settings] = await Promise.all([quotationItemsFor(row.id), getCompanySettings()]);
  const doc = renderableQuotation(row, items, settings);
  // The public reader is told the document is out of date, not what our
  // internal pipeline status is.
  if (doc.stamp === "DRAFT") doc.stamp = null;
  return doc;
}

async function loadInvoice(token: string): Promise<RenderableDocument | null> {
  const [row] = await db.select().from(invoices).where(eq(invoices.shareToken, token)).limit(1);
  if (!row) return null;
  const [items, settings] = await Promise.all([invoiceItemsFor(row.id), getCompanySettings()]);
  const doc = renderableInvoice(row, items, settings);
  if (doc.stamp === "DRAFT") doc.stamp = null;
  return doc;
}

function pdfResponse(pdf: Buffer, name: string) {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      // `inline` so a phone opens it in the browser's viewer instead of a
      // silent download into a folder the recipient will never find.
      "Content-Disposition": `inline; filename="${name}"`,
      "Content-Length":      String(pdf.length),
      "X-Robots-Tag":        "noindex, nofollow",
      "Cache-Control":       "no-store",
    },
  });
}

// ── Quotations ────────────────────────────────────────────
export const publicQuotations = new Hono<AppEnv>();

publicQuotations.get("/:token", async (c) => {
  const doc = await loadQuotation(c.req.param("token"));
  if (!doc) return htmlNotFound();
  return new Response(
    renderSharePage(doc, sharePdfUrlFor("quotation", c.req.param("token"))),
    { headers: PAGE_HEADERS },
  );
});

publicQuotations.get("/:token/pdf", async (c) => {
  const doc = await loadQuotation(c.req.param("token"));
  if (!doc) return htmlNotFound();
  return pdfResponse(await renderDocumentPdf(doc), pdfFileName(doc));
});

// ── Invoices ──────────────────────────────────────────────
export const publicInvoices = new Hono<AppEnv>();

publicInvoices.get("/:token", async (c) => {
  const doc = await loadInvoice(c.req.param("token"));
  if (!doc) return htmlNotFound();
  return new Response(
    renderSharePage(doc, sharePdfUrlFor("invoice", c.req.param("token"))),
    { headers: PAGE_HEADERS },
  );
});

publicInvoices.get("/:token/pdf", async (c) => {
  const doc = await loadInvoice(c.req.param("token"));
  if (!doc) return htmlNotFound();
  return pdfResponse(await renderDocumentPdf(doc), pdfFileName(doc));
});
