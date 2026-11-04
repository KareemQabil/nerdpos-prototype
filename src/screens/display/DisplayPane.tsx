// A display screen of the demo (call board, customer display): full screen, no sign-in, no sidebar, no header. It
// reads through the session of the terminal it is attached to (the dispatch kitchen screen / a cashier terminal),
// like a second monitor on that terminal. A corner button (faint until touched) goes full screen and opens the
// display's own settings: the terminal it follows, the look (app theme or high-contrast), and call-board timing.
import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Settings2, X, Volume2, VolumeX } from 'lucide-react';
import { DeviceProvider, useQuery, type DevCtx } from '../../app/hooks';
import { devices, useDevicesState, DISPLAY_DEVICES } from '../../app/devices';
import { store } from '../../mock/store';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { deviceName } from '../../demo/people';
import { useSound } from '../../app/sound';
import { useDisplaySettings, setDisplaySettings, type DisplaySettings } from './settings';
import { CallBoard } from './CallBoard';
import { CustomerDisplay } from './CustomerDisplay';
import { kdsScreenOf } from '../../mock/r3b';

export default function DisplayPane({ id }: { id: string }) {
  const kind = DISPLAY_DEVICES[id]?.kind ?? 'CUSTOMER';
  const cfg = useDisplaySettings(id);
  useDevicesState(); // re-render when the host signs in or out
  const auth = devices.auth(cfg.host);
  const host = store.db.terminals.find((x) => x.id === cfg.host) ?? null;
  const ctx: DevCtx = { id, auth: { ...auth, deviceId: cfg.host }, me: null, nav: () => {}, screen: 'display', params: {}, can: () => false, kind: 'DISPLAY', terminal: host };
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [open, setOpen] = useState(false);
  const snd = useSound(id);
  useEffect(() => { const h = () => setFull(document.fullscreenElement === root.current); document.addEventListener('fullscreenchange', h); return () => document.removeEventListener('fullscreenchange', h); }, []);
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen?.().catch(() => {}); };
  return (
    <DeviceProvider value={ctx}>
      <div ref={root} className="display-root group relative flex-1 min-h-0 overflow-hidden select-none" data-display={kind} data-display-style={cfg.style} data-host={cfg.host} data-fb={`display:${kind === 'CALLBOARD' ? 'callboard' : 'customer'}`}>
        {kind === 'CALLBOARD' ? <CallBoard displayId={id} cfg={cfg} online={!!auth.token} /> : <CustomerDisplay displayId={id} cfg={cfg} online={!!auth.token} />}
        <div className={cn('absolute top-[1.2cqmin] end-[1.2cqmin] z-20 flex items-center gap-1.5 transition-opacity', open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
          {kind === 'CALLBOARD' && <CornerBtn onClick={() => snd.setMuted(!snd.muted)} label={snd.muted ? t('تشغيل الصوت') : t('كتم الصوت')} fb="display-mute">{snd.muted ? <VolumeX /> : <Volume2 />}</CornerBtn>}
          <CornerBtn onClick={toggleFull} label={full ? t('الخروج من ملء الشاشة') : t('ملء الشاشة')} fb="display-fullscreen">{full ? <Minimize2 /> : <Maximize2 />}</CornerBtn>
          <CornerBtn onClick={() => setOpen(!open)} label={t('إعدادات الشاشة')} fb="display-settings-open" on={open}><Settings2 /></CornerBtn>
        </div>
        {open && <SettingsPanel id={id} kind={kind} cfg={cfg} onClose={() => setOpen(false)} />}
      </div>
    </DeviceProvider>
  );
}

function CornerBtn({ children, onClick, label, fb, on }: { children: React.ReactNode; onClick: () => void; label: string; fb: string; on?: boolean }) {
  return <button onClick={onClick} title={label} aria-label={label} data-fb={fb} className={cn('w-11 h-11 rounded-xl border flex items-center justify-center backdrop-blur [&_svg]:w-5 [&_svg]:h-5', on ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent' : 'bg-[color-mix(in_srgb,var(--background)_70%,transparent)] border-[var(--glass-border)] text-[var(--foreground)]')}>{children}</button>;
}

/** The display's own menu (inline, so it also works in full screen). */
function SettingsPanel({ id, kind, cfg, onClose }: { id: string; kind: 'CALLBOARD' | 'CUSTOMER'; cfg: DisplaySettings; onClose: () => void }) {
  // ux-12c: a call board follows a dispatch screen (where numbers are called and orders handed off); a screen that is
  // only a station is offered only when the branch has no dispatch screen at all
  const kds = store.db.terminals.filter((x) => x.lifecycle === 'ACTIVE' && x.kind === 'KDS');
  const dispatch = kds.filter((x) => kdsScreenOf(store.db, x.id).dispatch);
  const hosts = kind === 'CALLBOARD' ? (dispatch.length ? dispatch : kds) : store.db.terminals.filter((x) => x.lifecycle === 'ACTIVE' && x.kind === 'CASH');
  const hostIsStation = kind === 'CALLBOARD' && dispatch.length > 0 && !dispatch.some((x) => x.id === cfg.host);
  const set = (p: Partial<DisplaySettings>) => setDisplaySettings(id, p);
  const Opt = ({ on, onClick, children, fb }: { on: boolean; onClick: () => void; children: React.ReactNode; fb: string }) => <button onClick={onClick} data-fb={fb} aria-pressed={on} className={cn('min-h-11 px-3 rounded-xl border text-sm font-bold', on ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'border-[var(--glass-border)] surface-1')}>{children}</button>;
  return (
    <div className="absolute top-[calc(1.2cqmin+52px)] end-[1.2cqmin] z-30 w-[min(380px,calc(100%-2rem))] overlay-panel rounded-2xl p-4 space-y-4 text-[var(--foreground)]" role="dialog" aria-label={t('إعدادات الشاشة')} data-fb="display-settings">
      <div className="flex items-center justify-between"><div className="font-bold">{t('إعدادات الشاشة')}</div><button onClick={onClose} className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--surface-2)]" aria-label={t('إغلاق')}><X className="w-4 h-4" /></button></div>
      <div className="space-y-1.5"><div className="text-xs font-bold text-soft">{kind === 'CALLBOARD' ? t('تتبع شاشة') : t('تتبع جهاز')}</div><div className="flex flex-wrap gap-1.5">{hosts.map((h) => <Opt key={h.id} on={cfg.host === h.id} onClick={() => set({ host: h.id })} fb={`display-host:${h.id}`}>{deviceName(h.id, h.kind, h.name)}</Opt>)}</div></div>
      {hostIsStation && <div className="text-xs font-bold text-[var(--warning-text)]" data-fb="display-host-not-dispatch">{t('الشاشة المتبوعة ليست شاشة تسليم')}</div>}
      <div className="space-y-1.5"><div className="text-xs font-bold text-soft">{t('المظهر')}</div><div className="flex flex-wrap gap-1.5"><Opt on={cfg.style === 'theme'} onClick={() => set({ style: 'theme' })} fb="display-style:theme">{t('ألوان التطبيق')}</Opt><Opt on={cfg.style === 'display'} onClick={() => set({ style: 'display' })} fb="display-style:display">{t('تباين عالٍ')}</Opt></div></div>
      {kind === 'CALLBOARD' && <CallRuleRows />}
      <div className="space-y-1.5"><div className="text-xs font-bold text-soft">{t('شريط الهوية')}</div><div className="flex flex-wrap gap-1.5"><Opt on={cfg.branding} onClick={() => set({ branding: true })} fb="display-branding:on">{t('ظاهر')}</Opt><Opt on={!cfg.branding} onClick={() => set({ branding: false })} fb="display-branding:off">{t('مخفي')}</Opt></div></div>
    </div>
  );
}

/** ux-12c: the call rule of the venue (CallBoardPolicy), read-only here — it changes in the restaurant settings. */
function CallRuleRows() {
  const q = useQuery<any>('CallBoard.View');
  const d = q.data;
  if (!d) return null;
  const Row = ({ k, v, fb }: { k: string; v: React.ReactNode; fb: string }) => <div className="flex items-center justify-between gap-3 text-sm" data-fb={fb}><span className="text-soft">{k}</span><b>{v}</b></div>;
  return (
    <div className="space-y-1.5 rounded-xl surface-1 border border-[var(--glass-border)] p-3" data-fb="display-call-rule">
      <div className="text-xs font-bold text-soft">{t('من إعدادات المطعم')}</div>
      <Row k={t('النداء')} v={d.auto ? t('تلقائيًا عند جاهزية كل المحطات') : t('من شاشة التسليم بزر «نداء»')} fb="display-rule:call" />
      <Row k={t('مدة بقاء الرقم في «جاهز»')} v={<><span className="num">{d.readyMinutes}</span> {t('د')}</>} fb="display-rule:minutes" />
      <Row k={t('أرقام الدليفري')} v={d.delivery ? t('ظاهرة') : t('مخفية')} fb="display-rule:delivery" />
    </div>
  );
}
