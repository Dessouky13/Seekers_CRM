import { describe, it, expect } from "vitest";
import { rankWorklist, valueBonus, formatAge, type WorklistInputs, type ManualTouchRow } from "./worklist-ranking";

const NOW = new Date("2026-08-03T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo  = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

/** Empty board; each test fills in only what it cares about. */
function inputs(over: Partial<WorklistInputs> = {}): WorklistInputs {
  return {
    now: NOW,
    replies: [], hotLeads: [], blocked: [],
    dueTasks: [], staleLeads: [], unassigned: [],
    ...over,
  };
}

const manualTouch = (over: Partial<ManualTouchRow> = {}): ManualTouchRow => ({
  enrollmentId: "enr-1", leadId: "lead-manual", leadName: "Karim Ezzat",
  leadCompany: "Ezzat Clinics", channel: "whatsapp",
  message: "Hi {{first_name}} — quick question about {{company}}.",
  phoneE164: "+201234567890", dealValue: 60_000, since: hoursAgo(2),
  ...over,
});

const reply = (over: Partial<WorklistInputs["replies"][0]> = {}) => ({
  leadId: "lead-reply", name: "Dr. Aya Mansour", company: "Rajac Dental",
  dealValue: 85_000, repliedAt: hoursAgo(1), preview: "Interesting — tell me more",
  ...over,
});

const stale = (over: Partial<WorklistInputs["staleLeads"][0]> = {}) => ({
  leadId: "lead-stale", name: "Genesis School", company: "Genesis",
  dealValue: 40_000, stage: "proposal_sent", lastActivity: daysAgo(9),
  ...over,
});

describe("rankWorklist — ordering", () => {
  it("puts an unanswered reply above everything else", () => {
    const out = rankWorklist(inputs({
      replies: [reply()],
      hotLeads: [{ leadId: "h", name: "Backyard", company: "Backyard", dealValue: 120_000, views: 4, slug: "s", lastViewAt: hoursAgo(2) }],
      dueTasks: [{ taskId: "t", title: "Ship it", dueDate: "2026-07-20", priority: "critical", projectName: null }],
      staleLeads: [stale()],
    }));
    expect(out[0].type).toBe("reply_waiting");
  });

  it("ranks a bigger deal above a smaller one, all else equal", () => {
    const out = rankWorklist(inputs({
      replies: [
        reply({ leadId: "small", name: "Small", dealValue: 2_000 }),
        reply({ leadId: "big",   name: "Big",   dealValue: 900_000 }),
      ],
    }));
    expect(out.map((a) => a.leadId)).toEqual(["big", "small"]);
  });

  it("escalates a reply the longer it goes unanswered", () => {
    const fresh = rankWorklist(inputs({ replies: [reply({ repliedAt: hoursAgo(0.2) })] }))[0];
    const old   = rankWorklist(inputs({ replies: [reply({ repliedAt: hoursAgo(20) })] }))[0];
    expect(old.score).toBeGreaterThan(fresh.score);
  });

  it("decays a hot lead as the audit view gets older", () => {
    const base = { leadId: "h", name: "N", company: "C", dealValue: 50_000, views: 4, slug: "s" };
    const recent = rankWorklist(inputs({ hotLeads: [{ ...base, lastViewAt: hoursAgo(1) }] }))[0];
    const week   = rankWorklist(inputs({ hotLeads: [{ ...base, lastViewAt: daysAgo(7) }] }))[0];
    expect(recent.score).toBeGreaterThan(week.score);
  });

  it("pushes an overdue task above one merely due today", () => {
    const out = rankWorklist(inputs({
      dueTasks: [
        { taskId: "today",   title: "Due today", dueDate: "2026-08-03", priority: "medium", projectName: null },
        { taskId: "overdue", title: "Overdue",   dueDate: "2026-07-28", priority: "medium", projectName: null },
      ],
    }));
    expect(out.map((a) => a.taskId)).toEqual(["overdue", "today"]);
  });

  it("weights a blocked sequence by how many leads are frozen behind it", () => {
    const one  = rankWorklist(inputs({ blocked: [{ enrollmentId: "a", sequenceName: "S", reason: "no body", leadCount: 1,  since: hoursAgo(5) }] }))[0];
    const many = rankWorklist(inputs({ blocked: [{ enrollmentId: "b", sequenceName: "S", reason: "no body", leadCount: 40, since: hoursAgo(5) }] }))[0];
    expect(many.score).toBeGreaterThan(one.score);
  });
});

describe("rankWorklist — manual_touch", () => {
  it("emits a manual_touch action carrying all four enrollment fields", () => {
    const out = rankWorklist(inputs({
      manualTouches: [manualTouch({
        enrollmentId: "enr-42", channel: "whatsapp",
        message: "Hi Karim — quick question about Ezzat Clinics.",
        phoneE164: "+201112223334",
      })],
    }));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("manual_touch");
    expect(out[0].enrollmentId).toBe("enr-42");
    expect(out[0].channel).toBe("whatsapp");
    expect(out[0].message).toBe("Hi Karim — quick question about Ezzat Clinics.");
    expect(out[0].phoneE164).toBe("+201112223334");
  });

  it("grows ageHours with wait time, older enrollment ranked with a larger age", () => {
    const fresh = rankWorklist(inputs({
      manualTouches: [manualTouch({ enrollmentId: "fresh", leadId: "lead-fresh", since: hoursAgo(1) })],
    }))[0];
    const old = rankWorklist(inputs({
      manualTouches: [manualTouch({ enrollmentId: "old", leadId: "lead-old", since: hoursAgo(30) })],
    }))[0];
    expect(old.ageHours).toBeGreaterThan(fresh.ageHours);
  });

  it("says the message is ready to send for whatsapp, but to call for call", () => {
    const whatsapp = rankWorklist(inputs({
      manualTouches: [manualTouch({ channel: "whatsapp" })],
    }))[0];
    const call = rankWorklist(inputs({
      manualTouches: [manualTouch({ enrollmentId: "enr-2", leadId: "lead-call", channel: "call" })],
    }))[0];
    expect(whatsapp.reason).toBe("WhatsApp message ready to send");
    expect(call.reason).toBe("Call this lead");
  });

  it("explains a downgraded channel in the card's own words", () => {
    // worklist.ts routes every touch through channels.ts:manualTouchRouting
    // first, so a whatsapp step on a landline arrives here already downgraded to
    // a call. The card must say WHY, or someone reading a "call this lead" card
    // on a WhatsApp sequence has no idea what happened.
    const out = rankWorklist(inputs({
      manualTouches: [manualTouch({
        channel: "call",
        channelNote: "landline — WhatsApp not available — call instead",
      })],
    }))[0];
    expect(out.reason).toBe("Call this lead — landline — WhatsApp not available — call instead");
  });

  it("sorts a manual_touch ahead of a lower-priority action type", () => {
    const out = rankWorklist(inputs({
      manualTouches: [manualTouch()],
      staleLeads: [stale()],
    }));
    expect(out[0].type).toBe("manual_touch");
    expect(out.map((a) => a.type)).toEqual(["manual_touch", "stale_lead"]);
  });
});

describe("rankWorklist — deduplication", () => {
  it("shows a lead that both replied and went hot exactly once, as the reply", () => {
    const out = rankWorklist(inputs({
      replies:  [reply({ leadId: "same" })],
      hotLeads: [{ leadId: "same", name: "Dr. Aya Mansour", company: "Rajac Dental", dealValue: 85_000, views: 9, slug: "s", lastViewAt: hoursAgo(1) }],
    }));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("reply_waiting");
  });

  it("keeps a lead that is both stale and unassigned to a single entry", () => {
    const out = rankWorklist(inputs({
      staleLeads: [stale({ leadId: "dup" })],
      unassigned: [{ leadId: "dup", name: "Genesis School", company: "Genesis", dealValue: 40_000, createdAt: daysAgo(20) }],
    }));
    expect(out.filter((a) => a.leadId === "dup")).toHaveLength(1);
  });

  it("never collapses two distinct leads together", () => {
    const out = rankWorklist(inputs({
      replies: [reply({ leadId: "a" }), reply({ leadId: "b" })],
    }));
    expect(out).toHaveLength(2);
  });

  it("never drops a pending manual touch just because the lead also replied", () => {
    // The bug this guards: dedupe was by leadId with the highest score winning,
    // and reply_waiting (1000) outranks manual_touch (900). So a lead who
    // replied while blocked on a WhatsApp step lost their manual-touch card —
    // and that card is the ONLY thing in the product that can resolve an
    // awaiting_action enrollment, because nothing else calls
    // POST /enrollments/:id/touch-outcome. The database went on saying a human
    // must act, with no screen anywhere saying so.
    const out = rankWorklist(inputs({
      replies:       [reply({ leadId: "same" })],
      manualTouches: [manualTouch({ leadId: "same" })],
    }));
    expect(out.map((a) => a.type)).toEqual(["reply_waiting", "manual_touch"]);
    expect(out.find((a) => a.type === "manual_touch")?.enrollmentId).toBe("enr-1");
  });

  it("does not let a manual touch suppress other cards for the same lead either", () => {
    // Exempt in BOTH directions: the touch is an extra job, not a replacement
    // for whatever else that lead needs.
    const out = rankWorklist(inputs({
      manualTouches: [manualTouch({ leadId: "same" })],
      staleLeads:    [stale({ leadId: "same" })],
    }));
    expect(out.map((a) => a.type)).toEqual(["manual_touch", "stale_lead"]);
  });

  it("still collapses two non-manual cards for one lead", () => {
    // The exemption is scoped to manual_touch and must not have loosened the
    // rest of the deduper.
    const out = rankWorklist(inputs({
      replies:  [reply({ leadId: "same" })],
      hotLeads: [{ leadId: "same", name: "N", company: "C", dealValue: 1, views: 9, slug: "s", lastViewAt: hoursAgo(1) }],
      manualTouches: [manualTouch({ leadId: "same" })],
    }));
    expect(out.map((a) => a.type)).toEqual(["reply_waiting", "manual_touch"]);
  });

  it("keeps every lead-less action even when several share a type", () => {
    const out = rankWorklist(inputs({
      dueTasks: [
        { taskId: "t1", title: "One", dueDate: "2026-08-03", priority: "low", projectName: null },
        { taskId: "t2", title: "Two", dueDate: "2026-08-03", priority: "low", projectName: null },
      ],
      blocked: [
        { enrollmentId: "e1", sequenceName: "A", reason: "x", leadCount: 2, since: hoursAgo(3) },
        { enrollmentId: "e2", sequenceName: "B", reason: "y", leadCount: 2, since: hoursAgo(3) },
      ],
    }));
    expect(out).toHaveLength(4);
  });
});

describe("rankWorklist — urgency + copy", () => {
  it("marks replies and hot leads as 'now'", () => {
    const out = rankWorklist(inputs({
      replies:  [reply()],
      hotLeads: [{ leadId: "h", name: "N", company: "C", dealValue: 1, views: 3, slug: "s", lastViewAt: hoursAgo(1) }],
    }));
    expect(out.every((a) => a.urgency === "now")).toBe(true);
  });

  it("files stale leads under 'week' so they never crowd out live work", () => {
    expect(rankWorklist(inputs({ staleLeads: [stale()] }))[0].urgency).toBe("week");
  });

  it("says how long a reply has been waiting", () => {
    expect(rankWorklist(inputs({ replies: [reply({ repliedAt: hoursAgo(5) })] }))[0].reason)
      .toMatch(/5h ago and nobody has answered/);
  });

  it("calls out a never-contacted lead rather than inventing a date", () => {
    expect(rankWorklist(inputs({ staleLeads: [stale({ lastActivity: null })] }))[0].reason)
      .toMatch(/never contacted/);
  });

  it("counts overdue days in plain language", () => {
    const out = rankWorklist(inputs({
      dueTasks: [{ taskId: "t", title: "T", dueDate: "2026-08-02", priority: "low", projectName: null }],
    }));
    expect(out[0].reason).toBe("1 day overdue");
  });

  it("carries a deep link on every action", () => {
    const out = rankWorklist(inputs({
      replies: [reply()],
      dueTasks: [{ taskId: "t", title: "T", dueDate: "2026-08-03", priority: "low", projectName: null }],
      blocked: [{ enrollmentId: "e", sequenceName: "S", reason: "r", leadCount: 1, since: hoursAgo(1) }],
    }));
    expect(out.every((a) => a.deepLink.startsWith("/"))).toBe(true);
  });

  it("gives every action a stable id across identical runs", () => {
    const build = () => rankWorklist(inputs({ replies: [reply()], staleLeads: [stale()] })).map((a) => a.id);
    expect(build()).toEqual(build());
  });
});

describe("rankWorklist — edges", () => {
  it("returns an empty list when there is nothing to do", () => {
    expect(rankWorklist(inputs())).toEqual([]);
  });

  it("survives a lead with no company and no deal value", () => {
    const out = rankWorklist(inputs({
      replies: [reply({ company: null, dealValue: 0, preview: null })],
    }));
    expect(out[0].subtitle).toBeNull();
    expect(out[0].score).toBeGreaterThan(0);
  });

  it("does not let a single huge deal outrank a reply", () => {
    const out = rankWorklist(inputs({
      replies:    [reply({ leadId: "reply", dealValue: 1_000 })],
      staleLeads: [stale({ leadId: "whale", dealValue: 10_000_000 })],
    }));
    expect(out[0].leadId).toBe("reply");
  });
});

describe("valueBonus", () => {
  it("is zero for missing or non-positive values", () => {
    expect(valueBonus(0)).toBe(0);
    expect(valueBonus(-5)).toBe(0);
    expect(valueBonus(NaN)).toBe(0);
  });

  it("rises with value but stays capped", () => {
    expect(valueBonus(1_000)).toBeLessThan(valueBonus(100_000));
    expect(valueBonus(1e12)).toBeLessThanOrEqual(300);
  });
});

describe("formatAge", () => {
  it("uses minutes, hours then days", () => {
    expect(formatAge(0.5)).toBe("30 min");
    expect(formatAge(5)).toBe("5h");
    expect(formatAge(72)).toBe("3 days");
  });

  it("never reports zero minutes", () => {
    expect(formatAge(0)).toBe("1 min");
  });
});
