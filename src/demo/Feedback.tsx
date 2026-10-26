// Feedback mode (03_DIRECTION §3): click any element, leave a comment; export as feedback.json
// with the policy snapshot the expert was looking at.
import { saveFile } from '../lib/files';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, Trash2, Upload, Copy, MessageSquarePlus } from 'lucide-react';
import { Modal, Button, Field, Input, Select, Textarea, Pill, Empty, toast } from '../ui';
import { POLICIES } from '../mock/policyRegistry';
import { demo } from '../mock/demo';
import { clock } from '../mock/clock';
import { t } from '../i18n';

export interface FeedbackItem { id: string; screen: string; element: string; type: 'wrong' | 'missing' | 'unclear' | 'extra'; text: string; expert: string; role: string; device?: string; policy_snapshot: Record<string, unknown>; at: string; mockClock?: string }
const KEY = 'nerdpos.feedback.v1';
const PKEY = 'nerdpos.feedback.expert';
interface State { mode: boolean; items: FeedbackItem[] }
let st: State = { mode: false, items: (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } })() };
const ls = new Set<() => void>();
const emit = () => { st = { ...st }; try { localStorage.setItem(KEY, JSON.stringify(st.items)); } catch { /* ignore */ } ls.forEach((f) => f()); };
export const feedback = {
  setMode(v: boolean) { st.mode = v; emit(); },
  add(i: FeedbackItem) { st.items = [i, ...st.items]; emit(); },
  remove(id: string) { st.items = st.items.filter((x) => x.id !== id); emit(); },
  replace(items: FeedbackItem[]) { st.items = items; emit(); },
};
export function useFeedback() { return useSyncExternalStore((cb) => { ls.add(cb); return () => ls.delete(cb); }, () => st); }

export function policySnapshot() {
  const out: Record<string, unknown> = {};
  for (const p of POLICIES) out[p.id] = demo.policy(p.id, { branchId: 'branch_main' });
  return out;
}

function describe(el: HTMLElement): string {
  const tagged = el.closest('[data-fb]') as HTMLElement | null;
  const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const tag = el.tagName.toLowerCase();
  return [tagged?.dataset.fb, `${tag}${text ? `: "${text}"` : ''}`].filter(Boolean).join(' › ');
}

export function FeedbackLayer() {
  const s = useFeedback();
  const [target, setTarget] = useState<{ screen: string; element: string; device: string } | null>(null);
  useEffect(() => {
    if (!s.mode) return;
    let last: HTMLElement | null = null;
    const over = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-chrome]') || el.closest('[data-fb-dialog]')) return;
      last?.removeAttribute('data-fb-hover');
      el.setAttribute('data-fb-hover', '');
      last = el;
    };
    const click = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-chrome]') || el.closest('[data-fb-dialog]')) return;
      e.preventDefault();
      e.stopPropagation();
      const screen = (el.closest('[data-screen]') as HTMLElement | null)?.dataset.screen ?? (el.closest('[data-demo-chrome]') ? 'DEMO' : 'APP');
      const device = (el.closest('[data-device]') as HTMLElement | null)?.dataset.device ?? '';
      setTarget({ screen, element: describe(el), device });
    };
    document.addEventListener('mouseover', over, true);
    document.addEventListener('click', click, true);
    return () => { document.removeEventListener('mouseover', over, true); document.removeEventListener('click', click, true); last?.removeAttribute('data-fb-hover'); };
  }, [s.mode]);
  return target ? <CommentBox target={target} onClose={() => setTarget(null)} /> : null;
}

function CommentBox({ target, onClose }: { target: { screen: string; element: string; device: string }; onClose: () => void }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(PKEY) ?? '{}'); } catch { return {}; } })();
  const [type, setType] = useState<FeedbackItem['type']>('missing');
  const [text, setText] = useState('');
  const [expert, setExpert] = useState(saved.expert ?? '');
  const [role, setRole] = useState(saved.role ?? '');
  const [element, setElement] = useState(target.element);
  const save = () => {
    try { localStorage.setItem(PKEY, JSON.stringify({ expert, role })); } catch { /* ignore */ }
    feedback.add({ id: `fb_${Date.now()}`, screen: target.screen, element, type, text, expert, role, device: target.device, policy_snapshot: policySnapshot(), at: new Date().toISOString(), mockClock: clock.iso() });
    toast('success', t('الملاحظة اتسجلت'));
    onClose();
  };
  return (
    <div data-fb-dialog>
      <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><MessageSquarePlus className="w-5 h-5 text-pink-400" />{t('ملاحظة جديدة')}</span>} footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" disabled={!text.trim()} onClick={save}>{t('حفظ')}</Button></>}>
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap"><Pill tone="primary">{t('الشاشة')}: {target.screen}</Pill>{target.device && <Pill tone="neutral">{t('الجهاز')}: {target.device}</Pill>}</div>
          <Field label={t('العنصر')}><Input value={element} onChange={(e) => setElement(e.target.value)} /></Field>
          <Field label={t('النوع')}>
            <div className="flex gap-1 flex-wrap">{(['wrong', 'missing', 'unclear', 'extra'] as const).map((k) => <Button key={k} size="sm" variant={type === k ? 'primary' : 'secondary'} onClick={() => setType(k)}>{{ wrong: t('غلط'), missing: t('ناقص'), unclear: t('مش واضح'), extra: t('زيادة') }[k]}</Button>)}</div>
          </Field>
          <Field label={t('الملاحظة')}><Textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder={t('اكتب اللي شايفه…')} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('اسمك')}><Input value={expert} onChange={(e) => setExpert(e.target.value)} /></Field>
            <Field label={t('دورك')}><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder={t('مثلًا: مدير مطعم، محاسب ضرايب')} /></Field>
          </div>
          <div className="text-[11px] text-dim">{t('هيتسجل معاها لقطة من كل الإعدادات الحالية (policy_snapshot).')}</div>
        </div>
      </Modal>
    </div>
  );
}

export function FeedbackPanel() {
  const s = useFeedback();
  const [filter, setFilter] = useState('');
  const items = s.items.filter((i) => !filter || i.type === filter);
  const json = () => JSON.stringify(s.items.map(({ id, device, mockClock, ...rest }) => ({ ...rest, device, mockClock })), null, 2);
  const download = () => {
    saveFile('feedback.json', json(), 'application/json').then((ok) => ok && toast('success', t('feedback.json اتحفظ'))).catch(() => copy());
  };
  const copy = async () => { try { await navigator.clipboard.writeText(json()); toast('success', t('اتنسخ JSON')); } catch { toast('error', t('النسخ مش متاح في المتصفح ده')); } };
  const importFile = (f: File) => f.text().then((txt) => { const arr = JSON.parse(txt); if (Array.isArray(arr)) { feedback.replace([...arr.map((x: any, i: number) => ({ id: `fb_i_${i}_${Date.now()}`, ...x })), ...s.items]); toast('success', t('اتضافت {n} ملاحظة', { n: arr.length })); } }).catch(() => toast('error', t('ملف مش صالح')));
  return (
    <div className="flex flex-col h-full" data-screen="FEEDBACK">
      <div className="px-4 py-3 border-b line">
        <div className="font-bold">{t('الملاحظات')} <span className="text-dim font-normal">({s.items.length})</span></div>
        <div className="text-[11px] text-dim">{t('شغّل "وضع الملاحظات" واضغط على أي حاجة في الشاشة.')}</div>
        <div className="flex gap-2 mt-2 flex-wrap">
          <Button size="sm" variant="primary" onClick={download} disabled={!s.items.length}><Download className="w-4 h-4" />feedback.json</Button>
          <Button size="sm" onClick={copy} disabled={!s.items.length}><Copy className="w-4 h-4" />{t('نسخ')}</Button>
          <label className="h-8 px-3 rounded-xl surface-2 border border-[var(--glass-border)] text-xs flex items-center gap-1 cursor-pointer"><Upload className="w-4 h-4" />{t('استيراد')}<input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} options={[{ value: '', label: t('الكل') }, { value: 'wrong', label: t('غلط') }, { value: 'missing', label: t('ناقص') }, { value: 'unclear', label: t('مش واضح') }, { value: 'extra', label: t('زيادة') }]} className="max-w-[120px] !py-1 text-xs" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 && <Empty text={t('مفيش ملاحظات لسه')} />}
        {items.map((i) => (
          <div key={i.id} className="rounded-xl surface-1 border line p-3 text-sm space-y-1">
            <div className="flex items-center justify-between gap-2"><div className="flex gap-1 flex-wrap"><Pill tone={i.type === 'wrong' ? 'error' : i.type === 'missing' ? 'warning' : i.type === 'unclear' ? 'info' : 'neutral'}>{{ wrong: t('غلط'), missing: t('ناقص'), unclear: t('مش واضح'), extra: t('زيادة') }[i.type]}</Pill><Pill tone="primary">{i.screen}</Pill></div><button onClick={() => feedback.remove(i.id)} className="text-dim hover:text-[var(--error)]"><Trash2 className="w-4 h-4" /></button></div>
            <div className="text-[11px] text-dim break-words">{i.element}</div>
            <div>{i.text}</div>
            <div className="text-[11px] text-dim">{i.expert}{i.role ? ` · ${i.role}` : ''} · {new Date(i.at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
