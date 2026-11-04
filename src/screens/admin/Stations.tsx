// F2 Stations, routing & tables (J-A1 step 11): kitchen stations, routing rules in ascending priority with an
// explicit catch-all (no implicit default station), the floor tables by area, and (round 3) the kitchen screens:
// which stations each KDS terminal shows, whether it is the dispatch screen, and the «ابدأ» policy.
import React, { useMemo, useState } from 'react';
import { ChefHat, Route, Plus, Pencil, Power, Armchair, AlertTriangle, Users, MonitorPlay, ConciergeBell, Save } from 'lucide-react';
import { useCommand, useDev } from '../../app/hooks';
import { Banner, Button, Card, EmptyState, Field, Input, PageHeader, Pill, Select, StatCard, StatGrid, StateBadge, Switch, Table, Tabs, SegmentedControl } from '../../ui';
import { t, L, tv } from '../../i18n';
import { Tech } from '../../app/tech';
import { stationName } from '../../demo/humanLog';
import { cn } from '../../lib/format';
import { useList, usePerm, Refused, CHANNELS, channelLabel, Modal } from './org/common';

export default function Stations() {
  const { params } = useDev();
  const [tab, setTab] = useState<'kitchen' | 'screens'>(params?.tab === 'screens' ? 'screens' : 'kitchen');
  const { me, auth, nav } = useDev();
  const screens = useList<any>('KdsScreen.List');
  const noBranch = !(me?.branchId ?? auth.branchId);
  const stations = useList<any>('KitchenStation.List');
  const rules = useList<any>('RoutingRule.List');
  const tables = useList<any>('Table.List'); // count only — tables are managed in «خريطة الصالة»
  const catchAll = rules.items.some((r) => r.active && !r.match?.productId && !r.match?.categoryId && !r.match?.channel);
  return (
    <div className="space-y-4" data-fb="screen:F2">
      <PageHeader
        icon={<Route />}
        title={t('المحطات والتوجيه')}
        badge={<StateBadge ops={['KdsScreen.List', 'KdsScreen.Configure', 'KitchenStation.List', 'KitchenStation.Create', 'KitchenStation.Configure', 'RoutingRule.List', 'RoutingRule.Create', 'RoutingRule.Configure']} />}
        description={t('كل صنف بيتبعت للمطبخ بيروح لمحطة حسب أول قاعدة تنطبق عليه.')}
      />
      {noBranch && <Banner tone="warning">{t('الجهاز ده مش متربط بفرع، والمحطات والترابيزات تبع فرع. ادخل من جهاز في الفرع أو اختار الفرع من شاشة الدخول.')}<Tech> (CONTEXT_REQUIRED)</Tech></Banner>}
      <StatGrid>
        <StatCard label={t('محطات شغالة')} value={stations.items.filter((x) => x.active).length} icon={<ChefHat />} loading={stations.loading && !stations.data} />
        <StatCard label={t('قواعد التوزيع')} value={rules.items.filter((x) => x.active).length} icon={<Route />} tone={catchAll || !rules.items.length ? 'neutral' : 'error'} hint={catchAll ? t('فيه قاعدة «أي حاجة تانية» في الآخر') : t('ناقصة قاعدة «أي حاجة تانية»')} loading={rules.loading && !rules.data} />
        {/* ux-07: tables are defined and drawn in one place — «خريطة الصالة» */}
        <StatCard label={t('ترابيزات شغالة')} value={tables.items.filter((x) => x.active).length} icon={<Armchair />} hint={t('تُدار من خريطة الصالة')} onClick={() => nav('floorplan')} fb="stations:floorplan" loading={tables.loading && !tables.data} />
      </StatGrid>
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'kitchen', icon: <ChefHat className="w-4 h-4" />, label: t('المحطات والتوزيع') }, { id: 'screens', icon: <MonitorPlay className="w-4 h-4" />, label: <span data-fb="stations:tab:screens">{t('شاشات المطبخ')}</span>, count: screens.items.length || undefined }]} />
      {tab === 'kitchen' ? <KitchenTab /> : <ScreensTab />}
    </div>
  );
}

// ───────── kitchen screens (round 3: F3-02, F2-06, E04–E06)
const START_OPTS = [
  { id: 'HIDDEN', label: 'مخفي', help: 'مفيش زرار «ابدأ». العداد شغال من ساعة ما الطلب وصل.' },
  { id: 'OPTIONAL', label: 'اختياري', help: 'الشيف يدوس «ابدأ» لو عايز يسجّل إمتى بدأ فعلًا — مش لازم.' },
  { id: 'REQUIRED', label: 'لازم', help: 'مفيش «جاهز» قبل «ابدأ». العداد برضه شغال من ساعة الوصول.' },
] as const;
function ScreensTab() {
  const screens = useList<any>('KdsScreen.List');
  const stations = useList<any>('KitchenStation.List');
  const perm = usePerm('kitchen:configure');
  const active = stations.items.filter((s) => s.active);
  const covered = new Set<string>(screens.items.flatMap((x) => (x.stationIds.length ? x.stationIds : active.map((s) => s.id))));
  const orphan = active.filter((s) => !covered.has(s.id));
  const hasDispatch = screens.items.some((x) => x.dispatch);
  return (
    <div className="space-y-3">
      <Banner tone="info" title={t('كل شاشة مطبخ بتشترك في محطاتها')}>{t('شاشة المحطة بتعرض أصنافها بس، و«جاهز» بيبعت الطلب لشاشة التسليم. «جاهز للتسليم» والتسليم للويتر بيظهروا على شاشة التسليم بس. «المطلوب دلوقتي» ثابت على جنب في كل الشاشات.')}</Banner>
      {!hasDispatch && screens.items.length > 0 && <Banner tone="warning">{t('مفيش شاشة تسليم — كل شاشة هتسلّم الطلبات بتاعتها بنفسها لحد ما تختار شاشة تسليم.')}</Banner>}
      {orphan.length > 0 && <Banner tone="warning">{t('المحطات دي مش ظاهرة على أي شاشة: {s}. ضيفها لشاشة عشان طلباتها تتشاف.', { s: orphan.map((x) => stationName(x.name)).join(t('، ')) })}</Banner>}
      <Refused error={screens.error} />
      <div className="grid @4xl/main:grid-cols-2 gap-3">
        {screens.items.map((sc) => <ScreenCard key={sc.terminalId} sc={sc} stations={active} perm={perm} />)}
      </div>
      {!screens.items.length && !screens.error && <EmptyState icon={<MonitorPlay />} title={t('مفيش شاشات مطبخ في الفرع ده')} text={t('ضيف جهاز من نوع «شاشة المطبخ» من شاشة الأجهزة.')} />}
    </div>
  );
}
function ScreenCard({ sc, stations, perm }: { sc: any; stations: any[]; perm: { ok: boolean; title?: string } }) {
  const { run, busy } = useCommand();
  const [ids, setIds] = useState<string[]>(sc.stationIds);
  const [dispatch, setDispatch] = useState<boolean>(sc.dispatch);
  const [start, setStart] = useState<string>(sc.start);
  // ux-04: the screen's own timer colours (empty = the kitchen timing policy) and per-item bump
  const [warn, setWarn] = useState<string>(sc.warnMinutes ? String(sc.warnMinutes) : '');
  const [late, setLate] = useState<string>(sc.lateMinutes ? String(sc.lateMinutes) : '');
  const [itemBump, setItemBump] = useState<boolean>(sc.itemBump !== false);
  const timerDirty = warn !== (sc.warnMinutes ? String(sc.warnMinutes) : '') || late !== (sc.lateMinutes ? String(sc.lateMinutes) : '');
  const timerOk = (!warn && !late) || (/^\d+$/.test(warn) && /^\d+$/.test(late) && Number(warn) >= 1 && Number(late) > Number(warn) && Number(late) <= 180);
  const dirty = ids.join(',') !== sc.stationIds.join(',') || dispatch !== sc.dispatch || start !== sc.start || timerDirty || itemBump !== (sc.itemBump !== false);
  const save = () => run('KdsScreen.Configure', { params: { terminalId: sc.terminalId }, body: { stationIds: ids, dispatch, start, itemBump, ...(timerDirty ? { warnMinutes: warn ? Number(warn) : null, lateMinutes: late ? Number(late) : null } : {}), expectedVersion: sc.configured ? sc.version : undefined } }, { success: t('إعداد الشاشة اتحفظ — الشاشة بتتحدث على طول') });
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  return (
    <Card data-fb={`kds-screen:${sc.terminalId}`} title={<span className="flex items-center gap-2"><MonitorPlay className="w-4 h-4 text-[var(--primary)]" />{tv(sc.terminalName)}{dispatch && <Pill tone="success"><ConciergeBell className="w-3 h-3" />{t('شاشة التسليم')}</Pill>}</span>}
      description={ids.length ? t('بتعرض: {s}', { s: ids.map((id) => stationName(stations.find((x) => x.id === id)?.name)).join(t('، ')) }) : t('بتعرض كل المحطات')}
      footer={<div className="flex items-center justify-end gap-2"><Tech><span className="num text-[10px] text-dim me-auto">{sc.terminalCode} · v{sc.version}</span></Tech><Button size="sm" variant="primary" disabled={!perm.ok || !dirty || !timerOk || busy} title={perm.title} onClick={save} data-fb={`kds-screen-save:${sc.terminalId}`}><Save className="w-3.5 h-3.5" />{t('احفظ')}</Button></div>}>
      <div className="space-y-4">
        <Field label={t('المحطات اللي بتظهر على الشاشة دي')} hint={t('مفيش اختيار = كل المحطات.')}>
          <div className="flex flex-wrap gap-1.5">
            {stations.map((s) => <button key={s.id} type="button" disabled={!perm.ok} onClick={() => toggle(s.id)} data-fb={`kds-screen-station:${sc.terminalId}:${s.name}`} aria-pressed={ids.includes(s.id)} className={cn('h-10 px-3 rounded-xl border text-sm font-bold', ids.includes(s.id) ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'surface-1 border-[var(--glass-border)] text-soft')}>{stationName(s.name)}</button>)}
          </div>
        </Field>
        <div className="flex items-start justify-between gap-3 rounded-xl surface-1 px-3 py-2.5">
          <div className="min-w-0"><div className="font-bold text-sm">{t('شاشة تسليم (إكسبو)')}</div><div className="text-xs text-dim">{t('عليها «جاهز للتسليم» والتسليم للويتر. شاشات المحطات التانية «جاهز» عندها بيبعت الطلب هنا.')}</div></div>
          <span data-fb={`kds-screen-dispatch:${sc.terminalId}`}><Switch checked={dispatch} onChange={setDispatch} disabled={!perm.ok} /></span>
        </div>
        <Field label={t('زرار «ابدأ»')} hint={START_OPTS.find((o) => o.id === start)?.help ? t(START_OPTS.find((o) => o.id === start)!.help) : undefined}>
          <SegmentedControl value={start} onChange={setStart} options={START_OPTS.map((o) => ({ id: o.id, label: t(o.label), fb: `kds-screen-start:${sc.terminalId}:${o.id}`, disabled: !perm.ok }))} />
        </Field>
        <Field label={t('ألوان المؤقت (بالدقائق)')} error={timerOk ? null : t('الأحمر بعد الأصفر، والقيمتان معًا أو فارغتان.')}>
          <div className="flex items-center gap-2 flex-wrap" data-fb={`kds-screen-timer:${sc.terminalId}`}>
            <span className="inline-flex items-center gap-1.5 text-sm"><span className="w-3 h-3 rounded-full bg-[var(--warning)]" />{t('أصفر من')}</span>
            <Input value={warn} onChange={(e) => setWarn(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} disabled={!perm.ok} inputMode="numeric" className="!w-20 num text-center" data-fb={`kds-screen-warn:${sc.terminalId}`} aria-label={t('أصفر من')} />
            <span className="inline-flex items-center gap-1.5 text-sm"><span className="w-3 h-3 rounded-full bg-[var(--error)]" />{t('أحمر من')}</span>
            <Input value={late} onChange={(e) => setLate(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} disabled={!perm.ok} inputMode="numeric" className="!w-20 num text-center" data-fb={`kds-screen-late:${sc.terminalId}`} aria-label={t('أحمر من')} />
            {!warn && !late && <span className="text-xs text-dim">{t('حسب سياسة توقيت المطبخ')}</span>}
          </div>
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-xl surface-1 px-3 py-2.5">
          <div className="font-bold text-sm">{t('تجهيز كل صنف بلمسة')}</div>
          <span data-fb={`kds-screen-itembump:${sc.terminalId}`}><Switch checked={itemBump} onChange={setItemBump} disabled={!perm.ok} /></span>
        </div>
      </div>
    </Card>
  );
}

// ───────── stations + routing
function KitchenTab() {
  const stations = useList<any>('KitchenStation.List');
  const rules = useList<any>('RoutingRule.List');
  const products = useList<any>('Catalog.Search', { query: { limit: 500 } });
  const categories = useList<any>('Category.List');
  const perm = usePerm('kitchen:configure');
  const { run, busy } = useCommand();
  const [stEdit, setStEdit] = useState<any | null | 'new'>(null);
  const [rEdit, setREdit] = useState<any | null | 'new'>(null);
  const stName = (id: string) => stationName(stations.items.find((s) => s.id === id)?.name) || t('محطة');
  const pName = (id: string) => L(products.items.find((p) => p.id === id)?.name) || id;
  const cName = (id: string) => L(categories.items.find((c) => c.id === id)?.name) || id;
  const isCatchAll = (r: any) => !r.match?.productId && !r.match?.categoryId && !r.match?.channel;
  const activeRules = rules.items.filter((r) => r.active);
  const catchAll = activeRules.find(isCatchAll);
  const afterCatchAll = catchAll ? activeRules.filter((r) => r.priority > catchAll.priority) : [];
  const toggleStation = (s: any) => run('KitchenStation.Configure', { params: { stationId: s.id }, body: { name: s.name, active: !s.active, expectedVersion: s.version } }, { success: s.active ? t('اتوقفت المحطة') : t('اتفعلت المحطة') });
  return (
    <div className="grid xl:grid-cols-[minmax(280px,1fr)_2fr] gap-4 items-start">
      <Card title={<span className="flex items-center gap-2"><ChefHat className="w-4 h-4 text-[var(--primary)]" />{t('محطات المطبخ')}</span>} description={t('كل محطة ليها شاشة طلبات لوحدها.')}
        actions={<Button size="sm" variant="primary" data-fb="stations:new" disabled={!perm.ok} title={perm.title} onClick={() => setStEdit('new')}><Plus className="w-3.5 h-3.5" />{t('محطة')}</Button>}>
        <Refused error={stations.error} />
        <div className="space-y-1.5">
          {stations.items.map((s) => (
            <div key={s.id} className={cn('flex items-center justify-between gap-2 rounded-xl surface-1 px-3 py-2', !s.active && 'opacity-60')} data-fb={`stations:station:${s.name}`}>
              <div className="min-w-0"><div className="font-bold text-sm truncate">{stationName(s.name)}</div><Tech><div className="text-[10px] num text-dim">{s.name} · {s.id} · v{s.version}</div></Tech></div>
              <div className="flex items-center gap-1">
                {s.active ? <Pill tone="success">{t('شغالة')}</Pill> : <Pill tone="neutral">{t('موقوفة')}</Pill>}
                <Button size="sm" variant="ghost" disabled={!perm.ok} title={t('تغيير الاسم')} onClick={() => setStEdit(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="ghost" disabled={!perm.ok || busy} title={s.active ? t('إيقاف') : t('تفعيل')} onClick={() => toggleStation(s)} data-fb={`stations:toggle:${s.name}`}><Power className={cn('w-3.5 h-3.5', s.active ? 'text-[var(--error)]' : 'text-[var(--success)]')} /></Button>
              </div>
            </div>
          ))}
          {stations.items.length === 0 && !stations.error && <EmptyState compact icon={<ChefHat />} title={t('مفيش محطات لسه')} text={t('ابدأ بمحطة زي المشويات أو البارد أو البار.')} />}
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><Route className="w-4 h-4 text-[var(--primary)]" />{t('مين يروح فين')}</span>} description={t('القواعد بتتقري بالترتيب، وأول قاعدة تنطبق على الصنف هي اللي بتحدد المحطة.')}
        actions={<Button size="sm" variant="primary" data-fb="routing:new" disabled={!perm.ok || stations.items.length === 0} title={perm.title} onClick={() => setREdit('new')}><Plus className="w-3.5 h-3.5" />{t('قاعدة')}</Button>}>
        <div className="space-y-3">
          <div className="text-xs text-dim">{t('مفيش محطة افتراضية مخفية: لازم قاعدة «أي حاجة تانية» في الآخر عشان أي صنف جديد يوصل لمحطة.')}</div>
          {!catchAll && rules.items.length > 0 && <Banner tone="error"><span className="flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{t('مفيش قاعدة عامة شغالة: أي صنف مش متطابق مع قاعدة مش هيروح لأي محطة.')}</span></Banner>}
          {afterCatchAll.length > 0 && <Banner tone="warning">{t('في {n} قاعدة بعد القاعدة العامة — عمرها ما هتتطبق.', { n: afterCatchAll.length })}</Banner>}
          <Refused error={rules.error} />
          <Table head={[t('الأولوية'), t('ينطبق على'), t('يروح لـ'), t('الحالة'), '']}
            rows={rules.items.map((r) => {
              const m = r.match ?? {};
              const parts = [m.productId && <Pill key="p" tone="primary">{t('صنف')}: {pName(m.productId)}</Pill>, m.categoryId && <Pill key="c" tone="info">{t('قسم')}: {cName(m.categoryId)}</Pill>, m.channel && <Pill key="ch" tone="neutral">{channelLabel(m.channel)}</Pill>].filter(Boolean);
              const dead = afterCatchAll.includes(r);
              return [
                <span className={cn('num font-bold', dead && 'line-through text-dim')}>{r.priority}</span>,
                parts.length ? <div className="flex flex-wrap gap-1">{parts}</div> : <Pill tone="violet">{t('أي حاجة تانية')}</Pill>,
                r.destination === 'NO_TICKET' ? <span className="flex items-center gap-1"><Pill tone="neutral">{t('من غير ورقة للمطبخ')}</Pill><Tech><StateBadge state="PROPOSED" /></Tech></span> : <span className="font-bold">{stName(r.stationId)}</span>,
                r.active ? <Pill tone="success">{t('شغالة')}</Pill> : <Pill tone="neutral">{t('موقوفة')}</Pill>,
                <Button size="sm" variant="ghost" disabled={!perm.ok} title={perm.title} onClick={() => setREdit(r)} data-fb={`routing:edit:${r.priority}`}><Pencil className="w-3.5 h-3.5" /></Button>,
              ];
            })} empty={<EmptyState compact icon={<Route />} title={t('مفيش قواعد لسه')} text={t('من غير قواعد، الأصناف اللي بتتبعت مش هتوصل لأي محطة. ضيف قاعدة «أي حاجة تانية».')} />} />
          <div className="text-[11px] text-dim">{t('شاشة المطبخ والشيك نفسه بيقولوا كل صنف راح فين فعلًا.')}</div>
        </div>
      </Card>
      {stEdit && <StationModal station={stEdit === 'new' ? null : stEdit} onClose={() => setStEdit(null)} />}
      {rEdit && <RuleModal rule={rEdit === 'new' ? null : rEdit} stations={stations.items} products={products.items} categories={categories.items} nextPriority={(rules.items.filter((r) => !isCatchAll(r)).reduce((a, r) => Math.max(a, r.priority), 0) || 0) + 10} onClose={() => setREdit(null)} />}
    </div>
  );
}

function StationModal({ station, onClose }: { station: any | null; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [name, setName] = useState(station?.name ?? '');
  const save = async () => {
    const r = station
      ? await run('KitchenStation.Configure', { params: { stationId: station.id }, body: { name: name.trim(), active: station.active, expectedVersion: station.version } }, { success: t('اتحفظت المحطة') })
      : await run('KitchenStation.Create', { body: { name: name.trim() } }, { success: t('اتعملت المحطة') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={station ? t('تغيير اسم المحطة') : t('محطة جديدة')} badge={<StateBadge ops={[station ? 'KitchenStation.Configure' : 'KitchenStation.Create']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save} data-fb="stations:save">{t('حفظ')}</Button></>}>
      <Field label={t('اسم المحطة')} hint={t('مثلًا: الشواية، البارد، البار. مينفعش يتكرر في نفس الفرع.')}><Input value={name} onChange={(e) => setName(e.target.value)} data-fb="stations:name" /></Field>
    </Modal>
  );
}

function RuleModal({ rule, stations, products, categories, nextPriority, onClose }: { rule: any | null; stations: any[]; products: any[]; categories: any[]; nextPriority: number; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [priority, setPriority] = useState(String(rule?.priority ?? nextPriority));
  const [productId, setProductId] = useState(rule?.match?.productId ?? '');
  const [categoryId, setCategoryId] = useState(rule?.match?.categoryId ?? '');
  const [channel, setChannel] = useState(rule?.match?.channel ?? '');
  const [stationId, setStationId] = useState(rule?.stationId ?? stations.find((s) => s.active)?.id ?? '');
  const [destination, setDestination] = useState<'STATION' | 'NO_TICKET'>(rule?.destination ?? 'STATION');
  const [active, setActive] = useState<boolean>(rule?.active ?? true);
  // the version this edit is based on: a stale version gives CONCURRENCY_CONFLICT (another device changed the rule)
  const [baseVersion] = useState<number | null>(rule?.version ?? null);
  const match = Object.fromEntries(Object.entries({ productId, categoryId, channel }).filter(([, v]) => v));
  const catchAll = Object.keys(match).length === 0;
  const save = async () => {
    let r;
    if (rule) {
      const body: any = { priority: Number(priority), match, active, expectedVersion: baseVersion };
      if (stationId !== rule.stationId) body.stationId = stationId; // not a RoutingRule.Configure input (مقترح)
      if (destination !== rule.destination) body.destination = destination;
      r = await run('RoutingRule.Configure', { params: { ruleId: rule.id }, body }, { success: t('اتحفظت القاعدة') });
    } else {
      const body: any = { priority: Number(priority), match, stationId: destination === 'STATION' ? stationId : undefined };
      if (destination !== 'STATION') body.destination = destination;
      r = await run('RoutingRule.Create', { body }, { success: t('اتعملت القاعدة') });
    }
    if (r) onClose();
  };
  return (
    <Modal open wide onClose={onClose} title={rule ? t('تعديل قاعدة') : t('قاعدة جديدة')} badge={<StateBadge ops={[rule ? 'RoutingRule.Configure' : 'RoutingRule.Create']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!priority || (destination === 'STATION' && !stationId)} onClick={save} data-fb="routing:save">{t('حفظ')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('الترتيب')} hint={t('الرقم الأصغر بيتقري الأول')}><Input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} data-fb="routing:priority" /></Field>
          {rule && <Field label={t('الحالة')}><Switch checked={active} onChange={setActive} label={active ? t('شغالة') : t('موقوفة')} /></Field>}
        </div>
        <div className="text-xs font-bold text-soft">{t('ينطبق على (سيبهم فاضيين = أي حاجة تانية)')}</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('صنف')}><Select value={productId} onChange={(e) => setProductId(e.target.value)} options={[{ value: '', label: t('أي صنف') }, ...products.map((p) => ({ value: p.id, label: L(p.name) }))]} data-fb="routing:product" /></Field>
          <Field label={t('قسم')}><Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={[{ value: '', label: t('أي قسم') }, ...categories.map((c) => ({ value: c.id, label: L(c.name) }))]} data-fb="routing:category" /></Field>
          <Field label={t('نوع الطلب')}><Select value={channel} onChange={(e) => setChannel(e.target.value)} options={[{ value: '', label: t('أي نوع') }, ...CHANNELS.map((c) => ({ value: c, label: channelLabel(c) }))]} data-fb="routing:channel" /></Field>
        </div>
        {catchAll && <Banner tone="info">{t('دي قاعدة «أي حاجة تانية»: خلّي رقمها أكبر رقم عشان تبقى الأخيرة.')}</Banner>}
        <div className="grid grid-cols-2 gap-3">
          <Field label={<span className="flex items-center gap-2">{t('يروح فين')}<Tech><StateBadge state="PROPOSED" /></Tech></span>} hint={t('«من غير ورقة للمطبخ» للأصناف اللي مش محتاجة تحضير زي المية الساقعة.')}>
            <Select value={destination} onChange={(e) => setDestination(e.target.value as any)} options={[{ value: 'STATION', label: t('محطة') }, { value: 'NO_TICKET', label: t('من غير ورقة للمطبخ') }]} />
          </Field>
          {destination === 'STATION' && (
            <Field label={<span className="flex items-center gap-2">{t('المحطة')}{rule && <Tech><StateBadge state="PROPOSED" /></Tech>}</span>} hint={<>{t('المحطة الموقوفة مينفعش تستقبل طلبات.')}<Tech> {rule ? t('RoutingRule.Configure مفيهوش تغيير المحطة؛ في العقد بتعمل قاعدة جديدة.') : 'KITCHEN_STATION_INACTIVE'}</Tech></>}>
              <Select value={stationId} onChange={(e) => setStationId(e.target.value)} options={stations.map((s) => ({ value: s.id, label: `${stationName(s.name)}${s.active ? '' : ' — ' + t('موقوفة')}` }))} data-fb="routing:station" />
            </Field>
          )}
        </div>
        {rule && <Tech><div className="text-[11px] text-dim">{t('التعديل مبني على النسخة {v}. لو جهاز تاني عدّل القاعدة قبلك هيرجع CONCURRENCY_CONFLICT وتعمل تحديث.', { v: baseVersion ?? '—' })}</div></Tech>}
      </div>
    </Modal>
  );
}

