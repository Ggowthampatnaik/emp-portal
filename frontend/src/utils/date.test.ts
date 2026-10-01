/**
 * These pin the bug that shifted the timesheet grid a week out of step with
 * the sheet it was editing: `toISOString()` converts to UTC first, so local
 * midnight in any timezone ahead of UTC lands on the previous day.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addDays,
  formatDate,
  formatDateRange,
  formatDateShort,
  formatDateTime,
  fromIsoDate,
  mondayOf,
  toIsoDate,
  todayIso,
} from '@/utils/date';

afterEach(() => {
  vi.useRealTimers();
});

describe('toIsoDate', () => {
  it('formats a date from its local calendar fields', () => {
    expect(toIsoDate(new Date(2026, 7, 24))).toBe('2026-08-24');
  });

  it('does not slip a day at local midnight', () => {
    // The exact moment that broke the grid: 00:00 local, which is the previous
    // day in UTC for anywhere east of Greenwich.
    const midnight = new Date(2026, 7, 24, 0, 0, 0);
    expect(toIsoDate(midnight)).toBe('2026-08-24');
  });

  it('does not slip a day late in the evening either', () => {
    // 23:30 local is the *next* day in UTC for anywhere west of Greenwich.
    expect(toIsoDate(new Date(2026, 7, 24, 23, 30))).toBe('2026-08-24');
  });

  it('pads single-digit months and days', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('todayIso', () => {
  it('reports the local calendar day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 24, 0, 15));
    expect(todayIso()).toBe('2026-08-24');
  });
});

describe('fromIsoDate', () => {
  it('parses as a local date, not UTC midnight', () => {
    const parsed = fromIsoDate('2026-08-24');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7);
    expect(parsed.getDate()).toBe(24);
  });

  it('round-trips with toIsoDate', () => {
    expect(toIsoDate(fromIsoDate('2026-02-29'))).toBe('2026-03-01'); // 2026 is not a leap year
    expect(toIsoDate(fromIsoDate('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('mondayOf', () => {
  it.each([
    ['2026-08-24', 'Monday'],
    ['2026-08-26', 'Wednesday'],
    ['2026-08-30', 'Sunday'],
  ])('maps %s (%s) back to Monday 24 August', (iso) => {
    expect(toIsoDate(mondayOf(fromIsoDate(iso)))).toBe('2026-08-24');
  });

  it('is stable when applied twice', () => {
    const once = mondayOf(fromIsoDate('2026-08-30'));
    expect(toIsoDate(mondayOf(once))).toBe(toIsoDate(once));
  });
});

describe('addDays', () => {
  it('builds a week whose first day is the given Monday', () => {
    const monday = fromIsoDate('2026-08-24');
    const week = Array.from({ length: 7 }, (_, index) => toIsoDate(addDays(monday, index)));

    // The grid header and the sheet it edits must agree - this is exactly the
    // pair that disagreed on screen.
    expect(week[0]).toBe('2026-08-24');
    expect(week[6]).toBe('2026-08-30');
  });

  it('crosses a month boundary', () => {
    expect(toIsoDate(addDays(fromIsoDate('2026-08-31'), 1))).toBe('2026-09-01');
  });

  it('crosses a year boundary', () => {
    expect(toIsoDate(addDays(fromIsoDate('2026-12-31'), 1))).toBe('2027-01-01');
  });
});

describe('formatDate', () => {
  it('renders the house format', () => {
    expect(formatDate('2024-06-03')).toBe('3 Jun 2024');
  });

  it('does not slip a day for a date parsed from the API', () => {
    // The whole reason these helpers route through fromIsoDate.
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('tolerates a full timestamp by reading its date half', () => {
    expect(formatDate('2026-08-31T18:30:00Z')).toBe('31 Aug 2026');
  });

  it('shows an em dash rather than "null" for a missing date', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });
});

describe('formatDateShort', () => {
  it('drops the year', () => {
    expect(formatDateShort('2026-09-06')).toBe('6 Sep');
  });
});

describe('formatDateTime', () => {
  it('keeps hours and minutes but drops seconds', () => {
    const stamp = new Date(2026, 7, 31, 9, 45, 1).toISOString();
    expect(formatDateTime(stamp)).toBe('31 Aug 2026, 09:45');
  });

  it('shows an em dash for a missing timestamp', () => {
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('formatDateRange', () => {
  it('states the year once when both ends share it', () => {
    expect(formatDateRange('2026-08-31', '2026-09-06')).toBe('31 Aug → 6 Sep 2026');
  });

  it('states both years when the range crosses one', () => {
    expect(formatDateRange('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 → 3 Jan 2027');
  });
});
