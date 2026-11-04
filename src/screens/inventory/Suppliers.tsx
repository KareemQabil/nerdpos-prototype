// Suppliers: who we buy from, their terms and contacts, what they supply, open purchase orders, receipts and returns.
// ux-06: the supplier opens beside the list (wide) or as a full page with back (narrow) — params.open keeps it on
// refresh; adding/editing a supplier is a centered popup (Enter saves, Esc closes).
import React, { useState } from 'react';
import { Plus, Pencil, Truck, Phone, ShoppingBag, Save } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Button, Card, DetailPane, EmptyState, FILL_BODY, FILL_CARD, Field, FillPage, Input, KV, MasterDetail, Money, PageHeader, Pill, Popup, SearchInput, Spinner, StateBadge, Switch, Table, Tabs, Textarea, Toolbar, useEnterSave } from '../../ui';
import { t, L, tv } from '../../i18n';
import { cn, dateTime } from '../../lib/format';
import { PO_STATE, StatePill, newKey, unitLabel, useList } from './common';

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
        </Toolbar>
        {q.loading && !q.raw ? <Spinner /> : q.items.length === 0 ? (
          <EmptyState compact icon={<Truck />} title={text || inactive ? t('لا يوجد موردون بهذا البحث.') : t('لا يوجد موردون.')} action={!text && !inactive ? <Button variant="primary" onClick={() => setForm({ active: true })}><Plus className="w-4 h-4" />{t('مورد جديد')}</Button> : undefined} />
        ) : compact ? (
          <Table fill dense onRowClick={(i) => setView(q.items[i].id)} rowClassName={(i) => (q.items[i].id === view ? 'row-selected' : undefined)} align={['start', 'start', 'end']}
            head={[t('المورد'), t('التليفون'), t('أوامر مفتوحة')]} rows={q.items.map((s) => [
              <div data-fb={`suppliers:view:${s.id}`} className={cn('min-w-[140px]', !s.active && 'opacity-60')}><div className="font-bold">{tv(s.name)}</div><div className="text-[11px] text-dim">{s.contactName ?? '—'}</div></div>,
              s.phone ? <span className="num text-xs" dir="ltr">{s.phone}</span> : <span className="text-dim">—</span>,
              s.openPurchaseOrders ? <Pill tone="info">{s.openPurchaseOrders}</Pill> : <span className="text-dim">—</span>,
            ])} />
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 pb-1" data-scroll-region>
            <div className="grid grid-cols-1 @2xl/list:grid-cols-2 @6xl/list:grid-cols-3 gap-3">
              {q.items.map((s) => (
                <Card key={s.id} interactive onClick={() => setView(s.id)} data-selected={s.id === view} className={cn(!s.active && 'opacity-60', s.id === view && 'ring-2 ring-[var(--primary)]')} title={tv(s.name)} badge={!s.active ? <Pill tone="neutral">{t('موقوف')}</Pill> : s.openPurchaseOrders ? <Pill tone="info">{t('{n} أمر مفتوح', { n: s.openPurchaseOrders })}</Pill> : undefined}
                  actions={<><Button size="sm" variant="ghost" data-fb={`suppliers:view:${s.id}`} onClick={(e) => { e.stopPropagation(); setView(s.id); }}>{t('عرض')}</Button><Button size="sm" variant="ghost" title={t('تعديل')} data-fb={`suppliers:edit:${s.id}`} onClick={(e) => { e.stopPropagation(); setForm(s); }}><Pencil className="w-3.5 h-3.5" /></Button></>}>
                  <KV rows={[
                    [t('المسؤول'), s.contactName ?? '—'],
                    [t('التليفون'), s.phone ? <span className="num inline-flex items-center gap-1" dir="ltr"><Phone className="w-3 h-3" />{s.phone}</span> : '—'],
                    [t('الدفع'), tv(s.paymentTerms) ?? '—'],
                    [t('اشترينا (30 يوم)'), <Money v={s.purchased30} />],
                    [t('آخر استلام'), s.lastReceiptAt ? dateTime(s.lastReceiptAt) : '—'],
                    [t('أصناف بيوردها'), s.itemCount],
                  ]} />
                  {s.active && <Button size="sm" variant="outline" className="mt-3 w-full" data-fb={`suppliers:po:${s.id}`} onClick={(e) => { e.stopPropagation(); newPo(s); }}><ShoppingBag className="w-3.5 h-3.5" />{t('أمر شراء جديد')}</Button>}
                  <Tech><div className="text-[11px] num text-dim mt-1">{s.id} · v{s.version}{s.taxId ? ` · ${s.taxId}` : ''}</div></Tech>
                </Card>
              ))}
            </div>
          </div>
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
          {tab === 'po' && <Table empty={t('مفيش أوامر شراء')} head={[t('الرقم'), t('الحالة'), t('القيمة'), t('اتعمل')]} align={['start', 'start', 'end', 'start']} rows={s.purchaseOrders.map((p: any) => [<span className="num font-bold">{p.number}</span>, <StatePill map={PO_STATE} state={p.state} />, <Money v={p.total} className="text-xs" />, <span className="text-xs">{dateTime(p.createdAt)}</span>])} />}
          {tab === 'gr' && <Table empty={t('مفيش استلامات')} head={[t('الرقم'), t('أمر الشراء'), t('فاتورة المورد'), t('القيمة'), t('إمتى')]} align={['start', 'start', 'start', 'end', 'start']} rows={s.receipts.map((r: any) => [<span className="num font-bold">{r.number}{r.state === 'REVERSED' && <Pill tone="error" className="ms-1">{t('اتلغى')}</Pill>}</span>, <span className="num text-xs">{r.purchaseOrderNumber ?? t('من غير أمر')}</span>, <span className="num text-xs">{r.supplierInvoiceNo ?? '—'}</span>, <Money v={r.total} className="text-xs" />, <span className="text-xs">{dateTime(r.at)}</span>])} />}
          {tab === 'ret' && <Table empty={t('مفيش مرتجعات')} head={[t('الرقم'), t('السبب'), t('القيمة'), t('إمتى')]} align={['start', 'start', 'end', 'start']} rows={s.returns.map((r: any) => [<span className="num font-bold">{r.number}</span>, tv(r.reason), <Money v={r.total} className="text-xs" />, <span className="text-xs">{dateTime(r.at)}</span>])} />}
          {tab === 'items' && <Table empty={t('مفيش أصناف مربوطة بالمورد ده')} head={[t('الصنف'), t('عبوة الشراء'), t('متوسط التكلفة')]} align={['start', 'start', 'end']} rows={s.items.map((i: any) => [<span className="font-bold">{L(i.name)}</span>, i.packs?.length ? L((i.packs.find((p: any) => p.id === i.purchasePackId) ?? i.packs[0]).name) : unitLabel(i.unit), <Money v={i.avgCost} className="text-xs" />])} />}
          <Tech><div className="text-[11px] num text-dim">{s.id} · v{s.version}{s.taxId ? ` · ${s.taxId}` : ''}</div></Tech>
        </div>
      )}
    </DetailPane>
  );
}
