// Device navigation: a sectioned sidebar (wide + labelled on large panes, a compact rail on tablets / split view)
// and a quick screen search (Ctrl+K / «دوّر على شاشة»). Sections come from `group` in the screen registry,
// ordered for the person's role (a waiter sees service first). Every item keeps data-fb="nav:<id>".
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, ChevronDown, LogOut, PanelRightClose, PanelRightOpen, CornerDownLeft,
  LayoutDashboard, ConciergeBell, Wallet, Bike, Contact, Boxes, BookOpen, FileBarChart, Settings2, Landmark, Activity,
} from 'lucide-react';
import { useDev } from './hooks';
import { devices } from './devices';
import { SCREENS, SCREEN_GROUPS, type Kind, type ScreenDef, type ScreenGroup } from './registry';
import { call } from '../api/client';
import { store } from '../mock/store';
import { Avatar, Kbd } from '../ui';
import { t, L, useLang } from '../i18n';
import { cn } from '../lib/format';
import { Tech } from './tech';
import { personName, personRole, roleLabel } from '../demo/people';
import { capabilityHiding, pendingApprovalCount } from '../screens/ops/capabilities-ui';

export function visibleScreens(kind: Kind, can: (p: string) => boolean, branchId: string | null = null) {
  return SCREENS.filter((s) => !s.hidden && s.kinds.includes(kind) && (s.perm ? can(s.perm) : s.anyPerm ? s.anyPerm.some(can) : true) && !capabilityHiding(s, branchId));
}

const GROUP_ICON: Record<ScreenGroup, React.ComponentType<{ className?: string }>> = {
  home: LayoutDashboard, service: ConciergeBell, money: Wallet, delivery: Bike, customers: Contact, inventory: Boxes,
  menu: BookOpen, reports: FileBarChart, setup: Settings2, compliance: Landmark, system: Activity,
};

/** Section order per role: the work a person does most comes first. */
type Persona = 'waiter' | 'cashier' | 'chef' | 'manager';
const ORDER: Record<Persona, ScreenGroup[]> = {
  waiter: ['service', 'customers', 'menu', 'home', 'money', 'delivery', 'reports', 'inventory', 'setup', 'compliance', 'system'],
  cashier: ['service', 'money', 'delivery', 'customers', 'menu', 'home', 'reports', 'compliance', 'inventory', 'setup', 'system'],
  chef: ['service', 'menu', 'inventory', 'home', 'money', 'delivery', 'customers', 'reports', 'setup', 'compliance', 'system'],
  manager: ['home', 'service', 'money', 'delivery', 'customers', 'reports', 'inventory', 'menu', 'setup', 'compliance', 'system'],
};
function personaOf(kind: Kind, roles: string[]): Persona {
  const r = roles.join(' ').toLowerCase();
  if (/owner|manager|bootstrap|implementation/.test(r)) return kind === 'FLOOR' ? 'waiter' : kind === 'KDS' ? 'chef' : kind === 'CASH' ? 'cashier' : 'manager';
  if (/chef|kitchen/.test(r)) return 'chef';
  if (/cashier/.test(r)) return 'cashier';
  if (/waiter/.test(r)) return 'waiter';
  return kind === 'FLOOR' ? 'waiter' : kind === 'CASH' ? 'cashier' : kind === 'KDS' ? 'chef' : 'manager';
}

export interface NavSection { group: ScreenGroup; title: string; items: ScreenDef[] }
export function useNavSections(): NavSection[] {
  const { kind, can, me, id } = useDev();
  const lang = useLang();
  const branchId = me?.branchId ?? devices.auth(id).branchId ?? null;
  const items = visibleScreens(kind as Kind, can, branchId);
  const roles: string[] = (me?.user?.roleAssignments ?? []).map((r: any) => String(r.roleName ?? ''));
  const order = ORDER[personaOf(kind as Kind, roles)];
  return useMemo(() => {
    const by = new Map<ScreenGroup, ScreenDef[]>();
    for (const s of items) { const g = s.group ?? 'system'; by.set(g, [...(by.get(g) ?? []), s]); }
    return order.filter((g) => by.has(g)).map((g) => ({ group: g, title: L(SCREEN_GROUPS[g]), items: by.get(g)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((s) => s.id).join(','), order, lang]);
}

export const isActiveItem = (sid: string, screen: string) => screen === sid || (sid === 'floor' && (screen === 'order' || screen === 'pay')) || (sid === 'checks' && screen === 'receipt') || (sid === 'customers' && screen === 'customer') || (sid === 'counter' && screen === 'staffmeal');

/** Live counts shown next to nav items. */
function useBadges(branchId: string | null): Record<string, { n: number; tone: 'warning' | 'error' | 'primary'; pulse?: boolean; tip: string }> {
  const out: Record<string, { n: number; tone: 'warning' | 'error' | 'primary'; pulse?: boolean; tip: string }> = {};
  const approvals = pendingApprovalCount(branchId);
  if (approvals) out['approvals-inbox'] = { n: approvals, tone: 'warning', pulse: true, tip: t('طلبات موافقة مستنية') };
  const alerts = store.db.alerts.filter((a) => !a.ack).length;
  if (alerts) out.ereceipts = { n: alerts, tone: 'error', tip: t('تنبيهات محتاجة مراجعة') };
  const online = (store.db.externalOrders ?? []).filter((o) => o.state === 'NEW' && (!branchId || o.branchId === branchId)).length;
  if (online) out['online-orders'] = { n: online, tone: 'primary', pulse: true, tip: t('طلبات أونلاين جديدة مستنية قبول') };
  return out;
}

// ───────── persisted sidebar preferences
const PREF_KEY = 'nerdpos.sidebar.v2';
type Prefs = { mode: 'auto' | 'wide' | 'rail'; collapsed: Record<string, true> };
let prefs: Prefs = (() => { try { const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null'); if (p?.mode) return { collapsed: {}, ...p }; } catch { /* ignore */ } return { mode: 'auto', collapsed: {} }; })();
const pl = new Set<() => void>();
const setPrefs = (p: Partial<Prefs>) => { prefs = { ...prefs, ...p }; try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ignore */ } pl.forEach((f) => f()); };
const usePrefs = () => useSyncExternalStore((cb) => { pl.add(cb); return () => pl.delete(cb); }, () => prefs);

// ───────── which pane gets Ctrl+K (the one last touched; the main one by default)
let lastPane: string | null = null;
export const markPane = (id: string) => { lastPane = id; };
const paletteBus = new Set<(id: string) => void>();
export const openPalette = (id: string) => paletteBus.forEach((f) => f(id));

export function Sidebar({ paneWidth, compact }: { paneWidth: number; compact?: boolean }) {
  const { screen, nav, me, id } = useDev();
  const lang = useLang();
  const p = usePrefs();
  const sections = useNavSections();
  const branchId = me?.branchId ?? devices.auth(id).branchId ?? null;
  const badges = useBadges(branchId);
  const autoWide = paneWidth >= 1180 && !compact;
  const wide = p.mode === 'wide' ? paneWidth >= 760 : p.mode === 'rail' ? false : autoWide;
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        const target = lastPane && document.querySelector(`[data-device="${lastPane}"]`) ? lastPane : devices.state().primary;
        if (target === id) { e.preventDefault(); setPalette(true); }
      }
    };
    const bus = (d: string) => { if (d === id) setPalette(true); };
    window.addEventListener('keydown', h);
    paletteBus.add(bus);
    return () => { window.removeEventListener('keydown', h); paletteBus.delete(bus); };
  }, [id]);
  const logout = async () => { try { await call(devices.auth(id), 'Auth.Logout', { body: {} }); } catch { /* ignore */ } devices.logout(id); };
  const name = personName(me?.user?.username, me?.user?.displayName);
  const role = personRole(me?.user?.username, me?.user?.displayName) || me?.user?.roleAssignments?.map((r: any) => roleLabel(r.roleName)).join(t('، '));
  const activeGroup = sections.find((s) => s.items.some((i) => isActiveItem(i.id, screen)))?.group;
  const toggleMode = () => setPrefs({ mode: wide ? 'rail' : 'wide' });
  const title = (s: ScreenDef) => (lang === 'ar' ? s.title : s.titleEn);
  const bizName = (lang === 'ar' ? store.db.business.nameAr || store.db.business.name : store.db.business.name || store.db.business.nameAr) || 'NerdPOS';
  const navRef = React.useRef<HTMLElement>(null);
  useEffect(() => { navRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [screen, wide]);

  return (
    <aside className={cn('sb flex flex-col shrink-0 border-e transition-[width] duration-200', wide ? 'w-[228px]' : 'w-[76px]')} data-sidebar={wide ? 'wide' : 'rail'}>
      {/* brand + search */}
      <div className={cn('shrink-0 border-b sb-line', wide ? 'p-3 space-y-2.5' : 'py-3 px-2 space-y-2')}>
        <div className={cn('flex items-center', wide ? 'justify-between gap-2' : 'justify-center')}>
          {wide && <div className="flex items-center gap-2 min-w-0" title={bizName}><Logo /><div className="leading-tight min-w-0"><div className="text-[13px] font-extrabold tracking-tight truncate">{bizName}</div><div className="text-[10px] sb-dim truncate">NerdPOS · {t('نقطة بيع المطاعم')}</div></div></div>}
          <button onClick={toggleMode} title={wide ? t('صغّر القايمة') : t('كبّر القايمة')} aria-label={wide ? t('صغّر القايمة') : t('كبّر القايمة')} className="sb-item w-8 h-8 rounded-lg flex items-center justify-center shrink-0" data-fb="sidebar-toggle">
            {wide ? <PanelRightClose className="w-4 h-4 ltr:-scale-x-100" /> : <PanelRightOpen className="w-4 h-4 ltr:-scale-x-100" />}
          </button>
        </div>
        <button data-fb="nav-search" onClick={() => setPalette(true)} title={t('دوّر على شاشة (Ctrl+K)')} className={cn('sb-input rounded-xl flex items-center gap-2 text-xs w-full transition-colors', wide ? 'h-9 px-2.5' : 'h-9 justify-center')}>
          <Search className="w-4 h-4 sb-dim shrink-0" />
          {wide && <><span className="sb-dim flex-1 text-start truncate">{t('دوّر على شاشة')}</span><Kbd className="!bg-transparent">Ctrl K</Kbd></>}
        </button>
      </div>

      {/* sections */}
      <nav ref={navRef} className={cn('flex-1 min-h-0 overflow-y-auto overscroll-contain', wide ? 'px-2 py-2' : 'px-1.5 py-2 scrollbar-hide')} aria-label={t('الشاشات')}>
        {sections.map((sec, si) => {
          const GIcon = GROUP_ICON[sec.group];
          const collapsed = wide && !!p.collapsed[sec.group] && activeGroup !== sec.group;
          const groupBadge = sec.items.reduce((a, i) => a + (badges[i.id]?.n ?? 0), 0);
          if (!wide) {
            return (
              <div key={sec.group} className={cn(si > 0 && 'mt-2 pt-2 border-t sb-line')} role="group" aria-label={sec.title}>
                {sec.items.map((s) => <RailItem key={s.id} s={s} label={title(s)} group={sec.title} active={isActiveItem(s.id, screen)} badge={badges[s.id]} onClick={() => nav(s.id)} />)}
              </div>
            );
          }
          return (
            <div key={sec.group} className="mb-1" role="group" aria-label={sec.title}>
              {sections.length > 1 && sec.group !== 'home' && (
                <button onClick={() => setPrefs({ collapsed: { ...p.collapsed, ...(p.collapsed[sec.group] ? { [sec.group]: undefined as any } : { [sec.group]: true }) } })} disabled={activeGroup === sec.group}
                  className="w-full flex items-center gap-2 px-2 h-8 rounded-lg text-[11px] font-bold sb-dim hover:text-[var(--sb-fg)] disabled:cursor-default transition-colors" aria-expanded={!collapsed} data-fb={`nav-group:${sec.group}`}>
                  <GIcon className="w-3.5 h-3.5 shrink-0 opacity-80" />
                  <span className="flex-1 text-start truncate">{sec.title}</span>
                  {collapsed && groupBadge > 0 && <span className="num min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">{groupBadge}</span>}
                  {collapsed && !groupBadge && <span className="num text-[10px] opacity-70">{sec.items.length}</span>}
                  {activeGroup !== sec.group && <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', collapsed && 'rtl:rotate-90 ltr:-rotate-90')} />}
                </button>
              )}
              {!collapsed && (
                <div className="space-y-0.5 pb-1">
                  {sec.items.map((s) => <WideItem key={s.id} s={s} label={title(s)} active={isActiveItem(s.id, screen)} badge={badges[s.id]} onClick={() => nav(s.id)} />)}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* person */}
      <div className={cn('shrink-0 border-t sb-line', wide ? 'p-2.5' : 'p-2 space-y-2')}>
        {wide ? (
          <div className="flex items-center gap-2.5">
            <Avatar name={name} size="md" />
            <div className="min-w-0 flex-1 leading-tight"><div className="text-sm font-bold truncate">{name}</div><div className="text-[11px] sb-dim truncate">{role}</div></div>
            <button data-fb="logout" title={t('خروج')} aria-label={t('خروج')} onClick={logout} className="w-9 h-9 rounded-lg flex items-center justify-center text-[var(--error)] hover:bg-[color-mix(in_srgb,var(--error)_14%,transparent)] transition-colors shrink-0"><LogOut className="w-4 h-4 rtl:-scale-x-100" /></button>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-1" title={`${name} — ${role}`}><Avatar name={name} size="md" /><span className="text-[9px] sb-dim truncate max-w-full">{name}</span></div>
            <button data-fb="logout" title={t('خروج')} aria-label={t('خروج')} onClick={logout} className="w-full h-9 rounded-lg flex items-center justify-center text-[var(--error)] border border-[color-mix(in_srgb,var(--error)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--error)_14%,transparent)] transition-colors"><LogOut className="w-4 h-4 rtl:-scale-x-100" /></button>
          </>
        )}
      </div>
      {palette && <CommandPalette sections={sections} onClose={() => setPalette(false)} />}
    </aside>
  );
}

function Logo() {
  return <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[color-mix(in_srgb,var(--primary)_55%,#1e3a8a)] flex items-center justify-center shadow-[0_4px_14px_-4px_var(--primary-glow)] shrink-0"><svg viewBox="0 0 24 24" className="w-4.5 h-4.5 w-[18px] h-[18px]" fill="none" stroke="var(--primary-foreground)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg></span>;
}

type Badge = { n: number; tone: 'warning' | 'error' | 'primary'; pulse?: boolean; tip: string } | undefined;
const badgeCls = (b: NonNullable<Badge>) => cn('num min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center', b.tone === 'warning' ? 'bg-amber-500 text-black' : b.tone === 'error' ? 'bg-red-500 text-white' : 'bg-[var(--primary)] text-[var(--primary-foreground)]', b.pulse && 'animate-pulse');

function WideItem({ s, label, active, badge, onClick }: { s: ScreenDef; label: string; active: boolean; badge: Badge; onClick: () => void }) {
  const Icon = s.icon;
  return (
    <button data-fb={`nav:${s.id}`} data-active={active} aria-current={active ? 'page' : undefined} onClick={onClick} title={label}
      className="sb-item relative w-full h-9 rounded-lg flex items-center gap-2.5 px-2.5 text-[13px] text-start">
      {active && <span className="absolute start-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[var(--sb-active-fg)]" />}
      <span className={cn('w-6 h-6 rounded-md flex items-center justify-center shrink-0', active ? `bg-gradient-to-br ${s.gradient} text-slate-950` : '')}><Icon className="w-4 h-4" /></span>
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <Tech><span className="num text-[9px] opacity-50">{s.code}</span></Tech>
      {badge && <span className={badgeCls(badge)} title={badge.tip}>{badge.n}</span>}
    </button>
  );
}

function RailItem({ s, label, group, active, badge, onClick }: { s: ScreenDef; label: string; group: string; active: boolean; badge: Badge; onClick: () => void }) {
  const Icon = s.icon;
  return (
    <button data-fb={`nav:${s.id}`} data-active={active} aria-current={active ? 'page' : undefined} onClick={onClick} title={`${label}\n${group}`}
      className="sb-item relative w-full min-h-[56px] py-1.5 mb-1 rounded-xl flex flex-col items-center justify-center gap-1 active:scale-95">
      <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center', active ? `bg-gradient-to-br ${s.gradient} text-slate-950 shadow-md` : '')}><Icon className="w-[18px] h-[18px]" /></span>
      <span className="text-[9.5px] leading-tight text-center px-0.5 line-clamp-2 font-bold">{label}</span>
      {badge && <span className={cn(badgeCls(badge), 'absolute top-0.5 end-1')} title={badge.tip}>{badge.n}</span>}
    </button>
  );
}

// ───────── quick screen search
const norm = (s: string) => s.toLowerCase().replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[—\-–·،,()]/g, ' ').replace(/\s+/g, ' ').trim();

function CommandPalette({ sections, onClose }: { sections: NavSection[]; onClose: () => void }) {
  const { nav, screen, id } = useDev();
  const lang = useLang();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const flat = sections.flatMap((sec) => sec.items.map((s) => ({ s, sec })));
  const nq = norm(q);
  const results = nq ? flat.filter(({ s, sec }) => nq.split(' ').every((w) => norm(`${s.title} ${s.titleEn} ${sec.title} ${L(SCREEN_GROUPS[sec.group])} ${s.code}`).includes(w))) : flat;
  useEffect(() => setSel(0), [q]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const go = (sid: string) => { nav(sid); onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(results.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); go(results[sel].s.id); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  let lastGroup = '';
  return createPortal(
    <div className="fixed inset-x-0 bottom-0 top-12 z-[75] flex items-start justify-center pt-[10vh] px-4" role="dialog" aria-modal aria-label={t('دوّر على شاشة')} data-device={id}>
      <div className="absolute inset-0 glass-overlay animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-xl overlay-panel rounded-2xl overflow-hidden animate-scale-in" onKeyDown={onKey}>
        <div className="flex items-center gap-3 px-4 h-14 border-b line">
          <Search className="w-5 h-5 text-dim shrink-0" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('دوّر على شاشة… (مثلًا: المخزن، الوردية، العروض)')} className="flex-1 bg-transparent !outline-none text-base min-w-0" data-fb="palette-input" />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && <div className="py-10 text-center text-sm text-dim">{t('مفيش شاشة بالاسم ده. جرّب كلمة تانية.')}</div>}
          {results.map(({ s, sec }, i) => {
            const header = sec.group !== lastGroup ? (lastGroup = sec.group, <div key={`h-${sec.group}`} className="px-2 pt-2 pb-1 text-[11px] font-bold text-dim">{sec.title}</div>) : null;
            const Icon = s.icon;
            const on = i === sel;
            return (
              <React.Fragment key={s.id}>
                {header}
                <button data-idx={i} data-fb={`palette:${s.id}`} onMouseMove={() => setSel(i)} onClick={() => go(s.id)} className={cn('w-full flex items-center gap-3 px-2.5 h-11 rounded-xl text-start transition-colors', on ? 'bg-[var(--primary-container)]' : 'hover:bg-[var(--surface-2)]')}>
                  <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br text-slate-950 shrink-0', s.gradient)}><Icon className="w-4 h-4" /></span>
                  <span className="flex-1 min-w-0"><span className="block text-sm font-bold truncate">{lang === 'ar' ? s.title : s.titleEn}</span><span className="block text-[11px] text-dim truncate">{lang === 'ar' ? s.titleEn : s.title}</span></span>
                  {isActiveItem(s.id, screen) && <span className="text-[10px] text-dim">{t('مفتوحة دلوقتي')}</span>}
                  {on && <CornerDownLeft className="w-4 h-4 text-[var(--primary)] rtl:-scale-x-100" />}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="flex items-center gap-4 px-4 h-10 border-t line text-[11px] text-dim overlay-footer">
          <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd>{t('اختار')}</span>
          <span className="flex items-center gap-1.5"><Kbd>Enter</Kbd>{t('افتح')}</span>
          <span className="flex-1" />
          <span className="num">{results.length}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
