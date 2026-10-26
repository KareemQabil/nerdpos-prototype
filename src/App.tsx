import React, { useEffect, useState } from 'react';
import { Columns2, SlidersHorizontal, MessageSquarePlus, ScrollText, PlayCircle, FlaskConical, Languages, Palette, Box, Library, HelpCircle, Code2, Armchair, ShoppingCart, ChefHat, Briefcase, Building2, Monitor } from 'lucide-react';
import { DevicePane } from './app/DevicePane';
import { devices, deviceIds, deviceLabel, useDevicesState } from './app/devices';
import { useStoreVersion } from './app/hooks';
import { Toasts, ConfirmHost } from './ui';
import { t, setLang, useLang } from './i18n';
import { cn } from './lib/format';
import { techMode, useTech } from './app/tech';
import { store } from './mock/store';
import { PolicyPanel } from './demo/PolicyPanel';
import { FeedbackLayer, FeedbackPanel, useFeedback, feedback } from './demo/Feedback';
import { ApiLogPanel } from './demo/ApiLog';
import { ClockControl } from './demo/ClockControl';
import { Simulators } from './demo/Simulators';
import { ResetMenu } from './demo/ResetMenu';
import { Walkthrough } from './demo/Walkthrough';
import { Scenarios } from './demo/Scenarios';
import { Welcome, welcomeSeen } from './demo/Welcome';
import { DEVICE_NAMES, deviceName, personName } from './demo/people';

type Panel = null | 'policy' | 'feedback' | 'log' | 'walk' | 'scenarios';
const KIND_ICON: Record<string, React.ElementType> = { CASH: ShoppingCart, FLOOR: Armchair, KDS: ChefHat, ADMIN: Briefcase, BO: Building2 };

export default function App() {
  useStoreVersion();
  const lang = useLang();
  const tech = useTech();
  const ds = useDevicesState();
  const fb = useFeedback();
  const [panel, setPanel] = useState<Panel>(null);
  const [walkKey, setWalkKey] = useState(0);
  const [welcome, setWelcome] = useState<null | 'start' | 'help'>(() => (welcomeSeen() ? null : 'start'));
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem('nerdpos.theme') || 'dark'; } catch { return 'dark'; } });
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('nerdpos.theme', theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { if (!tech && panel === 'log') setPanel(null); }, [tech, panel]);
  const ids = deviceIds();
  const primary = ids.includes(ds.primary) ? ds.primary : ids[0];
  const secondary = ds.secondary && ids.includes(ds.secondary) && ds.secondary !== primary ? ds.secondary : ids.find((x) => x !== primary) ?? null;
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const openPanel = (p: 'walk' | 'policy') => { if (p === 'walk') setWalkKey((k) => k + 1); setPanel(p); };

  return (
    <div className={cn('h-full flex flex-col', fb.mode && 'fb-mode')}>
      <div className="h-12 shrink-0 flex items-center gap-2 px-3 border-b line glass-strong z-[80] relative overflow-x-auto scrollbar-hide" data-demo-chrome>
        <div className="flex items-center gap-2 shrink-0" title={t('ده مطعم تجريبي: كل البيانات وهمية ومفيش فلوس حقيقية بتتحرك')}>
          <Box className="w-6 h-6 text-cyan-400" />
          <div className="leading-none"><div className="font-extrabold text-sm">NerdPOS</div><div className="text-[10px] text-dim">{t('مطعم تجريبي — بيانات وهمية')}</div></div>
        </div>

        {/* devices */}
        <Group label={t('الأجهزة')}>
          <div className="flex items-center gap-1" data-fb="device-switcher">
            {ids.map((id) => {
              const l = deviceLabel(id, lang);
              const d = ds.devices[id];
              const term = store.db.terminals.find((x) => x.id === id);
              const kind = term?.kind ?? 'BO';
              const Icon = KIND_ICON[kind] ?? Monitor;
              const on = id === primary || (ds.split && id === secondary);
              const name = DEVICE_NAMES[id]?.short ?? deviceName(id, kind, term?.name);
              const who = d?.token ? personName(null, d.userName) : null;
              const tip = [DEVICE_NAMES[id]?.hint ?? deviceName(id, kind, term?.name), who ? t('داخل عليه: {n}', { n: who }) : t('محدش داخل عليه'), t('كليك: افتحه — كليك يمين: افتحه في الشاشة التانية'), tech ? `${l.short} · ${l.code}` : ''].filter(Boolean).join('\n');
              return (
                <button key={id} data-fb={`device:${id}`} onClick={(e) => (e.shiftKey || (ds.split && id !== primary && e.altKey) ? devices.setSecondary(id) : devices.setPrimary(id))} onContextMenu={(e) => { e.preventDefault(); devices.setSecondary(id); devices.setSplit(true); }} title={tip}
                  className={cn('h-8 px-2 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-colors whitespace-nowrap', on ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'border-[var(--glass-border)] surface-1 text-soft hover:surface-2')}>
                  <Icon className="w-3.5 h-3.5" /><span className="hidden min-[1450px]:inline">{name}</span>{tech && <span className="num font-normal text-[10px] opacity-70">{l.short}</span>}
                  <span className={cn('w-1.5 h-1.5 rounded-full', d?.token ? 'bg-[var(--success)]' : 'bg-white/20')} />
                </button>
              );
            })}
            <button data-fb="device-split" onClick={() => devices.setSplit(!ds.split)} title={t('اعرض جهازين جنب بعض — مثلًا الويتر والمطبخ')} className={cn('h-8 px-2 rounded-lg border flex items-center gap-1 text-xs', ds.split ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1 text-soft')}><Columns2 className="w-4 h-4" /><span className="hidden min-[2000px]:inline">{t('جهازين')}</span></button>
          </div>
        </Group>
        <div className="flex-1" />

        {/* time */}
        <Group label={t('الوقت')}><ClockControl /></Group>

        {/* demo tools */}
        <Group label={t('أدوات التجربة')}>
          <ChromeBtn fb="chrome:policy" on={panel === 'policy'} onClick={() => toggle('policy')} icon={<SlidersHorizontal className="w-4 h-4" />} label={t('إعدادات المطعم')} tip={t('غيّر طريقة شغل المطعم (الخدمة، الدرج، الموافقات…) وشوف الأجهزة بتتصرف إزاي')} />
          <ChromeBtn fb="chrome:walk" on={panel === 'walk'} onClick={() => toggle('walk')} icon={<PlayCircle className="w-4 h-4" />} label={t('رحلات بالخطوة')} tip={t('قصص جاهزة من يوم المطعم، خطوة بخطوة')} />
          <ChromeBtn fb="chrome:scenarios" on={panel === 'scenarios'} onClick={() => toggle('scenarios')} icon={<FlaskConical className="w-4 h-4" />} label={t('سيناريوهات الفشل')} tip={t('جرّب حاجات المفروض السيستم يرفضها أو يتصرف فيها صح')} />
          <Simulators />
          <ChromeBtn fb="chrome:feedback-mode" on={fb.mode} onClick={() => feedback.setMode(!fb.mode)} icon={<MessageSquarePlus className="w-4 h-4" />} label={fb.mode ? t('اضغط على أي حاجة…') : t('ملاحظة')} tip={t('شغّلها واضغط على أي حاجة في الشاشة عشان تكتب رأيك فيها')} badge={fb.items.length || undefined} tone="pink" />
          <ChromeBtn fb="chrome:feedback" on={panel === 'feedback'} onClick={() => toggle('feedback')} icon={<Library className="w-4 h-4" />} label={t('ملاحظاتي')} tip={t('كل الملاحظات اللي كتبتها، وتنزيلها كملف')} />
          <ResetMenu />
        </Group>

        {/* help & view */}
        <Group label={t('مساعدة')}>
          <ChromeBtn fb="chrome:help" on={!!welcome} onClick={() => setWelcome('help')} icon={<HelpCircle className="w-4 h-4" />} label={t('مساعدة')} tip={t('إزاي تستخدم التجربة، وتجرّب كـ ويتر أو كاشير أو مدير')} alwaysLabel />
          <button className="h-8 px-2 rounded-lg surface-1 border border-[var(--glass-border)] text-xs flex items-center gap-1 shrink-0" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} title={t('غيّر اللغة')}><Languages className="w-4 h-4" />{lang === 'ar' ? 'EN' : 'ع'}</button>
          <button className="h-8 px-2 rounded-lg surface-1 border border-[var(--glass-border)] text-xs flex items-center gap-1 shrink-0" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'luxury' : 'dark')} title={t('غيّر الألوان (غامق / فاتح / فاخر)')}><Palette className="w-4 h-4" /></button>
          <button data-chrome data-fb="chrome:tech" role="switch" aria-checked={tech} onClick={() => techMode.set(!tech)} title={t('للفريق بس: بيظهر أكواد العمليات والأخطاء والقيم الخام وسجل الطلبات. سيبه مقفول وإنت بتجرب.')}
            className={cn('h-8 px-2 rounded-lg border flex items-center gap-1.5 text-xs shrink-0', tech ? 'border-amber-400 text-amber-300 bg-amber-500/15' : 'border-[var(--glass-border)] surface-1 text-soft')}>
            <Code2 className="w-4 h-4" /><span className="hidden min-[1150px]:inline">{t('تفاصيل تقنية')}</span>
            <span className={cn('w-7 h-4 rounded-full relative transition-colors', tech ? 'bg-amber-400' : 'surface-3')}><span className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all', tech ? 'start-[14px]' : 'start-0.5')} /></span>
          </button>
          {tech && <ChromeBtn fb="chrome:log" on={panel === 'log'} onClick={() => toggle('log')} icon={<ScrollText className="w-4 h-4" />} label={t('سجل الطلبات')} tip={t('كل طلب راح للسيرفر التجريبي (للفريق)')} />}
        </Group>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className={cn('flex-1 min-w-0 grid gap-2 p-2', ds.split && secondary ? 'grid-cols-2' : 'grid-cols-1')}>
          <DevicePane key={primary} id={primary} compact={ds.split} />
          {ds.split && secondary && <DevicePane key={secondary} id={secondary} compact />}
        </div>
        {panel === 'policy' && <SidePanel onClose={() => setPanel(null)} wide><PolicyPanel onClose={() => setPanel(null)} /></SidePanel>}
        {panel === 'feedback' && <SidePanel onClose={() => setPanel(null)}><FeedbackPanel /></SidePanel>}
        {panel === 'walk' && <SidePanel onClose={() => setPanel(null)} wide><Walkthrough key={walkKey} /></SidePanel>}
        {panel === 'scenarios' && <SidePanel onClose={() => setPanel(null)} wide><Scenarios /></SidePanel>}
      </div>
      {panel === 'log' && tech && <ApiLogPanel onClose={() => setPanel(null)} />}
      <FeedbackLayer />
      <Welcome key={welcome ?? 'closed'} open={!!welcome} startTab={welcome ?? 'start'} onClose={() => setWelcome(null)} onOpenPanel={openPanel} />
      <Toasts />
      <ConfirmHost />
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 shrink-0 rounded-xl border border-[var(--glass-border)] px-1 py-0.5" role="group" aria-label={label}>
      <span className="hidden min-[2300px]:inline text-[9px] text-dim px-1 leading-tight max-w-[44px] text-center">{label}</span>
      {children}
    </div>
  );
}

function ChromeBtn({ on, onClick, icon, label, badge, tone, tip, fb, alwaysLabel }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number; tone?: 'pink'; tip?: string; fb?: string; alwaysLabel?: boolean }) {
  return (
    <button data-chrome data-fb={fb} onClick={onClick} title={tip ? `${label}\n${tip}` : label} className={cn('relative h-8 px-2 rounded-lg border flex items-center gap-1.5 text-xs shrink-0 transition-colors whitespace-nowrap', on ? (tone === 'pink' ? 'border-pink-400 text-pink-300 bg-pink-500/15' : 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-container)]') : 'border-[var(--glass-border)] surface-1 text-soft hover:surface-2')}>
      {icon}<span className={alwaysLabel ? 'hidden min-[1100px]:inline' : 'hidden min-[2000px]:inline'}>{label}</span>
      {badge ? <span className="absolute -top-1 -end-1 min-w-[16px] h-4 px-1 rounded-full bg-pink-500 text-white text-[9px] font-bold flex items-center justify-center">{badge}</span> : null}
    </button>
  );
}

function SidePanel({ children, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <aside className={cn('shrink-0 h-full glass-strong border-s line overflow-hidden flex flex-col animate-fade-in z-30', wide ? 'w-[min(560px,48vw)]' : 'w-[min(420px,40vw)]')} data-demo-chrome>
      {children}
    </aside>
  );
}
