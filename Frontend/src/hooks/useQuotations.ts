import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, API_BASE } from "@/lib/api";
import { getStoredToken } from "@/lib/auth";
import type {
  ApiQuotation, ApiInvoice, ApiCompanySettings,
  QuotationStatus, InvoiceStatus,
} from "@/lib/types";

// Marking an invoice paid writes a row into `transactions`, so anything that
// reads the P&L has to be refetched — otherwise Finance and the Dashboard keep
// showing the pre-payment numbers until the next hard reload.
const FINANCE_KEYS = [
  "transactions", "finance-summary", "finance-monthly",
  "finance-category-totals", "dashboard-summary", "clients",
];

function invalidateDocuments(qc: ReturnType<typeof useQueryClient>, finance = false) {
  qc.invalidateQueries({ queryKey: ["quotations"] });
  qc.invalidateQueries({ queryKey: ["invoices"] });
  if (finance) for (const key of FINANCE_KEYS) qc.invalidateQueries({ queryKey: [key] });
}

// ── Quotations ────────────────────────────────────────────

export function useQuotations(params: { status?: string; search?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.search) qs.set("search", params.search);
  const query = qs.toString();

  return useQuery<ApiQuotation[]>({
    queryKey: ["quotations", params],
    queryFn:  () => apiFetch(`/quotations${query ? `?${query}` : ""}`),
  });
}

export function useCreateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<ApiQuotation>("/quotations", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

export function useUpdateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiFetch<ApiQuotation>(`/quotations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

export function useQuotationStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: QuotationStatus }) =>
      apiFetch<ApiQuotation>(`/quotations/${id}/status`, {
        method: "POST", body: JSON.stringify({ status }),
      }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

export function useDuplicateQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ApiQuotation>(`/quotations/${id}/duplicate`, { method: "POST" }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

export function useDeleteQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/quotations/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

export function useConvertQuotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ApiInvoice>(`/quotations/${id}/convert`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

// ── Invoices ──────────────────────────────────────────────

export function useInvoices(params: { status?: string; search?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.search) qs.set("search", params.search);
  const query = qs.toString();

  return useQuery<ApiInvoice[]>({
    queryKey: ["invoices", params],
    queryFn:  () => apiFetch(`/invoices${query ? `?${query}` : ""}`),
  });
}

export function useInvoiceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, paid_on }: { id: string; status: InvoiceStatus; paid_on?: string }) =>
      apiFetch<ApiInvoice>(`/invoices/${id}/status`, {
        method: "POST", body: JSON.stringify({ status, ...(paid_on ? { paid_on } : {}) }),
      }),
    // A status change can add or remove a P&L row, so the finance caches go too.
    onSuccess: () => invalidateDocuments(qc, true),
  });
}

export function useNextInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ApiInvoice>(`/invoices/${id}/next`, { method: "POST" }),
    onSuccess: () => invalidateDocuments(qc),
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch(`/invoices/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateDocuments(qc, true),
  });
}

// ── Company settings (branding on every document) ─────────

export function useCompanySettings() {
  return useQuery<ApiCompanySettings>({
    queryKey: ["company-settings"],
    queryFn:  () => apiFetch("/company-settings"),
    staleTime: 60_000,
  });
}

export function useUpdateCompanySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<ApiCompanySettings>("/company-settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["company-settings"] });
      // Branding is baked into every rendered document.
      invalidateDocuments(qc);
    },
  });
}

// ── PDF download ──────────────────────────────────────────

/**
 * The PDF endpoints are behind the same Bearer auth as everything else, so a
 * plain `<a href>` would hit them unauthenticated and bounce to the login page.
 * Fetch with the token, then hand the browser a blob URL.
 */
export async function downloadDocumentPdf(
  kind: "quotations" | "invoices",
  id: string,
  fileName: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/${kind}/${id}/pdf`, {
    headers: { Authorization: `Bearer ${getStoredToken() ?? ""}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `Could not generate the PDF (HTTP ${res.status})`);
  }

  const url  = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in Safari; one tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
