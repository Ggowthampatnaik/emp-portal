/**
 * The shape of a month as a calendar grid: six rows of seven days, starting on
 * the Monday of the week the 1st falls in, and running on into the next month
 * so every month draws the same size - the way Outlook's month view does.
 *
 * Kept apart from the component so the date arithmetic can be tested directly.
 * It is the part that goes wrong quietly, in the months nobody looks at.
 */

import type { Holiday } from '@/types/domain';

/** Six weeks covers every month, including a 31-day one starting on Sunday. */
export const WEEKS_SHOWN = 6;

export interface CalendarCell {
  /** `YYYY-MM-DD`, so a cell can be compared without parsing a Date. */
  date: string;
  day: number;
  /** False for the leading and trailing days borrowed from the months either side. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  holiday?: Holiday;
}

/** Days in the month, and the Monday-first column its 1st falls in. */
export function monthShape(year: number, month: number): { days: number; offset: number } {
  // Day 0 of the next month is the last day of this one.
  const days = new Date(year, month + 1, 0).getDate();
  // getDay() is Sunday-first; shift so Monday is column 0.
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  return { days, offset };
}

function iso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The 42 cells of a month view, in order. Cells outside the month are real
 * dates from the months either side, marked `inMonth: false`.
 */
export function monthCells(
  year: number,
  month: number,
  holidays: Holiday[],
  todayIso: string,
): CalendarCell[] {
  const { offset } = monthShape(year, month);

  const byDate = new Map<string, Holiday>();
  for (const holiday of holidays) {
    // Keyed by the raw string rather than a parsed Date: `new Date()` on
    // "2026-09-14" is UTC midnight, which is the previous day east of
    // Greenwich - so a holiday would land on the wrong square in IST.
    byDate.set(holiday.date, holiday);
  }

  const first = new Date(year, month, 1 - offset);
  return Array.from({ length: WEEKS_SHOWN * 7 }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
    const key = iso(date);
    const weekday = (date.getDay() + 6) % 7;
    return {
      date: key,
      day: date.getDate(),
      inMonth: date.getMonth() === month && date.getFullYear() === year,
      isToday: key === todayIso,
      isWeekend: weekday >= 5,
      holiday: byDate.get(key),
    };
  });
}
