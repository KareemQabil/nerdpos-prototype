// Feedback mode (03_DIRECTION §3): click any element, leave a comment; export as feedback.json
// with the policy snapshot the expert was looking at.
import { saveFile } from '../lib/files';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, Trash2, Upload, Copy, MessageSquarePlus } from 'lucide-react';
import { Modal, Button, Field, Input, Select, Textarea, Pill, Empty, EmptyState, toast } from '../ui';
import { POLICIES } from '../mock/policyRegistry';
import { demo } from '../mock/demo';
import { clock } from '../mock/clock';
import { t, L } from '../i18n';
import { SCREENS } from '../app/registry';
import { Tech, useTech } from '../app/tech';
import { deviceName } from './people';

// Plain names for the screen tags the feedback layer reads from the DOM (data-screen).
const DEMO_SCREENS: Record<string, string> = { POLICY_PANEL: 'إعدادات المطعم', WALKTHROUGH: 'رحلات بالخطوة', SCENARIOS: 'سيناريوهات الفشل', FEEDBACK: 'الملاحظات', SITUATIONS: 'المواقف', A1: 'شاشة الدخول', C5: 'موافقة المدير', WELCOME: 'شاشة الترحيب', DEMO: 'شريط التجربة', APP: 'التطبيق' };
export function screenName(code: string): string {
  if (DEMO_SCREENS[code]) return t(DEMO_SCREENS[code]);
  const s = SCREENS.find((x) => x.code === code || x.id === code);
  return s ? L({ ar: s.title, en: s.titleEn }) : code;
}
/** The visible text part of an element descriptor ("tag › button: \"ابعت\"" → "ابعت"). */
export function elementText(el: string): string {
  const m = el.match(/"([^"]+)"/);
  return m ? m[1] : el.split(' › ').at(-1)?.replace(/^[a-z0-9]+:?\s*/, '') || el;
}

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
  // The comment box is a portaled modal (outside the [data-fb-dialog] wrapper): while it is open, clicks inside any dialog belong to it.
  const open = React.useRef(false);
  open.current = !!target;
  useEffect(() => {
    if (!s.mode) return;
    let last: HTMLElement | null = null;
    const over = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-chrome]') || el.closest('[data-fb-dialog]') || (open.current && el.closest('[role="dialog"]'))) return;
      last?.removeAttribute('data-fb-hover');
      el.setAttribute('data-fb-hover', '');
      last = el;
    };
    const click = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-chrome]') || el.closest('[data-fb-dialog]') || (open.current && el.closest('[role="dialog"]'))) return;
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
  const tech = useTech();
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
          <div className="flex gap-2 flex-wrap"><Pill tone="primary">{t('الشاشة')}: {screenName(target.screen)}</Pill>{target.device && <Pill tone="neutral">{t('الجهاز')}: {deviceName(target.device)}</Pill>}</div>
          {tech ? <Field label={t('العنصر (للفريق)')}><Input value={element} onChange={(e) => setElement(e.target.value)} dir="ltr" /></Field> : <div className="text-sm"><span className="text-dim text-xs">{t('على')}: </span><b>«{elementText(element)}»</b></div>}
          <Field label={t('نوعها إيه')}>
            <div className="flex gap-1 flex-wrap">{(['wrong', 'missing', 'unclear', 'extra'] as const).map((k) => <Button key={k} size="sm" variant={type === k ? 'primary' : 'secondary'} onClick={() => setType(k)}>{{ wrong: t('غلط'), missing: t('ناقص'), unclear: t('مش واضح'), extra: t('زيادة') }[k]}</Button>)}</div>
          </Field>
          <Field label={t('ملاحظتك')}><Textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus placeholder={t('اكتب اللي شايفه… مثلًا: الزرار ده المفروض يطلب موافقة مدير')} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('اسمك')}><Input value={expert} onChange={(e) => setExpert(e.target.value)} /></Field>
            <Field label={t('دورك')}><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder={t('مثلًا: مدير مطعم، محاسب ضرايب')} /></Field>
          </div>
          <div className="text-[11px] text-dim">{t('هنحفظ معاها الشاشة والجهاز وإعدادات المطعم وقتها، عشان الفريق يفهم السياق.')}</div>
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
    saveFile('feedback.json', json(), 'application/json').then((ok) => ok && toast('success', t('ملف الملاحظات اتحفظ'))).catch(() => copy());
  };
  const copy = async () => { try { await navigator.clipboard.writeText(json()); toast('success', t('الملاحظات اتنسخت — الصقها في رسالة')); } catch { toast('error', t('النسخ مش متاح في المتصفح ده')); } };
  const importFile = (f: File) => f.text().then((txt) => { const arr = JSON.parse(txt); if (Array.isArray(arr)) { feedback.replace([...arr.map((x: any, i: number) => ({ id: `fb_i_${i}_${Date.now()}`, ...x })), ...s.items]); toast('success', t('اتضافت {n} ملاحظة', { n: arr.length })); } }).catch(() => toast('error', t('ملف مش صالح')));
  return (
    <div className="flex flex-col h-full" data-screen="FEEDBACK">
      <div className="px-4 py-3 border-b line">
        <div className="font-bold">{t('ملاحظاتي')} <span className="text-dim font-normal">({s.items.length})</span></div>
        <div className="text-[11px] text-dim">{t('شغّل «ملاحظة» من الشريط اللي فوق واضغط على أي حاجة في الشاشة. لما تخلص، نزّل الملف وابعته للفريق.')}</div>
        <div className="flex gap-2 mt-2 flex-wrap">
          <Button size="sm" variant="primary" onClick={download} disabled={!s.items.length}><Download className="w-4 h-4" />{t('نزّل الملاحظات')}<Tech><span className="num text-[10px] opacity-70">feedback.json</span></Tech></Button>
          <Button size="sm" onClick={copy} disabled={!s.items.length}><Copy className="w-4 h-4" />{t('نسخ')}</Button>
          <label className="h-8 px-3 rounded-xl surface-2 border border-[var(--glass-border)] text-xs flex items-center gap-1 cursor-pointer"><Upload className="w-4 h-4" />{t('افتح ملف ملاحظات')}<input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} options={[{ value: '', label: t('الكل') }, { value: 'wrong', label: t('غلط') }, { value: 'missing', label: t('ناقص') }, { value: 'unclear', label: t('مش واضح') }, { value: 'extra', label: t('زيادة') }]} className="max-w-[120px] !py-1 text-xs" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 && <EmptyState icon={<MessageSquarePlus />} title={t('مفيش ملاحظات لسه')} text={t('شغّل «ملاحظة» واضغط على أي حاجة في الشاشة عشان تكتب رأيك فيها.')} action={<Button size="sm" variant="subtle" onClick={() => feedback.setMode(true)} data-fb="feedback-start"><MessageSquarePlus className="w-4 h-4" />{t('ابدأ ملاحظة')}</Button>} />}
        {items.map((i) => (
          <div key={i.id} className="rounded-xl surface-1 border line p-3 text-sm space-y-1">
            <div className="flex items-center justify-between gap-2"><div className="flex gap-1 flex-wrap"><Pill tone={i.type === 'wrong' ? 'error' : i.type === 'missing' ? 'warning' : i.type === 'unclear' ? 'info' : 'neutral'}>{{ wrong: t('غلط'), missing: t('ناقص'), unclear: t('مش واضح'), extra: t('زيادة') }[i.type]}</Pill><Pill tone="primary">{screenName(i.screen)}</Pill></div><button onClick={() => feedback.remove(i.id)} className="text-dim hover:text-[var(--error)]"><Trash2 className="w-4 h-4" /></button></div>
            <div className="text-[11px] text-dim break-words">{t('على')}: «{elementText(i.element)}»{i.device ? ` · ${deviceName(i.device)}` : ''}</div>
            <Tech><div className="text-[10px] text-dim break-words num" dir="ltr">{i.element}</div></Tech>
            <div>{i.text}</div>
            <div className="text-[11px] text-dim">{i.expert}{i.role ? ` · ${i.role}` : ''} · {new Date(i.at).toLocaleString('ar-EG-u-nu-latn')}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
