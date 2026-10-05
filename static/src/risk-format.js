import { formatUnits } from './money.js';

/** Display only: round half up to cents. Original integer amounts remain in reports. */
export function money(value) {
  const units = BigInt(value);
  if (units < 0n) throw new Error('Money cannot be negative.');
  return formatUnits(((units + 5000n) / 10000n) * 10000n);
}
export function exactMoney(value) { return formatUnits(value, 6, 6); }
export function percent(value, places = 1) {
  if (!Number.isFinite(value)) throw new Error('Expected a finite probability.');
  return `${(value * 100).toFixed(places)}%`;
}
export function validateFileSize(bytes) {
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > 250000) {
    throw new Error('Choose a non-empty monthly rainfall CSV of at most 250 KB.');
  }
}
