// C2 menu: categories + product tiles. Every tile price comes from a server quote (Pricing.QuoteItem),
// one per visible tile, cached 60 s (docs/18). The browser never computes a price.
import React, { useEffect, useMemo, useState } from 'react';
import { Package, Search, AlertTriangle, WheatOff } from 'lucide-react';
import { useDev, useQuery } from '../../app/hooks';
import { call, ApiFailure } from '../../api/client';
import { clock } from '../../mock/clock';
import { Pill, Spinner, StateBadge, Input } from '../../ui';
import { t, L } from '../../i18n';
import { cn, money } from '../../lib/format';

type QuoteState = { data?: any; error?: ApiFailure; at: number };
const cache = new Map<string, QuoteState>();
const inflight = new Map<string, Promise<void>>();

export const ALLERGEN_AR: Record<string, string> = { GLUTEN: 'جلوتين', DAIRY: 'ألبان', NUTS: 'مكسرات', SESAME: 'سمسم', EGG: 'بيض', FISH: 'سمك', SOY: 'صويا' };

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
      const p = call(auth, 'Pricing.QuoteItem', { params: { productId: id }, body: { branchId, channel, productId: id, quantity: '1', modifierOptionIds: defaultMods(id) } })
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
const defaultModsMap = new Map<string, string[]>();
export function setDefaultMods(id: string, ids: string[]) { defaultModsMap.set(id, ids); }
const defaultMods = (id: string) => defaultModsMap.get(id) ?? [];

export function MenuGrid({ channel, onPick, disabled }: { channel: string; onPick: (p: any) => void; disabled?: boolean }) {
  const { auth } = useDev();
  const cats = useQuery<any>('Category.List', { query: { active: true } });
  const products = useQuery<any>('Catalog.Search', { query: { active: true, limit: 500 } });
  const groups = useQuery<any>('ModifierGroup.List', { query: {} });
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const items: any[] = products.data?.items ?? [];
  // required single-choice groups need a default option for the tile quote (e.g. Size: Regular)
  useMemo(() => {
    const gs: any[] = groups.data?.items ?? [];
    for (const p of items) setDefaultMods(p.id, p.modifierGroupIds.map((gid: string) => gs.find((g) => g.id === gid)).filter((g: any) => g && g.min > 0).flatMap((g: any) => g.options.filter((o: any) => o.active).slice(0, g.min).map((o: any) => o.id)));
  }, [groups.data, products.data]);
  const visible = items.filter((p) => (!cat || p.categoryId === cat) && (!q || (p.name.ar + p.name.en + p.sku).toLowerCase().includes(q.toLowerCase())));
  const epoch = useMemo(() => items.map((p) => `${p.id}:${p.version}:${p.availability?.state}`).join(',') + '|' + Math.floor(clock.offset() / 60000), [items]);
  const quoteOf = useTileQuotes(groups.data ? visible.map((p) => p.id) : [], channel, auth.branchId, epoch);
  return (
    <div className="flex flex-col gap-3 min-h-0 h-full">
      <div className="flex items-center gap-2">
        <div className="relative flex-1"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input data-fb="menu-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('دوّر على صنف أو كود…')} className="ps-9" /></div>
        <StateBadge ops={['Category.List', 'Catalog.Search', 'ModifierGroup.List', 'Pricing.QuoteItem']} />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" data-fb="category-rail">
        <CatPill on={!cat} onClick={() => setCat(null)} label={t('الكل')} count={items.length} />
        {(cats.data?.items ?? []).map((c: any) => <CatPill key={c.id} on={cat === c.id} onClick={() => setCat(c.id)} label={L(c.name)} sub={c.name.en} count={items.filter((p) => p.categoryId === c.id).length} proposed={c.id === 'cat_direction'} />)}
      </div>
      {(products.loading || cats.loading) && !items.length ? <Spinner /> : (
        <div className="grid gap-3 overflow-y-auto pe-1 pb-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gridAutoRows: 'max-content', alignContent: 'start' }}>
          {visible.map((p) => <Tile key={p.id} p={p} quote={quoteOf(p.id)} onPick={() => onPick(p)} disabled={disabled} />)}
        </div>
      )}
    </div>
  );
}

function CatPill({ on, onClick, label, sub, count, proposed }: { on: boolean; onClick: () => void; label: string; sub?: string; count: number; proposed?: boolean }) {
  return (
    <button onClick={onClick} className={cn('shrink-0 px-4 py-2 rounded-lg text-sm border flex items-center gap-2 transition-all', on ? 'bg-gradient-to-r from-cyan-400 to-cyan-500 text-slate-900 font-bold border-transparent shadow-[0_0_20px_rgba(34,211,238,0.3)]' : 'bg-white/[0.05] text-soft border-white/[0.15] hover:bg-white/[0.08]')}>
      <span>{label}</span>{sub && <span className={cn('text-[10px]', on ? 'text-slate-800' : 'text-dim')} dir="ltr">{sub}</span>}
      <span className={cn('text-xs px-1.5 rounded-full', on ? 'bg-slate-900/20' : 'bg-white/10 text-dim')}>{count}</span>
      {proposed && <span className="text-[9px] px-1 rounded bg-purple-500/30 text-purple-200">{t('مقترح')}</span>}
    </button>
  );
}

function Tile({ p, quote, onPick, disabled }: { p: any; quote?: QuoteState; onPick: () => void; disabled?: boolean }) {
  const err = quote?.error;
  const unavailable = err?.code === 'PRODUCT_UNAVAILABLE' || (p.availability?.state && p.availability.state !== 'AVAILABLE');
  const noPrice = err && !unavailable;
  const blocked = unavailable || noPrice || !quote?.data;
  return (
    <button data-fb={`tile:${p.sku}`} disabled={disabled || blocked} onClick={onPick} title={p.availability?.reason ?? ''}
      className={cn('relative overflow-hidden rounded-xl bg-white/[0.06] border border-white/[0.12] flex flex-col text-start transition-all hover:bg-white/[0.1] hover:border-cyan-400/40 hover:shadow-[0_0_30px_rgba(34,211,238,0.15)] active:scale-[.97]', blocked && 'opacity-50 cursor-not-allowed hover:border-white/[0.12] hover:shadow-none')}>
      <div className="relative aspect-[4/3] w-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${p.colorCode ?? '#334155'}33, #0f172a88)` }}>
        {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" /> : <Package className="w-10 h-10 text-white/25" />}
        <div className="absolute top-2 end-2 flex flex-col gap-1 items-end">
          {unavailable && <Pill tone="error">{p.availability?.state === 'BLOCKED' ? t('موقوف') : t('غير متاح')}</Pill>}
          {noPrice && <Pill tone="warning">{err?.code === 'PRICE_NOT_FOUND' ? t('السعر مش متاح') : err?.network ? t('السعر ما اتحملش') : t('مش متاح')}</Pill>}
          {p.direction && <Pill tone="violet">{t('مقترح')}</Pill>}
        </div>
        {p.allergens?.length ? <div className="absolute bottom-1.5 start-1.5 flex gap-1" title={p.allergens.map((a: string) => ALLERGEN_AR[a] ?? a).join('، ')}><span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/80 text-black font-bold flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />{p.allergens.length}</span></div> : null}
      </div>
      <div className="p-2.5 flex flex-col gap-1">
        <div className="font-bold text-sm leading-tight truncate">{L(p.name)}</div>
        <div className="text-[10px] text-dim truncate" dir="ltr">{p.name.en}</div>
        <div className="num text-[var(--primary)] font-bold text-sm">{quote?.data ? money(quote.data.unitTotal) : quote ? '—' : '…'}</div>
      </div>
    </button>
  );
}
