/**
 * Public share links.
 *
 * The share page is served by the API, not the SPA: it has to work for someone
 * with no account and no session, and putting it on the API means one origin
 * owns both the page and the PDF behind it. `API_BASE_URL` is already set on the
 * VPS for file serving, so nothing new has to be configured.
 */
import type { DocumentKind } from "./documents";

/** `/q/:token` for quotations, `/i/:token` for invoices. */
export function sharePathFor(kind: DocumentKind, token: string): string {
  return `${kind === "quotation" ? "/q" : "/i"}/${token}`;
}

function apiBase(): string {
  return (process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, "");
}

export function shareUrlFor(kind: DocumentKind, token: string): string {
  return `${apiBase()}${sharePathFor(kind, token)}`;
}

export function sharePdfUrlFor(kind: DocumentKind, token: string): string {
  return `${shareUrlFor(kind, token)}/pdf`;
}
