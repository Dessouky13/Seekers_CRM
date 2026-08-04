import { describe, it, expect } from "vitest";
import {
  resolveBulkScope, bulkLeadWhereTerms, buildBulkLeadPatch, assertBulkPatchAllowed,
} from "./bulk-leads";

const ADMIN  = { id: "admin-1",  role: "admin"  };
const MEMBER = { id: "member-1", role: "member" };
const ID_A   = "11111111-1111-1111-1111-111111111111";
const ID_B   = "22222222-2222-2222-2222-222222222222";

describe("resolveBulkScope — an empty selection can never mutate anything", () => {
  // The 735-lead incident in this file's history: `![]` is false, so an empty
  // array passed the "did you provide a filter?" guard while contributing no SQL
  // condition, and the DELETE ran unfiltered.
  it("refuses an empty ids array with 400", () => {
    const scope = resolveBulkScope({ ids: [], user: ADMIN });
    expect(scope.ok).toBe(false);
    if (!scope.ok) expect(scope.status).toBe(400);
  });

  it("refuses an empty selection for a member too, not just an admin", () => {
    expect(resolveBulkScope({ ids: [], user: MEMBER }).ok).toBe(false);
  });

  it("refuses a non-array masquerading as ids", () => {
    // JSON from a hand-crafted client is not necessarily an array. Zod rejects
    // this on the wire; this is the layer that does not depend on Zod.
    expect(resolveBulkScope({ ids: null as unknown as string[], user: ADMIN }).ok).toBe(false);
  });

  it("accepts a non-empty selection", () => {
    const scope = resolveBulkScope({ ids: [ID_A], user: ADMIN });
    expect(scope.ok).toBe(true);
    if (scope.ok) expect(scope.ids).toEqual([ID_A]);
  });
});

describe("resolveBulkScope — role scoping", () => {
  it("pins a member to their own leads", () => {
    const scope = resolveBulkScope({ ids: [ID_A, ID_B], user: MEMBER });
    expect(scope.ok).toBe(true);
    if (scope.ok) expect(scope.forcedAssigneeId).toBe("member-1");
  });

  it("does not restrict an admin", () => {
    const scope = resolveBulkScope({ ids: [ID_A], user: ADMIN });
    if (scope.ok) expect(scope.forcedAssigneeId).toBeNull();
  });

  it("treats an unknown role as a member, not as an admin", () => {
    // Fail closed. A profile row whose role is somehow neither value must not
    // get company-wide write access.
    const scope = resolveBulkScope({ ids: [ID_A], user: { id: "u", role: undefined } });
    if (scope.ok) expect(scope.forcedAssigneeId).toBe("u");
  });
});

describe("bulkLeadWhereTerms — the WHERE clause is never partial", () => {
  it("produces NO terms for an empty selection, so the route refuses", () => {
    expect(bulkLeadWhereTerms({ ids: [], forcedAssigneeId: null })).toEqual([]);
  });

  it("produces NO terms for a member with an empty selection", () => {
    // The dangerous case. Emitting only the assignee term here would be a
    // non-empty, apparently-valid WHERE clause matching EVERY lead the member
    // owns — it would sail past the route's `conditions.length === 0` check.
    expect(bulkLeadWhereTerms({ ids: [], forcedAssigneeId: "member-1" })).toEqual([]);
  });

  it("always includes the id filter", () => {
    const terms = bulkLeadWhereTerms({ ids: [ID_A, ID_B], forcedAssigneeId: null });
    expect(terms).toEqual([{ kind: "id_in", ids: [ID_A, ID_B] }]);
  });

  it("adds the assignee filter for a member so ticked ids are not proof of ownership", () => {
    const terms = bulkLeadWhereTerms({ ids: [ID_A, ID_B], forcedAssigneeId: "member-1" });
    expect(terms).toContainEqual({ kind: "id_in", ids: [ID_A, ID_B] });
    expect(terms).toContainEqual({ kind: "assignee_eq", assigneeId: "member-1" });
    expect(terms).toHaveLength(2);
  });

  it("omits the assignee filter for an admin", () => {
    const terms = bulkLeadWhereTerms({ ids: [ID_A], forcedAssigneeId: null });
    expect(terms.some((t) => t.kind === "assignee_eq")).toBe(false);
  });
});

describe("buildBulkLeadPatch", () => {
  it("returns no columns for an empty patch, so the route refuses", () => {
    expect(buildBulkLeadPatch({}).columns).toEqual({});
    expect(buildBulkLeadPatch({}).changed).toEqual([]);
  });

  it("maps stage, assignee, category and source to their columns", () => {
    const patch = buildBulkLeadPatch({
      stage: "contacted", assignee_id: "u-1", category: "clinics", source: "apollo",
    });
    expect(patch.columns).toEqual({
      stage: "contacted", assigneeId: "u-1", category: "clinics", source: "apollo",
    });
    expect(patch.stageChanged).toBe(true);
  });

  it("treats null as 'clear this field', not as 'leave it alone'", () => {
    const patch = buildBulkLeadPatch({ category: null, assignee_id: null, source: null });
    expect(patch.columns).toEqual({ category: null, assigneeId: null, source: null });
    expect(patch.changed).toEqual(["assignee_id", "category", "source"]);
  });

  it("treats an empty string the same as null — an empty <select> option clears", () => {
    expect(buildBulkLeadPatch({ category: "" }).columns).toEqual({ category: null });
  });

  it("ignores a blank stage rather than writing an invalid one", () => {
    // stage is NOT NULL with a 7-value enum; "" would violate it. There is no
    // "no stage" to set, so a blank is a no-op.
    const patch = buildBulkLeadPatch({ stage: "" });
    expect(patch.columns).toEqual({});
    expect(patch.stageChanged).toBe(false);
  });

  it("does not report a stage change when the stage was not part of the patch", () => {
    expect(buildBulkLeadPatch({ category: "clinics" }).stageChanged).toBe(false);
  });
});

describe("assertBulkPatchAllowed — reassignment", () => {
  it("lets an admin reassign to anybody", () => {
    expect(assertBulkPatchAllowed({ assignee_id: "someone-else" }, ADMIN).ok).toBe(true);
  });

  it("stops a member handing leads to someone else", () => {
    const result = assertBulkPatchAllowed({ assignee_id: "someone-else" }, MEMBER);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("stops a member unassigning leads", () => {
    // null is "unassigned", which is also not themselves.
    expect(assertBulkPatchAllowed({ assignee_id: null }, MEMBER).ok).toBe(false);
  });

  it("lets a member assign leads to themselves", () => {
    expect(assertBulkPatchAllowed({ assignee_id: "member-1" }, MEMBER).ok).toBe(true);
  });

  it("lets a member change fields other than the assignee", () => {
    expect(assertBulkPatchAllowed({ stage: "contacted", category: "gyms" }, MEMBER).ok).toBe(true);
  });
});
