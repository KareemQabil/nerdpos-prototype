// ux-17: right-to-left text for the PDF writer. jsPDF draws glyphs left to right in the order it is given and its own
// bidi pass mishandles common report strings (a leading day number, «(تكملة)», «14%», «-302.10»), so lines are laid
// out here: Arabic is first shaped by jsPDF (contextual forms, lam-alef — so the letters join), then put in visual
// order by a small bidi pass that covers what reports print — Arabic words, numbers (1,234.50 · -302.10 · 14% · 23:22 ·
// 2026-11-04) and Latin words — with mirrored brackets. Numbers and Latin always stay left to right inside a
// right-to-left line. Pure (no DOM): the node test runs the same code.

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LATIN = /[A-Za-zÀ-ɏ]/;
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };
/** A number with its sign, separators and percent: -1,234.50 · 14% · 23:22 · 2026-11-04 · 1/3. */
const NUM = /^[+\-−]?\d+(?:[.,:/\-]\d+)*%?/;
/** A run of Latin words (with digits, spaces and simple punctuation between them). */
const LAT = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ0-9]*(?:[ .\-_'@&/]+[A-Za-zÀ-ɏ0-9]+)*\.?/;

export interface Run { text: string; dir: 'ltr' | 'rtl' | 'neutral'; kind?: 'num' | 'lat' }

/** Splits a logical-order string into direction runs (numbers and Latin are LTR, Arabic RTL, the rest neutral). */
export function runsOf(s: string): Run[] {
  const out: Run[] = [];
  const push = (text: string, dir: Run['dir']) => { const last = out.at(-1); if (last && last.dir === dir && dir !== 'ltr') last.text += text; else out.push({ text, dir }); };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const n = rest.match(NUM) ?? (LATIN.test(rest[0]) ? rest.match(LAT) : null);
    // a sign is part of the number only at the start or after a space / opening bracket
    if (n && (!/^[+\-−]/.test(n[0]) || i === 0 || /[\s(\[«]/.test(s[i - 1]))) { out.push({ text: n[0], dir: 'ltr' }); i += n[0].length; continue; }
    const c = s[i];
    push(c, RTL_CHAR.test(c) ? 'rtl' : 'neutral');
    i++;
  }
  return out;
}

/** Resolves neutral runs: between two runs of the same direction they take it, else the line's direction. */
function resolve(runs: Run[], base: 'rtl' | 'ltr'): Run[] {
  const strong = (k: number, step: 1 | -1): Run | null => { for (let j = k + step; j >= 0 && j < runs.length; j += step) if (runs[j].dir !== 'neutral') return runs[j]; return null; };
  // UBA in short: numbers count as right-to-left for the space between them (N1), unless Latin came first (W7)
  const dirOf = (k: number): 'rtl' | 'ltr' => {
    const a = strong(k, -1), b = strong(k, 1);
    const ad = a ? (a.dir === 'ltr' && a.kind === 'num' && base === 'rtl' && !latinBefore(k) ? 'rtl' : a.dir) : base;
    const bd = b ? (b.dir === 'ltr' && b.kind === 'num' && base === 'rtl' && !latinBefore(k) ? 'rtl' : b.dir) : base;
    return ad === bd ? (ad as 'rtl' | 'ltr') : base;
  };
  const latinBefore = (k: number) => { for (let j = k - 1; j >= 0; j--) { if (runs[j].dir === 'rtl') return false; if (runs[j].kind === 'lat') return true; } return false; };
  const res = runs.map((r, k) => (r.dir !== 'neutral' ? r : { text: r.text, dir: dirOf(k) }));
  // join neighbours of the same direction (an RTL word, its spaces and the next word are one run)
  const out: Run[] = [];
  for (const r of res) { const last = out.at(-1); if (last && last.dir === r.dir && r.dir === 'rtl') last.text += r.text; else out.push({ ...r }); }
  return out;
}

const reverseRtl = (s: string) => [...s].reverse().map((c) => MIRROR[c] ?? c).join('');

/** A logical-order line (already shaped) → the glyph order to draw left to right. */
export function visualOrder(shaped: string, base: 'rtl' | 'ltr'): string {
  if (!RTL_CHAR.test(shaped)) return shaped;
  const runs = resolve(runsOf(shaped), base);
  if (base === 'ltr') return runs.map((r) => (r.dir === 'rtl' ? reverseRtl(r.text) : r.text)).join('');
  // right-to-left line: runs right to left; consecutive LTR runs (a number, a space, a number) keep their own order
  const groups: Run[][] = [];
  for (const r of runs) { const g = groups.at(-1); if (g && r.dir === 'ltr' && g[0].dir === 'ltr') g.push(r); else groups.push([r]); }
  return groups.reverse().map((g) => (g[0].dir === 'rtl' ? reverseRtl(g[0].text) : g.map((r) => r.text).join(''))).join('');
}

export const hasRtl = (s: string) => RTL_CHAR.test(s);
