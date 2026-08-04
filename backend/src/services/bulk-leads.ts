// Bulk lead mutations — the pure decisions that keep them safe.
//
// Every bulk endpoint on /crm/leads mutates or deletes many rows from one
// request, and the failure mode is catastrophic rather than annoying: this
// codebase has already lost all 735 leads to a bulk endpoint whose guard was
// `if (!body.keep_sources && !body.delete_sources)`. Because `![]` is `false`, an
// empty array satisfied the guard while contributing no SQL condition, Drizzle
// received `where(undefined)`, omitted the clause, and the DELETE matched every
// row in the table.
//
// The lesson is not "validate better". It is that the WHERE clause of a bulk
// statement must be DERIVED, in one place, by code that cannot produce an empty
// one — so that "no filter resolved" is representable, testable, and refused
// before any statement is built. That is what this file is.
//
// Pure (no DB, no clock): routes/crm.ts hits the database and cannot be unit
// tested, so the guarantees would be untestable if they lived inline there. See
// bulk-leads.test.ts. Same reasoning as manual-touch.ts and lead-strikes.ts.

/** A caller, as the auth middleware provides them. */
export interface BulkActor {
  id:    string;
  role?: string;
}

/**
 * One term of a bulk statement's WHERE clause.
 *
 * Tagged data rather than a Drizzle condition so the plan can be asserted on in
 * a test with no database. The route maps each term to exactly one Drizzle
 * condition and pushes it into an `and(...conditions)` array.
 */
export type BulkWhereTerm =
  | { kind: "id_in";       ids: string[] }
  | { kind: "assignee_eq"; assigneeId: string };

export type BulkScope =
  | { ok: false; status: 400 | 403; error: string }
  | { ok: true;  ids: string[]; forcedAssigneeId: string | null };

/**
 * Resolve which leads a bulk request is allowed to touch.
 *
 * Two jobs, both refusals:
 *
 *  1. An empty selection is rejected outright. Zod already enforces `.min(1)` on
 *     the wire, and this is the belt to that braces — the incident above proves
 *     that one layer between "the client sent nothing" and "the database deletes
 *     everything" is not enough.
 *  2. Members are pinned to their own leads. `forcedAssigneeId` mirrors
 *     middleware/auth.ts:forcedAssigneeId and is applied as an ADDITIONAL where
 *     term, so a member who ticks (or hand-crafts a request containing) another
 *     person's lead id simply matches zero rows rather than editing it. Ids are
 *     never trusted as proof of ownership.
 */
export function resolveBulkScope(input: { ids: string[]; user: BulkActor }): BulkScope {
  if (!Array.isArray(input.ids) || input.ids.length === 0) {
    return {
      ok:     false,
      status: 400,
      error:  "Refusing to act on an empty selection: no lead ids were provided.",
    };
  }

  return {
    ok:               true,
    ids:              input.ids,
    forcedAssigneeId: input.user.role === "admin" ? null : input.user.id,
  };
}

/**
 * The WHERE terms a bulk statement must carry. NEVER a partial filter.
 *
 * The `ids.length === 0` early return is the load-bearing line. Without it a
 * member with an empty selection would produce the single `assignee_eq` term —
 * a perfectly valid, non-empty WHERE clause that matches EVERY lead they own.
 * The statement would have looked filtered, passed the route's
 * `conditions.length === 0` check, and quietly rewritten their whole pipeline.
 * An empty selection must yield an empty plan so the route refuses.
 */
export function bulkLeadWhereTerms(scope: {
  ids:              string[];
  forcedAssigneeId: string | null;
}): BulkWhereTerm[] {
  if (scope.ids.length === 0) return [];

  const terms: BulkWhereTerm[] = [{ kind: "id_in", ids: scope.ids }];
  if (scope.forcedAssigneeId) {
    terms.push({ kind: "assignee_eq", assigneeId: scope.forcedAssigneeId });
  }
  return terms;
}

// ── Bulk edit: which fields, and what they mean ───────────

/**
 * The fields a bulk edit may change, as they arrive on the wire.
 *
 * This list is short because it is the list of fields that genuinely EXIST on
 * `leads` and that it is meaningful to set to one shared value across many rows.
 * Notably absent, and absent because the column does not exist rather than by
 * choice:
 *
 *   • priority — `leads` has no priority column. Tasks do; leads do not.
 *   • tags     — `leads` has no user-editable tag column. `complaint_tags` is
 *                populated by the n8n enrichment ingest (/intel/*) and describes
 *                what customers complain about, not a label a salesperson picks.
 *
 * Neither was invented here. Per-lead fields (name, company, email, phone, notes,
 * deal value, follow-up date) are excluded on purpose too: writing one name or one
 * phone number across a hundred leads is only ever a mistake.
 */
export interface BulkLeadPatchInput {
  stage?:       string;
  /** null or "" unassigns. */
  assignee_id?: string | null;
  /** null or "" clears the category. */
  category?:    string | null;
  /** null or "" clears the source. */
  source?:      string | null;
}

export interface BulkLeadPatch {
  /** Drizzle column names → values, ready to hand to `.set()`. */
  columns: Record<string, unknown>;
  /** Wire field names that were present, for the response and the audit log. */
  changed: string[];
  /** True when the stage moved, which the route turns into per-lead activities. */
  stageChanged: boolean;
}

/**
 * Map a wire patch to the columns to write.
 *
 * `hasOwnProperty` rather than `!== undefined`, and the same `set()` shape as
 * routes/company-settings.ts: for the clearable fields `null` is a real value
 * ("remove the category") and has to be distinguishable from absent ("leave it
 * alone"). An `||` chain here would silently ignore every attempt to clear one —
 * the exact bug the follow-up fields carry a comment about in routes/crm.ts.
 *
 * Returns an EMPTY `columns` for an empty patch. The caller must refuse that:
 * `db.update(leads).set({})` is a syntax error at best and a no-op write of
 * `updated_at` at worst, and either way the user asked for nothing.
 */
export function buildBulkLeadPatch(input: BulkLeadPatchInput): BulkLeadPatch {
  const columns: Record<string, unknown> = {};
  const changed: string[] = [];

  const has = (key: keyof BulkLeadPatchInput) =>
    Object.prototype.hasOwnProperty.call(input, key);

  if (has("stage") && input.stage) {
    columns.stage = input.stage;
    changed.push("stage");
  }
  if (has("assignee_id")) {
    columns.assigneeId = input.assignee_id || null;
    changed.push("assignee_id");
  }
  if (has("category")) {
    columns.category = input.category || null;
    changed.push("category");
  }
  if (has("source")) {
    columns.source = input.source || null;
    changed.push("source");
  }

  return { columns, changed, stageChanged: changed.includes("stage") };
}

/**
 * May this caller apply this patch at all?
 *
 * Mirrors the single-lead PATCH in routes/crm.ts: a member cannot reassign a lead
 * to (or away from) somebody else. Without this a member could bulk-hand their
 * whole pipeline to another person — or, more likely, quietly take someone
 * else's. Row scoping alone does not cover it: the leads would all be the
 * member's own, so every WHERE term would pass.
 */
export function assertBulkPatchAllowed(
  patch: BulkLeadPatchInput,
  user:  BulkActor,
): { ok: true } | { ok: false; status: 403; error: string } {
  const isAdmin = user.role === "admin";
  if (
    !isAdmin
    && Object.prototype.hasOwnProperty.call(patch, "assignee_id")
    && patch.assignee_id !== user.id
  ) {
    return { ok: false, status: 403, error: "You cannot reassign leads" };
  }
  return { ok: true };
}
