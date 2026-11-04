// «اسأل التقارير» — a deterministic assistant over the reports engine. No model: rules map an Egyptian-Arabic or
// English question to (intent, metrics, dimensions, filters, period), run it through the SAME engine as the reports,
// and answer with a structured result + chips (definition, filters, period, asOf, provisional, sources, not-available).
// It asks ONE clarifying question when the question is ambiguous, says NOT_AVAILABLE with the reason when the source
// does not exist, and refuses what it must not do (erase sales, act without approval, other branches, raw SQL).
import type { DB, Loc } from '../../mock/types';
import { D } from '../../mock/money';
import { businessDate as bdOf } from '../../mock/clock';
import { query, explain, metricList, dimLabel, launchDate, type Caller, ReportRefusal } from '../engine';
import { eodBridge } from '../recon';
import { compare, decompose, menuMatrix } from '../analysis';
import { metricById, METRICS } from '../registry/metrics';
import { dimensionById } from '../registry/dimensions';
import { addDays, weekOf, BUILDERS } from '../facts';
import { capabilityOn } from '../../mock/ops-registry';
const capOn = (db: DB, id: string, caller: Caller) => caller.accessibleBranchIds.some((b) => capabilityOn(db, id, b));
import { norm, has, METRIC_PHRASES, DIM_PHRASES, MONTHS } from './lexicon';
import bank from './question-bank.json';

export const QUESTION_BANK_SIZE = (bank as unknown[]).length;
export type AskStatus = 'ANSWERED' | 'EXPLAINED' | 'CLARIFY' | 'NOT_AVAILABLE' | 'REFUSED' | 'UNPARSED';
export interface Chip { kind: 'definition' | 'filters' | 'period' | 'asOf' | 'provisional' | 'source' | 'not_available' | 'assumption' | 'refusal' | 'version'; label: Loc; detail?: Loc; explain?: any }
export interface Answer {
  status: AskStatus; question: string; text: Loc; shape: string; data?: any; chips: Chip[];
  clarify?: { question: Loc; options: { id: string; label: Loc }[] };
  parsed: { intent: string; metrics: string[]; dimensions: string[]; filters: Record<string, string>; period: { from: string; to: string; label: Loc; defaulted: boolean } | null; rules: string[] };
}
const L = (ar: string, en: string): Loc => ({ ar, en });

function fmtVal(v: string | null | undefined, unit?: string): string {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  if (unit === 'count' || unit === 'unit') return (Number.isInteger(n) ? n : Number(n.toFixed(2))).toLocaleString('en-US');
  if (unit === '%') return `${n.toFixed(1)}%`;
  if (unit === 'minutes') return `${n.toFixed(1)} دقيقة`;
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`; // owner rule: «ج.م» after the number
}
// English: the Arabic currency is isolated (FSI…PDI) so a number after it in the sentence keeps its place
const fmtValEn = (v: string | null | undefined, unit?: string) => fmtVal(v, unit).replace(' ج.م', ' EGP').replace('دقيقة', 'min');

interface Period { from: string; to: string; label: Loc; defaulted: boolean }
function parsePeriod(q: string, today: string, fallback: 'TODAY' | 'LAST_7', rules: string[]): Period | { clarify: 'ramadan' } {
  const yday = addDays(today, -1);
  if (has(q, 'رمضان', 'ramadan')) return { clarify: 'ramadan' };
  if (has(q, 'اول امبارح', 'day before yesterday')) { rules.push('period:day-before'); return { from: addDays(today, -2), to: addDays(today, -2), label: L('أول أمس', 'Day before yesterday'), defaulted: false }; }
  if (has(q, 'امبارح', 'امس', 'yesterday', 'مردود امس')) { rules.push('period:yesterday'); return { from: yday, to: yday, label: L('أمس', 'Yesterday'), defaulted: false }; }
  if (has(q, 'النهارده', 'النهاردة', 'اليوم ده', 'today', 'tonight', 'الليله')) { rules.push('period:today'); return { from: today, to: today, label: L('اليوم', 'Today'), defaulted: false }; }
  if (has(q, 'ايام الاسبوع', 'weekdays')) { rules.push('period:last-28'); return { from: addDays(today, -27), to: today, label: L('آخر 4 أسابيع', 'Last 4 weeks'), defaulted: false }; }
  if (has(q, 'الاسبوع اللي فات', 'last week', 'الاسبوع الماضي', 'باللي قبله')) { const ws = weekOf(today); rules.push('period:last-week'); return { from: addDays(ws, -7), to: addDays(ws, -1), label: L('الأسبوع الماضي (من السبت)', 'Last week (from Saturday)'), defaulted: false }; }
  if (has(q, 'الاسبوع ده', 'this week', 'اول الاسبوع', 'الاسبوع')) { rules.push('period:this-week'); return { from: weekOf(today), to: today, label: L('هذا الأسبوع (من السبت)', 'This week (from Saturday)'), defaulted: false }; }
  const m = q.match(/(?:اخر|last)\s*(\d+)\s*(?:ايام|يوم|days|اسابيع|weeks|اسبوع)/);
  if (m) { const n = Number(m[1]) * (/اسابيع|weeks|اسبوع/.test(m[0]) ? 7 : 1); rules.push('period:last-n'); return { from: addDays(today, -(n - 1)), to: today, label: L(`آخر ${n} يوم`, `Last ${n} days`), defaulted: false }; }
  if (has(q, 'الشهر اللي فات', 'last month')) { const d = new Date(today + 'T12:00:00Z'); const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10); const last = addDays(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10), -1); rules.push('period:last-month'); return { from: first, to: last, label: L('الشهر الماضي', 'Last month'), defaulted: false }; }
  if (has(q, 'الشهر ده', 'this month', 'الشهر')) { rules.push('period:this-month'); return { from: today.slice(0, 8) + '01', to: today, label: L('هذا الشهر', 'This month'), defaulted: false }; }
  for (const [ps, mo] of MONTHS) if (has(q, ...ps) && !has(q, 'فرع اكتوبر', 'october branch')) {
    let y = Number(today.slice(0, 4)); if (mo > Number(today.slice(5, 7))) y--;
    const from = `${y}-${String(mo).padStart(2, '0')}-01`; const lastDay = addDays(new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10), -1);
    rules.push('period:month'); return { from, to: lastDay < today ? lastDay : today, label: L(`${ps[0].startsWith('شهر') ? ps[0] : 'شهر ' + ps[0]} ${y}`, `${ps[1]} ${y}`), defaulted: false };
  }
  rules.push(`period:default-${fallback}`);
  return fallback === 'TODAY' ? { from: today, to: today, label: L('اليوم (افتراضي)', 'Today (default)'), defaulted: true } : { from: addDays(today, -6), to: today, label: L('آخر 7 أيام (افتراضي)', 'Last 7 days (default)'), defaulted: true };
}

/** Has the business date any completed sale in the caller's branches? */
function hasSales(db: DB, caller: Caller, date: string) { return db.orders.some((o) => o.status === 'COMPLETED' && o.completedBusinessDate === date && caller.accessibleBranchIds.includes(o.branchId)); }
/** A defaulted period never silently shows an empty open day or pre-launch days: it moves, and says so (chip). */
function adjustDefault(db: DB, caller: Caller, p: Period, today: string, rules: string[], salesDomain: boolean): Period {
  if (!p.defaulted) return p;
  if (p.from === today && p.to === today && !hasSales(db, caller, today)) { const y = addDays(today, -1); if (hasSales(db, caller, y)) { rules.push('period:fallback-yesterday'); return { from: y, to: y, label: L('أمس (لا بيع اليوم بعد)', 'Yesterday (no sales today yet)'), defaulted: true }; } }
  const launch = launchDate(db);
  if (salesDomain && p.from < launch && p.to >= launch) { rules.push('period:clip-launch'); return { ...p, from: launch, label: L(`من ${launch} (أول يوم فيه بيانات تفصيلية) حتى اليوم`, `From ${launch} (first event-level day)`) }; }
  return p;
}

function entities(db: DB, q: string, caller: Caller, rules: string[]) {
  const f: Record<string, string> = {};
  const unknown: Loc[] = [];
  // branches by any distinctive word of their name
  for (const b of db.branches) { const words = norm(b.name).split(' ').filter((w) => w.length >= 4 && !['الفرع', 'الرئيسي', 'التاني'].includes(w)); if (words.some((w) => q.includes(w)) || q.includes(norm(b.code))) { f.branch = b.id; rules.push(`entity:branch:${b.id}`); } }
  if (/فرع اكتوبر|october branch/.test(q) && !db.branches.some((b) => norm(b.name).includes('اكتوبر'))) unknown.push(L('لا يوجد فرع باسم «أكتوبر» في النظام', 'There is no branch called October'));
  if (has(q, 'الصاله', 'dine-in', 'dine in', 'اوردرات الصاله')) f.channel = 'DINE_IN';
  else if (has(q, 'الدليفري', 'delivery', 'التوصيل')) f.channel = 'DELIVERY';
  else if (has(q, 'تيك اواي', 'takeaway')) f.channel = 'TAKEAWAY';
  if (has(q, 'فيزا', 'card tenders', 'pending card', 'كارت')) f.payment_method = 'CARD';
  else if (has(q, 'انستاباي', 'instapay', 'محفظه')) f.payment_method = 'WALLET';
  else if (has(q, 'كاش من درج', 'cash refunds', 'صرف كاش', 'اتصرف كاش')) f.payment_method = 'CASH';
  // products and categories by name (≥ 3 letters, both directions of containment)
  const words = q.split(' ').filter((w) => w.length >= 3).map((w) => w.replace(/^(وال|بال|لل|ال|و|ب)(?=..)/, ''));
  for (const p of db.products) {
    const n = norm(p.name.ar).replace(/^ال/, ''), e = norm(p.name.en);
    const first = n.split(' ')[0];
    if ((n.length >= 3 && words.some((w) => w === n || (w.length >= 4 && n.startsWith(w)) || (first.length >= 4 && w === first))) || (e.length >= 4 && q.includes(e))) { f.product = p.id; rules.push(`entity:product:${p.id}`); break; }
  }
  if (!f.product && has(q, 'البيتزا', 'pizza')) { const p = db.products.find((x) => norm(x.name.en).includes('pizza')); if (p) f.product = p.id; }
  if (!f.product && has(q, 'المشروبات', 'beverages')) { const c = db.categories.find((x) => /مشروب|drink|beverage/i.test(x.name.ar + x.name.en)); if (c) f.category = c.id; }
  const inv = (db as any).inv;
  if (inv) for (const it of inv.items) { const n = norm(it.name.ar).replace(/^ال/, ''); const first = n.split(' ')[0]; if (n.length >= 3 && words.some((w) => w === n || (first.length >= 3 && w === first))) { f.inventory_item = it.id; rules.push(`entity:item:${it.id}`); break; } }
  if (has(q, 'كومبو', 'combo')) { const ids = db.products.filter((p) => p.combo?.length || /وجبه|كومبو|combo|meal/.test(norm(p.name.ar) + ' ' + norm(p.name.en))).map((p) => p.id); if (ids.length) { f.product = ids.join(','); rules.push('entity:combos'); } }
  const tm = q.match(/(?:الترابيزه|table)\s*(\d+)/);
  if (tm) { const t = db.tables.find((x) => x.name === tm[1] && caller.accessibleBranchIds.includes(x.branchId)); if (t) f.table = t.id; }
  const hm = q.match(/(?:الساعه|at)\s*(\d{1,2})(?:\s*(?:بالليل|pm|مساء))?/);
  if (hm) { let h = Number(hm[1]); if ((/بالليل|pm|مساء|الليل/.test(q)) && h < 12) h += 12; if (h >= 0 && h < 24) f.hour = String(h).padStart(2, '0'); }
  if (/بعد العشره بالليل|after 10|late-night/.test(q)) { f.hour = '22,23,00,01,02,03'; rules.push('entity:late-night'); }
  return { f, unknown };
}

function detectMetrics(q: string, rules: string[]) {
  const hits: { id: string; score: number; generic: boolean }[] = [];
  METRIC_PHRASES.forEach(([ps, id], i) => { for (const p of ps) if (q.includes(norm(p))) { hits.push({ id, score: norm(p).length * 10 - i * 0.01, generic: i >= METRIC_PHRASES.length - 3 }); break; } });
  hits.sort((a, b) => b.score - a.score);
  const ids: string[] = [];
  for (const h of hits) if (!ids.includes(h.id)) ids.push(h.id);
  if (ids.length) rules.push(`metric:${ids.slice(0, 3).join(',')}`);
  return { ids, genericOnly: hits.length > 0 && hits.every((h) => h.generic) };
}
function detectDims(q: string): string[] { const out: string[] = []; for (const [ps, d] of DIM_PHRASES) if (ps.some((p) => q.includes(norm(p))) && !out.includes(d)) out.push(d); return out; }

function chipsFor(r: { meta: any }, metrics: string[], filters: Record<string, string>, period: Period | null, db: DB): Chip[] {
  const out: Chip[] = [];
  for (const id of metrics) { const m = metricById.get(id); if (m) out.push({ kind: 'definition', label: L(`${m.label.ar} (نسخة ${m.version})`, `${m.label.en} (v${m.version})`), detail: m.definition }); }
  if (period) out.push({ kind: 'period', label: L(`${period.label.ar}: ${period.from}${period.to !== period.from ? ' → ' + period.to : ''}`, `${period.label.en}: ${period.from}${period.to !== period.from ? ' → ' + period.to : ''}`), detail: L('اليوم التجاري من 4 الفجر لـ 4 الفجر بتوقيت القاهرة.', 'Business day 04:00–04:00 Africa/Cairo.') });
  const fs = Object.entries(filters);
  if (fs.length) out.push({ kind: 'filters', label: L(fs.map(([k, v]) => dimLabel(db, k, v).ar).join(' · '), fs.map(([k, v]) => dimLabel(db, k, v).en).join(' · ')) });
  out.push({ kind: 'filters', label: L(`الفرع: ${r.meta.branchIds.map((b: string) => dimLabel(db, 'branch', b).ar).join('، ')}`, `Branch: ${r.meta.branchIds.map((b: string) => dimLabel(db, 'branch', b).en).join(', ')}`) });
  out.push({ kind: 'asOf', label: L(`لحد ${r.meta.asOf.slice(0, 16).replace('T', ' ')} UTC`, `As of ${r.meta.asOf.slice(0, 16).replace('T', ' ')} UTC`) });
  out.push(r.meta.provisional ? { kind: 'provisional', label: L('مبدئي', 'Provisional'), detail: L(r.meta.provisionalReasons.map((x: Loc) => x.ar).join(' '), r.meta.provisionalReasons.map((x: Loc) => x.en).join(' ')) } : { kind: 'provisional', label: L('نهائي (الأيام مقفولة)', 'Final (days closed)') });
  for (const n of r.meta.notAvailable ?? []) out.push({ kind: 'not_available', label: L(`${metricById.get(n.metric)?.label.ar}: غير متاح`, `${metricById.get(n.metric)?.label.en}: not available`), detail: n.reason });
  for (const n of r.meta.refused ?? []) out.push({ kind: 'refusal', label: L(`${metricById.get(n.metric)?.label.ar}: مرفوض`, `${metricById.get(n.metric)?.label.en}: refused`), detail: n.reason });
  return out;
}

const base = (question: string, rules: string[]): Omit<Answer, 'status' | 'text' | 'shape'> => ({ question, chips: [], parsed: { intent: 'NONE', metrics: [], dimensions: [], filters: {}, period: null, rules } });
const refuse = (question: string, rules: string[], ar: string, en: string, intent = 'SAFE_REFUSAL'): Answer => ({ ...base(question, rules), status: 'REFUSED', shape: 'refusal', text: L(ar, en), parsed: { ...base(question, rules).parsed, intent }, chips: [{ kind: 'refusal', label: L('رفض آمن', 'Safe refusal'), detail: L(ar, en) }] });
const na = (question: string, rules: string[], metrics: string[], extra?: Loc, period?: Period | null): Answer => {
  const reasons = metrics.map((id) => metricById.get(id)).filter(Boolean).map((m) => ({ metric: m!.id, label: m!.label, reason: m!.reason ?? extra ?? L('لا يوجد مصدر', 'No source') }));
  return { ...base(question, rules), status: 'NOT_AVAILABLE', shape: 'not_available', text: L(`غير متاح — ${reasons.map((r) => `${r.label.ar}: ${(extra ?? r.reason).ar}`).join(' ')} مش هنقول صفر ولا هنخمّن.`, `Not available — ${reasons.map((r) => `${r.label.en}: ${(extra ?? r.reason).en}`).join(' ')} We will not say zero or guess.`), data: { reasons }, parsed: { intent: 'NOT_AVAILABLE', metrics, dimensions: [], filters: {}, period: period ?? null, rules }, chips: reasons.map((r) => ({ kind: 'not_available' as const, label: L(`${r.label.ar}: غير متاح`, `${r.label.en}: not available`), detail: extra ?? r.reason })) };
};
const clarifyA = (question: string, rules: string[], ar: string, en: string, options: { id: string; label: Loc }[], parsed: Partial<Answer['parsed']> = {}): Answer => ({ ...base(question, rules), status: 'CLARIFY', shape: 'clarify', text: L(ar, en), clarify: { question: L(ar, en), options }, parsed: { ...base(question, rules).parsed, intent: 'CLARIFY', ...parsed } });

export function ask(db: DB, caller: Caller, input: { question: string; clarify?: string; lang?: 'ar' | 'en'; context?: any }): Answer {
  const question = input.question.trim();
  const q = norm(question);
  const rules: string[] = [];
  const cl = Object.fromEntries((input.clarify ?? '').split(';').filter(Boolean).map((x) => x.split('=') as [string, string]));
  const today = bdOf(caller.nowMs);

  // ───── 1. safety refusals (never negotiable)
  if (has(q, 'نمسح', 'امسح', 'مسح مبيعات', 'نخفي', 'حذف مبيعات', 'نحذف', 'احذف', 'اخفاء المبيعات', 'erase', 'delete real sales', 'hide sales')) { rules.push('refuse:erase'); return refuse(question, rules, 'لا. لا تُحذف المبيعات الفعلية ولا تُخفى قبل الضرائب أبدًا — فذلك مخالف للقانون (E20). أي تصحيح يتم بمرتجع أو إيصال تصحيح مرتبط بالأصل.', 'No. Genuine sales are never erased or hidden before tax reporting (E20). Corrections are linked return/correction documents.'); }
  if (has(q, 'من غير موافقه', 'without approval', 'نفذه', 'execute it') && !has(q, 'متنفذوش', 'do not execute')) { rules.push('refuse:action'); return refuse(question, rules, 'لا. المساعد للقراءة فقط — لا تُنفَّذ منه أي حركة (أمر شراء، سعر، مرتجع). وأي مسودة تمر بالموافقات المعتادة.', 'No. The assistant is read-only; any draft goes through normal approvals.'); }
  if (has(q, ' sql', 'select ', 'raw query')) { rules.push('refuse:sql'); return refuse(question, rules, 'لا. يستخدم المساعد المقاييس المعتمدة فقط، لا استعلامات حرة على قاعدة البيانات.', 'No raw SQL: only certified metrics.'); }
  if (has(q, 'فرع مش بتاعي', 'branch i am not authorized', 'not authorized for')) { rules.push('refuse:scope'); return refuse(question, rules, `لا. تصدر التقارير للفروع المسموح لك بها فقط (${caller.accessibleBranchIds.map((b) => dimLabel(db, 'branch', b).ar).join('، ')}) — والخادم هو الذي يرفض، لا الشاشة.`, 'No. Only branches you are granted; enforced by the server.', 'SAFE_REFUSAL'); }
  if (has(q, 'واتساب', 'whatsapp') && has(q, 'ينفع', 'can we message', 'ابعت')) { rules.push('na:consent'); return na(question, rules, ['new_customers'], L('الرسائل للعملاء تحتاج إلى موافقتهم وقرار خصوصية (قانون 151/2020) — ولن يقرر المساعد ذلك.', 'Messaging customers needs their consent and a privacy decision (Law 151/2020).')); }

  // ───── 2. engine / meta explanations
  const explainA = (ar: string, en: string, data?: any, intent = 'EXPLAIN'): Answer => ({ ...base(question, rules), status: 'EXPLAINED', shape: 'explanation', text: L(ar, en), data, parsed: { ...base(question, rules).parsed, intent } });
  if (has(q, 'نهائي', 'مبدئي', 'final', 'provisional', 'لسه ما قفلناش') && !has(q, 'شيك مبدئي', 'preliminary bill')) {
    rules.push('meta:provisional');
    const r = query(db, caller, { metrics: ['net_item_sales'], from: today });
    const d = r.meta.days[0];
    return { ...explainA(`التقرير ${r.meta.provisional ? 'مبدئي' : 'نهائي'}: ${r.meta.provisional ? r.meta.provisionalReasons.map((x) => x.ar).join(' ') : 'اليوم مقفول.'} اليوم التجاري ${d.date} بيخلص 4 الفجر بتوقيت القاهرة، والرقم بيبقى نهائي بعد «إقفال اليوم» بس — وبعدها أي مرتجع بيتسجل في يوم صرفه.`, `The report is ${r.meta.provisional ? 'provisional' : 'final'}.`, { days: r.meta.days }), chips: chipsFor(r, ['net_item_sales'], {}, { from: today, to: today, label: L('اليوم', 'Today'), defaulted: false }, db) };
  }
  if (has(q, 'مش متاحه', 'unavailable', 'not available')) {
    rules.push('meta:not-available');
    const list = METRICS.filter((m) => m.status === 'NOT_AVAILABLE' && !m.hidden).map((m) => ({ id: m.id, label: m.label, reason: m.reason }));
    return explainA(`${list.length} مقياس غير متاح مع سبب كل منها — ولا تظهر صفرًا أبدًا: ${list.map((x) => x.label.ar).join('، ')}.`, `${list.length} metrics are not available, each with its reason.`, { list }, 'META');
  }
  if (has(q, 'مصدر', 'source of')) {
    rules.push('meta:source');
    const m = metricById.get('net_item_sales')!;
    return { ...explainA(`${m.label.ar}: ${m.definition.ar} المعادلة: ${m.formula}. المصدر: سطور الشيكات المغلقة (يوم الإغلاق) + المرتجعات المصروفة (يوم الصرف). اضغط أي رقم في التقارير لعرض الشيكات والسطور خلفه.`, `${m.label.en}: ${m.definition.en} Formula: ${m.formula}.`, { metric: m }), chips: [{ kind: 'definition', label: L(`${m.label.ar} (نسخة ${m.version})`, `${m.label.en} v${m.version}`), detail: m.definition }, { kind: 'version', label: L(m.history.map((h) => `${h.version}: ${h.change}`).join(' — '), m.history.map((h) => `${h.version}`).join(', ')) }] };
  }
  if (has(q, 'x و z', 'x and z')) { rules.push('meta:xz'); return explainA('تقرير X = لقطة للدرج والوردية مفتوحة (لا يغلق شيئًا). تقرير Z = إغلاق الوردية: يُثبَّت المتوقع والمعدود والفرق ويصبح مرجعًا. ويتحقق المحرك من أن Z = مجموع حركات الدرج.', 'X = a snapshot while open; Z = the frozen close, the reference.'); }
  if (has(q, 'sandbox', 'ولا انتاج', 'or production')) { rules.push('meta:eta-mode'); const modes = [...new Set(db.fiscalDocuments.map((f) => f.mode))]; return explainA(`الإيصالات اللي اتعملت في البيئة: ${modes.length ? modes.map((m) => (m === 'SANDBOX' ? 'تجريبي (SANDBOX)' : 'حقيقي')).join(' و') : 'لا توجد إيصالات بعد'}. القبول التجريبي ليس قبولًا فعليًا من منظومة الضرائب.`, `E-receipt environment: ${modes.join(', ') || 'none yet'}. Sandbox is not production acceptance.`, { modes }); }
  if (has(q, 'مين يقدر يشوف', 'who can view')) { rules.push('meta:pii'); return explainA('بيانات العملاء الشخصية بتحتاج صلاحية «عرض بيانات العملاء»؛ والتقارير ما بتعرضش أسماء أو تليفونات، وتحليل العملاء مقفول لحد قرار الموافقة والخصوصية.', 'Customer PII needs a dedicated permission; reports show no PII; customer analytics are disabled until consent is decided.'); }
  if (has(q, 'id ثابت', 'stable id')) { rules.push('meta:id'); return explainA('أيوه: كل شيك ليه رقم عملية ثابت ما بيتغيرش وبيتطبع دايمًا، والرقم القصير للنداء اختياري وبيتصفر. الأوردر على الترابيزة = القعدة، حتى لو اتقسمت لكذا شيك.', 'Yes: an immutable transaction id; the short call-out number is optional.'); }
  if (has(q, 'محطه تانيه', 'another station')) { rules.push('meta:kds'); return explainA('كل شاشة مطبخ مشتركة في محطاتها بس؛ شاشة التسليم بس هي اللي بتشوف «جاهز للتسليم». ده إعداد للمكان مش رقم في التقارير.', 'Each kitchen screen subscribes to its stations; only dispatch screens see ready-for-pickup.'); }
  if (has(q, 'الطابعه', 'printer')) { rules.push('meta:printer'); const st = db.printJobs.reduce((a: Record<string, number>, j) => ((a[j.state] = (a[j.state] ?? 0) + 1), a), {}); return explainA(`أوامر الطباعة: ${Object.entries(st).map(([k, v]) => `${k === 'SUCCEEDED' ? 'اتطبع' : k === 'PENDING' ? 'مستني' : k === 'FAILED' ? 'فشل' : 'وقف'} ${v}`).join('، ') || 'مفيش'}. ده من طابور الطباعة، مش مقياس معتمد.`, `Print jobs: ${JSON.stringify(st)}.`, { states: st }); }
  if (has(q, 'مناسب للفرع', 'applicable to this establishment')) { rules.push('na:legal'); return na(question, rules, ['tax_amount'], L('نسبة الضريبة المناسبة لنوع المطعم قرار قانوني للمحاسب/المستشار الضريبي — المساعد بيعرض النسبة المتسجلة بس.', 'The applicable VAT rate is a legal decision for the accountant.')); }
  if (has(q, 'ضافتها ضريبه', 'tax base')) { rules.push('meta:service-tax'); const taxable = db.orders.filter((o) => o.service && o.service.origin === 'POLICY').map((o) => o.service!.taxable); return explainA(`الخدمة ${taxable.length ? (taxable.every(Boolean) ? 'داخلة في وعاء الضريبة' : 'مش دايمًا داخلة في وعاء الضريبة') : 'مش متطبقة على شيكات لسه'} حسب الإعداد المتسجل على كل شيك وقت التأكيد. الطبيعة القانونية للخدمة لسه سؤال للمحاسب (docs/25).`, 'Service taxability follows the policy captured on each check.'); }
  if (has(q, 'واتساب', 'whatsapp')) { rules.push('meta:channel'); return explainA('قنوات البيع سجلات بيعملها المدير (صالة، تيك أواي، دليفري، …). لو «واتساب» مش متسجلة كقناة، طلباتها بتدخل على القناة اللي اتسجلت عليها (غالبًا دليفري) — مش رقم لوحده.', 'Sales channels are records; WhatsApp is not a channel unless created.'); }
  if (has(q, 'طلبنا 100', 'ordered 100', 'ordered 100 but received 60')) { rules.push('meta:po-grn'); return explainA('أمر الشراء بيفضل بقيمته اللي اتطلبت (100)، وكل إذن استلام بيتسجل بالكمية اللي وصلت فعلًا (60) — والفرق (40) بيبان «لسه ما اتسلمش» لحد ما الأمر يتقفل. الاستلام الجزئي عمره ما بيكرر قيمة الأمر.', 'The PO keeps 100; each receipt records 60; 40 remains open; partial receipts never double the PO.'); }

  // ───── 3. deictic questions ("this refund", "this ticket"…) → one clarifying pick
  const pick = (kind: string, ar: string, en: string, opts: { id: string; label: Loc }[], answerFor: (id: string) => Answer) => {
    if (cl.pick) return answerFor(cl.pick);
    rules.push(`clarify:pick-${kind}`);
    return opts.length ? clarifyA(question, rules, ar, en, opts.slice(0, 6).map((o) => ({ ...o, id: `pick=${o.id}` }))) : na(question, rules, [], L('لا توجد سجلات من هذا النوع بعد.', 'No records of this kind yet.'));
  };
  if (has(q, 'المرتجع ده', 'this refund')) return pick('refund', 'أنهي مرتجع؟', 'Which refund?', db.refunds.filter((r) => r.state === 'PAID').slice(-6).reverse().map((r) => ({ id: r.id, label: L(`مرتجع ${D(r.amount).toFixed(2)} على #${db.orders.find((o) => o.id === r.orderId)?.number} (${r.businessDate})`, `Refund ${r.amount} (${r.businessDate})`) })), (id) => {
    const r = db.refunds.find((x) => x.id === id);
    if (!r) return na(question, rules, [], L('المرتجع غير موجود', 'Refund not found'));
    const g = db.grants.find((x) => x.id === r.approvalGrantId);
    const who = (uid?: string | null) => dimLabel(db, 'staff', uid ?? null).ar;
    return explainA(`المرتجع ${D(r.amount).toFixed(2)} ج.م على الشيك #${db.orders.find((o) => o.id === r.orderId)?.number}: طلبه ${who(r.requestedBy)}، ووافق عليه ${who(g?.approverUserId ?? r.approverId ?? r.decidedBy)}، واتصرف يوم ${r.businessDate}${r.reasonCode ? ' — السبب: ' + r.reasonCode : ''}.`, `Refund approved by ${who(g?.approverUserId ?? r.decidedBy)}.`, { refund: r, evidence: [{ kind: 'REFUND', id: r.id, orderId: r.orderId, label: `مرتجع #${db.orders.find((o) => o.id === r.orderId)?.number}`, amount: r.amount }] }, 'EVIDENCE');
  });
  if (has(q, 'الايصال', 'receipt uuid') && has(q, 'uuid')) return pick('receipt', 'أنهي إيصال؟', 'Which receipt?', db.fiscalDocuments.slice(-6).reverse().map((f) => ({ id: f.id, label: L(`إيصال #${f.orderNumber} (${f.state})`, `Receipt #${f.orderNumber}`) })), (id) => { const f = db.fiscalDocuments.find((x) => x.id === id); return explainA(f ? `إيصال #${f.orderNumber}: ${f.uuid ?? 'لسه ما اتبناش (مفيش UUID)'} — ${f.mode === 'SANDBOX' ? 'تجريبي' : 'حقيقي'}، الحالة ${f.state}.` : 'مش موجود', f ? `Receipt UUID ${f.uuid ?? '—'}` : 'Not found', { fiscal: f }, 'EVIDENCE'); });
  if (has(q, 'التذكره دي', 'this ticket')) return pick('ticket', 'أنهي تذكرة؟', 'Which ticket?', db.tickets.slice(-6).reverse().map((t) => ({ id: t.id, label: L(`#${t.orderNumber} جولة ${t.round}`, `#${t.orderNumber} round ${t.round}`) })), (id) => { const t = db.tickets.find((x) => x.id === id); if (!t) return na(question, rules, []); const m = (a?: string | null) => (a ? ((Date.parse(a) - t.createdAtMs) / 60000).toFixed(1) : null); return explainA(`التذكرة #${t.orderNumber}: وصلت ${t.createdAt.slice(11, 16)} UTC، ${t.startedAt ? `اتبدأت بعد ${m(t.startedAt)} دقيقة` : '«ابدأ» ما اتضغطش (اختياري) — الوقت بيتحسب من الوصول'}، ${t.readyAt ? `جاهزة بعد ${m(t.readyAt)} دقيقة` : 'لسه مش جاهزة'}.`, `Ticket timeline`, { ticket: t }, 'EVIDENCE'); });
  if (has(q, 'زياره الترابيزه', 'table visit timeline', 'قسموا الشيك', 'bill split for the three')) {
    const visits = db.visits.filter((v) => caller.accessibleBranchIds.includes(v.branchId) && db.orders.filter((o) => o.visitId === v.id).length > (has(q, 'قسموا', 'split') ? 1 : 0)).slice(-6).reverse();
    return pick('visit', 'أنهي قعدة؟', 'Which visit?', visits.map((v) => ({ id: v.id, label: L(`ترابيزة ${db.tables.find((t) => t.id === v.tableId)?.name} — ${v.guestCount} ضيوف (${v.openedAt.slice(0, 10)})`, `Table ${db.tables.find((t) => t.id === v.tableId)?.name}`) })), (id) => {
      const v = db.visits.find((x) => x.id === id); const os = db.orders.filter((o) => o.visitId === id);
      if (!v) return na(question, rules, []);
      return { ...explainA(`قعدة ترابيزة ${db.tables.find((t) => t.id === v.tableId)?.name}: ${v.guestCount} ضيوف، ${os.length} شيك: ${os.map((o) => `#${o.number} = ${D(o.confirmation?.payable ?? '0').toFixed(2)}`).join(' + ')}. أوردر واحد والضيوف بيتعدوا مرة واحدة.`, `${os.length} checks, one order.`, { visit: v, checks: os.map((o) => ({ id: o.id, number: o.number, payable: o.confirmation?.payable ?? null, lines: o.lines.filter((l) => l.status === 'ACTIVE').map((l) => ({ name: l.name, total: l.lineTotal, share: l.shareOf })) })) }, 'EVIDENCE'), shape: 'visit' };
    });
  }
  if (has(q, 'امر شراء المورد ده', 'this supplier purchase order')) { const inv = (db as any).inv; return pick('po', 'أنهي أمر شراء؟', 'Which purchase order?', (inv?.purchaseOrders ?? []).slice(-6).reverse().map((p: any) => ({ id: p.id, label: L(`${p.number} — ${inv.suppliers.find((s: any) => s.id === p.supplierId)?.name ?? ''}`, p.number) })), (id) => { const p = inv?.purchaseOrders.find((x: any) => x.id === id); return explainA(p ? `أمر الشراء ${p.number}: ${p.lines.length} سطر، الحالة ${p.state}.` : 'مش موجود', p ? `PO ${p.number}` : 'Not found', { po: p }, 'EVIDENCE'); }); }
  if (has(q, 'المنطقه دي', 'this zone', 'select zone')) { const zones = (db as any).deliveryZones ?? []; return pick('zone', 'أنهي منطقة؟', 'Which zone?', zones.slice(0, 6).map((z: any) => ({ id: z.id, label: z.name?.ar ? z.name : L(z.name, z.name) })), (id) => runQuery(db, caller, question, rules, ['delivery_avg_minutes'], [], { zone: id }, parsePeriod(q, today, 'LAST_7', rules) as Period)); }
  if (has(q, 'العميل ده', 'this customer')) { rules.push('na:customer'); return na(question, rules, ['new_customers'], L('مبيعات عميل معين محتاجة تحديد هويته وموافقته — تحليل العملاء مقفول (OD06).', 'Per-customer spend needs identity and consent (OD06).')); }
  if (has(q, 'الرقم ده', 'behind this number')) {
    if (input.context?.metric) return explainAnswer(db, caller, question, rules, input.context);
    rules.push('clarify:which-number');
    return clarifyA(question, rules, 'أي رقم؟ (من داخل أي تقرير اضغط الرقم نفسه)', 'Which number? (inside a report, click the number itself)', [{ id: 'pick=net_item_sales', label: L('صافي المبيعات اليوم', 'Net sales today') }, { id: 'pick=tender_collected', label: L('المتحصل اليوم', 'Collected today') }, { id: 'pick=discount_amount', label: L('الخصومات اليوم', 'Discounts today') }]);
  }
  if (cl.pick && metricById.has(cl.pick)) return explainAnswer(db, caller, question, rules, { metric: cl.pick, from: today });
  if (has(q, 'الكاش المتوقع مختلف', 'expected cash differ')) {
    const ss = db.sessions.filter((s) => caller.accessibleBranchIds.includes(s.branchId) && s.state === 'CLOSED').slice(-6).reverse();
    return pick('session', 'أنهي وردية؟', 'Which drawer session?', ss.map((s) => ({ id: s.id, label: dimLabel(db, 'drawer', s.id) })), (id) => { const s = db.sessions.find((x) => x.id === id)!; const br = eodBridge(db, caller, { from: s.businessDate, branchIds: [s.branchId] }); const d = br.drawers.find((x) => x.sessionId === id); return { ...explainA(d ? `الوردية: المتوقع ${fmtVal(d.expected)} والمعدود ${fmtVal(d.counted ?? null)} والفرق ${fmtVal(d.variance ?? null)}. ${d.reason ? 'سبب الكاشير: ' + d.reason : ''}` : 'مش موجودة', 'Drawer bridge', { drawer: d }, 'BRIDGE'), shape: 'drawer' }; });
  }

  // ───── 3b. reconciliation, bridge and data-semantics questions (answered from the certified checks)
  const lastWeekP = (): Period => ({ from: launchDate(db) > addDays(today, -6) ? launchDate(db) : addDays(today, -6), to: today, label: L('من أول يوم فيه بيانات تفصيلية حتى اليوم', 'Since the first event-level day'), defaulted: true });
  const checkAnswer = (ids: string[] | null, intro: Loc): Answer => {
    rules.push(`exec:recon:${ids?.join('+') ?? 'all'}`);
    const p = parsePeriod(q, today, 'LAST_7', []) as Period; const per = p.defaulted ? lastWeekP() : p;
    const br = eodBridge(db, caller, { from: per.from, to: per.to });
    const cs = br.checks.filter((c) => !ids || ids.some((i) => c.id.startsWith(i)));
    const bad = cs.filter((c) => c.status === 'UNEXPLAINED');
    return { ...explainA(`${intro.ar} ${cs.length} قاعدة اتشغلت (${per.from}${per.to !== per.from ? '→' + per.to : ''}): ${bad.length ? `${bad.length} فيها فرق مش متشرح — ${bad.map((c) => c.title.ar).join('، ')}` : 'كلها متطابقة أو الفرق متشرح بحركات'}.`, `${intro.en} ${cs.length} rule(s): ${bad.length} unexplained.`, { checks: cs, bridge: { gap: br.gap } }, 'RECON'), shape: 'recon', chips: [{ kind: 'period' as const, label: L(`${per.from} → ${per.to}`, `${per.from} → ${per.to}`) }, { kind: 'asOf' as const, label: L(`لحد ${br.scope.asOf.slice(0, 16)}`, `As of ${br.scope.asOf.slice(0, 16)}`) }, { kind: 'definition' as const, label: L('قواعد المطابقة المعتمدة (doc 27 §5 + 06)', 'Certified reconciliation rules'), detail: L('كل فرق إما صفر، أو مفسَّر بحركات مرتبطة، أو يُعلَّم «غير مفسَّر».', 'Every difference is zero, explained by linked events, or flagged.') }] };
  };
  if (has(q, 'اعلي من الاصلي', 'exceed the original', 'سبب واصل فاتوره', 'reason and original check')) return checkAnswer(['refunds_have_origin'], L('لكل مرتجع شيك أصلي وسبب، ولا يتجاوز المدفوع.', 'Every refund needs an original check, a reason, and ≤ paid.'));
  if (has(q, 'اتسجلت مرتين', 'recorded twice', 'اتحسبت مرتين', 'double count')) return checkAnswer(['no_duplicate_payments'], L('لا يُسجَّل رقم العملية (Command) نفسه مرتين أبدًا — حتى بعد العمل دون اتصال.', 'The same command is never recorded twice, even after offline replay.'));
  if (has(q, 'فرق قرش', 'piaster discrepancy', 'سبليت ومجموعه مختلف', 'split checks fail')) return checkAnswer(['split_allocation'], L('أنصبة التقسيم بتتوزع بأكبر باقي والباقي على آخر نصيب.', 'Split shares by largest remainder, residual on the last share.'));
  if (has(q, 'متوازن', 'postings balance', 'متطابقه مع الدفعات', 'reconcile to successful')) return checkAnswer(['billed_identity', 'tenders_by_method', 'billed_vs_collected', 'sales_bridge'], L('الأرقام بتتطابق بمعادلات ثابتة.', 'The numbers reconcile by fixed equations.'));
  if (has(q, 'الاختبارات اللي اتفشلت', 'failed reporting')) return checkAnswer(null, L('كل قواعد المطابقة على الفترة:', 'All reconciliation rules for the period:'));
  if (has(q, 'تقريرين', 'two reports disagree')) { rules.push('clarify:which-reports'); return clarifyA(question, rules, 'أي تقريرين؟ (أغلب الاختلافات من فلتر مختلف أو asOf مختلف أو مقياس مختلف مثل الصافي مقابل الفواتير)', 'Which two reports? (usually a different filter, asOf or metric)', [{ id: 'pick=net_item_sales', label: L('مبيعات اليوم مقابل المتحصل', 'Daily sales vs collected') }, { id: 'pick=recognized_sales_total', label: L('الفواتير مقابل Z', 'Billed vs Z') }]); }
  if (has(q, 'تقرير نهايه اليوم', 'eod pack', 'end of day') || has(q, 'z مختلف', 'differ from dashboard', 'dashboard')) {
    rules.push('exec:eod-pack');
    const p = parsePeriod(q, today, 'TODAY', []) as Period; const per = p.defaulted ? adjustDefault(db, caller, p, today, rules, true) : p;
    const br = eodBridge(db, caller, { from: per.from, to: per.to });
    const item = br.sales.find((x) => x.id === 'item_net')!;
    const dash = has(q, 'dashboard', 'z مختلف');
    return { ...base(question, rules), status: 'ANSWERED', shape: 'bridge', data: br, text: L(`${dash ? 'Z بيتقرا بالوردية (كل الكاش اللي دخل الدرج في الوردية حتى لو عدّت 4 الفجر)، والداشبورد بيتقرا باليوم التجاري (صافي من غير ضريبة وخدمة). ' : ''}يوم ${per.from}: صافي الأصناف ${fmtVal(item.amount)} → الفواتير ${fmtVal(br.gap.billed)} → المتحصل ${fmtVal(br.gap.collected)} (الفرق ${fmtVal(br.gap.difference)}، غير مفسَّر ${fmtVal(br.gap.unexplained)}). ${br.drawers.length} درج، والمطابقة: ${br.status === 'MATCHED' ? 'متطابق' : br.status === 'EXPLAINED' ? 'الفرق متشرح' : 'فيه فرق مش متشرح'}.`, `Day ${per.from}: item net ${item.amount} → billed ${br.gap.billed} → collected ${br.gap.collected}.`), chips: [{ kind: 'definition', label: L('جسر نهاية اليوم للمحاسب', 'Accountant EOD bridge') }, { kind: 'period', label: L(`${per.label.ar}: ${per.from}`, `${per.label.en}: ${per.from}`) }, { kind: 'asOf', label: L(`لحد ${br.scope.asOf.slice(0, 16)}`, `As of ${br.scope.asOf.slice(0, 16)}`) }], parsed: { intent: 'BRIDGE', metrics: ['recognized_sales_total', 'tender_collected', 'cash_variance'], dimensions: [], filters: {}, period: per, rules } };
  }
  if (has(q, 'اوردر واحد', 'one order have three checks', 'one order')) { rules.push('meta:order-vs-check'); return explainA('القعدة على الترابيزة = أوردر واحد. لما الضيوف يقسموا الحساب بيطلع كذا شيك (لحد عدد الضيوف)، كل شيك بيتدفع لوحده — بس عدد الأوردرات والضيوف ما بيتكررش، والأنصبة مجموعها بالقرش = الأصل.', 'A table visit is one order; splitting creates checks (up to the guest count); orders and guests never multiply.'); }
  if (has(q, 'عربون', 'deposit')) { rules.push('meta:deposits'); const ds = db.deposits.filter((d) => caller.accessibleBranchIds.includes(d.branchId)); const byState = ds.reduce((a: Record<string, number>, d) => ((a[d.state] = (a[d.state] ?? 0) + 1), a), {}); return explainA(`العربون فلوس الزبون عندنا (التزام) مش مبيعات: بيتسجل في الدرج كـ«عربون» ويتخصم من الشيك لما يتطبق. عندنا ${ds.length} عربون: ${Object.entries(byState).map(([k, n]) => `${k === 'HELD' ? 'محجوز' : k === 'APPLIED' ? 'اتطبق' : k === 'REFUNDED' ? 'اترد' : 'اتصادر'} ${n}`).join('، ') || '—'}.${has(q, 'اترد', 'refunded') ? ' العربون اللي اترد بيظهر يوم ما اترد.' : ''}`, `Deposits are liabilities, not sales: ${ds.length} on record.`, { deposits: ds.length, byState }); }
  if (has(q, 'مرتجعات من اسبوع قديم', 'returns from old weeks')) {
    rules.push('exec:returns-old-weeks');
    const ws = weekOf(today);
    const r = query(db, caller, { metrics: ['tender_refunded', 'return_sales_adjustment', 'refund_count'], dimensions: ['stage'], from: ws, to: today });
    const e = explain(db, caller, { metric: 'tender_refunded', from: ws, to: today });
    const old = e.parts[0].evidence.filter((x) => (db.refunds.find((rf) => rf.id === x.id)?.originalBusinessDate ?? '') < ws);
    return { ...explainA(`أيوه، المرتجع بيتحسب يوم صرفه: الأسبوع ده (من ${ws}) فيه ${e.parts[0].evidence.length} مرتجع بـ ${fmtVal(r.totals.tender_refunded.value)}، منهم ${old.length} على شيكات من أسابيع قديمة (${old.map((x) => x.label).join('، ') || '—'}). صافي مبيعات الأسبوع بيتقل بيهم والأسابيع القديمة ما بتتغيرش.`, `Yes: ${old.length} refund(s) this week relate to older weeks; old weeks are never restated.`, { query: r, evidence: e }), chips: chipsFor(r, ['return_sales_adjustment'], {}, { from: ws, to: today, label: L('هذا الأسبوع', 'This week'), defaulted: false }, db) };
  }
  if (has(q, 'بعد ما اليوم اتقفل', 'after business-day close', 'بعد قفل اليوم')) { rules.push('exec:after-close'); const per = lastWeekP(); return runQuery(db, caller, question, rules, ['refund_count', 'tender_refunded'], ['approval_actor'], { stage: 'S3' }, per, undefined, 'QUERY'); }
  if (has(q, 'شيك مبدئي', 'preliminary bill')) { rules.push('exec:after-prebill'); return explainAnswer(db, caller, question, rules, { metric: 'void_line_count', filters: { stage: 'S1' }, ...lastWeekP() }, lastWeekP()); }
  if (has(q, 'as of', 'asof', 'اخر داتا', 'last sync', 'المزامنه', 'sync lag')) {
    rules.push('meta:freshness');
    const last = Math.max(0, ...db.orders.filter((o) => caller.accessibleBranchIds.includes(o.branchId)).map((o) => o.completedAtMs ?? o.createdAtMs), ...db.captures.filter((c) => caller.accessibleBranchIds.includes(c.branchId)).map((c) => c.atMs));
    const sync = (db.syncTerminals ?? []).map((t) => `${dimLabel(db, 'device', t.terminalId).ar}: ${t.lastReplayAt ?? t.lastChangesAt ?? 'ما اتزامنش'}`).join('، ');
    return explainA(`التقرير محسوب لحد ${new Date(caller.nowMs).toISOString().slice(0, 16).replace('T', ' ')} UTC (asOf). آخر حركة بيع اتسجلت ${last ? new Date(last).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—'} — يعني من ${last ? Math.round((caller.nowMs - last) / 60000) : '—'} دقيقة.${sync ? ' آخر مزامنة للأجهزة: ' + sync + '.' : ' مفيش أجهزة شغالة أوفلاين.'}`, `Computed as of now; last sale event ${last ? Math.round((caller.nowMs - last) / 60000) + ' min ago' : '—'}.`, { lastEventAt: last ? new Date(last).toISOString() : null }, 'META');
  }
  if (has(q, 'شيفتات ملهاش قفل', 'shifts without closeout', 'ورديه مفتوحه')) { rules.push('meta:open-sessions'); const open = db.sessions.filter((x) => caller.accessibleBranchIds.includes(x.branchId) && x.state === 'OPEN'); return explainA(open.length ? `${open.length} وردية مفتوحة: ${open.map((x) => `${dimLabel(db, 'drawer', x.id).ar} من ${Math.round((caller.nowMs - x.openedAtMs) / 3_600_000)} ساعة`).join('، ')}. الوردية المفتوحة بتخلي التقرير «مبدئي».` : 'مفيش ولا وردية مفتوحة دلوقتي — كل الأدراج اتقفلت وليها تقرير Z.', `${open.length} open session(s).`, { open: open.map((x) => x.id) }, 'META'); }
  if (has(q, 'حجز', 'reservation') && has(q, 'اتلغي', 'canceled', 'cancelled')) { rules.push('meta:reservations-cancelled'); const rs = db.reservations.filter((r) => caller.accessibleBranchIds.includes(r.branchId)); return explainA(`الحجوزات: ${rs.length} — اتلغى منها ${rs.filter((r) => r.state === 'CANCELLED').length}، وعدم حضور ${rs.filter((r) => r.state === 'NO_SHOW').length}. (من سجل الحجوزات)`, `Reservations ${rs.length}, cancelled ${rs.filter((r) => r.state === 'CANCELLED').length}.`, { reservations: rs.length }); }
  if (has(q, 'هتقول صفر', 'will you return zero', 'مقفول وبيطلع صفر', 'incorrectly showing zero')) { rules.push('meta:na-not-zero'); const inv = capOn(db, 'INVENTORY', caller), res = capOn(db, 'RESERVATIONS', caller); return explainA(`لأ. لو الموديول مقفول أو مصدره مش موجود، الرقم بيطلع «مش متاح» ومعاه السبب — عمره ما بيطلع صفر. دلوقتي: المخزن ${inv ? 'شغال' : 'مقفول (أرقامه «مش متاح»)'}، والحجوزات ${res ? 'شغالة' : 'مقفولة'}. جرب تقفل الموديول من «تشغيل الموديولات» وشوف التقرير.`, 'No: an off module or missing source is NOT AVAILABLE with a reason, never 0.', { inventory: inv, reservations: res }, 'META'); }
  if (has(q, 'فرق ضريبه المبيعات', 'vat differs')) { rules.push('meta:vat-vs-eta'); const per = lastWeekP(); const r = query(db, caller, { metrics: ['tax_amount', 'recognized_sales_total', 'eta_receipt_count', 'check_count'], from: per.from, to: per.to }); const accepted = db.fiscalDocuments.filter((f) => f.state === 'ACCEPTED' && caller.accessibleBranchIds.includes(f.branchId)); const covered = new Set(accepted.map((f) => f.orderId)); const missing = db.orders.filter((o) => o.kind === 'SALE' && o.status === 'COMPLETED' && !o.comp && o.completedBusinessDate! >= per.from && o.completedBusinessDate! <= per.to && caller.accessibleBranchIds.includes(o.branchId) && !covered.has(o.id)); return { ...explainA(`ضريبة الشيكات ${fmtVal(r.totals.tax_amount.value)} على ${fmtVal(r.totals.check_count.value, 'count')} شيك؛ ${missing.length} شيك من غير إيصال مقبول (${missing.slice(0, 5).map((o) => '#' + o.number).join('، ')}${missing.length > 5 ? ' …' : ''}). الإيصالات «تجريبي» مش قبول حقيقي.`, `VAT ${r.totals.tax_amount.value} on ${r.totals.check_count.value} checks; ${missing.length} without an accepted receipt.`, { query: r, missing: missing.map((o) => o.id) }, 'RECON'), chips: chipsFor(r, ['tax_amount', 'eta_receipt_count'], {}, per, db) }; }
  if (has(q, 'اتاخر عن النافذه', 'outside the allowed window')) { rules.push('meta:eta-late'); const late = db.fiscalDocuments.filter((f) => caller.accessibleBranchIds.includes(f.branchId) && ((f.submittedAt ? Date.parse(f.submittedAt) : caller.nowMs) - f.createdAtMs) > 24 * 3_600_000 && f.state !== 'ACCEPTED'); return explainA(`${late.length} إيصال عدّى 24 ساعة من غير قبول${late.length ? ': ' + late.map((f) => '#' + f.orderNumber).join('، ') : ''}. المهلة 24 ساعة من الإصدار (docs/19 R5) والتنبيه بيطلع عند 12 و20 ساعة.`, `${late.length} receipt(s) beyond 24 h.`, { late: late.map((f) => f.id) }, 'META'); }
  if (has(q, 'ما اتسلمتش', 'unreceived')) { rules.push('meta:open-pos'); const inv = (db as any).inv; const pos = (inv?.purchaseOrders ?? []).filter((p: any) => ['ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state) && caller.accessibleBranchIds.includes(p.branchId)); const rows = pos.map((p: any) => { const ordered = p.lines.reduce((a: any, l: any) => a.plus(D(l.orderedQuantity).times(l.orderedUnitCost)), D(0)); const recv = (inv.receipts ?? []).filter((r: any) => r.purchaseOrderId === p.id && r.state === 'POSTED').reduce((a: any, r: any) => a.plus(r.total), D(0)); return { id: p.id, number: p.number, supplier: inv.suppliers.find((x: any) => x.id === p.supplierId)?.name ?? '', ordered: ordered.toFixed(2), received: recv.toFixed(2), open: ordered.minus(recv).toFixed(2), state: p.state }; }); return { ...explainA(rows.length ? `${rows.length} أمر شراء لسه ما اتسلمش بالكامل: ${rows.map((r: any) => `${r.number} (${r.supplier}) اتطلب ${fmtVal(r.ordered)} واتستلم ${fmtVal(r.received)}`).join('، ')}.` : 'مفيش أوامر شراء مفتوحة — كل الأوامر اتستلمت أو اتقفلت.', `${rows.length} open purchase order(s).`, { items: rows }, 'QUERY'), shape: 'table' }; }
  if (has(q, 'غير المحصله', 'unpaid receivables')) { rules.push('meta:receivables'); const r = query(db, caller, { metrics: ['outstanding_checks', 'outstanding_amount'], from: today }); return { ...explainA(`الشيكات اللي اتأكدت ومااتدفعتش بتظهر في «شيكات مفتوحة» (دلوقتي: ${fmtVal(r.totals.outstanding_checks.value, 'count')} شيك بـ ${fmtVal(r.totals.outstanding_amount.value)}) — مش جوه المبيعات لحد ما تتقفل، وفي جسر نهاية اليوم الدفعات عليها بتظهر «دفعات لشيكات لسه مفتوحة».`, 'Unpaid checks appear under open checks, outside sales until completed.', { query: r }, 'EXPLAIN'), chips: chipsFor(r, ['outstanding_checks'], {}, null, db) }; }
  if (has(q, 'مدفوعات معلقه', 'pending card')) { rules.push('meta:pending-payments'); const auths = ((db as any).authorizations ?? []).filter((a: any) => ['AUTHORIZED', 'PENDING'].includes(a.state)); return explainA(`الدفعة بتتسجل في السيستم بس لما تتقبل (مفيش «تحصيل معلق»). موافقات كارت/محفظة لسه ما اتحصلتش: ${auths.length}. أي محاولة دفع اتكررت بنفس رقم العملية بتتسجل مرة واحدة.`, `Payments are recorded only when accepted; ${auths.length} pending authorization(s).`, { pending: auths.length }, 'EXPLAIN'); }
  if (has(q, 'العرض ده', 'this promotion')) { rules.push('exec:promo-approvals'); return runQuery(db, caller, question, rules, ['approval_count'], ['approval_actor'], { void_reason: 'ORDER_DISCOUNT' }, lastWeekP(), undefined, 'QUERY'); }
  if (has(q, 'اقترح', 'suggest') && has(q, 'متنفذوش', 'do not execute')) { rules.push('exec:draft-only'); const ent0 = entities(db, q, caller, rules); const per = lastWeekP(); const a = runQuery(db, caller, question, rules, ['item_net_sales', 'sold_quantity', 'menu_contribution'], [], ent0.f.product ? { product: ent0.f.product } : {}, per, undefined, 'DRAFT_ONLY'); return { ...a, text: L(`${a.text.ar} مش هنفذ أي عرض: المساعد بيقرا بس، والعرض بيتعمل من «العروض» وبيعدي على الموافقات (L5 مقفول في البروتوتايب).`, `${a.text.en} No offer is created: the assistant is read-only.`), chips: [...a.chips, { kind: 'refusal', label: L('مسودة فقط — بلا تنفيذ', 'Draft only — nothing executed') }] }; }
  if (has(q, 'لما غيرنا سعر', 'price changed')) { rules.push('exec:price-change-trend'); const ent0 = entities(db, q, caller, rules); if (!ent0.f.product) return na(question, rules, ['sold_quantity'], L('لم أجد الصنف في السؤال.', 'Item not found.')); const per = lastWeekP(); const tr = query(db, caller, { metrics: ['sold_quantity', 'item_net_sales'], dimensions: ['business_date'], filters: { product: ent0.f.product }, from: per.from, to: per.to }); const changes = db.priceRules.filter((r) => r.productId === ent0.f.product && r.branchId === 'branch_main' && r.replacesRuleId).length; return { ...base(question, rules), status: 'ANSWERED', shape: 'chart', data: tr, text: L(`${dimLabel(db, 'product', ent0.f.product).ar} يوم بيوم: ${tr.rows.map((x) => `${x.dims.business_date}: ${fmtVal(x.values.sold_quantity.value, 'unit')} قطعة / ${fmtVal(x.values.item_net_sales.value)}`).join('، ') || '—'}. تغييرات السعر المتسجلة: ${changes}. ده وصف قبل/بعد مش إثبات سبب.`, `${dimLabel(db, 'product', ent0.f.product).en} by day; ${changes} price change(s) recorded.`), chips: chipsFor(tr, ['sold_quantity', 'item_net_sales'], { product: ent0.f.product }, per, db), parsed: { intent: 'TREND', metrics: ['sold_quantity', 'item_net_sales'], dimensions: ['business_date'], filters: { product: ent0.f.product }, period: per, rules } }; }
  if (has(q, 'جاي النهارده', 'reserved for')) { rules.push('exec:reservations-today'); const ent0 = entities(db, q, caller, rules); const rs = db.reservations.filter((r) => caller.accessibleBranchIds.includes(r.branchId) && bdOf(Date.parse(r.at)) === today && (!ent0.f.hour || String(new Date(Date.parse(r.at) + 2 * 3_600_000).getUTCHours()).padStart(2, '0') === ent0.f.hour)); return explainA(rs.length ? `${rs.length} حجز: ${rs.map((r) => `${r.customer} (${r.partySize} أفراد، ${r.state === 'BOOKED' ? 'محجوز' : r.state})`).join('، ')}.` : 'مفيش حجوزات في الميعاد ده النهارده.', `${rs.length} reservation(s).`, { reservations: rs.map((r) => r.id) }, 'EVIDENCE'); }

  // causal questions about promotions → descriptive only
  if (has(q, 'زود المبيعات', 'increase sales', 'حقيقيه ولا', 'genuine or', 'cannibal', 'بيرجع فلوسه', 'pay off')) { rules.push('na:causal'); return na(question, rules, ['sales_forecast'], L('أثر العرض الحقيقي محتاج مجموعة مقارنة (control) — عندنا وصف بس (قبل/بعد)، مش إثبات سبب.', 'True promotion lift needs a control group — descriptive only.')); }
  if (has(q, 'اعاده تجهيز', 'refire')) { rules.push('na:refire'); return na(question, rules, ['waste_value'], L('إعادة التجهيز لسه مش مقياس معتمد (بتظهر في شاشة المطبخ) — مش هنعدها من الهالك.', 'Refires are not a certified metric yet.')); }
  if (has(q, 'لسه علي الشيف', 'pending in kitchen')) { rules.push('na:live-board'); return na(question, rules, ['kds_late_count'], L('اللي لسه على الشيف دلوقتي بيتشاف لايف في شاشة المطبخ؛ التقارير بتحسب التذاكر اللي خلصت أو اتأخرت.', 'Live pending items are on the kitchen screen.')); }
  if (has(q, 'مع بعض', 'together')) { rules.push('na:affinity'); return na(question, rules, ['sold_quantity'], L('تحليل الأصناف اللي بتتطلب مع بعض (affinity) لسه مش مقياس معتمد.', 'Item affinity is not a certified metric yet.')); }
  if (has(q, 'بيتاخروا', 'deliver late') && has(q, 'مورد', 'supplier')) { rules.push('na:supplier-lateness'); return na(question, rules, ['goods_received_value'], L('ميعاد التسليم المتوقع مش متسجل على أوامر الشراء بشكل يسمح بحساب التأخير.', 'Expected delivery dates are not recorded consistently.')); }
  if (has(q, 'الفواتير اللي مش مطابقه', 'invoices do not match')) { rules.push('na:3way'); return na(question, rules, ['goods_received_value'], L('مطابقة فاتورة المورد مع الاستلام (3-way) لسه مش مقياس معتمد — الفاتورة بتتسجل كرقم على إذن الاستلام بس.', 'Supplier invoice matching is not certified yet.')); }
  if (has(q, 'النقاط', 'points') && has(q, 'متسجله صح', 'reconciled')) { rules.push('na:points'); return na(question, rules, ['repeat_rate'], L('مطابقة النقاط مش ضمن المحرك لسه.', 'Points reconciliation is not in the engine yet.')); }

  if (has(q, 'منطقه بتطلب', 'which zone buys')) { rules.push('na:zone-item'); return na(question, rules, ['sold_quantity'], L('الأصناف حسب منطقة التوصيل لسه مش تقاطع معتمد (منطقة التوصيل مش متسجلة على سطور البيع).', 'Items by delivery zone is not a certified combination yet.')); }
  if (has(q, 'التنظيف', 'cleaning')) { rules.push('na:cleaning'); return na(question, rules, ['table_turns'], L('وقت تنظيف الترابيزة بيتشاف في خريطة الصالة؛ لسه مش مقياس معتمد في التقارير.', 'Table cleaning time is not a certified metric yet.')); }
  if (has(q, 'وقت انتظار', 'reserved guests wait')) { rules.push('na:wait'); return na(question, rules, ['avg_dining_minutes'], L('ميعاد وصول الضيف مقابل ميعاد قعدته مش متسجل — مش هنحسب انتظار.', 'Arrival vs seating time is not recorded.')); }
  if (has(q, 'ايصال مرتجع', 'return receipt', 'اتلغت ومفيش اصل', 'without originals')) { rules.push('na:return-receipt'); return na(question, rules, ['eta_receipt_count'], L('إيصالات المرتجع الإلكترونية لسه مستنية قرار «نية المرتجع» (docs/19 §7) — مفيش إيصالات مرتجع اتبعتت.', 'Return e-receipts wait for the refund intent gate (docs/19 §7).')); }
  if (has(q, 'يكفينا كام يوم', 'how many days will')) { rules.push('na:days-of-stock'); return na(question, rules, ['sales_forecast'], L('عدد الأيام محتاج توقع استهلاك — مفيش توقع معتمد. بنعرض الرصيد والحد الأدنى بس.', 'Days of stock need a demand forecast.')); }
  if (has(q, 'رمضان', 'ramadan') && !cl.year) { rules.push('clarify:ramadan'); return clarifyA(question, rules, 'أنهي رمضان؟ (السيستم شغال من ' + launchDate(db) + ' وعنده إجماليات يومية من 28 يوم قبله بس)', 'Which Ramadan?', [{ id: 'year=2026', label: L('رمضان 2026', 'Ramadan 2026') }, { id: 'year=2027', label: L('رمضان 2027 (لسه ما جاش)', 'Ramadan 2027') }]); }
  if (cl.year) { rules.push('na:ramadan-out-of-range'); return na(question, rules, ['net_item_sales'], L(`رمضان ${cl.year} برة البيانات المتاحة (من ${addDays(launchDate(db), -28)}) — مش هنخمّن.`, `Ramadan ${cl.year} is outside the available data.`)); }
  // ───── 4. metric intent
  const { ids: metricIds, genericOnly } = detectMetrics(q, rules);
  if (!metricIds.length) { rules.push('unparsed'); return { ...base(question, rules), status: 'UNPARSED', shape: 'unparsed', text: L('لم أفهم هذا السؤال بعد. جرّب: «صافي المبيعات أمس»، «أعلى 5 أصناف في المبيعات هذا الأسبوع»، «عند من عجز الدرج؟»، «كم النقدي والبطاقات؟».', 'I did not understand. Try: "net sales yesterday", "top 5 items this week".') }; }
  const primary = metricIds[0];
  const m = metricById.get(primary)!;
  // not-available sources first (labor, customers, forecast, aggregator…) — never 0, never a guess
  const naIds = metricIds.filter((id) => metricById.get(id)?.status === 'NOT_AVAILABLE');
  if (naIds.length && (metricById.get(primary)!.status === 'NOT_AVAILABLE')) { rules.push('na:source'); return na(question, rules, naIds); }
  // ambiguity → one clarifying question
  const ent = entities(db, q, caller, rules);
  if (ent.unknown.length) { rules.push('clarify:unknown-entity'); return clarifyA(question, rules, `${ent.unknown.map((x) => x.ar).join('، ')}. أي فرع تقصد؟`, `${ent.unknown.map((x) => x.en).join(', ')}. Which branch do you mean?`, caller.accessibleBranchIds.map((b) => ({ id: `branch=${b}`, label: dimLabel(db, 'branch', b) }))); }
  if (cl.branch) ent.f.branch = cl.branch;
  const isCompare = has(q, 'مقارنه', 'قارن', 'compared', 'compare', 'versus', ' vs', 'نفس يوم', 'same weekday', 'باللي قبله', 'اعلي من');
  const isWhy = has(q, 'ليه', 'why');
  const change = has(q, 'زاد', 'زادت', 'زود', 'وقعت', 'قلت', 'نزلت', 'increase', 'increased', 'drop', 'dropped', 'decreas');
  const hasBaseline = has(q, 'مقارنه', 'قارن', 'compared', 'عن امبارح', 'نفس يوم', 'same weekday', 'الاسبوع اللي فات', 'last week', 'الشهر اللي فات', 'last month', 'اللي قبله', 'than') || !!cl.baseline;
  let metric = cl.metric ?? null;
  if (!metric && genericOnly && primary === 'net_item_sales' && has(q, 'بكام', 'how much', 'بعت', 'total revenue') && !isCompare && !isWhy) { rules.push('clarify:net-vs-gross'); return clarifyA(question, rules, 'هل تقصد صافي المبيعات (بلا ضريبة وخدمة) أم إجمالي الفواتير (ما دفعه العملاء بالضريبة والخدمة)؟', 'Net sales (ex-tax, ex-service) or billed total (with tax and service)?', [{ id: 'metric=net_item_sales', label: L('صافي المبيعات', 'Net sales') }, { id: 'metric=recognized_sales_total', label: L('إجمالي الفواتير', 'Billed total') }, { id: 'metric=gross_item_sales', label: L('قبل الخصم', 'Gross before discount') }], { metrics: ['net_item_sales'] }); }
  if (!metric && has(q, 'انشط', 'busiest') && !has(q, 'ايام', 'weekdays')) { rules.push('clarify:busiest'); return clarifyA(question, rules, 'الأنشط بعدد الطلبات أم بالمبيعات؟', 'Busiest by orders or by revenue?', [{ id: 'metric=order_count', label: L('بعدد الأوردرات', 'By orders') }, { id: 'metric=item_net_sales', label: L('بالمبيعات', 'By revenue') }]); }
  if (!metric && has(q, 'اكتر صنف', 'sold the most') ) { rules.push('clarify:qty-vs-revenue'); return clarifyA(question, rules, 'الصنف الأعلى بالكمية أم بالقيمة؟', 'By quantity or revenue?', [{ id: 'metric=sold_quantity', label: L('بالكمية', 'By quantity') }, { id: 'metric=item_net_sales', label: L('بالقيمة', 'By revenue') }]); }
  if (!metric && has(q, 'سلو', 'slow')) { rules.push('clarify:threshold'); return clarifyA(question, rules, 'ما المقصود بـ«بطيء الحركة» لديك؟', 'What counts as slow-moving?', [{ id: 'metric=sold_quantity;rank=bottom5', label: L('أقل 5 أصناف بالكمية', 'Bottom 5 by quantity') }, { id: 'metric=sold_quantity;rank=bottom10', label: L('أقل 10', 'Bottom 10') }]); }
  if (!metric && has(q, 'ارباحنا', 'profit did we make')) { rules.push('clarify:profit'); return clarifyA(question, rules, 'هل تقصد مجمل الربح (المبيعات ناقص تكلفة الطعام) أم صافي الربح (بعد العمالة والمصروفات)؟', 'Gross profit (sales − food cost) or net P&L?', [{ id: 'metric=menu_contribution', label: L('مجمل الربح من المنيو', 'Gross profit') }, { id: 'metric=labor_cost', label: L('صافي الربح', 'Net P&L') }]); }
  if (!metric && has(q, 'فود كوست', 'food-cost', 'food cost') && has(q, 'نسبه', 'percentage')) { rules.push('clarify:food-cost'); return clarifyA(question, rules, 'النسبة النظرية (من الوصفات) أم الفعلية (من الجرد)؟', 'Theoretical (recipes) or actual (counts)?', [{ id: 'metric=menu_contribution_pct;mode=theoretical', label: L('النظرية', 'Theoretical') }, { id: 'metric=stock_variance_value;mode=actual', label: L('الفعلية', 'Actual') }]); }
  if (!metric && has(q, 'اشتريت', 'what did i buy', 'did i buy')) { rules.push('clarify:purchase'); return clarifyA(question, rules, 'هل تقصد المطلوب (أوامر الشراء)، أم المستلم، أم المدفوع للمورد؟', 'Ordered, received or paid?', [{ id: 'metric=po_ordered_value', label: L('اتطلب', 'Ordered') }, { id: 'metric=goods_received_value', label: L('اتستلم', 'Received') }, { id: 'metric=supplier_paid', label: L('اتدفع', 'Paid') }]); }
  if (metric === 'supplier_paid') { rules.push('na:payables'); return na(question, rules, ['goods_received_value'], L('مدفوعات الموردين (الحسابات الدائنة) غير موجودة في النظام — لدينا الطلب والاستلام فقط.', 'Supplier payments are not recorded.')); }
  if (!metric && has(q, 'الاوردر الكبير', 'large orders') && !cl.size) { rules.push('clarify:large'); return clarifyA(question, rules, 'كم صنفًا يعني الطلب «الكبير»؟', 'What is a large order?', [{ id: 'size=4', label: L('4 أصناف أو أكثر', '4+ items') }, { id: 'size=6', label: L('6 أو أكثر', '6+ items') }]); }
  if (cl.size) { rules.push('na:order-size'); return na(question, rules, ['kds_avg_ticket_minutes'], L('حجم الطلب ليس بُعدًا معتمدًا للمطبخ بعد — نعرض المتوسط العام والمحطات.', 'Order size is not a certified kitchen dimension yet.')); }
  if ((change || isWhy) && !hasBaseline && ['net_item_sales', 'item_net_sales', 'discount_amount', 'order_count', 'stock_waste_qty', 'waste_value', 'labor_hours', 'kds_late_count'].includes(primary) && !has(q, 'سعر', 'price', 'اغلي')) { rules.push('clarify:baseline'); return clarifyA(question, rules, 'مقارنة بماذا؟', 'Compared with what?', [{ id: 'baseline=PREVIOUS', label: L('الفترة السابقة (بالطول نفسه)', 'The previous period') }, { id: 'baseline=SAME_WEEKDAY_LAST_WEEK', label: L('اليوم نفسه من الأسبوع الماضي', 'Same weekday last week') }], { metrics: [primary] }); }
  metric = metric ?? primary;
  if (metric === 'net_item_sales' && detectDims(q).some((d) => ['hour', 'daypart', 'product', 'category', 'staff'].includes(d))) { rules.push('metric:item-net-for-dims'); metric = 'item_net_sales'; }
  if (metricById.get(metric)?.status === 'NOT_AVAILABLE') { rules.push('na:after-clarify'); return na(question, rules, [metric]); }
  const extraMetrics = metricIds.slice(1, 3).filter((id) => metricById.get(id)?.status === 'AVAILABLE' && metricById.get(id)?.family === metricById.get(metric!)?.family && id !== metric);
  if (has(q, 'وخدمه', 'and service')) extraMetrics.push('service_charge');
  if (has(q, 'اتعد', 'counted')) extraMetrics.push('cash_counted');
  if (metric === 'menu_contribution') extraMetrics.push('item_net_sales', 'food_theoretical_cost');
  const metrics = [...new Set([metric, ...extraMetrics])];

  // dimensions and period
  let dims = detectDims(q).filter((d) => metricById.get(metric!)?.dimensions.includes(d));
  if (dims.includes('payment_method') && !metricById.get(metric)!.dimensions.includes('payment_method')) dims = dims.filter((d) => d !== 'payment_method');
  if (metric === 'stock_on_hand' || metric === 'stock_waste_qty' || metric === 'stock_variance_qty') dims = ent.f.inventory_item ? [] : ['inventory_item'];
  if (metric === 'supplier_price_change') dims = ent.f.inventory_item ? (has(q, 'كل مورد', 'by supplier', 'مورد') ? ['supplier'] : []) : dims.length ? dims : ['inventory_item'];
  if (dims.includes('branch')) delete ent.f.branch;
  for (const d of dims) if (d !== 'branch') delete (ent.f as any)[d];
  const tableish = dims.length > 0 || has(q, 'اكتر', 'اعلي', 'اقل', 'مين', 'كل ', 'most', 'top', 'which', 'list', 'هات', 'وريني');
  const pp = parsePeriod(q, today, tableish || isCompare ? 'LAST_7' : 'TODAY', rules);
  if ('clarify' in pp) return clarifyA(question, rules, 'أي رمضان؟', 'Which Ramadan?', [{ id: 'year=2026', label: L('2026', '2026') }]);
  let period = adjustDefault(db, caller, pp, today, rules, metricById.get(metric)?.fact !== 'stock' && !['po', 'grn', 'waste', 'count', 'reservation', 'delivery', 'open_check'].includes(metricById.get(metric)?.fact ?? ''));
  const branchIds = ent.f.branch ? [ent.f.branch] : dims.includes('branch') ? caller.accessibleBranchIds : undefined;
  const filters: Record<string, string> = { ...ent.f }; delete filters.branch;
  for (const k of Object.keys(filters)) if (!metricById.get(metric)!.dimensions.includes(k)) { rules.push(`filter-dropped:${k}`); delete filters[k]; }

  // ───── 5. execution kinds
  try {
    if (metric === 'stock_on_hand' && has(q, 'ناقص', 'low', 'اعاده الطلب', 'reorder', 'نطلبها', 'نفاد', 'stock-out')) {
      rules.push('exec:low-stock');
      const facts = (BUILDERS.stock as any)(db, { branchIds: caller.accessibleBranchIds, from: today, to: today, asOfMs: caller.nowMs }) as any[];
      const per = new Map<string, { item: string; qty: any; min: any; par: any }>();
      for (const f of facts) { const k = f.dims.inventory_item; const x = per.get(k) ?? { item: k, qty: D(0), min: D(0), par: D(0) }; x.qty = x.qty.plus(f.n.qty); if (f.n.min) x.min = x.min.plus(f.n.min); if (f.n.par) x.par = x.par.plus(f.n.par); per.set(k, x); }
      let list = [...per.values()].filter((x) => x.min.gt(0) && x.qty.lt(x.min)).map((x) => ({ item: x.item, label: dimLabel(db, 'inventory_item', x.item), onHand: x.qty.toString(), min: x.min.toString(), par: x.par.toString(), suggested: (x.par.minus(x.qty).gt(0) ? x.par.minus(x.qty) : D(0)).toString() }));
      if (filters.inventory_item) list = [...per.values()].filter((x) => x.item === filters.inventory_item).map((x) => ({ item: x.item, label: dimLabel(db, 'inventory_item', x.item), onHand: x.qty.toString(), min: x.min.toString(), par: x.par.toString(), suggested: (x.par.minus(x.qty).gt(0) ? x.par.minus(x.qty) : D(0)).toString() }));
      const draft = has(q, 'نطلبها', 'reorder', 'اعاده الطلب');
      return { ...base(question, rules), status: 'ANSWERED', shape: 'table', data: { items: list }, text: L(`${filters.inventory_item ? '' : `${list.length} خامة تحت الحد الأدنى: `}${list.map((x) => `${x.label.ar} ${Number(x.onHand)} (الحد ${Number(x.min)}، المقترح ${Number(x.suggested)})`).join('، ') || 'مفيش خامة تحت الحد الأدنى'}. الرصيد لقطة لحد دلوقتي، والمقترح = المستوى المستهدف − الرصيد (قابل للتعديل).${draft ? ' مش هنعمل أمر شراء: المسودة بتتعمل من «طلبات الشراء» وبتعدي على الموافقة.' : ''}`, `${list.length} item(s) below minimum; suggested = par − on hand.`), chips: [{ kind: 'definition', label: L('الرصيد (لقطة asOf) — نسخة 1.0', 'Stock on hand (asOf) v1.0'), detail: metricById.get('stock_on_hand')!.definition }, { kind: 'asOf', label: L(`لحد ${new Date(caller.nowMs).toISOString().slice(0, 16)}`, `As of ${new Date(caller.nowMs).toISOString().slice(0, 16)}`) }, ...(draft ? [{ kind: 'refusal' as const, label: L('مسودة فقط — بلا أمر شراء', 'Draft only — no PO') }] : [])], parsed: { intent: draft ? 'DRAFT_ONLY' : 'QUERY', metrics: ['stock_on_hand'], dimensions: ['inventory_item'], filters, period: null, rules } };
    }
    if (metric === 'menu_contribution_pct' && has(q, 'النجوم', 'الخيول', 'stars', 'horses', 'menu matrix', 'هندسه')) {
      rules.push('exec:menu-matrix');
      const mm = menuMatrix(db, caller, { from: period.from, to: period.to, branchIds, filters });
      const by = (c: string) => mm.items.filter((i) => i.class === c).map((i) => i.label.ar);
      return { ...base(question, rules), status: 'ANSWERED', shape: 'matrix', text: L(`نجوم: ${by('STAR').join('، ') || '—'}. خيول: ${by('PLOWHORSE').join('، ') || '—'}. ألغاز: ${by('PUZZLE').join('، ') || '—'}. كلاب: ${by('DOG').join('، ') || '—'}. التكلفة مش متاحة لـ ${by('COST_UNAVAILABLE').length} صنف (بنعرض شعبيتهم بس).`, `Stars: ${by('STAR').length}, plowhorses: ${by('PLOWHORSE').length}…`), data: mm, chips: chipsFor({ meta: mm.meta }, ['menu_contribution', 'menu_popularity'], filters, period, db), parsed: { intent: 'MENU_MATRIX', metrics: ['menu_contribution', 'sold_quantity'], dimensions: ['product'], filters, period, rules } };
    }
    if (metric === 'menu_contribution' && has(q, 'وصفه', 'recipe')) {
      rules.push('exec:no-recipe');
      const r = query(db, caller, { metrics: ['sold_quantity', 'food_theoretical_cost'], dimensions: ['product'], from: period.from, to: period.to, branchIds, filters });
      const missing = r.rows.filter((x) => x.values.food_theoretical_cost.availability !== 'AVAILABLE');
      return { ...base(question, rules), status: 'ANSWERED', shape: 'table', text: L(`${missing.length} صنف اتباع من غير وصفة تكلفة: ${missing.map((x) => x.labels.product.ar).join('، ') || '—'}. هامشهم «مش متاح» مش صفر.`, `${missing.length} sold items have no recipe cost.`), data: { ...r, rows: missing }, chips: chipsFor(r, ['food_theoretical_cost'], filters, period, db), parsed: { intent: 'QUERY', metrics: ['food_theoretical_cost'], dimensions: ['product'], filters, period, rules } };
    }
    if (has(q, 'الفرق بين مبيعات', 'differ from collections', 'مختلف ليه عن dashboard', 'differ from dashboard', 'ليه عن', 'مبيعات النهارده والتحصيل') || (has(q, 'الفرق', 'differ') && has(q, 'التحصيل', 'collections'))) {
      rules.push('exec:bridge');
      const p2 = parsePeriod(q, today, 'TODAY', []) as Period;
      const br = eodBridge(db, caller, { from: p2.from, to: p2.to, branchIds });
      return { ...base(question, rules), status: 'ANSWERED', shape: 'bridge', text: L(`الفواتير ${fmtVal(br.gap.billed)} والمتحصل ${fmtVal(br.gap.collected)}: الفرق ${fmtVal(br.gap.difference)} — متشرح بـ: ${br.gap.explanations.map((e) => `${e.label.ar} ${fmtVal(e.amount)}`).join('، ') || 'مفيش فرق'}؛ غير مفسَّر ${fmtVal(br.gap.unexplained)}. والصافي من غير ضريبة وخدمة ${fmtVal(br.sales.find((s) => s.id === 'item_net')!.amount)}.${D(br.gap.billed).isZero() && D(br.gap.collected).isZero() && p2.from === today ? ' (اليوم لسه مفتوح ومفيش حركات لحد دلوقتي — جرب «امبارح».)' : ''}`, `Billed ${br.gap.billed} vs collected ${br.gap.collected}: difference ${br.gap.difference}, unexplained ${br.gap.unexplained}.`), data: br, chips: [{ kind: 'definition', label: L('جسر نهاية اليوم', 'EOD bridge'), detail: L('المبيعات والتحصيل مقياسان مختلفان؛ ويُفسَّر كل فرق بحركات.', 'Sales and collections differ; every gap is explained by events.') }, { kind: 'period', label: L(`${p2.label.ar}: ${p2.from}`, `${p2.label.en}: ${p2.from}`) }, { kind: 'asOf', label: L(`لحد ${br.scope.asOf.slice(0, 16)}`, `As of ${br.scope.asOf.slice(0, 16)}`) }], parsed: { intent: 'BRIDGE', metrics: ['recognized_sales_total', 'tender_collected'], dimensions: [], filters: {}, period: p2, rules } };
    }
    if (isWhy && (cl.baseline || hasBaseline) && ['net_item_sales', 'item_net_sales'].includes(metric) && !dims.includes('branch')) {
      rules.push('exec:decompose');
      const dc = decompose(db, caller, { from: period.from, to: period.to, mode: (cl.baseline as any) ?? (has(q, 'نفس يوم', 'same weekday') ? 'SAME_WEEKDAY_LAST_WEEK' : 'PREVIOUS'), branchIds, filters: filters.hour ? undefined : filters });
      if (!dc.available) return na(question, rules, [metric], dc.reason, period);
      return { ...base(question, rules), status: 'ANSWERED', shape: 'decompose', text: L(`صافي الأصناف ${fmtVal(dc.totals.base)} ← ${fmtVal(dc.totals.current)} (فرق ${fmtVal(dc.totals.delta)}): ${dc.effects.map((e) => `${e.label.ar} ${fmtVal(e.amount)}`).join('، ')}. ${dc.caveat.ar}`, `Item net ${dc.totals.base} → ${dc.totals.current}.`), data: dc, chips: [{ kind: 'definition', label: L('تقسيم الفرق: حجم × سعر × تشكيلة + غير مفسَّر', 'Volume × price × mix + unexplained'), detail: dc.caveat }, { kind: 'period', label: L(`${dc.current.from}→${dc.current.to} مقابل ${dc.base.from}→${dc.base.to}`, `${dc.current.from}→${dc.current.to} vs ${dc.base.from}→${dc.base.to}`) }], parsed: { intent: 'DECOMPOSE', metrics: [metric], dimensions: ['product'], filters, period, rules } };
    }
    if (isCompare || (change && hasBaseline) || cl.baseline) {
      if (dims.includes('branch') || dims.includes('channel')) return runQuery(db, caller, question, rules, metrics, dims, filters, period, branchIds, 'COMPARE_DIM');
      rules.push('exec:compare');
      const mode = (cl.baseline as any) ?? (has(q, 'نفس يوم', 'same weekday') ? 'SAME_WEEKDAY_LAST_WEEK' : 'PREVIOUS');
      const per = has(q, 'امبارح', 'yesterday') ? period : period;
      const cmp = compare(db, caller, { metrics, from: per.from, to: per.to, mode, branchIds, filters });
      const r0 = cmp.rows[0];
      const unit = metricById.get(metrics[0])!.unit;
      return { ...base(question, rules), status: r0.current.availability === 'AVAILABLE' ? 'ANSWERED' : 'NOT_AVAILABLE', shape: 'compare', text: L(`${metricById.get(metrics[0])!.label.ar}: ${fmtVal(r0.current.value, unit)} مقابل ${fmtVal(r0.base.value, unit)} (${cmp.base.from}${cmp.base.to !== cmp.base.from ? '→' + cmp.base.to : ''}) — ${r0.delta !== null ? `فرق ${fmtVal(r0.delta, unit)}${r0.pct ? ` (${Number(r0.pct).toFixed(1)}%)` : ''}` : (r0.base.reason ?? r0.current.reason)?.ar ?? 'مش متاح'}.`, `${metricById.get(metrics[0])!.label.en}: ${fmtValEn(r0.current.value, unit)} vs ${fmtValEn(r0.base.value, unit)}.`), data: cmp, chips: [...chipsFor({ meta: cmp.meta }, metrics, filters, per, db), { kind: 'assumption', label: L(mode === 'PREVIOUS' ? 'المقارنة بالفترة اللي قبلها بنفس الطول' : 'المقارنة بنفس اليوم الأسبوع اللي فات', mode === 'PREVIOUS' ? 'vs previous period' : 'vs same weekday last week') }], parsed: { intent: 'COMPARE', metrics, dimensions: [], filters, period: per, rules } };
    }
    if (has(q, 'هات كل', 'وريني', 'list ', 'show ', 'اتلغت بعد طباعه', 'removed after preliminary') && !dims.length && !['stock_on_hand'].includes(metric)) {
      rules.push('exec:evidence');
      return explainAnswer(db, caller, question, rules, { metric, filters, from: period.from, to: period.to, branchIds }, period);
    }
    return runQuery(db, caller, question, rules, metrics, dims, filters, period, branchIds);
  } catch (e) {
    if (e instanceof ReportRefusal && e.code === 'REPORT_SCOPE_DENIED') return refuse(question, rules, 'هذا الفرع ليس ضمن صلاحياتك — رفض الخادم.', 'That branch is outside your scope — refused by the server.');
    throw e;
  }
}

function runQuery(db: DB, caller: Caller, question: string, rules: string[], metrics: string[], dims: string[], filters: Record<string, string>, period: Period, branchIds?: string[], intent = 'QUERY'): Answer {
  rules.push(`exec:query${dims.length ? ':' + dims.join('+') : ''}`);
  const rank = /bottom/.test(rules.join()) ? 'asc' : 'desc';
  const r = query(db, caller, { metrics, dimensions: dims, filters, from: period.from, to: period.to, branchIds, sort: { metric: metrics[0], dir: rank as any }, limit: dims.length ? 15 : undefined });
  const m = metricById.get(metrics[0])!;
  const tot = r.totals[metrics[0]];
  if (tot.availability === 'NOT_AVAILABLE' || tot.availability === 'REFUSED') {
    const st: AskStatus = tot.availability === 'REFUSED' ? 'REFUSED' : 'NOT_AVAILABLE';
    return { ...base(question, rules), status: st, shape: st === 'REFUSED' ? 'refusal' : 'not_available', text: L(`${m.label.ar}: ${st === 'REFUSED' ? 'مرفوض' : 'غير متاح'} — ${tot.reason?.ar ?? ''}`, `${m.label.en}: ${st === 'REFUSED' ? 'refused' : 'not available'} — ${tot.reason?.en ?? ''}`), data: r, chips: chipsFor(r, metrics, filters, period, db), parsed: { intent, metrics, dimensions: dims, filters, period, rules } };
  }
  let text: Loc;
  if (!dims.length && tot.availability === 'NOT_DEFINED') text = L(`${m.label.ar} (${period.label.ar}): غير معرَّف — ${tot.reason?.ar ?? ''}`, `${m.label.en} (${period.label.en}): undefined — ${tot.reason?.en ?? ''}`);
  else if (!dims.length) {
    const extra = metrics.slice(1).map((id) => `${metricById.get(id)!.label.ar} ${fmtVal(r.totals[id]?.value, metricById.get(id)!.unit)}`).join('، ');
    text = L(`${m.label.ar} (${period.label.ar}): ${fmtVal(tot.value, m.unit)}${extra ? '، ' + extra : ''}${r.meta.provisional ? ' — مبدئي' : ''}.${tot.reason && tot.availability === 'AVAILABLE' ? ' ' + tot.reason.ar : ''}`, `${m.label.en} (${period.label.en}): ${fmtValEn(tot.value, m.unit)}${r.meta.provisional ? ' — provisional' : ''}.`);
  } else {
    const top = r.rows.slice(0, 5).map((x) => `${dims.map((d) => x.labels[d].ar).join(' / ')}: ${fmtVal(x.values[metrics[0]]?.value, m.unit)}`).join('، ');
    text = L(`${m.label.ar} حسب ${dims.map((d) => dimensionById.get(d)?.label.ar ?? d).join(' و')} (${period.label.ar}) — ${r.rows.length ? top : 'لا توجد صفوف في هذه الفترة'}${r.rows.length > 5 ? ' …' : ''}. الإجمالي ${fmtVal(tot.value, m.unit)} (محسوب من جديد، مش مجموع الصفوف).`, `${m.label.en} by ${dims.join(', ')} — total ${fmtValEn(tot.value, m.unit)}.`);
  }
  const dropped = rules.filter((x) => x.startsWith('filter-dropped:')).map((x) => x.split(':')[1]);
  if (period.from === period.to && period.from === bdOf(caller.nowMs) && !(tot.evidenceCount ?? 0)) text = L(`${text.ar} (اليوم ما زال مفتوحًا ولا حركات حتى الآن — جرّب «أمس».)`, `${text.en} (The day is open with no events yet — try 'yesterday'.)`);
  return { ...base(question, rules), status: 'ANSWERED', shape: dims.length ? (dims.includes('hour') || dims.includes('business_date') ? 'chart' : 'table') : 'number', text, data: r, chips: chipsFor(r, metrics, filters, period, db).concat(dropped.map((d) => ({ kind: 'assumption' as const, label: L(`تعذّر التصفية بـ«${dimensionById.get(d)?.label.ar ?? d}» لهذا المقياس — هذا الرقم بلا تصفية`, `Cannot filter this metric by ${dimensionById.get(d)?.label.en ?? d} — shown unfiltered`) }))).concat([{ kind: 'source', label: L(`${tot.evidenceCount ?? 0} سجل مصدر — اضغط لعرض الشيكات`, `${tot.evidenceCount ?? 0} source records — open checks`), explain: { metric: metrics[0], filters, from: period.from, to: period.to, branchIds } }]), parsed: { intent, metrics, dimensions: dims, filters, period, rules } };
}

function explainAnswer(db: DB, caller: Caller, question: string, rules: string[], spec: any, period?: Period): Answer {
  rules.push('exec:explain');
  const today = bdOf(caller.nowMs);
  const e = explain(db, caller, { metric: spec.metric, filters: spec.filters, cell: spec.cell, from: spec.from ?? today, to: spec.to, branchIds: spec.branchIds });
  const ev = e.parts.flatMap((p) => p.evidence);
  const m = metricById.get(spec.metric)!;
  return { ...base(question, rules), status: 'ANSWERED', shape: 'evidence', text: L(`${m.label.ar}: ${fmtVal(e.value.value, m.unit)} — وراه ${ev.length} سجل${e.proof.holds === true ? '، ومجموعهم بيطلع نفس الرقم ✓' : ''}.`, `${m.label.en}: ${fmtValEn(e.value.value, m.unit)} — ${ev.length} source records${e.proof.holds ? ', they add up ✓' : ''}.`), data: e, chips: [{ kind: 'definition', label: L(`${m.label.ar} (نسخة ${m.version})`, `${m.label.en} v${m.version}`), detail: m.definition }, { kind: 'period', label: L(`${e.meta.from}${e.meta.to !== e.meta.from ? ' → ' + e.meta.to : ''}`, `${e.meta.from}${e.meta.to !== e.meta.from ? ' → ' + e.meta.to : ''}`) }, { kind: 'asOf', label: L(`لحد ${e.meta.asOf.slice(0, 16)}`, `As of ${e.meta.asOf.slice(0, 16)}`) }], parsed: { intent: 'EVIDENCE', metrics: [spec.metric], dimensions: [], filters: spec.filters ?? {}, period: period ?? null, rules } };
}
export { metricList };
