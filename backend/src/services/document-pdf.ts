/**
 * Server-rendered PDF for quotations and invoices.
 *
 * ── Why PDFKit and not a headless browser ─────────────────
 * The owner asked for a downloadable, shareable file, which means the bytes
 * have to exist on the server — "print this page to PDF" produces a different
 * document on every machine and cannot be attached to an email. Puppeteer would
 * do it, but a Chromium install is ~400 MB of RAM and ~300 MB of disk on a
 * 2-vCPU VPS, and deploy.sh installs no browser dependencies at all, so the
 * first deploy would simply break. PDFKit is pure JS, has no native build step,
 * streams, and draws PNG with alpha directly. One dependency, no new deploy
 * step.
 *
 * Layout is hand-placed rather than flowed: an A4 business document has a fixed
 * skeleton, and explicit coordinates make the page-break logic (which has to
 * repeat the table header) obvious.
 */
import PDFDocument from "pdfkit";
import { SEEKERS_LOGO_PNG, SEEKERS_LOGO_BOX } from "./brand-logo";
import type { RenderableDocument } from "./documents";

// A4 in PostScript points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M      = 48;                    // page margin
const CONTENT_W = PAGE_W - M * 2;     // 499.28

const HEADER_H  = 148;                // brand band on page 1
const FOOTER_Y  = PAGE_H - 54;
const BODY_END  = FOOTER_Y - 18;      // last y a row may occupy

// Column x positions (right edges for the numeric columns).
const COL_DESC_X   = M;
const COL_DESC_W   = 236;
const COL_QTY_R    = M + 300;
const COL_UNIT_R   = M + 396;
const COL_AMOUNT_R = PAGE_W - M;

/** Where the artwork sits inside the transparent canvas — see brand-logo.ts. */
const LOGO = SEEKERS_LOGO_BOX;

const INK        = "#111827";
const INK_MUTED  = "#6B7280";
const RULE       = "#E5E7EB";
const ZEBRA      = "#FAFAFB";

interface Palette { dark: string; primary: string; secondary: string }

/** Falls back to the Seekers palette if Settings holds something unusable. */
function palette(doc: RenderableDocument): Palette {
  const hex = (v: string | null | undefined, fallback: string) =>
    (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : fallback);
  return {
    dark:      hex(doc.company.brandDark,      "#1E1B4B"),
    primary:   hex(doc.company.brandPrimary,   "#7C3AED"),
    secondary: hex(doc.company.brandSecondary, "#3730A3"),
  };
}

export function renderDocumentPdf(doc: RenderableDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // bufferPages so "Page 1 of 3" can be written once the page count is known.
    const pdf = new PDFDocument({ size: "A4", margin: 0, bufferPages: true, info: {
      Title:    `${doc.heading} ${doc.number}`,
      Author:   doc.company.companyName,
      Subject:  doc.title ?? `${doc.heading} ${doc.number}`,
      Creator:  "Seekers AI Agency OS",
    } });

    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    try {
      draw(pdf, doc);
      pdf.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

type Pdf = PDFKit.PDFDocument;

function draw(pdf: Pdf, doc: RenderableDocument) {
  const c = palette(doc);

  drawHeaderBand(pdf, doc, c);
  let y = HEADER_H + 26;

  y = drawParties(pdf, doc, c, y);

  if (doc.title) {
    pdf.font("Helvetica-Bold").fontSize(13).fillColor(INK)
       .text(doc.title, M, y, { width: CONTENT_W });
    y = pdf.y + 14;
  }

  y = drawItems(pdf, doc, c, y);
  y = drawTotals(pdf, doc, c, y);
  y = drawFinePrint(pdf, doc, c, y);

  drawStamp(pdf, doc, c);
  drawFooters(pdf, doc, c);
}

// ── Header ────────────────────────────────────────────────

function drawHeaderBand(pdf: Pdf, doc: RenderableDocument, c: Palette) {
  pdf.rect(0, 0, PAGE_W, HEADER_H).fill(c.dark);

  // Gradient hairline along the bottom edge — the one flourish on the page.
  const grad = pdf.linearGradient(0, 0, PAGE_W, 0);
  grad.stop(0, c.primary).stop(1, c.secondary);
  pdf.rect(0, HEADER_H - 4, PAGE_W, 4).fill(grad);

  drawLogo(pdf, doc, M, 38, 148);

  const company = doc.company;
  let y = 74;
  if (company.tagline) {
    pdf.font("Helvetica").fontSize(8).fillColor("#A5B4FC")
       .text(company.tagline, M, y, { width: 260 });
    y = pdf.y + 5;
  }

  const contact = [
    company.address,
    [company.email, company.phone].filter(Boolean).join("  ·  ") || null,
    company.website,
    company.taxNumber ? `Tax No. ${company.taxNumber}` : null,
    company.registrationNumber ? `Reg. No. ${company.registrationNumber}` : null,
  ].filter(Boolean) as string[];

  pdf.font("Helvetica").fontSize(7.5).fillColor("#C7D2FE");
  for (const line of contact) {
    if (y > HEADER_H - 16) break;
    pdf.text(line, M, y, { width: 280, lineBreak: false });
    y += 10;
  }

  // Right block: document type + number.
  const rightW = 220;
  const rightX = PAGE_W - M - rightW;
  pdf.font("Helvetica-Bold").fontSize(24).fillColor("#FFFFFF")
     .text(doc.heading, rightX, 40, { width: rightW, align: "right", characterSpacing: 1.5 });
  pdf.font("Helvetica-Bold").fontSize(11).fillColor("#C4B5FD")
     .text(doc.number, rightX, 72, { width: rightW, align: "right" });

  // Header meta (Issued / Valid until / Due), right-aligned under the number.
  let my = 92;
  for (const m of doc.meta) {
    pdf.font("Helvetica").fontSize(7.5).fillColor("#A5B4FC")
       .text(`${m.label.toUpperCase()}`, rightX, my, { width: rightW - 92, align: "right", lineBreak: false });
    pdf.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF")
       .text(m.value, rightX + rightW - 88, my - 1, { width: 88, align: "right", lineBreak: false });
    my += 13;
  }
}

/**
 * The bundled logo PNG is mostly transparent padding, so it is drawn oversized
 * behind a clip window sized to the artwork's real bounding box. Cropping this
 * way keeps the shipped asset byte-identical to `Seeekers_logo_white.png`.
 *
 * A logo uploaded in Settings is drawn as-is, fitted into the same slot — we
 * know nothing about its padding, so cropping it would be guesswork.
 */
function drawLogo(pdf: Pdf, doc: RenderableDocument, x: number, y: number, targetW: number) {
  const custom = decodeLogo(doc.company.logo);
  if (custom) {
    // No align/valign: PDFKit's typings only allow right/center there, and the
    // default for a `fit` box is already top-left, which is what we want.
    pdf.image(custom, x, y, { fit: [targetW, 40] });
    return;
  }

  const scale   = targetW / LOGO.w;           // points per source pixel
  const targetH = LOGO.h * scale;
  pdf.save();
  pdf.rect(x, y, targetW, targetH).clip();
  pdf.image(SEEKERS_LOGO_PNG, x - LOGO.x * scale, y - LOGO.y * scale, { width: LOGO.canvas * scale });
  pdf.restore();
}

/**
 * PDFKit can only embed PNG and JPEG, and only from bytes. An https logo URL is
 * fine on the HTML share page but cannot be fetched here (a PDF render must not
 * make a network call), so both fall back to the bundled mark.
 */
function decodeLogo(logo: string | null): Buffer | null {
  if (!logo) return null;
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(logo.trim());
  if (!match) return null;
  try {
    return Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
}

// ── Billed-to / meta strip ────────────────────────────────

function drawParties(pdf: Pdf, doc: RenderableDocument, c: Palette, top: number): number {
  pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(c.primary)
     .text("BILLED TO", M, top, { characterSpacing: 1.2 });

  let y = top + 14;
  const { client } = doc;

  const headline = client.company || client.name || "—";
  pdf.font("Helvetica-Bold").fontSize(12).fillColor(INK)
     .text(headline, M, y, { width: 300 });
  y = pdf.y + 2;

  const rest = [
    client.company && client.name ? client.name : null,
    client.address,
    client.email,
    client.phone,
  ].filter(Boolean) as string[];

  pdf.font("Helvetica").fontSize(9).fillColor(INK_MUTED);
  for (const line of rest) {
    pdf.text(line, M, y, { width: 300 });
    y = pdf.y + 1;
  }

  return Math.max(y + 22, top + 78);
}

// ── Items table ───────────────────────────────────────────

function drawTableHeader(pdf: Pdf, doc: RenderableDocument, c: Palette, y: number): number {
  pdf.rect(M, y, CONTENT_W, 24).fill("#F5F3FF");
  pdf.rect(M, y + 23, CONTENT_W, 1).fill(c.primary);

  const ty = y + 8.5;
  pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(c.secondary);
  pdf.text("DESCRIPTION", COL_DESC_X + 10, ty, { width: COL_DESC_W, characterSpacing: 0.8, lineBreak: false });
  pdf.text("QTY",         COL_QTY_R - 60, ty, { width: 60, align: "right", characterSpacing: 0.8, lineBreak: false });
  // The currency is stated once, here, instead of on every cell in the column.
  pdf.text(`UNIT PRICE (${doc.currency})`, COL_UNIT_R - 110, ty, { width: 110, align: "right", characterSpacing: 0.8, lineBreak: false });
  pdf.text("AMOUNT",      COL_AMOUNT_R - 100 - 10, ty, { width: 100, align: "right", characterSpacing: 0.8, lineBreak: false });

  return y + 24;
}

function drawItems(pdf: Pdf, doc: RenderableDocument, c: Palette, top: number): number {
  let y = drawTableHeader(pdf, doc, c, top);

  if (doc.lines.length === 0) {
    pdf.font("Helvetica-Oblique").fontSize(9).fillColor(INK_MUTED)
       .text("No line items.", COL_DESC_X + 10, y + 12, { width: CONTENT_W - 20 });
    return y + 40;
  }

  pdf.font("Helvetica").fontSize(9.5);

  doc.lines.forEach((line, i) => {
    const descH   = pdf.font("Helvetica").fontSize(9.5)
      .heightOfString(line.description, { width: COL_DESC_W });
    const detailH = line.detail
      ? pdf.font("Helvetica").fontSize(7.5).heightOfString(line.detail, { width: COL_DESC_W }) + 2
      : 0;
    const rowH = Math.max(28, descH + detailH + 14);

    if (y + rowH > BODY_END) {
      pdf.addPage();
      y = drawTableHeader(pdf, doc, c, M + 8);
    }

    if (i % 2 === 1) pdf.rect(M, y, CONTENT_W, rowH).fill(ZEBRA);

    const ty = y + 7;
    pdf.font("Helvetica").fontSize(9.5).fillColor(INK)
       .text(line.description, COL_DESC_X + 10, ty, { width: COL_DESC_W });

    if (line.detail) {
      pdf.font("Helvetica").fontSize(7.5).fillColor(c.primary)
         .text(line.detail, COL_DESC_X + 10, ty + descH + 1, { width: COL_DESC_W });
    }

    pdf.font("Helvetica").fontSize(9.5).fillColor(INK_MUTED)
       .text(line.quantity, COL_QTY_R - 60, ty, { width: 60, align: "right", lineBreak: false });
    pdf.text(line.unitPrice, COL_UNIT_R - 90, ty, { width: 90, align: "right", lineBreak: false });
    pdf.font("Helvetica-Bold").fillColor(INK)
       .text(line.amount, COL_AMOUNT_R - 110, ty, { width: 100, align: "right", lineBreak: false });

    y += rowH;
    pdf.rect(M, y, CONTENT_W, 0.5).fill(RULE);
  });

  return y + 18;
}

// ── Totals ────────────────────────────────────────────────

function drawTotals(pdf: Pdf, doc: RenderableDocument, c: Palette, top: number): number {
  const boxW = 250;
  const boxX = PAGE_W - M - boxW;

  const rows: { label: string; value: string; }[] = [
    { label: "Subtotal", value: doc.money.subtotal },
  ];
  if (Number(doc.totals.discount) > 0) {
    // ASCII hyphen: Helvetica's WinAnsi encoding has no U+2212 minus sign, and
    // a typographic minus came out of the renderer as a stray double quote.
    rows.push({ label: doc.discountLabel, value: `- ${doc.money.discount}` });
  }
  if (Number(doc.totals.tax) > 0) {
    rows.push({ label: doc.taxLabel, value: doc.money.tax });
  }

  const needed = rows.length * 17 + 52 + (doc.money.monthly ? 16 : 0);
  let y = top;
  if (y + needed > BODY_END) {
    pdf.addPage();
    y = M + 8;
  }

  pdf.font("Helvetica").fontSize(9.5);
  for (const r of rows) {
    pdf.fillColor(INK_MUTED).text(r.label, boxX, y, { width: boxW - 120, lineBreak: false });
    pdf.fillColor(INK).text(r.value, boxX + boxW - 120, y, { width: 120, align: "right", lineBreak: false });
    y += 17;
  }

  y += 4;
  pdf.roundedRect(boxX, y, boxW, 38, 6).fill(c.dark);
  pdf.font("Helvetica-Bold").fontSize(9).fillColor("#C4B5FD")
     .text("TOTAL", boxX + 14, y + 14, { characterSpacing: 1.2, lineBreak: false });
  pdf.font("Helvetica-Bold").fontSize(14).fillColor("#FFFFFF")
     .text(doc.money.total, boxX + 70, y + 11, { width: boxW - 84, align: "right", lineBreak: false });
  y += 38;

  if (doc.money.monthly && doc.retainerMonths > 0) {
    pdf.font("Helvetica").fontSize(7.5).fillColor(INK_MUTED)
       .text(
         `Includes ${doc.money.monthly} per month for ${doc.retainerMonths} month${doc.retainerMonths === 1 ? "" : "s"}.`,
         boxX, y + 5, { width: boxW, align: "right" },
       );
    y += 16;
  }

  return y + 24;
}

// ── Terms, notes, bank details ────────────────────────────

function drawFinePrint(pdf: Pdf, doc: RenderableDocument, c: Palette, top: number): number {
  const blocks = [
    { heading: "NOTES",         body: doc.notes },
    { heading: doc.kind === "quotation" ? "TERMS" : "PAYMENT TERMS", body: doc.terms },
    { heading: "PAYMENT DETAILS", body: doc.bankDetails },
  ].filter((b) => b.body && b.body.trim().length > 0) as { heading: string; body: string }[];

  let y = top;
  for (const block of blocks) {
    const bodyH = pdf.font("Helvetica").fontSize(8.5).heightOfString(block.body, { width: CONTENT_W - 24 });
    const blockH = bodyH + 30;

    if (y + blockH > BODY_END) {
      pdf.addPage();
      y = M + 8;
    }

    pdf.rect(M, y, 3, blockH - 8).fill(c.primary);
    pdf.font("Helvetica-Bold").fontSize(7.5).fillColor(c.secondary)
       .text(block.heading, M + 12, y + 2, { characterSpacing: 1 });
    pdf.font("Helvetica").fontSize(8.5).fillColor(INK_MUTED)
       .text(block.body, M + 12, y + 15, { width: CONTENT_W - 24, lineGap: 1.5 });

    y += blockH + 6;
  }

  return y;
}

// ── Status stamp ──────────────────────────────────────────

/** A faint diagonal watermark so a DRAFT is never mistaken for a live document. */
function drawStamp(pdf: Pdf, doc: RenderableDocument, c: Palette) {
  if (!doc.stamp) return;

  const colour = doc.stamp === "PAID"     ? "#059669"
               : doc.stamp === "ACCEPTED" ? "#059669"
               : doc.stamp === "REJECTED" ? "#DC2626"
               : doc.stamp === "VOID"     ? "#DC2626"
               : c.secondary;

  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    pdf.save();
    pdf.rotate(-24, { origin: [PAGE_W / 2, PAGE_H / 2] });
    pdf.fillOpacity(0.07)
       .font("Helvetica-Bold").fontSize(96).fillColor(colour)
       .text(doc.stamp, 0, PAGE_H / 2 - 60, { width: PAGE_W, align: "center", lineBreak: false });
    pdf.restore();
    pdf.fillOpacity(1);
  }
}

// ── Footer on every page ──────────────────────────────────

function drawFooters(pdf: Pdf, doc: RenderableDocument, c: Palette) {
  const range = pdf.bufferedPageRange();
  const total = range.count;

  for (let i = range.start; i < range.start + total; i++) {
    pdf.switchToPage(i);

    pdf.rect(M, FOOTER_Y, CONTENT_W, 0.5).fill(RULE);

    const left = doc.footer?.trim()
      || `${doc.company.companyName} · ${doc.number}`;
    pdf.font("Helvetica").fontSize(7).fillColor(INK_MUTED)
       .text(left, M, FOOTER_Y + 8, { width: CONTENT_W - 90, lineGap: 0.5, height: 22 });

    pdf.font("Helvetica").fontSize(7).fillColor(INK_MUTED)
       .text(`Page ${i - range.start + 1} of ${total}`, PAGE_W - M - 90, FOOTER_Y + 8,
             { width: 90, align: "right", lineBreak: false });

    // Thin brand tick in the bottom corner, tying the last page back to the header.
    pdf.rect(M, PAGE_H - 10, 34, 2.5).fill(c.primary);
  }
}
