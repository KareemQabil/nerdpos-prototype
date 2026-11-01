// Runs all 198 questions of research 05_QUESTION_BANK_AR_EN.csv (Arabic, then English) through the rule-based assistant
// on the seeded demo data and reports, by family: parsed / answered / explained / clarified / not available / refused /
// unparsed — plus the agreement with the bank's "clarification needed" flag and what a clarified question resolves to
// after picking the first option. Classifier success is reported separately from numeric correctness (the numbers
// come from the certified engine, checked by scripts/reports-engine-test.ts).
(globalThis as any).window = globalThis;
const { installMockFetch } = await import('../src/mock/fetch');
const { demo } = await import('../src/mock/demo');
const { sim } = await import('../src/mock/sim');
const { store } = await import('../src/mock/store');
const { clock } = await import('../src/mock/clock');
const { ask } = await import('../src/reports/assistant');
await import('../src/reports');
const bank = (await import('../src/reports/assistant/question-bank.json')).default as any[];
installMockFetch(); sim.set({ latencyMs: 0 }); demo.reset('DEMO'); sim.set({ latencyMs: 0 });
const db = store.db as any;
const caller: any = { userId: 'u_owner', perms: () => true, accessibleBranchIds: ['branch_main', 'branch_second'], nowMs: clock.now(), defaultBranchId: 'branch_main' };
const lang = (process.argv[2] === 'en' ? 'en' : 'ar') as 'ar' | 'en';
type Row = { id: string; family: string; q: string; status: string; shape: string; intent: string; bankClarify: boolean; clarified: boolean; second?: string; metrics: string[]; bankMetrics: string[]; text: string; rules: string[] };
const rows: Row[] = [];
for (const b of bank) {
  const q = lang === 'ar' ? b.ar : b.en;
  let a: any;
  try { a = ask(db, caller, { question: q, lang }); } catch (e: any) { a = { status: 'ERROR', shape: 'error', parsed: { intent: 'ERROR', metrics: [], rules: [String(e.message ?? e)] }, text: { ar: String(e), en: String(e) } }; }
  let second: string | undefined;
  if (a.status === 'CLARIFY' && a.clarify?.options?.length) { try { second = ask(db, caller, { question: q, lang, clarify: a.clarify.options[0].id }).status; } catch (e: any) { second = 'ERROR'; } }
  rows.push({ id: b.id, family: b.family, q, status: a.status, shape: a.shape, intent: a.parsed?.intent, bankClarify: String(b.clarify).startsWith('YES'), clarified: a.status === 'CLARIFY', second, metrics: a.parsed?.metrics ?? [], bankMetrics: b.metrics, text: (a.text?.[lang] ?? '').slice(0, 160), rules: a.parsed?.rules ?? [] });
}
const S = ['ANSWERED', 'EXPLAINED', 'CLARIFY', 'NOT_AVAILABLE', 'REFUSED', 'UNPARSED', 'ERROR'];
const fams = [...new Set(rows.map((r) => r.family))];
const pad = (s: string | number, n: number) => String(s).padEnd(n);
console.log(`\nQuestion bank evaluation (${lang}) — ${rows.length} questions, seeded demo data, owner scope\n`);
console.log(pad('family', 30) + pad('n', 4) + pad('parsed', 8) + pad('answered', 10) + pad('explained', 11) + pad('clarified', 11) + pad('n/a', 6) + pad('refused', 9) + pad('unparsed', 9) + 'clarify-agree');
for (const f of [...fams, 'TOTAL']) {
  const rs = f === 'TOTAL' ? rows : rows.filter((r) => r.family === f);
  const c = (s: string) => rs.filter((r) => r.status === s).length;
  const agree = rs.filter((r) => r.bankClarify === r.clarified).length;
  console.log(pad(f, 30) + pad(rs.length, 4) + pad(rs.length - c('UNPARSED') - c('ERROR'), 8) + pad(c('ANSWERED'), 10) + pad(c('EXPLAINED'), 11) + pad(c('CLARIFY'), 11) + pad(c('NOT_AVAILABLE'), 6) + pad(c('REFUSED'), 9) + pad(c('UNPARSED') + c('ERROR'), 9) + `${agree}/${rs.length}`);
}
const cl = rows.filter((r) => r.clarified);
console.log(`\nClarified: ${cl.length}; after picking the first option → ${S.map((s) => `${s} ${cl.filter((r) => r.second === s).length}`).filter((x) => !x.endsWith(' 0')).join(', ')}`);
const bankYes = rows.filter((r) => r.bankClarify);
console.log(`Bank says "clarify": ${bankYes.length}; we clarified ${bankYes.filter((r) => r.clarified).length}, answered NOT_AVAILABLE ${bankYes.filter((r) => r.status === 'NOT_AVAILABLE').length}, answered directly ${bankYes.filter((r) => ['ANSWERED', 'EXPLAINED'].includes(r.status)).length}`);
const metricHit = rows.filter((r) => r.metrics.length && r.bankMetrics.some((m) => r.metrics.includes(m))).length;
console.log(`Metric agreement with the bank's metric_ids (any overlap, questions with a parsed metric): ${metricHit}/${rows.filter((r) => r.metrics.length).length}`);
console.log(`Errors: ${rows.filter((r) => r.status === 'ERROR').length}`);
if (process.argv.includes('--list')) for (const r of rows) console.log(`${r.id} ${pad(r.status, 13)} ${pad(r.intent, 14)} ${r.q}  →  ${r.text}`);
const out = process.env.EVAL_OUT;
if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify(rows, null, 1));
process.exit(0);
