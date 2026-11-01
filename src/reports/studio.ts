// Report studio (round 4): saved custom reports, document templates, schedule outputs and the report audit trail.
// Pure data + rules (no React): who may view / edit / share, how a saved design becomes a pivot spec on the server's
// business date, and the seeded examples. Certified reports stay in manifests.ts (read-only; «save as» copies them).
import type { DB, Loc, User } from '../mock/types';
import { resolvePeriod, READY_CALCS, type PivotSpec, type PeriodPreset, type CompareMode, type ExtraKind, type FormatRule, type HavingRule } from './pivot';

export type AudienceMode = 'ME' | 'ROLES' | 'BRANCHES' | 'EVERYONE';
export interface Audience { mode: AudienceMode; roles?: string[]; branches?: string[] }
export type NumberFormat = 'auto' | 'money' | 'money0' | 'number' | 'number0' | 'pct';
export interface ColumnView { id: string; label?: string; format?: NumberFormat; width?: number; hidden?: boolean }
export type FormatPreset = 'none' | 'highlow' | 'below_target' | 'arrows' | 'topbottom';
export interface ReportDesign {
  metrics: string[]; rows: string[]; columns: string[];
  period: { preset: PeriodPreset; from?: string; to?: string };
  branches: 'DEVICE' | 'ALL' | string[];
  filters?: Record<string, string[]>; exclude?: Record<string, string[]>;
  compare?: CompareMode | null; extras?: ExtraKind[];
  topN?: { n: number; others: boolean } | null;
  sort?: { by: string; dir: 'asc' | 'desc' } | null;
  having?: HavingRule[]; calcs?: string[];             // READY_CALCS ids only
  format?: { preset: FormatPreset; measure?: string; target?: string };
  view: { columns: ColumnView[]; chart: 'none' | 'bars' | 'line'; expandDepth: number };
}
export interface Version<T> { version: number; at: string; by: string; note: string; snapshot: T }
export interface SavedReport {
  id: string; name: string; description: string; category: string; ownerId: string;
  view: Audience; edit: 'OWNER' | 'VIEWERS';
  templateId: string | null; design: ReportDesign; basedOn: string | null;
  version: number; versions: Version<{ name: string; description: string; design: ReportDesign; view: Audience; edit: 'OWNER' | 'VIEWERS'; templateId: string | null }>[];
  createdAt: string; updatedAt: string; archived?: boolean;
}
export interface Signature { label: string; name: string; role: string }
export interface ReportTemplate {
  id: string; name: Loc; description: Loc; builtIn: boolean; ownerId: string | null; view: Audience;
  paper: 'A4' | 'RECEIPT_80'; orientation: 'portrait' | 'landscape'; margins: 'narrow' | 'normal';
  header: { logo: boolean; venue: boolean; branch: boolean; params: boolean };
  blocks: { kpis: boolean; table: boolean; chart: boolean; bridge: boolean; notes: boolean; tableOnNewPage: boolean };
  notes: string; depth: number; // print the table down to this level (0 = every level)
  footer: { pageNumbers: boolean; confidentiality: string; signatures: Signature[] | null };
  watermark: { provisional: boolean; sandbox: boolean };
  lang: 'ar' | 'en';
  version: number; versions: Version<Omit<ReportTemplate, 'versions' | 'version'>>[];
  updatedAt: string;
}
export interface ReportAuditRec {
  id: string; at: string; userId: string | null; action: 'RUN' | 'EXPORT' | 'SAVE' | 'CREATE' | 'DUPLICATE' | 'SHARE' | 'DELETE' | 'TEMPLATE_SAVE' | 'SCHEDULE_RUN' | 'RESTORE';
  targetKind: 'SAVED' | 'CERTIFIED' | 'TEMPLATE' | 'SCHEDULE'; targetId: string; targetName: string;
  params: { from?: string; to?: string; branchIds?: string[]; filters?: Record<string, unknown>; version?: number } | null;
  rows: number | null; format?: string | null; note?: string | null;
}
export interface ScheduleOutput {
  id: string; scheduleId: string; runAt: string; branchId: string; branchName: string; title: string;
  kind: 'PIVOT' | 'CERTIFIED'; period: { from: string; to: string }; templateId: string | null; format: string;
  recipients: string[]; rows: number; result: unknown; // PivotResult | certified run (compact)
}
export interface StudioState { saved: SavedReport[]; templates: ReportTemplate[]; audit: ReportAuditRec[]; favourites: Record<string, string[]>; recent: Record<string, { id: string; at: string }[]>; outputs: ScheduleOutput[] }

const L = (ar: string, en: string): Loc => ({ ar, en });

/** The roles of a user (any branch). */
export const rolesOf = (u: User) => u.roleAssignments.map((r) => r.roleId);
export function canViewAudience(a: Audience, ownerId: string | null, user: User, readableBranches: string[]): boolean {
  if (ownerId && ownerId === user.id) return true;
  if (rolesOf(user).includes('role_owner')) return true; // the owner sees every report of the venue
  if (a.mode === 'EVERYONE') return true;
  if (a.mode === 'ROLES') return rolesOf(user).some((r) => a.roles?.includes(r));
  if (a.mode === 'BRANCHES') return readableBranches.some((b) => a.branches?.includes(b));
  return false;
}
export const canViewSaved = (r: SavedReport, u: User, br: string[]) => !r.archived && canViewAudience(r.view, r.ownerId, u, br);
export const canEditSaved = (r: SavedReport, u: User, br: string[]) => !r.archived && (r.ownerId === u.id || (r.edit === 'VIEWERS' && canViewAudience(r.view, r.ownerId, u, br)));
export const canShareSaved = (r: SavedReport, u: User) => r.ownerId === u.id || rolesOf(u).includes('role_owner');

/** A saved design → the pivot spec for today's business date and the caller's device branch. */
export function specOf(d: ReportDesign, today: string, deviceBranch: string | null, readable: string[], override?: { from?: string; to?: string; branchIds?: string[] }): PivotSpec {
  const p = override?.from ? { from: override.from, to: override.to ?? override.from } : resolvePeriod(d.period.preset, today, d.period);
  const branchIds = override?.branchIds?.length ? override.branchIds : d.branches === 'ALL' ? readable : d.branches === 'DEVICE' ? (deviceBranch ? [deviceBranch] : readable.slice(0, 1)) : d.branches;
  const calcs = (d.calcs ?? []).map((id) => READY_CALCS.find((c) => c.id === id)).filter(Boolean).map((c) => ({ id: c!.id, kind: c!.kind, a: c!.a, b: c!.b, label: c!.label }));
  const formats: FormatRule[] = [];
  const fm = d.format?.measure ?? d.metrics[0];
  if (d.format?.preset === 'highlow') formats.push({ id: 'highlow', measure: fm, kind: 'scale' });
  if (d.format?.preset === 'topbottom') formats.push({ id: 'topbottom', measure: fm, kind: 'topbottom', n: 3 });
  if (d.format?.preset === 'below_target' && d.format.target) formats.push({ id: 'target', measure: fm, kind: 'threshold', op: 'lt', value: d.format.target, tone: 'bad' });
  if (d.format?.preset === 'arrows' && d.compare) formats.push({ id: 'arrows', measure: `${d.metrics[0]}@chg`, kind: 'arrows' });
  return {
    metrics: d.metrics, rows: d.rows, columns: d.columns, filters: d.filters, exclude: d.exclude, from: p.from, to: p.to, branchIds,
    compare: d.compare ?? null, extras: d.extras ?? [], topN: d.topN ?? null, sort: d.sort ?? null, having: d.having ?? [], calcs, formats,
  };
}

export const emptyDesign = (): ReportDesign => ({ metrics: ['item_net_sales'], rows: ['category'], columns: [], period: { preset: 'YESTERDAY' }, branches: 'DEVICE', compare: null, extras: [], topN: null, sort: null, having: [], calcs: [], format: { preset: 'none' }, view: { columns: [], chart: 'bars', expandDepth: 1 } });

export const REPORT_CATEGORIES: Record<string, Loc> = {
  sales: L('المبيعات', 'Sales'), menu: L('المنيو والأصناف', 'Menu & items'), payments: L('الفلوس والدرج', 'Money & drawer'), controls: L('الرقابة', 'Controls'),
  service: L('الصالة والشيكات', 'Floor & checks'), kitchen: L('المطبخ', 'Kitchen'), inventory: L('المخزن', 'Inventory'), purchasing: L('المشتريات', 'Purchasing'),
  fiscal: L('الضرايب', 'Tax'), channels: L('القنوات', 'Channels'), multi_branch: L('الفروع', 'Branches'), other: L('تانية', 'Other'),
};

// ───────── seeds (round 4): three ready templates and four useful custom reports
const ACC_SIGN: Signature[] = [{ label: 'أعده', name: 'نادر', role: 'المحاسب' }, { label: 'راجعه', name: 'أحمد', role: 'مدير الفرع' }, { label: 'اعتمده', name: 'الحاج سامي', role: 'صاحب المطعم' }];
function tpl(id: string, ar: string, en: string, dAr: string, dEn: string, x: Partial<ReportTemplate>, nowIso: string): ReportTemplate {
  const base: Omit<ReportTemplate, 'versions' | 'version'> = {
    id, name: L(ar, en), description: L(dAr, dEn), builtIn: true, ownerId: null, view: { mode: 'EVERYONE' },
    paper: 'A4', orientation: 'portrait', margins: 'normal', header: { logo: true, venue: true, branch: true, params: true },
    blocks: { kpis: true, table: true, chart: false, bridge: false, notes: false, tableOnNewPage: false }, notes: '', depth: 0,
    footer: { pageNumbers: true, confidentiality: 'سري — للاستخدام الداخلي في المطعم بس', signatures: null }, watermark: { provisional: true, sandbox: true }, lang: 'ar', updatedAt: nowIso, ...x,
  };
  return { ...base, version: 1, versions: [{ version: 1, at: nowIso, by: 'system', note: 'قالب جاهز', snapshot: base }] };
}
export function seedTemplates(nowIso: string): ReportTemplate[] {
  return [
    tpl('tpl_accountant_a4', 'تقرير المحاسب اليومي A4', "Accountant's daily report A4", 'صفحة A4 طولي: البيانات كاملة، كل المستويات، رصيد منقول بين الصفحات، وتوقيعات أعده / راجعه / اعتمده.', 'A4 portrait: full detail, carried-forward subtotals, and prepared / reviewed / approved signatures.', { blocks: { kpis: true, table: true, chart: false, bridge: true, notes: true, tableOnNewPage: false }, notes: 'الأرقام من محرك التقارير المعتمد. أي فرق في الدرج متسجل في قسم «الأدراج».', footer: { pageNumbers: true, confidentiality: 'سري — للمحاسب والإدارة بس', signatures: ACC_SIGN } }, nowIso),
    tpl('tpl_owner_weekly', 'ملخص المالك الأسبوعي', "Owner's weekly summary", 'A4 عرضي: الأرقام الكبيرة ورسم بياني والمستوى الأول من الجدول بس — يتقري في دقيقة.', 'A4 landscape: headline numbers, a chart and the first table level — readable in a minute.', { orientation: 'landscape', blocks: { kpis: true, table: true, chart: true, bridge: false, notes: false, tableOnNewPage: false }, depth: 1, footer: { pageNumbers: true, confidentiality: '', signatures: null } }, nowIso),
    tpl('tpl_receipt_xz', 'إيصال X/Z 80مم', 'X/Z receipt 80 mm', 'ورق الكاشير 80مم: الأرقام الأساسية والجدول باختصار وتوقيع الكاشير والمدير.', '80 mm cashier paper: key numbers, a compact table and cashier / manager signatures.', { paper: 'RECEIPT_80', header: { logo: true, venue: true, branch: true, params: true }, blocks: { kpis: true, table: true, chart: false, bridge: false, notes: false, tableOnNewPage: false }, depth: 1, margins: 'narrow', footer: { pageNumbers: false, confidentiality: '', signatures: [{ label: 'الكاشير', name: '', role: '' }, { label: 'المدير', name: '', role: '' }] } }, nowIso),
  ];
}
function saved(id: string, name: string, description: string, category: string, ownerId: string, view: Audience, design: Partial<ReportDesign>, templateId: string | null, nowIso: string): SavedReport {
  const d: ReportDesign = { ...emptyDesign(), ...design, view: { columns: [], chart: 'bars', expandDepth: 1, ...(design.view ?? {}) } };
  const snap = { name, description, design: d, view, edit: 'OWNER' as const, templateId };
  return { id, name, description, category, ownerId, view, edit: 'OWNER', templateId, design: d, basedOn: null, version: 1, versions: [{ version: 1, at: nowIso, by: ownerId, note: 'أول نسخة', snapshot: snap }], createdAt: nowIso, updatedAt: nowIso };
}
export function seedSaved(nowIso: string): SavedReport[] {
  return [
    saved('sr_branch_channel', 'المبيعات: الفرع ← القناة ← القسم ← الصنف', 'شجرة المبيعات من الفرع لحد الصنف مع الكمية ونصيب كل واحد من الإجمالي. دوس على أي سطر يفتح اللي تحته.', 'sales', 'u_owner', { mode: 'EVERYONE' },
      { metrics: ['item_net_sales', 'sold_quantity', 'gross_item_sales'], rows: ['branch', 'channel', 'category', 'product'], period: { preset: 'LAST_7' }, branches: 'ALL', extras: ['share_total'], calcs: ['price_per_unit'], format: { preset: 'highlow' }, view: { columns: [], chart: 'bars', expandDepth: 1 } }, 'tpl_accountant_a4', nowIso),
    saved('sr_items_daypart', 'الأصناف حسب فترات اليوم', 'كل صنف اتباع بكام في الفطار والغدا والعشا وآخر الليل — أعلى 10 أصناف والباقي في سطر واحد.', 'menu', 'u_owner', { mode: 'EVERYONE' },
      { metrics: ['item_net_sales'], rows: ['product'], columns: ['daypart'], period: { preset: 'LAST_7' }, branches: 'DEVICE', topN: { n: 10, others: true }, format: { preset: 'highlow' }, view: { columns: [], chart: 'none', expandDepth: 1 } }, 'tpl_owner_weekly', nowIso),
    saved('sr_week_compare', 'الأيام مقارنة بالأسبوع اللي فات', 'صافي المبيعات وعدد الأوردرات كل يوم، جنب نفس اليوم الأسبوع اللي فات، بأسهم التغيير.', 'sales', 'u_owner', { mode: 'ROLES', roles: ['role_manager', 'role_accountant'] },
      { metrics: ['net_item_sales', 'order_count', 'avg_check'], rows: ['business_date'], period: { preset: 'LAST_7' }, branches: 'DEVICE', compare: 'last_week', format: { preset: 'arrows' }, view: { columns: [], chart: 'line', expandDepth: 1 } }, 'tpl_owner_weekly', nowIso),
    saved('sr_controls_staff', 'الخصومات والإلغاءات حسب الموظف', 'مين عمل خصومات وإلغاءات وبكام، عشان المتابعة اليومية للمحاسب.', 'controls', 'u_accountant', { mode: 'ROLES', roles: ['role_manager', 'role_accountant'] },
      { metrics: ['discount_amount', 'discount_count', 'void_value', 'void_line_count'], rows: ['staff'], period: { preset: 'LAST_7' }, branches: 'DEVICE', format: { preset: 'topbottom', measure: 'void_value' }, view: { columns: [], chart: 'bars', expandDepth: 1 } }, 'tpl_accountant_a4', nowIso),
  ];
}
/** The studio state, created on first use (old browsers' saved demo data get the seeds too). */
export function studioOf(db: DB, nowIso: string): StudioState {
  const s = ((db as any).reportStudio ??= { saved: seedSaved(nowIso), templates: seedTemplates(nowIso), audit: [], favourites: { u_owner: ['eod_bridge', 'sr_branch_channel'] }, recent: {}, outputs: [] }) as StudioState;
  s.outputs ??= []; s.audit ??= []; s.favourites ??= {}; s.recent ??= {};
  return s;
}
