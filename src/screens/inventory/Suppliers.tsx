// Suppliers: who we buy from, their terms and contacts, what they supply, open purchase orders, receipts and returns.
// ux-06: the supplier opens beside the list (wide) or as a full page with back (narrow) — params.open keeps it on
// refresh; adding/editing a supplier is a centered popup (Enter saves, Esc closes).
import React, { useState } from 'react';
import { Plus, Pencil, Truck, Phone, ShoppingBag, Save } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Button, Card, DetailPane, EmptyState, FILL_BODY, FILL_CARD, Field, FillPage, Input, KV, MasterDetail, Money, PageHeader, Pill, Popup, SearchInput, Spinner, StateBadge, Switch, DataTable, cols, DensityToggle, DateTime, Tabs, Textarea, Toolbar, useEnterSave } from '../../ui';
import { t, L, tv } from '../../i18n';
import { cn, dateTime } from '../../lib/format';
import { PO_STATE, StatePill, stateOf, newKey, unitLabel, useList } from './common';

const OPS = ['Supplier.Upsert', 'Supplier.List', 'Supplier.Get'];

export default function Suppliers() {
  const [text, setText] = useState('');
  const [inactive, setInactive] = useState(false);
  const q = useList<any>('Supplier.List', { text: text || undefined, active: inactive ? undefined : 'true' });
  const [form, setForm] = useState<any | null>(null);
  const { nav, params } = useDev();
  const view: string | null = params?.open ?? null;
  const setView = (id: string | null) => nav('inv-suppliers', { ...params, open: id ?? undefined });
  const newPo = (s: any) => nav('inv-po', { supplierId: s.id, create: true });
  const SC = cols<any>();
  const phoneCell = (s: any) => (s.phone ? <span className="num text-xs inline-flex items-center gap-1" dir="ltr"><Phone className="w-3 h-3" />{s.phone}</span> : <span className="text-dim">—</span>);
  const list = (compact: boolean) => (
    <FillPage>
      <PageHeader className="!mb-0" icon={<Truck />} title={t('الموردين')} badge={<StateBadge ops={OPS} />}
        actions={<Button data-fb="suppliers:new" variant="primary" onClick={() => setForm({ active: true })}><Plus className="w-4 h-4" />{t('مورد جديد')}</Button>} />
      <Card padding="sm" className={FILL_CARD} bodyClassName={FILL_BODY}>
        <Toolbar>
          <SearchInput data-fb="suppliers:search" value={text} onChange={setText} placeholder={t('دوّر بالاسم أو التليفون')} />
          <Switch checked={inactive} onChange={setInactive} label={t('اعرض الموقوفين')} />
          <Toolbar.Spacer />
          <span className="text-xs text-dim">{t('{n} مورد', { n: q.items.length })}</span>
          {!compact && <DensityToggle dense />}
        </Toolbar>
        {q.loading && !q.raw ? <Spinner /> : q.items.length === 0 ? (
          <EmptyState compact icon={<Truck />} title={text || inactive ? t('لا يوجد موردون بهذا البحث.') : t('لا يوجد موردون.')} action={!text && !inactive ? <Button variant="primary" onClick={() => setForm({ active: true })}><Plus className="w-4 h-4" />{t('مورد جديد')}</Button> : undefined} />
        ) : (
          <DataTable fill dense={compact} rows={q.items} rowKey={(s: any) => s.id} selectedKey={view} onRowOpen={(s) => setView(s.id)} label={t('الموردين')} rowClassName={(s) => (!s.active ? 'opacity-60' : undefined)}
            columns={compact ? [
              SC.text('name', t('المورد'), (s) => tv(s.name), { cell: (s) => <div data-fb={`suppliers:view:${s.id}`} className="min-w-[140px]"><div className="font-bold">{tv(s.name)}</div><div className="text-[11px] text-dim">{s.contactName ?? '—'}</div></div> }),
              SC.custom('phone', t('التليفون'), phoneCell),
              SC.number('open', t('أوامر مفتوحة'), (s) => s.openPurchaseOrders || null, { cell: (s) => s.openPurchaseOrders ? <Pill tone="info">{s.openPurchaseOrders}</Pill> : <span className="text-dim">—</span> }),
            ] : [
              SC.text('name', t('المورد'), (s) => tv(s.name), { cell: (s) => <div data-fb={`suppliers:view:${s.id}`} className="min-w-[160px]"><div className="font-bold flex items-center gap-1.5">{tv(s.name)}{!s.active && <Pill tone="neutral">{t('موقوف')}</Pill>}</div><div className="text-[11px] text-dim">{s.contactName ?? '—'}</div><Tech><div className="text-[10px] num text-dim">{s.id} · v{s.version}{s.taxId ? ` · ${s.taxId}` : ''}</div></Tech></div> }),
              SC.custom('phone', t('التليفون'), phoneCell),
              SC.text('terms', t('الدفع'), (s) => tv(s.paymentTerms), { maxChars: 18 }),
              SC.money('purchased', t('اشترينا (30 يوم)'), (s) => s.purchased30),
              SC.date('last', t('آخر استلام'), (s) => s.lastReceiptAt),
              SC.number('items', t('أصناف بيوردها'), (s) => s.itemCount),
              SC.number('open', t('أوامر مفتوحة'), (s) => s.openPurchaseOrders || null, { cell: (s) => s.openPurchaseOrders ? <Pill tone="info">{t('{n} أمر مفتوح', { n: s.openPurchaseOrders })}</Pill> : <span className="text-dim">—</span> }),
              SC.actions('act', (s) => <>
                {s.active && <Button size="sm" variant="outline" data-fb={`suppliers:po:${s.id}`} onClick={() => newPo(s)}><ShoppingBag className="w-3.5 h-3.5" />{t('أمر شراء جديد')}</Button>}
                <Button size="sm" variant="ghost" title={t('تعديل')} aria-label={t('تعديل')} data-fb={`suppliers:edit:${s.id}`} onClick={() => setForm(s)}><Pencil className="w-3.5 h-3.5" /></Button>
              </>),
            ]} />
        )}
      </Card>
    </FillPage>
  );
  return (
    <>
      <MasterDetail fb="suppliers" open={!!view} list={list} detail={view && <SupplierDetail id={view} onClose={() => setView(null)} onEdit={setForm} onNewPo={newPo} />} />
      {form && <SupplierForm s={form} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); if (!form.id) setView(id); }} />}
    </>
  );
}

function SupplierForm({ s, onClose, onSaved }: { s: any; onClose: () => void; onSaved: (id: string) => void }) {
  const { run, busy } = useCommand();
  const [d, setD] = useState({ name: s.name ?? '', contactName: s.contactName ?? '', phone: s.phone ?? '', paymentTerms: s.paymentTerms ?? '', taxId: s.taxId ?? '', address: s.address ?? '', notes: s.notes ?? '', active: s.active ?? true });
  const valid = !!d.name.trim();
  const save = async () => {
    if (!valid || busy) return;
    const id = s.id ?? newKey('sup');
    const r = await run<any>('Supplier.Upsert', { params: { supplierId: id }, body: { ...d, expectedVersion: s.id ? s.version : undefined } }, { success: s.id ? t('بيانات المورد اتحفظت') : t('المورد اتضاف') });
    if (r) onSaved(r.id ?? id);
  };
  const onKey = useEnterSave(save, valid && !busy);
  return (
    <Popup open onClose={onClose} size="lg" fb="supplier-form" title={<span className="flex items-center gap-2">{s.id ? t('تعديل مورد') : t('مورد جديد')}<StateBadge ops={['Supplier.Upsert']} /></span>}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="supplier-form:save" loading={busy} disabled={!valid} onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" onKeyDown={onKey}>
        <Field label={t('اسم المورد')} required><Input data-fb="supplier-form:name" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} data-autofocus /></Field>
        <Field label={t('المسؤول')}><Input data-fb="supplier-form:contact" value={d.contactName} onChange={(e) => setD({ ...d, contactName: e.target.value })} /></Field>
        <Field label={t('التليفون')}><Input data-fb="supplier-form:phone" dir="ltr" inputMode="tel" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
        <Field label={t('شروط الدفع')}><Input data-fb="supplier-form:terms" value={d.paymentTerms} onChange={(e) => setD({ ...d, paymentTerms: e.target.value })} placeholder={t('كاش / آجل 15 يوم')} /></Field>
        <Field label={t('رقم التسجيل الضريبي')}><Input dir="ltr" value={d.taxId} onChange={(e) => setD({ ...d, taxId: e.target.value })} /></Field>
        <Field label={t('العنوان')}><Input value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} /></Field>
        <Field label={t('ملاحظات')} className="sm:col-span-2"><Textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></Field>
        <Switch checked={d.active} onChange={(v) => setD({ ...d, active: v })} label={t('المورد شغال')} />
      </div>
    </Popup>
  );
}

function SupplierDetail({ id, onClose, onEdit, onNewPo }: { id: string; onClose: () => void; onEdit: (s: any) => void; onNewPo: (s: any) => void }) {
  const q = useQuery<any>('Supplier.Get', { params: { supplierId: id } });
  const [tab, setTab] = useState<'po' | 'gr' | 'ret' | 'items'>('po');
  const s = q.data?.id === id ? q.data : null;
  const DC = cols<any>();
  return (
    <DetailPane fb="supplier-detail" onClose={onClose} backLabel={t('الموردين')} icon={<Truck />}
      title={s ? tv(s.name) : t('مورد')}
      badge={<>{s && !s.active && <Pill tone="neutral">{t('موقوف')}</Pill>}<StateBadge ops={['Supplier.Get']} /></>}
      actions={s && <>
        <Button size="sm" data-fb="supplier-detail:edit" onClick={() => onEdit(s)}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>
        {s.active && <Button size="sm" variant="primary" data-fb="supplier-detail:po" onClick={() => onNewPo(s)}><ShoppingBag className="w-3.5 h-3.5" />{t('أمر شراء جديد')}</Button>}
      </>}>
      {!s ? <Spinner /> : (
        <div className="space-y-4">
          <div className="rounded-xl surface-1 border line p-3">
            <KV rows={[
              [t('المسؤول'), s.contactName ?? '—'],
              [t('التليفون'), s.phone ? <span className="num" dir="ltr">{s.phone}</span> : '—'],
              [t('الدفع'), tv(s.paymentTerms) ?? '—'],
              [t('العنوان'), tv(s.address) || '—'],
              [t('اشترينا (30 يوم)'), <Money v={s.purchased30} />],
              [t('آخر استلام'), s.lastReceiptAt ? dateTime(s.lastReceiptAt) : '—'],
            ]} />
            {tv(s.notes) && <div className="text-xs text-dim mt-2">{tv(s.notes)}</div>}
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'po', label: t('أوامر الشراء ({n})', { n: s.purchaseOrders.length }), fb: 'supplier-tab:po' }, { id: 'gr', label: t('الاستلامات ({n})', { n: s.receipts.length }), fb: 'supplier-tab:gr' }, { id: 'ret', label: t('المرتجعات ({n})', { n: s.returns.length }), fb: 'supplier-tab:ret' }, { id: 'items', label: t('الأصناف ({n})', { n: s.items.length }), fb: 'supplier-tab:items' }]} />
          {tab === 'po' && <DataTable dense rows={s.purchaseOrders} rowKey={(p: any) => p.id ?? p.number} empty={t('مفيش أوامر شراء')} columns={[
            DC.text('number', t('الرقم'), (p) => p.number, { cell: (p) => <span className="num font-bold">{p.number}</span> }),
            DC.status('state', t('الحالة'), (p) => stateOf(PO_STATE, p.state)),
            DC.money('total', t('القيمة'), (p) => p.total),
            DC.date('at', t('اتعمل'), (p) => p.createdAt),
          ]} />}
          {tab === 'gr' && <DataTable dense rows={s.receipts} rowKey={(r: any) => r.id ?? r.number} empty={t('مفيش استلامات')} columns={[
            DC.text('number', t('الرقم'), (r) => r.number, { cell: (r) => <span className="num font-bold">{r.number}{r.state === 'REVERSED' && <Pill tone="error" className="ms-1">{t('اتلغى')}</Pill>}</span> }),
            DC.text('po', t('أمر الشراء'), (r) => r.purchaseOrderNumber ?? t('من غير أمر'), { cell: (r) => <span className="num text-xs">{r.purchaseOrderNumber ?? t('من غير أمر')}</span> }),
            DC.text('invoice', t('فاتورة المورد'), (r) => r.supplierInvoiceNo, { cell: (r) => <span className="num text-xs">{r.supplierInvoiceNo ?? '—'}</span> }),
            DC.money('total', t('القيمة'), (r) => r.total),
            DC.date('at', t('إمتى'), (r) => r.at),
          ]} />}
          {tab === 'ret' && <DataTable dense rows={s.returns} rowKey={(r: any) => r.id ?? r.number} empty={t('مفيش مرتجعات')} columns={[
            DC.text('number', t('الرقم'), (r) => r.number, { cell: (r) => <span className="num font-bold">{r.number}</span> }),
            DC.text('reason', t('السبب'), (r) => tv(r.reason), { maxChars: 28 }),
            DC.money('total', t('القيمة'), (r) => r.total),
            DC.date('at', t('إمتى'), (r) => r.at),
          ]} />}
          {tab === 'items' && <DataTable dense rows={s.items} rowKey={(i: any) => i.id} empty={t('مفيش أصناف مربوطة بالمورد ده')} columns={[
            DC.text('name', t('الصنف'), (i) => L(i.name), { maxChars: 28 }),
            DC.text('pack', t('عبوة الشراء'), (i) => (i.packs?.length ? L((i.packs.find((p: any) => p.id === i.purchasePackId) ?? i.packs[0]).name) : unitLabel(i.unit)), { maxChars: 20 }),
            DC.money('avg', t('متوسط التكلفة'), (i) => i.avgCost),
          ]} />}
          <Tech><div className="text-[11px] num text-dim">{s.id} · v{s.version}{s.taxId ? ` · ${s.taxId}` : ''}</div></Tech>
        </div>
      )}
    </DetailPane>
  );
}
