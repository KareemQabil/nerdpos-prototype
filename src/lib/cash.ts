// Display-only cash helpers for the payment popup. Every input is a server amount string (or what the cashier typed);
// arithmetic uses the shared Decimal helpers — never JavaScript floats. The real change always comes back from the
// server with the payment; these values are a preview while typing.
import { D } from '../mock/money';

const isNum = (s: string | null | undefined) => !!s && /^-?\d+(\.\d+)?$/.test(s);

/** Tendered minus due, at scale 2 (a string), or null when nothing usable was typed. */
export function changePreview(tendered: string, due: string): string | null {
  if (!isNum(tendered) || !isNum(due)) return null;
  return D(tendered).minus(D(due)).toDecimalPlaces(2).toFixed(2);
}

/** Sign of a decimal string: -1, 0 or 1. */
export function sign(v: string | null | undefined): number {
  if (!isNum(v ?? '')) return 0;
  return D(v!).comparedTo(0);
}

/** The smaller of two amounts (strings). */
export function minAmount(a: string, b: string): string {
  if (!isNum(a)) return b;
  if (!isNum(b)) return a;
  return D(a).lessThan(D(b)) ? a : b;
}

/** Plain typed form of a server amount: "388.9000" → "388.90" (no grouping), for the "exact" key. */
export function plainAmount(v: string | null | undefined): string {
  if (!isNum(v ?? '')) return '';
  return D(v!).toDecimalPlaces(2).toFixed(2);
}

/** Quick cash notes above the amount due: the next multiple of 50, 100, 200, 500 and 1000 strictly above it (distinct). */
export function quickCash(due: string, count = 3): string[] {
  if (!isNum(due) || D(due).lessThanOrEqualTo(0)) return [];
  const d = D(due);
  const out: string[] = [];
  for (const step of [50, 100, 200, 500, 1000]) {
    const v = d.dividedBy(step).floor().plus(1).times(step);
    const s = v.toFixed(0);
    if (!out.includes(s)) out.push(s);
    if (out.length >= count) break;
  }
  return out;
}

/** quantity + n for a cart line (quantities are decimal strings). */
export function addQty(q: string, n: string | number): string {
  return D(q).plus(D(String(n))).toString();
}

/** Sum of server amounts (strings) at scale 4 — for a display total of several checks. */
export function sumAmounts(xs: (string | null | undefined)[]): string {
  return xs.reduce<ReturnType<typeof D>>((a, x) => (isNum(x ?? '') ? a.plus(D(x!)) : a), D(0)).toFixed(4);
}

/** Compare two quantities (decimal strings): -1, 0 or 1. */
export function cmpQty(a: string, b: string): number {
  return D(a || '0').comparedTo(D(b || '0'));
}

/** a − b for quantities, as a plain decimal string. */
export function subQty(a: string, b: string): string {
  return D(a || '0').minus(D(b || '0')).toString();
}

/** A typed quantity is usable: a number above zero with at most `decimals` decimal places. */
export function validQty(v: string, decimals: number): boolean {
  if (!/^\d+(\.\d+)?$/.test(v)) return false;
  return D(v).greaterThanOrEqualTo(0) && D(v).decimalPlaces() <= decimals;
}

/** Sum of quantities (decimal strings) as a plain decimal string. */
export function sumQty(xs: string[]): string {
  return xs.reduce<ReturnType<typeof D>>((a, x) => a.plus(D(x || '0')), D(0)).toString();
}

// ux-07: Home's figures come from the certified report engine as decimal strings; comparisons stay in Decimal.
/** Percent change of `now` against `before` (whole percent, a string such as "12" or "-3"), or null when before is 0/missing. */
export function pctChange(now: string | null | undefined, before: string | null | undefined): string | null {
  if (!isNum(now ?? '') || !isNum(before ?? '') || D(before!).isZero()) return null;
  return D(now!).minus(D(before!)).div(D(before!)).times(100).toDecimalPlaces(0).toFixed(0);
}
/** Sum of decimal strings (null / non-numeric ignored), full precision as a string. */
export function sumDecimals(xs: (string | null | undefined)[]): string {
  return xs.filter((x) => isNum(x ?? '')).reduce((a, x) => a.plus(D(x!)), D(0)).toString();
}

// ux-08: amounts shown in words («عجز 30.00 ج.م») keep the sign apart from the value — in Decimal.
/** Absolute value of a decimal amount string, at scale 4 ("-30.0000" → "30.0000"); '' when not a number. */
export function absAmount(v: string | null | undefined): string {
  return isNum(v ?? '') ? D(v!).abs().toFixed(4) : '';
}
/** Σ quantity × price (+ extra) for a typed preview total, in Decimal at scale 4; blanks / non-numbers count as 0. */
export function sumLines(pairs: [string | number | null | undefined, string | number | null | undefined][], extra?: string | number | null): string {
  const d = (x: string | number | null | undefined) => (isNum(x == null ? '' : String(x)) ? D(String(x)) : D(0));
  return pairs.reduce((a, [q, p]) => a.plus(d(q).times(d(p))), d(extra ?? null)).toFixed(4);
}
/** Share of `part` in `total` as a Decimal percent string (2 places), '0' when the total is 0. */
export function sharePct(part: string | null | undefined, total: string | null | undefined, places = 2): string {
  if (!isNum(part ?? '') || !isNum(total ?? '') || D(total!).isZero()) return (0).toFixed(places);
  return D(part!).div(D(total!)).times(100).toDecimalPlaces(places).toFixed(places);
}
