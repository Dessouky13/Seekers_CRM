import { z } from "zod";
import { formatMoney, parseMoney } from "../services/money";

/**
 * Canonical email input: trim and lowercase BEFORE validating.
 *
 * Order matters — zod runs string checks in chain order, so `.email()` last
 * means "  Bob@Example.COM " is normalised to "bob@example.com" and accepted,
 * instead of being rejected outright for the stray whitespace a phone keyboard
 * or a copy-paste adds. Every address is stored lowercase, so normalising at
 * the edge is what keeps login, password reset and invites agreeing on the
 * same key.
 */
export const emailInput = z.string().trim().toLowerCase().email("Invalid email");

// ── Auth ──────────────────────────────────────────────────

export const loginSchema = z.object({
  email:    emailInput,
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  name:     z.string().min(1, "Name is required").max(100),
  email:    emailInput,
  password: z.string().min(8, "Password must be at least 8 characters"),
  role:     z.enum(["admin", "member"]).optional(),
});

export const acceptInviteSchema = z.object({
  invite_token: z.string().min(1, "Invite token is required"),
  name:         z.string().min(1, "Name is required").max(100),
  password:     z.string().min(8, "Password must be at least 8 characters"),
});

export const passwordResetRequestSchema = z.object({
  email: emailInput,
});

export const passwordUpdateSchema = z.object({
  token:    z.string().min(1, "Reset token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const refreshTokenSchema = z.object({
  refresh_token: z.string().min(1, "Refresh token is required"),
});

// ── Users ─────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  name:      z.string().min(1).max(100).optional(),
  avatar:    z.string().max(255).optional(),
  title:     z.string().max(120).optional().nullable(),
  phone:     z.string().max(40).optional().nullable(),
  signature: z.string().max(8000).optional().nullable(),
  // Admin-only — the route rejects this field for non-admins and refuses to
  // demote the last remaining admin.
  role:      z.enum(["admin", "member"]).optional(),
});

// An invite typed as "Bob@Example.com" used to create an account its owner
// could never sign into, because login looks the address up lowercased.
export const inviteUserSchema = z.object({
  email: emailInput,
  role:  z.enum(["admin", "member"]),
});

// ── Clients ───────────────────────────────────────────────

export const createClientSchema = z.object({
  name:    z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  email:   z.string().email().optional().or(z.literal("")),
  phone:   z.string().max(50).optional(),
  status:  z.enum(["active", "inactive", "prospect"]).optional(),
  industry: z.string().max(100).optional(),
  notes:   z.string().optional(),
});

export const updateClientSchema = createClientSchema.partial();

// ── Projects ──────────────────────────────────────────────

export const createProjectSchema = z.object({
  name:      z.string().min(1).max(200),
  client_id: z.string().uuid().optional(),
});

// ── Tasks ─────────────────────────────────────────────────

export const createTaskSchema = z.object({
  title:       z.string().min(1).max(300),
  description: z.string().optional(),
  assignee_id: z.string().uuid().optional(),
  priority:    z.enum(["low", "medium", "high", "critical"]).optional(),
  due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
  project_id:  z.string().uuid().optional(),
  client_id:   z.string().uuid().optional(),
});

// The clearable relations accept an explicit `null` so the UI can actually
// unassign a task / detach it from a project, client or due date. `.optional()`
// alone made those fields write-once.
export const updateTaskSchema = createTaskSchema.partial().extend({
  status:      z.enum(["backlog", "todo", "in_progress", "review", "done"]).optional(),
  description: z.string().nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  project_id:  z.string().uuid().nullable().optional(),
  client_id:   z.string().uuid().nullable().optional(),
  due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").nullable().optional(),
});

export const createSubtaskSchema = z.object({
  title:    z.string().min(1).max(300),
  position: z.number().int().min(0).optional(),
});

// ── Finance ───────────────────────────────────────────────

export const createTransactionSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  type:        z.enum(["income", "expense"]),
  amount:      z.number().positive("Amount must be positive"),
  currency:    z.string().length(3).optional(),
  // Multi-select. categories[0] is the PRIMARY category that owns the amount
  // in P&L breakdowns, so totals always reconcile. `category` is still
  // accepted for backwards compatibility (older clients / n8n).
  categories:  z.array(z.string().min(1).max(100)).min(1).max(10).optional(),
  category:    z.string().min(1).max(100).optional(),
  tool_id:     z.string().uuid().nullable().optional(),
  client_id:   z.string().uuid().optional(),
  client_name: z.string().max(200).optional(),
  status:      z.enum(["completed", "pending", "cancelled"]).optional(),
  // Cash position: who physically holds / fronted this money (null = company account)
  held_by:     z.string().uuid().nullable().optional(),
  settled:     z.boolean().optional(),
  notes:       z.string().optional(),
}).refine(
  (d) => !!(d.categories?.length || d.category),
  { message: "At least one category is required", path: ["categories"] },
);

// .partial() isn't available on a refined schema — declare the PATCH shape
// explicitly so any subset of fields can be sent.
export const updateTransactionSchema = z.object({
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
  type:        z.enum(["income", "expense"]).optional(),
  amount:      z.number().positive("Amount must be positive").optional(),
  currency:    z.string().length(3).optional(),
  categories:  z.array(z.string().min(1).max(100)).min(1).max(10).optional(),
  category:    z.string().min(1).max(100).optional(),
  tool_id:     z.string().uuid().nullable().optional(),
  client_id:   z.string().uuid().optional(),
  client_name: z.string().max(200).optional(),
  status:      z.enum(["completed", "pending", "cancelled"]).optional(),
  held_by:     z.string().uuid().nullable().optional(),
  settled:     z.boolean().optional(),
  notes:       z.string().optional(),
});

// ── Tools ─────────────────────────────────────────────────
export const createToolSchema = z.object({
  name:           z.string().min(1).max(120),
  vendor:         z.string().max(120).nullable().optional(),
  url:            z.string().max(300).nullable().optional(),
  kind:           z.string().max(60).nullable().optional(),
  monthly_budget: z.number().nonnegative().nullable().optional(),
  active:         z.boolean().optional(),
  notes:          z.string().max(2000).nullable().optional(),
});
export const updateToolSchema = createToolSchema.partial();

// ── CRM / Leads ───────────────────────────────────────────

export const createLeadSchema = z.object({
  name:        z.string().min(1).max(200),
  company:     z.string().min(1).max(200),
  email:       z.string().email().optional().or(z.literal("")),
  phone:       z.string().max(50).optional(),
  source:      z.string().max(100).optional(),
  category:    z.string().max(100).optional(),
  deal_value:  z.number().min(0).optional(),
  assignee_id: z.string().uuid().optional(),
  notes:       z.string().optional(),
});

export const updateLeadSchema = createLeadSchema.partial().extend({
  stage: z.enum([
    "new_lead", "contacted", "call_scheduled",
    "proposal_sent", "negotiation", "closed_won", "closed_lost",
  ]).optional(),
  // Follow-up: "come back to this lead on this day".
  //
  // Explicitly `.nullable()` — unlike the fields above, clearing a follow-up is
  // a first-class action ("actually, no need to chase them"), so the handler
  // has to be able to tell `null` (clear it) from absent (leave it alone). A
  // calendar day in Cairo, same format every other date field here uses.
  follow_up_at:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").nullable().optional(),
  follow_up_note: z.string().max(500).nullable().optional(),
  /**
   * Shelve or restore a lead. `false` clears `archived_at`, which is the ONLY
   * way back from the "archive" strike-limit action — without it archiving would
   * be a one-way door. A boolean rather than a timestamp so the client never
   * chooses when it happened.
   */
  archived:       z.boolean().optional(),
});

export const createLeadActivitySchema = z.object({
  type:        z.enum(["email", "call", "meeting", "form", "note"]),
  description: z.string().min(1).max(1000),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const leadStage = z.enum([
  "new_lead", "contacted", "call_scheduled",
  "proposal_sent", "negotiation", "closed_won", "closed_lost",
]);

/**
 * The selection every bulk endpoint acts on.
 *
 * `.min(1)` is not cosmetic. An empty array is falsy-adjacent in a way that has
 * already cost this database every one of its 735 leads: the old bulk-delete
 * guard was `if (!body.keep_sources && !body.delete_sources)`, `![]` is `false`,
 * so an empty array passed the guard, contributed no SQL condition, and the
 * DELETE ran with no WHERE clause at all. Rejecting it here is the first of two
 * layers — services/bulk-leads.ts refuses it again after validation, and the
 * routes refuse a third time if no WHERE term resolves.
 *
 * `.max(500)` caps the blast radius of one request. The UI pages at 200.
 */
const bulkLeadIds = z.array(z.string().uuid()).min(1, "Select at least one lead").max(500);

/**
 * PATCH-like bulk edit. Only fields that exist on `leads` AND are meaningful to
 * set to one shared value across many rows — see BulkLeadPatchInput in
 * services/bulk-leads.ts for what is deliberately absent and why.
 *
 * The clearable fields are `.nullable()` so the UI can genuinely unset them;
 * `.optional()` alone would make them write-once (the same bug the follow-up
 * fields carry a comment about above).
 */
export const bulkUpdateLeadsSchema = z.object({
  ids:   bulkLeadIds,
  patch: z.object({
    stage:       leadStage.optional(),
    assignee_id: z.string().uuid().nullable().optional(),
    category:    z.string().max(100).nullable().optional(),
    source:      z.string().max(100).nullable().optional(),
  }),
  dry_run: z.boolean().optional(),
}).refine(
  (body) => Object.keys(body.patch).length > 0,
  { message: "Choose at least one field to change", path: ["patch"] },
);

/**
 * The same comment against every selected lead, written as a per-lead activity
 * so each lead's own history stays complete and independent.
 */
export const bulkCommentLeadsSchema = z.object({
  ids:         bulkLeadIds,
  type:        z.enum(["email", "call", "meeting", "form", "note"]).optional(),
  description: z.string().trim().min(1, "Write a comment").max(1000),
  // A Cairo calendar day. Defaults server-side to cairoToday() when omitted.
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
});

/** One manual contact attempt. Everything except the lead is optional. */
export const createLeadStrikeSchema = z.object({
  channel: z.enum(["whatsapp", "call", "email", "meeting", "other"]).optional(),
  note:    z.string().trim().max(500).nullable().optional(),
  date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
});

// ── Goals ─────────────────────────────────────────────────

export const createGoalSchema = z.object({
  title:       z.string().min(1).max(300),
  description: z.string().optional(),
  current:     z.number().min(0).optional(),
  target:      z.number().positive("Target must be positive"),
  unit:        z.string().max(20).optional(),
  period:      z.string().max(50).optional(),
  owner_id:    z.string().uuid().optional(),
});

export const updateGoalSchema = createGoalSchema.partial();

// ── Knowledge Base ────────────────────────────────────────

export const ragQuerySchema = z.object({
  query: z.string().min(1, "Query is required").max(1000),
  top_k: z.number().int().min(1).max(20).optional(),
});

// ── Notifications ─────────────────────────────────────────

export const externalNotificationSchema = z.object({
  user_id: z.string().uuid().optional(),
  target: z.enum(["all", "admins", "members"]).optional(),
  type: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  link: z.string().max(300).optional(),
}).refine((value) => value.user_id || value.target, {
  message: "Either user_id or target is required",
});

// ── Quotations & Invoices ─────────────────────────────────

/**
 * A money field on the wire.
 *
 * Accepts a string or a JSON number, validates it through the same integer
 * parser the totals engine uses, and NORMALISES it to a canonical "1234.56"
 * string. Routes therefore never see a float and can write the value straight
 * into `numeric(12,2)`.
 */
function moneyField(label: string, { max = 99_999_999.99 } = {}) {
  return z.union([z.string(), z.number()]).superRefine((value, ctx) => {
    let minor: bigint;
    try {
      minor = parseMoney(value, label);
    } catch (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (err as Error).message });
      return;
    }
    if (minor < 0n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must not be negative` });
    }
    if (minor > parseMoney(max.toFixed(2))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is too large` });
    }
  }).transform((value) => formatMoney(parseMoney(value, label)));
}

/** 0–100 with at most 2dp, normalised to "14.00". */
const percentField = (label: string) =>
  z.union([z.string(), z.number()]).superRefine((value, ctx) => {
    let minor: bigint;
    try {
      minor = parseMoney(value, label);
    } catch (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (err as Error).message });
      return;
    }
    if (minor < 0n)      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must not be negative` });
    if (minor > 10_000n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must not exceed 100` });
  }).transform((value) => formatMoney(parseMoney(value, label)));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const documentItemSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(300),
  quantity:    moneyField("quantity", { max: 1_000_000 }).optional(),
  unit_price:  moneyField("unit price").optional(),
  kind:        z.enum(["one_off", "recurring"]).optional(),
});

/** Every money-bearing field a quotation or an invoice shares. */
const documentMoneyFields = {
  currency:         z.string().trim().length(3, "Currency must be a 3-letter code").toUpperCase().optional(),
  setup_fee:        moneyField("setup fee").optional(),
  monthly_retainer: moneyField("monthly retainer").optional(),
  retainer_months:  z.number().int().min(0).max(120).optional(),
  discount_type:    z.enum(["none", "percent", "amount"]).optional(),
  discount_value:   moneyField("discount").optional(),
  tax_rate:         percentField("tax rate").optional(),
  notes:            z.string().max(5000).nullable().optional(),
  terms:            z.string().max(5000).nullable().optional(),
  title:            z.string().trim().max(200).nullable().optional(),
  items:            z.array(documentItemSchema).max(100, "At most 100 line items").optional(),
};

/** Recipient details — snapshotted so a reprint never picks up a renamed company. */
const documentClientFields = {
  client_id:      z.string().uuid().nullable().optional(),
  client_name:    z.string().trim().max(200).nullable().optional(),
  client_company: z.string().trim().max(200).nullable().optional(),
  client_email:   z.union([emailInput, z.literal("")]).nullable().optional(),
  client_phone:   z.string().trim().max(50).nullable().optional(),
  client_address: z.string().trim().max(500).nullable().optional(),
};

export const createQuotationSchema = z.object({
  ...documentClientFields,
  ...documentMoneyFields,
  status:      z.enum(["draft", "sent", "accepted", "rejected", "expired"]).optional(),
  valid_until: isoDate.nullable().optional(),
});

export const updateQuotationSchema = createQuotationSchema;

export const quotationStatusSchema = z.object({
  status: z.enum(["draft", "sent", "accepted", "rejected", "expired"]),
});

export const createInvoiceSchema = z.object({
  ...documentClientFields,
  ...documentMoneyFields,
  status:     z.enum(["draft", "sent", "paid", "overdue", "void"]).optional(),
  issue_date: isoDate.optional(),
  due_date:   isoDate.nullable().optional(),
  // A retainer invoice spawns the next one in its series on demand.
  recurring:         z.boolean().optional(),
  recurrence_months: z.number().int().min(1).max(12).optional(),
  recurrence_total:  z.number().int().min(1).max(120).nullable().optional(),
});

export const updateInvoiceSchema = createInvoiceSchema;

export const invoiceStatusSchema = z.object({
  status:   z.enum(["draft", "sent", "paid", "overdue", "void"]),
  /** Ledger date for the income row written when an invoice becomes paid. */
  paid_on:  isoDate.optional(),
});

export const convertQuotationSchema = z.object({
  issue_date: isoDate.optional(),
  due_date:   isoDate.nullable().optional(),
  /**
   * Bill the first month of the retainer alongside the setup fee and start a
   * monthly series. False bills the one-off portion only.
   */
  start_recurring: z.boolean().optional(),
});

// ── Company settings (branding for client-facing documents) ──

const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour, e.g. #7C3AED");

export const updateCompanySettingsSchema = z.object({
  company_name:          z.string().trim().min(1).max(200).optional(),
  tagline:               z.string().trim().max(200).nullable().optional(),
  address:               z.string().trim().max(300).nullable().optional(),
  email:                 z.union([emailInput, z.literal("")]).nullable().optional(),
  phone:                 z.string().trim().max(50).nullable().optional(),
  website:               z.string().trim().max(200).nullable().optional(),
  tax_number:            z.string().trim().max(60).nullable().optional(),
  registration_number:   z.string().trim().max(60).nullable().optional(),
  // Data URI or https URL. 512 kB of base64 is a generous ceiling for a logo and
  // keeps a stray 8 MB photo out of every PDF render.
  logo: z.string()
    .max(700_000, "Logo is too large — use an image under ~500 kB")
    .refine(
      (v) => /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) || /^https:\/\/\S+$/.test(v),
      "Logo must be a PNG/JPEG/WebP data URI or an https URL",
    )
    .nullable().optional(),
  brand_primary:         hexColor.optional(),
  brand_secondary:       hexColor.optional(),
  brand_dark:            hexColor.optional(),
  default_currency:      z.string().trim().length(3).toUpperCase().optional(),
  default_payment_terms: z.string().max(2000).nullable().optional(),
  default_tax_rate:      percentField("default tax rate").optional(),
  quotation_prefix:      z.string().trim().regex(/^[A-Z0-9]{1,8}$/, "1–8 uppercase letters or digits").optional(),
  invoice_prefix:        z.string().trim().regex(/^[A-Z0-9]{1,8}$/, "1–8 uppercase letters or digits").optional(),
  quotation_footer:      z.string().max(2000).nullable().optional(),
  invoice_footer:        z.string().max(2000).nullable().optional(),
  bank_details:          z.string().max(2000).nullable().optional(),
  // What the third manual-contact strike does to a lead. Enumerated rather than
  // free text so "delete" can never be configured: neither option destroys data.
  strike_limit_action:   z.enum(["close_lost", "archive"]).optional(),
});

// ── CRM Insights ─────────────────────────────────────────

export const crmInsightsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period: z.enum(["daily", "weekly", "monthly"]).optional(),
  include_ai: z.enum(["true", "false"]).optional(),
});
