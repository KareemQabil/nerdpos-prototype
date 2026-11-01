// Report studio operations (round 4, all PROPOSED): the pivot query (Report.Pivot) with server-side validation and the
// same branch / role scope as Report.Query; exports that run on the server and are audited; saved custom reports with
// versions, sharing (view / edit / share) and favourites; document templates (versioned); schedules that attach a saved
// report + template + format + recipients with per-branch bursting and a run history whose outputs can be opened; the
// report audit trail (who ran / exported / edited what, when, with which parameters and how many rows).
import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { permsOf } from '../kernel';
import { nextId, store } from '../store';
import { hasPermission } from '../types-channels';
import { need, userName, checkVersion } from './util';
import type { DB, User } from '../types';
import { callerOf, guard } from './reports';
import { pivot, metricById, manifestById, runManifest, ReportRefusal, type Caller, type PivotSpec } from '../../reports';
import { addDays } from '../../reports/facts';
import { businessDate } from '../clock';
import { roleLabel } from '../../demo/people';
import { nextRun } from '../seed-ops';
import type { ReportSchedule } from '../types-ops';
import {
  studioOf, specOf, canViewSaved, canEditSaved, canShareSaved, canViewAudience, rolesOf, emptyDesign, REPORT_CATEGORIES,
  type SavedReport, type ReportTemplate, type ReportAuditRec, type Audience, type ReportDesign, type ScheduleOutput,
} from '../../reports/studio';

const parseJSON = (s: string | undefined, field: string) => { try { return JSON.parse(s ?? '{}'); } catch { throw new ApiError('VALIDATION_FAILED', { field, rule: 'JSON' }); } };
const readableOf = (db: DB, u: User) => db.branches.filter((b) => hasPermission(permsOf(db, u, b.id), 'report:run')).map((b) => b.id);
const me = (ctx: Ctx) => ctx.user!;
const LEGACY_TO_CERT: Record<string, string> = { daily_sales: 'eod_bridge', tenders: 'tender_settlement', products: 'top_items', peak_hours: 'hourly_daypart', branch_comparison: 'branch_comparison', shift: 'drawer_xz', exceptions: 'discounts_comps', staff: 'discounts_comps' };

export function touchRecentOf(db: DB, nowIso: string, userId: string, id: string) {
  const st = studioOf(db, nowIso);
  st.recent[userId] = [{ id, at: nowIso }, ...(st.recent[userId] ?? []).filter((x) => x.id !== id)].slice(0, 12);
}
export function studioAudit(db: DB, nowIso: string, userId: string | null, rec: Omit<ReportAuditRec, 'id' | 'at' | 'userId'>) {
  const s = studioOf(db, nowIso);
  s.audit.unshift({ id: nextId('rau'), at: nowIso, userId, ...rec });
  if (s.audit.length > 300) s.audit.length = 300;
}
function savedView(ctx: Ctx, r: SavedReport, full = false) {
  const u = me(ctx); const br = callerOf(ctx).accessibleBranchIds; const st = studioOf(ctx.db, ctx.nowIso);
  return {
    id: r.id, name: r.name, description: r.description, category: r.category, categoryLabel: REPORT_CATEGORIES[r.category] ?? REPORT_CATEGORIES.other,
    ownerId: r.ownerId, ownerName: userName(ctx.db, r.ownerId), view: r.view, edit: r.edit, templateId: r.templateId, design: r.design, basedOn: r.basedOn,
    version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt, certified: false,
    canEdit: canEditSaved(r, u, br), canShare: canShareSaved(r, u), favourite: (st.favourites[u.id] ?? []).includes(r.id),
    lastOpened: (st.recent[u.id] ?? []).find((x) => x.id === r.id)?.at ?? null,
    versions: full ? r.versions.map((v) => ({ version: v.version, at: v.at, by: v.by, byName: userName(ctx.db, v.by), note: v.note, name: v.snapshot.name })) : undefined,
  };
}
function findSaved(ctx: Ctx, id: string, mode: 'view' | 'edit' = 'view'): SavedReport {
  const r = studioOf(ctx.db, ctx.nowIso).saved.find((x) => x.id === id);
  const br = callerOf(ctx).accessibleBranchIds;
  if (!r || !canViewSaved(r, me(ctx), br)) throw new ApiError('REPORT_NOT_FOUND', { savedReportId: id }, 404);
  if (mode === 'edit' && !canEditSaved(r, me(ctx), br)) throw new ApiError('REPORT_EDIT_DENIED', { savedReportId: id }, 403);
  return r;
}
function cleanAudience(a: any, fallback: Audience): Audience {
  if (!a || typeof a !== 'object') return fallback;
  const mode = ['ME', 'ROLES', 'BRANCHES', 'EVERYONE'].includes(a.mode) ? a.mode : fallback.mode;
  return { mode, roles: mode === 'ROLES' ? (a.roles ?? []).map(String).slice(0, 10) : undefined, branches: mode === 'BRANCHES' ? (a.branches ?? []).map(String).slice(0, 20) : undefined };
}
/** Validates a design by running it once (registry rules, combinations, limits) — refusals come back as errors. */
function validateDesign(ctx: Ctx, d: ReportDesign) {
  need(d && Array.isArray(d.metrics) && d.metrics.length > 0, 'VALIDATION_FAILED', { field: 'design.metrics' });
  for (const m of d.metrics) if (!metricById.has(m)) throw new ApiError('METRIC_NOT_FOUND', { metric: m }, 404);
  const c = callerOf(ctx);
  guard(() => pivot(ctx.db, c, specOf(d, ctx.businessDate(), ctx.branchId, c.accessibleBranchIds)));
}
const touchRecent = (ctx: Ctx, id: string) => {
  const st = studioOf(ctx.db, ctx.nowIso); const u = me(ctx).id;
  st.recent[u] = [{ id, at: ctx.nowIso }, ...(st.recent[u] ?? []).filter((x) => x.id !== id)].slice(0, 12);
};
function templateView(ctx: Ctx, t: ReportTemplate, full = false) {
  const { versions, ...rest } = t;
  return { ...rest, canEdit: canEditTemplate(ctx, t), versions: full ? versions.map((v) => ({ version: v.version, at: v.at, by: v.by, byName: v.by === 'system' ? null : userName(ctx.db, v.by), note: v.note })) : undefined };
}
const canEditTemplate = (ctx: Ctx, t: ReportTemplate) => (t.builtIn ? ctx.can('settings:updatepolicy') || rolesOf(me(ctx)).includes('role_owner') : t.ownerId === me(ctx).id || rolesOf(me(ctx)).includes('role_owner'));

/** A certified manifest → a custom design (its main breakdown table), for «احفظ نسخة وعدّل». */
function designFromManifest(id: string): ReportDesign {
  const man = manifestById.get(id);
  if (!man) throw new ApiError('REPORT_NOT_FOUND', { reportId: id }, 404);
  const block = man.blocks.find((b) => (b.kind === 'table' || b.kind === 'bars' || b.kind === 'line') && b.dimensions?.length) ?? man.blocks.find((b) => b.kind === 'kpis');
  const d = emptyDesign();
  d.metrics = (block?.metrics ?? man.metrics).filter((m) => metricById.get(m)?.status === 'AVAILABLE').slice(0, 8);
  d.rows = (block?.dimensions ?? []).slice(0, 2);
  d.period = { preset: man.defaultPeriod === 'LAST_7' ? 'LAST_7' : man.defaultPeriod === 'TODAY' ? 'TODAY' : 'YESTERDAY' };
  d.view.chart = block?.kind === 'line' ? 'line' : block?.kind === 'bars' ? 'bars' : 'none';
  if (block?.limit) d.topN = { n: block.limit, others: true };
  return d;
}

// ───────── schedules: one output per branch the recipients may see (bursting), stored for preview
interface Recipient { kind: 'USER' | 'ROLE' | 'TEXT'; id: string; label: string }
const recipientsOf = (s: any): Recipient[] => (s.recipientsV2 as Recipient[] | undefined) ?? (s.recipients ?? []).map((x: string) => ({ kind: 'TEXT' as const, id: x, label: x }));
function compactCertified(run: any) {
  const kpiBlock = run.blocks.find((b: any) => b.kind === 'kpis');
  const kpis = kpiBlock ? kpiBlock.metrics.slice(0, 6).map((m: string) => ({ metric: m, label: metricById.get(m)?.label, unit: metricById.get(m)?.unit, value: kpiBlock.result?.totals[m] ?? null })) : [];
  return { certified: true, reportId: run.reportId, title: run.title, period: run.period, branchIds: run.branchIds, header: run.header, kpis, sections: run.sections, bridge: run.blocks.find((b: any) => b.bridge)?.bridge ?? null };
}
export function runSchedule(db: DB, s: ReportSchedule & Record<string, any>, nowMs: number): { outputs: ScheduleOutput[]; note: string } {
  const nowIso = new Date(nowMs).toISOString();
  const st = studioOf(db, nowIso);
  const creator = db.users.find((u) => u.id === s.createdBy) ?? db.users.find((u) => u.id === 'u_owner')!;
  const recips = recipientsOf(s);
  const users = (r: Recipient) => (r.kind === 'USER' ? db.users.filter((u) => u.id === r.id) : r.kind === 'ROLE' ? db.users.filter((u) => u.active && rolesOf(u).includes(r.id)) : []);
  const saved = s.savedReportId ? st.saved.find((x) => x.id === s.savedReportId && !x.archived) : null;
  const certId = saved ? null : manifestById.has(s.reportId) ? s.reportId : LEGACY_TO_CERT[s.reportId] ?? null;
  const creatorBranches = readableOf(db, creator);
  // the branches each recipient may read; legacy free-text recipients receive the schedule's own branch
  const allowed = new Map<Recipient, string[]>();
  for (const r of recips) allowed.set(r, r.kind === 'TEXT' ? [s.branchId] : [...new Set(users(r).flatMap((u) => readableOf(db, u)))]);
  let wanted: string[];
  if (!s.burst) wanted = [s.branchId];
  else if (saved && Array.isArray(saved.design.branches)) wanted = saved.design.branches;
  else wanted = saved?.design.branches === 'DEVICE' ? [s.branchId] : db.branches.map((b) => b.id);
  const branches = wanted.filter((b) => creatorBranches.includes(b) && [...allowed.values()].some((xs) => xs.includes(b)));
  const outputs: ScheduleOutput[] = [];
  const today = businessDate(nowMs);
  for (const b of branches) {
    const caller: Caller = { userId: creator.id, perms: (p) => hasPermission(permsOf(db, creator, b), p), accessibleBranchIds: [b], nowMs, defaultBranchId: b };
    const to = recips.filter((r) => allowed.get(r)!.includes(b)).map((r) => r.label);
    const branchName = db.branches.find((x) => x.id === b)?.name ?? b;
    try {
      let result: any; let rows = 0; let period: { from: string; to: string }; let title: string;
      if (saved) {
        const spec = specOf(saved.design, today, b, [b], { branchIds: [b] });
        result = pivot(db, caller, spec); rows = result.nodeCount - 1; period = { from: spec.from, to: spec.to ?? spec.from }; title = saved.name;
        result.saved = { id: saved.id, name: saved.name, design: saved.design, templateId: saved.templateId };
      } else if (certId) {
        const man = manifestById.get(certId)!;
        period = s.frequency === 'WEEKLY' ? { from: addDays(today, -7), to: addDays(today, -1) } : { from: addDays(today, -1), to: addDays(today, -1) };
        if (man.period === 'DAY') period.from = period.to;
        result = compactCertified(runManifest(db, caller, certId, { from: period.from, to: period.to, branchIds: [b] })); rows = result.sections.reduce((a: number, x: any) => a + x.rows.length, 0); title = man.title.ar;
      } else continue;
      outputs.push({ id: nextId('rso'), scheduleId: s.id, runAt: nowIso, branchId: b, branchName, title, kind: saved ? 'PIVOT' : 'CERTIFIED', period, templateId: s.templateId ?? saved?.templateId ?? null, format: s.format, recipients: to, rows, result });
    } catch (e) {
      if (!(e instanceof ReportRefusal)) throw e;
    }
  }
  st.outputs.unshift(...outputs);
  // keep the last outputs only (localStorage): newest 24
  if (st.outputs.length > 24) st.outputs.length = 24;
  for (const o of outputs) studioAudit(db, nowIso, creator.id, { action: 'SCHEDULE_RUN', targetKind: 'SCHEDULE', targetId: s.id, targetName: o.title, params: { ...o.period, branchIds: [o.branchId] }, rows: o.rows, format: s.format, note: o.recipients.join('، ') });
  const note = outputs.length ? outputs.map((o) => `${o.branchName} → ${o.recipients.join('، ')}`).join(' | ') : `اتبعت لـ ${recips.map((r) => r.label).join('، ')} (${s.format})`;
  return { outputs, note };
}
/** Called by the background ticker (ops.ts) when a schedule is due, and by «شغّل دلوقتي». */
export function fireSchedule(db: DB, s: ReportSchedule & Record<string, any>, nowMs: number) {
  let status: 'SENT' | 'FAILED' = 'SENT'; let res: { outputs: ScheduleOutput[]; note: string };
  try { res = runSchedule(db, s, nowMs); } catch (e) { status = 'FAILED'; res = { outputs: [], note: String((e as any)?.code ?? (e as any)?.message ?? e) }; }
  s.runs.unshift({ at: new Date(nowMs).toISOString(), status, note: res.note, outputs: res.outputs.map((o) => ({ id: o.id, branchId: o.branchId, branchName: o.branchName, rows: o.rows, recipients: o.recipients })) } as any);
  s.runs.length = Math.min(s.runs.length, 10);
  return res;
}

export const reportStudioHandlers: Record<string, Handler> = {
  'Report.Pivot': (ctx) => guard(() => {
    const c = callerOf(ctx);
    let spec: PivotSpec; let saved: SavedReport | null = null;
    const override = { from: ctx.query.from || undefined, to: ctx.query.to || undefined, branchIds: ctx.query.branchIds ? ctx.query.branchIds.split(',').filter(Boolean) : undefined };
    if (ctx.query.savedReportId) { saved = findSaved(ctx, ctx.query.savedReportId); spec = specOf(saved.design, ctx.businessDate(), ctx.branchId, c.accessibleBranchIds, override); }
    else spec = parseJSON(ctx.query.q, 'q');
    if (!spec.branchIds?.length && override.branchIds) spec.branchIds = override.branchIds;
    const r = pivot(ctx.db, c, spec);
    if (ctx.query.audit === '1') {
      studioAudit(ctx.db, ctx.nowIso, me(ctx).id, { action: 'RUN', targetKind: saved ? 'SAVED' : 'CERTIFIED', targetId: saved?.id ?? 'designer', targetName: saved?.name ?? 'تقرير جديد', params: { from: r.meta.from, to: r.meta.to, branchIds: r.meta.branchIds, filters: spec.filters }, rows: r.nodeCount - 1 });
      if (saved) touchRecent(ctx, saved.id);
      store.commit();
    }
    return { ...r, saved: saved ? savedView(ctx, saved) : null };
  }),
  'Report.PivotExport': (ctx) => guard(() => {
    const b = ctx.body ?? {};
    const format = ['XLSX', 'CSV', 'PDF'].includes(b.format) ? b.format : null;
    need(format, 'VALIDATION_FAILED', { field: 'format', rule: 'XLSX | CSV | PDF' });
    const c = callerOf(ctx);
    const saved = b.savedReportId ? findSaved(ctx, b.savedReportId) : null;
    const spec: PivotSpec = saved ? specOf(saved.design, ctx.businessDate(), ctx.branchId, c.accessibleBranchIds, { from: b.from, to: b.to, branchIds: b.branchIds }) : b.spec;
    need(spec && Array.isArray(spec.metrics), 'VALIDATION_FAILED', { field: 'spec' });
    const r = pivot(ctx.db, c, spec);
    const code = ctx.db.branches.find((x) => x.id === r.meta.branchIds[0])?.code ?? 'BR';
    const slug = (saved?.id ?? 'custom').replace(/^sr_/, '');
    const filename = `nerdpos-${slug}-${r.meta.branchIds.length > 1 ? 'ALL' : code}-${r.meta.from}${r.meta.to !== r.meta.from ? '_' + r.meta.to : ''}.${format.toLowerCase()}`;
    const rec = { id: nextId('rexp'), reportId: saved?.id ?? 'designer', from: r.meta.from, to: r.meta.to, format, at: ctx.nowIso, by: me(ctx).id, rows: r.nodeCount - 1, filename };
    (ctx.db.reportExports ??= []).unshift(rec as any);
    if (ctx.db.reportExports.length > 50) ctx.db.reportExports.length = 50;
    studioAudit(ctx.db, ctx.nowIso, me(ctx).id, { action: 'EXPORT', targetKind: saved ? 'SAVED' : 'CERTIFIED', targetId: saved?.id ?? 'designer', targetName: saved?.name ?? b.name ?? 'تقرير جديد', params: { from: r.meta.from, to: r.meta.to, branchIds: r.meta.branchIds, filters: spec.filters }, rows: rec.rows, format });
    ctx.audit(`report export ${rec.reportId} ${format}`, rec.id);
    return { status: 201, body: { ...rec, generatedBy: userName(ctx.db, me(ctx).id), generatedAt: ctx.nowIso, result: { ...r, saved: saved ? savedView(ctx, saved) : null } } };
  }),
  'SavedReport.Find': (ctx) => {
    const st = studioOf(ctx.db, ctx.nowIso); const br = callerOf(ctx).accessibleBranchIds;
    const items = st.saved.filter((r) => canViewSaved(r, me(ctx), br)).map((r) => savedView(ctx, r));
    // who a report can be shared with / sent to: people who can read reports, and the roles (plain names)
    const people = ctx.db.users.filter((u) => u.active && readableOf(ctx.db, u).length).map((u) => ({ id: u.id, name: userName(ctx.db, u.id), roles: rolesOf(u) }));
    const ROLE_AR: Record<string, string> = { role_owner: 'صاحب المطعم', role_manager: 'المديرين', role_accountant: 'المحاسبين', role_cashier: 'الكاشيرية', role_waiter: 'الويترية', role_chef: 'الشيفات' };
    const roles = ctx.db.roles.filter((r) => r.active && r.id !== 'role_bootstrap' && r.permissionIds.some((p) => p === 'report:run' || p === '*')).map((r) => ({ id: r.id, name: ROLE_AR[r.id] ?? roleLabel(r.name) }));
    return { items, favourites: st.favourites[me(ctx).id] ?? [], recent: st.recent[me(ctx).id] ?? [], categories: REPORT_CATEGORIES, people, roles, me: me(ctx).id };
  },
  'SavedReport.Get': (ctx) => { const r = findSaved(ctx, ctx.params.savedReportId); const snapshot = ctx.query.version ? r.versions.find((v) => v.version === Number(ctx.query.version))?.snapshot ?? null : undefined; return { ...savedView(ctx, r, true), snapshot, audit: studioOf(ctx.db, ctx.nowIso).audit.filter((a) => a.targetId === r.id).slice(0, 40).map((a) => ({ ...a, userName: userName(ctx.db, a.userId) })) }; },
  'SavedReport.Save': (ctx) => {
    const b = ctx.body ?? {};
    const st = studioOf(ctx.db, ctx.nowIso);
    const name = String(b.name ?? '').trim();
    need(name.length >= 2 && name.length <= 80, 'VALIDATION_FAILED', { field: 'name', rule: '2..80' });
    const design: ReportDesign = b.design;
    validateDesign(ctx, design);
    const category = REPORT_CATEGORIES[b.category] ? b.category : 'other';
    const templateId = b.templateId && st.templates.some((t) => t.id === b.templateId) ? b.templateId : null;
    if (!b.id) {
      const view = cleanAudience(b.view, { mode: 'ME' });
      const r: SavedReport = { id: nextId('sr'), name, description: String(b.description ?? '').slice(0, 300), category, ownerId: me(ctx).id, view, edit: b.edit === 'VIEWERS' ? 'VIEWERS' : 'OWNER', templateId, design, basedOn: b.basedOn ?? null, version: 1, versions: [], createdAt: ctx.nowIso, updatedAt: ctx.nowIso };
      r.versions.push({ version: 1, at: ctx.nowIso, by: me(ctx).id, note: String(b.note ?? '') || 'أول نسخة', snapshot: { name, description: r.description, design, view, edit: r.edit, templateId } });
      st.saved.push(r);
      studioAudit(ctx.db, ctx.nowIso, me(ctx).id, { action: b.basedOn ? 'DUPLICATE' : 'CREATE', targetKind: 'SAVED', targetId: r.id, targetName: name, params: { version: 1 }, rows: null, note: b.basedOn ? `نسخة من ${b.basedOn}` : null });
      ctx.audit(`saved report create ${r.id}`, r.id);
      return { status: 201, body: savedView(ctx, r, true) };
    }
    const r = findSaved(ctx, b.id, 'edit');
    checkVersion(r, b.expectedVersion);
    const view = b.view ? cleanAudience(b.view, r.view) : r.view;
    const edit = b.edit === 'VIEWERS' || b.edit === 'OWNER' ? b.edit : r.edit;
    const sharing = JSON.stringify(view) !== JSON.stringify(r.view) || edit !== r.edit;
    if (sharing && !canShareSaved(r, me(ctx))) throw new ApiError('REPORT_SHARE_DENIED', { savedReportId: r.id }, 403);
    Object.assign(r, { name, description: String(b.description ?? r.description).slice(0, 300), category, design, view, edit, templateId, updatedAt: ctx.nowIso, version: r.version + 1 });
    r.versions.unshift({ version: r.version, at: ctx.nowIso, by: me(ctx).id, note: String(b.note ?? '').slice(0, 200) || 'تعديل', snapshot: { name, description: r.description, design, view, edit, templateId } });
    if (r.versions.length > 30) r.versions.length = 30;
    studioAudit(ctx.db, ctx.nowIso, me(ctx).id, { action: sharing ? 'SHARE' : 'SAVE', targetKind: 'SAVED', targetId: r.id, targetName: name, params: { version: r.version }, rows: null, note: b.note ?? null });
    ctx.audit(`saved report v${r.version} ${r.id}`, r.id);
    return savedView(ctx, r, true);
  },
  'SavedReport.Duplicate': (ctx) => {
    const st = studioOf(ctx.db, ctx.nowIso);
    const src = findSaved(ctx, ctx.params.savedReportId);
    const name = String(ctx.body?.name ?? '').trim() || `${src.name} (نسخة)`;
    const r: SavedReport = { ...structuredClone(src), id: nextId('sr'), name: name.slice(0, 80), ownerId: me(ctx).id, view: { mode: 'ME' }, edit: 'OWNER', basedOn: src.id, version: 1, versions: [], createdAt: ctx.nowIso, updatedAt: ctx.nowIso, archived: false };
    r.versions.push({ version: 1, at: ctx.nowIso, by: me(ctx).id, note: `نسخة من «${src.name}» (نسخة ${src.version})`, snapshot: { name: r.name, description: r.description, design: r.design, view: r.view, edit: r.edit, templateId: r.templateId } });
    st.saved.push(r);
    studioAudit(ctx.db, ctx.nowIso, me(ctx).id, { action: 'DUPLICATE', targetKind: 'SAVED', targetId: r.id, targetName: r.name, params: { version: 1 }, rows: null, note: src.id });
    return { status: 201, body: savedView(ctx, r, true) };
  },
  'SavedReport.FromCertified': (ctx) => {
    const id = String(ctx.body?.reportId ?? '');
    const man = manifestById.get(id);
    if (!man || !ctx.can(man.permission)) throw new ApiError('REPORT_NOT_FOUND', { reportId: id }, 404);
    const design = designFromManifest(id);
    return { design, name: `${man.title.ar} (نسختي)`, description: man.purpose.ar, category: REPORT_CATEGORIES[man.family] ? man.family : 'other', basedOn: id };
  },
  'SavedReport.Restore': (ctx) => {
    const r = findSaved(ctx, ctx.params.savedReportId, 'edit');
    checkVersion(r, ctx.body?.expectedVersion);
    const v = r.versions.find((x) => x.version === Number(ctx.body?.version));
    if (!v) throw new ApiError('VALIDATION_FAILED', { field: 'version', rule: 'not found' }, 404);
    Object.assign(r, { ...structuredClone(v.snapshot), version: r.version + 1, updatedAt: ctx.nowIso });
    r.versions.unshift({ version: r.version, at: ctx.nowIso, by: me(ctx).id, note: `رجّعنا نسخة ${v.version}`, snapshot: structuredClone(v.snapshot) });
    studioAudit(ctx.db, ctx.nowIso, me(ctx).id, { action: 'RESTORE', targetKind: 'SAVED', targetId: r.id, targetName: r.name, params: { version: r.version }, rows: null, note: `v${v.version}` });
    return savedView(ctx, r, true);
  },
  'SavedReport.Delete': (ctx) => {
    const r = findSaved(ctx, ctx.params.savedReportId);
    if (!canShareSaved(r, me(ctx))) throw new ApiError('REPORT_EDIT_DENIED', { savedReportId: r.id }, 403);
    r.archived = true; r.updatedAt = ctx.nowIso;
    studioAudit(ctx.db, ctx.nowIso, me(ctx).id, { action: 'DELETE', targetKind: 'SAVED', targetId: r.id, targetName: r.name, params: null, rows: null });
    return { id: r.id, archived: true };
  },
  'SavedReport.Favourite': (ctx) => {
    const id = String(ctx.body?.id ?? ''); need(id, 'VALIDATION_FAILED', { field: 'id' });
    const st = studioOf(ctx.db, ctx.nowIso); const u = me(ctx).id;
    const set = new Set(st.favourites[u] ?? []);
    if (ctx.body?.on === false || (ctx.body?.on === undefined && set.has(id))) set.delete(id); else set.add(id);
    st.favourites[u] = [...set];
    return { favourites: st.favourites[u] };
  },
  'ReportTemplate.Find': (ctx) => {
    const st = studioOf(ctx.db, ctx.nowIso); const br = callerOf(ctx).accessibleBranchIds;
    return { items: st.templates.filter((t) => canViewAudience(t.view, t.ownerId, me(ctx), br)).map((t) => templateView(ctx, t, true)) };
  },
  'ReportTemplate.Save': (ctx) => {
    const b = ctx.body ?? {};
    const st = studioOf(ctx.db, ctx.nowIso);
    const name = typeof b.name === 'string' ? { ar: b.name, en: b.name } : b.name;
    need(name?.ar && String(name.ar).trim().length >= 2, 'VALIDATION_FAILED', { field: 'name' });
    need(['A4', 'RECEIPT_80'].includes(b.paper), 'VALIDATION_FAILED', { field: 'paper', rule: 'A4 | RECEIPT_80' });
    need(['portrait', 'landscape'].includes(b.orientation), 'VALIDATION_FAILED', { field: 'orientation' });
    const sigs = Array.isArray(b.footer?.signatures) ? b.footer.signatures.slice(0, 4).map((s: any) => ({ label: String(s.label ?? '').slice(0, 30), name: String(s.name ?? '').slice(0, 40), role: String(s.role ?? '').slice(0, 40) })) : null;
    const fields = {
      name: { ar: String(name.ar).slice(0, 60), en: String(name.en ?? name.ar).slice(0, 60) }, description: b.description ?? { ar: '', en: '' }, paper: b.paper, orientation: b.paper === 'RECEIPT_80' ? 'portrait' : b.orientation, margins: b.margins === 'narrow' ? 'narrow' : 'normal',
      header: { logo: !!b.header?.logo, venue: b.header?.venue !== false, branch: b.header?.branch !== false, params: !!b.header?.params },
      blocks: { kpis: !!b.blocks?.kpis, table: b.blocks?.table !== false, chart: !!b.blocks?.chart, bridge: !!b.blocks?.bridge, notes: !!b.blocks?.notes, tableOnNewPage: !!b.blocks?.tableOnNewPage },
      notes: String(b.notes ?? '').slice(0, 600), depth: Math.max(0, Math.min(4, Number(b.depth) || 0)),
      footer: { pageNumbers: b.footer?.pageNumbers !== false, confidentiality: String(b.footer?.confidentiality ?? '').slice(0, 120), signatures: sigs },
      watermark: { provisional: b.watermark?.provisional !== false, sandbox: b.watermark?.sandbox !== false }, lang: b.lang === 'en' ? 'en' : 'ar',
    } as const;
    if (!b.id) {
      const t: ReportTemplate = { id: nextId('tpl'), builtIn: false, ownerId: me(ctx).id, view: cleanAudience(b.view, { mode: 'EVERYONE' }), ...(fields as any), version: 1, versions: [], updatedAt: ctx.nowIso };
      const { versions: _v, version: _n, ...snap } = t; void _v; void _n;
      t.versions.push({ version: 1, at: ctx.nowIso, by: me(ctx).id, note: String(b.note ?? '') || 'أول نسخة', snapshot: snap });
      st.templates.push(t);
      studioAudit(ctx.db, ctx.nowIso, me(ctx).id, { action: 'TEMPLATE_SAVE', targetKind: 'TEMPLATE', targetId: t.id, targetName: t.name.ar, params: { version: 1 }, rows: null });
      return { status: 201, body: templateView(ctx, t, true) };
    }
    const t = st.templates.find((x) => x.id === b.id);
    if (!t) throw new ApiError('TEMPLATE_NOT_FOUND', { templateId: b.id }, 404);
    if (!canEditTemplate(ctx, t)) throw new ApiError('TEMPLATE_EDIT_DENIED', { templateId: t.id }, 403);
    checkVersion(t, b.expectedVersion);
    Object.assign(t, fields, { version: t.version + 1, updatedAt: ctx.nowIso });
    const { versions: _v, version: _n, ...snap } = t; void _v; void _n;
    t.versions.unshift({ version: t.version, at: ctx.nowIso, by: me(ctx).id, note: String(b.note ?? '').slice(0, 200) || 'تعديل', snapshot: structuredClone(snap) });
    if (t.versions.length > 20) t.versions.length = 20;
    studioAudit(ctx.db, ctx.nowIso, me(ctx).id, { action: 'TEMPLATE_SAVE', targetKind: 'TEMPLATE', targetId: t.id, targetName: t.name.ar, params: { version: t.version }, rows: null });
    return templateView(ctx, t, true);
  },
  'ReportAudit.Find': (ctx) => {
    const st = studioOf(ctx.db, ctx.nowIso);
    const all = ctx.can('audit:read') || rolesOf(me(ctx)).includes('role_owner') || rolesOf(me(ctx)).includes('role_accountant');
    let items = st.audit.filter((a) => all || a.userId === me(ctx).id);
    if (ctx.query.targetId) items = items.filter((a) => a.targetId === ctx.query.targetId);
    return { items: items.slice(0, 200).map((a) => ({ ...a, userName: userName(ctx.db, a.userId) })), scope: all ? 'ALL' : 'MINE' };
  },
  'Report.ScheduleRunNow': (ctx) => {
    const s = (ctx.db.reportSchedules ?? []).find((x) => x.id === ctx.params.scheduleId && x.branchId === ctx.branchId) as any;
    if (!s) throw new ApiError('VALIDATION_FAILED', { field: 'scheduleId', rule: 'not found' }, 404);
    const res = fireSchedule(ctx.db, s, ctx.now);
    s.version++;
    return { ...s, outputs: res.outputs.map((o) => ({ id: o.id, branchName: o.branchName, rows: o.rows, recipients: o.recipients })) };
  },
  'Report.ScheduleOutput': (ctx) => {
    const st = studioOf(ctx.db, ctx.nowIso);
    const o = st.outputs.find((x) => x.id === ctx.params.outputId);
    const br = callerOf(ctx).accessibleBranchIds;
    if (!o || !br.includes(o.branchId)) throw new ApiError('REPORT_NOT_FOUND', { outputId: ctx.params.outputId }, 404);
    return { ...o, template: st.templates.find((t) => t.id === o.templateId) ?? null };
  },
};

/** Report.Schedule upgrade: a saved report + template + format (PDF / Excel / CSV) + recipients by person or role + bursting. */
export function scheduleExtras(ctx: Ctx, b: any): Partial<ReportSchedule> & Record<string, unknown> {
  const st = studioOf(ctx.db, ctx.nowIso);
  const out: Record<string, unknown> = {};
  if (b.savedReportId) { const r = findSaved(ctx, b.savedReportId); out.savedReportId = r.id; out.reportTitle = { ar: r.name, en: r.name }; out.reportId = r.id; }
  if (b.templateId) { need(st.templates.some((t) => t.id === b.templateId), 'TEMPLATE_NOT_FOUND', { templateId: b.templateId }); out.templateId = b.templateId; }
  if (Array.isArray(b.recipientsV2)) {
    const list: Recipient[] = b.recipientsV2.slice(0, 20).map((r: any) => {
      if (r.kind === 'USER') { const u = ctx.db.users.find((x) => x.id === r.id); need(u, 'VALIDATION_FAILED', { field: 'recipients', rule: 'unknown person' }); return { kind: 'USER', id: u!.id, label: userName(ctx.db, u!.id) }; }
      if (r.kind === 'ROLE') { const role = ctx.db.roles.find((x) => x.id === r.id); need(role, 'VALIDATION_FAILED', { field: 'recipients', rule: 'unknown role' }); return { kind: 'ROLE', id: role!.id, label: String(r.label ?? role!.name) }; }
      return { kind: 'TEXT', id: String(r.label ?? r.id), label: String(r.label ?? r.id) };
    });
    need(list.length > 0, 'VALIDATION_FAILED', { field: 'recipients', rule: 'at least one person' });
    out.recipientsV2 = list; out.recipients = list.map((r) => r.label);
  }
  out.burst = b.burst !== false;
  if (b.format === 'PDF') out.format = 'PDF';
  return out as any;
}
export { nextRun };
