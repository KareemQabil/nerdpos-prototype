// «مراجعة الخبير» inside each report: research §9 checklist with what the engine does today, sign-off per role
// (operations / accountant / auditor) with comments. Stored per viewer in localStorage; exported with feedback.json.
import React, { useSyncExternalStore, useState } from 'react';
import { ClipboardCheck, Check, X, HelpCircle, UserCheck } from 'lucide-react';
import { Card, Button, Pill, Textarea, SegmentedControl, Input } from '../../ui';
import { t, L } from '../../i18n';
import { cn } from '../../lib/format';

type Role = 'operations' | 'accountant' | 'auditor';
type Verdict = 'OK' | 'WRONG' | 'QUESTION';
export interface ExpertReviewRec { reportId: string; reportTitle: string; reviewer: string; role: Role; items: Record<string, { verdict: Verdict; note: string }>; signedOff: boolean; comment: string; updatedAt: string }
const KEY = 'nerdpos.expertReview.v1';
let state: ExpertReviewRec[] = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } })();
const ls = new Set<() => void>();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } ls.forEach((f) => f()); };
export const expertReviews = { all: () => state, subscribe: (f: () => void) => { ls.add(f); return () => ls.delete(f); } };
const ROLE_LABEL: Record<Role, string> = { operations: 'خبير تشغيل', accountant: 'محاسب', auditor: 'مراجع' };

export function ExpertReview({ reportId, reportTitle, checklist }: { reportId: string; reportTitle: string; checklist: any[] }) {
  const all = useSyncExternalStore(expertReviews.subscribe, expertReviews.all);
  const [role, setRole] = useState<Role>('accountant');
  const [reviewer, setReviewer] = useState(() => { try { return localStorage.getItem('nerdpos.expertReview.name') ?? ''; } catch { return ''; } });
  const rec = all.find((r) => r.reportId === reportId && r.role === role) ?? { reportId, reportTitle, reviewer, role, items: {}, signedOff: false, comment: '', updatedAt: '' };
  const update = (patch: Partial<ExpertReviewRec>) => {
    const next = { ...rec, ...patch, reviewer, reportTitle, updatedAt: new Date().toISOString() };
    state = [...state.filter((r) => !(r.reportId === reportId && r.role === role)), next];
    try { localStorage.setItem('nerdpos.expertReview.name', reviewer); } catch { /* ignore */ }
    save();
  };
  const items = checklist.filter((c) => c.roles.includes(role));
  const done = items.filter((c) => rec.items[c.id]).length;
  const others = all.filter((r) => r.reportId === reportId && r.signedOff);
  return (
    <Card title={<span className="flex items-center gap-2"><ClipboardCheck className="w-4 h-4" />{t('مراجعة الخبير')}</span>} description={t('اقرا كل بند وإزاي المحرك بيعمله دلوقتي، وقول: صح / غلط / عندي سؤال. التوقيع والملاحظات بتتحفظ على الجهاز ده وبتنزل مع ملف الملاحظات.')} data-fb="expert-review"
      actions={<div className="flex gap-1">{others.map((r) => <Pill key={r.role} tone="success" size="sm"><UserCheck className="w-3 h-3 inline me-0.5" />{t(ROLE_LABEL[r.role])}</Pill>)}</div>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <SegmentedControl size="sm" value={role} onChange={setRole} options={(['operations', 'accountant', 'auditor'] as Role[]).map((r) => ({ id: r, label: t(ROLE_LABEL[r]), fb: `expert-role:${r}` }))} />
          <Input className="w-48" placeholder={t('اسمك')} value={reviewer} onChange={(e) => setReviewer(e.target.value)} data-fb="expert-name" />
          <span className="text-xs text-dim num">{done}/{items.length}</span>
        </div>
        {items.map((c) => {
          const v = rec.items[c.id];
          return (
            <div key={c.id} className={cn('rounded-lg surface-1 p-2.5 space-y-1.5', v?.verdict === 'WRONG' && 'border border-[var(--error)]', v?.verdict === 'OK' && 'border border-[var(--success)]/50')}>
              <div className="font-bold text-sm">{L(c.question)}</div>
              <div className="text-xs text-soft"><span className="text-dim">{t('المحرك دلوقتي')}:</span> {L(c.engine)}</div>
              <div className="flex gap-1.5 flex-wrap items-center">
                {([['OK', 'صح', Check, 'success'], ['WRONG', 'غلط', X, 'danger'], ['QUESTION', 'عندي سؤال', HelpCircle, 'warning']] as const).map(([k, label, Icon, variant]) => (
                  <Button key={k} size="sm" variant={v?.verdict === k ? (variant as any) : 'ghost'} onClick={() => update({ items: { ...rec.items, [c.id]: { verdict: k, note: v?.note ?? '' } } })} data-fb={`expert:${c.id}:${k}`}><Icon className="w-3.5 h-3.5" />{t(label)}</Button>
                ))}
                {v && v.verdict !== 'OK' && <Input className="flex-1 min-w-48" placeholder={t('اكتب الملاحظة أو السؤال')} value={v.note} onChange={(e) => update({ items: { ...rec.items, [c.id]: { ...v, note: e.target.value } } })} />}
              </div>
            </div>
          );
        })}
        <Textarea rows={2} placeholder={t('تعليق عام على التقرير (اختياري)')} value={rec.comment} onChange={(e) => update({ comment: e.target.value })} data-fb="expert-comment" />
        <div className="flex items-center gap-2">
          <Button variant={rec.signedOff ? 'success' : 'primary'} size="sm" disabled={!reviewer.trim() || done < items.length} onClick={() => update({ signedOff: !rec.signedOff })} data-fb="expert-signoff">
            <UserCheck className="w-4 h-4" />{rec.signedOff ? t('اتوقّع — دوس للإلغاء') : t('أوقّع كـ{r}', { r: t(ROLE_LABEL[role]) })}
          </Button>
          {(!reviewer.trim() || done < items.length) && <span className="text-xs text-dim">{t('اكتب اسمك وراجع كل البنود الأول.')}</span>}
          {rec.updatedAt && <span className="text-[11px] text-dim">{t('اتحفظ')}</span>}
        </div>
      </div>
    </Card>
  );
}
