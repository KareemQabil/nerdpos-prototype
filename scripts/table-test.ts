// ux-16 unit test of the one table system (src/ui/table): Decimal sorting of money and quantities (negatives, equal
// values, values a float cannot tell apart), dates and business days, empty values last in both directions, Ant
// Design's sort cycle, footer totals (Decimal), the truncation decision, computed widths, alignment, the viewer's
// density with blocked storage, and parity of the older <Table> API rendered through the adapter.
// Usage: npx esbuild scripts/table-test.ts --bundle --platform=node --format=esm --outfile=/tmp/t.mjs && node /tmp/t.mjs
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser'; // the browser build: no Node streams in the ESM bundle
import { sortIndices, nextSort, totalOf, truncates, visibleLength, widthCh, alignOf, decOf, compareValues, effectiveDensity, setDensity, getDensity, legacyColumns, sortableKind } from '../src/ui/table/model';

let pass = 0, fail = 0;
const ok = (cond: unknown, name: string, extra?: unknown) => { if (cond) { pass++; } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const eq = (a: unknown, b: unknown, name: string) => ok(JSON.stringify(a) === JSON.stringify(b), name, { got: a, want: b });
const by = <T,>(rows: T[], idx: number[]) => idx.map((i) => rows[i]);

// ── money: Decimal strings, negatives, equal values (stable), beyond float precision
type R = { id: string; v: string | null };
const money: R[] = [
  { id: 'a', v: '10.0000' }, { id: 'b', v: '-5.5000' }, { id: 'c', v: '10.0000' }, { id: 'd', v: '0.1000' }, { id: 'e', v: '-30.0000' },
  { id: 'f', v: null }, { id: 'g', v: '1000000000000000.0001' }, { id: 'h', v: '1000000000000000.0000' }, { id: 'i', v: '' }, { id: 'j', v: '-0.0001' },
];
const asc = by(money, sortIndices(money, (r) => r.v, 'money', 'asc')).map((r) => r.id);
eq(asc, ['e', 'b', 'j', 'd', 'a', 'c', 'h', 'g', 'f', 'i'], 'money ascending: negatives first, equal values keep their order, empty last');
const desc = by(money, sortIndices(money, (r) => r.v, 'money', 'desc')).map((r) => r.id);
eq(desc, ['g', 'h', 'a', 'c', 'd', 'j', 'b', 'e', 'f', 'i'], 'money descending: equal values still stable, empty still last');
ok(Number('1000000000000000.0001') === Number('1000000000000000.0000'), 'the float of the two large amounts is equal (why Decimal is needed)');
ok(compareValues('money', '1000000000000000.0001', '1000000000000000.0000') === 1, 'Decimal tells the two large amounts apart');
eq(sortIndices(money, (r) => r.v, 'money', null), money.map((_, i) => i), 'no sort keeps the original order');
ok(compareValues('money', '1,234.50', '999.99') === 1, 'grouped money string compares as a number');
ok(decOf('abc') === null && decOf('') === null && decOf(null) === null && decOf(undefined) === null, 'non-numbers are empty');
ok(decOf(7)?.toString() === '7', 'integer counts are accepted');
const junk = [{ v: '5' }, { v: 'n/a' }, { v: '-1' }];
eq(sortIndices(junk, (r) => r.v, 'money', 'asc'), [2, 0, 1], 'a non-number money value sorts like an empty one (last)');

// ── quantities: decimal(19,6)
const q = [{ v: '0.000002' }, { v: '0.000001' }, { v: '-2.5' }, { v: '0.000001' }, { v: undefined }];
eq(sortIndices(q, (r) => r.v, 'qty', 'asc'), [2, 1, 3, 0, 4], 'quantity ascending at 6 decimals, equal stable, missing last');
eq(sortIndices(q, (r) => r.v, 'qty', 'desc'), [0, 1, 3, 2, 4], 'quantity descending, missing last');
eq(sortIndices([{ v: 10 }, { v: 9 }, { v: 100 }], (r) => r.v, 'number', 'asc'), [1, 0, 2], 'numbers compare numerically, not as text');

// ── dates and business days
const d = [{ v: '2026-11-04T07:16:00+02:00' }, { v: '2026-11-03T23:59:00+02:00' }, { v: null }, { v: '2026-11-04T05:16:00Z' }, { v: 'not a date' }];
eq(sortIndices(d, (r) => r.v, 'date', 'asc'), [1, 0, 3, 2, 4], 'date ascending by instant (time zones), empty / invalid last');
eq(sortIndices(d, (r) => r.v, 'date', 'desc'), [0, 3, 1, 2, 4], 'date descending (07:16+02:00 and 05:16Z are one instant: stable), empty / invalid still last');
const days = [{ v: '2026-11-03' }, { v: '2025-12-31' }, { v: '2026-01-10' }];
eq(sortIndices(days, (r) => r.v, 'day', 'asc'), [1, 2, 0], 'business days ascending across years');

// ── text: the UI language's collation, numeric aware
const tx = [{ v: 'شيك 10' }, { v: 'شيك 2' }, { v: 'أحمد' }, { v: null }];
eq(sortIndices(tx, (r) => r.v, 'text', 'asc', 'ar'), [2, 1, 0, 3], 'Arabic text ascending, «2» before «10», empty last');
eq(sortIndices([{ v: 'b' }, { v: 'B' }, { v: 'a' }], (r) => r.v, 'text', 'asc', 'en'), [2, 0, 1], 'English text, case-insensitive and stable');
eq(sortIndices([{ v: 'PAID' }, { v: 'OPEN' }], (r) => r.v, 'status', 'asc', 'en'), [1, 0], 'status sorts by its label');

// ── Ant Design's cycle
eq([nextSort(null), nextSort('asc'), nextSort('desc'), nextSort(undefined), nextSort(false)], ['asc', 'desc', null, 'asc', 'asc'], 'sort cycle none → asc → desc → none');
ok(!sortableKind('actions') && !sortableKind('custom') && sortableKind('money') && sortableKind('date'), 'actions and free cells are not sortable');

// ── footer totals (Decimal)
eq(totalOf([{ v: '0.1' }, { v: '0.2' }], (r) => r.v, 'money'), '0.3000', 'money total 0.1 + 0.2 is exactly 0.3000');
eq(totalOf(money, (r) => r.v, 'money'), '1999999999999984.6000', 'money total of large values keeps every digit (2·10^15 + 0.0001 − 0.0001 − 15.40; empty skipped)');
eq(totalOf([{ v: '-30.0000' }, { v: '30.0000' }], (r) => r.v, 'money'), '0.0000', 'a negative cancels a positive');
eq(totalOf([{ v: null }, { v: '' }], (r) => r.v, 'money'), null, 'no values → no total');
eq(totalOf([{ v: '0.000001' }, { v: '1.5' }], (r) => r.v, 'qty'), '1.500001', 'quantity total at 6 decimals');
eq(totalOf([{ v: 3 }, { v: 4 }], (r) => r.v, 'number'), '7', 'count total');

// ── truncation decision
ok(truncates('مطعم الحاج سامي للمشويات الشرقية', 20), 'a long name over the limit is cut');
ok(!truncates('قهوة', 20), 'a short name is not cut');
ok(!truncates('a very long English text without a limit', undefined), 'no limit never cuts');
ok(!truncates('', 3) && !truncates(null, 3), 'empty text is never cut');
eq(visibleLength('أكّده'), 4, 'harakat do not count as characters');
ok(!truncates('مُحَمَّد', 5), 'a name with harakat within the limit is not cut');
ok(truncates('abcdef', 5) && !truncates('abcde', 5), 'the limit itself fits, one more is cut');

// ── computed widths and alignment
ok(widthCh('money', 'الإجمالي', ['1,234.50', '12.00']) === 12, 'money width = longest amount + currency room', widthCh('money', 'الإجمالي', ['1,234.50', '12.00']));
ok(widthCh('money', 'x', ['1.00']) === 9, 'money width has a minimum');
ok(widthCh('money', 'x', ['123,456,789,012,345.00']) === 18, 'money width has a maximum');
ok(widthCh('text', 'الاسم', ['abc']) === null, 'a text column without a limit takes the remaining width');
ok(widthCh('text', 'الاسم', ['a'.repeat(80)], { maxChars: 30 }) === 30, 'a limited text column is at most its limit');
ok(widthCh('number', 'عدد الدفعات', ['3']) === 10, 'a short number column is as wide as its header', widthCh('number', 'عدد الدفعات', ['3']));
ok(widthCh('custom', 'x', []) === null && widthCh('money', 'x', [], { width: 7 }) === 7, 'custom columns are free; a fixed width wins');
eq(['money', 'qty', 'number', 'actions', 'text', 'status', 'date'].map((k) => alignOf(k as any)), ['end', 'end', 'end', 'end', 'start', 'start', 'start'], 'Ant Design alignment per kind');
eq(alignOf('money', 'center'), 'center', 'an explicit alignment wins');

// ── density (a per-viewer convenience): blocked storage never breaks the table
eq([effectiveDensity(null), effectiveDensity(null, true), effectiveDensity('comfortable', true), effectiveDensity('compact', false)], ['comfortable', 'compact', 'comfortable', 'compact'], 'the viewer\'s density wins over the table default');
(globalThis as any).localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
let threw = false; try { setDensity('compact'); } catch { threw = true; }
ok(!threw && getDensity() === 'compact', 'blocked storage: the choice is kept for the page, no exception');
setDensity(null);
const store: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } };
setDensity('comfortable');
ok(store['nerdpos.table.density.v1'] === 'comfortable', 'the choice is stored for this viewer');
setDensity(null);
ok(!('nerdpos.table.density.v1' in store), 'clearing the choice removes it');

// ── adapter parity: <Table head rows align …> through the one table
eq(legacyColumns(['a', 'b', 'c'], ['start', 'end']).map((c) => [c.id, c.align, c.sortable]), [['c0', 'start', false], ['c1', 'end', false], ['c2', 'start', false]], 'legacy columns keep order and alignment, not sortable');
const { Table, DataTable, cols } = await import('../src/ui/index');
const strip = (h: string) => h.replace(/<!-- -->/g, '');
const cellsOf = (html: string, tag: 'th' | 'td') => [...strip(html).matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'g'))].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
const classOf = (html: string, tag: 'th' | 'td') => [...html.matchAll(new RegExp(`<${tag}[^>]*class="([^"]*)"`, 'g'))].map((m) => m[1]);
const legacy = renderToStaticMarkup(React.createElement(Table, { head: ['الصنف', 'الكمية', 'المبلغ'], align: ['start', 'end', 'end'], rows: [['كفتة', '2', React.createElement('b', null, '120.00')], ['شاي', '1', '15.00']], onRowClick: () => {}, rowKey: (i: number) => `k${i}` }));
eq(cellsOf(legacy, 'th'), ['الصنف', 'الكمية', 'المبلغ'], 'adapter: same headers in order');
eq(cellsOf(legacy, 'td'), ['كفتة', '2', '120.00', 'شاي', '1', '15.00'], 'adapter: same cells in order (rendered nodes kept)');
eq(classOf(legacy, 'th').map((c) => /text-end/.test(c)), [false, true, true], 'adapter: header alignment kept');
eq(classOf(legacy, 'td').map((c) => /text-end/.test(c)), [false, true, true, false, true, true], 'adapter: cell alignment kept');
ok((legacy.match(/tabindex="0"/g) || []).length === 2, 'adapter: clickable rows are keyboard focusable');
ok(/data-row="k0"/.test(legacy) && /data-row="k1"/.test(legacy), 'adapter: row keys kept');
ok(!/aria-sort/.test(legacy) && !/data-fb="sort:/.test(legacy), 'adapter: rendered cells are not sortable');
ok(/position|sticky/.test(legacy), 'adapter: sticky head');
const legacyEmpty = renderToStaticMarkup(React.createElement(Table, { head: ['a', 'b'], rows: [], empty: 'لا توجد شيكات' }));
ok(/colSpan="2"|colspan="2"/.test(legacyEmpty) && /لا توجد شيكات/.test(legacyEmpty), 'adapter: the empty text spans every column');
const legacyLoading = renderToStaticMarkup(React.createElement(Table, { head: ['a', 'b'], rows: [], loading: true }));
ok((legacyLoading.match(/skeleton/g) || []).length === 8, 'adapter: loading shows skeleton rows');

// typed: the default sort, money cells, totals row and status badge
type Row = { id: string; name: string; total: string | null; state: string };
const C = cols<Row>();
const rows: Row[] = [{ id: 'r1', name: 'أ', total: '10.0000', state: 'PAID' }, { id: 'r2', name: 'ب', total: '-2.5000', state: 'OPEN' }, { id: 'r3', name: 'ج', total: '100.0000', state: 'PAID' }, { id: 'r4', name: 'د', total: null, state: 'OPEN' }];
const typed = renderToStaticMarkup(React.createElement(DataTable<Row>, { rows, rowKey: (r: Row) => r.id, defaultSort: { id: 'total', dir: 'desc' }, columns: [C.text('name', 'الاسم', (r) => r.name), C.status('state', 'الحالة', (r) => ({ label: r.state, tone: r.state === 'PAID' ? 'success' : 'warning' })), C.money('total', 'الإجمالي', (r) => r.total, { total: true })] }));
eq([...typed.matchAll(/data-row="(r\d)"/g)].map((m) => m[1]), ['r3', 'r1', 'r2', 'r4'], 'typed: default sort descending on money, empty last');
ok(/aria-sort="descending"/.test(typed) && /aria-sort="none"/.test(typed), 'typed: the head says which column is sorted');
ok(/data-fb="table-totals"/.test(typed) && /107\.50/.test(typed), 'typed: totals row with the Decimal sum (107.50)');
ok((typed.match(/data-money/g) || []).length === 3 + 1, 'typed: money cells and the total through <Money>');
ok(/<col style="width:calc\(\d+ch \+ 1.5rem\)"/.test(typed), 'typed: computed column widths');
const many = Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, name: `n${i}`, total: `${i}.0000`, state: 'OPEN' }));
const paged = renderToStaticMarkup(React.createElement(DataTable<Row>, { rows: many, rowKey: (r: Row) => r.id, columns: [C.text('name', 'الاسم', (r) => r.name), C.money('total', 'الإجمالي', (r) => r.total, { total: true })] }));
ok((paged.match(/data-row=/g) || []).length === 50 && /data-fb="table-pager"/.test(paged), 'typed: a long list shows 50 rows and the pager');
ok(/7,140\.00/.test(paged), 'typed: the total covers every page (0+…+119 = 7,140.00)');
const emptyTyped = renderToStaticMarkup(React.createElement(DataTable<Row>, { rows: [], columns: [C.text('name', 'الاسم', (r) => r.name)] }));
ok(/data-fb="table-empty"/.test(emptyTyped), 'typed: empty state');

console.log(`PASSES: ${pass}`);
console.log(`FAILURES: ${fail}`);
if (fail) process.exit(1);
