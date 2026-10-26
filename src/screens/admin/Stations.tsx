// F2 Stations, routing & tables (J-A1 step 11): kitchen stations, routing rules in ascending priority with an
// explicit catch-all (no implicit default station), and the floor tables by area.
import React, { useMemo, useState } from 'react';
import { ChefHat, Route, Plus, Pencil, Power, Armchair, AlertTriangle, Users } from 'lucide-react';
import { useCommand, useDev } from '../../app/hooks';
import { Banner, Button, Card, EmptyState, Field, Input, PageHeader, Pill, Select, StatCard, StatGrid, StateBadge, Switch, Table, Tabs } from '../../ui';
import { t, L } from '../../i18n';
import { Tech } from '../../app/tech';
import { stationName } from '../../demo/humanLog';
import { cn } from '../../lib/format';
import { useList, usePerm, Refused, CHANNELS, channelLabel, Modal } from './org/common';

export default function Stations() {
  const [tab, setTab] = useState<'kitchen' | 'tables'>('kitchen');
  const { me, auth } = useDev();
  const noBranch = !(me?.branchId ?? auth.branchId);
  const stations = useList<any>('KitchenStation.List');
  const rules = useList<any>('RoutingRule.List');
  const tables = useList<any>('Table.List');
  const catchAll = rules.items.some((r) => r.active && !r.match?.productId && !r.match?.categoryId && !r.match?.channel);
  return (
    <div className="space-y-4" data-fb="screen:F2">
      <PageHeader
        icon={<Route />}
        title={t('المطبخ والمحطات والترابيزات')}
        badge={<StateBadge ops={['KitchenStation.List', 'KitchenStation.Create', 'KitchenStation.Configure', 'RoutingRule.List', 'RoutingRule.Create', 'RoutingRule.Configure', 'Table.List', 'Table.Create', 'Table.Configure', 'Table.SetActive']} />}
        description={t('كل صنف بيتبعت للمطبخ بيروح لمحطة حسب أول قاعدة تنطبق عليه. الترابيزات بتظهر في شاشة الصالة على طول.')}
      />
      {noBranch && <Banner tone="warning">{t('الجهاز ده مش متربط بفرع، والمحطات والترابيزات تبع فرع. ادخل من جهاز في الفرع أو اختار الفرع من شاشة الدخول.')}<Tech> (CONTEXT_REQUIRED)</Tech></Banner>}
      <StatGrid>
        <StatCard label={t('محطات شغالة')} value={stations.items.filter((x) => x.active).length} icon={<ChefHat />} loading={stations.loading && !stations.data} />
        <StatCard label={t('قواعد التوزيع')} value={rules.items.filter((x) => x.active).length} icon={<Route />} tone={catchAll || !rules.items.length ? 'neutral' : 'error'} hint={catchAll ? t('فيه قاعدة «أي حاجة تانية» في الآخر') : t('ناقصة قاعدة «أي حاجة تانية»')} loading={rules.loading && !rules.data} />
        <StatCard label={t('ترابيزات شغالة')} value={tables.items.filter((x) => x.active).length} icon={<Armchair />} hint={t('{n} كرسي', { n: tables.items.filter((x) => x.active).reduce((a, x) => a + Number(x.capacity ?? 0), 0) })} loading={tables.loading && !tables.data} />
      </StatGrid>
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'kitchen', icon: <ChefHat className="w-4 h-4" />, label: t('المحطات والتوزيع') }, { id: 'tables', icon: <Armchair className="w-4 h-4" />, label: t('الترابيزات'), count: tables.items.length || undefined }]} />
      {tab === 'kitchen' ? <KitchenTab /> : <TablesTab />}
    </div>
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

// ───────── tables
function TablesTab() {
  const tables = useList<any>('Table.List');
  const perm = usePerm('table:upsert');
  const { run, busy } = useCommand();
  const [edit, setEdit] = useState<any | null | 'new'>(null);
  const areas = useMemo(() => [...new Set(tables.items.map((x) => x.area || t('من غير منطقة')))], [tables.items]);
  const setActive = (x: any) => run('Table.SetActive', { params: { tableId: x.id }, body: { active: !x.active, expectedVersion: x.version } }, { success: x.active ? t('الترابيزة {n} اتقفلت', { n: x.name }) : t('الترابيزة {n} اتفعلت', { n: x.name }) });
  return (
    <Card title={<span className="flex items-center gap-2"><Armchair className="w-4 h-4 text-[var(--primary)]" />{t('الترابيزات')}</span>} description={t('الترابيزة اللي عليها ناس مينفعش تتقفل، والاسم مينفعش يتكرر في نفس الفرع.')}
      actions={<Button size="sm" variant="primary" data-fb="tables:new" disabled={!perm.ok} title={perm.title} onClick={() => setEdit('new')}><Plus className="w-3.5 h-3.5" />{t('ترابيزة')}</Button>}>
      <Refused error={tables.error} />
      <Tech><div className="text-[11px] text-dim num">TABLE_OCCUPIED · TABLE_NAME_TAKEN</div></Tech>
      <div className="space-y-4">
        {areas.map((a) => (
          <div key={a}>
            <div className="text-sm font-bold mb-2">{a} <span className="text-dim font-normal text-xs">({tables.items.filter((x) => (x.area || t('من غير منطقة')) === a).length})</span></div>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
              {tables.items.filter((x) => (x.area || t('من غير منطقة')) === a).map((x) => (
                <div key={x.id} className={cn('rounded-xl border line p-2 space-y-1', x.occupancy ? 'bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]' : 'surface-1', !x.active && 'opacity-50')} data-fb={`tables:table:${x.name}`}>
                  <div className="flex items-center justify-between gap-1"><span className="font-bold">{x.name}</span><span className="text-xs text-dim flex items-center gap-0.5"><Users className="w-3 h-3" /><span className="num">{x.capacity}</span></span></div>
                  <div className="flex flex-wrap gap-1">
                    {!x.active ? <Pill tone="neutral">{t('مقفولة')}</Pill> : x.occupancy ? <Pill tone="warning">{t('عليها ناس')} · <span className="num">{x.occupancy.guestCount}</span></Pill> : <Pill tone="success">{t('فاضية')}</Pill>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={!perm.ok} title={t('تعديل')} onClick={() => setEdit(x)} data-fb={`tables:edit:${x.name}`}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" disabled={!perm.ok || busy} title={x.active ? t('قفل الترابيزة') : t('تفعيل')} onClick={() => setActive(x)} data-fb={`tables:toggle:${x.name}`}><Power className={cn('w-3.5 h-3.5', x.active ? 'text-[var(--error)]' : 'text-[var(--success)]')} /></Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {tables.items.length === 0 && !tables.error && <EmptyState compact icon={<Armchair />} title={t('مفيش ترابيزات لسه')} text={t('ضيف الترابيزات هنا أو ارسمها من «خريطة الصالة».')} />}
      </div>
      {edit && <TableModal table={edit === 'new' ? null : edit} areas={areas} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function TableModal({ table, areas, onClose }: { table: any | null; areas: string[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [name, setName] = useState(table?.name ?? '');
  const [area, setArea] = useState(table?.area ?? areas[0] ?? '');
  const [capacity, setCapacity] = useState(String(table?.capacity ?? 4));
  const save = async () => {
    const body = { name: name.trim(), area: area.trim(), capacity: Number(capacity) };
    const r = table
      ? await run('Table.Configure', { params: { tableId: table.id }, body: { ...body, expectedVersion: table.version } }, { success: t('اتحفظت الترابيزة') })
      : await run('Table.Create', { body }, { success: t('اتعملت الترابيزة {n}', { n: body.name }) });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={table ? t('تعديل الترابيزة {n}', { n: table.name }) : t('ترابيزة جديدة')} badge={<StateBadge ops={[table ? 'Table.Configure' : 'Table.Create']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!name.trim() || !(Number(capacity) >= 1)} onClick={save} data-fb="tables:save">{t('حفظ')}</Button></>}>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('الاسم')}><Input value={name} onChange={(e) => setName(e.target.value)} data-fb="tables:name" /></Field>
        <Field label={t('المنطقة')}>
          <Input value={area} onChange={(e) => setArea(e.target.value)} list="table-areas" data-fb="tables:area" />
          <datalist id="table-areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
        </Field>
        <Field label={t('عدد الكراسي')}><Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} data-fb="tables:capacity" /></Field>
      </div>
    </Modal>
  );
}
