// External systems are simulated: printers, kitchen screen delivery, the e-receipt platform, network faults.
// Shown in plain words ("واقعة", "الورق خلص"); the raw states and operation ids only with technical details on.
import React, { useSyncExternalStore } from 'react';
import { Radio } from 'lucide-react';
import { Popover } from './Popover';
import { sim } from '../mock/sim';
import { store } from '../mock/store';
import { demo } from '../mock/demo';
import { Pill, Select } from '../ui';
import { useTech } from '../app/tech';
import { t } from '../i18n';
import { cn } from '../lib/format';
import { deviceName } from './people';

const STATE: Record<string, string> = { UP: 'شغالة', DOWN: 'واقعة', SLOW: 'بطيئة', REJECT: 'بترفض الإيصالات', TIMEOUT: 'مش بترد', PAPER_OUT: 'الورق خلص' };
const DROP_OPS: [string, string][] = [['Payment.Capture', 'الدفع'], ['Order.Fire', 'الإرسال للمطبخ'], ['Order.Confirm', 'تأكيد الشيك'], ['Order.Complete', 'قفل الشيك'], ['Order.AddLines', 'إضافة أصناف'], ['TableVisit.Open', 'فتح ترابيزة'], ['Session.Close', 'قفل الوردية'], ['Refund.Approve', 'اعتماد المرتجع']];

export function Simulators() {
  const s = useSyncExternalStore(sim.subscribe, sim.get);
  const tech = useTech();
  const bad = s.kds !== 'UP' || s.eta !== 'UP' || Object.values(s.printers).some((p) => p !== 'UP') || s.dropNextResponse || s.offlineNext;
  const set = (p: Partial<typeof s>) => { sim.set(p); setTimeout(() => demo.tick(), 0); };
  const Opt = ({ v, cur, on }: { v: string; cur: string; on: () => void }) => (
    <button onClick={on} className={cn('px-2 h-7 rounded-lg text-[11px] border', cur === v ? (v === 'UP' ? 'bg-[var(--success)] text-white border-transparent font-bold' : 'bg-[var(--error)] text-white border-transparent font-bold') : 'surface-2 border-[var(--glass-border)] text-soft')}>
      {t(STATE[v] ?? v)}{tech && <span className="num opacity-70 ms-1 text-[9px]">{v}</span>}
    </button>
  );
  return (
    <Popover title={t('محاكاة الأعطال: وقّع الطابعة أو شاشة المطبخ أو منظومة الضرايب أو الشبكة، وشوف إن البيع بيكمل')} width={400} button={(o) => (
      <button data-fb="chrome:simulators" className={cn('h-8 px-2 rounded-lg border flex items-center gap-1.5 text-xs whitespace-nowrap', bad ? 'border-[var(--error)] text-[var(--error)]' : 'border-[var(--glass-border)] surface-1 text-soft', o && 'bg-[var(--primary-container)]')}><Radio className="w-4 h-4" /><span className="hidden min-[2000px]:inline">{bad ? t('في عطل شغال') : t('محاكاة الأعطال')}</span></button>
    )}>
      <div className="space-y-3 text-sm">
        <div className="font-bold">{t('محاكاة الأعطال')}</div>
        <div className="text-[11px] text-dim">{t('مفيش شبكة حقيقية ولا دفع حقيقي ولا منظومة ضرايب حقيقية. الطباعة والمطبخ والإيصال الإلكتروني بيحصلوا بعد ما البيع يتحفظ، ووقوعهم عمره ما يوقف البيع.')}</div>
        <div className="space-y-1"><div className="text-xs font-bold">{t('توصيل الطلبات لشاشة المطبخ')}</div><div className="flex gap-1">{(['UP', 'DOWN', 'SLOW'] as const).map((v) => <Opt key={v} v={v} cur={s.kds} on={() => set({ kds: v })} />)}</div></div>
        <div className="space-y-1"><div className="text-xs font-bold">{t('منظومة الإيصال الإلكتروني (الضرايب)')}</div><div className="flex gap-1 flex-wrap">{(['UP', 'DOWN', 'REJECT', 'TIMEOUT'] as const).map((v) => <Opt key={v} v={v} cur={s.eta} on={() => set({ eta: v })} />)}</div></div>
        <div className="space-y-1"><div className="text-xs font-bold">{t('الطابعات')}</div>
          {store.db.terminals.filter((x) => x.kind !== 'KDS').map((term) => (
            <div key={term.id} className="flex items-center justify-between gap-2"><span className="text-xs">{t('طابعة {d}', { d: deviceName(term.id, term.kind, term.name) })}{tech && <span className="num text-[9px] text-dim ms-1">{term.code}</span>}</span><div className="flex gap-1">{(['UP', 'DOWN', 'PAPER_OUT'] as const).map((v) => <Opt key={v} v={v} cur={sim.printer(term.id)} on={() => set({ printers: { ...s.printers, [term.id]: v } })} />)}</div></div>
          ))}
        </div>
        <div className="space-y-1"><div className="text-xs font-bold">{t('الشبكة')}</div>
          <div className="flex items-center gap-2"><span className="text-xs shrink-0">{t('ضيّع الرد على')}:</span>
            <Select value={s.dropNextResponse ?? ''} onChange={(e) => set({ dropNextResponse: e.target.value || null })} options={[{ value: '', label: t('ولا حاجة') }, ...DROP_OPS.map(([x, l]) => ({ value: x, label: tech ? `${t(l)} (${x})` : t(l) }))]} className="!py-1 text-xs" />
          </div>
          <div className="text-[10px] text-dim">{t('الحركة الجاية من النوع ده هتتنفذ بس ردها هيضيع — هتشوف «النتيجة مش معروفة» وزرار «إعادة المحاولة».')}</div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={s.offlineNext} onChange={(e) => set({ offlineNext: e.target.checked })} />{t('الحركة الجاية تفشل قبل ما توصل (مفيش حاجة هتتسجل)')}</label>
          <div className="flex items-center gap-2 text-xs">{t('بطء الشبكة')}: <input type="range" min={0} max={1500} step={20} value={s.latencyMs} onChange={(e) => set({ latencyMs: Number(e.target.value) })} /><span className="num">{s.latencyMs === 0 ? t('سريعة') : t('{n} مللي ثانية', { n: s.latencyMs })}</span></div>
        </div>
        {bad && <Pill tone="error">{t('في عطل شغال دلوقتي')}</Pill>}
      </div>
    </Popover>
  );
}
