// External systems are simulated: printers, kitchen screen delivery, the e-receipt platform, network faults.
import React, { useSyncExternalStore } from 'react';
import { Radio } from 'lucide-react';
import { Popover } from './Popover';
import { sim } from '../mock/sim';
import { store } from '../mock/store';
import { demo } from '../mock/demo';
import { Pill, Select } from '../ui';
import { t } from '../i18n';
import { cn } from '../lib/format';

export function Simulators() {
  const s = useSyncExternalStore(sim.subscribe, sim.get);
  const bad = s.kds !== 'UP' || s.eta !== 'UP' || Object.values(s.printers).some((p) => p !== 'UP') || s.dropNextResponse || s.offlineNext;
  const set = (p: Partial<typeof s>) => { sim.set(p); setTimeout(() => demo.tick(), 0); };
  const Opt = ({ v, cur, on }: { v: string; cur: string; on: () => void }) => <button onClick={on} className={cn('px-2 h-7 rounded-lg text-[11px] num border', cur === v ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-2 border-[var(--glass-border)]')}>{v}</button>;
  return (
    <Popover title={t('الأنظمة الخارجية (محاكاة)')} width={380} button={(o) => (
      <button className={cn('h-8 px-2 rounded-lg border flex items-center gap-1.5 text-xs', bad ? 'border-[var(--error)] text-[var(--error)]' : 'border-[var(--glass-border)] surface-1 text-soft', o && 'bg-[var(--primary-container)]')}><Radio className="w-4 h-4" /><span className="hidden lg:inline">{t('المحاكاة')}</span></button>
    )}>
      <div className="space-y-3 text-sm">
        <div className="font-bold">{t('الأنظمة الخارجية (محاكاة)')}</div>
        <div className="text-[11px] text-dim">{t('مفيش شبكة حقيقية ولا دفع حقيقي ولا منصة ضرايب حقيقية. الطباعة والمطبخ والإيصال الإلكتروني بيحصلوا بعد ما البيع يتحفظ، وفشلهم عمره ما يوقف البيع.')}</div>
        <div className="space-y-1"><div className="text-xs font-bold">{t('شاشة المطبخ / توصيل الجولات')}</div><div className="flex gap-1">{(['UP', 'DOWN', 'SLOW'] as const).map((v) => <Opt key={v} v={v} cur={s.kds} on={() => set({ kds: v })} />)}</div></div>
        <div className="space-y-1"><div className="text-xs font-bold">{t('منصة الإيصال الإلكتروني (ETA)')}</div><div className="flex gap-1">{(['UP', 'DOWN', 'REJECT', 'TIMEOUT'] as const).map((v) => <Opt key={v} v={v} cur={s.eta} on={() => set({ eta: v })} />)}</div></div>
        <div className="space-y-1"><div className="text-xs font-bold">{t('الطابعات')}</div>
          {store.db.terminals.filter((x) => x.kind !== 'KDS').map((term) => (
            <div key={term.id} className="flex items-center justify-between gap-2"><span className="text-xs num">{term.code}</span><div className="flex gap-1">{(['UP', 'DOWN', 'PAPER_OUT'] as const).map((v) => <Opt key={v} v={v} cur={sim.printer(term.id)} on={() => set({ printers: { ...s.printers, [term.id]: v } })} />)}</div></div>
          ))}
        </div>
        <div className="space-y-1"><div className="text-xs font-bold">{t('الشبكة')}</div>
          <div className="flex items-center gap-2"><span className="text-xs">{t('ضيّع رد الأمر الجاي')}:</span>
            <Select value={s.dropNextResponse ?? ''} onChange={(e) => set({ dropNextResponse: e.target.value || null })} options={[{ value: '', label: '—' }, ...['Payment.Capture', 'Order.Fire', 'Order.Confirm', 'Order.Complete', 'Order.AddLines', 'TableVisit.Open', 'Session.Close', 'Refund.Approve'].map((x) => ({ value: x, label: x }))]} className="!py-1 text-xs num" />
          </div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={s.offlineNext} onChange={(e) => set({ offlineNext: e.target.checked })} />{t('الأمر الجاي يفشل قبل ما يوصل السيرفر (مفيش حاجة تتكتب)')}</label>
          <div className="flex items-center gap-2 text-xs">{t('زمن الرد')}: <input type="range" min={0} max={1500} step={20} value={s.latencyMs} onChange={(e) => set({ latencyMs: Number(e.target.value) })} /><span className="num">{s.latencyMs}ms</span></div>
        </div>
        {bad && <Pill tone="error">{t('في نظام خارجي متعطل دلوقتي')}</Pill>}
      </div>
    </Popover>
  );
}
