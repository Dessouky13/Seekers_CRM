// ── API response shapes — mirrors backend Drizzle schema ──

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  role: "admin" | "member";
  title: string | null;
  phone: string | null;
  signature: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiClient {
  id: string;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  status: "active" | "inactive" | "prospect";
  industry: string | null;
  totalRevenue: string; // live-computed sum of income transactions
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  project_count: number;
  revenue_summary?: { income: number; expense: number; net: number };
}

export interface ApiClientDetail extends Omit<ApiClient, "project_count" | "revenue_summary"> {
  projects: { id: string; name: string }[];
  tasks: ApiTask[];
  recent_transactions: ApiTransaction[];
  fee_summary: { total_income: number; total_expense: number; net: number };
}

export interface ApiSubtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  position: number;
}

export interface ApiTask {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  assignee_name: string | null;
  assignee_avatar: string | null;
  priority: "low" | "medium" | "high" | "critical";
  status: "backlog" | "todo" | "in_progress" | "review" | "done";
  dueDate: string | null;
  completedAt: string | null;
  projectId: string | null;
  project_name: string | null;
  clientId: string | null;
  client_name: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  subtasks: ApiSubtask[];
}

export interface ApiProject {
  id: string;
  name: string;
  clientId: string | null;
  client_name: string | null;
  createdAt: string;
}

export interface ApiTransaction {
  id: string;
  date: string;
  type: "income" | "expense";
  amount: string;
  currency: string;
  /** Primary category — owns the amount in P&L breakdowns (= categories[0]) */
  category: string;
  /** Full multi-select; categories[0] === category */
  categories: string[];
  toolId: string | null;
  tool_name: string | null;
  clientId: string | null;
  clientName: string | null;
  status: "completed" | "pending" | "cancelled";
  /** Who physically holds/fronted this money; null = company account */
  heldBy: string | null;
  held_by_name: string | null;
  /** Set once handed over / reimbursed */
  settledAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ApiLeadActivity {
  id: string;
  leadId: string;
  type: "email" | "call" | "meeting" | "form" | "note";
  description: string;
  date: string;
  createdAt: string;
}

export type LeadStage =
  | "new_lead" | "contacted" | "call_scheduled"
  | "proposal_sent" | "negotiation" | "closed_won" | "closed_lost";

export interface ApiLead {
  id: string;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  category: string | null;
  dealValue: string;
  stage: LeadStage;
  assigneeId: string | null;
  assignee_name: string | null;
  lastActivity: string | null;
  // "Come back to this on this day", as YYYY-MM-DD. Until it arrives the lead
  // raises no stale card in Today; on the day it raises a follow_up_due one.
  followUpAt?:   string | null;
  followUpNote?: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // ── Manual contact strikes ──
  // Derived server-side (COUNT of lead_strikes rows), not a stored counter, so
  // the number and the history can never disagree. Present on every lead in
  // GET /crm/leads so the dot indicator draws without a per-lead fetch.
  strikeCount?: number;
  strikeLimit?: number;
  /** Set when the strike limit archived this lead. null = not archived. */
  archivedAt?:  string | null;
  // ── v2 lead intelligence ──
  // GET /crm/leads selects the whole leads row, so these have been on the wire
  // since the outbound-machine work landed; the type just never caught up.
  // Populated by n8n via the /intel/* ingest endpoints — null until enrichment
  // has run for that lead.
  icpScore?:        number | null;          // 0-100, computed server-side
  techFingerprint?: Record<string, unknown> | null;
  reviewStats?:     Record<string, unknown> | null;
  complaintTags?:   string[] | null;        // slow_response, booking_chaos, …
  signals?:         Record<string, unknown> | null;
}

/** One recorded manual contact attempt. See backend migration 0020. */
export interface ApiLeadStrike {
  id:        string;
  leadId:    string;
  channel:   StrikeChannel | null;
  note:      string | null;
  /** The Cairo calendar day the contact belongs to, YYYY-MM-DD. */
  date:      string;
  createdBy: string | null;
  createdAt: string;
  /** The person who recorded it, resolved server-side. */
  by_name:   string | null;
}

export type StrikeChannel = "whatsapp" | "call" | "email" | "meeting" | "other";

/** What the third strike does to a lead. Configured in Settings. */
export type StrikeLimitAction = "close_lost" | "archive";

export interface ApiLeadDetail extends ApiLead {
  activities: ApiLeadActivity[];
  /** Newest first. The count is `strikes.length` — there is no counter column. */
  strikes:            ApiLeadStrike[];
  strikeCount:        number;
  strikeLimit:        number;
  /**
   * Travels with the lead rather than being read from /company-settings, which
   * is admin-gated as a module — a member still needs to be told what the next
   * strike will do.
   */
  strikeLimitAction:  StrikeLimitAction;
}

export interface ApiGoal {
  id: string;
  title: string;
  description: string | null;
  current: string;
  target: string;
  unit: string | null;
  period: string | null;
  ownerId: string | null;
  owner_name: string | null;
  progress_pct: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKbDocument {
  id: string;
  title: string;
  filePath: string | null;
  fileUrl: string | null;
  fileType: string | null;
  fileSize: number | null;
  uploadedBy: string | null;
  status: "processing" | "ready" | "error";
  createdAt: string;
}

// ── Quotations & Invoices ─────────────────────────────────
// Money crosses the wire as fixed-precision STRINGS ("25000.00"), never as
// numbers — see Frontend/src/lib/document-money.ts.

export type DiscountType = "none" | "percent" | "amount";
export type LineKind     = "one_off" | "recurring";

export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";
export type InvoiceStatus   = "draft" | "sent" | "paid" | "overdue" | "void";

export interface ApiDocumentItem {
  description: string;
  quantity:    string;
  unitPrice:   string;
  kind:        LineKind;
  position:    number;
}

/** Server-computed, always authoritative. The form's live preview is only a preview. */
export interface ApiDocumentTotals {
  one_off_subtotal:   string;
  monthly_total:      string;
  recurring_subtotal: string;
  subtotal:           string;
  discount:           string;
  taxable:            string;
  tax:                string;
  total:              string;
  lines:              { line_total: string; extended: string }[];
}

interface ApiDocumentBase {
  id:              string;
  number:          string;
  title:           string | null;
  clientId:        string | null;
  clientName:      string | null;
  clientCompany:   string | null;
  clientEmail:     string | null;
  clientPhone:     string | null;
  clientAddress:   string | null;
  currency:        string;
  setupFee:        string;
  monthlyRetainer: string;
  retainerMonths:  number;
  discountType:    DiscountType;
  discountValue:   string;
  taxRate:         string;
  notes:           string | null;
  terms:           string | null;
  shareToken:      string;
  createdBy:       string | null;
  createdAt:       string;
  updatedAt:       string;
  items:           ApiDocumentItem[];
  totals:          ApiDocumentTotals;
  share_url:       string;
}

export interface ApiQuotation extends ApiDocumentBase {
  status:      QuotationStatus;
  validUntil:  string | null;
  sentAt:      string | null;
  decidedAt:   string | null;
  is_expired:  boolean;
  /** Present on the list endpoint when this quotation has been converted. */
  invoice_id?:     string | null;
  invoice_number?: string | null;
}

export interface ApiInvoice extends ApiDocumentBase {
  status:           InvoiceStatus;
  quotationId:      string | null;
  issueDate:        string;
  dueDate:          string | null;
  paidAt:           string | null;
  recurring:        boolean;
  recurrenceMonths: number;
  recurrenceIndex:  number;
  recurrenceTotal:  number | null;
  nextInvoiceDate:  string | null;
  parentInvoiceId:  string | null;
  /** The P&L row this invoice wrote when it was marked paid; null = nothing recorded. */
  transactionId:    string | null;
  is_overdue:       boolean;
  /** Only on a status response: create | none | remove. */
  ledger_action?:   "create" | "none" | "remove";
  already_existed?: boolean;
}

export interface ApiCompanySettings {
  id:                  string;
  companyName:         string;
  tagline:             string | null;
  address:             string | null;
  email:               string | null;
  phone:               string | null;
  website:             string | null;
  taxNumber:           string | null;
  registrationNumber:  string | null;
  /** null = the white Seekers mark bundled with the API (see default_logo). */
  logo:                string | null;
  brandPrimary:        string;
  brandSecondary:      string;
  brandDark:           string;
  defaultCurrency:     string;
  defaultPaymentTerms: string | null;
  defaultTaxRate:      string;
  quotationPrefix:     string;
  invoicePrefix:       string;
  quotationFooter:     string | null;
  invoiceFooter:       string | null;
  bankDetails:         string | null;
  /** What the third manual-contact strike does to a lead. */
  strikeLimitAction:   StrikeLimitAction;
  updatedAt:           string;
  default_logo:        string;
}

export interface DashboardSummary {
  finance: {
    total_income: number;
    total_expenses: number;
    net_profit: number;
    profit_margin: number;
    revenue_by_month: { month: string; revenue: number }[];
    expense_by_category: { name: string; value: number }[];
  };
  tasks: {
    total: number;
    completed: number;
    overdue: number;
    completion_rate: number;
    overdue_items: { id: string; title: string; due_date: string | null; priority: string; assignee_name: string | null }[];
  };
  leads: { total: number; active: number; pipeline_value: number };
  goals: { title: string; current: number; target: number; progress_pct: number }[];
}
