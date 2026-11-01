// «احفظ»: one dialog — name, short description, topic and who can see it (and whether they can edit). Versions and the
// report's activity (runs, exports, edits) are tucked into a history drawer: compare any version with the current
// one in plain words, or bring it back as a new version.
import React, { useEffect, useState } from 'react';
import { Save, History, RotateCcw, GitCompare, Lock, Users, Globe2 } from 'lucide-react';
import { useQuery, useCommand } from '../../../app/hooks';
import { Modal, Button, Field, Input, Textarea, Select, SegmentedControl, Switch, Drawer, Timeline, Pill, Spinner, Banner } from '../../../ui';
import { t, L } from '../../../i18n';
import { dateTime } from '../../../lib/format';
import { REPORT_CATEGORIES, type ReportDesign, type Audience } from '../../../reports/studio';
import { useRegistry, periodText, lang, type Registry } from './common';
import { rangeText } from '../../../reports/format';

export type ShareMode = 'ME' | 'MANAGERS' | 'EVERYONE';
const toAudience = (m: ShareMode): Audience => (m === 'ME' ? { mode: 'ME' } : m === 'MANAGERS' ? { mode: 'ROLES', roles: ['role_manager', 'role_accountant'] } : { mode: 'EVERYONE' });
export const shareOf = (a?: Audience): ShareMode => (!a || a.mode === 'ME' ? 'ME' : a.mode === 'EVERYONE' ? 'EVERYONE' : 'MANAGERS');
export const shareText = (a?: Audience) => ({ ME: t('أنا بس'), MANAGERS: t('المديرين والمحاسب'), EVERYONE: t('كل اللي بيشوف التقارير') })[shareOf(a)];

export function SaveDialog({ open, onClose, initial, existing, design, templateId, onSaved }: {
  open: boolean; onClose: () => void; design: ReportDesign; templateId: string | null;
  initial: { name: string; description: string; category: string; view?: Audience; edit?: 'OWNER' | 'VIEWERS'; basedOn?: string | null };
  existing: { id: string; version: number; canEdit: boolean; canShare: boolean } | null; onSaved: (r: any) => void;
}) {
  const { run, busy } = useCommand();
  const asCopy = !!existing && !existing.canEdit;
  const [name, setName] = useState(initial.name);
  const [desc, setDesc] = useState(initial.description);
  const [cat, setCat] = useState(initial.category || 'sales');
  const [share, setShare] = useState<ShareMode>(shareOf(initial.view));
  const [editors, setEditors] = useState(initial.edit === 'VIEWERS');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setName(asCopy ? `${initial.name} (${t('نسختي')})` : initial.name); setDesc(initial.description); setCat(initial.category || 'sales'); setShare(asCopy ? 'ME' : shareOf(initial.view)); setEditors(initial.edit === 'VIEWERS'); setNote(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const canShare = !existing || existing.canShare || asCopy;
  const save = async () => {
    const body: any = { name: name.trim(), description: desc.trim(), category: cat, design, templateId, view: toAudience(share), edit: editors && share !== 'ME' ? 'VIEWERS' : 'OWNER', note: note.trim() || undefined };
    if (existing && !asCopy) { body.id = existing.id; body.expectedVersion = existing.version; if (!existing.canShare) { delete body.view; delete body.edit; } }
    if (asCopy || (!existing && initial.basedOn)) body.basedOn = existing?.id ?? initial.basedOn;
    const r = await run('SavedReport.Save', { body }, { success: existing && !asCopy ? t('التقرير اتحفظ — نسخة {v}', { v: existing.version + 1 }) : t('التقرير اتحفظ في «تقاريري»') });
    if (r) { onSaved(r); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title={existing && !asCopy ? t('احفظ التعديلات') : t('احفظ التقرير')} description={asCopy ? t('التقرير ده مش بتاعك — هنحفظ نسخة ليك تقدر تعدّل فيها براحتك.') : t('هيظهر في «تقاريري» وتقدر تفتحه أو تبعته في أي وقت. كل حفظ بيعمل نسخة جديدة وتقدر ترجع لأي نسخة.')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={name.trim().length < 2} onClick={save} data-fb="save:confirm"><Save className="w-4 h-4" />{t('احفظ')}</Button></>}>
      <div className="space-y-3" data-fb="save-dialog">
        <Field label={t('اسم التقرير')} required><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} data-fb="save:name" /></Field>
        <Field label={t('وصف قصير (اختياري)')}><Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t('مثلاً: بيوريني مبيعات كل فرع حسب القناة كل أسبوع')} data-fb="save:desc" /></Field>
        <Field label={t('الموضوع')}><Select value={cat} onChange={(e) => setCat(e.target.value)} options={Object.entries(REPORT_CATEGORIES).map(([k, v]) => ({ value: k, label: L(v) }))} data-fb="save:category" /></Field>
        <Field label={t('مين يشوفه؟')} hint={!canShare ? t('صاحب التقرير بس هو اللي يغيّر مين يشوفه.') : undefined}>
          <SegmentedControl full size="sm" value={share} onChange={(v) => canShare && setShare(v)} options={[{ id: 'ME', label: t('أنا بس'), icon: <Lock className="w-3.5 h-3.5" />, fb: 'save:share-me', disabled: !canShare }, { id: 'MANAGERS', label: t('المديرين والمحاسب'), icon: <Users className="w-3.5 h-3.5" />, fb: 'save:share-managers', disabled: !canShare }, { id: 'EVERYONE', label: t('الكل'), icon: <Globe2 className="w-3.5 h-3.5" />, fb: 'save:share-all', disabled: !canShare }]} />
        </Field>
        {share !== 'ME' && canShare && <Switch checked={editors} onChange={setEditors} label={t('اللي يشوفوه يقدروا يعدّلوه كمان')} />}
        {existing && !asCopy && <Field label={t('إيه اللي اتغير؟ (بيتكتب في السجل)')}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلاً: زودت المقارنة بالأسبوع اللي فات')} data-fb="save:note" /></Field>}
        <div className="text-[11px] text-dim">{t('الأرقام اللي في التقرير بتيجي من المحرك المعتمد بس — الحفظ بيحفظ الشكل والتقسيم والفترة، مش الأرقام.')}</div>
      </div>
    </Modal>
  );
}

/** Plain-words differences between two designs. */
export function describeDiff(reg: Registry, a: ReportDesign, b: ReportDesign): string[] {
  const out: string[] = [];
  const ml = (id: string) => L(reg.metric(id)?.label) || id; const dl = (id: string) => L(reg.dim(id)?.label) || id;
  const added = b.metrics.filter((m) => !a.metrics.includes(m)), removed = a.metrics.filter((m) => !b.metrics.includes(m));
  if (added.length) out.push(t('زوّدنا: {x}', { x: added.map(ml).join('، ') }));
  if (removed.length) out.push(t('شلنا: {x}', { x: removed.map(ml).join('، ') }));
  if (a.rows.join() !== b.rows.join()) out.push(t('التقسيم بقى: {x}', { x: b.rows.map(dl).join(' ← ') || t('من غير تقسيم') }));
  if (a.columns.join() !== b.columns.join()) out.push(t('الأعمدة بقت: {x}', { x: b.columns.map(dl).join('، ') || t('من غير أعمدة') }));
  if (JSON.stringify(a.period) !== JSON.stringify(b.period)) out.push(t('الفترة بقت: {x}', { x: periodText(b.period) }));
  if ((a.compare ?? null) !== (b.compare ?? null)) out.push(b.compare ? t('زوّدنا مقارنة') : t('شلنا المقارنة'));
  if (JSON.stringify(a.topN ?? null) !== JSON.stringify(b.topN ?? null)) out.push(b.topN ? t('بقى يعرض أعلى {n}', { n: b.topN.n }) : t('بقى يعرض كله'));
  if (JSON.stringify(a.format ?? {}) !== JSON.stringify(b.format ?? {})) out.push(t('غيّرنا الألوان'));
  if (JSON.stringify(a.calcs ?? []) !== JSON.stringify(b.calcs ?? [])) out.push(t('غيّرنا الأرقام المحسوبة'));
  if (JSON.stringify(a.filters ?? {}) !== JSON.stringify(b.filters ?? {}) || JSON.stringify(a.exclude ?? {}) !== JSON.stringify(b.exclude ?? {})) out.push(t('غيّرنا الفلاتر'));
  if (JSON.stringify(a.view.columns) !== JSON.stringify(b.view.columns)) out.push(t('غيّرنا شكل الأعمدة'));
  return out.length ? out : [t('مفيش فرق في الشكل')];
}

const ACTION: Record<string, () => string> = {
  RUN: () => t('فتح التقرير'), EXPORT: () => t('نزّل ملف'), SAVE: () => t('حفظ تعديل'), CREATE: () => t('عمل التقرير'), DUPLICATE: () => t('عمل نسخة'), SHARE: () => t('غيّر مين يشوفه'),
  DELETE: () => t('أرشف التقرير'), TEMPLATE_SAVE: () => t('عدّل قالب'), SCHEDULE_RUN: () => t('اتبعت أوتوماتيك'), RESTORE: () => t('رجّع نسخة قديمة'),
};
export const actionText = (a: string) => (ACTION[a] ?? (() => a))();

export function HistoryDrawer({ id, open, onClose, current, onRestored }: { id: string; open: boolean; onClose: () => void; current: ReportDesign; onRestored: (r: any) => void }) {
  const q = useQuery<any>(open ? 'SavedReport.Get' : null, { params: { savedReportId: id } });
  const reg = useRegistry();
  const { run, busy } = useCommand();
  const [cmp, setCmp] = useState<number | null>(null);
  const r = q.data;
  const versions = r?.versions ?? [];
  const restore = async (v: number) => {
    const res = await run('SavedReport.Restore', { params: { savedReportId: id }, body: { version: v, expectedVersion: r.version } }, { success: t('رجّعنا النسخة {v} — اتحفظت كنسخة جديدة', { v }) });
    if (res) { q.refetch(); onRestored(res); }
  };
  return (
    <Drawer open={open} onClose={onClose} width="lg" icon={<History className="w-5 h-5" />} title={t('السجل والنسخ')} description={t('كل حفظ نسخة. تقدر تقارن أي نسخة بالحالية أو ترجّعها (بتتحفظ كنسخة جديدة، ومفيش حاجة بتتمسح).')}>
      {q.loading && !r ? <Spinner /> : !r ? null : (
        <div className="space-y-5" data-fb="history-drawer">
          <div>
            <div className="text-sm font-bold mb-2">{t('النسخ')}</div>
            <div className="space-y-2">
              {versions.map((v: any) => (
                <div key={v.version} className="rounded-xl border border-[var(--glass-border)] p-3 space-y-1.5" data-fb={`version:${v.version}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Pill size="sm" tone={v.version === r.version ? 'success' : 'neutral'}>{t('نسخة {v}', { v: v.version })}</Pill>
                    {v.version === r.version && <span className="text-xs text-[var(--success)]">{t('الحالية')}</span>}
                    <span className="text-xs text-dim">{v.byName} · {dateTime(v.at)}</span>
                    <span className="flex-1" />
                    {v.version !== r.version && <Button size="sm" variant="ghost" onClick={() => setCmp(cmp === v.version ? null : v.version)} data-fb={`version-compare:${v.version}`}><GitCompare className="w-4 h-4" />{t('قارن بالحالية')}</Button>}
                    {v.version !== r.version && r.canEdit && <Button size="sm" variant="outline" loading={busy} onClick={() => restore(v.version)} data-fb={`version-restore:${v.version}`}><RotateCcw className="w-4 h-4" />{t('رجّعها')}</Button>}
                  </div>
                  <div className="text-sm">{v.note}</div>
                  {cmp === v.version && <VersionDiff id={id} version={v.version} current={current} reg={reg} />}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold mb-2">{t('مين عمل إيه')}</div>
            <Timeline items={(r.audit ?? []).map((a: any) => ({ id: a.id, title: <span>{a.userName || t('السيستم')} — {actionText(a.action)}{a.format ? ` (${a.format === 'XLSX' ? t('إكسل') : a.format})` : ''}</span>, time: dateTime(a.at), text: [a.params?.from ? rangeText(a.params.from, a.params.to ?? a.params.from, lang()) : '', a.rows !== null && a.rows !== undefined ? t('{n} سطر', { n: a.rows }) : '', a.params?.version ? t('نسخة {v}', { v: a.params.version }) : '', a.note ?? ''].filter(Boolean).join(' · ') }))} empty={<div className="text-sm text-dim">{t('لسه مفيش حركة على التقرير ده.')}</div>} />
          </div>
        </div>
      )}
    </Drawer>
  );
}
function VersionDiff({ id, version, current, reg }: { id: string; version: number; current: ReportDesign; reg: Registry }) {
  const q = useQuery<any>('SavedReport.Get', { params: { savedReportId: id }, query: { version: String(version) } });
  const snap = q.data?.snapshot;
  if (q.loading && !q.data) return <Spinner />;
  if (!snap) return <Banner tone="info">{t('مش قادرين نجيب النسخة دي دلوقتي.')}</Banner>;
  return <ul className="text-xs text-soft space-y-0.5 rounded-lg surface-1 p-2" data-fb="version-diff">{describeDiff(reg, snap.design, current).map((x, i) => <li key={i}>• {x}</li>)}</ul>;
}
