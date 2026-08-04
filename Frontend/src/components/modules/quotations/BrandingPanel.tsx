/**
 * Branding and document defaults — the company details printed on every
 * quotation and invoice PDF.
 *
 * Everything here lives in the `company_settings` row, so changing the logo,
 * the colours or the payment terms takes effect on the next rendered document
 * without a deploy.
 */
import { useEffect, useState } from "react";
import { Building2, Save, Upload, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useCompanySettings, useUpdateCompanySettings } from "@/hooks/useQuotations";
import type { ApiCompanySettings } from "@/lib/types";

/** 500 kB, matching the API's ceiling. A logo does not need more, and every byte lands in every PDF. */
const MAX_LOGO_BYTES = 500 * 1024;

type Draft = {
  company_name: string; tagline: string; address: string; email: string; phone: string;
  website: string; tax_number: string; registration_number: string;
  brand_primary: string; brand_secondary: string; brand_dark: string;
  default_currency: string; default_tax_rate: string; default_payment_terms: string;
  quotation_prefix: string; invoice_prefix: string;
  quotation_footer: string; invoice_footer: string; bank_details: string;
};

function toDraft(s: ApiCompanySettings): Draft {
  return {
    company_name: s.companyName, tagline: s.tagline ?? "", address: s.address ?? "",
    email: s.email ?? "", phone: s.phone ?? "", website: s.website ?? "",
    tax_number: s.taxNumber ?? "", registration_number: s.registrationNumber ?? "",
    brand_primary: s.brandPrimary, brand_secondary: s.brandSecondary, brand_dark: s.brandDark,
    default_currency: s.defaultCurrency,
    default_tax_rate: String(Number(s.defaultTaxRate)),
    default_payment_terms: s.defaultPaymentTerms ?? "",
    quotation_prefix: s.quotationPrefix, invoice_prefix: s.invoicePrefix,
    quotation_footer: s.quotationFooter ?? "", invoice_footer: s.invoiceFooter ?? "",
    bank_details: s.bankDetails ?? "",
  };
}

export function BrandingPanel() {
  const { data: settings, isLoading } = useCompanySettings();
  const save = useUpdateCompanySettings();

  const [draft, setDraft]   = useState<Draft | null>(null);
  const [logo, setLogo]     = useState<string | null>(null);
  const [logoTouched, setLogoTouched] = useState(false);

  // Re-seed from the server whenever it changes, but never while a save is in
  // flight — that would stomp on what the user is still typing.
  useEffect(() => {
    if (settings && !save.isPending) {
      setDraft(toDraft(settings));
      setLogo(settings.logo);
      setLogoTouched(false);
    }
  }, [settings, save.isPending]);

  if (isLoading || !draft || !settings) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <p className="text-xs italic text-muted-foreground">Loading branding…</p>
      </div>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });

  const onLogoFile = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      toast.error("Use a PNG, JPEG, WebP or GIF");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(`That image is ${Math.round(file.size / 1024)} kB — keep it under 500 kB`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setLogo(String(reader.result)); setLogoTouched(true); };
    reader.onerror = () => toast.error("Could not read that file");
    reader.readAsDataURL(file);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      { ...draft, ...(logoTouched ? { logo } : {}) },
      {
        onSuccess: () => toast.success("Branding saved", {
          description: "The next quotation or invoice PDF uses it.",
        }),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-border bg-card p-6">
      <div>
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Document branding</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Printed on every quotation and invoice PDF, and on the share page a client opens.
        </p>
      </div>

      {/* ── Logo ── */}
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Logo</Label>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {/* Dark plate on purpose: the shipped Seekers mark is WHITE, so it is
              invisible on a light card — and the PDF header it sits on is dark. */}
          <div
            className="flex h-16 w-44 shrink-0 items-center justify-center rounded-md px-3"
            style={{ backgroundColor: draft.brand_dark }}
          >
            {logo
              ? <img src={logo} alt="Logo preview" className="max-h-12 max-w-full object-contain" />
              : <BundledMarkPreview src={settings.default_logo} />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label
              className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 text-sm font-medium transition-colors hover:bg-muted sm:h-9"
            >
              <Upload className="h-3.5 w-3.5" /> Upload
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={(e) => { onLogoFile(e.target.files?.[0]); e.target.value = ""; }}
              />
            </label>
            {logo && (
              <Button
                type="button" variant="ghost"
                className="h-11 gap-1.5 sm:h-9"
                onClick={() => { setLogo(null); setLogoTouched(true); }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Use the Seekers mark
              </Button>
            )}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The PDF header is a dark brand block, so upload a white or light logo. Under 500 kB — it is
          embedded in every document.
        </p>
      </div>

      {/* ── Company ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Company name" value={draft.company_name} onChange={(v) => set("company_name", v)} required />
        <Field label="Tagline"      value={draft.tagline}      onChange={(v) => set("tagline", v)} />
        <Field label="Address"      value={draft.address}      onChange={(v) => set("address", v)} />
        <Field label="Email"        value={draft.email}        onChange={(v) => set("email", v)} type="email" />
        <Field label="Phone"        value={draft.phone}        onChange={(v) => set("phone", v)} />
        <Field label="Website"      value={draft.website}      onChange={(v) => set("website", v)} />
        <Field label="Tax number"   value={draft.tax_number}   onChange={(v) => set("tax_number", v)} />
        <Field label="Commercial registration" value={draft.registration_number} onChange={(v) => set("registration_number", v)} />
      </div>

      {/* ── Colours ── */}
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brand colours</Label>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ColorField label="Primary"   value={draft.brand_primary}   onChange={(v) => set("brand_primary", v)} />
          <ColorField label="Secondary" value={draft.brand_secondary} onChange={(v) => set("brand_secondary", v)} />
          <ColorField label="Header"    value={draft.brand_dark}      onChange={(v) => set("brand_dark", v)} />
        </div>
      </div>

      {/* ── Document defaults ── */}
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Document defaults</Label>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Currency" value={draft.default_currency}
                 onChange={(v) => set("default_currency", v.toUpperCase().slice(0, 3))} />
          <Field label="Tax %"    value={draft.default_tax_rate} onChange={(v) => set("default_tax_rate", v)} inputMode="decimal" />
          <Field label="Quotation prefix" value={draft.quotation_prefix}
                 onChange={(v) => set("quotation_prefix", v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} />
          <Field label="Invoice prefix" value={draft.invoice_prefix}
                 onChange={(v) => set("invoice_prefix", v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Changing a prefix starts a fresh number sequence — existing documents keep their numbers.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <AreaField label="Default payment terms" value={draft.default_payment_terms}
                   onChange={(v) => set("default_payment_terms", v)} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AreaField label="Quotation footer" value={draft.quotation_footer} onChange={(v) => set("quotation_footer", v)} />
          <AreaField label="Invoice footer"   value={draft.invoice_footer}   onChange={(v) => set("invoice_footer", v)} />
        </div>
        <AreaField label="Payment details (bank / Instapay)" value={draft.bank_details}
                   onChange={(v) => set("bank_details", v)} />
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={save.isPending} className="h-11 gap-1.5 sm:h-9">
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {save.isPending ? "Saving…" : "Save branding"}
        </Button>
      </div>
    </form>
  );
}

/**
 * The bundled Seekers mark is a 534x50 wordmark floating in a 1080x1080
 * transparent canvas, so rendering it at a sane height makes the artwork about
 * one pixel tall. Cropped to its measured alpha bounding box, matching what the
 * PDF and the share page do (SEEKERS_LOGO_BOX in backend/src/services/brand-logo.ts).
 *
 * An uploaded logo is shown as-is: we know nothing about its padding.
 */
const MARK = { canvas: 1080, x: 273, y: 515, w: 534, h: 50 };

function BundledMarkPreview({ src }: { src: string }) {
  const width = 132;
  const k = width / MARK.w;   // rendered px per source px
  return (
    <div
      className="relative overflow-hidden"
      style={{ width, height: MARK.h * k }}
    >
      <img
        src={src}
        alt="Seekers logo preview"
        className="absolute max-w-none"
        style={{ width: MARK.canvas * k, left: -MARK.x * k, top: -MARK.y * k }}
      />
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required, inputMode }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; inputMode?: "decimal" | "numeric";
}) {
  const id = `brand-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} required={required} inputMode={inputMode}
             onChange={(e) => onChange(e.target.value)} className="mt-1 h-11 sm:h-10" />
    </div>
  );
}

function AreaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = `brand-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={2} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1" />
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = `brand-color-${label.toLowerCase()}`;
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1 flex gap-2">
        <input
          id={id}
          type="color"
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-label={`${label} colour picker`}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1 sm:h-10"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} hex value`}
          aria-invalid={!valid}
          className="h-11 flex-1 font-mono text-xs uppercase sm:h-10"
        />
      </div>
      {!valid && <p className="mt-1 text-[10px] text-destructive">Use a 6-digit hex, e.g. #7C3AED</p>}
    </div>
  );
}
