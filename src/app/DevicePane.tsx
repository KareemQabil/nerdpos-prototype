// One simulated device: login gate (A1), legacy 80px sidebar, header, current screen,
// manager approval popup (C5) and the "result unknown" dialog.
import React, { Suspense, useMemo, useState } from 'react';
import { Box, LogOut, Lock, KeyRound, Delete, ShieldAlert, WifiOff, RefreshCw, Monitor, Bell } from 'lucide-react';
import { DeviceProvider, useQuery, useApprovals, useUnknowns, retryUnknown, errorText, type DevCtx, useDev } from './hooks';
import { devices, deviceLabel, useDevicesState } from './devices';
import { SCREENS, screenById, type Kind } from './registry';
import { call, ApiFailure } from '../api/client';
import { demo } from '../mock/demo';
import { store } from '../mock/store';
import { Button, Modal, Pill, Spinner, StateBadge, KV, Banner, Select, Input, Empty, toast, useNow } from '../ui';
import { t, L, useLang } from '../i18n';
import { cn, money, dateTime } from '../lib/format';
import { clock, businessDate, localTime } from '../mock/clock';
import { APPROVAL_ACTIONS } from '../mock/policyRegistry';
import { Tech } from './tech';
import { personName, deviceName, roleLabel, branchLabel } from '../demo/people'; // plain names (demo layer)
import { capabilityHiding, pendingApprovalCount } from '../screens/ops/capabilities-ui'; // operations & system area
import { OfflineBar } from '../screens/ops/OfflineBar';
import { RemoteApproval } from '../screens/ops/RemoteApproval';
import { ruleSentence, contextFieldLabel, contextValueText } from '../demo/policyText';

export function DevicePane({ id, compact }: { id: string; compact?: boolean }) {
  const ds = useDevicesState();
  const d = ds.devices[id] ?? devices.get(id);
  const auth = devices.auth(id);
  const terminal = store.db.terminals.find((x) => x.id === d.terminalId) ?? null;
  const kind: Kind = terminal ? terminal.kind : 'BO';
  const base: DevCtx = { id, auth, me: null, nav: (s, p) => devices.navigate(id, s, p ?? {}), screen: d.screen, params: d.params, can: () => false, kind, terminal };
  return (
    <DeviceProvider value={base}>
      <div className="h-full flex flex-col min-w-0 rounded-2xl overflow-hidden border border-[var(--glass-border)]" data-device={id}>
        {d.token ? <Authed compact={compact} /> : <LoginScreen />}
      </div>
    </DeviceProvider>
  );
}

function Authed({ compact }: { compact?: boolean }) {
  const base = useDev();
  const me = useQuery<any>('Access.Me');
  const perms: string[] = me.data?.effectivePermissions ?? [];
  const can = (p: string) => perms.includes('*') || perms.includes(p);
  const ctx: DevCtx = { ...base, me: me.data, can };
  if (!me.data) return <div className="flex-1 flex items-center justify-center"><Spinner /></div>;
  return (
    <DeviceProvider value={ctx}>
      <div className="flex-1 flex min-h-0">
        <Sidebar compact={compact} />
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <OfflineBar />
          <main className="flex-1 overflow-auto p-4 relative" data-screen={screenById.get(ctx.screen)?.code ?? ctx.screen}>
            <ScreenHost />
          </main>
        </div>
      </div>
      <ApprovalHost />
      <UnknownHost />
    </DeviceProvider>
  );
}

function ScreenHost() {
  const { screen, kind, can, auth, terminal } = useDev();
  const def = screenById.get(screen) ?? visibleScreens(kind as Kind, can, auth.branchId ?? terminal?.branchId ?? null)[0];
  if (!def) return <Empty text={t('مفيش شاشات متاحة للمستخدم ده على الجهاز ده')} />;
  const allowed = def.perm ? can(def.perm) : def.anyPerm ? def.anyPerm.some(can) : true;
  if (!allowed) return <Banner tone="error">{t('الحساب ده مش مسموح له يفتح الشاشة دي. ادخل بحساب تاني (مثلًا مدير).')}<Tech> <span className="num text-xs">({def.perm ?? def.anyPerm?.join(' | ')})</span></Tech></Banner>;
  const off = capabilityHiding(def, auth.branchId ?? terminal?.branchId ?? null);
  if (off) return <Banner tone="warning"><b>{t('الإمكانية دي مقفولة')}: {off.title}</b><div className="text-xs mt-1">{off.offEffect} {t('تتفتح من "إمكانيات النظام".')}</div></Banner>;
  const C = def.component;
  return <Suspense fallback={<Spinner />}><C key={screen} /></Suspense>;
}

export function visibleScreens(kind: Kind, can: (p: string) => boolean, branchId: string | null = null) {
  return SCREENS.filter((s) => !s.hidden && s.kinds.includes(kind) && (s.perm ? can(s.perm) : s.anyPerm ? s.anyPerm.some(can) : true) && !capabilityHiding(s, branchId));
}

function Sidebar({ compact }: { compact?: boolean }) {
  const { kind, can, screen, nav, me, id } = useDev();
  const lang = useLang();
  const items = visibleScreens(kind as Kind, can, me?.branchId ?? devices.auth(id).branchId ?? null);
  const approvalsWaiting = pendingApprovalCount(me?.branchId ?? devices.auth(id).branchId ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const alerts = store.db.alerts.filter((a) => !a.ack).length;
  return (
    <aside className={cn('sidebar-bg flex flex-col shrink-0 border-e border-white/10', compact ? 'w-[68px]' : 'w-20')}>
      <div className="h-14 flex items-center justify-center border-b border-white/[0.08]"><Box className="w-7 h-7 text-cyan-400" /></div>
      <nav className="flex-1 overflow-y-auto py-3 px-1.5 space-y-1.5 scrollbar-hide">
        {items.map((s) => {
          const active = screen === s.id || (s.id === 'floor' && (screen === 'order' || screen === 'pay')) || (s.id === 'checks' && screen === 'receipt');
          const Icon = s.icon;
          return (
            <div key={s.id} className="relative" onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)}>
              <button data-fb={`nav:${s.id}`} onClick={() => nav(s.id)} className={cn('relative w-full h-14 rounded-lg flex flex-col items-center justify-center gap-1 transition-all active:scale-95', active ? `bg-gradient-to-br ${s.gradient} text-slate-900 shadow-lg` : 'bg-white/[0.05] text-white/60 hover:bg-white/[0.1] hover:text-white/90')}>
                <Icon className="w-5 h-5" />
                <span className="text-[9px] font-bold leading-tight text-center px-0.5 line-clamp-2">{lang === 'ar' ? s.title : s.titleEn}</span>
                {active && <span className="absolute end-0 top-1/2 -translate-y-1/2 w-1 h-7 bg-cyan-400 rounded-s-full" />}
                {s.id === 'ereceipts' && alerts > 0 && <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{alerts}</span>}
                {s.id === 'approvals-inbox' && approvalsWaiting > 0 && <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center animate-pulse">{approvalsWaiting}</span>}
              </button>
              {hover === s.id && !compact && (
                <div className="absolute end-full me-2 top-1/2 -translate-y-1/2 z-50 pointer-events-none">
                  <div className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 shadow-xl whitespace-nowrap text-white">
                    <p className="text-xs font-bold">{s.title}<Tech> <span className="text-white/40">· {s.code}</span></Tech></p>
                    <p className="text-[10px] text-white/50">{s.titleEn}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/[0.08] p-1.5 space-y-1.5">
        <div className="flex flex-col items-center">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 border-2 border-cyan-400 flex items-center justify-center text-slate-900 font-bold">{(me?.user?.displayName ?? '?').replace('Demo ', '').charAt(0)}</div>
          <span className="text-[8px] text-white/50 mt-1 truncate max-w-full">{personName(me?.user?.username, me?.user?.displayName)}</span>
        </div>
        <button data-fb="logout" title={t('خروج')} onClick={async () => { try { await call(devices.auth(id), 'Auth.Logout', { body: {} }); } catch { /* ignore */ } devices.logout(id); }} className="w-full h-10 rounded-lg flex items-center justify-center bg-red-500/10 border border-red-500/50 text-red-400 hover:bg-red-500/20"><LogOut className="w-4 h-4" /></button>
      </div>
    </aside>
  );
}

const dayName = (bd: string) => { try { return new Date(bd + 'T12:00:00Z').toLocaleDateString(L({ ar: 'ar-EG-u-nu-latn', en: 'en-GB' }), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); } catch { return bd; } };
function Header() {
  const { me, terminal, auth, id, nav } = useDev();
  useNow(15000);
  const session = useQuery<any>(terminal?.drawer ? 'Session.Current' : null, { query: { terminalId: terminal?.id } });
  const branch = store.db.branches.find((b) => b.id === (me?.branchId ?? auth.branchId));
  const bd = businessDate(clock.now(), branch?.timezone, branch?.businessDayCutoff);
  const lang = useLang();
  const lbl = deviceLabel(id, lang);
  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-4 border-b line glass-light overflow-x-auto scrollbar-hide">
      <div className="flex items-center gap-2 min-w-0">
        <Monitor className="w-4 h-4 text-[var(--primary)] shrink-0" />
        <div className="leading-tight min-w-0">
          <div className="text-sm font-bold truncate">{me?.user?.displayName}{!String(me?.user?.displayName ?? '').includes(' — ') && <span className="text-dim font-normal"> · {me?.user?.roleAssignments?.map((r: any) => roleLabel(r.roleName)).join('، ')}</span>}<Tech><span className="num text-[10px] text-dim font-normal ms-1">{me?.user?.username}</span></Tech></div>
          <div className="text-[11px] text-dim truncate">{deviceName(id, terminal?.kind, terminal?.name)} · {branchLabel(branch) || t('من غير فرع')}<Tech> · <span className="num">{lbl.code}</span></Tech></div>
        </div>
      </div>
      <div className="flex-1" />
      {terminal?.drawer && (session.data ? <Pill tone="success" title={t('الوردية المفتوحة على الجهاز ده')}>{t('الوردية مفتوحة')} · {(() => { const u = store.db.users.find((x) => x.id === session.data.userId); return personName(u?.username, u?.displayName); })()}</Pill> : <button onClick={() => nav('shift')} title={t('اضغط عشان تفتح وردية')}><Pill tone="warning">{t('مفيش وردية مفتوحة — افتح وردية')}</Pill></button>)}
      {terminal && !terminal.drawer && <Pill tone="neutral">{t('جهاز من غير درج')}</Pill>}
      <Pill tone="primary" title={t('اليوم التجاري بيبدأ الساعة 4 الفجر بتوقيت القاهرة — البيع بعد نص الليل بيتحسب على اليوم اللي قبله')}>{t('اليوم التجاري')} <span>{dayName(bd)}</span><Tech><span className="num ms-1">{bd}</span></Tech></Pill>
      <span className="num text-sm text-soft">{localTime(clock.now(), branch?.timezone)}</span>
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
  return (
    <div className="flex-1 overflow-auto flex items-start justify-center p-6" data-screen="A1">
      <div className="w-full max-w-3xl grid md:grid-cols-2 gap-5">
        <div className="glass rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-bold">{t('مين هيشتغل على الجهاز ده؟')}</h2><StateBadge ops={['Auth.Login', 'Access.Me']} /></div>
          <KV rows={[
            [t('الجهاز'), <span>{deviceName(id, terminal?.kind, terminal?.name)}<Tech><span className="num text-[10px] text-dim ms-1">{lbl.code}</span></Tech></span>],
            [t('الفرع'), terminal ? branchLabel(branch) || '—' : <Select value={boBranch} onChange={(e) => setBoBranch(e.target.value)} options={[{ value: '', label: t('من غير فرع') }, ...store.db.branches.map((b) => ({ value: b.id, label: branchLabel(b) }))]} />],
            [t('درج الفلوس'), terminal?.drawer ? t('عليه درج') : t('من غير درج')],
          ]} />
          <div className="text-xs font-bold text-soft">{t('اختار اسمك')}</div>
          <div className="grid grid-cols-1 gap-1.5 max-h-[300px] overflow-auto pe-1">
            {sorted.map((u) => (
              <button key={u.id} data-fb={`login-user:${u.username}`} onClick={() => { setUserId(u.id); setPin(''); setErr(null); }} className={cn('flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-start transition-colors', userId === u.id ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1 hover:surface-2', !u.scoped && 'opacity-60')}>
                <div className="min-w-0"><div className="text-sm font-bold truncate">{u.displayName}</div><Tech><div className="text-[11px] text-dim num truncate">{u.username}</div></Tech></div>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {!String(u.displayName).includes(' — ') && u.roles.map((r) => <Pill key={r} tone="neutral">{roleLabel(r)}</Pill>)}
                  {u.scoped && fitsDevice(kind, u.roles) && <Pill tone="primary">{t('مناسب للجهاز ده')}</Pill>}
                  {!u.scoped && <Pill tone="warning">{t('مش شغال في الفرع ده')}</Pill>}
                  {u.locked && <Pill tone="error"><Lock className="w-3 h-3" />{t('مقفول مؤقتًا')}</Pill>}
                </div>
              </button>
            ))}
            {users.length === 0 && <Empty text={t('مفيش حد متسجل لسه')} />}
          </div>
        </div>
        <div className="glass rounded-2xl p-5 flex flex-col items-center gap-4">
          <KeyRound className="w-8 h-8 text-[var(--primary)]" />
          <div className="text-sm text-soft text-center">{chosen ? t('{n}، اكتب رقمك السري', { n: personName(chosen.username, chosen.displayName) }) : t('اختار اسمك الأول')}</div>
          <div className="flex gap-2 num" dir="ltr">{Array.from({ length: 6 }, (_, i) => <span key={i} className={cn('w-9 h-11 rounded-lg border flex items-center justify-center text-xl', i < pin.length ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1')}>{i < pin.length ? '•' : ''}</span>)}</div>
          {err && <Banner tone="error"><div>{err.text}</div>{err.details?.attemptsLeft !== undefined && <div className="text-[11px] text-dim">{t('فاضل {n} محاولات قبل ما الحساب يتقفل', { n: err.details.attemptsLeft })}</div>}<Tech><div className="text-[11px] num text-dim">{err.code}</div></Tech></Banner>}
          <div className="grid grid-cols-3 gap-2 num" dir="ltr">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
              <button key={k} disabled={!userId || busy || (k === 'ok' && pin.length === 0)} onClick={() => (k === 'ok' ? submit(pin) : press(k))} className="w-16 h-14 rounded-xl surface-2 border border-[var(--glass-border)] text-xl font-bold hover:border-[var(--primary)] disabled:opacity-30 flex items-center justify-center">{k === 'del' ? <Delete className="w-5 h-5" /> : k === 'ok' ? '✓' : k}</button>
            ))}
          </div>
          <div className="text-[11px] text-dim text-center">{t('تجربة: الرقم السري لكل الناس')} <span className="num font-bold text-soft">{demo.pin}</span> — {t('لو غلطت 5 مرات الحساب بيتقفل 15 دقيقة.')}</div>
          {userId && <Button size="sm" variant="ghost" onClick={() => submit(demo.pin)} data-fb="login-quick">{t('دخول سريع (تجربة)')}</Button>}
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
      setErr(`${errorText(e)} (${f.code})`);
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
          <div className="space-y-1.5"><div className="text-xs font-bold text-soft">PIN</div><Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" onKeyDown={(e) => e.key === 'Enter' && grant()} /></div>
        </div>
        {err && <Banner tone="error">{err}</Banner>}
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
        <KV className="num text-xs" rows={[['operation', u.opId], ['X-Command-Id', u.commandId]]} />
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
