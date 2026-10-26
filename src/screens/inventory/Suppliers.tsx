// Suppliers: who we buy from, their terms and contacts, what they supply, open purchase orders, receipts and returns.
import React, { useState } from 'react';
import { Plus, Pencil, Truck, Phone, ShoppingBag, Save, Eye } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Button, Card, Empty, Field, Input, KV, Modal, Drawer, Money, Pill, Section, Spinner, StateBadge, Switch, Table, Tabs, Textarea, EmptyState } from '../../ui';
import { t, L } from '../../i18n';
import { dateTime } from '../../lib/format';
import { PO_STATE, StatePill, newKey, unitLabel, useList, Inp } from './common';

const OPS = ['Supplier.Upsert', 'Supplier.List', 'Supplier.Get'];

export default function Suppliers() {
  const [text, setText] = useState('');
  const [inactive, setInactive] = useState(false);
  const q = useList<any>('Supplier.List', { text: text || undefined, active: inactive ? undefined : 'true' });
  const [form, setForm] = useState<any | null>(null);
  const [view, setView] = useState<string | null>(null);
  const { nav } = useDev();
  return (
    <div>
      <Section title={t('الموردين')} badge={<StateBadge ops={OPS} />} sub={t('بيانات كل مورد وشروط الدفع، والأصناف اللي بيوردها، وأوامر الشراء والاستلامات.')}
        actions={<Button data-fb="suppliers:new" variant="primary" onClick={() => setForm({ active: true })}><Plus className="w-4 h-4" />{t('مورد جديد')}</Button>} />
      <div className="flex gap-2 items-center mb-3"><Inp className="w-64" data-fb="suppliers:search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('دوّر بالاسم أو التليفون')} /><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />{t('اعرض الموقوفين')}</label></div>
      {q.loading && !q.raw ? <Spinner /> : q.items.length === 0 ? <Empty icon={<Truck className="w-10 h-10" />} text={t('مفيش موردين')} /> : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
          {q.items.map((s) => (
            <Card key={s.id} className={s.active ? '' : 'opacity-60'} title={s.name} badge={!s.active ? <Pill tone="neutral">{t('موقوف')}</Pill> : s.openPurchaseOrders ? <Pill tone="info">{t('{n} أمر مفتوح', { n: s.openPurchaseOrders })}</Pill> : undefined}
              actions={<><Button size="sm" data-fb={`suppliers:view:${s.id}`} onClick={() => setView(s.id)}><Eye className="w-3.5 h-3.5" /></Button><Button size="sm" data-fb={`suppliers:edit:${s.id}`} onClick={() => setForm(s)}><Pencil className="w-3.5 h-3.5" /></Button></>}>
              <KV rows={[
                [t('المسؤول'), s.contactName ?? '—'],
                [t('التليفون'), s.phone ? <span className="num inline-flex items-center gap-1"><Phone className="w-3 h-3" />{s.phone}</span> : '—'],
                [t('الدفع'), s.paymentTerms ?? '—'],
                [t('اشترينا (30 يوم)'), <Money v={s.purchased30} />],
                [t('آخر استلام'), s.lastReceiptAt ? dateTime(s.lastReceiptAt) : '—'],
                [t('أصناف بيوردها'), s.itemCount],
              ]} />
              {s.notes && <div className="text-xs text-dim mt-2">{s.notes}</div>}
              {s.active && <Button size="sm" variant="outline" className="mt-3 w-full" data-fb={`suppliers:po:${s.id}`} onClick={() => nav('inv-po', { supplierId: s.id, create: true })}><ShoppingBag className="w-3.5 h-3.5" />{t('أمر شراء جديد')}</Button>}
              <Tech><div className="text-[11px] num text-dim mt-1">{s.id} · v{s.version}{s.taxId ? ` · ${s.taxId}` : ''}</div></Tech>
            </Card>
          ))}
        </div>
      )}
      {form && <SupplierForm s={form} onClose={() => setForm(null)} />}
      <SupplierView id={view} onClose={() => setView(null)} />
    </div>
  );
}

function SupplierForm({ s, onClose }: { s: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [d, setD] = useState({ name: s.name ?? '', contactName: s.contactName ?? '', phone: s.phone ?? '', paymentTerms: s.paymentTerms ?? '', taxId: s.taxId ?? '', address: s.address ?? '', notes: s.notes ?? '', active: s.active ?? true });
  const save = async () => {
    const r = await run('Supplier.Upsert', { params: { supplierId: s.id ?? newKey('sup') }, body: { ...d, expectedVersion: s.id ? s.version : undefined } }, { success: s.id ? t('بيانات المورد اتحفظت') : t('المورد اتضاف') });
    if (r) onClose();
  };
  return (
    <Drawer width="lg" open onClose={onClose} title={s.id ? t('تعديل مورد') : t('مورد جديد')} badge={<StateBadge ops={['Supplier.Upsert']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="supplier-form:save" loading={busy} disabled={!d.name.trim()} onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('اسم المورد')}><Input data-fb="supplier-form:name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label={t('المسؤول')}><Input value={d.contactName} onChange={(e) => setD({ ...d, contactName: e.target.value })} /></Field>
        <Field label={t('التليفون')}><Input dir="ltr" inputMode="tel" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
        <Field label={t('شروط الدفع')}><Input value={d.paymentTerms} onChange={(e) => setD({ ...d, paymentTerms: e.target.value })} placeholder={t('كاش / آجل 15 يوم')} /></Field>
        <Field label={t('رقم التسجيل الضريبي')}><Input dir="ltr" value={d.taxId} onChange={(e) => setD({ ...d, taxId: e.target.value })} /></Field>
        <Field label={t('العنوان')}><Input value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} /></Field>
        <Field label={t('ملاحظات')} className="sm:col-span-2"><Textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></Field>
        <Switch checked={d.active} onChange={(v) => setD({ ...d, active: v })} label={t('المورد شغال')} />
      </div>
    </Drawer>
  );
}

function SupplierView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery<any>(id ? 'Supplier.Get' : null, { params: { supplierId: id } });
  const [tab, setTab] = useState<'po' | 'gr' | 'ret' | 'items'>('po');
  const s = q.data;
  return (
    <Drawer width="xl" open={!!id} onClose={onClose} title={s?.name ?? t('مورد')} badge={<StateBadge ops={['Supplier.Get']} />}>
      {!s ? <Spinner /> : (
        <div className="space-y-3">
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'po', label: t('أوامر الشراء ({n})', { n: s.purchaseOrders.length }) }, { id: 'gr', label: t('الاستلامات ({n})', { n: s.receipts.length }) }, { id: 'ret', label: t('المرتجعات ({n})', { n: s.returns.length }) }, { id: 'items', label: t('الأصناف ({n})', { n: s.items.length }) }]} />
          {tab === 'po' && <Table empty={t('مفيش أوامر شراء')} head={[t('الرقم'), t('الحالة'), t('القيمة'), t('اتعمل')]} rows={s.purchaseOrders.map((p: any) => [<span className="num font-bold">{p.number}</span>, <StatePill map={PO_STATE} state={p.state} />, <Money v={p.total} className="text-xs" />, <span className="text-xs">{dateTime(p.createdAt)}</span>])} />}
          {tab === 'gr' && <Table empty={t('مفيش استلامات')} head={[t('الرقم'), t('أمر الشراء'), t('فاتورة المورد'), t('القيمة'), t('إمتى')]} rows={s.receipts.map((r: any) => [<span className="num font-bold">{r.number}{r.state === 'REVERSED' && <Pill tone="error" className="ms-1">{t('اتلغى')}</Pill>}</span>, <span className="num text-xs">{r.purchaseOrderNumber ?? t('من غير أمر')}</span>, <span className="num text-xs">{r.supplierInvoiceNo ?? '—'}</span>, <Money v={r.total} className="text-xs" />, <span className="text-xs">{dateTime(r.at)}</span>])} />}
          {tab === 'ret' && <Table empty={t('مفيش مرتجعات')} head={[t('الرقم'), t('السبب'), t('القيمة'), t('إمتى')]} rows={s.returns.map((r: any) => [<span className="num font-bold">{r.number}</span>, r.reason, <Money v={r.total} className="text-xs" />, <span className="text-xs">{dateTime(r.at)}</span>])} />}
          {tab === 'items' && <Table empty={t('مفيش أصناف مربوطة بالمورد ده')} head={[t('الصنف'), t('عبوة الشراء'), t('متوسط التكلفة')]} rows={s.items.map((i: any) => [<span className="font-bold">{L(i.name)}</span>, i.packs?.length ? L((i.packs.find((p: any) => p.id === i.purchasePackId) ?? i.packs[0]).name) : unitLabel(i.unit), <Money v={i.avgCost} className="text-xs" />])} />}
        </div>
      )}
    </Drawer>
  );
}
