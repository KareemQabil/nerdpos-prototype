// B8 Sales channels (E13): صالة، تيك أواي، دليفري، طلبات… as records. The order type decides how the order runs
// (kitchen, service, delivery); the channel decides the price (own prices, or follow another channel ± %).
// Managers and the owner create channels themselves — no code change, no vendor.
// ux-06: add/edit a channel in a centered popup (Enter saves, Esc closes) instead of a side sheet.
import React, { useMemo, useState } from 'react';
import { Store, Plus, Pencil, Tags, History, ArrowLeftRight } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Button, Card, EmptyState, Field, Input, PageHeader, Pill, Popup, SegmentedControl, Select, StateBadge, Switch, Table, Timeline, Money, useEnterSave } from '../../ui';
import { t, L } from '../../i18n';
import { Tech } from '../../app/tech';
import { dateTime } from '../../lib/format';
import { personText } from '../../demo/people';
import { ChannelDot, orderTypeLabel, priceModeText, useSalesChannels, type SalesChannelView } from './common';

const COLORS = ['#ff5a00', '#e11d48', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#64748b', '#22c55e'];
const STEPS = [{ value: '0', label: t('بالقرش') }, { value: '0.25', label: '0.25' }, { value: '0.50', label: '0.50' }, { value: '1', label: '1.00' }, { value: '5', label: '5.00' }];

export default function SalesChannels() {
  const { can } = useDev();
  const list = useSalesChannels(undefined, true);
  const [edit, setEdit] = useState<SalesChannelView | 'new' | null>(null);
  const canManage = can('saleschannel:manage');
  const byType = useMemo(() => (['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const).map((ot) => ({ ot, items: list.items.filter((c) => c.orderType === ot) })), [list.items]);
  return (
    <div className="space-y-4" data-fb="screen:B8">
      <PageHeader icon={<Store />} title={t('قنوات البيع')} ops={['SalesChannel.List', 'SalesChannel.Upsert']}
        actions={<Button variant="primary" data-fb="channels:new" disabled={!canManage} title={canManage ? undefined : t('الحساب ده مش مسموح له يعمل الحركة دي')} onClick={() => setEdit('new')}><Plus className="w-4 h-4" />{t('قناة جديدة')}</Button>} />
      <div className="grid grid-cols-1 @4xl/main:grid-cols-3 gap-3">
        {byType.map(({ ot, items }) => (
          <Card key={ot} title={<span className="inline-flex items-center gap-2">{orderTypeLabel(ot)} <Pill size="sm">{t('{n} قناة', { n: String(items.length) })}</Pill></span>} padding="sm">
            <div className="space-y-2">
              {items.map((c) => (
                <div key={c.id} className="rounded-xl border line surface-1 px-3 py-2.5 flex items-start gap-3" data-fb={`channels:row:${c.id}`}>
                  <ChannelDot color={c.color} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold flex items-center gap-1.5 flex-wrap">{L(c.name)}
                      {c.isDefault && <Pill size="sm" tone="primary">{t('الأساسية')}</Pill>}
                      {!c.active && <Pill size="sm">{t('متقفلة')}</Pill>}
                    </div>
                    <div className="text-xs text-dim mt-0.5">{priceModeText(c)}</div>
                    <div className="text-[11px] text-dim mt-1">{t('{n} طلب اتباع عليها', { n: String(c.orders) })}{c.followers.length ? ` · ${t('ماشي وراها')}: ${c.followers.map((f) => L(f.name)).join('، ')}` : ''}</div>
                    <Tech><div className="num text-[10px] text-dim" dir="ltr">{c.id} · v{c.version}</div></Tech>
                  </div>
                  <Button size="sm" variant="ghost" data-fb={`channels:edit:${c.id}`} disabled={!canManage} onClick={() => setEdit(c)}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <PriceCompare channels={list.items.filter((c) => c.active)} />
      {edit && <ChannelPopup channel={edit === 'new' ? null : edit} all={list.items} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** Side by side: what a few items sell at in every channel (server prices, read only). */
function PriceCompare({ channels }: { channels: SalesChannelView[] }) {
  const { me, auth, can } = useDev();
  const branchId = me?.branchId ?? auth.branchId;
  const q = useQuery<any>(can('product:read') ? 'Catalog.PriceList' : null, { query: { branchId } });
  const items: any[] = (q.data?.items ?? []).filter((p: any) => channels.some((c) => p.prices[`${c.id}:BASE`]?.current)).slice(0, 14);
  if (!can('product:read')) return null;
  const cell = (p: any, c: SalesChannelView) => {
    const e = p.prices[`${c.id}:BASE`]?.current;
    if (!e) return <span className="text-dim">—</span>;
    const tone = e.source === 'OWN' && !c.isDefault ? 'font-bold text-[var(--primary)]' : e.source === 'FOLLOW' ? 'text-[var(--info)]' : !c.isDefault ? 'text-dim' : '';
    return <span className={tone} title={e.source === 'ORDER_TYPE' ? t('مفيش سعر خاص — بسعر {x}', { x: orderTypeLabel(c.orderType) }) : undefined}><Money v={e.amount} /></span>;
  };
  return (
    <Card title={<span className="inline-flex items-center gap-2"><ArrowLeftRight className="w-4 h-4" />{t('مقارنة الأسعار بين القنوات')}</span>} badge={<StateBadge ops={['Catalog.PriceList']} />}
      description={<span className="flex flex-wrap gap-3"><span className="font-bold text-[var(--primary)]">{t('سعر خاص')}</span><span className="text-[var(--info)]">{t('نسبة من قناة أخرى')}</span><span className="text-dim">{t('سعر نوع الطلب')}</span></span>}>
      <Table dense loading={q.loading && !q.data} head={[t('الصنف'), ...channels.map((c) => <span className="inline-flex items-center gap-1"><ChannelDot color={c.color} />{L(c.name)}</span>)]}
        align={['start', ...channels.map(() => 'end' as const)]}
        rows={items.map((p) => [<span>{L(p.name)}</span>, ...channels.map((c) => cell(p, c))])}
        empty={<EmptyState compact icon={<Tags />} title={t('مفيش أسعار')} />} />
    </Card>
  );
}

function ChannelPopup({ channel, all, onClose }: { channel: SalesChannelView | null; all: SalesChannelView[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [nameAr, setNameAr] = useState(channel?.name.ar ?? '');
  const [nameEn, setNameEn] = useState(channel?.name.en ?? '');
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>(channel?.orderType ?? 'DELIVERY');
  const [mode, setMode] = useState<'OWN' | 'FOLLOW'>(channel?.priceMode ?? 'FOLLOW');
  const others = all.filter((c) => c.id !== channel?.id && c.active);
  const [followId, setFollowId] = useState(channel?.follow?.channelId ?? (others.find((c) => c.isDefault && c.orderType === (channel?.orderType ?? 'DELIVERY'))?.id ?? others[0]?.id ?? ''));
  const [percent, setPercent] = useState(channel?.follow?.percent ?? '20');
  const [step, setStep] = useState(channel?.follow?.roundingStep ?? '1');
  const [color, setColor] = useState(channel?.color ?? COLORS[0]);
  const [active, setActive] = useState(channel?.active ?? true);
  const [note, setNote] = useState(channel?.note ?? '');
  const isDefault = !!channel?.isDefault;
  const typeLocked = isDefault || (channel?.orders ?? 0) > 0;
  const pctOk = /^-?\d{1,3}(\.\d{1,2})?$/.test(percent.trim()) && Number(percent) >= -50 && Number(percent) <= 200;
  const valid = nameAr.trim().length >= 2 && (mode === 'OWN' || (followId && pctOk));
  const save = async () => {
    if (!valid || busy) return;
    const body: any = { name: { ar: nameAr.trim(), en: nameEn.trim() || nameAr.trim() }, orderType, priceMode: mode, color, active, note: note.trim() || null };
    if (mode === 'FOLLOW') body.follow = { channelId: followId, percent: percent.trim(), roundingStep: step };
    if (channel) body.expectedVersion = channel.version;
    const r = await run('SalesChannel.Upsert', { params: { salesChannelId: channel?.id ?? 'new' }, body }, { success: channel ? t('القناة اتحدثت') : t('قناة {n} اتعملت — تقدر تبيع عليها دلوقتي', { n: nameAr.trim() }) });
    if (r) onClose();
  };
  const follow = all.find((c) => c.id === followId);
  const onKey = useEnterSave(save, !!valid && !busy);
  return (
    <Popup open onClose={onClose} size="lg" fb="channel-popup" title={<span className="flex items-center gap-2"><Store className="w-5 h-5 text-[var(--primary)]" />{channel ? t('تعديل قناة {n}', { n: L(channel.name) }) : t('قناة بيع جديدة')}<StateBadge ops={['SalesChannel.Upsert']} /></span>}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="channels:save" loading={busy} disabled={!valid} onClick={save}>{t('حفظ')}</Button></>}>
      <div className="space-y-5" onKeyDown={onKey}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('اسم القناة')} required><Input data-fb="channels:name-ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} autoFocus={!channel} /></Field>
          <Field label={t('الاسم بالإنجليزي')}><Input data-fb="channels:name-en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" /></Field>
        </div>
        <Field label={t('نوع الطلب')} hint={typeLocked ? (isDefault ? t('القناة الأساسية نوعها ثابت') : t('اتباع عليها قبل كده — النوع ثابت')) : t('بيحدد المطبخ والخدمة والتوصيل')}>
          <SegmentedControl<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'> value={orderType} onChange={(v) => !typeLocked && setOrderType(v)} options={(['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const).map((x) => ({ id: x, label: orderTypeLabel(x), fb: `channels:type:${x}`, disabled: typeLocked && x !== orderType }))} />
        </Field>
        <Field label={t('الأسعار')}>
          {isDefault ? <div className="text-sm rounded-xl surface-1 border line p-3">{t('دي القناة الأساسية لـ{x}: هي اللي ماسكة أسعار النوع ده، والقنوات التانية بترجع لها لما ما يبقاش ليها سعر.', { x: orderTypeLabel(orderType) })}</div> : (
            <div className="space-y-3">
              <SegmentedControl<'OWN' | 'FOLLOW'> value={mode} onChange={setMode} options={[{ id: 'FOLLOW', label: t('نسبة من قناة تانية'), fb: 'channels:mode:FOLLOW' }, { id: 'OWN', label: t('أسعار خاصة'), fb: 'channels:mode:OWN' }]} />
              {mode === 'FOLLOW' ? (
                <div className="rounded-xl surface-1 border line p-3 space-y-3">
                  <div className="grid sm:grid-cols-[1fr_120px] gap-3">
                    <Field label={t('ماشية ورا')}><Select data-fb="channels:follow" value={followId} onChange={(e) => setFollowId(e.target.value)} options={others.map((c) => ({ value: c.id, label: `${L(c.name)} (${orderTypeLabel(c.orderType)})` }))} /></Field>
                    <Field label={t('النسبة %')} error={percent && !pctOk ? t('من -50 لـ 200') : null}><Input data-fb="channels:percent" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} dir="ltr" /></Field>
                  </div>
                  <Field label={t('التقريب')}><SegmentedControl size="sm" value={step} onChange={setStep} options={STEPS.map((s) => ({ id: s.value, label: s.label, fb: `channels:step:${s.value}` }))} /></Field>
                  <div className="text-xs text-dim">{follow ? t('السعر = سعر {x} {s} {p}% ويتقرب. لو غيّرت سعر في {x} القناة دي بتتغير معاه. تقدر تحط سعر خاص لصنف معيّن من شاشة الأسعار.', { x: L(follow.name), s: Number(percent) >= 0 ? '+' : '−', p: String(Math.abs(Number(percent) || 0)) }) : ''}</div>
                </div>
              ) : (
                <div className="text-xs text-dim rounded-xl surface-1 border line p-3">{t('هتحط أسعار القناة بنفسك (صنف صنف أو تغيير جماعي). أي صنف لسه ملوش سعر في القناة بيتباع بسعر نوع الطلب.')}</div>
              )}
            </div>
          )}
        </Field>
        <Field label={t('اللون')}>
          <div className="flex gap-2 flex-wrap">{COLORS.map((c) => <button key={c} type="button" aria-pressed={c === color} onClick={() => setColor(c)} className="w-8 h-8 rounded-full border-2" style={{ background: c, borderColor: c === color ? 'var(--foreground)' : 'transparent' }} title={c} />)}</div>
        </Field>
        <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {!isDefault && <Switch checked={active} onChange={setActive} label={active ? t('القناة شغالة — بتظهر عند بداية الطلب') : t('القناة متقفلة — مش هتظهر في طلبات جديدة')} />}
        {channel?.history?.length ? (
          <div>
            <div className="text-sm font-bold mb-2 flex items-center gap-1.5"><History className="w-4 h-4" />{t('السجل')}</div>
            <Timeline items={channel.history.slice(0, 8).map((h, i) => ({ id: i, title: h.text, time: dateTime(h.at) }))} />
            <div className="text-[11px] text-dim mt-1">{t('آخر تعديل')}: {personText(channel.updatedByName)}</div>
          </div>
        ) : null}
      </div>
    </Popup>
  );
}
