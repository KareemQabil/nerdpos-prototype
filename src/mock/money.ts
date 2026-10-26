// Money and quantity arithmetic for the mock server.
// Money is decimal(19,4); quantity decimal(19,6). Never floating point.
import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Money = string; // always a scale-4 string, e.g. "220.0000"
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN';

export const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
export const m4 = (v: Decimal.Value) => D(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
export const q6 = (v: Decimal.Value) => D(v).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6).replace(/\.?0+$/, '') || '0';
export const ZERO = '0.0000';

const modeOf = (mode: RoundingMode) =>
  mode === 'HALF_EVEN' ? Decimal.ROUND_HALF_EVEN : mode === 'DOWN' ? Decimal.ROUND_DOWN : Decimal.ROUND_HALF_UP;

/** Commercial rounding to the policy scale, returned as a scale-4 Money string. */
export function round(v: Decimal.Value, scale = 2, mode: RoundingMode = 'HALF_UP'): Money {
  return D(v).toDecimalPlaces(scale, modeOf(mode)).toFixed(4);
}

export const add = (...xs: Decimal.Value[]) => m4(xs.reduce<Decimal>((a, x) => a.plus(D(x)), D(0)));
export const sub = (a: Decimal.Value, b: Decimal.Value) => m4(D(a).minus(D(b)));
export const mul = (a: Decimal.Value, b: Decimal.Value) => D(a).times(D(b));
export const pct = (base: Decimal.Value, rate: Decimal.Value) => D(base).times(D(rate)).dividedBy(100);
export const gt = (a: Decimal.Value, b: Decimal.Value) => D(a).greaterThan(D(b));
export const gte = (a: Decimal.Value, b: Decimal.Value) => D(a).greaterThanOrEqualTo(D(b));
export const lt = (a: Decimal.Value, b: Decimal.Value) => D(a).lessThan(D(b));
export const eq = (a: Decimal.Value, b: Decimal.Value) => D(a).equals(D(b));
export const isZero = (a: Decimal.Value) => D(a).isZero();
export const neg = (a: Decimal.Value) => m4(D(a).negated());
export const minM = (a: Decimal.Value, b: Decimal.Value) => (D(a).lessThan(D(b)) ? m4(a) : m4(b));
export const maxM = (a: Decimal.Value, b: Decimal.Value) => (D(a).greaterThan(D(b)) ? m4(a) : m4(b));
export const isMoney = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? /^-?\d+(\.\d{1,4})?$/.test(String(v)) : false;

/**
 * Largest-remainder allocation of `total` over `weights`, at `scale` decimals.
 * Deterministic: ties go to the lower index; any residual lands on the last share.
 */
export function allocate(total: Decimal.Value, weights: Decimal.Value[], scale = 2): Money[] {
  const T = D(total);
  const W = weights.map(D);
  const sumW = W.reduce((a, w) => a.plus(w), D(0));
  if (W.length === 0) return [];
  if (sumW.isZero()) {
    const out = W.map(() => ZERO);
    out[out.length - 1] = m4(T);
    return out;
  }
  const unit = D(1).dividedBy(D(10).pow(scale));
  const exact = W.map((w) => T.times(w).dividedBy(sumW));
  const floored = exact.map((e) => e.toDecimalPlaces(scale, Decimal.ROUND_DOWN));
  let rest = T.minus(floored.reduce((a, f) => a.plus(f), D(0)));
  const order = exact
    .map((e, i) => ({ i, r: e.minus(floored[i]) }))
    .sort((a, b) => b.r.comparedTo(a.r) || a.i - b.i);
  for (const { i } of order) {
    if (rest.lessThan(unit)) break;
    floored[i] = floored[i].plus(unit);
    rest = rest.minus(unit);
  }
  if (!rest.isZero()) floored[floored.length - 1] = floored[floored.length - 1].plus(rest);
  return floored.map((f) => m4(f));
}

export { Decimal };
