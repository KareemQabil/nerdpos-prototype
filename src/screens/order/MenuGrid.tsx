// C2 menu: categories + product tiles. Every tile price comes from a server quote (Pricing.QuoteItem),
// one per visible tile, cached 60 s (docs/18). The browser never computes a price.
// Menu area: only what is on a running menu for this channel shows (dayparts on the mock clock); sold-out-today
// items show as "خلص"; a "خلص النهارده" board is one tap away; pictures, calories and allergens on the tiles.
import React, { useEffect, useMemo, useState } from 'react';
import { Package, Search, AlertTriangle, PackageX, Clock, Eye, EyeOff, Layers, Pizza, Ruler } from 'lucide-react';
import { useDev, useQuery } from '../../app/hooks';
import { call, ApiFailure } from '../../api/client';
import { clock } from '../../mock/clock';
import { Pill, StateBadge, Input, Modal, Button, EmptyState, Skeleton } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { cn, money } from '../../lib/format';
import { SoldOutBoard } from '../menu/SoldOutBoard';
import { timeText } from '../menu/parts';

type QuoteState = { data?: any; error?: ApiFailure; at: number };
const cache = new Map<string, QuoteState>();
const inflight = new Map<string, Promise<void>>();

export const ALLERGEN_AR: Record<string, string> = { GLUTEN: 'جلوتين', DAIRY: 'ألبان', NUTS: 'مكسرات', SESAME: 'سمسم', EGG: 'بيض', EGGS: 'بيض', FISH: 'سمك', SEAFOOD: 'مأكولات بحرية', SOY: 'صويا' };

/** The minimum selection a tile is quoted with (required groups' default options and their required sub-choices). */
export interface TileSelection { modifierOptionIds: string[]; nestedOptionIds?: Record<string, string[]> }

export function useTileQuotes(productIds: string[], channel: string, branchId: string | null, epoch: string) {
  const { auth } = useDev();
  const [, force] = useState(0);
  useEffect(() => {
    let alive = true;
    const now = Date.now();
    const todo = productIds.filter((id) => {
      const c = cache.get(`${epoch}|${channel}|${id}`);
      return !c || now - c.at > 60_000;
    });
    Promise.all(todo.map((id) => {
      const key = `${epoch}|${channel}|${id}`;
      if (inflight.has(key)) return inflight.get(key);
      const sel = defaultSel(id);
      const p = call(auth, 'Pricing.QuoteItem', { params: { productId: id }, body: { branchId, channel, productId: id, quantity: '1', modifierOptionIds: sel.modifierOptionIds, nestedOptionIds: sel.nestedOptionIds } })
        .then((r) => { cache.set(key, { data: r.data, at: Date.now() }); })
        .catch((e) => { cache.set(key, { error: e, at: Date.now() }); })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    })).then(() => alive && force((x) => x + 1));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productIds.join(','), channel, branchId, epoch]);
  return (id: string) => cache.get(`${epoch}|${channel}|${id}`);
}

// a tile is quoted with the minimum required selection; the server tells us which groups need one
const defaultSelMap = new Map<string, TileSelection>();
export function setDefaultMods(id: string, ids: string[], nested?: Record<string, string[]>) { defaultSelMap.set(id, { modifierOptionIds: ids, nestedOptionIds: nested }); }
const defaultSel = (id: string): TileSelection => defaultSelMap.get(id) ?? { modifierOptionIds: [] };

/** Default picks of a group: its default options first, then the first available ones, up to `n`. */
export function defaultPicks(g: any, n: number): string[] {
  const usable = (g.options ?? []).filter((o: any) => o.active && !o.soldOut);
  const defs = usable.filter((o: any) => o.isDefault);
  return [...defs, ...usable.filter((o: any) => !o.isDefault)].slice(0, n).map((o: any) => o.id);
}
export function requiredSelection(groupIds: string[], groups: any[]): TileSelection {
  const ids: string[] = [];
  const nested: Record<string, string[]> = {};
  for (const gid of groupIds) {
    const g = groups.find((x) => x.id === gid);
    if (!g || g.kind === 'INGREDIENTS' || g.min <= 0) continue;
    for (const oid of defaultPicks(g, g.min)) {
      ids.push(oid);
      const o = g.options.find((x: any) => x.id === oid);
      const ng = o?.nestedGroupId ? groups.find((x) => x.id === o.nestedGroupId) : null;
      if (ng && ng.min > 0) nested[oid] = defaultPicks(ng, ng.min);
    }
  }
  return { modifierOptionIds: ids, nestedOptionIds: Object.keys(nested).length ? nested : undefined };
}

/** Re-render on mock clock moves and every 30 s (dayparts start and end on the server clock). */
function useClockTick(onTick: () => void) {
  useEffect(() => {
    const un = clock.subscribe(onTick);
    const h = setInterval(onTick, 30_000);
    return () => { un(); clearInterval(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function MenuGrid({ channel, onPick, disabled }: { channel: string; onPick: (p: any) => void; disabled?: boolean }) {
  const { auth, can } = useDev();
  const cats = useQuery<any>('Category.List', { query: { active: true } });
  const products = useQuery<any>('Catalog.Search', { query: { active: true, limit: 500, channel } });
  const groups = useQuery<any>('ModifierGroup.List', { query: {} });
  const overview = useQuery<any>('Menu.Overview');
  const display = useQuery<any>('Settings.Effective', { query: { policyId: 'MenuPriceDisplayPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const [minute, setMinute] = useState(() => Math.floor(clock.now() / 60_000));
  const minuteRef = React.useRef(minute);
  useClockTick(() => { const m = Math.floor(clock.now() / 60_000); if (m !== minuteRef.current) { minuteRef.current = m; setMinute(m); products.refetch(); overview.refetch(); } });
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [board, setBoard] = useState(false);
  const items: any[] = products.data?.items ?? [];
  const gs: any[] = groups.data?.items ?? [];
  // required single-choice groups need a default option for the tile quote (e.g. Size: Regular)
  useMemo(() => {
    for (const p of items) { const s = requiredSelection(p.modifierGroupIds ?? [], gs); setDefaultMods(p.id, s.modifierOptionIds, s.nestedOptionIds); }
  }, [groups.data, products.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const onMenu = (p: any) => !p.menuNow || p.menuNow.onMenu;
  const offMenu = items.filter((p) => !onMenu(p) && p.menuNow?.reason === 'OUTSIDE_MENU_HOURS');
  const listed = items.filter((p) => onMenu(p) || (showAll && p.menuNow?.reason === 'OUTSIDE_MENU_HOURS'));
  const visible = listed.filter((p) => (!cat || p.categoryId === cat) && (!q || (p.name.ar + p.name.en + p.sku).toLowerCase().includes(q.toLowerCase())));
  const soldOutCount = items.filter((p) => p.availability?.state === 'SOLD_OUT').length + gs.reduce((a, g) => a + g.options.filter((o: any) => o.soldOut).length, 0);
  const epoch = useMemo(() => items.map((p) => `${p.id}:${p.version}:${p.availability?.state}:${p.menuNow?.onMenu ?? ''}`).join(',') + '|' + gs.map((g) => `${g.id}:${g.version}:${g.options.filter((o: any) => o.soldOut).map((o: any) => o.id).join('.')}`).join(',') + '|' + JSON.stringify(display.data?.value ?? null) + '|' + Math.floor(clock.offset() / 60000), [items, gs, display.data, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const quoteOf = useTileQuotes(groups.data ? visible.filter(onMenu).map((p) => p.id) : [], channel, auth.branchId, epoch);
  const catsShown = (cats.data?.items ?? []).filter((c: any) => listed.some((p) => p.categoryId === c.id));
  const running = (overview.data?.dayparts ?? []).filter((d: any) => d.runningNow);
  const nextUp = (overview.data?.dayparts ?? []).filter((d: any) => !d.runningNow && d.active && d.nextStart).sort((a: any, b: any) => a.nextStart.localeCompare(b.nextStart))[0];
  return (
    <div className="flex flex-col gap-3 min-h-0 h-full">
      <div className="flex items-center gap-2 shrink-0">
        <div className="relative flex-1"><Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-dim" /><Input data-fb="menu-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('دوّر على صنف أو كود…')} className="ps-9 h-11" /></div>
        <button data-fb="menu:soldout-board" onClick={() => setBoard(true)} title={t('خلص النهارده')} className={cn('shrink-0 h-11 px-3 rounded-xl border text-sm inline-flex items-center gap-1.5', soldOutCount ? 'border-[color-mix(in_srgb,var(--error)_45%,transparent)] text-[var(--error)] bg-[color-mix(in_srgb,var(--error)_10%,transparent)]' : 'border-[var(--glass-border)] text-soft surface-1')}>
          <PackageX className="w-4 h-4" /><span className="hidden sm:inline">{t('خلص النهارده')}</span>{soldOutCount > 0 && <span className="num text-xs font-bold">{soldOutCount}</span>}
        </button>
        <StateBadge ops={['Category.List', 'Catalog.Search', 'ModifierGroup.List', 'Pricing.QuoteItem', 'Menu.Overview']} />
      </div>
      {(running.length > 0 || offMenu.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap text-xs shrink-0" data-fb="menu:daypart">
          <Clock className="w-3.5 h-3.5 text-dim" />
          {running.map((d: any) => <span key={d.id} className="px-2 py-0.5 rounded-full font-bold" style={{ background: (d.color ?? '#22d3ee') + '26', color: d.color ?? 'var(--primary)' }}>{t('دلوقتي')}: {L(d.name)} <span className="num font-normal">{d.start}–{d.end}</span></span>)}
          {nextUp && <span className="text-dim">{t('بعدها')}: {L(nextUp.name)} <span className="num">{timeText(nextUp.nextStart)}</span></span>}
          {offMenu.length > 0 && (
            <button data-fb="menu:show-off-hours" onClick={() => setShowAll(!showAll)} className="ms-auto inline-flex items-center gap-1 text-dim hover:text-soft">
              {showAll ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showAll ? t('اخفي اللي برا مواعيده') : t('{n} صنف برا مواعيده — اعرضهم', { n: offMenu.length })}
            </button>
          )}
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide shrink-0" data-fb="category-rail">
        <CatPill on={!cat} onClick={() => setCat(null)} label={t('الكل')} count={listed.length} />
        {catsShown.map((c: any) => <CatPill key={c.id} on={cat === c.id} onClick={() => setCat(c.id)} label={L(c.name)} count={listed.filter((p) => p.categoryId === c.id).length} proposed={c.id === 'cat_direction'} />)}
      </div>
      {(products.loading || cats.loading) && !items.length ? <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}>{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div> : visible.length === 0 ? (
        <EmptyState compact icon={<Search />} title={q ? t('مفيش صنف بالاسم ده') : t('مفيش أصناف في المنيو دلوقتي')} text={q ? t('جرّب جزء من الاسم أو الكود.') : t('المنيو الشغالة دلوقتي مفيهاش أصناف للنوع ده من الطلبات.')} action={q ? <Button size="sm" onClick={() => setQ('')}>{t('امسح البحث')}</Button> : undefined} />
      ) : (
        <div className="grid gap-2.5 overflow-y-auto pe-1 pb-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gridAutoRows: 'max-content', alignContent: 'start' }}>
          {visible.map((p) => <Tile key={p.id} p={p} quote={quoteOf(p.id)} onPick={() => onPick(p)} disabled={disabled} />)}
        </div>
      )}
      <Modal open={board} onClose={() => setBoard(false)} xwide title={<span className="inline-flex items-center gap-2"><PackageX className="w-5 h-5 text-[var(--error)]" />{t('خلص النهارده')}</span>} badge={<StateBadge ops={['SoldOut.Board', 'Product.SetAvailability', 'ModifierOption.SetAvailability']} />}
        footer={<Button onClick={() => setBoard(false)}>{t('تمام')}</Button>}>
        <SoldOutBoard compact />
        {!can('product:setavailability') && <div className="text-xs text-dim mt-2">{t('اطلب من المدير يعلّم الصنف.')}</div>}
      </Modal>
    </div>
  );
}

function CatPill({ on, onClick, label, count, proposed }: { on: boolean; onClick: () => void; label: string; count: number; proposed?: boolean }) {
  return (
    <button onClick={onClick} className={cn('shrink-0 px-4 h-11 rounded-xl text-sm border flex items-center gap-2 transition-all', on ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-bold border-transparent shadow-[0_4px_16px_-6px_var(--primary-glow)]' : 'surface-1 text-soft border-[var(--glass-border)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]')}>
      <span>{label}</span>
      <span className={cn('text-xs px-1.5 rounded-full', on ? 'bg-black/15' : 'surface-3 text-dim')}>{count}</span>
      {proposed && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--violet)' }} title={t('مقترح')} />}
    </button>
  );
}

function Tile({ p, quote, onPick, disabled }: { p: any; quote?: QuoteState; onPick: () => void; disabled?: boolean }) {
  const err = quote?.error;
  const off = p.menuNow && !p.menuNow.onMenu;
  const st = p.availability?.state;
  const soldOut = st === 'SOLD_OUT' || (err?.code === 'PRODUCT_UNAVAILABLE' && err.details?.state === 'SOLD_OUT');
  const unavailable = soldOut || err?.code === 'PRODUCT_UNAVAILABLE' || (st && st !== 'AVAILABLE');
  const noPrice = err && !unavailable;
  const blocked = off || unavailable || noPrice || !quote?.data;
  const d = quote?.data;
  const reason = off ? p.menuNow.reasonAr : soldOut ? (p.availability?.reason ?? t('خلص النهارده')) : err?.details?.reasonAr ?? p.availability?.reason ?? '';
  return (
    <button data-fb={`tile:${p.sku}`} disabled={disabled || blocked} onClick={onPick} title={reason}
      className={cn('relative overflow-hidden rounded-xl bg-[var(--card-raised)] border border-[var(--glass-border)] flex flex-col text-start transition-all hover:border-[color-mix(in_srgb,var(--primary)_55%,transparent)] hover:shadow-[0_6px_24px_-10px_var(--primary-glow)] active:scale-[.96]', blocked && 'opacity-55 cursor-not-allowed hover:border-[var(--glass-border)] hover:shadow-none')}>
      <div className="relative aspect-[4/3] w-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${p.colorCode ?? '#64748b'}40, var(--surface-2))` }}>
        {p.imageUrl ? <img src={p.imageUrl} alt="" className={cn('w-full h-full object-cover', (soldOut || off) && 'grayscale')} /> : <Package className="w-10 h-10 text-dim opacity-60" />}
        <div className="absolute top-2 end-2 flex flex-col gap-1 items-end">
          {soldOut && <Pill tone="error">{t('خلص')}</Pill>}
          {!soldOut && unavailable && <Pill tone="error">{st === 'BLOCKED' ? t('متوقف') : t('غير متاح')}</Pill>}
          {off && <Pill tone="neutral">{p.menuNow.nextStart ? t('من {h}', { h: timeText(p.menuNow.nextStart) }) : t('مش في المنيو دلوقتي')}</Pill>}
          {noPrice && <Pill tone="warning">{err?.code === 'PRICE_NOT_FOUND' ? t('السعر مش متاح') : err?.network ? t('السعر ما اتحملش') : t('مش متاح')}</Pill>}
          {p.direction && <Pill tone="violet">{t('مقترح')}</Pill>}
        </div>
        <div className="absolute top-2 start-2 flex flex-col gap-1 items-start">
          {p.combo?.length > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/80 text-white font-bold inline-flex items-center gap-0.5"><Layers className="w-3 h-3" />{t('وجبة')}</span>}
          {p.halfAndHalf && <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/80 text-white font-bold inline-flex items-center gap-0.5"><Pizza className="w-3 h-3" />{t('نص ونص')}</span>}
          {p.variants?.filter((v: any) => v.active).length > 1 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/80 text-white font-bold inline-flex items-center gap-0.5"><Ruler className="w-3 h-3" />{t('{n} أحجام', { n: p.variants.filter((v: any) => v.active).length })}</span>}
        </div>
        {p.allergens?.length ? <div className="absolute bottom-1.5 start-1.5 flex gap-1" title={p.allergens.map((a: string) => ALLERGEN_AR[a] ?? a).join('، ')}><span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/80 text-black font-bold flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />{p.allergens.length}</span></div> : null}
        {p.menuNow?.restricted && p.menuNow?.endsAt && <div className="absolute bottom-1.5 end-1.5 text-[9px] px-1.5 py-0.5 rounded bg-black/60 text-white num">{t('لحد {h}', { h: timeText(p.menuNow.endsAt) })}</div>}
      </div>
      <div className="p-2.5 flex flex-col gap-0.5">
        <div className="font-bold text-sm leading-tight truncate">{L(p.name)}</div>
                <span className="num text-[var(--primary)] font-extrabold text-[15px]" style={{ textAlign: 'start' }}>{d ? money(d.display?.unitTotal ?? d.unitTotal) : quote || off ? '—' : '…'}</span>
        {d?.display?.taxIncluded && <span className="text-[9px] text-dim leading-none">{L(d.display.label)}</span>}
        {p.calories != null && <div className="text-[9px] text-dim num">{p.calories} {t('سعر حراري')}</div>}
        <Tech>{d && <div className="text-[9px] text-dim num" dir="ltr">{d.priceRuleId} · {d.unitTotal}</div>}</Tech>
      </div>
    </button>
  );
}
