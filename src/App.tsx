import React, { useEffect, useState } from 'react';
import { Columns2, SlidersHorizontal, MessageSquarePlus, ScrollText, PlayCircle, FlaskConical, Languages, Palette, RotateCcw, Box, Clock, Radio, Library } from 'lucide-react';
import { DevicePane } from './app/DevicePane';
import { devices, deviceIds, deviceLabel, useDevicesState } from './app/devices';
import { useStoreVersion } from './app/hooks';
import { Toasts, ConfirmHost, Pill } from './ui';
import { t, setLang, useLang } from './i18n';
import { cn } from './lib/format';
import { PolicyPanel } from './demo/PolicyPanel';
import { FeedbackLayer, FeedbackPanel, useFeedback, feedback } from './demo/Feedback';
import { ApiLogPanel } from './demo/ApiLog';
import { ClockControl } from './demo/ClockControl';
import { Simulators } from './demo/Simulators';
import { ResetMenu } from './demo/ResetMenu';
import { Walkthrough } from './demo/Walkthrough';
import { Scenarios } from './demo/Scenarios';

type Panel = null | 'policy' | 'feedback' | 'log' | 'walk' | 'scenarios';

export default function App() {
  useStoreVersion();
  const lang = useLang();
  const ds = useDevicesState();
  const fb = useFeedback();
  const [panel, setPanel] = useState<Panel>(null);
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem('nerdpos.theme') || 'dark'; } catch { return 'dark'; } });
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('nerdpos.theme', theme); } catch { /* ignore */ } }, [theme]);
  const ids = deviceIds();
  const primary = ids.includes(ds.primary) ? ds.primary : ids[0];
  const secondary = ds.secondary && ids.includes(ds.secondary) && ds.secondary !== primary ? ds.secondary : ids.find((x) => x !== primary) ?? null;
  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  return (
    <div className={cn('h-full flex flex-col', fb.mode && 'fb-mode')}>
      <div className="h-12 shrink-0 flex items-center gap-2 px-3 border-b line glass-strong z-40 overflow-x-auto scrollbar-hide" data-demo-chrome>
        <div className="flex items-center gap-2 shrink-0">
          <Box className="w-6 h-6 text-cyan-400" />
          <div className="leading-none"><div className="font-extrabold text-sm">NerdPOS</div><div className="text-[10px] text-dim">{t('نموذج تجريبي — مش منتج حقيقي')}</div></div>
        </div>
        <div className="w-px h-6 surface-3 mx-1" />
        <div className="flex items-center gap-1 shrink-0" data-fb="device-switcher">
          {ids.map((id) => {
            const l = deviceLabel(id, lang);
            const d = ds.devices[id];
            const on = id === primary || (ds.split && id === secondary);
            return (
              <button key={id} onClick={(e) => (e.shiftKey || (ds.split && id !== primary && e.altKey) ? devices.setSecondary(id) : devices.setPrimary(id))} onContextMenu={(e) => { e.preventDefault(); devices.setSecondary(id); devices.setSplit(true); }} title={`${l.name} · ${l.code}\n${t('كليك: الشاشة الرئيسية — كليك يمين: الشاشة التانية')}`}
                className={cn('h-8 px-2.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-colors', on ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'border-[var(--glass-border)] surface-1 text-soft hover:surface-2')}>
                <span className="num">{l.short}</span><span className="hidden min-[1900px]:inline font-normal">{l.name}</span>
                <span className={cn('w-1.5 h-1.5 rounded-full', d?.token ? 'bg-[var(--success)]' : 'bg-white/20')} />
              </button>
            );
          })}
          <button onClick={() => devices.setSplit(!ds.split)} title={t('جهازين جنب بعض')} className={cn('h-8 px-2 rounded-lg border flex items-center gap-1 text-xs', ds.split ? 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1 text-soft')}><Columns2 className="w-4 h-4" /><span className="hidden min-[1700px]:inline">{t('جهازين')}</span></button>
        </div>
        <div className="flex-1" />
        <ClockControl />
        <Simulators />
        <ChromeBtn on={panel === 'policy'} onClick={() => toggle('policy')} icon={<SlidersHorizontal className="w-4 h-4" />} label={t('الإعدادات (Policy Panel)')} />
        <ChromeBtn on={panel === 'walk'} onClick={() => toggle('walk')} icon={<PlayCircle className="w-4 h-4" />} label={t('الرحلات')} />
        <ChromeBtn on={panel === 'scenarios'} onClick={() => toggle('scenarios')} icon={<FlaskConical className="w-4 h-4" />} label={t('سيناريوهات الفشل')} />
        <ChromeBtn on={fb.mode} onClick={() => feedback.setMode(!fb.mode)} icon={<MessageSquarePlus className="w-4 h-4" />} label={t('وضع الملاحظات')} badge={fb.items.length || undefined} tone="pink" />
        <ChromeBtn on={panel === 'feedback'} onClick={() => toggle('feedback')} icon={<Library className="w-4 h-4" />} label={t('الملاحظات')} />
        <ChromeBtn on={panel === 'log'} onClick={() => toggle('log')} icon={<ScrollText className="w-4 h-4" />} label={t('سجل الطلبات (API)')} />
        <button className="h-8 px-2 rounded-lg surface-1 border border-[var(--glass-border)] text-xs flex items-center gap-1" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} title="AR / EN"><Languages className="w-4 h-4" />{lang === 'ar' ? 'EN' : 'ع'}</button>
        <button className="h-8 px-2 rounded-lg surface-1 border border-[var(--glass-border)] text-xs flex items-center gap-1" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'luxury' : 'dark')} title={t('الثيم')}><Palette className="w-4 h-4" /></button>
        <ResetMenu />
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className={cn('flex-1 min-w-0 grid gap-2 p-2', ds.split && secondary ? 'grid-cols-2' : 'grid-cols-1')}>
          <DevicePane key={primary} id={primary} compact={ds.split} />
          {ds.split && secondary && <DevicePane key={secondary} id={secondary} compact />}
        </div>
        {panel === 'policy' && <SidePanel onClose={() => setPanel(null)} wide><PolicyPanel onClose={() => setPanel(null)} /></SidePanel>}
        {panel === 'feedback' && <SidePanel onClose={() => setPanel(null)}><FeedbackPanel /></SidePanel>}
        {panel === 'walk' && <SidePanel onClose={() => setPanel(null)} wide><Walkthrough /></SidePanel>}
        {panel === 'scenarios' && <SidePanel onClose={() => setPanel(null)} wide><Scenarios /></SidePanel>}
      </div>
      {panel === 'log' && <ApiLogPanel onClose={() => setPanel(null)} />}
      <FeedbackLayer />
      <Toasts />
      <ConfirmHost />
    </div>
  );
}

function ChromeBtn({ on, onClick, icon, label, badge, tone }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number; tone?: 'pink' }) {
  return (
    <button data-chrome onClick={onClick} title={label} className={cn('relative h-8 px-2 rounded-lg border flex items-center gap-1.5 text-xs shrink-0 transition-colors', on ? (tone === 'pink' ? 'border-pink-400 text-pink-300 bg-pink-500/15' : 'border-[var(--primary)] text-[var(--primary)] bg-[var(--primary-container)]') : 'border-[var(--glass-border)] surface-1 text-soft hover:surface-2')}>
      {icon}<span className="hidden 2xl:inline">{label}</span>
      {badge ? <span className="absolute -top-1 -end-1 min-w-[16px] h-4 px-1 rounded-full bg-pink-500 text-white text-[9px] font-bold flex items-center justify-center">{badge}</span> : null}
    </button>
  );
}

function SidePanel({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <aside className={cn('shrink-0 h-full glass-strong border-s line overflow-hidden flex flex-col animate-fade-in z-30', wide ? 'w-[min(560px,48vw)]' : 'w-[min(420px,40vw)]')} data-demo-chrome>
      {children}
    </aside>
  );
}
