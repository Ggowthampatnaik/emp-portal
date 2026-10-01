/**
 * The calendar's date arithmetic.
 *
 * This is the part that goes wrong quietly, in the months nobody checks: a
 * holiday drawn one square early, February missing a day in a leap year, a
 * month whose 1st is a Sunday starting in the wrong column, or a grid that
 * changes height as you page through the year.
 */

import { describe, expect, it } from 'vitest';

import { monthCells, monthShape, WEEKS_SHOWN } from '@/features/leave/monthGrid';
import type { Holiday } from '@/types/domain';

function holiday(date: string, name: string, is_optional = false): Holiday {
  return { id: 1, date, name, description: '', is_optional, day_of_week: '' };
}

describe('monthShape', () => {
  it('counts the days in a month', () => {
    expect(monthShape(2026, 0).days).toBe(31); // January
    expect(monthShape(2026, 3).days).toBe(30); // April
    expect(monthShape(2026, 1).days).toBe(28); // February 2026
  });

  it('gives February its extra day in a leap year', () => {
    expect(monthShape(2028, 1).days).toBe(29);
  });

  it('puts the 1st in the right Monday-first column', () => {
    // 1 Jan 2026 is a Thursday, so it sits in column 3 counting Monday as 0.
    expect(monthShape(2026, 0).offset).toBe(3);
    // 1 Feb 2026 is a Sunday - the last column, not the first.
    expect(monthShape(2026, 1).offset).toBe(6);
    // 1 Jun 2026 is a Monday, so the month starts flush.
    expect(monthShape(2026, 5).offset).toBe(0);
  });
});

describe('monthCells', () => {
  it('always draws the same six weeks, so paging does not resize the grid', () => {
    for (let month = 0; month < 12; month += 1) {
      expect(monthCells(2026, month, [], '2026-09-04')).toHaveLength(WEEKS_SHOWN * 7);
    }
  });

  it('starts on the Monday of the week the 1st falls in', () => {
    // 1 Jan 2026 is a Thursday, so the grid opens on Monday 29 December.
    const cells = monthCells(2026, 0, [], '2026-09-04');

    expect(cells[0]).toMatchObject({ date: '2025-12-29', day: 29, inMonth: false });
    expect(cells[3]).toMatchObject({ date: '2026-01-01', day: 1, inMonth: true });
  });

  it('borrows real dates from the months either side', () => {
    const cells = monthCells(2026, 0, [], '2026-09-04');
    const trailing = cells.filter((cell) => !cell.inMonth).map((cell) => cell.date);

    // Nothing invented: every borrowed cell is a genuine date.
    expect(trailing).toContain('2025-12-31');
    expect(trailing).toContain('2026-02-01');
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(31);
  });

  it('marks a holiday on the day it actually falls', () => {
    // The bug this guards: parsing "2026-09-14" as a Date is UTC midnight,
    // which is the 13th in IST - so the bar lands a square early.
    const cells = monthCells(
      2026,
      8,
      [holiday('2026-09-14', 'Ganesh Chaturthi')],
      '2026-09-04',
    );
    const marked = cells.filter((cell) => cell.holiday);

    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatchObject({ day: 14, inMonth: true });
    expect(marked[0]?.holiday?.name).toBe('Ganesh Chaturthi');
  });

  it('keeps an optional holiday distinguishable', () => {
    const cells = monthCells(
      2026,
      4,
      [holiday('2026-05-01', 'Labour Day', true)],
      '2026-09-04',
    );

    expect(cells.find((cell) => cell.holiday)?.holiday?.is_optional).toBe(true);
  });

  it('flags today, and only today', () => {
    const cells = monthCells(2026, 8, [], '2026-09-04');
    const today = cells.filter((cell) => cell.isToday);

    expect(today).toHaveLength(1);
    expect(today[0]).toMatchObject({ day: 4 });
  });

  it('flags no day as today when the month is elsewhere in the year', () => {
    expect(monthCells(2026, 0, [], '2026-09-04').some((cell) => cell.isToday)).toBe(false);
  });

  it('treats Saturday and Sunday as the weekend', () => {
    // 5 and 6 September 2026 are the Saturday and Sunday. Compared by date,
    // not by day number: the grid also carries 3 and 4 October, which are a
    // weekend of their own.
    const cells = monthCells(2026, 8, [], '2026-09-04');
    const weekend = cells.filter((cell) => cell.isWeekend).map((cell) => cell.date);

    expect(weekend).toContain('2026-09-05');
    expect(weekend).toContain('2026-09-06');
    expect(weekend).not.toContain('2026-09-04');
    // Every seventh pair and no more: six weeks of two.
    expect(weekend).toHaveLength(WEEKS_SHOWN * 2);
  });
});
