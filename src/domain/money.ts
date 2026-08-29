/**
 * Money and number handling.
 *
 * Every monetary value in the system is a whole number of RWF held in a
 * JavaScript number. RWF amounts in a cooperative stay far below
 * Number.MAX_SAFE_INTEGER, so integer arithmetic here is exact, but only as
 * long as nothing introduces a fraction. `toMoney` is the single gate that
 * guarantees that, and every service rounds through it before storing.
 */

export const CURRENCY = 'RWF';

export class MoneyError extends Error {}

/** Coerce a value to a whole, finite RWF amount. Throws on anything else. */
export function toMoney(value: unknown, field = 'amount'): number {
  const n = typeof value === 'string' ? Number(value.replace(/[\s,]/g, '')) : Number(value);
  if (!Number.isFinite(n)) throw new MoneyError(`${field} must be a number`);
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) throw new MoneyError(`${field} is out of range`);
  return Math.round(n);
}

/** Whole-RWF amount that must be strictly positive (payments, harvest value). */
export function toPositiveMoney(value: unknown, field = 'amount'): number {
  const n = toMoney(value, field);
  if (n <= 0) throw new MoneyError(`${field} must be greater than zero`);
  return n;
}

/** Whole-RWF amount that may be zero but never negative (deductions, bonuses). */
export function toNonNegativeMoney(value: unknown, field = 'amount'): number {
  const n = toMoney(value, field);
  if (n < 0) throw new MoneyError(`${field} cannot be negative`);
  return n;
}

/**
 * Quantity of produce. Allows one decimal place (450.5 KG is real; so is 2.5
 * tonnes) but never a negative or non-finite value.
 */
export function toQuantity(value: unknown, field = 'quantity'): number {
  const n = typeof value === 'string' ? Number(value.replace(/[\s,]/g, '')) : Number(value);
  if (!Number.isFinite(n)) throw new MoneyError(`${field} must be a number`);
  if (n < 0) throw new MoneyError(`${field} cannot be negative`);
  if (n > 10_000_000) throw new MoneyError(`${field} is unrealistically large`);
  return Math.round(n * 100) / 100;
}

/** Gross value of a harvest line. Rounded to whole RWF at the boundary. */
export function grossValue(quantity: number, pricePerUnit: number): number {
  return toMoney(toQuantity(quantity) * toMoney(pricePerUnit, 'price per unit'), 'gross value');
}

/* ------------------------------------------------------------ formatting */

const rwf = new Intl.NumberFormat('en-RW', {
  style: 'currency',
  currency: 'RWF',
  maximumFractionDigits: 0,
});

const plain = new Intl.NumberFormat('en-RW', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('en-RW', { maximumFractionDigits: 2 });

/** `180,000 RWF`. The house style, currency after the number. */
export function formatMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '-';
  return `${plain.format(Math.round(amount))} ${CURRENCY}`;
}

/** Compact form for tight cells and chart axes: `1.2M`, `840K`. */
export function formatMoneyShort(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}${abs}`;
}

/** Signed money, for balances where the sign carries meaning. */
export function formatSignedMoney(amount: number): string {
  if (amount === 0) return formatMoney(0);
  return `${amount > 0 ? '+' : '-'}${plain.format(Math.abs(Math.round(amount)))} ${CURRENCY}`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return Number.isInteger(n) ? plain.format(n) : decimal.format(n);
}

export function formatQuantity(n: number, unit?: string): string {
  return unit ? `${formatNumber(n)} ${unit}` : formatNumber(n);
}

export { rwf };
