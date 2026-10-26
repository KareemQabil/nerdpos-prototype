import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Columns2, SlidersHorizontal, MessageSquarePlus, ScrollText, PlayCircle, FlaskConical, Languages, Box, Library, HelpCircle, Code2, Armchair, ShoppingCart, ChefHat, Briefcase, Building2, Monitor, MoreHorizontal, WifiOff, Sun, Moon, Gem, X } from 'lucide-react';
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
import { DEVICE_NAMES, deviceName, deviceHint, personName } from './demo/people';
import { Popover } from './demo/Popover';
import { sim } from './mock/sim';

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
      <div className="chrome-bar h-12 shrink-0 flex items-center gap-1.5 px-2.5 border-b line z-[80] relative" data-demo-chrome>
        <div className="flex items-center gap-2 shrink-0 pe-1" title={t('ده مطعم تجريبي: كل البيانات وهمية ومفيش فلوس حقيقية بتتحرك')}>
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[color-mix(in_srgb,var(--primary)_55%,#1e3a8a)] flex items-center justify-center"><Box className="w-4 h-4 text-[var(--primary-foreground)]" /></span>
          <div className="leading-none hidden min-[1100px]:block"><div className="font-extrabold text-sm tracking-tight">NerdPOS</div><div className="text-[10px] text-dim mt-0.5">{t('تجربة — بيانات وهمية')}</div></div>
        </div>
        <Divider />

        {/* devices */}
        <div className="flex items-center gap-1 min-w-0" data-fb="device-switcher" role="group" aria-label={t('الأجهزة')}>
          {ids.map((id) => {
            const overflow = !CORE_DEVICES.includes(id);
            const on = id === primary || (ds.split && id === secondary);
            return <DeviceBtn key={id} id={id} on={on} primary={id === primary} className={overflow && !on ? 'hidden min-[1560px]:flex' : undefined} />;
          })}
          {ids.some((id) => !CORE_DEVICES.includes(id) && !(id === primary || (ds.split && id === secondary))) && <MoreDevices ids={ids.filter((id) => !CORE_DEVICES.includes(id))} />}
          <button data-fb="device-split" data-on={ds.split} onClick={() => devices.setSplit(!ds.split)} title={t('اعرض جهازين جنب بعض — مثلًا الويتر والمطبخ')} className="chrome-btn ms-0.5"><Columns2 className="w-4 h-4" /><span className="hidden min-[1800px]:inline">{t('جهازين')}</span></button>
        </div>
        <div className="flex-1 min-w-2" />

        {/* time */}
        <ClockControl />
        <Divider />

        {/* demo tools */}
        <div className="flex items-center gap-0.5 shrink-0" role="group" aria-label={t('أدوات التجربة')}>
          <ChromeBtn fb="chrome:policy" on={panel === 'policy'} onClick={() => toggle('policy')} icon={<SlidersHorizontal className="w-4 h-4" />} label={t('إعدادات المطعم')} tip={t('غيّر طريقة شغل المطعم (الخدمة، الدرج، الموافقات…) وشوف الأجهزة بتتصرف إزاي')} labelAt="wide" />
          <ChromeBtn fb="chrome:walk" on={panel === 'walk'} onClick={() => toggle('walk')} icon={<PlayCircle className="w-4 h-4" />} label={t('رحلات بالخطوة')} tip={t('قصص جاهزة من يوم المطعم، خطوة بخطوة')} labelAt="wide" />
          <ChromeBtn fb="chrome:scenarios" on={panel === 'scenarios'} onClick={() => toggle('scenarios')} icon={<FlaskConical className="w-4 h-4" />} label={t('سيناريوهات الفشل')} tip={t('جرّب حاجات المفروض السيستم يرفضها أو يتصرف فيها صح')} />
          <Simulators />
          <ChromeBtn fb="chrome:feedback-mode" on={fb.mode} onClick={() => feedback.setMode(!fb.mode)} icon={<MessageSquarePlus className="w-4 h-4" />} label={fb.mode ? t('اضغط على أي حاجة…') : t('ملاحظة')} tip={t('شغّلها واضغط على أي حاجة في الشاشة عشان تكتب رأيك فيها')} badge={fb.items.length || undefined} tone="pink" labelAt={fb.mode ? 'always' : undefined} />
          <ChromeBtn fb="chrome:feedback" on={panel === 'feedback'} onClick={() => toggle('feedback')} icon={<Library className="w-4 h-4" />} label={t('ملاحظاتي')} tip={t('كل الملاحظات اللي كتبتها، وتنزيلها كملف')} />
          <ResetMenu />
        </div>
        <Divider />

        {/* help & view */}
        <div className="flex items-center gap-0.5 shrink-0" role="group" aria-label={t('مساعدة')}>
          <ChromeBtn fb="chrome:help" on={!!welcome} onClick={() => setWelcome('help')} icon={<HelpCircle className="w-4 h-4" />} label={t('مساعدة')} tip={t('إزاي تستخدم التجربة، وتجرّب كـ ويتر أو كاشير أو مدير')} labelAt="mid" />
          <button className="chrome-btn" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} title={t('غيّر اللغة')}><Languages className="w-4 h-4" /><span className="font-bold">{lang === 'ar' ? 'EN' : 'ع'}</span></button>
          <button className="chrome-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'luxury' : 'dark')} title={`${t('غيّر الألوان (غامق / فاتح / فاخر)')}\n${t('دلوقتي')}: ${theme === 'dark' ? t('غامق') : theme === 'light' ? t('فاتح') : t('فاخر')}`}>{theme === 'light' ? <Sun className="w-4 h-4" /> : theme === 'luxury' ? <Gem className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button>
          <button data-chrome data-fb="chrome:tech" role="switch" aria-checked={tech} onClick={() => techMode.set(!tech)} title={t('للفريق بس: بيظهر أكواد العمليات والأخطاء والقيم الخام وسجل الطلبات. سيبه مقفول وإنت بتجرب.')}
            className={cn('chrome-btn', tech && '!border-amber-400/60 !text-amber-500 !bg-amber-500/15')}>
            <Code2 className="w-4 h-4" /><span className="hidden min-[1700px]:inline">{t('تفاصيل تقنية')}</span>
            <span className={cn('w-7 h-4 rounded-full relative transition-colors', tech ? 'bg-amber-400' : 'surface-3')}><span className={cn('absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow', tech ? 'start-[14px]' : 'start-0.5')} /></span>
          </button>
          {tech && <ChromeBtn fb="chrome:log" on={panel === 'log'} onClick={() => toggle('log')} icon={<ScrollText className="w-4 h-4" />} label={t('سجل الطلبات')} tip={t('كل طلب راح للسيرفر التجريبي (للفريق)')} />}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className={cn('flex-1 min-w-0 grid gap-2 p-2', ds.split && secondary ? 'grid-cols-2' : 'grid-cols-1')}>
          <DevicePane key={primary} id={primary} compact={ds.split} />
          {ds.split && secondary && <DevicePane key={secondary} id={secondary} compact />}
        </div>
        {panel === 'policy' && <SidePanel onClose={() => setPanel(null)} wide><PolicyPanel onClose={() => setPanel(null)} /></SidePanel>}
        {panel === 'feedback' && <SidePanel onClose={() => setPanel(null)} closeBtn><FeedbackPanel /></SidePanel>}
        {panel === 'walk' && <SidePanel onClose={() => setPanel(null)} wide closeBtn><Walkthrough key={walkKey} /></SidePanel>}
        {panel === 'scenarios' && <SidePanel onClose={() => setPanel(null)} wide closeBtn><Scenarios /></SidePanel>}
      </div>
      {panel === 'log' && tech && <ApiLogPanel onClose={() => setPanel(null)} />}
      <FeedbackLayer />
      <Welcome key={welcome ?? 'closed'} open={!!welcome} startTab={welcome ?? 'start'} onClose={() => setWelcome(null)} onOpenPanel={openPanel} />
      <Toasts />
      <ConfirmHost />
    </div>
  );
}

/** Devices always shown in the bar; the others (second branch, extra counters, new terminals) go to «أجهزة تانية» on narrow windows. */
const CORE_DEVICES = ['t_floor', 't_cash', 't_kds', 't_admin', 'BO'];

function Divider() { return <span className="w-px h-6 bg-[var(--line)] shrink-0 mx-1" aria-hidden />; }

function deviceInfo(id: string, lang: 'ar' | 'en', tech: boolean) {
  const ds = devices.state();
  const l = deviceLabel(id, lang);
  const d = ds.devices[id];
  const term = store.db.terminals.find((x) => x.id === id);
  const kind = term?.kind ?? 'BO';
  const Icon = KIND_ICON[kind] ?? Monitor;
  const name = (lang === 'en' ? DEVICE_NAMES[id]?.shortEn ?? DEVICE_NAMES[id]?.en : DEVICE_NAMES[id]?.short) ?? deviceName(id, kind, term?.name);
  const who = d?.token ? personName(null, d.userName) : null;
  const offline = sim.isOffline(id);
  const tip = [deviceHint(id) || deviceName(id, kind, term?.name), who ? t('داخل عليه: {n}', { n: who }) : t('محدش داخل عليه'), offline ? t('النت مقطوع عن الجهاز ده (محاكاة)') : '', t('كليك: افتحه — كليك يمين: افتحه في الشاشة التانية'), tech ? `${l.short} · ${l.code}` : ''].filter(Boolean).join('\n');
  return { l, Icon, name, who, tip, offline, logged: !!d?.token };
}

function DeviceBtn({ id, on, primary, className }: { id: string; on: boolean; primary: boolean; className?: string }) {
  const lang = useLang();
  const tech = useTech();
  useSyncExternalStore(sim.subscribe, sim.get);
  const ds = useDevicesState();
  const { l, Icon, name, tip, offline, logged } = deviceInfo(id, lang, tech);
  return (
    <button data-fb={`device:${id}`} onClick={(e) => (e.shiftKey || (ds.split && id !== ds.primary && e.altKey) ? devices.setSecondary(id) : devices.setPrimary(id))} onContextMenu={(e) => { e.preventDefault(); devices.setSecondary(id); devices.setSplit(true); }} title={tip} aria-pressed={on}
      className={cn('relative h-8 px-2 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0', on ? 'border-[color-mix(in_srgb,var(--primary)_45%,transparent)] bg-[var(--primary-container)] text-[var(--primary)]' : 'border-transparent text-soft hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]', className)}>
      <Icon className="w-4 h-4 shrink-0" />
      <span className={on ? 'inline' : 'hidden min-[1180px]:inline'}>{name}</span>
      {tech && <span className="num font-normal text-[10px] opacity-70">{l.short}</span>}
      {ds.split && on && <span className="num text-[9px] font-bold opacity-70">{primary ? '1' : '2'}</span>}
      {offline ? <WifiOff className="w-3 h-3 text-[var(--error)]" /> : <span className={cn('w-1.5 h-1.5 rounded-full', logged ? 'bg-[var(--success)]' : 'bg-[var(--text-dim)] opacity-50')} />}
    </button>
  );
}

function MoreDevices({ ids }: { ids: string[] }) {
  const lang = useLang();
  const tech = useTech();
  return (
    <span className="min-[1560px]:hidden">
      <Popover width={300} title={t("أجهزة تانية: الفرع التاني وكاشير التيك أواي وأي جهاز جديد")} button={(o) => <button data-fb="device-more" data-on={o} className="chrome-btn"><MoreHorizontal className="w-4 h-4" /><span className="sr-only">{t('أجهزة تانية')}</span></button>}>
        {(close) => (
          <div className="space-y-1">
            <div className="text-xs font-bold text-soft mb-1">{t('أجهزة تانية')}</div>
            {ids.map((id) => {
              const { Icon, name, who, tip } = deviceInfo(id, lang, tech);
              return (
                <div key={id} className="flex items-center gap-1">
                  <button data-fb={`device-menu:${id}`} title={tip} onClick={() => { devices.setPrimary(id); close(); }} className="flex-1 min-w-0 flex items-center gap-2.5 px-2 h-11 rounded-xl hover:bg-[var(--surface-2)] text-start">
                    <span className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
                    <span className="min-w-0"><span className="block text-sm font-bold truncate">{name}</span><span className="block text-[11px] text-dim truncate">{who ? t('داخل عليه: {n}', { n: who }) : t('محدش داخل عليه')}</span></span>
                  </button>
                  <button title={t('افتحه في الشاشة التانية')} onClick={() => { devices.setSecondary(id); devices.setSplit(true); close(); }} className="chrome-btn"><Columns2 className="w-4 h-4" /></button>
                </div>
              );
            })}
          </div>
        )}
      </Popover>
    </span>
  );
}

function ChromeBtn({ on, onClick, icon, label, badge, tone, tip, fb, labelAt }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number; tone?: 'pink'; tip?: string; fb?: string; labelAt?: 'always' | 'mid' | 'wide' }) {
  const lc = labelAt === 'always' ? 'inline' : labelAt === 'mid' ? 'hidden min-[1440px]:inline' : labelAt === 'wide' ? 'hidden min-[1800px]:inline' : 'hidden min-[2100px]:inline';
  return (
    <button data-chrome data-fb={fb} data-on={on} onClick={onClick} title={tip ? `${label}\n${tip}` : label} aria-pressed={on} className={cn('chrome-btn relative', on && tone === 'pink' && '!border-pink-400/60 !text-pink-500 !bg-pink-500/15')}>
      {icon}<span className={lc}>{label}</span>
      {badge ? <span className="absolute -top-1 -end-1 min-w-[16px] h-4 px-1 rounded-full bg-pink-500 text-white text-[9px] font-bold flex items-center justify-center num">{badge}</span> : null}
    </button>
  );
}

function SidePanel({ children, wide, onClose, closeBtn }: { children: React.ReactNode; onClose: () => void; wide?: boolean; closeBtn?: boolean }) {
  return (
    <aside className={cn('relative shrink-0 h-full overlay-panel !rounded-none !border-y-0 !border-e-0 overflow-hidden flex flex-col animate-fade-in z-30', wide ? 'w-[min(560px,46vw)]' : 'w-[min(420px,40vw)]')} data-demo-chrome>
      {closeBtn && <button onClick={onClose} title={t('إغلاق')} aria-label={t('إغلاق')} data-fb="panel-close" className="absolute top-2.5 end-2.5 z-10 w-8 h-8 rounded-lg flex items-center justify-center text-dim hover:text-[var(--foreground)] hover:bg-[var(--surface-2)]"><X className="w-4 h-4" /></button>}
      {children}
    </aside>
  );
}
