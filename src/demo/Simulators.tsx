// External systems are simulated: printers, kitchen screen delivery, the e-receipt platform, outside programs
// (accounting / delivery apps), and network faults per device.
// Shown in plain words ("واقعة", "الورق خلص"); the raw states and operation ids only with technical details on.
import React, { useSyncExternalStore } from 'react';
import { Radio, Wifi, WifiOff, Printer, ChefHat, Landmark, Plug, Network, RotateCcw } from 'lucide-react';
import { Popover } from './Popover';
import { sim } from '../mock/sim';
import { store } from '../mock/store';
import { demo } from '../mock/demo';
import { Pill, Select, Button } from '../ui';
import { useTech } from '../app/tech';
import { deviceIds } from '../app/devices';
import { t } from '../i18n';
import { cn } from '../lib/format';
import { deviceName } from './people';

const STATE: Record<string, string> = { UP: 'شغالة', DOWN: 'واقعة', SLOW: 'بطيئة', REJECT: 'بترفض الإيصالات', TIMEOUT: 'مش بترد', PAPER_OUT: 'الورق خلص' };
const DROP_OPS: [string, string][] = [['Payment.Capture', 'الدفع'], ['Order.Fire', 'الإرسال للمطبخ'], ['Order.Confirm', 'تأكيد الشيك'], ['Order.Complete', 'قفل الشيك'], ['Order.AddLines', 'إضافة أصناف'], ['TableVisit.Open', 'فتح ترابيزة'], ['Session.Close', 'قفل الوردية'], ['Refund.Approve', 'اعتماد المرتجع']];

function Row({ icon, title, hint, children }: { icon: React.ReactNode; title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2"><span className="w-6 h-6 rounded-md bg-[var(--surface-2)] text-soft flex items-center justify-center shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">{icon}</span><div className="text-xs font-bold">{title}</div></div>
      {hint && <div className="text-[11px] text-dim leading-relaxed">{hint}</div>}
      {children}
    </div>
  );
}

export function Simulators() {
  const s = useSyncExternalStore(sim.subscribe, sim.get);
  const tech = useTech();
  const offline = s.offlineDevices ?? [];
  const faults = [s.kds !== 'UP', s.eta !== 'UP', Object.values(s.printers).some((p) => p !== 'UP'), !!s.dropNextResponse, s.offlineNext, offline.length > 0, s.webhooks === 'DOWN'].filter(Boolean).length;
  const set = (p: Partial<typeof s>) => { sim.set(p); setTimeout(() => demo.tick(), 0); };
  const Opt = ({ v, cur, on }: { v: string; cur: string; on: () => void }) => (
    <button onClick={on} aria-pressed={cur === v} className={cn('px-2.5 h-7 rounded-lg text-[11px] font-bold border transition-colors', cur === v ? (v === 'UP' ? 'bg-[var(--success)] text-white border-transparent' : 'bg-[var(--error)] text-white border-transparent') : 'bg-[var(--surface-1)] border-[var(--glass-border)] text-soft hover:bg-[var(--surface-2)]')}>
      {t(STATE[v] ?? v)}{tech && <span className="num opacity-70 ms-1 text-[9px]">{v}</span>}
    </button>
  );
  return (
    <Popover title={t('محاكاة الأعطال: وقّع الطابعة أو شاشة المطبخ أو منظومة الضرايب أو النت، وشوف إن البيع بيكمل')} width={430} button={(o) => (
      <button data-fb="chrome:simulators" data-on={o} className={cn('chrome-btn relative', faults > 0 && '!border-[color-mix(in_srgb,var(--error)_50%,transparent)] !text-[var(--error)] !bg-[color-mix(in_srgb,var(--error)_12%,transparent)]')}>
        <Radio className="w-4 h-4" /><span className="hidden min-[2100px]:inline">{faults ? t('في عطل شغال') : t('محاكاة الأعطال')}</span>
        {faults > 0 && <span className="absolute -top-1 -end-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--error)] text-white text-[9px] font-bold flex items-center justify-center num">{faults}</span>}
      </button>
    )}>
      <div className="space-y-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div><div className="font-bold text-base">{t('محاكاة الأعطال')}</div><div className="text-[11px] text-dim leading-relaxed mt-0.5">{t('مفيش شبكة حقيقية ولا دفع حقيقي ولا منظومة ضرايب حقيقية. الطباعة والمطبخ والإيصال الإلكتروني بيحصلوا بعد ما البيع يتحفظ، ووقوعهم عمره ما يوقف البيع.')}</div></div>
          {faults > 0 && <Button size="sm" variant="ghost" onClick={() => { sim.reset(); setTimeout(() => demo.tick(), 0); }} data-fb="sim-reset"><RotateCcw className="w-3.5 h-3.5" />{t('رجّع كله شغال')}</Button>}
        </div>

        <Row icon={<Network />} title={t('النت على كل جهاز')} hint={t('اقطع النت عن جهاز: البيع بيكمل عليه والحركات بتستنى لحد ما النت يرجع.')}>
          <div className="grid grid-cols-2 gap-1.5">
            {deviceIds().map((id) => {
              const term = store.db.terminals.find((x) => x.id === id);
              const off = offline.includes(id);
              return (
                <button key={id} data-fb={`sim-offline:${id}`} aria-pressed={off} onClick={() => { sim.setOffline(id, !off); setTimeout(() => demo.tick(), 0); }}
                  className={cn('h-9 px-2.5 rounded-lg border text-xs flex items-center gap-2 text-start transition-colors', off ? 'border-[color-mix(in_srgb,var(--error)_45%,transparent)] bg-[color-mix(in_srgb,var(--error)_12%,transparent)] text-[var(--error)] font-bold' : 'border-[var(--glass-border)] bg-[var(--surface-1)] text-soft hover:bg-[var(--surface-2)]')}>
                  {off ? <WifiOff className="w-3.5 h-3.5 shrink-0" /> : <Wifi className="w-3.5 h-3.5 shrink-0 text-[var(--success)]" />}
                  <span className="truncate flex-1">{deviceName(id, term?.kind, term?.name)}</span>
                  <span className="text-[10px] shrink-0">{off ? t('مقطوع') : t('متصل')}</span>
                </button>
              );
            })}
          </div>
        </Row>

        <Row icon={<ChefHat />} title={t('توصيل الطلبات لشاشة المطبخ')}><div className="flex gap-1">{(['UP', 'DOWN', 'SLOW'] as const).map((v) => <Opt key={v} v={v} cur={s.kds} on={() => set({ kds: v })} />)}</div></Row>
        <Row icon={<Landmark />} title={t('منظومة الإيصال الإلكتروني (الضرايب)')}><div className="flex gap-1 flex-wrap">{(['UP', 'DOWN', 'REJECT', 'TIMEOUT'] as const).map((v) => <Opt key={v} v={v} cur={s.eta} on={() => set({ eta: v })} />)}</div></Row>
        <Row icon={<Plug />} title={t('البرامج التانية المربوطة (الحسابات، تطبيقات الدليفري)')} hint={t('لو واقعة، التحديثات اللي بتتبعت لها بتستنى وتتعاد أوتوماتيك — تقدر تتابعها من «صحة النظام».')}>
          <div className="flex gap-1">{(['UP', 'DOWN'] as const).map((v) => <button key={v} data-fb={`sim-webhooks:${v}`} onClick={() => set({ webhooks: v })} aria-pressed={s.webhooks === v} className={cn('px-2.5 h-7 rounded-lg text-[11px] font-bold border transition-colors', s.webhooks === v ? (v === 'UP' ? 'bg-[var(--success)] text-white border-transparent' : 'bg-[var(--error)] text-white border-transparent') : 'bg-[var(--surface-1)] border-[var(--glass-border)] text-soft hover:bg-[var(--surface-2)]')}>{t(STATE[v])}{tech && <span className="num opacity-70 ms-1 text-[9px]">webhooks {v}</span>}</button>)}</div>
        </Row>
        <Row icon={<Printer />} title={t('الطابعات')}>
          <div className="space-y-1.5">
            {store.db.terminals.filter((x) => x.kind !== 'KDS').map((term) => (
              <div key={term.id} className="flex items-center justify-between gap-2"><span className="text-xs min-w-0 truncate">{t('طابعة {d}', { d: deviceName(term.id, term.kind, term.name) })}{tech && <span className="num text-[9px] text-dim ms-1">{term.code}</span>}</span><div className="flex gap-1 shrink-0">{(['UP', 'DOWN', 'PAPER_OUT'] as const).map((v) => <Opt key={v} v={v} cur={sim.printer(term.id)} on={() => set({ printers: { ...s.printers, [term.id]: v } })} />)}</div></div>
            ))}
          </div>
        </Row>
        <Row icon={<Radio />} title={t('مشاكل الشبكة لحركة واحدة')}>
          <div className="flex items-center gap-2"><span className="text-xs shrink-0">{t('ضيّع الرد على')}:</span>
            <Select value={s.dropNextResponse ?? ''} onChange={(e) => set({ dropNextResponse: e.target.value || null })} options={[{ value: '', label: t('ولا حاجة') }, ...DROP_OPS.map(([x, l]) => ({ value: x, label: tech ? `${t(l)} (${x})` : t(l) }))]} className="!py-1 !min-h-0 h-8 text-xs" />
          </div>
          <div className="text-[11px] text-dim">{t('الحركة الجاية من النوع ده هتتنفذ بس ردها هيضيع — هتشوف «النتيجة مش معروفة» وزرار «إعادة المحاولة».')}</div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={s.offlineNext} onChange={(e) => set({ offlineNext: e.target.checked })} className="accent-[var(--primary)]" />{t('الحركة الجاية تفشل قبل ما توصل (مفيش حاجة هتتسجل)')}</label>
          <div className="flex items-center gap-2 text-xs">{t('بطء الشبكة')}: <input type="range" min={0} max={1500} step={20} value={s.latencyMs} onChange={(e) => set({ latencyMs: Number(e.target.value) })} className="flex-1 accent-[var(--primary)]" /><span className="num w-24 text-end">{s.latencyMs === 0 ? t('سريعة') : t('{n} مللي ثانية', { n: s.latencyMs })}</span></div>
        </Row>
        {faults > 0 && <Pill tone="error" dot>{t('في عطل شغال دلوقتي')}</Pill>}
      </div>
    </Popover>
  );
}
