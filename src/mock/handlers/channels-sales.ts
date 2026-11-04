// Sales channels as records (E13): list and create/change. The order type keeps driving operations; the channel
// carries the price list (own prices, or follow another channel ± %). Managers and the owner create channels.
import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { D } from '../money';
import { checkVersion, need, page, userName } from './util';
import { ORDER_TYPES, salesChannelsOf, salesChannelById, priceKeyOf } from '../sales-channels';
import type { Channel } from '../types';
import type { SalesChannel } from '../types-channels';
import { SOURCES } from './channels';

const STEPS = ['0', '0.25', '0.50', '1', '5'];
const typeAr = (c: Channel) => ({ DINE_IN: 'صالة', TAKEAWAY: 'تيك أواي', DELIVERY: 'دليفري' } as Record<string, string>)[c];

function channelView(ctx: Ctx, c: SalesChannel) {
  const db = ctx.db;
  const key = priceKeyOf(c);
  const ownPrices = key === null ? null : db.priceRules.filter((r) => r.salesChannelId === key && r.effectiveFrom <= ctx.now && (r.effectiveTo === null || r.effectiveTo > ctx.now)).length;
  const orders = db.orders.filter((o) => (o.salesChannelId ?? `sch_${o.channel.toLowerCase()}`) === c.id).length;
  const follows = c.follow ? salesChannelById(db, c.follow.channelId) : null;
  return {
    ...c, ownPrices, orders, followers: salesChannelsOf(db).filter((x) => x.follow?.channelId === c.id).map((x) => ({ id: x.id, name: x.name })),
    followsName: follows?.name ?? null, updatedByName: userName(db, c.updatedBy), createdByName: userName(db, c.createdBy),
  };
}

/** A FOLLOW chain must not loop back to itself. */
function followsItself(all: SalesChannel[], id: string, start: string | null): boolean {
  let cur = start;
  for (let i = 0; cur && i < 10; i++) {
    if (cur === id) return true;
    cur = all.find((c) => c.id === cur)?.follow?.channelId ?? null;
  }
  return false;
}

export const salesChannelHandlers: Record<string, Handler> = {
  'SalesChannel.List': (ctx) => {
    const all = salesChannelsOf(ctx.db).filter((c) => c.active || ctx.query.includeInactive === 'true').filter((c) => !ctx.query.orderType || c.orderType === ctx.query.orderType);
    return { ...page([...all].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => channelView(ctx, c)), { ...ctx.query, limit: ctx.query.limit ?? '100' }), sources: SOURCES /* ux-07: the online-order sources a channel can own */ };
  },
  'SalesChannel.Upsert': (ctx) => {
    const db = ctx.db;
    const b = ctx.body ?? {};
    const all = salesChannelsOf(db);
    const isNew = ctx.params.salesChannelId === 'new';
    const cur = isNew ? null : all.find((c) => c.id === ctx.params.salesChannelId) ?? null;
    if (!isNew) need(cur, 'SALES_CHANNEL_NOT_FOUND', { salesChannelId: ctx.params.salesChannelId });
    if (cur && b.expectedVersion !== undefined) checkVersion(cur, b.expectedVersion);
    const nameAr = String(b.name?.ar ?? cur?.name.ar ?? '').trim();
    const nameEn = String(b.name?.en ?? cur?.name.en ?? '').trim() || nameAr;
    need(nameAr.length >= 2 && nameAr.length <= 40, 'VALIDATION_FAILED', { field: 'name.ar', reasonAr: 'اكتب اسم القناة (من 2 لـ 40 حرف)' });
    const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
    if (all.some((c) => c.id !== cur?.id && (norm(c.name.ar) === norm(nameAr) || norm(c.name.en) === norm(nameEn)))) throw new ApiError('SALES_CHANNEL_NAME_TAKEN', { name: nameAr });
    const orderType = (b.orderType ?? cur?.orderType) as Channel;
    need(ORDER_TYPES.includes(orderType), 'VALIDATION_FAILED', { field: 'orderType', reasonAr: 'اختار نوع الطلب: صالة أو تيك أواي أو دليفري' });
    if (cur && orderType !== cur.orderType) {
      need(!cur.isDefault, 'VALIDATION_FAILED', { field: 'orderType', reasonAr: 'القناة الأساسية نوعها ثابت' });
      need(!db.orders.some((o) => o.salesChannelId === cur.id), 'VALIDATION_FAILED', { field: 'orderType', reasonAr: 'القناة دي اتباع عليها قبل كده — نوع الطلب بتاعها ما يتغيرش. اعمل قناة جديدة.' });
    }
    const priceMode = (b.priceMode ?? cur?.priceMode ?? 'OWN') as SalesChannel['priceMode'];
    need(['OWN', 'FOLLOW'].includes(priceMode), 'VALIDATION_FAILED', { field: 'priceMode' });
    if (cur?.isDefault) need(priceMode === 'OWN', 'VALIDATION_FAILED', { field: 'priceMode', reasonAr: 'القناة الأساسية هي اللي ماسكة أسعار نوع الطلب — مينفعش تمشي ورا قناة تانية' });
    let follow: SalesChannel['follow'] = null;
    if (priceMode === 'FOLLOW') {
      const f = b.follow ?? cur?.follow;
      need(f?.channelId, 'VALIDATION_FAILED', { field: 'follow.channelId', reasonAr: 'اختار القناة اللي هتمشي وراها' });
      const src = all.find((c) => c.id === f.channelId);
      need(src, 'SALES_CHANNEL_NOT_FOUND', { salesChannelId: f.channelId });
      const pct = String(f.percent ?? '0').trim();
      need(/^-?\d{1,3}(\.\d{1,2})?$/.test(pct) && D(pct).gte(-50) && D(pct).lte(200), 'VALIDATION_FAILED', { field: 'follow.percent', reasonAr: 'النسبة من -50% لـ 200%' });
      const step = String(f.roundingStep ?? '0');
      need(STEPS.includes(step), 'VALIDATION_FAILED', { field: 'follow.roundingStep' });
      if (cur) need(!followsItself(all, cur.id, src!.id), 'VALIDATION_FAILED', { field: 'follow.channelId', reasonAr: 'القنوات مش ممكن تمشي ورا بعض في دايرة' });
      follow = { channelId: src!.id, percent: D(pct).toString(), roundingStep: step };
    }
    const active = b.active ?? cur?.active ?? true;
    if (cur?.isDefault) need(active, 'VALIDATION_FAILED', { field: 'active', reasonAr: 'القناة الأساسية لنوع الطلب ما تتقفلش' });
    if (cur && !active) need(!all.some((c) => c.active && c.follow?.channelId === cur.id), 'VALIDATION_FAILED', { field: 'active', reasonAr: 'فيه قنوات ماشية ورا القناة دي — غيّرها الأول' });
    const color = String(b.color ?? cur?.color ?? '#8b5cf6');
    need(/^#[0-9a-fA-F]{6}$/.test(color), 'VALIDATION_FAILED', { field: 'color' });
    const sortOrder = Number(b.sortOrder ?? cur?.sortOrder ?? (Math.max(0, ...all.map((c) => c.sortOrder)) + 10));
    need(Number.isFinite(sortOrder), 'VALIDATION_FAILED', { field: 'sortOrder' });
    // ux-07: online-order sources this channel owns (one source → at most one active channel; delivery / takeaway only)
    const externalSources: string[] = [...new Set<string>((b.externalSources ?? cur?.externalSources ?? []).map(String))];
    for (const src of externalSources) need(src in SOURCES, 'VALIDATION_FAILED', { field: 'externalSources', value: src, reasonAr: 'مصدر طلبات غير معروف' });
    if (externalSources.length) need(orderType !== 'DINE_IN', 'VALIDATION_FAILED', { field: 'externalSources', reasonAr: 'الطلبات الإلكترونية دليفري أو تيك أواي فقط' });
    for (const src of externalSources) {
      const other = all.find((c) => c.id !== cur?.id && c.active && (c.externalSources ?? []).includes(src));
      need(!other, 'VALIDATION_FAILED', { field: 'externalSources', value: src, reasonAr: `المصدر «${SOURCES[src as keyof typeof SOURCES]?.ar ?? src}» مربوط بقناة «${other?.name.ar ?? ''}». فك الربط من هناك أولًا.` });
    }

    // a change of what the channel sells at (follow source / percent) is a price change → the PRICE_CHANGE rule decides
    const pricingChanged = !!cur && (cur.priceMode !== priceMode || JSON.stringify(cur.follow) !== JSON.stringify(follow));
    if (pricingChanged) ctx.requireApproval({ action: 'PRICE_CHANGE', targetType: 'catalog.SalesChannel', targetId: cur!.id, context: { productId: 'CHANNEL', branchId: '*', channel: orderType, effectiveFrom: ctx.nowIso, changeKind: 'CHANGE', oldAmount: null, newAmount: null, changePercent: follow ? D(follow.percent).abs().toString() : '0', firstPrice: false, decrease: !!follow && D(follow.percent).lt(0), rows: 0 }, grantId: b.approvalGrantId });

    const priceText = (m: string, f: SalesChannel['follow']) => m === 'FOLLOW' && f ? `ماشية ورا ${all.find((c) => c.id === f.channelId)?.name.ar ?? '؟'} ${D(f.percent).gte(0) ? '+' : ''}${f.percent}%` : 'أسعار خاصة بيها';
    if (!cur) {
      const base = `sch_${(nameEn || 'channel').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'channel'}`;
      let id = base; let i = 2;
      while (all.some((c) => c.id === id)) id = `${base}_${i++}`;
      const c: SalesChannel = { id, name: { ar: nameAr, en: nameEn }, orderType, isDefault: false, active, sortOrder, color, priceMode, follow, note: b.note ?? null, externalSources, createdAt: ctx.nowIso, createdBy: ctx.user!.id, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id, version: 1, history: [{ at: ctx.nowIso, by: ctx.user!.id, text: `اتعملت قناة ${nameAr} (${typeAr(orderType)}) — ${priceText(priceMode, follow)}` }] };
      all.push(c);
      ctx.audit(`sales channel created: ${nameEn} (${orderType}, ${priceMode === 'FOLLOW' ? `follows ${follow!.channelId} ${follow!.percent}%` : 'own prices'})`, id, true);
      return { status: 201, body: channelView(ctx, c) };
    }
    const changes: string[] = [];
    if (cur.name.ar !== nameAr || cur.name.en !== nameEn) changes.push(`الاسم: ${cur.name.ar} ← ${nameAr}`);
    if (cur.orderType !== orderType) changes.push(`نوع الطلب: ${typeAr(cur.orderType)} ← ${typeAr(orderType)}`);
    if (pricingChanged) changes.push(`الأسعار: ${priceText(cur.priceMode, cur.follow)} ← ${priceText(priceMode, follow)}`);
    if (cur.active !== active) changes.push(active ? 'اتفتحت' : 'اتقفلت');
    if (cur.color !== color) changes.push('اللون');
    if (cur.sortOrder !== sortOrder) changes.push('الترتيب');
    if ((cur.externalSources ?? []).join(',') !== externalSources.join(',')) changes.push(`مصادر الطلبات الإلكترونية: ${externalSources.map((x) => SOURCES[x as keyof typeof SOURCES]?.ar ?? x).join('، ') || '—'}`);
    Object.assign(cur, { name: { ar: nameAr, en: nameEn }, orderType, priceMode, follow, active, color, sortOrder, externalSources, note: b.note !== undefined ? b.note : cur.note, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id, version: cur.version + 1 });
    cur.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: changes.join(' · ') || 'من غير تغيير' });
    ctx.audit(`sales channel ${cur.name.en} changed: ${changes.length} change(s)${pricingChanged ? ' incl. pricing' : ''}`, cur.id, true, b.approvalGrantId);
    return channelView(ctx, cur);
  },
};
