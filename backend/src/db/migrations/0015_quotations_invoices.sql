-- Quotations & Invoices — the document side of the money the CRM already tracks.
--
-- Additive and idempotent. Nothing is dropped, nothing is rewritten, and the
-- file applies cleanly to an empty database as well as to production.
--
-- Money is numeric(12,2) everywhere, matching transactions.amount. Nothing in
-- this feature ever puts an amount in a float — see backend/src/services/money.ts.

-- ── Company settings (single row) ─────────────────────────
-- Branding, contact details and document defaults live in the database rather
-- than in the PDF renderer, so the owner can change the logo, the colours or
-- the payment terms from Settings without a deploy.
--
-- `singleton` is a constant column with a unique index: it makes "exactly one
-- row" a database guarantee rather than a convention the application has to
-- remember, and it gives the seed below a conflict target.
CREATE TABLE IF NOT EXISTS "company_settings" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "singleton"             boolean NOT NULL DEFAULT true,
  "company_name"          text NOT NULL DEFAULT 'Seekers AI Automation Solutions',
  "tagline"               text,
  "address"               text,
  "email"                 text,
  "phone"                 text,
  "website"               text,
  -- Egyptian tax card / commercial registration numbers, printed on invoices.
  "tax_number"            text,
  "registration_number"   text,
  -- NULL = use the white Seekers mark bundled with the API. Otherwise a
  -- `data:image/png;base64,…` URI uploaded from Settings.
  "logo"                  text,
  "brand_primary"         text NOT NULL DEFAULT '#7C3AED',
  "brand_secondary"       text NOT NULL DEFAULT '#3730A3',
  "brand_dark"            text NOT NULL DEFAULT '#1E1B4B',
  "default_currency"      text NOT NULL DEFAULT 'EGP',
  "default_payment_terms" text,
  "default_tax_rate"      numeric(5,2) NOT NULL DEFAULT '0',
  "quotation_prefix"      text NOT NULL DEFAULT 'SQ',
  "invoice_prefix"        text NOT NULL DEFAULT 'INV',
  "quotation_footer"      text,
  "invoice_footer"        text,
  "bank_details"          text,
  "updated_at"            timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_company_settings_singleton"
  ON "company_settings" ("singleton");

-- Real Seekers values as the shipped defaults. Every one of them is editable in
-- Settings; this only decides what the first PDF looks like before anyone has
-- opened that page.
INSERT INTO "company_settings" (
  "singleton", "company_name", "tagline", "address", "email", "phone", "website",
  "default_currency", "default_payment_terms", "quotation_footer", "invoice_footer"
) VALUES (
  true,
  'Seekers AI Automation Solutions',
  'AI automation for teams that move fast',
  'Cairo, Egypt',
  'Team@seekersai.org',
  '+20 12 1110 0767',
  'seekersai.org',
  'EGP',
  'Payment due within 14 days of the invoice date. Setup fees are payable before work begins.',
  'This quotation is an estimate and is valid until the date shown above. Scope changes are quoted separately.',
  'Thank you for working with Seekers AI. Please reference the invoice number with your payment.'
) ON CONFLICT ("singleton") DO NOTHING;

-- ── Quotations ────────────────────────────────────────────
-- client_id is nullable on purpose: a quotation routinely goes out before the
-- prospect exists as a client row, so the client's details are also snapshotted
-- as free text. Converting an accepted quotation is what creates/links the
-- client record.
CREATE TABLE IF NOT EXISTS "quotations" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-readable and sequential per year, e.g. SQ-2026-0001.
  "number"           text NOT NULL UNIQUE,
  "title"            text,
  "client_id"        uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  -- Snapshot of who this was addressed to. Kept even when client_id is set, so
  -- reprinting an old quotation does not silently pick up a renamed company.
  "client_name"      text,
  "client_company"   text,
  "client_email"     text,
  "client_phone"     text,
  "client_address"   text,
  -- draft | sent | accepted | rejected | expired
  "status"           text NOT NULL DEFAULT 'draft',
  "currency"         text NOT NULL DEFAULT 'EGP',
  "setup_fee"        numeric(12,2) NOT NULL DEFAULT '0',
  "monthly_retainer" numeric(12,2) NOT NULL DEFAULT '0',
  "retainer_months"  integer NOT NULL DEFAULT 0,
  -- none | percent | amount. Explicit discriminator rather than two nullable
  -- columns, so "10" can never be ambiguous between 10% and EGP 10.
  "discount_type"    text NOT NULL DEFAULT 'none',
  "discount_value"   numeric(12,2) NOT NULL DEFAULT '0',
  -- Percent, e.g. 14.00 for Egyptian VAT.
  "tax_rate"         numeric(5,2) NOT NULL DEFAULT '0',
  "notes"            text,
  "terms"            text,
  "valid_until"      date,
  -- 43-char base64url of 32 random bytes. The public share link is the only
  -- thing that authenticates a reader, so it has to be unguessable.
  "share_token"      text NOT NULL UNIQUE,
  "sent_at"          timestamp with time zone,
  "decided_at"       timestamp with time zone,
  "created_by"       uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_quotations_status" ON "quotations" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_quotations_client" ON "quotations" ("client_id");

CREATE TABLE IF NOT EXISTS "quotation_items" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quotation_id" uuid NOT NULL REFERENCES "quotations"("id") ON DELETE CASCADE,
  "description"  text NOT NULL,
  "quantity"     numeric(12,2) NOT NULL DEFAULT '1',
  "unit_price"   numeric(12,2) NOT NULL DEFAULT '0',
  -- one_off bills once; recurring bills once per month of the retainer term.
  "kind"         text NOT NULL DEFAULT 'one_off',
  "position"     integer NOT NULL DEFAULT 0,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_quotation_items_quotation"
  ON "quotation_items" ("quotation_id", "position");

-- ── Invoices ──────────────────────────────────────────────
-- Carries the same money shape as a quotation so one pure total engine serves
-- both (services/money.ts computeTotals).
CREATE TABLE IF NOT EXISTS "invoices" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "number"           text NOT NULL UNIQUE,
  "title"            text,
  "client_id"        uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  -- Where this invoice came from, if it was converted. NULL for a manual one.
  "quotation_id"     uuid REFERENCES "quotations"("id") ON DELETE SET NULL,
  "client_name"      text,
  "client_company"   text,
  "client_email"     text,
  "client_phone"     text,
  "client_address"   text,
  -- draft | sent | paid | overdue | void
  "status"           text NOT NULL DEFAULT 'draft',
  "issue_date"       date NOT NULL DEFAULT CURRENT_DATE,
  "due_date"         date,
  "currency"         text NOT NULL DEFAULT 'EGP',
  "setup_fee"        numeric(12,2) NOT NULL DEFAULT '0',
  "monthly_retainer" numeric(12,2) NOT NULL DEFAULT '0',
  "retainer_months"  integer NOT NULL DEFAULT 0,
  "discount_type"    text NOT NULL DEFAULT 'none',
  "discount_value"   numeric(12,2) NOT NULL DEFAULT '0',
  "tax_rate"         numeric(5,2) NOT NULL DEFAULT '0',
  "notes"            text,
  "terms"            text,
  "paid_at"          timestamp with time zone,
  -- ── Recurrence ──
  -- A retainer produces a rolling series rather than N pre-created drafts: the
  -- next invoice is spawned from this one on demand. recurrence_index is 1 for
  -- the first invoice of a series.
  "recurring"        boolean NOT NULL DEFAULT false,
  "recurrence_months" integer NOT NULL DEFAULT 1,
  "recurrence_index" integer NOT NULL DEFAULT 1,
  "recurrence_total" integer,
  "next_invoice_date" date,
  "parent_invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL,
  -- ── Finance tie-in ──
  -- The income row written into the P&L when this invoice was first marked
  -- paid. Its presence IS the idempotency marker: the mark-paid path refuses to
  -- write a second transaction while this is populated, so marking an invoice
  -- paid twice cannot double-count revenue. UNIQUE so two invoices can never
  -- claim the same ledger row either.
  "transaction_id"   uuid REFERENCES "transactions"("id") ON DELETE SET NULL,
  "share_token"      text NOT NULL UNIQUE,
  "created_by"       uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoices_transaction"
  ON "invoices" ("transaction_id") WHERE "transaction_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_invoices_status"    ON "invoices" ("status", "issue_date");
CREATE INDEX IF NOT EXISTS "idx_invoices_client"    ON "invoices" ("client_id");
CREATE INDEX IF NOT EXISTS "idx_invoices_quotation" ON "invoices" ("quotation_id");
CREATE INDEX IF NOT EXISTS "idx_invoices_parent"    ON "invoices" ("parent_invoice_id");

CREATE TABLE IF NOT EXISTS "invoice_items" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "invoice_id"  uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "quantity"    numeric(12,2) NOT NULL DEFAULT '1',
  "unit_price"  numeric(12,2) NOT NULL DEFAULT '0',
  "kind"        text NOT NULL DEFAULT 'one_off',
  "position"    integer NOT NULL DEFAULT 0,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_invoice_items_invoice"
  ON "invoice_items" ("invoice_id", "position");
