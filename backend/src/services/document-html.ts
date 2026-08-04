/**
 * The public share page — what a client sees when they open a share link.
 *
 * Server-rendered, self-contained HTML: no build step, no frontend route, and
 * no auth. It works when pasted into WhatsApp, and its "Download PDF" button
 * points at the same token, so the client never needs an account.
 *
 * Everything here is escaped. The values are typed by our own users, but a
 * quotation is a document we hand to a third party, so a stray `<script>` in a
 * line-item description must render as text.
 */
import { SEEKERS_LOGO_DATA_URI, SEEKERS_LOGO_BOX } from "./brand-logo";
import type { RenderableDocument } from "./documents";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaped, with newlines preserved as <br>. */
function escapeMultiline(value: unknown): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function safeColor(value: string | null | undefined, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : fallback;
}

/** A logo the settings row overrides must still be safe to put in src="". */
function safeLogo(value: string | null | undefined): string {
  if (typeof value === "string" && /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value.trim())) {
    return value.trim();
  }
  if (typeof value === "string" && /^https:\/\/[^\s"'<>]+$/.test(value.trim())) {
    return value.trim();
  }
  return SEEKERS_LOGO_DATA_URI;
}

export function renderSharePage(doc: RenderableDocument, pdfUrl: string): string {
  const dark      = safeColor(doc.company.brandDark, "#1E1B4B");
  const primary   = safeColor(doc.company.brandPrimary, "#7C3AED");
  const secondary = safeColor(doc.company.brandSecondary, "#3730A3");
  const logo      = safeLogo(doc.company.logo);
  // The bundled mark is a wordmark floating in a 1080x1080 transparent canvas,
  // so rendering it at a sane height makes the artwork about one pixel tall.
  // It gets the same bounding-box crop the PDF applies. An uploaded logo is
  // shown as-is — we know nothing about its padding.
  const usingBundledLogo = logo === SEEKERS_LOGO_DATA_URI;

  const contact = [
    doc.company.address,
    doc.company.email,
    doc.company.phone,
    doc.company.website,
  ].filter(Boolean).map((v) => escapeHtml(v)).join(" &nbsp;·&nbsp; ");

  const clientLines = [
    doc.client.company || doc.client.name,
    doc.client.company && doc.client.name ? doc.client.name : null,
    doc.client.address,
    doc.client.email,
    doc.client.phone,
  ].filter(Boolean) as string[];

  const rows = doc.lines.map((l) => `
        <tr>
          <td>
            <div class="desc">${escapeHtml(l.description)}</div>
            ${l.detail ? `<div class="detail">${escapeHtml(l.detail)}</div>` : ""}
          </td>
          <td class="num">${escapeHtml(l.quantity)}</td>
          <td class="num">${escapeHtml(l.unitPrice)}</td>
          <td class="num strong">${escapeHtml(l.amount)}</td>
        </tr>`).join("");

  const finePrint = [
    { heading: "Notes", body: doc.notes },
    { heading: doc.kind === "quotation" ? "Terms" : "Payment terms", body: doc.terms },
    { heading: "Payment details", body: doc.bankDetails },
  ]
    .filter((b) => b.body && b.body.trim())
    .map((b) => `
      <section class="fine">
        <h3>${escapeHtml(b.heading)}</h3>
        <p>${escapeMultiline(b.body)}</p>
      </section>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(doc.heading)} ${escapeHtml(doc.number)} — ${escapeHtml(doc.company.companyName)}</title>
<style>
  :root {
    --dark: ${dark};
    --primary: ${primary};
    --secondary: ${secondary};
    --ink: #111827;
    --muted: #6b7280;
    --rule: #e5e7eb;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #f3f4f6; color: var(--ink);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  .sheet { max-width: 820px; margin: 0 auto; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  header { background: var(--dark); color: #fff; padding: 28px 28px 24px; position: relative; }
  header::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 4px;
                  background: linear-gradient(90deg, var(--primary), var(--secondary)); }
  .brand { display: flex; flex-wrap: wrap; gap: 18px; justify-content: space-between; align-items: flex-start; }
  .brand img { max-height: 34px; max-width: 200px; width: auto; display: block; }
  /* Bounding-box crop for the bundled wordmark — see usingBundledLogo above.
     --k is rendered size per source pixel; the figures come from
     SEEKERS_LOGO_BOX, so the artwork is described in exactly one place. */
  .logo-crop { --logo-w: 150px; --k: calc(var(--logo-w) / ${SEEKERS_LOGO_BOX.w});
               position: relative; overflow: hidden;
               width: var(--logo-w); height: calc(${SEEKERS_LOGO_BOX.h} * var(--k)); }
  .logo-crop img { position: absolute; max-height: none; max-width: none;
                   width: calc(${SEEKERS_LOGO_BOX.canvas} * var(--k));
                   left: calc(${-SEEKERS_LOGO_BOX.x} * var(--k));
                   top: calc(${-SEEKERS_LOGO_BOX.y} * var(--k)); }
  .tagline { color: #a5b4fc; font-size: 12px; margin-top: 10px; }
  .contact { color: #c7d2fe; font-size: 11px; margin-top: 6px; line-height: 1.7; }
  .doctype { text-align: left; }
  .doctype h1 { margin: 0; font-size: 26px; letter-spacing: 2px; }
  .doctype .num { color: #c4b5fd; font-weight: 700; font-size: 14px; margin-top: 2px; }
  .meta { margin-top: 10px; font-size: 12px; color: #a5b4fc; }
  .meta div { margin-top: 3px; }
  .meta b { color: #fff; font-weight: 600; margin-left: 6px; }
  main { padding: 26px 28px 34px; }
  .label { font-size: 11px; letter-spacing: 1.2px; font-weight: 700; color: var(--primary); text-transform: uppercase; }
  .client { margin: 8px 0 26px; }
  .client .who { font-size: 18px; font-weight: 700; }
  .client div { color: var(--muted); font-size: 13px; }
  h2.title { font-size: 17px; margin: 0 0 16px; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { width: 100%; border-collapse: collapse; min-width: 460px; }
  thead th { background: #f5f3ff; color: var(--secondary); font-size: 11px; letter-spacing: .8px;
             text-transform: uppercase; text-align: left; padding: 9px 10px; border-bottom: 2px solid var(--primary); }
  thead th.num, td.num { text-align: right; }
  tbody td { padding: 11px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; font-size: 14px; }
  tbody tr:nth-child(even) td { background: #fafafb; }
  .desc { font-weight: 500; }
  .detail { color: var(--primary); font-size: 11.5px; margin-top: 2px; }
  td.strong { font-weight: 700; white-space: nowrap; }
  td.num { white-space: nowrap; color: var(--muted); }
  .totals { margin: 22px 0 0 auto; max-width: 320px; }
  .totals .row { display: flex; justify-content: space-between; font-size: 14px; padding: 4px 0; color: var(--muted); }
  .totals .row span:last-child { color: var(--ink); }
  .grand { display: flex; justify-content: space-between; align-items: center; gap: 12px;
           background: var(--dark); color: #fff; border-radius: 8px; padding: 14px 16px; margin-top: 10px; }
  .grand small { color: #c4b5fd; font-size: 11px; letter-spacing: 1.2px; font-weight: 700; }
  .grand b { font-size: 19px; }
  .per-month { text-align: right; font-size: 11.5px; color: var(--muted); margin-top: 8px; }
  .fine { margin-top: 24px; border-left: 3px solid var(--primary); padding-left: 12px; }
  .fine h3 { margin: 0 0 4px; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--secondary); }
  .fine p { margin: 0; color: var(--muted); font-size: 13px; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 28px 0 0; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
         min-height: 44px; padding: 0 20px; border-radius: 8px; font-weight: 600; font-size: 14px;
         text-decoration: none; border: 1px solid transparent; }
  .btn-primary { background: var(--primary); color: #fff; }
  .btn-ghost { border-color: var(--rule); color: var(--ink); }
  footer { padding: 18px 28px 30px; color: var(--muted); font-size: 11.5px; border-top: 1px solid var(--rule); }
  @media (max-width: 560px) {
    header, main { padding-left: 18px; padding-right: 18px; }
    footer { padding-left: 18px; padding-right: 18px; }
    .doctype h1 { font-size: 22px; }
    .totals { max-width: none; }
  }
  @media print {
    body { background: #fff; }
    .actions { display: none; }
    .sheet { box-shadow: none; max-width: none; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <header>
      <div class="brand">
        <div>
          ${usingBundledLogo
            ? `<div class="logo-crop"><img src="${logo}" alt="${escapeHtml(doc.company.companyName)}"></div>`
            : `<img src="${logo}" alt="${escapeHtml(doc.company.companyName)}">`}
          ${doc.company.tagline ? `<div class="tagline">${escapeHtml(doc.company.tagline)}</div>` : ""}
          <div class="contact">${contact}</div>
        </div>
        <div class="doctype">
          <h1>${escapeHtml(doc.heading)}</h1>
          <div class="num">${escapeHtml(doc.number)}</div>
          <div class="meta">
            ${doc.meta.map((m) => `<div>${escapeHtml(m.label)}<b>${escapeHtml(m.value)}</b></div>`).join("")}
          </div>
        </div>
      </div>
    </header>

    <main>
      <div class="label">Billed to</div>
      <div class="client">
        <div class="who">${escapeHtml(clientLines[0] ?? "—")}</div>
        ${clientLines.slice(1).map((l) => `<div>${escapeHtml(l)}</div>`).join("")}
      </div>

      ${doc.title ? `<h2 class="title">${escapeHtml(doc.title)}</h2>` : ""}

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th class="num">Qty</th>
              <th class="num">Unit price (${escapeHtml(doc.currency)})</th>
              <th class="num">Amount</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="4" style="color:var(--muted)">No line items.</td></tr>`}</tbody>
        </table>
      </div>

      <div class="totals">
        <div class="row"><span>Subtotal</span><span>${escapeHtml(doc.money.subtotal)}</span></div>
        ${Number(doc.totals.discount) > 0
          ? `<div class="row"><span>${escapeHtml(doc.discountLabel)}</span><span>− ${escapeHtml(doc.money.discount)}</span></div>` : ""}
        ${Number(doc.totals.tax) > 0
          ? `<div class="row"><span>${escapeHtml(doc.taxLabel)}</span><span>${escapeHtml(doc.money.tax)}</span></div>` : ""}
        <div class="grand"><small>TOTAL</small><b>${escapeHtml(doc.money.total)}</b></div>
        ${doc.money.monthly && doc.retainerMonths > 0
          ? `<div class="per-month">Includes ${escapeHtml(doc.money.monthly)} per month for ${doc.retainerMonths} month${doc.retainerMonths === 1 ? "" : "s"}.</div>`
          : ""}
      </div>

      ${finePrint}

      <div class="actions">
        <a class="btn btn-primary" href="${escapeHtml(pdfUrl)}">Download PDF</a>
        <a class="btn btn-ghost" href="#" onclick="window.print();return false;">Print</a>
      </div>
    </main>

    <footer>${escapeMultiline(doc.footer ?? doc.company.companyName)}</footer>
  </div>
</body>
</html>`;
}
