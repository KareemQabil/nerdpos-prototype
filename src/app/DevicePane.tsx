// One simulated device: login gate (A1), sectioned sidebar (DeviceNav), header, current screen,
// manager approval popup (C5) and the "result unknown" dialog.
import React, { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LogOut, Lock, KeyRound, Delete, ShieldAlert, WifiOff, RefreshCw, Monitor, CalendarDays, Clock3, Wallet, ShoppingCart, Armchair, ChefHat, Briefcase, Building2, Check, Zap, Inbox } from 'lucide-react';
import { DeviceProvider, useQuery, useApprovals, useUnknowns, retryUnknown, errorText, type DevCtx, useDev } from './hooks';
import { devices, deviceLabel, useDevicesState } from './devices';
import { screenById, type Kind } from './registry';
import { call, ApiFailure } from '../api/client';
import { demo } from '../mock/demo';
import { store } from '../mock/store';
import { sim } from '../mock/sim';
import { Button, Modal, Pill, Spinner, StateBadge, KV, Banner, Select, Input, Empty, EmptyState, Avatar, Skeleton, toast, useNow } from '../ui';
import { t, L, useLang } from '../i18n';
import { cn, money, dateTime } from '../lib/format';
import { clock, businessDate, localTime } from '../mock/clock';
import { APPROVAL_ACTIONS } from '../mock/policyRegistry';
import { Tech } from './tech';
import { personName, deviceName, roleLabel, branchLabel } from '../demo/people'; // plain names (demo layer)
import { capabilityHiding } from '../screens/ops/capabilities-ui'; // operations & system area
import { OfflineBar } from '../screens/ops/OfflineBar';
import { RemoteApproval } from '../screens/ops/RemoteApproval';
import { ruleSentence, contextFieldLabel, contextValueText } from '../demo/policyText';
import { Sidebar, visibleScreens, markPane } from './DeviceNav';
export { visibleScreens } from './DeviceNav';

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = { CASH: ShoppingCart, FLOOR: Armchair, KDS: ChefHat, ADMIN: Briefcase, BO: Building2 };

/** Width of an element, kept up to date (drives wide sidebar vs compact rail). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1600));
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function DevicePane({ id, compact }: { id: string; compact?: boolean }) {
  const ds = useDevicesState();
  const d = ds.devices[id] ?? devices.get(id);
  const auth = devices.auth(id);
  const terminal = store.db.terminals.find((x) => x.id === d.terminalId) ?? null;
  const kind: Kind = terminal ? terminal.kind : 'BO';
  const base: DevCtx = { id, auth, me: null, nav: (s, p) => devices.navigate(id, s, p ?? {}), screen: d.screen, params: d.params, can: () => false, kind, terminal };
  const [ref, width] = useWidth<HTMLDivElement>();
  return (
    <DeviceProvider value={base}>
      <div ref={ref} onPointerDownCapture={() => markPane(id)} className="device-frame h-full flex flex-col min-w-0 rounded-2xl overflow-hidden border border-[var(--glass-border)]" data-device={id}>
        {d.token ? <Authed compact={compact} width={width} /> : <LoginScreen />}
      </div>
    </DeviceProvider>
  );
}

function Authed({ compact, width }: { compact?: boolean; width: number }) {
  const base = useDev();
  const me = useQuery<any>('Access.Me');
  const perms: string[] = me.data?.effectivePermissions ?? [];
  const can = (p: string) => perms.includes('*') || perms.includes(p);
  const ctx: DevCtx = { ...base, me: me.data, can };
  if (!me.data) return <div className="flex-1 flex items-center justify-center"><Spinner /></div>;
  return (
    <DeviceProvider value={ctx}>
      <div className="flex-1 flex min-h-0">
        <Sidebar paneWidth={width} compact={compact} />
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <OfflineBar />
          <main className="@container/main flex-1 overflow-auto px-5 py-5 relative device-main" data-screen={screenById.get(ctx.screen)?.code ?? ctx.screen}>
            <ScreenHost />
          </main>
        </div>
      </div>
      <ApprovalHost />
      <UnknownHost />
    </DeviceProvider>
  );
}

function ScreenFallback() {
  return <div className="space-y-4 animate-fade-in" aria-busy><div className="space-y-2"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-80" /></div><div className="grid grid-cols-3 gap-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div><Skeleton className="h-64 rounded-2xl" /></div>;
}

function ScreenHost() {
  const { screen, kind, can, auth, terminal } = useDev();
  const def = screenById.get(screen) ?? visibleScreens(kind as Kind, can, auth.branchId ?? terminal?.branchId ?? null)[0];
  if (!def) return <EmptyState icon={<Inbox />} title={t('مفيش شاشات متاحة')} text={t('مفيش شاشات متاحة للمستخدم ده على الجهاز ده. ادخل بحساب تاني.')} />;
  const allowed = def.perm ? can(def.perm) : def.anyPerm ? def.anyPerm.some(can) : true;
  if (!allowed) return <div className="max-w-xl mx-auto mt-10"><EmptyState icon={<Lock />} title={t('الشاشة دي مش متاحة للحساب ده')} text={<>{t('الحساب ده مش مسموح له يفتح الشاشة دي. ادخل بحساب تاني (مثلًا مدير).')}<Tech> <span className="num text-xs">({def.perm ?? def.anyPerm?.join(' | ')})</span></Tech></>} /></div>;
  const off = capabilityHiding(def, auth.branchId ?? terminal?.branchId ?? null);
  if (off) return <Banner tone="warning" title={`${t('الإمكانية دي مقفولة')}: ${off.title}`}><div className="text-xs">{off.offEffect} {t('تتفتح من "إمكانيات النظام".')}</div></Banner>;
  const C = def.component;
  return <Suspense fallback={<ScreenFallback />}><C key={screen} /></Suspense>;
}

// ───────── device header: person, device, branch, shift, business date, network
const dayName = (bd: string) => { try { return new Date(bd + 'T12:00:00Z').toLocaleDateString(L({ ar: 'ar-EG-u-nu-latn', en: 'en-GB' }), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch { return bd; } };
function Chip({ icon, children, tone = 'neutral', title, onClick, className, fb }: { icon?: React.ReactNode; children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'error' | 'primary'; title?: string; onClick?: () => void; className?: string; fb?: string }) {
  const c = { neutral: 'text-soft border-[var(--glass-border)] bg-[var(--surface-1)]', success: 'text-[var(--success)] border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)]', warning: 'text-[var(--warning-text)] border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)]', error: 'text-[var(--error)] border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_12%,transparent)]', primary: 'text-[var(--primary)] border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--primary-container)]' }[tone];
  const Comp: any = onClick ? 'button' : 'div';
  return <Comp onClick={onClick} title={title} data-fb={fb} className={cn('h-8 px-2.5 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:shrink-0', c, onClick && 'hover:brightness-110 transition', className)}>{icon}{children}</Comp>;
}
function Header() {
  const { me, terminal, auth, id, nav } = useDev();
  useNow(15000);
  const s = useSyncExternalStore(sim.subscribe, sim.get);
  const offline = (s.offlineDevices ?? []).includes(id);
  const session = useQuery<any>(terminal?.drawer ? 'Session.Current' : null, { query: { terminalId: terminal?.id } });
  const branch = store.db.branches.find((b) => b.id === (me?.branchId ?? auth.branchId));
  const bd = businessDate(clock.now(), branch?.timezone, branch?.businessDayCutoff);
  const lang = useLang();
  const lbl = deviceLabel(id, lang);
  const KIcon = KIND_ICON[terminal?.kind ?? 'BO'] ?? Monitor;
  const dn = String(me?.user?.displayName ?? '');
  const roleText = dn.includes(' — ') ? dn.split(' — ')[1] : me?.user?.roleAssignments?.map((r: any) => roleLabel(r.roleName)).join('، ');
  const opener = session.data ? (() => { const u = store.db.users.find((x) => x.id === session.data.userId); return personName(u?.username, u?.displayName); })() : null;
  return (
    <header className="@container/hdr h-14 shrink-0 flex items-center gap-3 px-4 border-b line device-header">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span className="w-9 h-9 rounded-xl bg-[var(--surface-2)] border border-[var(--glass-border)] flex items-center justify-center shrink-0 text-[var(--primary)]" title={deviceName(id, terminal?.kind, terminal?.name)}><KIcon className="w-[18px] h-[18px]" /></span>
        <div className="leading-tight min-w-0">
          <div className="text-sm font-bold truncate">{personName(me?.user?.username, me?.user?.displayName)}<span className="text-dim font-normal">{roleText ? ` · ${roleText}` : ''}</span><Tech><span className="num text-[10px] text-dim font-normal ms-1">{me?.user?.username}</span></Tech></div>
          <div className="text-[11px] text-dim truncate">{deviceName(id, terminal?.kind, terminal?.name)} · {branchLabel(branch) || t('من غير فرع')}<Tech> · <span className="num">{lbl.code}</span></Tech></div>
        </div>
      </div>
      <div className="flex items-center gap-1.5 min-w-0 shrink overflow-x-auto scrollbar-hide">
        {offline && <Chip tone="error" icon={<WifiOff />} fb="hdr-offline" title={t('الجهاز ده مفصول عن النت (محاكاة). الحركات بتتحفظ على الجهاز وتتبعت لما النت يرجع.')} onClick={() => sim.setOffline(id, false)}>{t('مفيش نت')}</Chip>}
        {terminal?.drawer && (session.data
          ? <Chip tone="success" icon={<Wallet />} title={t('الوردية المفتوحة على الجهاز ده')} onClick={() => nav('shift')} fb="hdr-shift"><span className="@max-[34rem]/hdr:hidden">{t('الوردية مفتوحة')} · </span>{opener}</Chip>
          : <Chip tone="warning" icon={<Wallet />} title={t('اضغط عشان تفتح وردية')} onClick={() => nav('shift')} fb="hdr-shift">{t('مفيش وردية — افتح وردية')}</Chip>)}
        {terminal && !terminal.drawer && <Chip className="@max-[44rem]/hdr:hidden" title={t('الجهاز ده مالوش درج فلوس — التحصيل بيتم على جهاز الكاشير')}>{t('من غير درج')}</Chip>}
        <Chip tone="primary" icon={<CalendarDays />} title={t('اليوم التجاري بيبدأ الساعة 4 الفجر بتوقيت القاهرة — البيع بعد نص الليل بيتحسب على اليوم اللي قبله')}><span className="@max-[38rem]/hdr:hidden">{t('اليوم التجاري')}</span> <span>{dayName(bd)}</span><Tech><span className="num ms-1">{bd}</span></Tech></Chip>
        <Chip icon={<Clock3 />} className="num @max-[30rem]/hdr:hidden" title={t('الساعة دلوقتي في الفرع')}>{localTime(clock.now(), branch?.timezone)}</Chip>
      </div>
    </header>
  );
}

// ───────── A1 login and PIN
// Plain wording for demo users: "اختار اسمك", device and branch names, personas; usernames/codes only in <Tech>.
const FITS: Record<string, string[]> = { CASH: ['cashier', 'manager'], FLOOR: ['waiter'], KDS: ['chef'], ADMIN: ['manager', 'owner'], BO: ['owner', 'bootstrap', 'manager'] };
const fitsDevice = (kind: string, roles: string[]) => roles.some((r) => (FITS[kind] ?? []).some((k) => r.toLowerCase().includes(k)));
function LoginScreen() {
  const { id, auth, terminal } = useDev();
  const lang = useLang();
  const users = demo.directory(terminal?.id ?? null);
  const kind = terminal?.kind ?? 'BO';
  const sorted = [...users].sort((a, b) => Number(b.scoped) - Number(a.scoped) || Number(fitsDevice(kind, b.roles)) - Number(fitsDevice(kind, a.roles)));
  const [userId, setUserId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<{ text: string; code: string; details?: any } | null>(null);
  const [busy, setBusy] = useState(false);
  const branch = store.db.branches.find((b) => b.id === (terminal?.branchId ?? auth.branchId));
  const [boBranch, setBoBranch] = useState(auth.branchId ?? store.db.branches[0]?.id ?? '');
  const lbl = deviceLabel(id, lang);
  const chosen = users.find((u) => u.id === userId);
  const KIcon = KIND_ICON[kind] ?? Monitor;
  const submit = async (secret: string) => {
    if (!userId) return;
    setBusy(true); setErr(null);
    try {
      const a = { ...auth, branchId: terminal ? terminal.branchId : boBranch || null };
      const r = await call(a, 'Auth.Login', { body: { method: 'PIN', userId, secret } });
      devices.update(id, { token: r.data.token, userName: r.data.user.displayName, branchId: r.data.branchId ?? a.branchId });
      toast('success', t('أهلًا يا {name}', { name: personName(r.data.user.username, r.data.user.displayName).replace(/^ال/, '') }), `Auth.Login 200 · ${lbl.code}`, lbl.short);
    } catch (e) {
      const f = e as ApiFailure;
      setErr({ text: errorText(e), code: `${f.code} · ${f.status}`, details: f.details });
      setPin('');
    } finally { setBusy(false); }
  };
  const press = (k: string) => {
    if (k === 'del') return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 6);
    setPin(next);
    if (next.length === 6) submit(next);
  };
  const fit = sorted.filter((u) => u.scoped && fitsDevice(kind, u.roles));
  const rest = sorted.filter((u) => !(u.scoped && fitsDevice(kind, u.roles)));
  const UserBtn = ({ u }: { u: (typeof users)[number] }) => {
    const on = userId === u.id;
    const [nm, role] = String(u.displayName).split(' — ');
    return (
      <button data-fb={`login-user:${u.username}`} onClick={() => { setUserId(u.id); setPin(''); setErr(null); }} aria-pressed={on}
        className={cn('flex items-center gap-3 px-3 py-2.5 rounded-xl border text-start transition-all', on ? 'border-[var(--primary)] bg-[var(--primary-container)] shadow-[0_0_0_3px_var(--primary-glow-dim)]' : 'border-[var(--glass-border)] bg-[var(--surface-1)] hover:bg-[var(--surface-2)] hover:border-[color-mix(in_srgb,var(--primary)_35%,var(--glass-border))]', !u.scoped && 'opacity-60')}>
        <Avatar name={nm} size="md" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{nm}</div>
          <div className="text-[11px] text-dim truncate">{role ?? u.roles.map((r) => roleLabel(r)).join('، ')}<Tech><span className="num ms-1">{u.username}</span></Tech></div>
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {!u.scoped && <Pill tone="warning" size="sm">{t('مش شغال في الفرع ده')}</Pill>}
          {u.locked && <Pill tone="error" size="sm"><Lock className="w-3 h-3" />{t('مقفول مؤقتًا')}</Pill>}
          {on && <span className="w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] flex items-center justify-center"><Check className="w-3 h-3" /></span>}
        </div>
      </button>
    );
  };
  return (
    <div className="flex-1 overflow-auto flex items-start justify-center p-4 sm:p-8 login-bg" data-screen="A1">
      <div className="w-full max-w-4xl space-y-4">
        {/* device strip */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="w-11 h-11 rounded-2xl bg-[var(--primary-container)] text-[var(--primary)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] flex items-center justify-center shrink-0"><KIcon className="w-5 h-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap"><h2 className="text-xl font-extrabold tracking-tight">{t('مين هيشتغل على الجهاز ده؟')}</h2><StateBadge ops={['Auth.Login', 'Access.Me']} /></div>
            <div className="text-sm text-dim flex items-center gap-x-2 gap-y-1 flex-wrap mt-0.5">
              <span>{deviceName(id, terminal?.kind, terminal?.name)}<Tech><span className="num text-[10px] ms-1">{lbl.code}</span></Tech></span>
              <span className="opacity-40">•</span>
              {terminal ? <span>{branchLabel(branch) || '—'}</span> : <Select value={boBranch} onChange={(e) => setBoBranch(e.target.value)} options={[{ value: '', label: t('من غير فرع') }, ...store.db.branches.map((b) => ({ value: b.id, label: branchLabel(b) }))]} className="!w-auto !min-h-0 !py-1 text-xs" aria-label={t('الفرع')} />}
              <span className="opacity-40">•</span>
              <span>{terminal?.drawer ? t('عليه درج فلوس') : t('من غير درج')}</span>
            </div>
          </div>
        </div>
        <div className="grid md:grid-cols-[1.25fr_1fr] gap-4">
          <div className="glass rounded-2xl p-4 flex flex-col min-h-0">
            <div className="text-xs font-bold text-soft mb-2">{t('اختار اسمك')}</div>
            <div className="space-y-3 max-h-[min(440px,56vh)] overflow-auto -me-1 pe-1">
              {fit.length > 0 && <div className="space-y-1.5"><div className="text-[11px] text-dim flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />{t('مناسب للجهاز ده')}</div><div className="grid gap-1.5">{fit.map((u) => <UserBtn key={u.id} u={u} />)}</div></div>}
              {rest.length > 0 && <div className="space-y-1.5">{fit.length > 0 && <div className="text-[11px] text-dim">{t('باقي الناس')}</div>}<div className="grid gap-1.5">{rest.map((u) => <UserBtn key={u.id} u={u} />)}</div></div>}
              {users.length === 0 && <Empty text={t('مفيش حد متسجل لسه')} />}
            </div>
          </div>
          <div className="glass rounded-2xl p-5 flex flex-col items-center gap-4">
            <div className="flex flex-col items-center gap-2 text-center min-h-[64px] justify-center">
              {chosen ? <Avatar name={String(chosen.displayName).split(' — ')[0]} size="lg" /> : <span className="w-12 h-12 rounded-full bg-[var(--surface-2)] border border-[var(--glass-border)] flex items-center justify-center text-dim"><KeyRound className="w-5 h-5" /></span>}
              <div className="text-sm text-soft">{chosen ? t('{n}، اكتب رقمك السري', { n: personName(chosen.username, chosen.displayName) }) : t('اختار اسمك الأول')}</div>
            </div>
            <div className="flex gap-2 num" dir="ltr" aria-label={t('الرقم السري')}>{Array.from({ length: 6 }, (_, i) => <span key={i} className={cn('w-9 h-11 rounded-xl border flex items-center justify-center text-xl transition-colors', i < pin.length ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'border-[var(--glass-border)] bg-[var(--surface-1)]')}>{i < pin.length ? '•' : ''}</span>)}</div>
            {err && <Banner tone="error"><div>{err.text}</div>{err.details?.attemptsLeft !== undefined && <div className="text-[11px] text-dim">{t('فاضل {n} محاولات قبل ما الحساب يتقفل', { n: err.details.attemptsLeft })}</div>}<Tech><div className="text-[11px] num text-dim">{err.code}</div></Tech></Banner>}
            <div className="grid grid-cols-3 gap-2 num" dir="ltr">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
                <button key={k} disabled={!userId || busy || (k === 'ok' && pin.length === 0)} onClick={() => (k === 'ok' ? submit(pin) : press(k))} aria-label={k === 'del' ? t('امسح رقم') : k === 'ok' ? t('دخول') : k}
                  className={cn('w-[72px] h-14 rounded-xl border text-xl font-bold flex items-center justify-center transition-all active:scale-95 disabled:opacity-30', k === 'ok' ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent' : 'bg-[var(--surface-2)] border-[var(--glass-border)] hover:border-[var(--primary)]')}>{k === 'del' ? <Delete className="w-5 h-5" /> : k === 'ok' ? <Check className="w-5 h-5" /> : k}</button>
              ))}
            </div>
            {userId && <Button variant="subtle" className="w-full" onClick={() => submit(demo.pin)} loading={busy} data-fb="login-quick"><Zap className="w-4 h-4" />{t('دخول سريع (تجربة)')}</Button>}
            <div className="text-[11px] text-dim text-center leading-relaxed">{t('تجربة: الرقم السري لكل الناس')} <span className="num font-bold text-soft">{demo.pin}</span> — {t('لو غلطت 5 مرات الحساب بيتقفل 15 دقيقة.')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────── C5 manager approval popup
function ApprovalHost() {
  const { id } = useDev();
  const list = useApprovals(id);
  const req = list[0];
  if (!req) return null;
  return <ApprovalDialog key={req.id} req={req} />;
}

function ApprovalDialog({ req }: { req: ReturnType<typeof useApprovals>[number] }) {
  const d = req.details;
  const def = APPROVAL_ACTIONS.find((a) => a.id === d.action);
  const branchId = req.auth.branchId ?? store.db.terminals.find((x) => x.id === req.auth.terminalId)?.branchId ?? null;
  const approvers = demo.approvers(d.action, branchId);
  const [approver, setApprover] = useState(approvers.find((a) => a.can)?.id ?? '');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitInBackground, setWaitInBackground] = useState(false); // remote approval: let the user switch devices while waiting
  const rule = d.rule;
  const ruleText = rule?.mode === 'ALWAYS' ? t('دايمًا') : rule?.mode === 'ABOVE_THRESHOLD' ? `${rule.field} > ${rule.threshold}` : rule?.mode === 'WHEN_TRUE' ? `${rule.field} = true` : rule?.mode === 'ANY_OF' ? 'ANY_OF' : rule?.mode;
  const grant = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await call(req.auth, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId: approver, approverCredentialKind: 'PIN', approverSecret: pin } });
      toast('success', t('اتمنحت الموافقة — بنعيد نفس الطلب أوتوماتيك'), `grant ${r.data.grantId} · expires ${dateTime(r.data.expiresAt)}`, req.auth.label);
      req.resolve(r.data.grantId);
    } catch (e) {
      const f = e as ApiFailure;
      setErr(errorText(e)); setErrCode(f.code);
      setPin('');
    } finally { setBusy(false); }
  };
  if (waitInBackground) return <RemoteApproval req={req} floating onExpand={() => setWaitInBackground(false)} />;
  return (
    <Modal open onClose={() => req.resolve(null)} title={<span className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-[var(--warning)]" />{t('موافقة مدير مطلوبة')}</span>} badge={<StateBadge ops={['Approval.Grant']} />}
      footer={<><Button variant="ghost" onClick={() => req.resolve(null)}>{t('إلغاء — مفيش حاجة هتتكتب')}</Button><Button variant="primary" loading={busy} disabled={!approver || pin.length < 4} onClick={grant}>{t('موافقة')}</Button></>}>
      <div className="space-y-4" data-screen="C5">
        <div className="rounded-xl surface-1 p-3">
          <div className="text-xs text-dim">{t('العملية')}</div>
          <div className="font-bold text-lg">{def?.title ? t(def.title) : t('عملية محتاجة موافقة')}<Tech><span className="num text-xs text-dim ms-1">{d.action}</span></Tech></div>
          <div className="text-xs text-dim mt-1">{ruleSentence(d.action, rule)}<Tech><span className="num"> · {ruleText} · {d.opId}</span></Tech></div>
        </div>
        <div>
          <div className="text-xs font-bold text-soft mb-1">{t('بالظبط بتوافق على إيه')}</div>
          <KV className="text-xs" rows={Object.entries(d.context ?? {}).filter(([k, v]) => v !== null && v !== '' && !/Id$|Version$|Hash$/.test(k)).map(([k, v]) => [contextFieldLabel(k), plainContextValue(k, v)] as [string, string])} />
          <Tech><KV className="num text-[10px] mt-1" rows={[['targetType', d.targetType], ['targetId', d.targetId], ...Object.entries(d.context ?? {}).map(([k, v]) => [k, v === null ? 'null' : String(v)] as [string, string])]} /></Tech>
        </div>
        <Banner tone="info">{t('الموافقة بتتستخدم مرة واحدة للعملية دي بالظبط، ومن نفس الجهاز، وبتخلص بعد دقيقتين. صاحب الطلب مينفعش يوافق لنفسه.')}</Banner>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><div className="text-xs font-bold text-soft">{t('المدير')}</div>
            <Select value={approver} onChange={(e) => setApprover(e.target.value)} options={[{ value: '', label: t('اختار') }, ...approvers.map((a) => ({ value: a.id, label: `${a.displayName}${a.can ? '' : ' — ' + t('مالوش صلاحية')}` }))]} />
          </div>
          <div className="space-y-1.5"><div className="text-xs font-bold text-soft">{t('الرقم السري')}</div><Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" onKeyDown={(e) => e.key === 'Enter' && grant()} /></div>
        </div>
        {err && <Banner tone="error">{err}<Tech><span className="num text-[11px] text-dim ms-1">({errCode})</span></Tech></Banner>}
        <RemoteApproval req={req} onBackground={() => setWaitInBackground(true)} />
        <div className="text-[11px] text-dim">{t('بيانات عرض: الرقم السري')} <span className="num">{demo.pin}</span></div>
      </div>
    </Modal>
  );
}

function UnknownHost() {
  const { id } = useDev();
  const list = useUnknowns(id);
  const u = list[0];
  const [busy, setBusy] = useState(false);
  if (!u) return null;
  return (
    <Modal open onClose={() => { /* no new intent while unknown */ }} title={<span className="flex items-center gap-2"><WifiOff className="w-5 h-5 text-[var(--warning)]" />{t('النتيجة مش معروفة')}</span>}
      footer={<Button variant="primary" loading={busy} onClick={async () => { setBusy(true); await retryUnknown(u); setBusy(false); }}><RefreshCw className="w-4 h-4" />{t('إعادة المحاولة بنفس الطلب')}</Button>}>
      <div className="space-y-3">
        <p>{t('الطلب اتبعت بس الرد ضاع. ممكن يكون اتنفذ. إعادة المحاولة بتبعت نفس رقم الأمر ونفس البيانات، فلو كان اتنفذ هيرجع نفس النتيجة ومش هيتكرر.')}</p>
        <Tech><KV className="num text-xs" rows={[['operation', u.opId], ['X-Command-Id', u.commandId]]} /></Tech>
        <Banner tone="warning">{t('لحد ما النتيجة تتعرف، مفيش "دفعة جديدة" على الشيك ده.')}</Banner>
      </div>
    </Modal>
  );
}

/** Approval context values in words (reason labels, kinds); raw values stay in <Tech>. */
const CTX_KIND: Record<string, string> = { PERCENTAGE: 'نسبة', FIXED_AMOUNT: 'مبلغ ثابت', CASH: 'كاش', CARD: 'كارت', DIGITAL_WALLET: 'محفظة', PAY_IN: 'إدخال فلوس للدرج', PAY_OUT: 'صرف من الدرج', SAFE_DROP: 'إيداع في الخزنة' };
function plainContextValue(k: string, v: unknown): string {
  if (k === 'reasonCode') return L(store.db.reasonCodes.find((r) => r.code === v)?.label) || t('سبب من القايمة');
  if (typeof v === 'string' && CTX_KIND[v]) return t(CTX_KIND[v]);
  if (typeof v === 'string' && /^[A-Z][A-Z_]{2,}$/.test(v)) return '—';
  return contextValueText(k, v);
}
