// Menus & dayparts admin: breakfast / lunch / dinner time windows (Cairo time, can cross midnight) and menus per channel
// and branch (what the cashier sees, and when). A live preview shows what is on each channel right now (mock clock).
import React, { useEffect, useMemo, useState } from 'react';
import { clock } from '../../mock/clock';
import { Clock, Plus, Pencil, Save, CalendarClock, Store, Eye } from 'lucide-react';
import { useCommand, useQuery } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, Modal, Pill, StateBadge, Switch, Tabs } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { cn } from '../../lib/format';
import { CHANNELS, Check, LocInputs, Radio, channelLabel, useItems } from '../admin/catalog/common';
import { dayName, daysText, timeText } from './parts';

type Loc = { ar: string; en: string };
interface DpDraft { id: string; name: Loc; start: string; end: string; days: number[]; color: string; active: boolean; version?: number }
interface MenuDraft { id: string; name: Loc; channels: string[]; branchIds: string[]; daypartIds: string[]; allCategories: boolean; categoryIds: string[]; excludedCategoryIds: string[]; productIds: string[]; excludedProductIds: string[]; active: boolean; version?: number }

const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

export function MenusAdmin() {
  const { run, busy } = useCommand();
  const ov = useQuery<any>('Menu.Overview');
  const cats = useItems<any>('Category.List');
  const branches = useItems<any>('Branch.List');
  const products = useItems<any>('Catalog.Search', { query: { active: 'true' } });
  const [dp, setDp] = useState<DpDraft | null>(null);
  const [menu, setMenu] = useState<MenuDraft | null>(null);
  const [pq, setPq] = useState('');
  useEffect(() => clock.subscribe(() => ov.refetch()) as () => void, []); // eslint-disable-line react-hooks/exhaustive-deps
  const d = ov.data;
  const dayparts: any[] = d?.dayparts ?? [];
  const menus: any[] = d?.menus ?? [];
  const dpName = (id: string) => L(dayparts.find((x) => x.id === id)?.name) || id;
  const catName = (id: string) => L(cats.items.find((x) => x.id === id)?.name) || id;
  const prodName = (id: string) => L(products.items.find((x) => x.id === id)?.name) || id;
  const saveDp = async () => {
    if (!dp) return;
    const r = await run('Daypart.Upsert', { params: { daypartId: dp.id || 'new' }, body: { name: dp.name, start: dp.start, end: dp.end, days: dp.days, color: dp.color, active: dp.active, expectedVersion: dp.version } }, { success: t('الفترة اتحفظت') });
    if (r) setDp(null);
  };
  const saveMenu = async () => {
    if (!menu) return;
    const { id, version, ...body } = menu;
    const r = await run('Menu.Upsert', { params: { menuId: id || 'new' }, body: { ...body, expectedVersion: version } }, { success: t('المنيو اتحفظ — الكاشير بيشوفه فورًا') });
    if (r) setMenu(null);
  };
  const toggleMenu = (m: any, v: boolean) => run('Menu.Upsert', { params: { menuId: m.id }, body: { name: m.name, channels: m.channels, active: v, expectedVersion: m.version } }, { success: v ? t('المنيو اشتغل') : t('المنيو اتقفل') });
  const content = (m: any) => {
    const parts: string[] = [];
    if (m.allCategories) parts.push(t('كل الأقسام') + (m.excludedCategoryIds?.length ? ` ${t('ما عدا')} ${m.excludedCategoryIds.map(catName).join('، ')}` : ''));
    else if (m.categoryIds?.length) parts.push(m.categoryIds.map(catName).join('، '));
    if (m.productIds?.length) parts.push(`+ ${m.productIds.map(prodName).join('، ')}`);
    if (m.excludedProductIds?.length) parts.push(`${t('من غير')}: ${m.excludedProductIds.map(prodName).join('، ')}`);
    return parts.join(' · ');
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4">
        <Card title={<span className="inline-flex items-center gap-2"><Clock className="w-4 h-4" />{t('فترات اليوم')}</span>} badge={<StateBadge ops={['Daypart.Upsert', 'Menu.Overview']} />}
          actions={<Button size="sm" variant="primary" data-fb="daypart:new" onClick={() => setDp({ id: '', name: { ar: '', en: '' }, start: '07:00', end: '12:00', days: [0, 1, 2, 3, 4, 5, 6], color: '#f97316', active: true })}><Plus className="w-3.5 h-3.5" />{t('فترة جديدة')}</Button>}>
          <Timeline dayparts={dayparts} nowLocal={d?.now?.local} />
          <div className="space-y-1.5 mt-3">
            {dayparts.map((x) => (
              <div key={x.id} className={cn('flex items-center gap-2 surface-1 rounded-lg px-3 py-2', !x.active && 'opacity-50')}>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: x.color ?? '#22d3ee' }} />
                <span className="font-bold text-sm">{L(x.name)}</span>
                <span className="num text-xs text-dim">{x.start}–{x.end}</span>
                <span className="text-xs text-dim">{daysText(x.days)}</span>
                {x.runningNow ? <Pill tone="success">{t('شغالة دلوقتي')}</Pill> : x.nextStart ? <span className="text-[11px] text-dim">{t('تبدأ')} {timeText(x.nextStart)}</span> : null}
                <div className="flex-1" />
                <Button size="sm" variant="ghost" data-fb={`daypart:edit:${x.id}`} onClick={() => setDp({ id: x.id, name: x.name, start: x.start, end: x.end, days: x.days, color: x.color ?? '#22d3ee', active: x.active, version: x.version })}><Pencil className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
          </div>
        </Card>
        <NowPreview now={d?.now} />
      </div>

      <Card title={<span className="inline-flex items-center gap-2"><CalendarClock className="w-4 h-4" />{t('المنيوهات')}</span>} badge={<StateBadge ops={['Menu.Upsert']} />}
        actions={<Button size="sm" variant="primary" data-fb="menu:new" onClick={() => setMenu({ id: '', name: { ar: '', en: '' }, channels: ['DINE_IN', 'TAKEAWAY'], branchIds: [], daypartIds: [], allCategories: false, categoryIds: [], excludedCategoryIds: [], productIds: [], excludedProductIds: [], active: true })}><Plus className="w-3.5 h-3.5" />{t('منيو جديد')}</Button>}>
        {!d?.restricted && <Banner tone="info">{t('مفيش منيو شغال — كل الأصناف بتظهر طول اليوم في كل القنوات. أول ما تشغّل منيو، الكاشير هيشوف اللي في المنيوهات الشغالة بس.')}</Banner>}
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 mt-2">
          {menus.map((m) => (
            <div key={m.id} className={cn('rounded-xl border line p-3 space-y-2', !m.active && 'opacity-60')} data-fb={`menu:card:${m.id}`}>
              <div className="flex items-center gap-2">
                <span className="font-bold">{L(m.name)}</span>
                {m.runningNow ? <Pill tone="success">{t('شغال دلوقتي')}</Pill> : m.active ? <Pill tone="neutral">{t('مش وقته')}</Pill> : <Pill tone="neutral">{t('مقفول')}</Pill>}
                <div className="flex-1" />
                <Switch checked={m.active} onChange={(v) => toggleMenu(m, v)} />
                <Button size="sm" variant="ghost" data-fb={`menu:edit:${m.id}`} onClick={() => setMenu({ id: m.id, name: m.name, channels: m.channels, branchIds: m.branchIds, daypartIds: m.daypartIds, allCategories: m.allCategories, categoryIds: m.categoryIds, excludedCategoryIds: m.excludedCategoryIds ?? [], productIds: m.productIds, excludedProductIds: m.excludedProductIds, active: m.active, version: m.version })}><Pencil className="w-3.5 h-3.5" /></Button>
              </div>
              <div className="flex flex-wrap gap-1">{m.channels.map((c: string) => <Pill key={c} tone="primary">{channelLabel(c)}</Pill>)}</div>
              <div className="text-xs text-soft flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-dim" />{m.daypartIds.length ? m.daypartIds.map(dpName).join('، ') : t('طول اليوم')}</div>
              <div className="text-xs text-soft flex items-center gap-1.5"><Store className="w-3.5 h-3.5 text-dim" />{m.branchIds.length ? m.branchIds.map((b: string) => branches.items.find((x) => x.id === b)?.name ?? b).join('، ') : t('كل الفروع')}</div>
              <div className="text-xs text-dim">{content(m)}</div>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-dim mt-2">{t('الصنف بيظهر على الكاشير لو موجود في منيو شغال للقناة والفرع والفترة دي. الصنف اللي برا مواعيده بيختفي ويرجع لوحده.')}</div>
      </Card>

      <Modal open={!!dp} onClose={() => setDp(null)} title={dp?.id ? t('تعديل الفترة') : t('فترة جديدة')} badge={<StateBadge ops={['Daypart.Upsert']} />}
        footer={<><Button onClick={() => setDp(null)}>{t('إلغاء')}</Button><Button variant="primary" data-fb="daypart:save" loading={busy} onClick={saveDp}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {dp && (
          <div className="space-y-3">
            <LocInputs value={dp.name} onChange={(name) => setDp({ ...dp, name })} fb="daypart" labelAr={t('الاسم (مثلاً: فطار)')} labelEn={t('بالإنجليزي (Breakfast)')} />
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('من الساعة')}><Input data-fb="daypart:start" type="time" value={dp.start} onChange={(e) => setDp({ ...dp, start: e.target.value })} dir="ltr" /></Field>
              <Field label={t('لحد الساعة')} hint={toMin(dp.end) <= toMin(dp.start) ? t('بتعدي نص الليل') : undefined}><Input data-fb="daypart:end" type="time" value={dp.end} onChange={(e) => setDp({ ...dp, end: e.target.value })} dir="ltr" /></Field>
              <Field label={t('اللون')}><input type="color" value={dp.color} onChange={(e) => setDp({ ...dp, color: e.target.value })} className="w-full h-10 rounded-lg bg-transparent border border-[var(--glass-border)]" /></Field>
            </div>
            <Field label={t('الأيام')}><div className="flex flex-wrap gap-1.5">{[6, 0, 1, 2, 3, 4, 5].map((dd) => <Check key={dd} checked={dp.days.includes(dd)} onChange={(on) => setDp({ ...dp, days: on ? [...dp.days, dd].sort() : dp.days.filter((x) => x !== dd) })}>{dayName(dd)}</Check>)}</div></Field>
            <Switch checked={dp.active} onChange={(v) => setDp({ ...dp, active: v })} label={dp.active ? t('شغالة') : t('مقفولة')} />
            <div className="text-[11px] text-dim">{t('بتوقيت القاهرة. اليوم اللي بيعدي نص الليل (زي العشا لحد 2 الصبح) بيتحسب تبع اليوم اللي بدأ فيه.')}</div>
          </div>
        )}
      </Modal>

      <Modal open={!!menu} onClose={() => setMenu(null)} xwide title={menu?.id ? t('تعديل المنيو') : t('منيو جديد')} badge={<StateBadge ops={['Menu.Upsert']} />}
        footer={<><Button onClick={() => setMenu(null)}>{t('إلغاء')}</Button><Button variant="primary" data-fb="menu:save" loading={busy} onClick={saveMenu}><Save className="w-4 h-4" />{t('حفظ المنيو')}</Button></>}>
        {menu && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <LocInputs value={menu.name} onChange={(name) => setMenu({ ...menu, name })} fb="menu" />
              <Field label={t('القنوات')}><div className="flex flex-wrap gap-1.5">{CHANNELS.map((c) => <Check key={c} fb={`menu:channel:${c}`} checked={menu.channels.includes(c)} onChange={(on) => setMenu({ ...menu, channels: on ? [...menu.channels, c] : menu.channels.filter((x) => x !== c) })}>{channelLabel(c)}</Check>)}</div></Field>
              <Field label={t('الفترات')} hint={t('ولا واحدة = طول اليوم')}><div className="flex flex-wrap gap-1.5">{dayparts.map((x) => <Check key={x.id} fb={`menu:daypart:${x.id}`} checked={menu.daypartIds.includes(x.id)} onChange={(on) => setMenu({ ...menu, daypartIds: on ? [...menu.daypartIds, x.id] : menu.daypartIds.filter((y) => y !== x.id) })}>{L(x.name)} <span className="num text-[10px]">{x.start}–{x.end}</span></Check>)}</div></Field>
              <Field label={t('الفروع')} hint={t('ولا واحد = كل الفروع')}><div className="flex flex-wrap gap-1.5">{branches.items.map((b) => <Check key={b.id} checked={menu.branchIds.includes(b.id)} onChange={(on) => setMenu({ ...menu, branchIds: on ? [...menu.branchIds, b.id] : menu.branchIds.filter((y) => y !== b.id) })}>{b.name}</Check>)}</div></Field>
              <Switch checked={menu.active} onChange={(v) => setMenu({ ...menu, active: v })} label={menu.active ? t('شغال') : t('مقفول')} />
            </div>
            <div className="space-y-3">
              <Field label={t('فيه إيه')}>
                <Radio<'ALL' | 'SOME'> fb="menu:content" value={menu.allCategories ? 'ALL' : 'SOME'} onChange={(v) => setMenu({ ...menu, allCategories: v === 'ALL' })} options={[{ value: 'ALL', label: t('كل الأقسام') }, { value: 'SOME', label: t('أقسام معينة') }]} />
              </Field>
              <Field label={menu.allCategories ? t('ما عدا الأقسام دي') : t('الأقسام')}>
                <div className="flex flex-wrap gap-1.5">{cats.items.map((c) => {
                  const list = menu.allCategories ? menu.excludedCategoryIds : menu.categoryIds;
                  const key = menu.allCategories ? 'excludedCategoryIds' : 'categoryIds';
                  return <Check key={c.id} fb={`menu:cat:${c.id}`} checked={list.includes(c.id)} onChange={(on) => setMenu({ ...menu, [key]: on ? [...list, c.id] : list.filter((y) => y !== c.id) } as MenuDraft)}>{L(c.name)}</Check>;
                })}</div>
              </Field>
              <Field label={t('أصناف بعينها')} hint={t('دوس مرة = ضيفه للمنيو، مرتين = استبعده، تالت مرة = شيل')}>
                <Input value={pq} onChange={(e) => setPq(e.target.value)} placeholder={t('دوّر على صنف…')} className="mb-2" />
                <div className="max-h-56 overflow-y-auto flex flex-wrap gap-1.5">
                  {products.items.filter((p) => !pq || (p.name.ar + p.name.en + p.sku).toLowerCase().includes(pq.toLowerCase())).map((p) => {
                    const inc = menu.productIds.includes(p.id), exc = menu.excludedProductIds.includes(p.id);
                    const cycle = () => setMenu({ ...menu, productIds: !inc && !exc ? [...menu.productIds, p.id] : menu.productIds.filter((x) => x !== p.id), excludedProductIds: inc ? [...menu.excludedProductIds, p.id] : menu.excludedProductIds.filter((x) => x !== p.id) });
                    return <button key={p.id} type="button" data-fb={`menu:product:${p.sku}`} onClick={cycle} className={cn('px-2 h-8 rounded-lg text-xs border', inc ? 'border-[var(--success)] text-[var(--success)] bg-[color-mix(in_srgb,var(--success)_12%,transparent)]' : exc ? 'border-[var(--error)] text-[var(--error)] bg-[color-mix(in_srgb,var(--error)_12%,transparent)] line-through' : 'border-[var(--glass-border)] text-soft')}>{L(p.name)}</button>;
                  })}
                </div>
              </Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** 24-hour bar with the dayparts as coloured segments (crossing midnight wraps) and a "now" marker. */
function Timeline({ dayparts, nowLocal }: { dayparts: any[]; nowLocal?: string }) {
  const segs = dayparts.filter((d) => d.active).flatMap((d) => {
    const s = toMin(d.start), e = toMin(d.end);
    return e > s ? [{ d, s, e }] : [{ d, s, e: 1440 }, { d, s: 0, e }];
  });
  const now = nowLocal ? toMin(nowLocal) : null;
  return (
    <div className="space-y-1">
      <div className="relative h-8 rounded-lg surface-1 overflow-hidden border line" dir="ltr">
        {segs.map((x, i) => <div key={i} title={`${L(x.d.name)} ${x.d.start}–${x.d.end}`} className="absolute top-0 bottom-0 flex items-center justify-center text-[10px] font-bold text-white/90 overflow-hidden" style={{ left: `${(x.s / 1440) * 100}%`, width: `${((x.e - x.s) / 1440) * 100}%`, background: (x.d.color ?? '#22d3ee') + 'aa' }}>{x.e - x.s > 150 ? L(x.d.name) : ''}</div>)}
        {now !== null && <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_6px_white]" style={{ left: `${(now / 1440) * 100}%` }} title={nowLocal} />}
      </div>
      <div className="flex justify-between text-[10px] text-dim num" dir="ltr">{['00', '04', '08', '12', '16', '20', '24'].map((h) => <span key={h}>{h}</span>)}</div>
    </div>
  );
}

/** What the cashier sees now on each channel (server: Catalog.Search menuNow on the mock clock). */
function NowPreview({ now }: { now?: any }) {
  const [ch, setCh] = useState<string>('DINE_IN');
  const q = useItems<any>('Catalog.Search', { query: { active: 'true', channel: ch } });
  useEffect(() => clock.subscribe(() => q.refetch()) as () => void, []); // eslint-disable-line react-hooks/exhaustive-deps
  const on = q.items.filter((p) => !p.menuNow || p.menuNow.onMenu);
  const off = q.items.filter((p) => p.menuNow && !p.menuNow.onMenu);
  const byReason = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const p of off) m.set(p.menuNow.reasonAr, [...(m.get(p.menuNow.reasonAr) ?? []), p]);
    return [...m.entries()];
  }, [off]);
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Eye className="w-4 h-4" />{t('الكاشير شايف إيه دلوقتي')}</span>} badge={<Pill tone="neutral"><span className="num">{now?.local ?? '…'}</span></Pill>}>
      <Tabs value={ch} onChange={setCh} tabs={CHANNELS.map((c) => ({ id: c, label: channelLabel(c) }))} />
      <div className="mt-3 space-y-2 text-sm">
        <div><b className="num text-[var(--success)]">{on.length}</b> {t('صنف ظاهر')} · <b className="num text-dim">{off.length}</b> {t('مخفي')}</div>
        {byReason.map(([reason, ps]) => (
          <div key={reason} className="surface-1 rounded-lg px-3 py-2">
            <div className="text-xs text-dim mb-1">{reason}</div>
            <div className="flex flex-wrap gap-1">{ps.map((p) => <Pill key={p.id} tone="neutral">{L(p.name)}</Pill>)}</div>
          </div>
        ))}
        <div className="text-[11px] text-dim">{t('حرّك الساعة الوهمية من فوق عشان تشوف الفطار يظهر ويختفي.')}</div>
        <Tech><div className="text-[11px] text-dim num">{t('اليوم التجاري')} {now?.businessDate}</div></Tech>
      </div>
    </Card>
  );
}
