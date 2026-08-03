import { describe, it, expect } from "vitest";
import { planTemplateTasks, templateSpanDays, type TemplateItem } from "./task-templates";

const item = (over: Partial<TemplateItem> = {}): TemplateItem => ({
  title: "Kickoff call", priority: "medium", dayOffset: 0, position: 0,
  ...over,
});

describe("planTemplateTasks", () => {
  it("dates every item relative to the start date", () => {
    const out = planTemplateTasks([
      item({ title: "Kickoff call",   dayOffset: 0, position: 0 }),
      item({ title: "Send contract",  dayOffset: 1, position: 1 }),
      item({ title: "Access handover", dayOffset: 3, position: 2 }),
    ], "2026-08-04");

    expect(out.map((t) => [t.title, t.dueDate])).toEqual([
      ["Kickoff call",    "2026-08-04"],
      ["Send contract",   "2026-08-05"],
      ["Access handover", "2026-08-07"],
    ]);
  });

  it("crosses a month end without losing a day", () => {
    // The reason this is calendar arithmetic and not milliseconds.
    expect(planTemplateTasks([item({ dayOffset: 3 })], "2026-08-30")[0].dueDate)
      .toBe("2026-09-02");
    expect(planTemplateTasks([item({ dayOffset: 1 })], "2028-02-28")[0].dueDate)
      .toBe("2028-02-29");
  });

  it("orders by position, not by date", () => {
    // Two items due the same day must keep the order they were written in, and
    // a negative offset (prep before kickoff) must not jump to the front.
    // Deliberately supplied out of order, so a plain pass-through would fail.
    const out = planTemplateTasks([
      item({ title: "pos1-sameday", dayOffset: 0,  position: 1 }),
      item({ title: "pos0-sameday", dayOffset: 0,  position: 0 }),
      item({ title: "pos2-earlier", dayOffset: -2, position: 2 }),
    ], "2026-08-04");
    expect(out.map((t) => t.title)).toEqual(["pos0-sameday", "pos1-sameday", "pos2-earlier"]);
    // Last by position, but the earliest date — proof the sort is not by date.
    expect(out[2].dueDate).toBe("2026-08-02");
  });

  it("drops blank rows rather than creating untitled tasks", () => {
    const out = planTemplateTasks([
      item({ title: "Real" }),
      item({ title: "   ", position: 1 }),
      item({ title: "",    position: 2 }),
    ], "2026-08-04");
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Real");
  });

  it("trims titles and carries priority through", () => {
    const out = planTemplateTasks([item({ title: "  Send contract  ", priority: "critical" })], "2026-08-04");
    expect(out[0].title).toBe("Send contract");
    expect(out[0].priority).toBe("critical");
  });

  it("does not mutate the caller's array", () => {
    // It sorts, and sorting in place would reorder the template itself.
    const items = [item({ title: "B", position: 1 }), item({ title: "A", position: 0 })];
    planTemplateTasks(items, "2026-08-04");
    expect(items.map((i) => i.title)).toEqual(["B", "A"]);
  });

  it("returns nothing for an empty template", () => {
    expect(planTemplateTasks([], "2026-08-04")).toEqual([]);
  });
});

describe("templateSpanDays", () => {
  it("measures first item to last", () => {
    expect(templateSpanDays([
      item({ dayOffset: 0 }), item({ dayOffset: 14 }), item({ dayOffset: 3 }),
    ])).toBe(14);
  });

  it("is zero for one item, or for none", () => {
    expect(templateSpanDays([item({ dayOffset: 7 })])).toBe(0);
    expect(templateSpanDays([])).toBe(0);
  });

  it("spans across a negative offset", () => {
    expect(templateSpanDays([item({ dayOffset: -2 }), item({ dayOffset: 5 })])).toBe(7);
  });
});
