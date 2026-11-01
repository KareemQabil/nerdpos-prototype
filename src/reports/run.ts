// Runs a certified manifest through the engine: header (business date, timezone, asOf, provisional/closed, metric
// definitions + versions, reconciliation status), blocks, export sheets and the expert checklist.
import type { DB, Loc } from '../mock/types';
import { D } from '../mock/money';
import { query, explain, dayStatus, datesOf, launchDate, type Caller } from './engine';
import { eodBridge } from './recon';
import { menuMatrix, CLASS_LABEL } from './analysis';
import { manifestById, MANIFESTS, type Manifest } from './manifests';
import { metricById, METRICS } from './registry/metrics';
import { DIMENSIONS } from './registry/dimensions';
import { CHECKLIST } from './expert';
import { userLabel } from '../demo/people';
import { BUILDERS } from './facts';

export interface RunSpec { from: string; to?: string; branchIds?: string[]; asOf?: string; filters?: Record<string, string> }

const fmtValue = (v: any) => (v?.availability === 'AVAILABLE' ? v.value : v?.availability === 'NOT_DEFINED' ? '—' : 'CAPABILITY_NOT_AVAILABLE');

export function venueOf(db: DB, branchIds: string[], caller: Caller) {
  const tpl = (db as any).r3b?.docTemplate ?? null;
  const u = db.users.find((x) => x.id === caller.userId);
  const profile = db.fiscalProfiles.find((p) => branchIds.includes(p.branchId));
  return {
    business: { name: db.business.nameAr || db.business.name, nameEn: db.business.name, legalName: db.business.legalName, taxNumber: profile?.issuerId ?? null },
    branches: branchIds.map((b) => ({ id: b, name: db.branches.find((x) => x.id === b)?.name ?? b, code: db.branches.find((x) => x.id === b)?.code ?? b })),
    template: tpl ? { logo: tpl.logoOnReports !== false ? tpl.logoDataUrl : null, header: tpl.headerLines ?? [], footer: tpl.footerLines ?? [], paper: tpl.paper ?? '80MM', version: tpl.version } : null,
    generatedBy: u ? userLabel(u.username, u.displayName) : null,
  };
}

export function runManifest(db: DB, caller: Caller, id: string, spec: RunSpec) {
  const man = manifestById.get(id)!;
  const to = man.period === 'DAY' ? spec.from : spec.to ?? spec.from;
  const base = { from: spec.from, to, branchIds: spec.branchIds, asOf: spec.asOf };
  const bridge = eodBridge(db, caller, base);
  const branchIds = bridge.scope.branchIds;
  const blocks = man.blocks.map((b) => {
    const filters = { ...(spec.filters ?? {}), ...(b.filters ?? {}) };
    if (b.kind === 'bridge') return { ...b, bridge: { sales: bridge.sales, money: bridge.money, outside: bridge.outside, gap: bridge.gap } };
    if (b.kind === 'drawers') return { ...b, drawers: bridge.drawers };
    if (b.kind === 'matrix') return { ...b, matrix: menuMatrix(db, caller, { ...base, branchIds, filters }) };
    if (b.kind === 'evidence') return { ...b, evidence: explain(db, caller, { metric: b.metrics[0], filters, from: spec.from, to, branchIds, asOf: spec.asOf }) };
    return { ...b, result: query(db, caller, { metrics: b.metrics, dimensions: b.dimensions, filters, from: spec.from, to, branchIds, asOf: spec.asOf, sort: b.sort, limit: b.limit }) };
  });
  const head = query(db, caller, { metrics: man.metrics.filter((m) => metricById.has(m)).slice(0, 1), from: spec.from, to, branchIds, asOf: spec.asOf });
  const days = datesOf(spec.from, to).map((d) => ({ date: d, status: dayStatus(db, branchIds, d, caller.nowMs) }));
  const header = {
    reportId: man.id, title: man.title, period: { from: spec.from, to }, timezone: 'Africa/Cairo', cutoff: head.meta.cutoff, asOf: head.meta.asOf,
    provisional: head.meta.provisional, provisionalReasons: head.meta.provisionalReasons, days, closed: days.every((d) => d.status === 'CLOSED'),
    preLaunch: spec.from < launchDate(db), launchDate: launchDate(db),
    metrics: man.metrics.map((m) => metricById.get(m)).filter(Boolean).map((m) => ({ id: m!.id, label: m!.label, version: m!.version, definition: m!.definition, formula: m!.formula, unit: m!.unit, additivity: m!.additivity, authority: m!.authority, status: m!.status, reason: m!.reason ?? null, pitfalls: m!.pitfalls })),
    reconciliation: { status: bridge.status, checks: bridge.checks.map((c) => ({ id: c.id, title: c.title, status: c.status, difference: c.difference })), counts: { MATCHED: bridge.checks.filter((c) => c.status === 'MATCHED').length, EXPLAINED: bridge.checks.filter((c) => c.status === 'EXPLAINED').length, UNEXPLAINED: bridge.checks.filter((c) => c.status === 'UNEXPLAINED').length } },
    venue: venueOf(db, branchIds, caller),
  };
  return { reportId: man.id, title: man.title, certified: true, manifest: man, period: { from: spec.from, to }, branchIds, provisional: header.provisional, asOf: header.asOf, header, blocks, bridgeChecks: bridge.checks, checklist: man.checklist.map((c) => CHECKLIST[c]).filter(Boolean), sections: sectionsOf(db, blocks) };
}

/** Plain tables for CSV / Excel (Report.Export reads `sections`, so files equal the screen). */
function sectionsOf(db: DB, blocks: any[]) {
  const out: { id: string; title: Loc; columns: string[]; rows: unknown[][] }[] = [];
  const lab = (id: string) => metricById.get(id)?.label.ar ?? id;
  for (const b of blocks) {
    if (b.result) {
      const r = b.result;
      if (!r.dimensions.length) out.push({ id: b.id, title: b.title, columns: ['المقياس', 'القيمة'], rows: r.metrics.map((m: string) => [lab(m), fmtValue(r.totals[m])]) });
      else out.push({ id: b.id, title: b.title, columns: [...r.dimensions.map((d: string) => DIMENSIONS.find((x) => x.id === d)?.label.ar ?? d), ...r.metrics.map(lab)], rows: [...r.rows.map((x: any) => [...r.dimensions.map((d: string) => x.labels[d]?.ar ?? x.dims[d]), ...r.metrics.map((m: string) => fmtValue(x.values[m]))]), ['الإجمالي (محسوب من جديد)', ...r.dimensions.slice(1).map(() => ''), ...r.metrics.map((m: string) => fmtValue(r.totals[m]))]] });
    } else if (b.bridge) {
      out.push({ id: b.id, title: b.title, columns: ['البند', 'المبلغ'], rows: [...b.bridge.sales.map((x: any) => [x.label.ar, x.amount]), ['', ''], ...b.bridge.money.map((x: any) => [x.label.ar, x.amount]), ['الفرق (فواتير − متحصل)', b.bridge.gap.difference], ...b.bridge.gap.explanations.map((e: any) => [e.label.ar, e.amount]), ['غير مفسَّر', b.bridge.gap.unexplained]] });
    } else if (b.drawers) {
      out.push({ id: b.id, title: b.title, columns: ['الوردية', 'المتوقع', 'المعدود', 'الفرق', 'السبب'], rows: b.drawers.map((d: any) => [d.label, d.expected, d.counted ?? '—', d.variance ?? '—', d.reason ?? '']) });
    } else if (b.matrix) {
      out.push({ id: b.id, title: b.title, columns: ['الصنف', 'الكمية', 'صافي المبيعات', 'التكلفة', 'الهامش', 'التصنيف'], rows: b.matrix.items.map((i: any) => [i.label.ar, i.qty, i.net, fmtValue(i.cost), fmtValue(i.contribution), CLASS_LABEL[i.class].ar]) });
    } else if (b.evidence) {
      out.push({ id: b.id, title: b.title, columns: ['السجل', 'اليوم', 'المبلغ'], rows: b.evidence.parts.flatMap((p: any) => p.evidence.map((e: any) => [e.label, e.businessDate ?? '', e.amount ?? ''])) });
    }
  }
  void db;
  return out;
}

/** The layer view for the catalog page: facts → metrics → reports → analysis → evidence → assistant, with counts. */
export function catalog(db: DB, caller: Caller, extra: { questionBank?: number; legacyReports: number }) {
  const s = { branchIds: caller.accessibleBranchIds, from: '2000-01-01', to: '2999-12-31', asOfMs: caller.nowMs };
  const facts = Object.entries(BUILDERS).filter(([k]) => k !== 'history').map(([k, fn]) => ({ kind: k, count: fn!(db, s).length }));
  const visible = METRICS.filter((m) => !m.hidden);
  return {
    layers: [
      { id: 'L0', title: { ar: 'الأحداث (الحقائق)', en: 'Facts (events)' }, items: facts.length, available: facts.filter((f) => f.count > 0).length, detail: facts },
      { id: 'L1', title: { ar: 'المقاييس والأبعاد', en: 'Metrics & dimensions' }, items: visible.length, available: visible.filter((m) => m.status === 'AVAILABLE').length, notAvailable: visible.filter((m) => m.status === 'NOT_AVAILABLE').length, byAuthority: { CANONICAL: visible.filter((m) => m.authority === 'CANONICAL').length, MARKET: visible.filter((m) => m.authority === 'MARKET').length, PROPOSED: visible.filter((m) => m.authority === 'PROPOSED').length }, dimensions: DIMENSIONS.length, dimensionsAvailable: DIMENSIONS.filter((d) => d.status === 'AVAILABLE').length },
      { id: 'L2', title: { ar: 'التقارير المعتمدة', en: 'Certified reports' }, items: MANIFESTS.length, pilot: MANIFESTS.filter((m) => m.pilot).length, legacy: extra.legacyReports },
      { id: 'L3', title: { ar: 'التحليل', en: 'Analysis' }, items: 4, tools: ['compare', 'trend', 'decompose', 'menu_matrix'] },
      { id: 'L4', title: { ar: 'الإثبات (الشيكات ورا كل رقم)', en: 'Evidence (checks behind every number)' }, items: 1, tools: ['Report.Explain', 'eod_bridge'] },
      { id: 'A', title: { ar: 'المساعد (قواعد ثابتة)', en: 'Assistant (rule-based)' }, items: extra.questionBank ?? 0 },
    ],
    launchDate: launchDate(db),
    sum: D(0).toString(),
  };
}
export { MANIFESTS };
