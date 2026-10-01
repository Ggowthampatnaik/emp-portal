/**
 * The small arithmetic the reports share.
 *
 * Report rows arrive as strings for anything decimal ("4.0", "12.50"), because
 * that is what the API sends and what the CSV export carries. Everything that
 * compares them has to parse first, so it is done in one place.
 */

export function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 1 becomes 1st, 2 becomes 2nd, 13 becomes 13th. */
export function ordinal(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${rank}th`;
  return `${rank}${['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th'}`;
}

/** A share, rounded, without ever printing 0% for something that is not zero. */
export function percent(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  const share = (part / whole) * 100;
  if (share > 0 && share < 1) return '<1%';
  return `${Math.round(share)}%`;
}
