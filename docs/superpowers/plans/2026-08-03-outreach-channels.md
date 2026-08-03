# Outreach Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make outreach produce human conversations — pace and protect email sending, and turn WhatsApp/phone into first-class channels that raise human tasks.

**Architecture:** Two slices over one shared idea: a lead has channels, each with an eligibility state. Slice 1 constrains the email sender (caps, spread, suppression, failure classification, DNS auth). Slice 2 adds `whatsapp`/`call` sequence steps that do not send — they block the enrollment in a new `awaiting_action` state and raise a Today item with a pre-written message and a deep link. Routing logic lives in two pure, DB-free modules (`phone.ts`, `channels.ts`) so it is unit-testable, matching the existing `outreach-subject.ts` / `worklist-ranking.ts` pattern.

**Tech Stack:** Node 20 + TypeScript, Hono, Drizzle ORM, PostgreSQL 16 (VPS) / 18 (local), Vitest, React 18 + Vite + Tailwind + shadcn/ui. Node's built-in `dns/promises` for DNS. **No new npm dependencies.**

## Global Constraints

- **No new npm dependencies.** Phone parsing and DNS use hand-written code and Node built-ins.
- **No new paid services, no new sending domain.** Sending stays on the existing Namecheap mailbox (`EMAIL_FROM`).
- Every request body validated with Zod. Never trust raw input.
- TypeScript only in `src/`. Frontend typecheck is `npx tsc --noEmit -p tsconfig.app.json` — the bare `tsc --noEmit` checks nothing because the root config is `"files": []`.
- **Existing suites must not regress: 28 frontend tests, 31 backend tests.** Run both before every commit.
- Timezone for all scheduling is `Africa/Cairo`. Friday and Saturday are skipped (existing behaviour, preserve it).
- Migrations are numbered SQL files in `backend/src/db/migrations/`, applied by `scripts/deploy.sh` which records applied names in a `_migrations` table. Every migration must be idempotent (`IF NOT EXISTS` / `IF EXISTS`).
- `+1` (US/Canada) numbers are **unclassifiable by design** — mobile and landline share the numbering space. They must return `unknown`, never a guess.
- **No WhatsApp presence checking by scraping.** It breaches WhatsApp ToS and gets numbers banned.

---

## File Structure

**New — backend**

| File | Responsibility |
|---|---|
| `backend/src/services/phone.ts` | Pure. Normalise a raw phone string to E.164; classify mobile/landline/unknown from a dialling-plan table. No DB, no I/O. |
| `backend/src/services/phone.test.ts` | Unit tests using real production number shapes. |
| `backend/src/services/channels.ts` | Pure. Given a lead-shaped object, return ordered channel eligibility with human reasons. No DB. |
| `backend/src/services/channels.test.ts` | Unit tests for priority and every ineligibility reason. |
| `backend/src/services/sending-policy.ts` | Pure. Daily cap for a warmup stage, how many to release this tick, the next spread slot, and warmup transitions. No DB. |
| `backend/src/services/sending-policy.test.ts` | Unit tests for caps, spread arithmetic, ramp and downgrade. |
| `backend/src/services/suppressions.ts` | DB access for the suppression list: `isSuppressed`, `suppress`, `listSuppressions`. |
| `backend/src/services/domain-auth.ts` | DNS lookups for SPF / DKIM / DMARC via `dns/promises`, returning pass/fail plus the raw record. |
| `backend/src/db/migrations/0012_outreach_channels.sql` | All schema changes for both slices. |
| `backend/scripts/backfill-phones.ts` | One-off: normalise + classify all existing phones, report counts. |

**New — frontend**

| File | Responsibility |
|---|---|
| `Frontend/src/lib/whatsapp.ts` | Pure. Build `wa.me` and `tel:` links; render a message template with lead variables. |
| `Frontend/src/lib/whatsapp.test.ts` | Unit tests for link building and encoding. |
| `Frontend/src/hooks/useDeliverability.ts` | Queries for the deliverability panel. |
| `Frontend/src/hooks/useManualTouch.ts` | Mutation for recording a manual-touch outcome. |
| `Frontend/src/components/modules/outbound/DeliverabilityPanel.tsx` | Mailbox usage, DNS auth, suppressions, recent failures. |
| `Frontend/src/components/modules/ManualTouchCard.tsx` | The action card: message, deep link, five outcome buttons. |

**Modified**

| File | Change |
|---|---|
| `backend/src/db/schema.ts` | Add `suppressions` table; `leads.phoneE164/phoneType/whatsappStatus`; `outreachSends.failureKind`. |
| `backend/src/services/outreach.ts` | Suppression + cap gate before send; spread scheduling; `isSpamRejection`; record `failureKind`; **replace the silent non-email skip at lines 353-355** with the `awaiting_action` block. |
| `backend/src/services/inbox.ts` | Line 242: stop nulling `leads.email`; add a suppression and set `email_status='bounced'`. |
| `backend/src/services/worklist-ranking.ts` | New action type `manual_touch`, ranked with replies. |
| `backend/src/routes/outreach.ts` | `POST /outreach/enrollments/:id/touch-outcome`; `GET /outreach/deliverability`; `GET /outreach/suppressions`. |
| `Frontend/src/pages/Outbound.tsx` | Mount `DeliverabilityPanel`. |
| `Frontend/src/pages/Today.tsx` | Render `ManualTouchCard` for `manual_touch` items. |
| `Frontend/src/hooks/useWorklist.ts` | Add `manual_touch` to `ActionType`; add the payload fields. |
| `Frontend/src/components/modules/outreach/SequenceEditor.tsx` | Offer `whatsapp` and `call` channels. |
| `Frontend/src/components/modules/outreach/sequence-readiness.ts` | Manual channels need a body but no subject. |

---

## Task 1: Pure phone normalisation and classification

**Files:**
- Create: `backend/src/services/phone.ts`
- Test: `backend/src/services/phone.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalisePhone(raw: string | null | undefined): string | null` — E.164 (`+` then digits) or null.
  - `type PhoneType = "mobile" | "landline" | "unknown"`
  - `classifyPhone(e164: string | null): PhoneType`
  - `describePhone(e164: string | null): string` — short human label, e.g. `"mobile · +971 5x"`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/phone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalisePhone, classifyPhone, describePhone } from "./phone";

describe("normalisePhone", () => {
  it("strips formatting from an international number", () => {
    expect(normalisePhone("+971 50 123 4567")).toBe("+971501234567");
    expect(normalisePhone("+20 10 12345678")).toBe("+201012345678");
    expect(normalisePhone("+1 555-123-4567")).toBe("+15551234567");
  });

  it("treats the North-American bracket shape as +1", () => {
    // 130 production leads are stored exactly like this, with no country code.
    expect(normalisePhone("(212) 285-1110")).toBe("+12122851110");
    expect(normalisePhone("(801) 748-1600")).toBe("+18017481600");
  });

  it("accepts 10 bare digits with a valid US area code as +1", () => {
    expect(normalisePhone("2122851110")).toBe("+12122851110");
  });

  it("refuses to guess a country when there is no code", () => {
    // Guessing would silently mangle a list spanning five Gulf dialling codes.
    expect(normalisePhone("0123456789")).toBeNull();
    expect(normalisePhone("12345")).toBeNull();
  });

  it("returns null for junk and empty input", () => {
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("   ")).toBeNull();
    expect(normalisePhone("n/a")).toBeNull();
    expect(normalisePhone("no phone")).toBeNull();
  });

  it("is idempotent", () => {
    const once = normalisePhone("+971 50 123 4567");
    expect(normalisePhone(once)).toBe(once);
  });

  it("handles a leading 00 international prefix", () => {
    expect(normalisePhone("00971501234567")).toBe("+971501234567");
  });
});

describe("classifyPhone", () => {
  it("classifies UAE mobiles and landlines", () => {
    expect(classifyPhone("+971501234567")).toBe("mobile");
    expect(classifyPhone("+971521234567")).toBe("mobile");
    expect(classifyPhone("+971581234567")).toBe("mobile");
    expect(classifyPhone("+97141234567")).toBe("landline");
    expect(classifyPhone("+97121234567")).toBe("landline");
  });

  it("classifies Egyptian mobiles and landlines", () => {
    expect(classifyPhone("+201012345678")).toBe("mobile");
    expect(classifyPhone("+201112345678")).toBe("mobile");
    expect(classifyPhone("+201212345678")).toBe("mobile");
    expect(classifyPhone("+201512345678")).toBe("mobile");
    expect(classifyPhone("+20212345678")).toBe("landline");   // Cairo
    expect(classifyPhone("+20312345678")).toBe("landline");   // Alexandria
  });

  it("classifies the rest of the Gulf", () => {
    expect(classifyPhone("+966551234567")).toBe("mobile");
    expect(classifyPhone("+966112345678")).toBe("landline");
    expect(classifyPhone("+97433123456")).toBe("mobile");
    expect(classifyPhone("+97444123456")).toBe("landline");
    expect(classifyPhone("+962791234567")).toBe("mobile");
    expect(classifyPhone("+962612345678")).toBe("landline");
  });

  it("classifies European mobiles", () => {
    expect(classifyPhone("+447911123456")).toBe("mobile");
    expect(classifyPhone("+33612345678")).toBe("mobile");
    expect(classifyPhone("+31612345678")).toBe("mobile");
    expect(classifyPhone("+41791234567")).toBe("mobile");
  });

  it("returns unknown for +1, where mobile and landline share the numbering space", () => {
    expect(classifyPhone("+12122851110")).toBe("unknown");
    expect(classifyPhone("+14155551234")).toBe("unknown");
  });

  it("returns unknown for null and unrecognised country codes", () => {
    expect(classifyPhone(null)).toBe("unknown");
    expect(classifyPhone("+9991234567")).toBe("unknown");
  });
});

describe("describePhone", () => {
  it("labels a mobile with its country and prefix", () => {
    expect(describePhone("+971501234567")).toBe("mobile · +971 5x");
  });

  it("labels a landline plainly", () => {
    expect(describePhone("+97141234567")).toBe("landline");
  });

  it("says so when the type cannot be determined", () => {
    expect(describePhone("+12122851110")).toBe("US/Canada — type unknown");
  });

  it("handles null", () => {
    expect(describePhone(null)).toBe("no number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/phone.test.ts`
Expected: FAIL — `Failed to resolve import "./phone"`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/phone.ts`:

```ts
// Phone normalisation and mobile/landline classification. Pure: no DB, no I/O,
// no dependencies — so it is unit-testable and safe to call from a migration
// script, the scheduler and the API alike.
//
// This exists because WhatsApp routing must never target a landline. Egyptian
// 02/03 numbers, UAE 04 numbers and so on can never have WhatsApp, and opening a
// chat for one wastes a human's time. Classification by dialling plan is
// deterministic and free; actual WhatsApp presence cannot be checked
// compliantly without the paid API, so that is learned from outcomes instead.

export type PhoneType = "mobile" | "landline" | "unknown";

interface DiallingPlan {
  /** Country calling code, without the +. */
  code:    string;
  country: string;
  /** National-significant-number prefixes that identify a mobile. */
  mobile:  string[];
  /** Prefixes that identify a fixed line. */
  landline: string[];
}

// Covers every country code present in the production lead list. Prefixes are
// matched against the national significant number, i.e. after the country code.
const PLANS: DiallingPlan[] = [
  { code: "971", country: "UAE",         mobile: ["50", "52", "54", "55", "56", "58"], landline: ["2", "3", "4", "6", "7", "9"] },
  { code: "20",  country: "Egypt",       mobile: ["10", "11", "12", "15"],             landline: ["2", "3", "4", "5", "6", "8", "9"] },
  { code: "966", country: "Saudi",       mobile: ["5"],                                landline: ["1"] },
  { code: "974", country: "Qatar",       mobile: ["3", "5", "6", "7"],                 landline: ["4"] },
  { code: "962", country: "Jordan",      mobile: ["7"],                                landline: ["2", "3", "5", "6"] },
  { code: "44",  country: "UK",          mobile: ["7"],                                landline: ["1", "2", "3", "8"] },
  { code: "33",  country: "France",      mobile: ["6", "7"],                           landline: ["1", "2", "3", "4", "5", "9"] },
  { code: "31",  country: "Netherlands", mobile: ["6"],                                landline: ["1", "2", "3", "4", "5", "7", "8"] },
  { code: "41",  country: "Switzerland", mobile: ["7"],                                landline: ["2", "3", "4", "5", "6"] },
  // +1 is deliberately absent: US and Canadian mobiles and landlines share the
  // same numbering space, so any classification would be a guess.
];

/** Words the scrapers use to mean "no number". */
const JUNK = new Set(["n/a", "na", "none", "no phone", "unknown", "-", "null"]);

/**
 * Normalise a raw phone string to E.164, or null when that cannot be done
 * safely.
 *
 * Deliberately has NO default country: assuming one would silently corrupt a
 * list that spans five Gulf dialling codes. The only inference made is the
 * unambiguous North-American shape, which accounts for 130 production leads
 * stored as "(212) 285-1110".
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || JUNK.has(trimmed.toLowerCase())) return null;

  // "00" is the international access prefix in most of the world.
  const withPlus = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  const digits = withPlus.replace(/[^\d]/g, "");
  if (!digits) return null;

  if (withPlus.trim().startsWith("+")) {
    // E.164 allows at most 15 digits; anything longer is corrupt data.
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  // North-American shape: 10 digits with a plausible area code (NANP area codes
  // never start with 0 or 1).
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  // Already includes the US country code.
  if (digits.length === 11 && digits.startsWith("1") && /^[2-9]/.test(digits.slice(1))) {
    return `+${digits}`;
  }

  // No country code and not a NANP shape — refuse rather than guess.
  return null;
}

function planFor(e164: string): { plan: DiallingPlan; nsn: string } | null {
  const digits = e164.replace(/[^\d]/g, "");
  // Longest code first, so "971" wins over a hypothetical "97".
  for (const plan of [...PLANS].sort((a, b) => b.code.length - a.code.length)) {
    if (digits.startsWith(plan.code)) {
      return { plan, nsn: digits.slice(plan.code.length) };
    }
  }
  return null;
}

/** Longest-prefix match, so "50" beats "5" when both are listed. */
function matches(nsn: string, prefixes: string[]): boolean {
  return [...prefixes]
    .sort((a, b) => b.length - a.length)
    .some((p) => nsn.startsWith(p));
}

export function classifyPhone(e164: string | null): PhoneType {
  if (!e164) return "unknown";
  const found = planFor(e164);
  if (!found) return "unknown";
  const { plan, nsn } = found;
  // Mobile is checked first: in several plans a mobile prefix is a longer form
  // of a landline prefix (UAE "5x" mobile vs "9" landline is fine, but Egypt
  // "1x" mobile must not fall through to a one-digit landline match).
  if (matches(nsn, plan.mobile))   return "mobile";
  if (matches(nsn, plan.landline)) return "landline";
  return "unknown";
}

/** Short human label for the UI. */
export function describePhone(e164: string | null): string {
  if (!e164) return "no number";
  const found = planFor(e164);
  if (!found) {
    return e164.startsWith("+1") ? "US/Canada — type unknown" : "unrecognised country code";
  }
  const type = classifyPhone(e164);
  if (type === "mobile") {
    const prefix = [...found.plan.mobile]
      .sort((a, b) => b.length - a.length)
      .find((p) => found.nsn.startsWith(p))!;
    return `mobile · +${found.plan.code} ${prefix}x`;
  }
  if (type === "landline") return "landline";
  return `+${found.plan.code} — type unknown`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/phone.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Confirm no regression, then commit**

Run: `cd backend && npx vitest run && npx tsc --noEmit`
Expected: 31 existing + the new phone tests all pass; 0 type errors.

```bash
git add backend/src/services/phone.ts backend/src/services/phone.test.ts
git commit -m "Add pure phone normalisation and mobile/landline classification

WhatsApp must never target a landline: Egyptian 02/03 and UAE 04 numbers can
never have it, and opening a chat for one wastes a human's time. Classification
by dialling plan is deterministic and free.

No default country on purpose — the lead list spans five Gulf dialling codes, so
assuming one would silently corrupt it. The only inference is the unambiguous
North-American shape, which covers the 130 leads stored as (212) 285-1110.

+1 returns unknown by design: US and Canadian mobiles and landlines share the
same numbering space, so any answer would be a guess."
```

---

## Task 2: Schema migration and phone backfill

**Files:**
- Create: `backend/src/db/migrations/0012_outreach_channels.sql`
- Create: `backend/scripts/backfill-phones.ts`
- Modify: `backend/src/db/schema.ts`

**Interfaces:**
- Consumes: `normalisePhone`, `classifyPhone` from Task 1.
- Produces: columns `leads.phone_e164`, `leads.phone_type`, `leads.whatsapp_status`; table `suppressions`; column `outreach_sends.failure_kind`. Drizzle exports `suppressions`, and `leads.phoneE164` / `leads.phoneType` / `leads.whatsappStatus`.

- [ ] **Step 1: Write the migration**

Create `backend/src/db/migrations/0012_outreach_channels.sql`:

```sql
-- Outreach channels: phone routing, suppression list, failure classification.
--
-- All additive and idempotent. No column is dropped and no data is destroyed —
-- notably this REPLACES the previous hard-bounce behaviour, which nulled
-- leads.email and threw the address away permanently.

-- ── Phone routing ─────────────────────────────────────────
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "phone_e164"      text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "phone_type"      text;
-- unknown | yes | no. Learned from what happens when a human tries the number:
-- there is no compliant free way to check WhatsApp presence up front.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "whatsapp_status" text NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS "idx_leads_phone_type"      ON "leads" ("phone_type");
CREATE INDEX IF NOT EXISTS "idx_leads_whatsapp_status" ON "leads" ("whatsapp_status");

-- ── Suppression list ──────────────────────────────────────
-- Permanent, non-destructive record of addresses that must never be emailed.
CREATE TABLE IF NOT EXISTS "suppressions" (
  "address"    text PRIMARY KEY,
  -- hard_bounce | spam_reject | complaint | unsubscribe | manual
  "reason"     text NOT NULL,
  -- inbox_poller | scheduler | ui
  "source"     text,
  "notes"      text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_suppressions_reason" ON "suppressions" ("reason", "created_at");

-- ── Failure classification ────────────────────────────────
-- transient | permanent | spam_reject | infra | suppressed
ALTER TABLE "outreach_sends" ADD COLUMN IF NOT EXISTS "failure_kind" text;
CREATE INDEX IF NOT EXISTS "idx_sends_failure_kind" ON "outreach_sends" ("failure_kind");

-- Backfill the suppression list from the damage already done: any lead whose
-- email was nulled by the old hard-bounce path is unrecoverable, but any lead
-- already marked bounced still has its address and should be suppressed rather
-- than silently retried.
INSERT INTO "suppressions" ("address", "reason", "source", "notes")
SELECT DISTINCT lower(trim(email)), 'hard_bounce', 'migration',
       'backfilled from leads.email_status'
  FROM "leads"
 WHERE email IS NOT NULL AND email_status = 'bounced'
ON CONFLICT ("address") DO NOTHING;
```

- [ ] **Step 2: Add the Drizzle definitions**

In `backend/src/db/schema.ts`, add these three columns inside the existing `leads` table definition, immediately after the `signals` column:

```ts
  // Normalised once on write, so routing never re-parses free text.
  phoneE164:      text("phone_e164"),
  phoneType:      text("phone_type", { enum: ["mobile", "landline", "unknown"] }),
  // Learned from outcomes: there is no compliant free WhatsApp presence check.
  whatsappStatus: text("whatsapp_status", { enum: ["unknown", "yes", "no"] }).notNull().default("unknown"),
```

Add `failureKind` inside the existing `outreachSends` table definition, after `error`:

```ts
  // transient | permanent | spam_reject | infra | suppressed — lets the UI say
  // WHY a send failed rather than only that it did.
  failureKind:  text("failure_kind"),
```

And add this new table after `outreachSends`:

```ts
// ── Suppressions ──────────────────────────────────────────
// Addresses that must never be emailed again.
//
// Replaces the previous hard-bounce handling, which set leads.email = NULL and
// destroyed the address — so the lead could never be corrected, and nothing
// recorded why it had gone. This is permanent, non-destructive, and keyed by
// address rather than by lead so a shared inbox is suppressed once.
export const suppressions = pgTable("suppressions", {
  address:   text("address").primaryKey(),
  reason:    text("reason", {
    enum: ["hard_bounce", "spam_reject", "complaint", "unsubscribe", "manual"],
  }).notNull(),
  source:    text("source"),
  notes:     text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  reasonIdx: index("idx_suppressions_reason").on(t.reason, t.createdAt),
}));
```

- [ ] **Step 3: Write the backfill script**

Create `backend/scripts/backfill-phones.ts`:

```ts
// One-off: normalise and classify every existing lead phone number.
//
// Reports counts before and after so the result is auditable rather than a
// silent mass update. Idempotent — re-running only touches rows whose stored
// normalisation differs from what the current rules produce.
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { normalisePhone, classifyPhone } from "../src/services/phone";

async function main() {
  const rows = await db.execute(sql`
    SELECT id, phone, phone_e164, phone_type FROM leads
     WHERE phone IS NOT NULL AND length(trim(phone)) > 0
  `);

  let changed = 0, unparseable = 0;
  const byType: Record<string, number> = { mobile: 0, landline: 0, unknown: 0 };

  for (const r of rows.rows as Array<Record<string, string | null>>) {
    const e164 = normalisePhone(r.phone);
    const type = classifyPhone(e164);
    if (!e164) unparseable++;
    byType[type] = (byType[type] ?? 0) + 1;

    if (r.phone_e164 === e164 && r.phone_type === type) continue;
    await db.execute(sql`
      UPDATE leads SET phone_e164 = ${e164}, phone_type = ${type}
       WHERE id = ${r.id}
    `);
    changed++;
  }

  console.log(`phones examined:  ${rows.rows.length}`);
  console.log(`rows updated:     ${changed}`);
  console.log(`unparseable:      ${unparseable}  (no country code — left null)`);
  console.log(`mobile:           ${byType.mobile}`);
  console.log(`landline:         ${byType.landline}`);
  console.log(`unknown:          ${byType.unknown}  (mostly +1, unclassifiable by design)`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Apply the migration locally and verify the columns exist**

Run:
```bash
cd backend
PGPASSWORD=seekers2026 psql -h localhost -U seekers -d seekersai -v ON_ERROR_STOP=1 -f src/db/migrations/0012_outreach_channels.sql
PGPASSWORD=seekers2026 psql -h localhost -U seekers -d seekersai -c "\d suppressions"
PGPASSWORD=seekers2026 psql -h localhost -U seekers -d seekersai -t -A -c "select column_name from information_schema.columns where table_name='leads' and column_name like 'phone%' or column_name='whatsapp_status'"
```
Expected: `suppressions` table printed; `phone`, `phone_e164`, `phone_type`, `whatsapp_status` listed.

- [ ] **Step 5: Run the backfill and check the counts are sane**

Run: `cd backend && npx tsx scripts/backfill-phones.ts`
Expected: `mobile` + `landline` + `unknown` sums to the examined count, and `unknown` is roughly the number of `+1` leads. On the local seeded DB the numbers will be small; on production expect ~575 examined.

- [ ] **Step 6: Typecheck and commit**

Run: `cd backend && npx tsc --noEmit && npx vitest run`
Expected: 0 errors, all tests pass.

```bash
git add backend/src/db/migrations/0012_outreach_channels.sql backend/src/db/schema.ts backend/scripts/backfill-phones.ts
git commit -m "Add phone routing columns, suppression list and failure classification

The suppression list replaces the old hard-bounce path, which set
leads.email = NULL and destroyed the address permanently — the lead could never
be corrected and nothing recorded why it had gone. Keyed by address, so a shared
inbox is suppressed once, and backfilled from leads already marked bounced.

whatsapp_status is the outcome-learning field: WhatsApp presence cannot be
checked compliantly for free, so it is learned from what happens when a human
actually tries the number.

Backfill script reports counts rather than silently mass-updating."
```

---

## Task 3: Pure channel resolution

**Files:**
- Create: `backend/src/services/channels.ts`
- Test: `backend/src/services/channels.test.ts`

**Interfaces:**
- Consumes: `PhoneType`, `describePhone` from Task 1.
- Produces:
  - `type ChannelKind = "whatsapp" | "email" | "call"`
  - `interface ChannelState { channel: ChannelKind; eligible: boolean; reason: string }`
  - `interface ChannelInput { email: string | null; emailStatus: string | null; phoneE164: string | null; phoneType: PhoneType | null; whatsappStatus: "unknown" | "yes" | "no" | null; emailSuppressed: boolean }`
  - `resolveChannels(lead: ChannelInput): ChannelState[]` — always length 3, ordered by priority.
  - `preferredChannel(lead: ChannelInput): ChannelKind | null` — first eligible, or null when unreachable.
  - `isUnreachable(lead: ChannelInput): boolean`

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/channels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveChannels, preferredChannel, isUnreachable, type ChannelInput } from "./channels";

const lead = (over: Partial<ChannelInput> = {}): ChannelInput => ({
  email:           "a@b.test",
  emailStatus:     null,
  phoneE164:       "+971501234567",
  phoneType:       "mobile",
  whatsappStatus:  "unknown",
  emailSuppressed: false,
  ...over,
});

describe("resolveChannels", () => {
  it("always returns the three channels in priority order", () => {
    expect(resolveChannels(lead()).map((c) => c.channel)).toEqual(["whatsapp", "email", "call"]);
  });

  it("prefers WhatsApp when the lead has both a mobile and an email", () => {
    // The explicit product rule: a mobile beats an email.
    expect(preferredChannel(lead())).toBe("whatsapp");
  });

  it("marks WhatsApp ineligible for a landline and says why", () => {
    const out = resolveChannels(lead({ phoneType: "landline" }));
    const wa = out.find((c) => c.channel === "whatsapp")!;
    expect(wa.eligible).toBe(false);
    expect(wa.reason).toMatch(/landline/i);
    expect(preferredChannel(lead({ phoneType: "landline" }))).toBe("email");
  });

  it("marks WhatsApp ineligible once a human has found no WhatsApp there", () => {
    const out = resolveChannels(lead({ whatsappStatus: "no" }));
    expect(out.find((c) => c.channel === "whatsapp")!.eligible).toBe(false);
    expect(out.find((c) => c.channel === "whatsapp")!.reason).toMatch(/not on whatsapp/i);
  });

  it("keeps WhatsApp eligible when a human has confirmed it", () => {
    const out = resolveChannels(lead({ whatsappStatus: "yes", phoneType: "unknown" }));
    // Confirmed by a human outranks an unclassifiable number, which is the
    // whole point of learning from outcomes — it rescues +1 leads.
    expect(out.find((c) => c.channel === "whatsapp")!.eligible).toBe(true);
  });

  it("treats an unclassifiable number as WhatsApp-eligible but flags the uncertainty", () => {
    const out = resolveChannels(lead({ phoneE164: "+12122851110", phoneType: "unknown" }));
    const wa = out.find((c) => c.channel === "whatsapp")!;
    expect(wa.eligible).toBe(true);
    expect(wa.reason).toMatch(/unknown/i);
  });

  it("marks email ineligible when suppressed", () => {
    const out = resolveChannels(lead({ emailSuppressed: true }));
    const em = out.find((c) => c.channel === "email")!;
    expect(em.eligible).toBe(false);
    expect(em.reason).toMatch(/suppress/i);
  });

  it("marks email ineligible when it has bounced", () => {
    const out = resolveChannels(lead({ emailStatus: "bounced" }));
    expect(out.find((c) => c.channel === "email")!.eligible).toBe(false);
  });

  it("marks email ineligible when absent", () => {
    const out = resolveChannels(lead({ email: null }));
    expect(out.find((c) => c.channel === "email")!.eligible).toBe(false);
    expect(out.find((c) => c.channel === "email")!.reason).toMatch(/no email/i);
  });

  it("allows a call on any usable number, including a landline", () => {
    const out = resolveChannels(lead({ phoneType: "landline" }));
    expect(out.find((c) => c.channel === "call")!.eligible).toBe(true);
  });

  it("marks call ineligible when the number could not be normalised", () => {
    const out = resolveChannels(lead({ phoneE164: null, phoneType: null }));
    const call = out.find((c) => c.channel === "call")!;
    expect(call.eligible).toBe(false);
    expect(call.reason).toMatch(/no usable number/i);
  });
});

describe("isUnreachable", () => {
  it("is false while any channel works", () => {
    expect(isUnreachable(lead())).toBe(false);
    expect(isUnreachable(lead({ email: null }))).toBe(false);
    expect(isUnreachable(lead({ phoneE164: null, phoneType: null }))).toBe(false);
  });

  it("is true when there is no email and no usable number", () => {
    expect(isUnreachable(lead({ email: null, phoneE164: null, phoneType: null }))).toBe(true);
  });

  it("is true when the only email is suppressed and there is no number", () => {
    expect(isUnreachable(lead({
      emailSuppressed: true, phoneE164: null, phoneType: null,
    }))).toBe(true);
  });

  it("returns null from preferredChannel when unreachable", () => {
    expect(preferredChannel(lead({ email: null, phoneE164: null, phoneType: null }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/channels.test.ts`
Expected: FAIL — `Failed to resolve import "./channels"`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/channels.ts`:

```ts
// Which channels can actually reach a lead, in the order we should try them.
//
// Pure and DB-free so it can be unit-tested and called from the scheduler, the
// API and the UI without three different implementations drifting apart.
//
// Priority is WhatsApp > email > call. That is a deliberate product decision for
// a Gulf-heavy list: 575 leads have a phone against 517 with an email, WhatsApp
// penetration across UAE/Saudi/Qatar/Jordan/Egypt runs 80-95%, and email on the
// current mailbox has produced 0 replies in 871 sends.
import { describePhone, type PhoneType } from "./phone";

export type ChannelKind = "whatsapp" | "email" | "call";

export interface ChannelState {
  channel:  ChannelKind;
  eligible: boolean;
  /** Human-readable, shown directly in the UI. */
  reason:   string;
}

export interface ChannelInput {
  email:           string | null;
  /** leads.email_status — "bounced" disqualifies. */
  emailStatus:     string | null;
  phoneE164:       string | null;
  phoneType:       PhoneType | null;
  whatsappStatus:  "unknown" | "yes" | "no" | null;
  /** Looked up from the suppression list by the caller. */
  emailSuppressed: boolean;
}

function whatsappState(lead: ChannelInput): ChannelState {
  const c = (eligible: boolean, reason: string): ChannelState =>
    ({ channel: "whatsapp", eligible, reason });

  if (!lead.phoneE164)             return c(false, "no usable number");
  // A human has already opened this chat and found nothing there.
  if (lead.whatsappStatus === "no") return c(false, "not on WhatsApp");
  // A human has confirmed it works — that outranks any classification, and is
  // what rescues +1 numbers we can never classify.
  if (lead.whatsappStatus === "yes") return c(true, "confirmed on WhatsApp");
  if (lead.phoneType === "landline") return c(false, "landline — WhatsApp not available");
  if (lead.phoneType === "mobile")   return c(true, describePhone(lead.phoneE164));
  // Unclassifiable (+1). Worth trying, but say so.
  return c(true, `${describePhone(lead.phoneE164)} — try it and record the result`);
}

function emailState(lead: ChannelInput): ChannelState {
  const c = (eligible: boolean, reason: string): ChannelState =>
    ({ channel: "email", eligible, reason });

  if (!lead.email || !lead.email.trim())  return c(false, "no email address");
  if (lead.emailSuppressed)               return c(false, "suppressed — never email this address");
  if (lead.emailStatus === "bounced")     return c(false, "previous send hard-bounced");
  return c(true, lead.email.trim());
}

function callState(lead: ChannelInput): ChannelState {
  const c = (eligible: boolean, reason: string): ChannelState =>
    ({ channel: "call", eligible, reason });

  if (!lead.phoneE164) return c(false, "no usable number");
  // A landline is perfectly callable, unlike WhatsApp.
  return c(true, lead.phoneE164);
}

/** All three channels, always, in priority order. */
export function resolveChannels(lead: ChannelInput): ChannelState[] {
  return [whatsappState(lead), emailState(lead), callState(lead)];
}

/** The channel to try first, or null when the lead cannot be reached at all. */
export function preferredChannel(lead: ChannelInput): ChannelKind | null {
  return resolveChannels(lead).find((c) => c.eligible)?.channel ?? null;
}

/**
 * No channel works.
 *
 * Worth its own name because such a lead must not be enrolled in a sequence —
 * it would sit there failing silently. Today it is invisible: a lead with no
 * working contact detail looks exactly like one waiting its turn.
 */
export function isUnreachable(lead: ChannelInput): boolean {
  return preferredChannel(lead) === null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/channels.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm no regression, then commit**

Run: `cd backend && npx vitest run && npx tsc --noEmit`

```bash
git add backend/src/services/channels.ts backend/src/services/channels.test.ts
git commit -m "Add pure channel resolution with WhatsApp > email > call priority

A deliberate product decision for a Gulf-heavy list: 575 leads have a phone
against 517 with an email, WhatsApp penetration across the five main countries
runs 80-95%, and email on the current mailbox has produced 0 replies in 871
sends.

A human-confirmed whatsapp_status='yes' outranks classification, which is what
rescues the ~137 +1 numbers that can never be classified from the dialling plan.

isUnreachable exists because such a lead must not be enrolled at all — today it
is invisible, looking identical to one simply waiting its turn."
```

---

## Task 4: Suppression service, and stop destroying bounced addresses

**Files:**
- Create: `backend/src/services/suppressions.ts`
- Modify: `backend/src/services/inbox.ts` (the `email: null` at line ~242)

**Interfaces:**
- Consumes: `suppressions` table from Task 2.
- Produces:
  - `isSuppressed(address: string): Promise<boolean>`
  - `suppressedSet(addresses: string[]): Promise<Set<string>>` — batch lookup, lowercased.
  - `suppress(input: { address: string; reason: SuppressionReason; source?: string; notes?: string }): Promise<void>`
  - `type SuppressionReason = "hard_bounce" | "spam_reject" | "complaint" | "unsubscribe" | "manual"`

- [ ] **Step 1: Write the service**

Create `backend/src/services/suppressions.ts`:

```ts
// The list of addresses that must never be emailed again.
//
// Replaces the previous behaviour, where a hard bounce set leads.email = NULL:
// that destroyed the address, made the lead uncorrectable, and recorded nothing
// about why it had vanished. Keyed by address rather than lead id, so a shared
// info@ inbox is suppressed once no matter how many leads share it.
import { inArray, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { suppressions } from "../db/schema";

export type SuppressionReason =
  | "hard_bounce" | "spam_reject" | "complaint" | "unsubscribe" | "manual";

const norm = (a: string) => a.trim().toLowerCase();

export async function isSuppressed(address: string): Promise<boolean> {
  if (!address?.trim()) return false;
  const [row] = await db
    .select({ address: suppressions.address })
    .from(suppressions)
    .where(eq(suppressions.address, norm(address)))
    .limit(1);
  return !!row;
}

/**
 * Batch lookup. The scheduler checks a page of enrollments at once, and one
 * query beats one per lead.
 */
export async function suppressedSet(addresses: string[]): Promise<Set<string>> {
  const wanted = [...new Set(addresses.filter(Boolean).map(norm))];
  if (wanted.length === 0) return new Set();
  const rows = await db
    .select({ address: suppressions.address })
    .from(suppressions)
    .where(inArray(suppressions.address, wanted));
  return new Set(rows.map((r) => r.address));
}

export async function suppress(input: {
  address: string;
  reason:  SuppressionReason;
  source?: string;
  notes?:  string;
}): Promise<void> {
  if (!input.address?.trim()) return;
  // First reason wins: a later complaint should not overwrite the original
  // hard bounce that explains why this address died.
  await db.execute(sql`
    INSERT INTO suppressions (address, reason, source, notes)
    VALUES (${norm(input.address)}, ${input.reason}, ${input.source ?? null}, ${input.notes ?? null})
    ON CONFLICT (address) DO NOTHING
  `);
}
```

- [ ] **Step 2: Read the current destructive bounce handler**

Run: `cd backend && sed -n '230,255p' src/services/inbox.ts`
Expected: a `db.update(leads).set({ email: null, ... })` block. Note the exact surrounding lines before editing.

- [ ] **Step 3: Replace the nulling with a suppression**

In `backend/src/services/inbox.ts`, change the hard-bounce handler so it no longer clears the address. Replace the `email: null` line and its `set({ ... })` object with:

```ts
        // Was `email: null`, which destroyed the address: the lead could never
        // be corrected, and nothing recorded why it had gone. Keep the address,
        // mark it bounced, and add a permanent suppression so it is never sent
        // to again.
        emailStatus: "bounced",
```

> **`bounced` is a new value for this column.** `leads.email_status` is plain
> text whose comment in `schema.ts:235` currently documents
> `verified | risky | invalid | unknown`, and `bounced` appears nowhere in the
> codebase today. There is no DB enum to widen, but leaving the comment stale
> would make the column's vocabulary a lie. In the same edit, update that comment
> to:
>
> ```ts
>   emailStatus:     text("email_status"),   // verified | risky | invalid | unknown | bounced
> ```
>
> `bounced` is kept distinct from `invalid` on purpose: `invalid` is a
> verification verdict about the address's syntax or MX, whereas `bounced` is an
> observed delivery failure. Only the second one justifies a suppression.

Immediately after that `db.update(leads)` call, add:

```ts
      await suppress({
        address: bouncedAddress,
        reason:  "hard_bounce",
        source:  "inbox_poller",
        notes:   diagnostic?.slice(0, 400) ?? null,
      });
```

Add the import at the top of the file:

```ts
import { suppress } from "./suppressions";
```

> If the local variable holding the bounced address is not named `bouncedAddress`, or the diagnostic is not named `diagnostic`, use whatever the surrounding code calls them — do not rename existing variables.

- [ ] **Step 4: Verify the address survives a bounce**

Run:
```bash
cd backend && npx tsc --noEmit
PGPASSWORD=seekers2026 psql -h localhost -U seekers -d seekersai -c \
  "insert into suppressions (address, reason, source) values ('probe@test.invalid','hard_bounce','manual') on conflict do nothing; select * from suppressions where address='probe@test.invalid'; delete from suppressions where address='probe@test.invalid';"
```
Expected: 0 type errors; the row inserts, selects and deletes cleanly.

- [ ] **Step 5: Commit**

Run: `cd backend && npx vitest run`

```bash
git add backend/src/services/suppressions.ts backend/src/services/inbox.ts
git commit -m "Suppress bounced addresses instead of deleting them

A hard bounce used to set leads.email = NULL. That destroyed the address, made
the lead impossible to correct, and left no record of why it had vanished.

Now the address is kept, email_status is set to bounced, and a permanent
suppression row records the reason and the SMTP diagnostic. Keyed by address, so
a shared info@ inbox is suppressed once however many leads share it."
```

---

## Task 5: Pure sending policy

**Files:**
- Create: `backend/src/services/sending-policy.ts`
- Test: `backend/src/services/sending-policy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type WarmupStage = "recovery" | "warmup" | "active"`
  - `dailyCapFor(stage: WarmupStage, cleanWeeks: number): number`
  - `releaseCount(input: { capRemaining: number; slotsRemaining: number }): number`
  - `nextSpreadSlot(from: Date, gapSeconds: number): Date`
  - `spreadGapSeconds(rand: () => number): number`
  - `slotsRemainingToday(now: Date): number`
  - `nextStageAfterSpamReject(): WarmupStage`
  - Constants `SEND_WINDOW_START_HOUR = 9`, `SEND_WINDOW_END_HOUR = 17`, `MIN_GAP_SECONDS = 90`, `MAX_GAP_SECONDS = 240`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/sending-policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  dailyCapFor, releaseCount, spreadGapSeconds, slotsRemainingToday,
  nextStageAfterSpamReject, nextSpreadSlot,
  MIN_GAP_SECONDS, MAX_GAP_SECONDS,
  SEND_WINDOW_START_HOUR, SEND_WINDOW_END_HOUR,
} from "./sending-policy";

describe("dailyCapFor", () => {
  it("starts at 5 a day in recovery", () => {
    // The domain is already burned by 871 sends, so recovery is the START state,
    // not a punishment reached later.
    expect(dailyCapFor("recovery", 0)).toBe(5);
    expect(dailyCapFor("recovery", 8)).toBe(5);
  });

  it("ramps warmup by 5 per clean week from a base of 10", () => {
    expect(dailyCapFor("warmup", 0)).toBe(10);
    expect(dailyCapFor("warmup", 1)).toBe(15);
    expect(dailyCapFor("warmup", 2)).toBe(20);
  });

  it("never lets warmup exceed the active ceiling", () => {
    expect(dailyCapFor("warmup", 100)).toBe(40);
  });

  it("caps active sending at 40 a day", () => {
    expect(dailyCapFor("active", 0)).toBe(40);
    expect(dailyCapFor("active", 50)).toBe(40);
  });
});

describe("releaseCount", () => {
  it("spreads the remaining allowance across the remaining slots", () => {
    expect(releaseCount({ capRemaining: 20, slotsRemaining: 4 })).toBe(5);
  });

  it("releases everything in the final slot", () => {
    expect(releaseCount({ capRemaining: 7, slotsRemaining: 1 })).toBe(7);
  });

  it("rounds down so the cap is never exceeded", () => {
    expect(releaseCount({ capRemaining: 7, slotsRemaining: 4 })).toBe(1);
  });

  it("still releases one when the allowance is thinner than the slots", () => {
    // Rounding down to 0 would stall sending entirely for the rest of the day.
    expect(releaseCount({ capRemaining: 2, slotsRemaining: 8 })).toBe(1);
  });

  it("releases nothing once the cap is used up", () => {
    expect(releaseCount({ capRemaining: 0, slotsRemaining: 5 })).toBe(0);
    expect(releaseCount({ capRemaining: -3, slotsRemaining: 5 })).toBe(0);
  });

  it("releases nothing when there are no slots left", () => {
    expect(releaseCount({ capRemaining: 10, slotsRemaining: 0 })).toBe(0);
  });
});

describe("spreadGapSeconds", () => {
  it("stays inside the configured bounds", () => {
    expect(spreadGapSeconds(() => 0)).toBe(MIN_GAP_SECONDS);
    expect(spreadGapSeconds(() => 0.999)).toBeLessThanOrEqual(MAX_GAP_SECONDS);
    expect(spreadGapSeconds(() => 0.5)).toBeGreaterThan(MIN_GAP_SECONDS);
  });
});

describe("nextSpreadSlot", () => {
  it("adds the gap to the given instant", () => {
    const from = new Date("2026-08-03T09:00:00Z");
    expect(nextSpreadSlot(from, 120).getTime() - from.getTime()).toBe(120_000);
  });
});

describe("slotsRemainingToday", () => {
  it("counts whole hours left in the Cairo send window", () => {
    // 09:00 Cairo = 06:00 UTC in summer (UTC+3).
    const nineCairo = new Date("2026-08-03T06:00:00Z");
    expect(slotsRemainingToday(nineCairo)).toBe(SEND_WINDOW_END_HOUR - SEND_WINDOW_START_HOUR);
  });

  it("returns 0 before the window opens", () => {
    const sixCairo = new Date("2026-08-03T03:00:00Z");
    expect(slotsRemainingToday(sixCairo)).toBe(0);
  });

  it("returns 0 after the window closes", () => {
    const eighteenCairo = new Date("2026-08-03T15:00:00Z");
    expect(slotsRemainingToday(eighteenCairo)).toBe(0);
  });
});

describe("nextStageAfterSpamReject", () => {
  it("drops straight to recovery", () => {
    expect(nextStageAfterSpamReject()).toBe("recovery");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/services/sending-policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/sending-policy.ts`:

```ts
// How much may be sent, and when.
//
// Pure arithmetic, no DB, so the rules are testable in isolation. Existing
// behaviour put every due send in one batch at noon Cairo — which is itself a
// bulk-sender signal, and produced 30 outright rejections from the mailbox
// provider's own outbound filter.
//
// The provider is unchanged by explicit decision, so the only lever available is
// volume and shape: send less, spread it out, and back off automatically the
// moment a spam rejection appears.

export type WarmupStage = "recovery" | "warmup" | "active";

/** Cairo-local hours during which sending is allowed. */
export const SEND_WINDOW_START_HOUR = 9;
export const SEND_WINDOW_END_HOUR   = 17;

export const MIN_GAP_SECONDS = 90;
export const MAX_GAP_SECONDS = 240;

const RECOVERY_CAP   = 5;
const WARMUP_BASE    = 10;
const WARMUP_STEP    = 5;
const ACTIVE_CEILING = 40;

const CAIRO_TZ = "Africa/Cairo";

/**
 * Daily cap for a stage.
 *
 * `recovery` is the STARTING stage, not a penalty: 871 sends have already gone
 * out from this domain and 30 were rejected as spam, so the sender begins in the
 * hole rather than fresh.
 */
export function dailyCapFor(stage: WarmupStage, cleanWeeks: number): number {
  if (stage === "recovery") return RECOVERY_CAP;
  if (stage === "active")   return ACTIVE_CEILING;
  return Math.min(ACTIVE_CEILING, WARMUP_BASE + WARMUP_STEP * Math.max(0, cleanWeeks));
}

/**
 * How many to release on this tick.
 *
 * Floors, so the daily cap can never be exceeded — but never floors to zero
 * while allowance and slots both remain, or a thin allowance spread over many
 * slots would stall sending for the whole day.
 */
export function releaseCount(input: { capRemaining: number; slotsRemaining: number }): number {
  const { capRemaining, slotsRemaining } = input;
  if (capRemaining <= 0 || slotsRemaining <= 0) return 0;
  return Math.max(1, Math.floor(capRemaining / slotsRemaining));
}

/** Randomised gap, so sends do not land on a detectable fixed rhythm. */
export function spreadGapSeconds(rand: () => number = Math.random): number {
  return Math.round(MIN_GAP_SECONDS + rand() * (MAX_GAP_SECONDS - MIN_GAP_SECONDS));
}

export function nextSpreadSlot(from: Date, gapSeconds: number): Date {
  return new Date(from.getTime() + gapSeconds * 1000);
}

/** Whole hours left in today's Cairo send window. 0 outside it. */
export function slotsRemainingToday(now: Date): number {
  const hour = Number(
    now.toLocaleString("en-US", { timeZone: CAIRO_TZ, hour: "2-digit", hour12: false }),
  );
  if (hour < SEND_WINDOW_START_HOUR) return 0;
  if (hour >= SEND_WINDOW_END_HOUR)  return 0;
  return SEND_WINDOW_END_HOUR - hour;
}

/**
 * A spam rejection means the provider is actively refusing us. Continuing at the
 * same rate makes it worse, so drop to the floor immediately and let the ramp
 * earn the volume back.
 */
export function nextStageAfterSpamReject(): WarmupStage {
  return "recovery";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/services/sending-policy.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm no regression, then commit**

Run: `cd backend && npx vitest run && npx tsc --noEmit`

```bash
git add backend/src/services/sending-policy.ts backend/src/services/sending-policy.test.ts
git commit -m "Add pure sending policy: caps, spread window and warmup ramp

Every due send previously fired in one batch at noon Cairo, which is itself a
bulk-sender signal and drew 30 outright rejections from the provider's outbound
filter. The provider is unchanged by decision, so the only levers are volume and
shape.

recovery (5/day) is the STARTING stage, not a penalty reached later: 871 sends
have already gone from this domain, so the sender begins in the hole.

releaseCount never floors to zero while allowance and slots both remain — that
would stall sending for the rest of the day."
```

---

## Task 6: Enforce policy and suppression in the scheduler

**Files:**
- Modify: `backend/src/services/outreach.ts`

**Interfaces:**
- Consumes: `dailyCapFor`, `releaseCount`, `slotsRemainingToday`, `spreadGapSeconds`, `nextSpreadSlot`, `nextStageAfterSpamReject` (Task 5); `suppressedSet`, `suppress` (Task 4).
- Produces: `isSpamRejection(msg: string): boolean`; `processDueSends` honours caps, spread and suppression; failures record `failureKind`.

- [ ] **Step 1: Add the spam-rejection classifier next to the existing classifiers**

In `backend/src/services/outreach.ts`, immediately after `isPermanentSendError` (around line 186), add:

```ts
// The provider's own outbound filter refusing us, as distinct from the
// recipient's server rejecting a bad address. Namecheap returns
// "554 5.7.1 ... JFE040023" when it decides a message looks like bulk.
//
// This is the signal that matters most: it means continuing at the current rate
// will make things worse, so the mailbox drops to the recovery cap.
function isSpamRejection(msg: string): boolean {
  return /\b554\b|JFE\d+|spam|blocked|blacklist|reputation|bulk/i.test(msg);
}

/** Bucket a failure so the UI can explain it rather than just reporting "failed". */
function classifyFailure(msg: string): "spam_reject" | "permanent" | "infra" | "transient" {
  if (isSpamRejection(msg))       return "spam_reject";
  if (isPermanentSendError(msg))  return "permanent";
  if (isRecoverableInfraError(msg)) return "infra";
  return "transient";
}
```

- [ ] **Step 2: Add the cap gate at the top of `processDueSends`**

Replace the opening of `processDueSends` (currently `const now = new Date();` followed by the `due` query) with:

```ts
export async function processDueSends(limit = 20): Promise<{ processed: number; sent: number; failed: number; throttled: number }> {
  const now = new Date();

  // ── Volume gate ───────────────────────────────────────
  // Outside the Cairo send window, or over today's cap, nothing goes out. This
  // replaces the previous behaviour of releasing every due enrollment at once.
  const slots = slotsRemainingToday(now);
  if (slots === 0) {
    return { processed: 0, sent: 0, failed: 0, throttled: 0 };
  }

  const [mailbox] = await db.select().from(mailboxes).limit(1);
  const stage = (mailbox?.warmupStage ?? "recovery") as WarmupStage;
  const cap   = mailbox?.dailyCap && mailbox.dailyCap > 0
    ? mailbox.dailyCap
    : dailyCapFor(stage, cleanWeeksFor(mailbox));

  // Authoritative count: derived from the sends table for the current Cairo
  // day, never from a stored counter — a counter drifts across restarts and
  // double-sends, and this number decides whether we breach the cap.
  const [{ sentTodayCount }] = await db
    .select({ sentTodayCount: sql<number>`COUNT(*)::int` })
    .from(outreachSends)
    .where(and(
      eq(outreachSends.status, "sent"),
      sql`(${outreachSends.sentAt} AT TIME ZONE 'Africa/Cairo')::date
          = (NOW() AT TIME ZONE 'Africa/Cairo')::date`,
    ));

  const release = releaseCount({
    capRemaining:   cap - Number(sentTodayCount),
    slotsRemaining: slots,
  });
  if (release === 0) {
    return { processed: 0, sent: 0, failed: 0, throttled: 1 };
  }

  const due = await db
    .select()
    .from(outreachEnrollments)
    .where(and(
      eq(outreachEnrollments.status, "active"),
      lte(outreachEnrollments.nextSendAt, now),
    ))
    .limit(Math.min(limit, release));

  let sent = 0;
  let failed = 0;
  let throttled = 0;
```

Then, still inside `processDueSends`, keep the existing `for (const enrollment of due)` loop body unchanged, and change the final `return` to include the new counter:

```ts
  return { processed: due.length, sent, failed, throttled };
```

- [ ] **Step 3: Add the helper and imports**

Near the top of `backend/src/services/outreach.ts`, add to the existing schema import list: `mailboxes`, `suppressions`. Then add these imports:

```ts
import {
  dailyCapFor, releaseCount, slotsRemainingToday, spreadGapSeconds,
  nextSpreadSlot, nextStageAfterSpamReject, type WarmupStage,
} from "./sending-policy";
import { suppress, suppressedSet } from "./suppressions";
```

And add this helper beside `classifyFailure`:

```ts
/**
 * Whole clean weeks since the mailbox last changed stage, which is what the
 * warmup ramp is paid out against. Missing timestamp means "just started".
 */
function cleanWeeksFor(mailbox: typeof mailboxes.$inferSelect | undefined): number {
  if (!mailbox?.updatedAt) return 0;
  const ms = Date.now() - new Date(mailbox.updatedAt).getTime();
  return Math.max(0, Math.floor(ms / (7 * 86_400_000)));
}
```

- [ ] **Step 4: Block suppressed addresses and record the failure kind**

Inside `processSingleSend`, immediately before the email is actually sent (after the recipient address is known and before the `sendOutreachEmail` call), add:

```ts
  // Never send to a suppressed address. Checked here rather than only at
  // enrolment because an address can be suppressed mid-sequence by a bounce.
  if (await isSuppressedAddress(recipient)) {
    await db.insert(outreachSends).values({
      enrollmentId: enrollment.id,
      stepId:       step.id,
      channel:      "email",
      status:       "failed",
      error:        "Address is on the suppression list",
      failureKind:  "suppressed",
    });
    await db.update(outreachEnrollments)
      .set({ status: "failed", pausedReason: "Address suppressed", nextSendAt: null })
      .where(eq(outreachEnrollments.id, enrollment.id));
    return "failed";
  }
```

Add near the other helpers:

```ts
async function isSuppressedAddress(address: string): Promise<boolean> {
  return (await suppressedSet([address])).size > 0;
}
```

In `handleSendFailure`, add `failureKind` to the `outreachSends` insert and downgrade the mailbox on a spam rejection. Change the existing insert to:

```ts
  const kind = classifyFailure(msg);

  await db.insert(outreachSends).values({
    enrollmentId: enrollment.id,
    stepId:       step.id,
    channel:      "email",
    subject:      null,
    body:         null,
    status:       "failed",
    error:        msg.slice(0, 1000),
    failureKind:  kind,
  });

  // The provider is refusing us. Continuing at this rate makes it worse, so
  // drop the mailbox to the recovery cap and suppress the address that drew it.
  if (kind === "spam_reject") {
    await db.update(mailboxes)
      .set({ warmupStage: nextStageAfterSpamReject(), updatedAt: new Date() });
    const [lead] = await db.select({ email: leads.email }).from(leads)
      .innerJoin(outreachEnrollments, eq(outreachEnrollments.leadId, leads.id))
      .where(eq(outreachEnrollments.id, enrollment.id)).limit(1);
    if (lead?.email) {
      await suppress({
        address: lead.email, reason: "spam_reject",
        source: "scheduler", notes: msg.slice(0, 400),
      });
    }
  }
```

- [ ] **Step 5: Seed the mailbox row on boot**

In `backend/src/index.ts`, before the inbox-poller `setInterval`, add:

```ts
// The mailboxes table exists but ships empty, and the daily cap has nowhere to
// live without a row. Idempotent: only ever inserts the configured sender.
void (async () => {
  const address = process.env.EMAIL_FROM;
  if (!address) return;
  try {
    await db.execute(sql`
      INSERT INTO mailboxes (address, daily_cap, warmup_stage)
      VALUES (${address}, 0, 'recovery')
      ON CONFLICT (address) DO NOTHING
    `);
  } catch (e: any) {
    console.error("[boot] could not seed mailbox:", e?.message);
  }
})();
```

> `daily_cap = 0` means "use the stage default"; the gate in Task 6 Step 2 only honours a stored cap when it is greater than zero.

- [ ] **Step 6: Verify the gate holds**

Run:
```bash
cd backend && npx tsc --noEmit && npx vitest run
PGPASSWORD=seekers2026 psql -h localhost -U seekers -d seekersai -c \
  "select address, daily_cap, warmup_stage from mailboxes"
```
Expected: 0 type errors, all tests pass. Start the API (`npx tsx src/index.ts`) once and re-run the psql query — exactly one row for `EMAIL_FROM` with `warmup_stage = recovery`.

Then confirm the window gate by calling the tick outside 09:00–17:00 Cairo:
```bash
curl -s -X POST http://localhost:3000/api/v1/outreach/scheduler/tick \
  -H "Authorization: Bearer $TOKEN" | head -c 200
```
Expected outside the window: `{"processed":0,...,"throttled":0}`. Inside the window with the recovery cap already used: `"throttled":1`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/outreach.ts backend/src/index.ts
git commit -m "Gate sending on daily caps, the Cairo window and the suppression list

Every due enrollment used to be released at once at noon, which is a
bulk-sender signal and drew 30 provider rejections. Sending is now capped per
day by warmup stage, released a slice at a time across a 09:00-17:00 Cairo
window, and blocked outright for suppressed addresses.

Today's count is derived from outreach_sends for the current Cairo day, never
from mailboxes.sent_today — a stored counter drifts across restarts and
double-sends, and this is the number that decides whether the cap is breached.

A 554/JFE spam rejection now drops the mailbox to the recovery cap
automatically and suppresses the address that drew it, instead of continuing at
a rate the provider is actively refusing."
```

---

## Task 7: Domain authentication check

**Files:**
- Create: `backend/src/services/domain-auth.ts`

**Interfaces:**
- Consumes: nothing (Node built-in `dns/promises`).
- Produces:
  - `interface AuthRecord { record: "SPF" | "DKIM" | "DMARC"; pass: boolean; value: string | null; problem: string | null }`
  - `checkDomainAuth(domain: string, dkimSelector?: string): Promise<AuthRecord[]>`

- [ ] **Step 1: Write the implementation**

Create `backend/src/services/domain-auth.ts`:

```ts
// SPF / DKIM / DMARC presence and sanity, over DNS.
//
// Read-only, free, and uses Node's built-in resolver — no dependency and no
// paid reputation service. Missing DMARC in particular is the single cheapest
// deliverability fix available and is invisible today.
import { resolveTxt } from "dns/promises";

export interface AuthRecord {
  record:  "SPF" | "DKIM" | "DMARC";
  pass:    boolean;
  value:   string | null;
  /** Why it fails, in words the reader can act on. Null when it passes. */
  problem: string | null;
}

/** TXT records arrive as arrays of chunks that must be joined before matching. */
async function txt(name: string): Promise<string[]> {
  try {
    return (await resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch {
    // NXDOMAIN and ENODATA both mean "not published", which is the answer.
    return [];
  }
}

async function checkSpf(domain: string): Promise<AuthRecord> {
  const records = (await txt(domain)).filter((r) => r.toLowerCase().startsWith("v=spf1"));
  if (records.length === 0) {
    return { record: "SPF", pass: false, value: null,
      problem: "No SPF record. Receivers cannot tell which servers may send as this domain." };
  }
  if (records.length > 1) {
    return { record: "SPF", pass: false, value: records.join(" | "),
      problem: "More than one SPF record. Receivers treat this as a permanent error and may reject every message." };
  }
  const value = records[0];
  if (/\+all/i.test(value)) {
    return { record: "SPF", pass: false, value,
      problem: "Ends in +all, which authorises the entire internet to send as this domain." };
  }
  if (!/[~-]all/i.test(value)) {
    return { record: "SPF", pass: false, value,
      problem: "No ~all or -all, so unlisted senders are neither softfailed nor rejected." };
  }
  return { record: "SPF", pass: true, value, problem: null };
}

async function checkDkim(domain: string, selector: string): Promise<AuthRecord> {
  const name = `${selector}._domainkey.${domain}`;
  const records = (await txt(name)).filter((r) => /(^|;)\s*v=DKIM1/i.test(r) || /p=/.test(r));
  if (records.length === 0) {
    return { record: "DKIM", pass: false, value: null,
      problem: `No DKIM key at ${name}. Messages cannot be cryptographically signed, so any relay can forge them.` };
  }
  const value = records[0];
  if (/(^|;)\s*p=\s*(;|$)/.test(value)) {
    return { record: "DKIM", pass: false, value,
      problem: "The key is published but empty (p=), which revokes it." };
  }
  return { record: "DKIM", pass: true, value, problem: null };
}

async function checkDmarc(domain: string): Promise<AuthRecord> {
  const records = (await txt(`_dmarc.${domain}`)).filter((r) => /^v=DMARC1/i.test(r));
  if (records.length === 0) {
    return { record: "DMARC", pass: false, value: null,
      problem: "No DMARC record. Nothing tells receivers what to do when SPF or DKIM fails, and no reports come back." };
  }
  const value = records[0];
  const policy = /p=\s*(none|quarantine|reject)/i.exec(value)?.[1]?.toLowerCase();
  if (!policy) {
    return { record: "DMARC", pass: false, value,
      problem: "DMARC record has no p= policy, so it does nothing." };
  }
  if (policy === "none") {
    // Not a failure: p=none is the correct first step, and moving straight to
    // quarantine before reading reports breaks legitimate mail.
    return { record: "DMARC", pass: true, value,
      problem: "Policy is p=none — monitoring only. Move to quarantine once the reports look clean." };
  }
  return { record: "DMARC", pass: true, value, problem: null };
}

/**
 * All three records for a domain. Runs in parallel — three independent DNS
 * lookups have no reason to be serial.
 */
export async function checkDomainAuth(
  domain: string,
  dkimSelector = process.env.DKIM_SELECTOR ?? "default",
): Promise<AuthRecord[]> {
  const clean = domain.trim().toLowerCase().replace(/^@/, "");
  return Promise.all([
    checkSpf(clean),
    checkDkim(clean, dkimSelector),
    checkDmarc(clean),
  ]);
}
```

- [ ] **Step 2: Verify against a real domain**

Run:
```bash
cd backend && npx tsx -e "
import { checkDomainAuth } from './src/services/domain-auth';
checkDomainAuth('seekersai.org').then(r => console.log(JSON.stringify(r, null, 2)));
"
```
Expected: three records printed. SPF likely passes (Namecheap publishes one); DMARC very likely reports "No DMARC record".

Also confirm a domain with no records does not throw:
```bash
npx tsx -e "
import { checkDomainAuth } from './src/services/domain-auth';
checkDomainAuth('nonexistent-domain-xyz.invalid').then(r => console.log(r.map(x => x.record + ':' + x.pass).join(' ')));
"
```
Expected: `SPF:false DKIM:false DMARC:false`, no exception.

- [ ] **Step 3: Typecheck and commit**

Run: `cd backend && npx tsc --noEmit && npx vitest run`

```bash
git add backend/src/services/domain-auth.ts
git commit -m "Add SPF/DKIM/DMARC checking over DNS

Read-only, free, using Node's built-in resolver — no dependency and no paid
reputation service. Missing DMARC is the cheapest deliverability fix available
and is currently invisible.

Each failure explains what it means for the reader rather than reporting a bare
boolean: two SPF records is a permanent error that can reject every message,
+all authorises the whole internet, and an empty p= revokes the DKIM key.

p=none counts as a pass with a note: it is the correct first step, and jumping
to quarantine before reading reports breaks legitimate mail."
```

---

## Task 8: Deliverability API and panel

**Files:**
- Modify: `backend/src/routes/outreach.ts`
- Create: `Frontend/src/hooks/useDeliverability.ts`
- Create: `Frontend/src/components/modules/outbound/DeliverabilityPanel.tsx`
- Modify: `Frontend/src/pages/Outbound.tsx`

**Interfaces:**
- Consumes: `checkDomainAuth` (Task 7), `dailyCapFor`/`slotsRemainingToday` (Task 5), `suppressions` table (Task 2).
- Produces: `GET /outreach/deliverability` returning `{ mailbox, auth, suppressions, failures }`; hook `useDeliverability()`.

- [ ] **Step 1: Add the endpoint**

In `backend/src/routes/outreach.ts`, add before the final `export default outreach;`:

```ts
// ── GET /outreach/deliverability ──────────────────────────
// Everything needed to answer "is our sending healthy?" in one request: the
// mailbox and its cap, the three DNS records, the suppression list size, and
// recent failures grouped by cause.
outreach.get("/deliverability", authMiddleware, adminOnly, async (c) => {
  const [mailbox] = await db.select().from(mailboxes).limit(1);
  const address = mailbox?.address ?? process.env.EMAIL_FROM ?? "";
  const domain  = address.split("@")[1] ?? "";

  const [auth, sentToday, suppressionRows, failureRows] = await Promise.all([
    domain ? checkDomainAuth(domain) : Promise.resolve([]),

    db.select({ n: sql<number>`COUNT(*)::int` })
      .from(outreachSends)
      .where(and(
        eq(outreachSends.status, "sent"),
        sql`(${outreachSends.sentAt} AT TIME ZONE 'Africa/Cairo')::date
            = (NOW() AT TIME ZONE 'Africa/Cairo')::date`,
      )),

    db.select({ reason: suppressions.reason, n: sql<number>`COUNT(*)::int` })
      .from(suppressions)
      .groupBy(suppressions.reason),

    db.select({
      kind: outreachSends.failureKind,
      n:    sql<number>`COUNT(*)::int`,
      latest: sql<string>`MAX(${outreachSends.error})`,
    })
      .from(outreachSends)
      .where(and(
        eq(outreachSends.status, "failed"),
        sql`${outreachSends.sentAt} > NOW() - INTERVAL '30 days'`,
      ))
      .groupBy(outreachSends.failureKind),
  ]);

  const stage = (mailbox?.warmupStage ?? "recovery") as WarmupStage;
  const cap   = mailbox?.dailyCap && mailbox.dailyCap > 0
    ? mailbox.dailyCap : dailyCapFor(stage, 0);

  return c.json({
    mailbox: {
      address,
      domain,
      warmup_stage: stage,
      daily_cap:    cap,
      sent_today:   Number(sentToday[0]?.n ?? 0),
      slots_left:   slotsRemainingToday(new Date()),
    },
    auth,
    suppressions: {
      total:     suppressionRows.reduce((s, r) => s + Number(r.n), 0),
      by_reason: suppressionRows.map((r) => ({ reason: r.reason, count: Number(r.n) })),
    },
    failures: failureRows.map((r) => ({
      kind: r.kind ?? "unclassified",
      count: Number(r.n),
      example: r.latest,
    })),
  });
});
```

Add to the imports at the top of the file:

```ts
import { checkDomainAuth } from "../services/domain-auth";
import { dailyCapFor, slotsRemainingToday, type WarmupStage } from "../services/sending-policy";
```

and add `mailboxes, suppressions` to the existing schema import list.

- [ ] **Step 2: Add the hook**

Create `Frontend/src/hooks/useDeliverability.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface AuthRecord {
  record: "SPF" | "DKIM" | "DMARC";
  pass: boolean;
  value: string | null;
  problem: string | null;
}

export interface Deliverability {
  mailbox: {
    address: string;
    domain: string;
    warmup_stage: "recovery" | "warmup" | "active";
    daily_cap: number;
    sent_today: number;
    slots_left: number;
  };
  auth: AuthRecord[];
  suppressions: { total: number; by_reason: { reason: string; count: number }[] };
  failures: { kind: string; count: number; example: string | null }[];
}

export function useDeliverability() {
  return useQuery<Deliverability>({
    queryKey: ["outreach", "deliverability"],
    queryFn:  () => apiFetch("/outreach/deliverability"),
    // DNS answers and daily counts do not change minute to minute.
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 3: Build the panel**

Create `Frontend/src/components/modules/outbound/DeliverabilityPanel.tsx`:

```tsx
// "Is our sending healthy?" in one screen.
//
// Exists because the failure modes were previously invisible: 30 sends were
// rejected by the provider's own filter and nothing surfaced it, and the domain
// has no DMARC record with nothing anywhere to say so.
import { ShieldCheck, ShieldAlert, Gauge, Ban, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeliverability } from "@/hooks/useDeliverability";
import { cn } from "@/lib/utils";

const STAGE_COPY: Record<string, string> = {
  recovery: "Recovering — reduced volume after a provider rejection",
  warmup:   "Warming up — volume increases each clean week",
  active:   "Active — at the steady ceiling",
};

export function DeliverabilityPanel() {
  const { data, isLoading, isError } = useDeliverability();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }
  if (isError || !data) return null;

  const { mailbox, auth, suppressions, failures } = data;
  const used = mailbox.daily_cap > 0
    ? Math.min(100, Math.round((mailbox.sent_today / mailbox.daily_cap) * 100))
    : 0;

  return (
    <div className="space-y-3">
      {/* Volume */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10">
            <Gauge className="h-4 w-4 text-primary" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                {mailbox.sent_today} of {mailbox.daily_cap} sent today
              </p>
              <Badge variant="outline" className="text-[10px] uppercase">
                {mailbox.warmup_stage}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {STAGE_COPY[mailbox.warmup_stage]}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", used >= 100 ? "bg-warning" : "bg-primary")}
                style={{ width: `${used}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {mailbox.address} · {mailbox.slots_left > 0
                ? `${mailbox.slots_left}h left in today's send window`
                : "outside the 09:00–17:00 Cairo send window"}
            </p>
          </div>
        </div>
      </Card>

      {/* Domain authentication */}
      <Card className="overflow-hidden">
        <div className="border-b border-border/60 px-4 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Domain authentication · {mailbox.domain}
          </p>
        </div>
        <ul>
          {auth.map((r) => (
            <li key={r.record} className="flex items-start gap-3 border-b border-border/30 px-4 py-2.5 last:border-0">
              {r.pass
                ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">{r.record}</p>
                {r.problem && (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{r.problem}</p>
                )}
                {r.value && (
                  <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground/70">{r.value}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Suppressions + failures */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Ban className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Suppressed
            </p>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {suppressions.total}
          </p>
          <p className="text-[11px] text-muted-foreground">
            addresses that will never be emailed again
          </p>
          {suppressions.by_reason.length > 0 && (
            <ul className="mt-2 space-y-1">
              {suppressions.by_reason.map((r) => (
                <li key={r.reason} className="flex justify-between text-[11px] text-muted-foreground">
                  <span>{r.reason.replace(/_/g, " ")}</span>
                  <span className="tabular-nums">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Failures · 30 days
            </p>
          </div>
          {failures.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No failed sends.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {failures.map((f) => (
                <li key={f.kind}>
                  <div className="flex justify-between text-[11px]">
                    <span className="font-medium text-foreground">{f.kind.replace(/_/g, " ")}</span>
                    <span className="tabular-nums text-muted-foreground">{f.count}</span>
                  </div>
                  {f.example && (
                    <p className="mt-0.5 line-clamp-2 font-mono text-[10px] text-muted-foreground/70">
                      {f.example}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount it on Outbound**

In `Frontend/src/pages/Outbound.tsx`, add the import:

```tsx
import { DeliverabilityPanel } from "@/components/modules/outbound/DeliverabilityPanel";
```

Add a `TabsTrigger` beside the existing ones:

```tsx
          <TabsTrigger value="deliverability">Deliverability</TabsTrigger>
```

and a matching `TabsContent` beside the others:

```tsx
        <TabsContent value="deliverability" className="mt-4">
          <DeliverabilityPanel />
        </TabsContent>
```

- [ ] **Step 5: Verify in the browser**

Run: `cd backend && npx tsx watch src/index.ts` and `cd Frontend && npx vite`
Then open `http://localhost:5173/outbound`, choose the Deliverability tab.
Expected: the volume card shows `0 of 5 sent today` with stage `recovery`; the domain card lists SPF/DKIM/DMARC with DMARC almost certainly failing; suppressions and failures render without error.

- [ ] **Step 6: Typecheck both sides and commit**

Run:
```bash
cd backend && npx tsc --noEmit && npx vitest run
cd ../Frontend && npx tsc --noEmit -p tsconfig.app.json && npx vitest run
```
Expected: 0 errors both sides; 31 backend and 28 frontend tests still pass.

```bash
git add backend/src/routes/outreach.ts Frontend/src/hooks/useDeliverability.ts \
        Frontend/src/components/modules/outbound/DeliverabilityPanel.tsx Frontend/src/pages/Outbound.tsx
git commit -m "Add a deliverability panel: volume, DNS auth, suppressions, failures

These failure modes were invisible. 30 sends were rejected by the provider's own
outbound filter with nothing surfacing it, and the sending domain has no DMARC
record with nothing anywhere to say so.

One request answers 'is our sending healthy' — today's volume against the cap
and stage, the three DNS records with what each failure actually means,
suppression counts by reason, and 30 days of failures grouped by cause with a
real SMTP message rather than a bare 'failed'."
```

---

## Task 9: Manual channel steps that block the sequence

**Files:**
- Modify: `backend/src/services/outreach.ts` (the non-email skip at lines ~353-355)
- Modify: `backend/src/db/migrations/0012_outreach_channels.sql` — already created in Task 2; add the enum widening below
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/services/worklist-ranking.ts`

**Interfaces:**
- Consumes: `resolveChannels` (Task 3).
- Produces: enrollment status `awaiting_action`; step channels `whatsapp`/`call`; worklist action type `manual_touch` carrying `{ enrollmentId, channel, message, phoneE164, leadName, leadCompany }`.

- [ ] **Step 1: Widen the enums in the migration**

Append to `backend/src/db/migrations/0012_outreach_channels.sql`:

```sql
-- ── Manual channels ───────────────────────────────────────
-- status and channel are text columns with Drizzle-side enums, so widening the
-- allowed values needs no DDL. Recorded here so the intent is not invisible:
--   outreach_steps.channel        += whatsapp | call
--   outreach_enrollments.status   += awaiting_action
--
-- awaiting_action is deliberately distinct from paused: a sequence waiting on a
-- human is not a sequence that has failed, and conflating them made a stalled
-- enrollment look like a broken one.
CREATE INDEX IF NOT EXISTS "idx_enrollments_awaiting"
  ON "outreach_enrollments" ("status", "next_send_at")
  WHERE "status" = 'awaiting_action';
```

- [ ] **Step 2: Widen the Drizzle enums**

In `backend/src/db/schema.ts`, change the `outreachSteps.channel` definition to:

```ts
  channel:         text("channel", {
    // whatsapp and call are MANUAL: the scheduler raises a task instead of
    // sending, because a human has to press send.
    enum: ["email", "linkedin", "note", "whatsapp", "call"],
  }).notNull().default("email"),
```

and `outreachEnrollments.status` to:

```ts
  status: text("status", {
    // awaiting_action: blocked on a human completing a manual step. Distinct
    // from paused, which means something went wrong.
    enum: ["active", "paused", "completed", "failed", "replied", "awaiting_action"],
  }).notNull().default("active"),
```

- [ ] **Step 3: Replace the silent skip with a block**

In `backend/src/services/outreach.ts`, find the existing three lines (around 353):

```ts
  if (step.channel !== "email") {
    await advanceStep(enrollment, steps);
    return "advanced";
  }
```

Replace them with:

```ts
  // Manual channels do not send. They raise a task and STOP.
  //
  // Previously any non-email step was silently advanced past, so a sequence
  // containing a LinkedIn or note step quietly skipped it — the cadence the
  // author designed was not the cadence that ran. A manual step now blocks:
  // the next step does not fire until a human records an outcome.
  if (MANUAL_CHANNELS.has(step.channel)) {
    await db.update(outreachEnrollments)
      .set({
        status:       "awaiting_action",
        pausedReason: `Waiting on a human: ${step.channel} step (day ${step.dayOffset})`,
        nextSendAt:   null,
      })
      .where(eq(outreachEnrollments.id, enrollment.id));
    return "awaiting_action";
  }

  // note/linkedin keep their historical behaviour of advancing automatically,
  // because existing sequences rely on it and changing that silently would
  // alter live cadences.
  if (step.channel !== "email") {
    await advanceStep(enrollment, steps);
    return "advanced";
  }
```

Add near the top of the file, beside the other module constants:

```ts
/** Channels that require a person. The scheduler raises a task instead of sending. */
const MANUAL_CHANNELS = new Set(["whatsapp", "call"]);
```

Then widen the return type of `processSingleSend` to include the new outcome. Find its signature and add `"awaiting_action"` to the union, and in `processDueSends` treat it as handled rather than sent:

```ts
      const outcome = await processSingleSend(enrollment);
      if (outcome === "failed") failed++;
      else if (outcome === "awaiting_action") throttled++;   // handed to a human
      else sent++;
```

- [ ] **Step 4: Surface it in the worklist**

In `backend/src/services/worklist-ranking.ts`, add `manual_touch` to the `ActionType` union, and add this builder alongside the existing ones (matching their shape and `deepLink` convention):

```ts
  // Enrollments blocked on a human. Ranked with replies, because a sequence
  // stalled waiting for someone is costing the same as an unanswered reply.
  for (const m of input.manualTouches ?? []) {
    actions.push({
      id:        `manual:${m.enrollmentId}`,
      type:      "manual_touch",
      urgency:   "now",
      title:     m.leadName ?? "Lead",
      subtitle:  m.leadCompany ?? null,
      reason:    m.channel === "whatsapp"
        ? "WhatsApp message ready to send"
        : "Call this lead",
      detail:    m.message ?? null,
      dealValue: Number(m.dealValue ?? 0),
      leadId:    m.leadId,
      deepLink:  `/crm?lead=${m.leadId}`,
      score:     900,
    });
  }
```

Add the matching input type beside the others in the same file:

```ts
export interface ManualTouchRow {
  enrollmentId: string;
  leadId:       string;
  leadName:     string | null;
  leadCompany:  string | null;
  channel:      "whatsapp" | "call";
  message:      string | null;
  phoneE164:    string | null;
  dealValue:    string | number | null;
}
```

and add `manualTouches?: ManualTouchRow[]` to the existing ranking input interface.

- [ ] **Step 5: Feed it from the worklist service**

In `backend/src/services/worklist.ts`, add a query alongside the existing ones and pass it into the ranker:

```ts
    // Enrollments blocked on a human, with the step's message already rendered
    // so the card can show what to say without a second round trip.
    db.execute(sql`
      SELECT e.id            AS "enrollmentId",
             l.id            AS "leadId",
             l.name          AS "leadName",
             l.company       AS "leadCompany",
             l.phone_e164    AS "phoneE164",
             l.deal_value    AS "dealValue",
             s.channel       AS channel,
             s.body_template AS message
        FROM outreach_enrollments e
        JOIN leads l          ON l.id = e.lead_id
        JOIN outreach_steps s ON s.sequence_id = e.sequence_id
                             AND s.position    = e.current_step
       WHERE e.status = 'awaiting_action'
         AND ${mine}
       ORDER BY e.enrolled_at
       LIMIT 50
    `),
```

> **Use the existing `mine` fragment.** `fetchWorklist` already builds
> `const mine = admin ? sql\`TRUE\` : sql\`l.assignee_id = ${user.id}\`` near the
> top of the function, and every other query in the file composes it. Do not
> introduce a second scoping mechanism — a member must only ever see manual
> touches for their own leads, and one scoping expression is easier to keep
> correct than two.

- [ ] **Step 6: Verify a manual step blocks instead of sending**

Run:
```bash
cd backend && npx tsc --noEmit && npx vitest run
```

Then create a WhatsApp step on a test sequence and force a tick:
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"dessouky@seekersai.org","password":"admin123!"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token")
# Replace SEQ with a sequence id that has an enrolled lead due now.
curl -s -X POST "http://localhost:3000/api/v1/outreach/sequences/SEQ/steps" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"day_offset":0,"channel":"whatsapp","body_template":"Hi {{first_name}} — quick question about {{company}}."}'
curl -s -X POST http://localhost:3000/api/v1/outreach/scheduler/tick -H "Authorization: Bearer $TOKEN"
PGPASSWORD=seekers2026 psql -h localhost -U seekers -d seekersai -c \
  "select status, paused_reason from outreach_enrollments where status='awaiting_action' limit 3"
curl -s http://localhost:3000/api/v1/worklist -H "Authorization: Bearer $TOKEN" \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).focus.filter(a=>a.type==='manual_touch').length + ' manual_touch items'"
```
Expected: the enrollment is `awaiting_action` with a reason naming the channel and day; **no new row in `outreach_sends`** for it; at least one `manual_touch` item in the worklist.

- [ ] **Step 7: Commit**

```bash
git add backend/src/db/migrations/0012_outreach_channels.sql backend/src/db/schema.ts \
        backend/src/services/outreach.ts backend/src/services/worklist-ranking.ts \
        backend/src/services/worklist.ts
git commit -m "Add whatsapp/call steps that block the sequence for a human

Any non-email step used to be silently advanced past, so a sequence containing
one quietly skipped it — the cadence that ran was not the cadence the author
designed. whatsapp and call steps now stop the enrollment in a new
awaiting_action state and raise a Today item.

awaiting_action is deliberately distinct from paused: a sequence waiting on a
person has not failed, and conflating the two made a stalled enrollment
indistinguishable from a broken one.

note and linkedin keep advancing automatically — existing live sequences rely
on that, and changing it silently would alter cadences already running.

Manual touches are ranked with replies, because a sequence stalled on a human
costs the same as an unanswered reply, and are row-scoped so a member only sees
their own leads."
```

---

## Task 10: Outcome recording

**Files:**
- Modify: `backend/src/routes/outreach.ts`

**Interfaces:**
- Consumes: `awaiting_action` (Task 9), `suppress` (Task 4).
- Produces: `POST /outreach/enrollments/:id/touch-outcome` accepting `{ outcome: "sent" | "no_whatsapp" | "wrong_number" | "not_interested" | "replied", notes?: string }`.

- [ ] **Step 1: Add the endpoint**

In `backend/src/routes/outreach.ts`, add before `export default outreach;`:

```ts
// ── POST /outreach/enrollments/:id/touch-outcome ──────────
// What happened when a human actioned a manual step. This is the only way an
// awaiting_action enrollment moves, and it is where the lead list learns which
// numbers are actually on WhatsApp — there is no compliant free way to check
// that up front.
const touchOutcomeSchema = z.object({
  outcome: z.enum(["sent", "no_whatsapp", "wrong_number", "not_interested", "replied"]),
  notes:   z.string().max(1000).optional(),
});

outreach.post("/enrollments/:id/touch-outcome", authMiddleware, async (c) => {
  const user = c.get("user");
  const id   = c.req.param("id");
  const body = touchOutcomeSchema.parse(await c.req.json());

  const [row] = await db
    .select({
      enrollment: outreachEnrollments,
      leadId:     leads.id,
      leadName:   leads.name,
      channel:    outreachSteps.channel,
    })
    .from(outreachEnrollments)
    .innerJoin(leads, eq(leads.id, outreachEnrollments.leadId))
    .leftJoin(outreachSteps, and(
      eq(outreachSteps.sequenceId, outreachEnrollments.sequenceId),
      eq(outreachSteps.position, outreachEnrollments.currentStep),
    ))
    .where(eq(outreachEnrollments.id, id))
    .limit(1);

  if (!row) return c.json({ error: "Enrollment not found" }, 404);
  // Members may only action their own leads, same rule as every other route.
  if (!(await canTouchEnrollment(user, id))) {
    return c.json({ error: "Forbidden" }, 403);
  }
  if (row.enrollment.status !== "awaiting_action") {
    return c.json({ error: "This enrollment is not waiting on a manual step" }, 409);
  }

  const activity = async (description: string) => {
    await db.insert(leadActivities).values({
      leadId:      row.leadId,
      type:        row.channel === "call" ? "call" : "note",
      description: description.slice(0, 1000),
      createdBy:   user.id,
    });
  };

  switch (body.outcome) {
    case "sent": {
      // A message that went through IS the confirmation the number is on
      // WhatsApp, so success teaches the list as well as failure does.
      if (row.channel === "whatsapp") {
        await db.update(leads).set({ whatsappStatus: "yes" }).where(eq(leads.id, row.leadId));
      }
      await activity(`${row.channel === "call" ? "Called" : "WhatsApp sent"}${body.notes ? ` — ${body.notes}` : ""}`);
      await resumeAndAdvance(row.enrollment);
      break;
    }
    case "no_whatsapp": {
      await db.update(leads).set({ whatsappStatus: "no" }).where(eq(leads.id, row.leadId));
      await activity("No WhatsApp on this number — routing to another channel");
      // Re-route rather than stop: the lead may still have a working email.
      await resumeAndAdvance(row.enrollment);
      break;
    }
    case "wrong_number": {
      await db.update(leads)
        .set({ phone: null, phoneE164: null, phoneType: null, whatsappStatus: "no" })
        .where(eq(leads.id, row.leadId));
      await activity("Wrong number — cleared");
      await resumeAndAdvance(row.enrollment);
      break;
    }
    case "not_interested": {
      await db.update(leads).set({ stage: "closed_lost" }).where(eq(leads.id, row.leadId));
      await db.update(outreachEnrollments)
        .set({ status: "completed", completedAt: new Date(), nextSendAt: null })
        .where(eq(outreachEnrollments.id, id));
      await activity(`Not interested${body.notes ? ` — ${body.notes}` : ""}`);
      break;
    }
    case "replied": {
      await db.update(outreachEnrollments)
        .set({ status: "replied", completedAt: new Date(), nextSendAt: null })
        .where(eq(outreachEnrollments.id, id));
      await activity(`Replied${body.notes ? ` — ${body.notes}` : ""}`);
      break;
    }
  }

  return c.json({ ok: true, outcome: body.outcome });
});
```

- [ ] **Step 2: Add the two helpers**

Add above the route, in the same file:

```ts
/**
 * Put a manual-step enrollment back into the running sequence.
 *
 * Sets status back to active and schedules the next step, so the cadence
 * resumes from now rather than from the original enrolment date — otherwise a
 * step actioned three days late would fire the remaining steps in a burst.
 */
async function resumeAndAdvance(enrollment: typeof outreachEnrollments.$inferSelect) {
  const steps = await db.select().from(outreachSteps)
    .where(eq(outreachSteps.sequenceId, enrollment.sequenceId))
    .orderBy(outreachSteps.position);

  const nextIdx = enrollment.currentStep + 1;
  if (nextIdx >= steps.length) {
    await db.update(outreachEnrollments)
      .set({ status: "completed", completedAt: new Date(), nextSendAt: null })
      .where(eq(outreachEnrollments.id, enrollment.id));
    return;
  }

  const prev = steps[enrollment.currentStep];
  const next = steps[nextIdx];
  const gapDays = Math.max(1, (next.dayOffset ?? 0) - (prev?.dayOffset ?? 0));

  await db.update(outreachEnrollments)
    .set({
      status:              "active",
      currentStep:         nextIdx,
      pausedReason:        null,
      lastStepCompletedAt: new Date(),
      nextSendAt:          computeNextSendAtFromNow(gapDays),
    })
    .where(eq(outreachEnrollments.id, enrollment.id));
}

/** Members may only action enrollments on leads assigned to them. */
async function canTouchEnrollment(
  user: { id: string; role?: string },
  enrollmentId: string,
): Promise<boolean> {
  if (user.role === "admin") return true;
  const [row] = await db
    .select({ assigneeId: leads.assigneeId })
    .from(outreachEnrollments)
    .innerJoin(leads, eq(leads.id, outreachEnrollments.leadId))
    .where(eq(outreachEnrollments.id, enrollmentId))
    .limit(1);
  return !!row && row.assigneeId === user.id;
}
```

Export the existing scheduling helper from the service so the route can reuse it rather than duplicating the Cairo/weekend logic. In `backend/src/services/outreach.ts` add:

```ts
/** Next send slot `gapDays` from now, honouring the Cairo window and weekend. */
export function computeNextSendAtFromNow(gapDays: number): Date {
  return computeNextSendAt(new Date(), gapDays);
}
```

and import it in the route file:

```ts
import { computeNextSendAtFromNow } from "../services/outreach";
```

- [ ] **Step 3: Verify each outcome**

Run: `cd backend && npx tsc --noEmit && npx vitest run`

Then, with an `awaiting_action` enrollment id in `EID`:
```bash
curl -s -X POST "http://localhost:3000/api/v1/outreach/enrollments/$EID/touch-outcome" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"outcome":"sent"}'
PGPASSWORD=seekers2026 psql -h localhost -U seekers -d seekersai -c \
  "select e.status, e.current_step, l.whatsapp_status from outreach_enrollments e join leads l on l.id=e.lead_id where e.id='$EID'"
```
Expected: `{"ok":true,...}`; status back to `active` (or `completed` if it was the last step), `current_step` incremented, and `whatsapp_status = 'yes'`.

Repeat with `no_whatsapp` on another enrollment and confirm `whatsapp_status = 'no'`. Confirm a non-`awaiting_action` enrollment returns 409, and a member actioning someone else's lead returns 403.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/outreach.ts backend/src/services/outreach.ts
git commit -m "Record manual-touch outcomes and resume the sequence

The only way an awaiting_action enrollment moves, and where the lead list learns
which numbers are actually on WhatsApp — a message that went through IS the
confirmation, so success teaches the list as well as 'no WhatsApp' does.

Resuming schedules the next step from NOW rather than from the original
enrolment date: a step actioned three days late would otherwise fire every
remaining step in a burst, which is the same bug that once sent 55 leads two
identical emails 100 seconds apart.

no_whatsapp re-routes rather than stopping, because the lead may still have a
working email. Row-scoped: a member can only action their own leads."
```

---

## Task 11: WhatsApp link building (frontend, pure)

**Files:**
- Create: `Frontend/src/lib/whatsapp.ts`
- Test: `Frontend/src/lib/whatsapp.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `renderTemplate(template: string, vars: Record<string, string | null | undefined>): string`
  - `whatsappLink(e164: string, message: string): string`
  - `telLink(e164: string): string`

- [ ] **Step 1: Write the failing test**

Create `Frontend/src/lib/whatsapp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderTemplate, whatsappLink, telLink } from "./whatsapp";

describe("renderTemplate", () => {
  it("substitutes the documented variables", () => {
    expect(renderTemplate("Hi {{first_name}} at {{company}}", {
      first_name: "Karim", company: "Nile Dental",
    })).toBe("Hi Karim at Nile Dental");
  });

  it("derives first_name from a full name when given one", () => {
    expect(renderTemplate("Hi {{first_name}}", { name: "Karim Adel" })).toBe("Hi Karim");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("Hi {{ first_name }}", { first_name: "Karim" })).toBe("Hi Karim");
  });

  it("drops unknown and empty variables rather than printing the token", () => {
    // Sending a literal "{{category}}" to a prospect is worse than sending nothing.
    expect(renderTemplate("Hi{{ nope }}", {})).toBe("Hi");
    expect(renderTemplate("A {{company}} B", { company: null })).toBe("A  B");
  });

  it("leaves a template with no variables untouched", () => {
    expect(renderTemplate("Plain text", {})).toBe("Plain text");
  });
});

describe("whatsappLink", () => {
  it("strips the plus and encodes the message", () => {
    expect(whatsappLink("+971501234567", "Hi there"))
      .toBe("https://wa.me/971501234567?text=Hi%20there");
  });

  it("encodes newlines and ampersands so the text is not truncated", () => {
    const link = whatsappLink("+201012345678", "Line one\nLine two & more");
    expect(link).toContain("%0A");
    expect(link).toContain("%26");
    expect(link).not.toContain("\n");
  });

  it("tolerates spaces and dashes in the number", () => {
    expect(whatsappLink("+971 50 123-4567", "hi"))
      .toBe("https://wa.me/971501234567?text=hi");
  });

  it("omits the text parameter for an empty message", () => {
    expect(whatsappLink("+971501234567", "")).toBe("https://wa.me/971501234567");
  });
});

describe("telLink", () => {
  it("builds a tel: URI keeping the plus", () => {
    expect(telLink("+971 50 123 4567")).toBe("tel:+971501234567");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Frontend && npx vitest run src/lib/whatsapp.test.ts`
Expected: FAIL — cannot resolve `./whatsapp`.

- [ ] **Step 3: Write the implementation**

Create `Frontend/src/lib/whatsapp.ts`:

```ts
// Deep links and message rendering for the manual channels.
//
// wa.me opens whichever WhatsApp app is installed on the device, so a phone
// running WhatsApp Business gets WhatsApp Business. There is no separate public
// deep link for the Business app.

/** Variables a template may use, matching the email templates. */
const KNOWN = ["first_name", "name", "company", "category", "source"] as const;

/**
 * Fill `{{variable}}` placeholders.
 *
 * Unknown or empty variables are removed rather than left as literal tokens:
 * sending a prospect a message containing "{{company}}" is worse than sending
 * one with a small gap.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  const resolved: Record<string, string> = {};
  for (const key of KNOWN) {
    const v = vars[key];
    if (v) resolved[key] = String(v);
  }
  // first_name falls back to the first word of a full name, which is what the
  // lead records usually hold.
  if (!resolved.first_name && vars.name) {
    resolved.first_name = String(vars.name).trim().split(/\s+/)[0];
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => resolved[key] ?? "");
}

/** Digits only — wa.me rejects a leading +. */
const digits = (e164: string) => e164.replace(/[^\d]/g, "");

export function whatsappLink(e164: string, message: string): string {
  const base = `https://wa.me/${digits(e164)}`;
  if (!message) return base;
  // encodeURIComponent, not encodeURI: newlines and & must be escaped or the
  // message arrives truncated.
  return `${base}?text=${encodeURIComponent(message)}`;
}

export function telLink(e164: string): string {
  return `tel:+${digits(e164)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Frontend && npx vitest run src/lib/whatsapp.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm no regression, then commit**

Run: `cd Frontend && npx vitest run && npx tsc --noEmit -p tsconfig.app.json`
Expected: 28 existing + the new whatsapp tests pass; 0 type errors.

```bash
git add Frontend/src/lib/whatsapp.ts Frontend/src/lib/whatsapp.test.ts
git commit -m "Add pure WhatsApp/tel link building and template rendering

Unknown or empty variables are removed rather than left as literal tokens —
sending a prospect a message containing '{{company}}' is worse than sending one
with a small gap.

encodeURIComponent rather than encodeURI: newlines and ampersands must be
escaped or the message arrives at WhatsApp truncated.

wa.me opens whichever WhatsApp is installed, so a device running WhatsApp
Business gets WhatsApp Business — there is no separate public deep link for it."
```

---

## Task 12: The manual-touch action card

**Files:**
- Create: `Frontend/src/hooks/useManualTouch.ts`
- Create: `Frontend/src/components/modules/ManualTouchCard.tsx`
- Modify: `Frontend/src/hooks/useWorklist.ts`
- Modify: `Frontend/src/pages/Today.tsx`

**Interfaces:**
- Consumes: `renderTemplate`, `whatsappLink`, `telLink` (Task 11); `POST /outreach/enrollments/:id/touch-outcome` (Task 10).
- Produces: `useRecordTouchOutcome()` mutation; `<ManualTouchCard action={...} />`.

- [ ] **Step 1: Extend the worklist types**

In `Frontend/src/hooks/useWorklist.ts`, add `"manual_touch"` to the `ActionType` union and add these optional fields to `WorklistAction`:

```ts
  /** Present only on manual_touch items. */
  enrollmentId?: string;
  channel?:      "whatsapp" | "call";
  message?:      string | null;
  phoneE164?:    string | null;
  leadId?:       string | null;
```

- [ ] **Step 2: Add the mutation hook**

Create `Frontend/src/hooks/useManualTouch.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export type TouchOutcome =
  | "sent" | "no_whatsapp" | "wrong_number" | "not_interested" | "replied";

export function useRecordTouchOutcome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ enrollmentId, outcome, notes }: {
      enrollmentId: string; outcome: TouchOutcome; notes?: string;
    }) =>
      apiFetch(`/outreach/enrollments/${enrollmentId}/touch-outcome`, {
        method: "POST",
        body:   JSON.stringify({ outcome, notes }),
      }),
    onSuccess: () => {
      // The item leaves the queue and the lead's channels may have changed.
      qc.invalidateQueries({ queryKey: ["worklist"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["outreach"] });
    },
  });
}
```

- [ ] **Step 3: Build the card**

Create `Frontend/src/components/modules/ManualTouchCard.tsx`:

```tsx
// A sequence step that needs a person: the message is written, the link is
// ready, all that is missing is a human pressing send.
//
// The outcome buttons are the point. There is no compliant free way to check
// whether a number is on WhatsApp, so the list learns from what happens here —
// "Sent" confirms the number works, "No WhatsApp" retires it.
import { useState } from "react";
import { MessageCircle, Phone, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { renderTemplate, whatsappLink, telLink } from "@/lib/whatsapp";
import { useRecordTouchOutcome, type TouchOutcome } from "@/hooks/useManualTouch";
import type { WorklistAction } from "@/hooks/useWorklist";

const OUTCOMES: { key: TouchOutcome; label: string; destructive?: boolean }[] = [
  { key: "sent",           label: "Sent" },
  { key: "replied",        label: "They replied" },
  { key: "no_whatsapp",    label: "No WhatsApp" },
  { key: "wrong_number",   label: "Wrong number" },
  { key: "not_interested", label: "Not interested", destructive: true },
];

export function ManualTouchCard({ action }: { action: WorklistAction }) {
  const record = useRecordTouchOutcome();
  const [copied, setCopied] = useState(false);

  const isWhatsapp = action.channel === "whatsapp";
  const message = renderTemplate(action.message ?? "", {
    name:    action.title,
    company: action.subtitle ?? undefined,
  });
  const phone = action.phoneE164 ?? "";

  const submit = (outcome: TouchOutcome) => {
    if (!action.enrollmentId) return;
    record.mutate(
      { enrollmentId: action.enrollmentId, outcome },
      {
        onSuccess: () => toast.success(
          outcome === "no_whatsapp" ? "Marked — this lead will be tried on another channel"
          : outcome === "wrong_number" ? "Number cleared"
          : "Recorded",
        ),
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const copy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Card className="border-border/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <Badge variant="outline" className="gap-1 border-emerald-500/30 text-[11px] uppercase tracking-wide text-emerald-400">
          {isWhatsapp ? <MessageCircle className="h-3 w-3" /> : <Phone className="h-3 w-3" />}
          {isWhatsapp ? "WhatsApp" : "Call"}
        </Badge>
      </div>

      <h2 className="mt-3 text-xl font-semibold leading-tight text-foreground">{action.title}</h2>
      {action.subtitle && <p className="text-sm text-muted-foreground">{action.subtitle}</p>}
      {phone && <p className="mt-0.5 font-mono text-xs text-muted-foreground">{phone}</p>}

      {isWhatsapp && message && (
        <div className="mt-4 rounded-lg border-l-2 border-emerald-500/60 bg-emerald-500/5 px-4 py-3">
          <p className="whitespace-pre-line text-sm text-foreground/90">{message}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {phone && (
          <Button asChild className="gap-1.5">
            {/* Opens WhatsApp Business when that is the installed app. */}
            <a
              href={isWhatsapp ? whatsappLink(phone, message) : telLink(phone)}
              target={isWhatsapp ? "_blank" : undefined}
              rel={isWhatsapp ? "noopener noreferrer" : undefined}
            >
              {isWhatsapp
                ? <><MessageCircle className="h-4 w-4" /> Open WhatsApp</>
                : <><Phone className="h-4 w-4" /> Call</>}
            </a>
          </Button>
        )}
        {isWhatsapp && message && (
          // Fallback for a desktop with no WhatsApp installed.
          <Button variant="outline" className="gap-1.5" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy message"}
          </Button>
        )}
      </div>

      <div className="mt-4 border-t border-border/50 pt-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          What happened?
        </p>
        <div className="flex flex-wrap gap-1.5">
          {OUTCOMES.filter((o) => isWhatsapp || o.key !== "no_whatsapp").map((o) => (
            <Button
              key={o.key}
              size="sm"
              variant={o.key === "sent" ? "default" : "outline"}
              disabled={record.isPending}
              onClick={() => submit(o.key)}
              className={o.destructive ? "text-destructive" : undefined}
            >
              {o.label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The sequence stays paused until you record an outcome.
        </p>
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Render it in Today**

In `Frontend/src/pages/Today.tsx`, add to the `STYLE` map:

```ts
  manual_touch:     { icon: MessageCircle,      label: "Your turn",     tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25", dot: "bg-emerald-500" },
```

add to `PRIMARY_CTA`:

```ts
  manual_touch:     "Open",
```

import both the icon and the card:

```tsx
import { MessageCircle } from "lucide-react";
import { ManualTouchCard } from "@/components/modules/ManualTouchCard";
```

and in the focus slot, render the specialised card for this type — replace the existing `<FocusCard ... />` usage with:

```tsx
          {focus.type === "manual_touch"
            ? <ManualTouchCard action={focus} />
            : (
              <FocusCard
                action={focus}
                onGo={go}
                onSkip={() => setSkipped((s) => [...s, focus.id])}
                position={all.length - live.length + 1}
                total={all.length}
              />
            )}
```

- [ ] **Step 5: Verify end to end in the browser**

With an `awaiting_action` enrollment present, open `http://localhost:5173/`.
Expected: the focus card is the WhatsApp card, showing the rendered message with the lead's name substituted, an "Open WhatsApp" button whose `href` is `https://wa.me/...?text=...`, a copy button, and five outcome buttons. Click **Sent**; the item leaves the queue and a success toast appears.

Confirm the link is correct without leaving the page:
```js
// In the browser console
document.querySelector('a[href^="https://wa.me/"]')?.href
```
Expected: `https://wa.me/<digits>?text=<encoded message>` with no literal `{{` tokens.

- [ ] **Step 6: Typecheck, test and commit**

Run:
```bash
cd Frontend && npx tsc --noEmit -p tsconfig.app.json && npx vitest run
cd ../backend && npx vitest run
```

```bash
git add Frontend/src/hooks/useManualTouch.ts Frontend/src/components/modules/ManualTouchCard.tsx \
        Frontend/src/hooks/useWorklist.ts Frontend/src/pages/Today.tsx
git commit -m "Add the manual-touch action card to the Today queue

The message is written and the link is ready — all that is missing is a person
pressing send. Copy-to-clipboard covers a desktop with no WhatsApp installed.

The outcome buttons are the point, not decoration: there is no compliant free
way to check whether a number is on WhatsApp, so the list learns from what
happens here. 'Sent' confirms the number works, 'No WhatsApp' retires it and
re-routes the lead.

'No WhatsApp' is hidden on call steps, where it would be meaningless."
```

---

## Task 13: Offer the new channels when authoring a sequence

**Files:**
- Modify: `Frontend/src/components/modules/outreach/SequenceEditor.tsx`
- Modify: `Frontend/src/components/modules/outreach/sequence-readiness.ts`
- Modify: `Frontend/src/components/modules/outreach/sequence-readiness.test.ts`
- Modify: `Frontend/src/components/modules/outreach/StepFlow.tsx`

**Interfaces:**
- Consumes: the widened `channel` enum (Task 9).
- Produces: `whatsapp` and `call` selectable in the step dialog; readiness rules that do not demand a subject line for them.

- [ ] **Step 1: Write the failing readiness tests**

In `Frontend/src/components/modules/outreach/sequence-readiness.test.ts`, add inside the `describe("checkSequence")` block:

```ts
  it("does not demand a subject line on a WhatsApp step", () => {
    // WhatsApp messages have no subject; requiring one would make every
    // WhatsApp sequence permanently un-sendable.
    const issues = checkSequence(seq({
      steps: [step({ channel: "whatsapp", subjectTemplate: null, bodyTemplate: "Hi there, quick question." })],
    }));
    expect(issues.some((i) => /no subject/i.test(i.message))).toBe(false);
  });

  it("still requires a body on a WhatsApp step", () => {
    const issues = checkSequence(seq({
      steps: [step({ channel: "whatsapp", subjectTemplate: null, bodyTemplate: null })],
    }));
    expect(issues.some((i) => i.level === "blocker" && /no body/i.test(i.message))).toBe(true);
  });

  it("requires neither subject nor body on a call step", () => {
    // A call step is a reminder to phone someone; a script is optional.
    const issues = checkSequence(seq({
      steps: [step({ channel: "call", subjectTemplate: null, bodyTemplate: null })],
    }));
    expect(issues.some((i) => i.level === "blocker")).toBe(false);
  });

  it("notes that manual steps pause the sequence for a human", () => {
    const issues = checkSequence(seq({
      steps: [
        step({ position: 0, dayOffset: 0, channel: "email" }),
        step({ position: 1, dayOffset: 3, channel: "whatsapp", id: "b", subjectTemplate: null, bodyTemplate: "Hi" }),
      ],
    }));
    expect(issues.some((i) => /waits for a person/i.test(i.message))).toBe(true);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd Frontend && npx vitest run src/components/modules/outreach/sequence-readiness.test.ts`
Expected: the four new tests FAIL — the current rules require a subject for every sending channel and know nothing about manual ones.

- [ ] **Step 3: Update the readiness rules**

In `Frontend/src/components/modules/outreach/sequence-readiness.ts`, replace the `CHANNEL_SENDS` map and the per-step loop's subject requirement with channel-aware rules:

```ts
/** Channels the scheduler sends automatically. */
const CHANNEL_SENDS: Record<Channel, boolean> = {
  email: true, linkedin: false, note: false, whatsapp: false, call: false,
};

/** Channels that need message text a human will actually send. */
const CHANNEL_NEEDS_BODY: Record<Channel, boolean> = {
  email: true, linkedin: false, note: false, whatsapp: true, call: false,
};

/** Only email has a subject line. */
const CHANNEL_NEEDS_SUBJECT: Record<Channel, boolean> = {
  email: true, linkedin: false, note: false, whatsapp: false, call: false,
};

/** Channels that stop the sequence until a person acts. */
const CHANNEL_IS_MANUAL: Record<Channel, boolean> = {
  email: false, linkedin: false, note: false, whatsapp: true, call: true,
};
```

Then change the step loop so it uses these maps rather than the single `CHANNEL_SENDS` gate:

```ts
  for (const s of steps) {
    if (CHANNEL_NEEDS_BODY[s.channel] && !stepHasContent(s)) {
      issues.push({
        level: "blocker", stepId: s.id,
        message: `Day ${s.dayOffset} has no body.`,
        fix: s.channel === "whatsapp"
          ? "Write the WhatsApp message. Without it there is nothing for a human to send."
          : "Write a body template, or pick an AI agent to generate one per lead.",
      });
    }

    if (CHANNEL_NEEDS_SUBJECT[s.channel]) {
      if (!s.subjectTemplate?.trim()) {
        issues.push({
          level: "blocker", stepId: s.id,
          message: `Day ${s.dayOffset} has no subject line.`,
          fix: "Emails without a subject are rejected by most mail servers.",
        });
      } else if (/[?!]\s*$/.test(s.subjectTemplate.trim())) {
        issues.push({
          level: "warning", stepId: s.id,
          message: `Day ${s.dayOffset}'s subject ends with "${s.subjectTemplate.trim().slice(-1)}".`,
          fix: "Some providers reject subject lines ending in ? or !. It will be stripped automatically before sending.",
        });
      }
    }
  }

  // Manual steps are a feature, but they change how the sequence behaves and
  // the author should know before enrolling anyone.
  const manualCount = steps.filter((s) => CHANNEL_IS_MANUAL[s.channel]).length;
  if (manualCount > 0) {
    issues.push({
      level: "info",
      message: `${manualCount} step${manualCount === 1 ? "" : "s"} waits for a person.`,
      fix: "Nothing is sent automatically at those steps — they appear in Today until someone records an outcome, and the sequence pauses until they do.",
    });
  }
```

> `void CHANNEL_SENDS;` is not needed — `CHANNEL_SENDS` is still used by any existing rule that distinguishes automatic sending. If after this edit it has no remaining reader, delete it rather than leaving it unused.

- [ ] **Step 4: Run to verify they pass**

Run: `cd Frontend && npx vitest run src/components/modules/outreach/sequence-readiness.test.ts`
Expected: all tests pass, including the 19 that existed before.

- [ ] **Step 5: Offer the channels in the editor**

In `Frontend/src/components/modules/outreach/SequenceEditor.tsx`, add two options to the channel `SelectContent`:

```tsx
                    <SelectItem value="whatsapp">WhatsApp (you press send)</SelectItem>
                    <SelectItem value="call">Phone call (reminder)</SelectItem>
```

Change the helper text under the channel select so it names the real behaviour:

```tsx
                {stepChannel !== "email" && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {stepChannel === "whatsapp" || stepChannel === "call"
                      ? "Nothing is sent automatically. This appears in Today and the sequence pauses until someone records an outcome."
                      : "Not sent automatically — this creates a reminder to do it by hand."}
                  </p>
                )}
```

Hide the subject field for channels that have no subject:

```tsx
            {stepChannel === "email" && (
              <div>
                <Label htmlFor="subject_template">Subject</Label>
                <Input
                  id="subject_template" name="subject_template"
                  defaultValue={editingStep?.subjectTemplate ?? ""} className="mt-1"
                  placeholder="Quick question about {{company}}"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Variables: {VARIABLES.map((v) => `{{${v}}}`).join(", ")}
                </p>
              </div>
            )}
```

- [ ] **Step 6: Give the new channels icons in the flow**

In `Frontend/src/components/modules/outreach/StepFlow.tsx`, add to the `CHANNEL` map and import the icons:

```tsx
  whatsapp: { icon: MessageCircle, label: "WhatsApp",      tone: "text-emerald-400 bg-emerald-500/10" },
  call:     { icon: Phone,         label: "Call",          tone: "text-amber-400 bg-amber-500/10" },
```

```tsx
import { MessageCircle, Phone } from "lucide-react";
```

- [ ] **Step 7: Verify in the browser**

Open `http://localhost:5173/outreach`, open a sequence, click **Add step**.
Expected: WhatsApp and Phone call appear in the channel list; choosing WhatsApp hides the Subject field and shows the pause warning; saving it renders a green WhatsApp card in the flow; the readiness panel shows the info line "1 step waits for a person" and does **not** report a missing subject.

- [ ] **Step 8: Full verification and commit**

Run:
```bash
cd Frontend && npx tsc --noEmit -p tsconfig.app.json && npx vitest run
cd ../backend && npx tsc --noEmit && npx vitest run
```
Expected: 0 type errors both sides. Frontend tests ≥ 28 + 5 new whatsapp + 4 new readiness; backend ≥ 31 + phone + channels + policy.

```bash
git add Frontend/src/components/modules/outreach/SequenceEditor.tsx \
        Frontend/src/components/modules/outreach/sequence-readiness.ts \
        Frontend/src/components/modules/outreach/sequence-readiness.test.ts \
        Frontend/src/components/modules/outreach/StepFlow.tsx
git commit -m "Offer WhatsApp and call steps when authoring a sequence

Readiness is now channel-aware. Requiring a subject line on a WhatsApp step
would have made every WhatsApp sequence permanently un-sendable, so subject is
demanded only for email; WhatsApp still needs a body because a human has to have
something to send, and a call step needs neither since a script is optional.

Manual steps raise an info note rather than passing silently: they change how
the sequence behaves — nothing sends, and it pauses until someone records an
outcome — and the author should know that before enrolling anyone."
```

---

## Task 14: Deploy and verify on production

**Files:** none — operational.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Full local verification**

Run:
```bash
cd backend  && npx tsc --noEmit && npx vitest run
cd ../Frontend && npx tsc --noEmit -p tsconfig.app.json && npx vitest run && npx vite build
```
Expected: 0 type errors, all suites green, build succeeds.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Deploy the API**

Run: `ssh root@128.140.65.42 'bash /var/www/seekersai/deploy.sh'`
Expected: a `pg_dump` is taken first, `0012_outreach_channels.sql` is applied and recorded, typecheck passes, PM2 restarts, and the health check returns `{"status":"ok"}`.

> The frontend deploys from `main` via Vercel independently. Deploy the API in the same sitting: the new Today card calls `POST /outreach/enrollments/:id/touch-outcome`, which 404s until the API restarts.

- [ ] **Step 4: Run the phone backfill on production**

Run: `ssh root@128.140.65.42 'cd /var/www/seekersai/backend && npx tsx scripts/backfill-phones.ts'`
Expected: ~575 examined, with `mobile` + `landline` + `unknown` summing to that, and `unknown` roughly equal to the count of `+1` numbers (~137).

- [ ] **Step 5: Confirm the sending gate is live and conservative**

Run:
```bash
ssh root@128.140.65.42 'cd /var/www/seekersai/backend
PGPASS=$(grep -o "postgresql://[^:]*:[^@]*@" .env | sed "s|postgresql://[^:]*:||; s|@||"); export PGPASSWORD="$PGPASS"
psql -h localhost -U seekers -d seekersai -c "select address, daily_cap, warmup_stage from mailboxes"
psql -h localhost -U seekers -d seekersai -c "select reason, count(*) from suppressions group by reason"
psql -h localhost -U seekers -d seekersai -c "select phone_type, count(*) from leads group by phone_type"'
```
Expected: exactly one mailbox row in `recovery`; suppressions backfilled from previously-bounced leads; phone types distributed with a large `mobile` count.

- [ ] **Step 6: Verify the deliverability panel against real DNS**

Open the production frontend, go to Outbound → Deliverability.
Expected: volume card reads `N of 5 sent today · recovery`; the domain card shows real SPF/DKIM/DMARC results for `seekersai.org`. **Record what DMARC says** — if it is missing, publishing it is the single cheapest remaining deliverability improvement and belongs in the follow-up.

- [ ] **Step 7: Commit the outcome notes**

Append a short "Outcome" section to `docs/superpowers/specs/2026-08-03-outreach-channels-design.md` recording the actual backfill counts, the DNS findings, and anything that turned out differently from the design. Then:

```bash
git add docs/superpowers/specs/2026-08-03-outreach-channels-design.md
git commit -m "Docs: record what the outreach-channels rollout actually found"
git push origin main
```

---

## Self-Review

**Spec coverage** — every requirement maps to a task:

| Spec requirement | Task |
|---|---|
| Mailbox registry, caps derived from `outreach_sends` | 6 (gate), 6 Step 5 (seed) |
| Warmup stages, `recovery` as the start, auto-downgrade | 5 (rules), 6 (downgrade on spam_reject) |
| 09:00–17:00 Cairo spread with 90–240 s jitter | 5 (arithmetic), 6 (gate) |
| Suppression list replacing destructive email nulling | 2 (table), 4 (service + inbox fix), 6 (enforced at send) |
| `isSpamRejection` + `failure_kind` | 6 |
| SPF/DKIM/DMARC via `dns/promises` | 7 |
| Deliverability panel | 8 |
| `phone.ts` normalise/classify, no default country, `+1` unknown | 1 |
| `channels.ts` priority, unreachable state | 3 |
| `outreach_steps.channel` += whatsapp/call | 9 |
| `awaiting_action` that blocks | 9 |
| Action card, wa.me + tel + copy fallback | 11 (links), 12 (card) |
| Five outcomes; Sent ⇒ `whatsapp_status='yes'`; No WhatsApp ⇒ `'no'` | 10 (backend), 12 (UI) |
| Backfill of 575 phones | 2 (script), 14 (production run) |
| Unreachable filter on the Leads page | **gap — see below** |
| Manual-step readiness rules | 13 |

**Gap found and resolved:** the spec promises an **"unreachable" filter on the Leads page**, and no task delivered it. Rather than bolt it onto an unrelated task, it is added as Task 15 below — it is independently testable and a reviewer could reject it without rejecting anything else.

**Placeholder scan** — no `TBD`, `TODO`, "handle edge cases", or "similar to Task N". Every code step carries the actual code. Two steps deliberately instruct the engineer to match existing local variable names (Task 4 Step 3) or delete a constant if it ends up unused (Task 13 Step 3); both state the condition explicitly rather than leaving it vague.

**Type consistency** — checked across tasks: `PhoneType` (Task 1) is consumed by `ChannelInput.phoneType` (Task 3) and the backfill (Task 2). `SuppressionReason` (Task 4) matches the migration's `reason` enum (Task 2) and the `suppress()` call in Task 6. `WarmupStage` (Task 5) is used in Tasks 6 and 8. `TouchOutcome` (Task 12) matches `touchOutcomeSchema` exactly (Task 10). `renderTemplate`/`whatsappLink`/`telLink` (Task 11) are called with the same signatures in Task 12. `manual_touch` is spelled identically in Tasks 9, 12 and the `ActionType` union.

---

## Task 15: Unreachable filter on the Leads page

**Files:**
- Modify: `backend/src/routes/crm.ts`
- Modify: `Frontend/src/hooks/useCRM.ts`
- Modify: `Frontend/src/components/modules/crm/LeadFilterBar.tsx`

**Interfaces:**
- Consumes: `phone_e164`, `whatsapp_status`, `email_status` (Task 2); the suppression list (Task 2).
- Produces: `GET /crm/leads?reachability=unreachable|reachable` filter.

- [ ] **Step 1: Add the filter to the leads query**

In `backend/src/routes/crm.ts`, inside the `GET /leads` handler where the other filters are pushed onto `conditions`, add:

```ts
  // "Unreachable" means every channel is dead: no usable number, and no email
  // or an email we must never use. Such a lead cannot be enrolled at all, and
  // today it is invisible — indistinguishable from one simply waiting its turn.
  const UNREACHABLE = sql`(
    (${leads.phoneE164} IS NULL OR ${leads.whatsappStatus} = 'no')
    AND (
      ${leads.email} IS NULL
      OR ${leads.emailStatus} = 'bounced'
      OR EXISTS (SELECT 1 FROM suppressions s WHERE s.address = lower(trim(${leads.email})))
    )
  )`;

  if (q.reachability === "unreachable") conditions.push(UNREACHABLE);
  if (q.reachability === "reachable")   conditions.push(sql`NOT ${UNREACHABLE}`);
```

> `phone_e164 IS NULL` covers both "no number at all" and "a number we could not normalise", since the backfill leaves the latter null.

- [ ] **Step 2: Pass it through the hook**

In `Frontend/src/hooks/useCRM.ts`, add `reachability?: "unreachable" | "reachable"` to the `useLeads` params interface and forward it:

```ts
  if (params.reachability) qs.set("reachability", params.reachability);
```

- [ ] **Step 3: Add the control**

In `Frontend/src/components/modules/crm/LeadFilterBar.tsx`, add a select beside the existing stage and category filters:

```tsx
        <select
          value={reachability}
          onChange={(e) => onReachabilityChange(e.target.value)}
          aria-label="Filter by reachability"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="">Any contactability</option>
          <option value="reachable">Reachable</option>
          <option value="unreachable">Unreachable</option>
        </select>
```

Add `reachability: string` and `onReachabilityChange: (v: string) => void` to the component's props, and thread the state from `Frontend/src/pages/CRM.tsx` the same way `stageFilter` is threaded — a `useState("")` passed down and into `useLeads`.

- [ ] **Step 4: Verify the counts add up**

Run:
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"dessouky@seekersai.org","password":"admin123!"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token")
for r in "" reachable unreachable; do
  n=$(curl -s "http://localhost:3000/api/v1/crm/leads?limit=1000&reachability=$r" \
      -H "Authorization: Bearer $TOKEN" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));(Array.isArray(d)?d:d.data).length")
  echo "reachability='$r' -> $n"
done
```
Expected: `reachable` + `unreachable` equals the unfiltered total. That equality is the actual test — if it does not hold, the predicate and its negation disagree and the filter is lying.

- [ ] **Step 5: Typecheck, test and commit**

Run:
```bash
cd backend && npx tsc --noEmit && npx vitest run
cd ../Frontend && npx tsc --noEmit -p tsconfig.app.json && npx vitest run
```

```bash
git add backend/src/routes/crm.ts Frontend/src/hooks/useCRM.ts \
        Frontend/src/components/modules/crm/LeadFilterBar.tsx Frontend/src/pages/CRM.tsx
git commit -m "Add a reachability filter to the Leads page

A lead with no usable number and no usable email cannot be enrolled in anything,
but today it looks exactly like one waiting its turn — so the dead weight in the
list is invisible and never gets fixed.

Verified by construction: reachable + unreachable must equal the unfiltered
total, since the two conditions are a predicate and its negation."
```
