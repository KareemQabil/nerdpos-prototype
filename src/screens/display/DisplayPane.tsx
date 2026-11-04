// A display screen of the demo (call board, customer display): full screen, no sign-in, no sidebar, no header. It
// reads through the session of the terminal it is attached to (the dispatch kitchen screen / a cashier terminal),
// like a second monitor on that terminal. ux-14: the display is a registered device; which terminal it follows, its
// look and its branding strip are server settings changed in «الأجهزة» (the screen shows them read-only). A corner
// button (faint until touched) goes full screen, mutes the sound (a per-viewer convenience) and shows those settings.
import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Settings2, X, Volume2, VolumeX, MonitorOff } from 'lucide-react';
import { DeviceProvider, useQuery, useStoreVersion, type DevCtx } from '../../app/hooks';
import { devices, useDevicesState, displayOf } from '../../app/devices';
import { store } from '../../mock/store';
import { t, tv } from '../../i18n';
import { cn } from '../../lib/format';
import { deviceName } from '../../demo/people';
import { useSound } from '../../app/sound';
import type { DisplayConfig } from './settings';
import { CallBoard } from './CallBoard';
import { CustomerDisplay } from './CustomerDisplay';
import { kdsScreenOf } from '../../mock/r3b';

export default function DisplayPane({ id }: { id: string }) {
  useStoreVersion(); // the registry record (host terminal) may change in «الأجهزة»
  useDevicesState(); // re-render when the host signs in or out
  const reg = displayOf(id);
  const kind = reg?.kind ?? 'CUSTOMER';
  const hostId = reg?.host ?? '';
  const auth = devices.auth(hostId);
  const host = store.db.terminals.find((x) => x.id === hostId) ?? null;
  const ctx: DevCtx = { id, auth: { ...auth, deviceId: hostId }, me: null, nav: () => {}, screen: 'display', params: {}, can: () => false, kind: 'DISPLAY', terminal: host };
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [open, setOpen] = useState(false);
  const [conf, setConf] = useState<DisplayConfig | null>(null);
  const snd = useSound(id);
  useEffect(() => { const h = () => setFull(document.fullscreenElement === root.current); document.addEventListener('fullscreenchange', h); return () => document.removeEventListener('fullscreenchange', h); }, []);
  const toggleFull = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen?.().catch(() => {}); };
  const off = conf?.enabled === false;
  return (
    <DeviceProvider value={ctx}>
      <div ref={root} className="display-root group relative flex-1 min-h-0 overflow-hidden select-none" data-display={kind} data-display-style={conf?.style ?? 'theme'} data-host={hostId} data-display-enabled={!off} data-fb={`display:${kind === 'CALLBOARD' ? 'callboard' : 'customer'}`}>
        {kind === 'CALLBOARD' ? <CallBoard displayId={id} online={!!auth.token} onConfig={setConf} /> : <CustomerDisplay displayId={id} host={hostId} online={!!auth.token} onConfig={setConf} />}
        {off && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-[2cqmin] bg-[var(--background)] text-dim" data-fb="display-off">
            <MonitorOff className="w-[10cqmin] h-[10cqmin]" />
            <div className="text-[3.4cqmin] font-bold">{t('الشاشة متوقفة')}</div>
            <div className="text-[2.2cqmin]">{tv(conf?.name ?? reg?.name ?? '')}</div>
          </div>
        )}
        <div className={cn('absolute top-[1.2cqmin] end-[1.2cqmin] z-20 flex items-center gap-1.5 transition-opacity', open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
          {kind === 'CALLBOARD' && <CornerBtn onClick={() => snd.setMuted(!snd.muted)} label={snd.muted ? t('تشغيل الصوت') : t('كتم الصوت')} fb="display-mute">{snd.muted ? <VolumeX /> : <Volume2 />}</CornerBtn>}
          <CornerBtn onClick={toggleFull} label={full ? t('الخروج من ملء الشاشة') : t('ملء الشاشة')} fb="display-fullscreen">{full ? <Minimize2 /> : <Maximize2 />}</CornerBtn>
          <CornerBtn onClick={() => setOpen(!open)} label={t('إعدادات الشاشة')} fb="display-settings-open" on={open}><Settings2 /></CornerBtn>
        </div>
        {open && <SettingsPanel kind={kind} conf={conf} hostId={hostId} onClose={() => setOpen(false)} />}
      </div>
    </DeviceProvider>
  );
}

function CornerBtn({ children, onClick, label, fb, on }: { children: React.ReactNode; onClick: () => void; label: string; fb: string; on?: boolean }) {
  return <button onClick={onClick} title={label} aria-label={label} data-fb={fb} className={cn('w-11 h-11 rounded-xl border flex items-center justify-center backdrop-blur [&_svg]:w-5 [&_svg]:h-5', on ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent' : 'bg-[color-mix(in_srgb,var(--background)_70%,transparent)] border-[var(--glass-border)] text-[var(--foreground)]')}>{children}</button>;
}

const Row = ({ k, v, fb }: { k: string; v: React.ReactNode; fb: string }) => <div className="flex items-center justify-between gap-3 text-sm" data-fb={fb}><span className="text-soft">{k}</span><b className="text-end">{v}</b></div>;

/** The display's settings as the server holds them (inline, so it also works in full screen) — changed in «الأجهزة». */
function SettingsPanel({ kind, conf, hostId, onClose }: { kind: 'CALLBOARD' | 'CUSTOMER'; conf: DisplayConfig | null; hostId: string; onClose: () => void }) {
  const host = store.db.terminals.find((x) => x.id === hostId);
  // ux-12c: a call board follows a dispatch screen; a board left on a station-only screen says so
  const dispatch = store.db.terminals.filter((x) => x.lifecycle === 'ACTIVE' && x.kind === 'KDS' && kdsScreenOf(store.db, x.id).dispatch);
  const hostIsStation = kind === 'CALLBOARD' && dispatch.length > 0 && !dispatch.some((x) => x.id === hostId);
  return (
    <div className="absolute top-[calc(1.2cqmin+52px)] end-[1.2cqmin] z-30 w-[min(380px,calc(100%-2rem))] overlay-panel rounded-2xl p-4 space-y-3 text-[var(--foreground)]" role="dialog" aria-label={t('إعدادات الشاشة')} data-fb="display-settings">
      <div className="flex items-center justify-between"><div className="font-bold">{t('إعدادات الشاشة')}</div><button onClick={onClose} className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--surface-2)]" aria-label={t('إغلاق')}><X className="w-4 h-4" /></button></div>
      <div className="space-y-1.5 rounded-xl surface-1 border border-[var(--glass-border)] p-3" data-fb="display-server-settings">
        <Row k={t('الشاشة')} v={conf ? tv(conf.name) : '—'} fb="display-set:name" />
        <Row k={kind === 'CALLBOARD' ? t('تتبع شاشة') : t('تتبع جهاز')} v={host ? deviceName(host.id, host.kind, host.name) : '—'} fb="display-set:host" />
        <Row k={t('المظهر')} v={conf?.style === 'display' ? t('تباين عالٍ') : t('ألوان التطبيق')} fb="display-set:style" />
        <Row k={t('شريط الهوية')} v={conf?.branding === false ? t('مخفي') : t('ظاهر')} fb="display-set:branding" />
        {kind === 'CUSTOMER' && conf && <Row k={t('مدة الشريحة')} v={<><span className="num">{conf.slideSeconds}</span> {t('ث')}</>} fb="display-set:slide" />}
      </div>
      {hostIsStation && <div className="text-xs font-bold text-[var(--warning-text)]" data-fb="display-host-not-dispatch">{t('الشاشة المتبوعة ليست شاشة تسليم')}</div>}
      {kind === 'CALLBOARD' && <CallRuleRows />}
      <div className="text-xs text-dim" data-fb="display-managed-in">{t('تُغيَّر من شاشة «الأجهزة»')}</div>
    </div>
  );
}

/** ux-12c: the call rule of the venue (CallBoardPolicy), read-only here — it changes in the restaurant settings. */
function CallRuleRows() {
  const q = useQuery<any>('CallBoard.View');
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-1.5 rounded-xl surface-1 border border-[var(--glass-border)] p-3" data-fb="display-call-rule">
      <div className="text-xs font-bold text-soft">{t('من إعدادات المطعم')}</div>
      <Row k={t('النداء')} v={d.auto ? t('تلقائيًا عند جاهزية كل المحطات') : t('من شاشة التسليم بزر «نداء»')} fb="display-rule:call" />
      <Row k={t('مدة بقاء الرقم في «جاهز»')} v={<><span className="num">{d.readyMinutes}</span> {t('د')}</>} fb="display-rule:minutes" />
      <Row k={t('أرقام الدليفري')} v={d.delivery ? t('ظاهرة') : t('مخفية')} fb="display-rule:delivery" />
    </div>
  );
}
