// Loyalty program: the earning and redeeming rule, the tiers (فضي / دهبي / بلاتيني) and the points ledger.
import React, { useState } from 'react';
import { Award, Crown, Plus, Pencil, Star, Search } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Section, StateBadge, Button, Card, Pill, Money, Modal, Field, Input, Switch, Tabs, Table, Spinner, Select } from '../../ui';
import { t, L } from '../../i18n';
import { cn, money, dateTime } from '../../lib/format';
import { PolicyCard } from './PolicyCard';
import { entryLabel } from './CustomerProfile';

export default function Loyalty() {
  const [tab, setTab] = useState<'program' | 'tiers' | 'ledger'>('program');
  return (
    <div data-screen="CR3" className="space-y-4">
      <Section title={t('برنامج الولاء')} badge={<StateBadge ops={['Loyalty.Balance', 'Loyalty.Adjust', 'Loyalty.Redeem', 'LoyaltyTier.Upsert', 'LoyaltyTier.List', 'Loyalty.Ledger']} />}
        sub={t('العميل بيكسب نقاط على كل طلب بيتقفل، ويصرفها كدفع في التحصيل. المستوى بيزوّد النقاط اللي بيكسبها.')}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ id: 'program', label: t('البرنامج') }, { id: 'tiers', label: t('المستويات') }, { id: 'ledger', label: t('سجل النقاط') }]} />} />
      {tab === 'program' && <Program />}
      {tab === 'tiers' && <Tiers />}
      {tab === 'ledger' && <Ledger />}
    </div>
  );
}

function Program() {
  const ledger = useQuery<any>('Loyalty.Ledger', { query: { limit: 1 } });
  const tt = ledger.data?.totals;
  return (
    <div className="space-y-4">
      {tt && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Tile label={t('نقاط اتكسبت')} v={String(tt.earned)} />
          <Tile label={t('نقاط اتصرفت')} v={String(tt.redeemed)} />
          <Tile label={t('رصيد العملاء دلوقتي')} v={String(tt.outstanding)} />
          <Tile label={t('قيمتها بالجنيه (التزام)')} v={money(ledger.data.liabilityEgp)} />
        </div>
      )}
      <PolicyCard policyId="LoyaltyProgramPolicy" title={t('قواعد النقاط')} explain={(v) => {
        const per = Number(v.egpPerPoint ?? 10) || 10;
        const val = Number(v.pointValue ?? 0.25);
        return <span>{t('مثال: طلب أصنافه بـ 300 ج.م = {p} نقطة (عميل فضي). عشان يصرف لازم يكون معاه {m} نقطة على الأقل = {mv}، ومينفعش النقاط تدفع أكتر من {x}% من الشيك.', { p: Math.floor(300 / per), m: v.minRedeemPoints ?? 100, mv: money(String(((v.minRedeemPoints ?? 100) * val).toFixed(2))), x: v.maxRedeemPercent ?? 50 })}</span>;
      }} />
      <Card title={t('إزاي بيشتغل')}>
        <ul className="text-sm space-y-1.5 list-disc ps-5 text-soft">
          <li>{t('النقاط بتتحسب على قيمة الأصناف بعد الخصم — من غير رسوم التوصيل والضريبة والخدمة.')}</li>
          <li>{t('الجزء اللي اتدفع بالنقاط مش بياخد نقاط.')}</li>
          <li>{t('النقاط بتتضاف لما الشيك يتقفل (اتدفع بالكامل). في الدليفري كاش: لما الطيار يسلّم الفلوس.')}</li>
          <li>{t('الصرف بيتعمل من شاشة التحصيل كوسيلة دفع "نقاط" — لازم الشيك يكون عليه العميل.')}</li>
          <li>{t('التعديل اليدوي محتاج سبب، وأكتر من 200 نقطة محتاج موافقة مدير.')}</li>
        </ul>
      </Card>
    </div>
  );
}

function Tile({ label, v }: { label: string; v: string }) {
  return <div className="glass rounded-xl px-3 py-2"><div className="text-[11px] text-dim">{label}</div><div className="text-xl font-bold num">{v}</div></div>;
}

function Tiers() {
  const { can } = useDev();
  const q = useQuery<any>('LoyaltyTier.List', { query: {} });
  const [edit, setEdit] = useState<any>(null);
  const list: any[] = q.data?.items ?? [];
  return (
    <div className="space-y-3">
      {can('loyalty:configure') && <div className="flex justify-end"><Button variant="primary" onClick={() => setEdit({})} data-fb="tier-new"><Plus className="w-4 h-4" />{t('مستوى جديد')}</Button></div>}
      {q.loading && !list.length && <Spinner />}
      <div className="grid md:grid-cols-3 gap-3">
        {list.map((x) => (
          <div key={x.id} className={cn('glass rounded-2xl p-4 border-t-4 space-y-2', !x.active && 'opacity-60')} style={{ borderTopColor: x.color }} data-fb={`tier:${x.id}`}>
            <div className="flex items-center justify-between"><span className="text-lg font-bold flex items-center gap-2" style={{ color: x.color }}><Crown className="w-5 h-5" />{L(x.name)}</span>{can('loyalty:configure') && <Button size="sm" variant="ghost" onClick={() => setEdit(x)}><Pencil className="w-3.5 h-3.5" /></Button>}</div>
            <div className="text-sm">{x.minPoints === 0 ? t('من أول طلب') : t('من {n} نقطة متجمعة', { n: x.minPoints })}</div>
            <div className="text-sm">{t('مضاعف النقاط')}: <b className="num">×{x.multiplier}</b></div>
            {L(x.perks) && <div className="text-xs text-soft">{L(x.perks)}</div>}
            <div className="text-xs text-dim">{t('{n} عميل في المستوى ده', { n: x.customers })}</div>
            {!x.active && <Pill tone="neutral">{t('موقوف')}</Pill>}
          </div>
        ))}
      </div>
      {edit && <TierDialog x={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TierDialog({ x, onClose }: { x: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [f, setF] = useState({ ar: x.name?.ar ?? '', en: x.name?.en ?? '', minPoints: String(x.minPoints ?? ''), multiplier: x.multiplier ?? '1', color: x.color ?? '#94a3b8', perksAr: x.perks?.ar ?? '', active: x.active ?? true });
  const save = async () => {
    const r = await run('LoyaltyTier.Upsert', { params: { tierId: x.id ?? 'new' }, body: { name: { ar: f.ar, en: f.en || f.ar }, minPoints: Number(f.minPoints), multiplier: f.multiplier, color: f.color, perks: { ar: f.perksAr, en: x.perks?.en ?? f.perksAr }, active: f.active, expectedVersion: x.version } }, { success: t('المستوى اتحفظ') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={x.id ? `${t('تعديل')} ${L(x.name)}` : t('مستوى جديد')} badge={<StateBadge ops={['LoyaltyTier.Upsert']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!f.ar.trim() || f.minPoints === ''} onClick={save} data-fb="tier-save">{t('حفظ')}</Button></>}>
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label={t('اسم المستوى')}><Input value={f.ar} onChange={(e) => setF({ ...f, ar: e.target.value })} /></Field>
        <Field label={t('بالإنجليزي')}><Input value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} dir="ltr" /></Field>
        <Field label={t('يبدأ من كام نقطة متجمعة')}><Input value={f.minPoints} onChange={(e) => setF({ ...f, minPoints: e.target.value.replace(/[^0-9]/g, '') })} inputMode="numeric" className="num" /></Field>
        <Field label={t('مضاعف النقاط')} hint={t('1 = عادي، 1.5 = نقاط أكتر بالنص')}><Select value={f.multiplier} onChange={(e) => setF({ ...f, multiplier: e.target.value })} options={['1', '1.1', '1.25', '1.5', '1.75', '2'].map((m) => ({ value: m, label: `×${m}` }))} /></Field>
        <Field label={t('اللون')}><Input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 p-1" /></Field>
        <Field label={t('المميزات')} className="sm:col-span-2"><Input value={f.perksAr} onChange={(e) => setF({ ...f, perksAr: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={t('المستوى شغال')} /></div>
      </div>
    </Modal>
  );
}

function Ledger() {
  const { nav } = useDev();
  const [kind, setKind] = useState('');
  const q = useQuery<any>('Loyalty.Ledger', { query: { kind: kind || undefined, limit: 300 } });
  const items: any[] = q.data?.items ?? [];
  return (
    <Card title={<span className="flex items-center gap-2"><Star className="w-4 h-4" />{t('كل حركات النقاط')}</span>} actions={<div className="w-44"><Select value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: t('كل الحركات') }, ...Object.entries(entryLabel).map(([k, v]) => ({ value: k, label: t(v.ar) }))]} /></div>}>
      {q.loading && !items.length ? <Spinner /> : (
        <Table head={[t('الوقت'), t('العميل'), t('الحركة'), t('النقاط'), t('الرصيد بعدها'), t('الطلب'), t('التفاصيل')]} empty={t('مفيش حركات')}
          rows={items.map((e) => [<span className="text-xs num">{dateTime(e.at)}</span>, <button className="text-start font-bold hover:text-[var(--primary)]" onClick={() => nav('customer', { customerId: e.customerId })}>{e.customerName}<span className="block text-[10px] text-dim num font-normal">{e.customerCode}</span></button>, <Pill tone={entryLabel[e.kind]?.tone}>{t(entryLabel[e.kind]?.ar ?? e.kind)}</Pill>, <b className={cn('num', e.points > 0 ? 'text-[var(--success)]' : 'text-[var(--error)]')}>{e.points > 0 ? '+' : ''}{e.points}</b>, <span className="num">{e.balanceAfter}</span>, e.orderNumber ? <span className="num">#{e.orderNumber}</span> : '—', <span className="text-xs">{e.reason ?? ''}{e.byName ? <span className="text-dim"> · {e.byName}</span> : ''}</span>])} />
      )}
    </Card>
  );
}
