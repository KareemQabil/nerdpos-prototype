// Warehouses: the main store and the kitchen of each branch. One per branch is the sales warehouse —
// the one sales consume their recipes from.
import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Star, Warehouse as WhIcon, Eye, Save } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Banner, Button, Card, Empty, Field, Input, KV, Modal, Money, Pill, Section, Select, Spinner, StateBadge, Switch, Table } from '../../ui';
import { t, L, tv } from '../../i18n';
import { dateTime } from '../../lib/format';
import { LevelPill, Qty, WH_KIND, fmtQty, newKey, useList } from './common';
import { ItemDrawer } from './ItemDrawer';

const OPS = ['Warehouse.List', 'Warehouse.Get', 'Warehouse.Configure', 'Warehouse.SetSalesDefault'];

export default function Warehouses() {
  const { params } = useDev();
  const { run, busy } = useCommand();
  const q = useList<any>('Warehouse.List', { branchId: 'ALL' });
  const branches = useList<any>('Branch.List');
  const [form, setForm] = useState<any | null>(null);
  const [view, setView] = useState<string | null>(params?.open ?? null);
  useEffect(() => { if (params?.open) setView(params.open); }, [params?.open]);
  const byBranch = new Map<string, any[]>();
  for (const w of q.items) byBranch.set(w.branchId, [...(byBranch.get(w.branchId) ?? []), w]);
  const branchList = branches.items.length ? branches.items : [...byBranch.keys()].map((id) => ({ id, name: byBranch.get(id)![0].branchName }));
  const setDefault = (w: any) => run('Warehouse.SetSalesDefault', { params: { warehouseId: w.id }, body: { expectedVersion: w.version } }, { success: t('{n} بقى مخزن البيع للفرع', { n: w.name }) });
  return (
    <div>
      <Section title={t('المخازن')} badge={<StateBadge ops={OPS} />} sub={t('كل فرع ليه مخزن رئيسي ومطبخ (ولو حابب بار). مخزن البيع ★ هو اللي المبيعات بتسحب منه الخامات.')}
        actions={<Button data-fb="wh:new" variant="primary" onClick={() => setForm({ id: '', name: '', branchId: branchList[0]?.id ?? '', kind: 'STORE', active: true })}><Plus className="w-4 h-4" />{t('مخزن جديد')}</Button>} />
      {q.loading && !q.raw ? <Spinner /> : q.items.length === 0 ? (
        <Empty icon={<WhIcon className="w-10 h-10" />} text={t('لسه مفيش مخازن. ضيف مخزن رئيسي ومطبخ لكل فرع — أول مخزن في الفرع بيبقى مخزن البيع.')} />
      ) : (
        <div className="space-y-5">
          {branchList.map((b: any) => (
            <div key={b.id}>
              <div className="flex items-center gap-2 mb-2"><h2 className="font-bold">{tv(b.name)}</h2>{!(byBranch.get(b.id) ?? []).some((w) => w.salesDefault && w.active) && <Pill tone="error">{t('مفيش مخزن بيع')}</Pill>}</div>
              {(byBranch.get(b.id) ?? []).length === 0 ? <div className="text-sm text-dim">{t('مفيش مخازن في الفرع ده')}</div> : (
                <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
                  {(byBranch.get(b.id) ?? []).map((w) => (
                    <Card key={w.id} className={w.active ? '' : 'opacity-60'} title={<span className="flex items-center gap-2">{w.salesDefault && <Star className="w-4 h-4 text-[var(--warning)] fill-[var(--warning)]" />}{tv(w.name)}</span>}
                      badge={<>{<Pill tone="neutral">{t(WH_KIND[w.kind] ?? w.kind)}</Pill>}{w.salesDefault && <Pill tone="primary">{t('مخزن البيع')}</Pill>}{!w.active && <Pill tone="neutral">{t('موقوف')}</Pill>}</>}
                      actions={<>
                        <Button size="sm" data-fb={`wh:view:${w.id}`} onClick={() => setView(w.id)}><Eye className="w-3.5 h-3.5" />{t('الرصيد')}</Button>
                        <Button size="sm" data-fb={`wh:edit:${w.id}`} onClick={() => setForm({ ...w })}><Pencil className="w-3.5 h-3.5" /></Button>
                      </>}>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg surface-1 p-2"><div className="text-[11px] text-dim">{t('القيمة')}</div><Money v={w.stockValue} className="text-sm" /></div>
                        <div className="rounded-lg surface-1 p-2"><div className="text-[11px] text-dim">{t('أصناف')}</div><div className="font-bold num">{w.itemCount}</div></div>
                        <div className="rounded-lg surface-1 p-2"><div className="text-[11px] text-dim">{t('قرب يخلص')}</div><div className={`font-bold num ${w.lowCount ? 'text-[var(--warning)]' : ''}`}>{w.lowCount}</div></div>
                      </div>
                      {!w.salesDefault && w.active && <Button size="sm" variant="outline" className="mt-3 w-full" data-fb={`wh:default:${w.id}`} loading={busy} onClick={() => setDefault(w)}><Star className="w-3.5 h-3.5" />{t('خليه مخزن البيع')}</Button>}
                      <Tech><div className="text-[11px] num text-dim mt-2">{w.id} · v{w.version}</div></Tech>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {form && <WarehouseForm w={form} branches={branchList} onClose={() => setForm(null)} />}
      <WarehouseView id={view} onClose={() => setView(null)} />
    </div>
  );
}

function WarehouseForm({ w, branches, onClose }: { w: any; branches: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [d, setD] = useState({ name: w.name, branchId: w.branchId, kind: w.kind, active: w.active });
  const isNew = !w.id;
  const save = async () => {
    const id = w.id || newKey('wh');
    const r = await run('Warehouse.Configure', { params: { warehouseId: id }, body: { ...d, expectedVersion: isNew ? undefined : w.version } }, { success: isNew ? t('المخزن اتضاف') : t('المخزن اتحفظ') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={isNew ? t('مخزن جديد') : t('تعديل المخزن')} badge={<StateBadge ops={['Warehouse.Configure']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="wh-form:save" loading={busy} disabled={!d.name.trim() || !d.branchId} onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
      <div className="space-y-3">
        <Field label={t('اسم المخزن')}><Input data-fb="wh-form:name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={t('مثال: مخزن الدور الأرضي')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('الفرع')}><Select data-fb="wh-form:branch" value={d.branchId} onChange={(e) => setD({ ...d, branchId: e.target.value })} options={branches.map((b: any) => ({ value: b.id, label: tv(b.name) }))} /></Field>
          <Field label={t('النوع')}><Select data-fb="wh-form:kind" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })} options={Object.entries(WH_KIND).map(([k, v]) => ({ value: k, label: t(v) }))} /></Field>
        </div>
        <Switch checked={d.active} onChange={(v) => setD({ ...d, active: v })} label={t('المخزن شغال')} />
        {!isNew && !d.active && w.active && <Banner tone="warning">{t('مينفعش توقف مخزن فيه رصيد أو مخزن البيع. حوّل الرصيد أو اعمل جرد الأول.')}</Banner>}
        {!isNew && w.history?.length > 0 && (
          <div><div className="text-xs font-bold text-soft mb-1">{t('السجل')}</div>
            <ol className="space-y-1 border-s-2 line ps-3 text-xs">{w.history.slice(0, 6).map((h: any, i: number) => <li key={i}><span className="text-dim">{dateTime(h.at)}</span> · {historyText(h.text)}</li>)}</ol>
          </div>
        )}
      </div>
    </Modal>
  );
}
const historyText = (s: string) => s.replace('created — sales warehouse of the branch (first one)', t('اتعمل — وبقى مخزن البيع (أول مخزن في الفرع)')).replace('created — sales warehouse of the branch', t('اتعمل — مخزن البيع')).replace(/^created$/, t('اتعمل')).replace('set as the sales warehouse of the branch', t('بقى مخزن البيع')).replace(/no longer the sales warehouse.*/, t('ماعدش مخزن البيع')).replace('deactivated', t('اتوقف')).replace('reactivated', t('رجع يشتغل')).replace(/^name /, t('الاسم: ')).replace('saved', t('اتحفظ'));

function WarehouseView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery<any>(id ? 'Warehouse.Get' : null, { params: { warehouseId: id } });
  const [item, setItem] = useState<string | null>(null);
  const w = q.data;
  return (
    <Modal open={!!id} onClose={onClose} xwide title={w ? `${tv(w.name)} — ${tv(w.branchName)}` : t('المخزن')} badge={<StateBadge ops={['Warehouse.Get']} />}>
      {!w ? <Spinner /> : (
        <div className="space-y-3">
          <KV rows={[[t('النوع'), t(WH_KIND[w.kind] ?? w.kind)], [t('قيمة الرصيد'), <Money v={w.stockValue} />], [t('عدد الأصناف'), w.itemCount], [t('مخزن البيع'), w.salesDefault ? t('أيوه') : t('لأ')]]} />
          <Table empty={t('المخزن فاضي')} head={[t('الصنف'), t('الرصيد'), t('الحد الأدنى'), t('الحالة'), t('القيمة')]} rows={w.balances.sort((a: any, b: any) => a.item.category.localeCompare(b.item.category)).map((b: any) => [
            <button className="font-bold hover:text-[var(--primary)]" onClick={() => setItem(b.item.id)}>{L(b.item.name)}</button>, <Qty v={b.quantity} unit={b.item.unit} />, b.level ? <span className="num text-xs">{fmtQty(b.level.min)}</span> : '—', <LevelPill state={b.levelState} />, <Money v={b.value} className="text-xs" />,
          ])} />
        </div>
      )}
      <ItemDrawer itemId={item} onClose={() => setItem(null)} />
    </Modal>
  );
}
