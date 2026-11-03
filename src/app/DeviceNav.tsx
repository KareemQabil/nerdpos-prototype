// Device navigation: a sectioned sidebar (wide + labelled on large panes, a compact rail on tablets / split view)
// and a quick screen search (Ctrl+K / «دوّر على شاشة»). Sections come from `group` in the screen registry,
// ordered for the person's role (a waiter sees service first). Every item keeps data-fb="nav:<id>".
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, ChevronDown, LogOut, PanelRightClose, PanelRightOpen, CornerDownLeft,
  LayoutDashboard, ConciergeBell, Wallet, Bike, Contact, Boxes, BookOpen, FileBarChart, Settings2, Landmark, Activity, Star,
} from 'lucide-react';
import { useDev, useQuery } from './hooks';
import { REF_TYPES, refType, refTypeLabel, refTarget, follow, useFollowList, refsParam, TONE_DOT, type RefType, type StatusView } from '../screens/search/refs';
import { devices, markKeyPane, keyPane } from './devices';
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
export const markPane = (id: string) => markKeyPane(id);
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
  const [palette, setPalette] = useState<false | true | 'follow'>(false);
  const followed = useFollowList(me?.user?.id);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) {
        const target = keyPane();
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
        <button data-fb="nav-search" onClick={() => setPalette(true)} title={t('دوّر على شاشة أو أي حاجة (Ctrl+K)')} className={cn('sb-input rounded-xl flex items-center gap-2 text-xs w-full transition-colors', wide ? 'h-9 px-2.5' : 'h-9 justify-center')}>
          <Search className="w-4 h-4 sb-dim shrink-0" />
          {wide && <><span className="sb-dim flex-1 text-start truncate">{t('دوّر على أي حاجة')}</span><Kbd className="!bg-transparent">Ctrl K</Kbd></>}
        </button>
        <button data-fb="nav-follow" onClick={() => setPalette('follow')} title={t('متابعاتي — الحاجات اللي بتتابعها وحالتها دلوقتي')} className={cn('sb-item rounded-xl flex items-center gap-2 text-xs w-full', wide ? 'h-8 px-2.5' : 'h-8 justify-center')}>
          <Star className={cn('w-4 h-4 shrink-0', followed.length ? 'fill-current text-amber-400' : 'sb-dim')} />
          {wide && <span className="flex-1 text-start truncate sb-dim">{t('متابعاتي')}</span>}
          {followed.length > 0 && <span className="num min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">{followed.length}</span>}
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
      {palette && <CommandPalette sections={sections} initial={palette === 'follow' ? 'follow' : undefined} onClose={() => setPalette(false)} />}
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

// ───────── quick search: screens AND records (dishes, ingredients, suppliers, purchasing documents, checks, customers,
// people) with typed chips, keyboard navigation and "تابع" (follow) — round 3, F2-04.
const norm = (s: string) => s.toLowerCase().replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[—\-–·،,()]/g, ' ').replace(/\s+/g, ' ').trim();

type Entry = { kind: 'screen'; s: ScreenDef; sec: NavSection; group: string } | { kind: 'record'; r: StatusView; group: string; followed: boolean };
type Filter = 'all' | 'screens' | RefType;

function CommandPalette({ sections, onClose, initial }: { sections: NavSection[]; onClose: () => void; initial?: 'follow' }) {
  const { nav, screen, id, me } = useDev();
  const lang = useLang();
  const userId: string | undefined = me?.user?.id;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const followed = useFollowList(userId);
  const nq = norm(q);
  const recQ = useQuery<any>(nq.length >= 2 && filter !== 'screens' ? 'Search.Global' : null, { query: { q: q.trim(), types: filter !== 'all' && filter !== 'screens' ? filter : undefined } });
  const folQ = useQuery<any>(!nq && followed.length ? 'Search.Status' : null, { query: { refs: refsParam(followed) } });
  const flat = sections.flatMap((sec) => sec.items.map((s) => ({ s, sec })));
  const screenHits = filter !== 'all' && filter !== 'screens' ? [] : nq ? flat.filter(({ s, sec }) => nq.split(' ').every((w) => norm(`${s.title} ${s.titleEn} ${sec.title} ${L(SCREEN_GROUPS[sec.group])} ${s.code}`).includes(w))) : flat;
  const isF = (r: { type: string; id: string }) => followed.some((x) => x.type === r.type && x.id === r.id);
  const entries: Entry[] = [];
  if (!nq && initial === 'follow' || (!nq && followed.length)) for (const r of (folQ.data?.items ?? []) as StatusView[]) entries.push({ kind: 'record', r, group: t('متابعاتي'), followed: true });
  if (nq) for (const r of (recQ.data?.items ?? []) as StatusView[]) entries.push({ kind: 'record', r, group: refTypeLabel(r.type), followed: isF(r) });
  if (!(initial === 'follow' && !nq)) for (const x of screenHits) entries.push({ kind: 'screen', s: x.s, sec: x.sec, group: nq ? t('الشاشات') : x.sec.title });
  const counts: Record<string, number> = recQ.data?.counts ?? {};
  const typeChips = REF_TYPES.filter((x) => counts[x.type] || filter === x.type);
  const chips: { id: Filter; label: string; n?: number }[] = [{ id: 'all', label: t('الكل') }, { id: 'screens', label: t('الشاشات') }, ...typeChips.map((x) => ({ id: x.type as Filter, label: t(x.ar), n: counts[x.type] }))];
  useEffect(() => setSel(0), [q, filter]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const open = (e: Entry) => {
    if (e.kind === 'screen') nav(e.s.id);
    else { const tg = refTarget(e.r); nav(tg.screen, tg.params); }
    onClose();
  };
  const toggleFollow = (e: Entry) => { if (e.kind === 'record' && userId) follow.toggle(userId, { type: e.r.type, id: e.r.id }); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(entries.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Tab') { e.preventDefault(); const i = chips.findIndex((c) => c.id === filter); setFilter(chips[(i + (e.shiftKey ? chips.length - 1 : 1)) % chips.length].id); }
    else if (e.key === 'Enter' && entries[sel]) { e.preventDefault(); if (e.shiftKey) toggleFollow(entries[sel]); else open(entries[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  let lastGroup = '';
  const loading = recQ.loading && nq.length >= 2;
  return createPortal(
    <div className="fixed inset-x-0 bottom-0 top-12 z-[75] flex items-start justify-center pt-[8vh] px-4" role="dialog" aria-modal aria-label={t('دوّر')} data-device={id}>
      <div className="absolute inset-0 glass-overlay animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-2xl overlay-panel rounded-2xl overflow-hidden animate-scale-in" onKeyDown={onKey}>
        <div className="flex items-center gap-3 px-4 h-14 border-b line">
          <Search className="w-5 h-5 text-dim shrink-0" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('دوّر على أي حاجة… طبق، خامة، مورد، أمر شراء، شيك، عميل، شاشة')} className="flex-1 bg-transparent !outline-none text-base min-w-0" data-fb="palette-input" />
          {loading && <span className="w-4 h-4 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin" />}
          <Kbd>Esc</Kbd>
        </div>
        {nq.length >= 2 && (
          <div className="flex items-center gap-1.5 px-3 py-2 border-b line overflow-x-auto scrollbar-hide" role="tablist" aria-label={t('نوع النتيجة')}>
            {chips.map((c) => (
              <button key={c.id} role="tab" aria-selected={filter === c.id} data-fb={`palette-chip:${c.id}`} onClick={() => setFilter(c.id)}
                className={cn('shrink-0 h-7 px-2.5 rounded-full text-xs border transition-colors', filter === c.id ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-1 border-[var(--glass-border)] text-soft hover:text-[var(--foreground)]')}>
                {c.label}{c.n ? <span className="num opacity-75 ms-1">{c.n}</span> : null}
              </button>
            ))}
          </div>
        )}
        <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-2">
          {!nq && !followed.length && initial === 'follow' && <div className="py-8 px-6 text-center text-sm text-dim">{t('لسه مش متابع حاجة. دوّر على أي حاجة (مثلًا «طحينة») واضغط ☆ «تابع» عشان تشوف حالتها هنا على طول.')}</div>}
          {nq.length >= 2 && !loading && entries.length === 0 && <div className="py-10 text-center text-sm text-dim">{t('مفيش نتايج. جرّب كلمة تانية أو جزء من الاسم أو الرقم.')}</div>}
          {nq.length === 1 && <div className="py-3 text-center text-[11px] text-dim">{t('اكتب حرفين على الأقل عشان ندوّر في البيانات')}</div>}
          {entries.map((e, i) => {
            const header = e.group !== lastGroup ? (lastGroup = e.group, <div key={`h-${e.group}-${i}`} className="px-2 pt-2 pb-1 text-[11px] font-bold text-dim flex items-center gap-1.5">{e.group === t('متابعاتي') && <Star className="w-3 h-3 fill-current text-[var(--warning)]" />}{e.group}</div>) : null;
            const on = i === sel;
            if (e.kind === 'screen') {
              const Icon = e.s.icon;
              return (
                <React.Fragment key={`s-${e.s.id}`}>
                  {header}
                  <button data-idx={i} data-fb={`palette:${e.s.id}`} onMouseMove={() => setSel(i)} onClick={() => open(e)} className={cn('w-full flex items-center gap-3 px-2.5 h-11 rounded-xl text-start transition-colors', on ? 'bg-[var(--primary-container)]' : 'hover:bg-[var(--surface-2)]')}>
                    <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br text-slate-950 shrink-0', e.s.gradient)}><Icon className="w-4 h-4" /></span>
                    <span className="flex-1 min-w-0"><span className="block text-sm font-bold truncate">{lang === 'ar' ? e.s.title : e.s.titleEn}</span><span className="block text-[11px] text-dim truncate">{t('شاشة')} · {e.sec.title}</span></span>
                    {isActiveItem(e.s.id, screen) && <span className="text-[10px] text-dim">{t('مفتوحة دلوقتي')}</span>}
                    {on && <CornerDownLeft className="w-4 h-4 text-[var(--primary)] rtl:-scale-x-100" />}
                  </button>
                </React.Fragment>
              );
            }
            const T = refType(e.r.type);
            const Icon = T.icon;
            return (
              <React.Fragment key={`r-${e.r.type}-${e.r.id}`}>
                {header}
                <div data-idx={i} onMouseMove={() => setSel(i)} className={cn('w-full flex items-center gap-2 px-2.5 min-h-[52px] py-1.5 rounded-xl transition-colors', on ? 'bg-[var(--primary-container)]' : 'hover:bg-[var(--surface-2)]', e.r.missing && 'opacity-60')}>
                  <button data-fb={`palette-rec:${e.r.type}:${e.r.id}`} onClick={() => open(e)} className="flex-1 min-w-0 flex items-center gap-3 text-start">
                    <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br text-slate-950 shrink-0', T.tone)}><Icon className="w-4 h-4" /></span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5 min-w-0"><span className="text-sm font-bold truncate">{L(e.r.title)}</span><span className="shrink-0 text-[10px] px-1.5 h-[18px] leading-[18px] rounded-full surface-2 text-soft border border-[var(--glass-border)]">{t(T.ar)}</span></span>
                      <span className="flex items-center gap-1.5 text-[11px] min-w-0">
                        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', TONE_DOT[e.r.status.tone])} />
                        <span className={cn('truncate', e.r.status.tone === 'warning' ? 'text-[var(--warning-text)]' : e.r.status.tone === 'error' ? 'text-[var(--error)]' : e.r.status.tone === 'success' ? 'text-[var(--success)]' : 'text-soft')}>{L(e.r.status.text)}</span>
                        {e.r.sub && L(e.r.sub) && <span className="text-dim truncate">· {L(e.r.sub)}</span>}
                      </span>
                    </span>
                  </button>
                  {userId && (
                    <button data-fb={`palette-follow:${e.r.type}:${e.r.id}`} onClick={() => toggleFollow(e)} title={e.followed ? t('بطّل متابعة') : t('تابع — اعرض حالتها في متابعاتي')} aria-pressed={e.followed}
                      className={cn('shrink-0 h-8 px-2 rounded-lg flex items-center gap-1 text-[11px] border transition-colors', e.followed ? 'border-[color-mix(in_srgb,var(--warning)_45%,transparent)] text-[var(--warning-text)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)]' : 'border-[var(--glass-border)] text-soft hover:text-[var(--foreground)]')}>
                      <Star className={cn('w-3.5 h-3.5', e.followed && 'fill-current')} />{e.followed ? t('متابَع') : t('تابع')}
                    </button>
                  )}
                  {on && <CornerDownLeft className="w-4 h-4 text-[var(--primary)] rtl:-scale-x-100 shrink-0" />}
                </div>
              </React.Fragment>
            );
          })}
        </div>
        <div className="flex items-center gap-4 px-4 h-10 border-t line text-[11px] text-dim overlay-footer flex-wrap">
          <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd>{t('اختار')}</span>
          <span className="flex items-center gap-1.5"><Kbd>Enter</Kbd>{t('افتح')}</span>
          <span className="flex items-center gap-1.5"><Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>{t('تابع')}</span>
          {nq.length >= 2 && <span className="flex items-center gap-1.5"><Kbd>Tab</Kbd>{t('نوع النتيجة')}</span>}
          <span className="flex-1" />
          <span className="num">{entries.length}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
