// Guard: an amount with its currency must never be rendered inside a left-to-right number span.
// `.num` is `direction: ltr; unicode-bidi: isolate`, so «29.18 ج.م» inside it reads «ج.م 29.18» in Arabic and a minus can
// land on the wrong side. Amounts go through <Money> (number in `.num`, currency in `.amount-unit` after it, in reading
// order) or, for a bare number, money(v, false).
//
// Flags, in src/**/*.tsx:
//   1. an element whose class list has `num` (or data-numeric / dir="ltr") and whose text content calls a currency
//      formatter — money(x) without `, false`; the reports' fmt(x) / fmt(x, unit) unless the unit is a literal non-money
//      unit ('count', 'unit', '%', 'minutes', 'hours'); fmtCell(…) / cellText(…); currencyText() — or has «ج.م» / EGP;
//   2. a `value={money(x)}` / `v={money(x)}` prop (StatCard, Stat, Row, tiles render a plain string value inside `.num`).
// Usage: node scripts/check-money.mjs   (exit 1 with file:line list on a violation)
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
})(path.join(ROOT, 'src'));

// a currency-bearing formatter call or literal inside the element's own text
const CURRENCY = /\b(?:money|fmt)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|\bfmtMoney\(|\bfmtCell\(|\bcellText\(|\bcurrencyText\(\)|ج\.م|\bEGP\b|جنيه/g;
const isBareMoney = (s) => (/^money\(/.test(s) && /,\s*false\s*\)$/.test(s)) || (/^fmt\(/.test(s) && /,\s*'(count|unit|%|minutes|hours)'\s*\)$/.test(s));
const NUM_ATTR = /className=(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})|data-numeric|dir="ltr"/g;

const out = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  // 1. `num` elements
  for (const m of src.matchAll(NUM_ATTR)) {
    const cls = m[1] ?? m[2] ?? m[3] ?? '';
    const ltr = m[0] === 'data-numeric' || m[0] === 'dir="ltr"' || /(^|[\s'"`])num([\s'"`]|$)/.test(cls);
    if (!ltr) continue;
    // the attribute must belong to an opening tag: walk back to '<'
    const tagStart = src.lastIndexOf('<', m.index);
    if (tagStart < 0 || /[;]/.test(src.slice(tagStart, m.index).replace(/\{[^}]*\}/g, ''))) continue;
    // end of the opening tag: first '>' at brace depth 0 after the attribute
    let i = m.index + m[0].length, depth = 0, q = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (q) { if (c === q && src[i - 1] !== '\\') q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    if (src[i - 1] === '/') continue; // self-closing
    // the element's own text: up to its first child closing tag
    const body = src.slice(i + 1, src.indexOf('</', i + 1));
    for (const c of body.match(CURRENCY) ?? []) {
      if (isBareMoney(c)) continue;
      out.push(`${path.relative(ROOT, f)}:${lineOf(i)}  ${c.slice(0, 60)} inside a left-to-right number element`);
    }
  }
  // 2. value={money(x)} / v={money(x)} on a component (StatCard, Stat, Row, tiles put a plain string value inside `.num`)
  for (const m of src.matchAll(/\b(value|v)=\{\s*(money\((?:[^()]|\([^()]*\))*\))/g)) {
    if (isBareMoney(m[2])) continue;
    out.push(`${path.relative(ROOT, f)}:${lineOf(m.index)}  ${m[1]}=${m[2].slice(0, 50)} (pass <Money v={…} /> or the unit separately)`);
  }
}
if (out.length) {
  console.error(`check-money: ${out.length} amount(s) with currency inside a left-to-right number element — use <Money>:\n` + out.join('\n'));
  process.exit(1);
}
console.log(`check-money: OK (${files.length} files, no currency inside a number element)`);
