/** Shared display formatting. */

const CURRENCY = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

/** Formats a DRF decimal string as currency; blank input renders as a dash. */
export function money(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '-';
  const value = Number(amount);
  return Number.isNaN(value) ? String(amount) : CURRENCY.format(value);
}

/** Compact form for dashboard tiles: 1.2L, 85.4K. */
export function compactMoney(amount: string | number | null | undefined): string {
  const value = Number(amount ?? 0);
  if (Number.isNaN(value)) return '-';
  if (Math.abs(value) >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)}Cr`;
  if (Math.abs(value) >= 100_000) return `₹${(value / 100_000).toFixed(2)}L`;
  if (Math.abs(value) >= 1_000) return `₹${(value / 1_000).toFixed(1)}K`;
  return money(value);
}
