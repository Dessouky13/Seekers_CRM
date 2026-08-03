// Task templates — turning a saved checklist into dated work.
//
// The pure half. Applying a template is one decision repeated N times ("this
// item is due `day_offset` days after the start date"), and getting it wrong is
// invisible until somebody notices a February onboarding lost a step. So the
// arithmetic lives here, with tests, and routes/task-templates.ts only does the
// database part.
//
// Why templates at all: onboarding a client is the same handful of tasks every
// time, typed in one at a time from memory. The failure mode is not the typing,
// it is the step that gets forgotten on the busy week.
import { addCalendarDays } from "../utils/dates";

export type TaskPriority = "low" | "medium" | "high" | "critical";

/** One line of a saved checklist. */
export interface TemplateItem {
  title:     string;
  priority:  TaskPriority;
  dayOffset: number;
  position:  number;
}

/** One task about to be created. */
export interface PlannedTask {
  title:    string;
  priority: TaskPriority;
  /** `YYYY-MM-DD`, always — every item gets a due date or the list is a pile. */
  dueDate:  string;
}

/**
 * Lay a template out on the calendar.
 *
 * `startDate` is a `YYYY-MM-DD` the caller has already decided (normally
 * `cairoToday()`), never "now" read in here — this stays pure so the month-end
 * and leap-day cases are testable.
 *
 * Ordering is by `position` and NOT by date: two items on the same day must
 * still come out in the order they were written, and an item with a negative
 * offset (prep work before kickoff) must not jump the list.
 */
export function planTemplateTasks(items: TemplateItem[], startDate: string): PlannedTask[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    // A blank title would create an untitled task nobody can act on. Templates
    // are edited as free text, so an empty row is a normal thing to leave behind.
    .filter((i) => i.title.trim().length > 0)
    .map((i) => ({
      title:    i.title.trim(),
      priority: i.priority,
      // addCalendarDays, not `startDate + offset*86400000`: this is calendar
      // arithmetic on a day-string, so it crosses month ends and DST without
      // ever consulting a timezone.
      dueDate:  addCalendarDays(startDate, Math.trunc(i.dayOffset)),
    }));
}

/**
 * How long the checklist runs, in days. Shown when picking a template so
 * "Client onboarding" reads as a fortnight of work rather than a mystery.
 * Zero for an empty template, and never negative.
 */
export function templateSpanDays(items: TemplateItem[]): number {
  if (items.length === 0) return 0;
  const offsets = items.map((i) => Math.trunc(i.dayOffset));
  return Math.max(0, Math.max(...offsets) - Math.min(...offsets));
}
