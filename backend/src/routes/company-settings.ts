// Company branding + document defaults — the single settings row behind every
// generated quotation and invoice.
//
// Admin-gated as a module (ADMIN_ONLY_MODULES in src/index.ts): the logo, the
// tax number and the bank details all appear on documents sent to clients.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { companySettings } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { updateCompanySettingsSchema } from "../utils/validators";
import { getCompanySettings } from "../services/documents";
import { SEEKERS_LOGO_DATA_URI } from "../services/brand-logo";
import type { AppEnv } from "../types";

const router = new Hono<AppEnv>();

/** `logo: null` means "use the bundled mark" — tell the UI what that looks like. */
function present(row: typeof companySettings.$inferSelect) {
  return { ...row, default_logo: SEEKERS_LOGO_DATA_URI };
}

router.get("/", authMiddleware, async (c) => c.json(present(await getCompanySettings())));

router.patch("/", authMiddleware, async (c) => {
  const body = updateCompanySettingsSchema.parse(await c.req.json());
  const current = await getCompanySettings();

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const set = (key: string, column: string, transform?: (v: unknown) => unknown) => {
    if (!Object.prototype.hasOwnProperty.call(body, key)) return;
    const value = (body as Record<string, unknown>)[key];
    patch[column] = transform ? transform(value) : value;
  };

  set("company_name",          "companyName");
  set("tagline",               "tagline",             (v) => v || null);
  set("address",               "address",             (v) => v || null);
  set("email",                 "email",               (v) => v || null);
  set("phone",                 "phone",               (v) => v || null);
  set("website",               "website",             (v) => v || null);
  set("tax_number",            "taxNumber",           (v) => v || null);
  set("registration_number",   "registrationNumber",  (v) => v || null);
  // Explicit null clears the custom logo and falls back to the bundled mark.
  set("logo",                  "logo",                (v) => v || null);
  set("brand_primary",         "brandPrimary");
  set("brand_secondary",       "brandSecondary");
  set("brand_dark",            "brandDark");
  set("default_currency",      "defaultCurrency");
  set("default_payment_terms", "defaultPaymentTerms", (v) => v || null);
  set("default_tax_rate",      "defaultTaxRate");
  set("quotation_prefix",      "quotationPrefix");
  set("invoice_prefix",        "invoicePrefix");
  set("quotation_footer",      "quotationFooter",     (v) => v || null);
  set("invoice_footer",        "invoiceFooter",       (v) => v || null);
  set("bank_details",          "bankDetails",         (v) => v || null);

  const [updated] = await db
    .update(companySettings)
    .set(patch as never)
    .where(eq(companySettings.id, current.id))
    .returning();

  return c.json(present(updated));
});

export default router;
