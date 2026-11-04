// Report.* operations over the layered engine (src/reports/**). Moved out of output.ts (Report.List / Report.Run /
// Report.AccountantExport) and extended: certified manifests, Report.Query / Explain / Bridge / Analyze / Ask,
// Metric.List and Report.Catalog. All read-only: reporting writes nothing except the export log and schedules.
import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { permsOf } from '../kernel';
import { nextId, store } from '../store';
import { hasPermission } from '../types-channels';
import { need, requireBranch, userName } from './util';
import {
  query, explain, metricList, eodBridge, compare, trend, decompose, menuMatrix, runManifest, catalog, MANIFESTS, manifestById,
  DIMENSIONS, CHECKLIST, LEGACY_REPORTS, runLegacyReport, ReportRefusal, homeSummary, scopeBranches, type Caller,
} from '../../reports';
import { ask, QUESTION_BANK_SIZE } from '../../reports/assistant';
import { nextRun } from '../seed-ops';
import type { ReportSchedule } from '../types-ops';
import { scheduleExtras, studioAudit, touchRecentOf } from './report-studio';

export function callerOf(ctx: Ctx): Caller {
  const db = ctx.db;
  const accessible = ctx.user ? db.branches.filter((b) => hasPermission(permsOf(db, ctx.user!, b.id), 'report:run')).map((b) => b.id) : [];
  return { userId: ctx.user?.id ?? null, perms: (p) => ctx.can(p), accessibleBranchIds: accessible, nowMs: ctx.now, defaultBranchId: ctx.branchId };
}
export function guard<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    if (e instanceof ReportRefusal) throw new ApiError(e.code, e.details, e.code === 'REPORT_SCOPE_DENIED' ? 403 : e.code === 'METRIC_NOT_FOUND' ? 404 : 400);
    throw e;
  }
}
const parseQ = (ctx: Ctx) => { try { return JSON.parse(ctx.query.q ?? '{}'); } catch { throw new ApiError('VALIDATION_FAILED', { field: 'q', rule: 'JSON' }); } };
const branchList = (ctx: Ctx) => (ctx.query.branchIds ? ctx.query.branchIds.split(',').filter(Boolean) : undefined);
const filtersOf = (ctx: Ctx) => { if (!ctx.query.filters) return undefined; try { return JSON.parse(ctx.query.filters); } catch { return undefined; } };

const runSpec = (ctx: Ctx) => {
  const from = ctx.query.fromBusinessDate;
  need(from && /^\d{4}-\d{2}-\d{2}$/.test(from), 'VALIDATION_FAILED', { field: 'fromBusinessDate' });
  return { from, to: ctx.query.toBusinessDate || from, branchIds: branchList(ctx), asOf: ctx.query.asOf || undefined, filters: filtersOf(ctx) };
};

export const reportHandlers: Record<string, Handler> = {
  'Report.List': (ctx) => ({
    items: [
      ...MANIFESTS.filter((m) => ctx.can(m.permission)).map((m) => ({ id: m.id, title: m.title, permission: m.permission, period: m.period === 'DAY' ? 'DAY' : 'RANGE', certified: true, pilot: m.pilot, family: m.family, purpose: m.purpose, audience: m.audience, defaultPeriod: m.defaultPeriod, researchIds: m.researchIds })),
      ...LEGACY_REPORTS.filter((r) => ctx.can(r.permission) && !manifestById.has(r.id)).map((r) => ({ ...r, certified: false, legacy: true })),
    ],
  }),
  'Report.Run': (ctx) => guard(() => {
    const id = ctx.params.reportId;
    const man = manifestById.get(id);
    if (man) {
      if (!ctx.can(man.permission)) throw new ApiError('REPORT_NOT_FOUND');
      const spec = runSpec(ctx);
      if ((Date.parse(spec.to) - Date.parse(spec.from)) / 86_400_000 > 93) throw new ApiError('VALIDATION_FAILED', { rule: 'a range is at most 93 days' });
      const out = runManifest(ctx.db, callerOf(ctx), id, spec);
      if (ctx.query.audit === '1' && ctx.user) { // opened by a person (not a background refresh): audit + recent
        studioAudit(ctx.db, ctx.nowIso, ctx.user.id, { action: 'RUN', targetKind: 'CERTIFIED', targetId: id, targetName: man.title.ar, params: { from: out.period.from, to: out.period.to, branchIds: out.branchIds }, rows: (out.sections ?? []).reduce((a: number, x: any) => a + x.rows.length, 0) });
        touchRecentOf(ctx.db, ctx.nowIso, ctx.user.id, id); store.commit();
      }
      return out;
    }
    const def = LEGACY_REPORTS.find((r) => r.id === id);
    if (!def || !ctx.can(def.permission)) throw new ApiError('REPORT_NOT_FOUND');
    const from = ctx.query.fromBusinessDate;
    need(from && /^\d{4}-\d{2}-\d{2}$/.test(from), 'VALIDATION_FAILED', { field: 'fromBusinessDate' });
    const to = def.period === 'DAY' ? from : (ctx.query.toBusinessDate ?? from);
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 93) throw new ApiError('VALIDATION_FAILED', { rule: 'a range is at most 93 days' });
    const requested = branchList(ctx) ?? [ctx.branchId!];
    const branchIds = guard(() => { const c = callerOf(ctx); const bad = requested.filter((b) => !c.accessibleBranchIds.includes(b)); if (bad.length) throw new ReportRefusal('REPORT_SCOPE_DENIED', { branchIds: bad }); return requested; });
    return { title: def.title, legacy: true, ...runLegacyReport(ctx, def.id, from, to, branchIds) };
  }),
  'Report.AccountantExport': (ctx) => {
    const from = ctx.query.fromBusinessDate ?? ctx.businessDate();
    const to = ctx.query.toBusinessDate ?? from;
    const r = runLegacyReport(ctx, 'daily_sales', from, to, [ctx.branchId!]);
    const t = runLegacyReport(ctx, 'tenders', from, to, [ctx.branchId!]);
    const lines = ['section,metric,value', ...(r as any).sections[0].rows.map((x: any[]) => `summary,${x[0]},${x[1]}`), ...(t as any).sections[0].rows.map((x: any[]) => `tenders,${x[0]},${x[3]}`)];
    return { filename: `nerdpos-${ctx.db.branches.find((b) => b.id === ctx.branchId)?.code}-${from}_${to}.csv`, csv: lines.join('\n') };
  },
  // ux-17: Home's numbers from the certified reports, for the business day resolved here (never the browser's)
  'Report.Home': (ctx) => guard(() => {
    const c = callerOf(ctx);
    const branchIds = scopeBranches(ctx.db, c, branchList(ctx));
    return homeSummary(ctx.db, c, { businessDate: ctx.businessDate(branchIds[0]), branchIds: branchList(ctx) ? branchIds : undefined });
  }),
  'Report.Query': (ctx) => guard(() => query(ctx.db, callerOf(ctx), parseQ(ctx))),
  'Report.Explain': (ctx) => guard(() => explain(ctx.db, callerOf(ctx), parseQ(ctx))),
  'Report.Bridge': (ctx) => guard(() => { const s = runSpec(ctx); return eodBridge(ctx.db, callerOf(ctx), s); }),
  'Report.Analyze': (ctx) => guard(() => {
    const q = parseQ(ctx);
    const c = callerOf(ctx);
    if (q.kind === 'compare') return { kind: 'compare', ...compare(ctx.db, c, q) };
    if (q.kind === 'trend') return { kind: 'trend', ...trend(ctx.db, c, q) };
    if (q.kind === 'decompose') return { kind: 'decompose', ...decompose(ctx.db, c, q) };
    if (q.kind === 'menu_matrix') return { kind: 'menu_matrix', ...menuMatrix(ctx.db, c, q) };
    throw new ApiError('VALIDATION_FAILED', { field: 'kind', rule: 'compare|trend|decompose|menu_matrix' });
  }),
  'Report.Ask': (ctx) => guard(() => {
    need(String(ctx.query.question ?? '').trim(), 'VALIDATION_FAILED', { field: 'question' });
    return ask(ctx.db, callerOf(ctx), { question: String(ctx.query.question), clarify: ctx.query.clarify || undefined, lang: ctx.query.lang === 'en' ? 'en' : 'ar', context: ctx.query.context ? JSON.parse(ctx.query.context) : undefined });
  }),
  'Metric.List': (ctx) => ({ metrics: metricList(callerOf(ctx)), dimensions: DIMENSIONS, checklist: CHECKLIST }),
  'Report.Catalog': (ctx) => guard(() => ({ ...catalog(ctx.db, callerOf(ctx), { questionBank: QUESTION_BANK_SIZE, legacyReports: LEGACY_REPORTS.length }), manifests: MANIFESTS.map((m) => ({ id: m.id, title: m.title, family: m.family, pilot: m.pilot, permission: m.permission, metrics: m.metrics, dimensions: m.dimensions, researchIds: m.researchIds, allowed: ctx.can(m.permission) })) })),

  // Export and schedule (contract ops) — files carry the period, asOf, provisional flag and definition versions
  'Report.Export': (ctx) => guard(() => {
    const b = ctx.body ?? {};
    need(b.reportId, 'VALIDATION_FAILED', { field: 'reportId' });
    const format: 'CSV' | 'XLSX' | 'PDF' = b.format === 'XLSX' ? 'XLSX' : b.format === 'PDF' ? 'PDF' : 'CSV';
    const res = reportHandlers['Report.Run']({ ...ctx, params: { reportId: b.reportId }, query: { fromBusinessDate: b.fromBusinessDate, toBusinessDate: b.toBusinessDate ?? b.fromBusinessDate, branchIds: b.branchIds ?? '', asOf: b.asOf ?? '' } }) as any;
    const sheets = (res.sections ?? []).map((s: any) => ({ id: s.id, title: s.title, columns: s.columns ?? null, rows: s.rows ?? [] }));
    const code = ctx.db.branches.find((x) => x.id === ctx.branchId)?.code ?? 'BR';
    const filename = `nerdpos-${b.reportId}-${code}-${b.fromBusinessDate}${b.toBusinessDate && b.toBusinessDate !== b.fromBusinessDate ? '_' + b.toBusinessDate : ''}.${format.toLowerCase()}`;
    const rec = { id: nextId('rexp'), reportId: b.reportId, from: b.fromBusinessDate, to: b.toBusinessDate ?? b.fromBusinessDate, format, at: ctx.nowIso, by: ctx.user!.id, rows: sheets.reduce((a: number, s: any) => a + s.rows.length, 0), filename };
    (ctx.db.reportExports ??= []).unshift(rec);
    if (ctx.db.reportExports.length > 50) ctx.db.reportExports.length = 50;
    ctx.audit(`report export ${b.reportId} ${format}`, rec.id);
    studioAudit(ctx.db, ctx.nowIso, ctx.user!.id, { action: 'EXPORT', targetKind: 'CERTIFIED', targetId: b.reportId, targetName: res.title?.ar ?? b.reportId, params: { from: rec.from, to: rec.to, branchIds: res.branchIds }, rows: rec.rows, format });
    const meta = res.header ? { asOf: res.header.asOf, timezone: res.header.timezone, provisional: res.header.provisional, reconciliation: res.header.reconciliation.status, metrics: res.header.metrics.map((m: any) => ({ id: m.id, label: m.label, version: m.version })), venue: res.header.venue } : null;
    return { status: 201, body: { ...rec, title: res.title, period: res.period, provisional: res.provisional, asOf: res.asOf ?? ctx.nowIso, generatedBy: userName(ctx.db, ctx.user!.id), meta, sheets } };
  }),
  'Report.Schedule': (ctx) => {
    const b = ctx.body ?? {};
    const extra = scheduleExtras(ctx, b);
    const def = extra.savedReportId ? { id: extra.reportId, title: extra.reportTitle } : (reportHandlers['Report.List'](ctx) as any).items.find((r: any) => r.id === b.reportId);
    if (!def) throw new ApiError('REPORT_NOT_FOUND');
    need(b.frequency === 'DAILY' || b.frequency === 'WEEKLY', 'VALIDATION_FAILED', { field: 'frequency' });
    need(/^\d{2}:\d{2}$/.test(b.time ?? ''), 'VALIDATION_FAILED', { field: 'time' });
    if (b.frequency === 'WEEKLY') need(Number(b.weekday) >= 0 && Number(b.weekday) <= 6, 'VALIDATION_FAILED', { field: 'weekday' });
    const recipients: string[] = ((extra.recipients as string[] | undefined) ?? b.recipients ?? []).map((x: string) => String(x).trim()).filter(Boolean).slice(0, 20);
    need(recipients.length > 0, 'VALIDATION_FAILED', { field: 'recipients', rule: 'at least one person' });
    const next = nextRun(ctx.now, b.frequency, b.frequency === 'WEEKLY' ? Number(b.weekday) : null, b.time);
    const s: ReportSchedule = { id: nextId('rs'), reportId: def.id, reportTitle: def.title, frequency: b.frequency, weekday: b.frequency === 'WEEKLY' ? Number(b.weekday) : null, time: b.time, format: b.format === 'CSV' ? 'CSV' : b.format === 'PDF' ? 'PDF' : 'XLSX', recipients, branchId: requireBranch(ctx), active: true, createdAt: ctx.nowIso, createdBy: ctx.user!.id, nextRunAt: new Date(next).toISOString(), nextRunMs: next, runs: [], version: 1, ...extra, ...(extra.savedReportId ? {} : { reportId: def.id, reportTitle: def.title }) } as ReportSchedule;
    (ctx.db.reportSchedules ??= []).push(s);
    ctx.audit(`report schedule ${s.reportId} ${s.frequency} ${s.time}`, s.id);
    return { status: 201, body: { ...s, createdByName: userName(ctx.db, s.createdBy) } };
  },
};
