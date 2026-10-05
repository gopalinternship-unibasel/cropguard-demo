/** Exact USDC/base-unit conversion. No floating point for financial inputs. */
export function parseUnits(value, decimals = 6) {
  if (typeof value !== 'string' || !new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(value)) {
    throw new Error(`Enter a non-negative decimal amount with at most ${decimals} decimal places.`);
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}
export function formatUnits(value, decimals = 6, displayDecimals = 2) {
  const amount = BigInt(value);
  if (amount < 0n) throw new Error('Unexpected negative financial balance.');
  const scale = 10n ** BigInt(decimals);
  const whole = (amount / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (amount % scale).toString().padStart(decimals, '0').slice(0, displayDecimals);
  return displayDecimals ? `${whole}.${fraction.padEnd(displayDecimals, '0')}` : whole;
}
export function shortAddress(value) { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Not connected'; }
