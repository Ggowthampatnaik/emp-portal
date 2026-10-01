/**
 * Calendar-date helpers.
 *
 * The API speaks calendar dates ("2026-08-24"), not instants. `toISOString()`
 * converts to UTC first, so in any timezone ahead of UTC a local midnight
 * becomes the *previous* day - which silently shifted the timesheet grid a week
 * out of step with the sheet it was editing. These helpers read the local
 * calendar fields directly and never touch UTC.
 */

/** Formats a Date as YYYY-MM-DD using its local calendar fields. */
export function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today, as the user's calendar sees it. */
export function todayIso(): string {
  return toIsoDate(new Date());
}

/** Parses YYYY-MM-DD as a local date - `new Date('2026-08-24')` is UTC midnight. */
export function fromIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/** The Monday of the week containing `value`. */
export function mondayOf(value: Date): Date {
  const copy = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7)); // Monday = 0
  return copy;
}

export function addDays(value: Date, days: number): Date {
  const copy = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

/**
 * Whole days from one calendar date to another - negative once `to` has
 * passed. Both are parsed as local midnights, so daylight saving cannot leave
 * a fractional day behind and round the answer to the wrong side.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = fromIsoDate(fromIso);
  const to = fromIsoDate(toIso);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/* -- Display ---------------------------------------------------------------
 *
 * The API's calendar dates were being rendered raw, so "2024-06-03" reached
 * the screen on some pages while others showed "03/06/2024". One house format
 * throughout: `3 Jun 2024`, which is unambiguous for readers who expect
 * day-first and readers who expect month-first alike.
 *
 * These parse through `fromIsoDate`, so they inherit its local-calendar
 * handling rather than re-introducing the UTC shift described above.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * `2024-06-03` -> `3 Jun 2024`. Returns an em dash for a missing date, which is
 * what the profile cards already show for an unfilled field.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = fromIsoDate(iso.slice(0, 10));
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** `2024-06-03` -> `3 Jun`. For axis ticks and dense table columns. */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = fromIsoDate(iso.slice(0, 10));
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/**
 * An ISO *instant* -> `3 Jun 2024, 09:45`. Unlike the helpers above this one
 * is a timestamp, so it is read in local time on purpose - and the seconds are
 * dropped, which no reader of a sign-in log has ever wanted.
 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`;
}

/** `2026-08-31`, `2026-09-06` -> `31 Aug → 6 Sep 2026`. The year is stated once. */
export function formatDateRange(startIso: string, endIso: string): string {
  const start = fromIsoDate(startIso.slice(0, 10));
  const end = fromIsoDate(endIso.slice(0, 10));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startIso} → ${endIso}`;
  }
  const left =
    start.getFullYear() === end.getFullYear()
      ? formatDateShort(startIso)
      : formatDate(startIso);
  return `${left} → ${formatDate(endIso)}`;
}
