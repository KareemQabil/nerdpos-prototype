// شاشة العميل — the guest-facing screen of a cashier terminal. It mirrors the check on the cashier's screen, live:
// - selling: the item just added, big (picture, name, quantity, price), the running list (newest at the bottom,
//   highlighted, always scrolled into view) and the totals — every amount is the server's (CustomerDisplay.View);
// - paying: amount due, paid and change in very large type, and the tender used;
// - after payment: thank-you, the change, and a QR for the e-receipt;
// - idle: the venue's logo and name and a gentle carousel of active promotions and dishes.
// Playful but calm: soft shapes, one accent, slow motion. Sized with container units (1920×1080 down to 1280×800).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Sparkles, Tag, Clock, ShoppingBag, Utensils, Bike, Heart, WifiOff } from 'lucide-react';
import { useQuery } from '../../app/hooks';
import { useCustomerDisplay } from '../../app/customerDisplay';
import { Money, useNow } from '../../ui';
import { t, L } from '../../i18n';
import { cn, money, qty } from '../../lib/format';
import { sign } from '../../lib/cash';
import { tenderLabel } from '../../demo/tenderText';
import type { DisplaySettings } from './settings';
import { currency } from '../../lib/format';

const THANKS_MS = 60_000;
const nz = (v?: string | null) => !!v && sign(v) !== 0;

export function CustomerDisplay({ displayId, cfg, online }: { displayId: string; cfg: DisplaySettings; online: boolean }) {
  useNow(5000);
  const bus = useCustomerDisplay(cfg.host);
  const thanks = !!bus.paid && Date.now() - bus.paid.at < THANKS_MS && (!bus.orderId || bus.orderId === bus.paid.orderId);
  const orderId = thanks ? bus.paid!.orderId : bus.orderId;
  const q = useQuery<any>('CustomerDisplay.View', { query: orderId ? { orderId } : {} });
  const view = q.data;
  const order = view?.order && view.order.id === orderId ? view.order : null;
  const phase: 'idle' | 'selling' | 'paying' | 'thanks' = thanks && order ? 'thanks' : bus.paying && order && order.status !== 'COMPLETED' ? 'paying' : order && order.lines.length && order.status !== 'COMPLETED' ? 'selling' : 'idle';
  return (
    <div className="h-full flex flex-col p-[2.2cqmin] gap-[1.8cqmin] relative overflow-hidden" data-fb="customer-display" data-phase={phase} data-display-id={displayId}>
      <Blobs />
      {cfg.branding && phase !== 'idle' && <Brand view={view} order={order} online={online} />}
      <div className="flex-1 min-h-0 relative">
        {phase === 'idle' && <Idle view={view} />}
        {phase === 'thanks' && order && <Thanks order={order} paid={bus.paid!} />}
        {(phase === 'selling' || phase === 'paying') && order && (
          <div className="h-full grid grid-cols-[46fr_54fr] gap-[1.8cqmin]">
            <LinesAndTotals order={order} lastLineId={bus.lastLineId} />
            {phase === 'paying' ? <Paying order={order} paying={bus.paying!} /> : <div className="min-h-0 flex flex-col gap-[1.8cqmin]"><CurrentItem order={order} lastLineId={bus.lastLineId} /><PromoCard view={view} /></div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Soft background shapes (calm, playful). */
function Blobs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute -top-[18cqmin] -start-[12cqmin] w-[60cqmin] h-[60cqmin] rounded-full bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] blur-[6cqmin]" />
      <div className="absolute -bottom-[22cqmin] end-[8cqmin] w-[70cqmin] h-[70cqmin] rounded-full bg-[color-mix(in_srgb,var(--warning)_11%,transparent)] blur-[7cqmin]" />
    </div>
  );
}

function Brand({ view, order, online }: { view: any; order: any; online: boolean }) {
  const b = view?.branding;
  return (
    <header className="relative h-[10cqh] shrink-0 flex items-center gap-[2cqmin]" data-fb="cd-brand">
      {b?.logoDataUrl && <span className="h-full aspect-[5/2] rounded-[1.6cqmin] bg-white/95 p-[0.6cqmin] flex items-center justify-center shadow-sm"><img src={b.logoDataUrl} alt="" className="max-h-full max-w-full" /></span>}
      <div className="min-w-0 flex-1">
        <div className="font-display font-extrabold text-[3.8cqmin] leading-tight truncate">{b?.name || t('أهلًا بكم')}</div>
        {b?.headerLines?.[0] && <div className="text-[1.8cqmin] text-dim truncate">{b.headerLines[0]}</div>}
      </div>
      {!online && <span className="inline-flex items-center gap-2 text-[1.8cqmin] text-[var(--warning-text)] font-bold"><WifiOff className="w-[2.4cqmin] h-[2.4cqmin]" />{t('غير متصلة بجهاز الكاشير')}</span>}
      {order && <span className="h-[7cqh] px-[2cqmin] rounded-full surface-2 border border-[var(--glass-border)] inline-flex items-center gap-[1cqmin] text-[2.4cqmin] font-bold" data-fb="cd-check">{whereIcon(order)}{whereText(order)}{order.shortNo && order.channel !== 'DINE_IN' ? <span className="num ms-[0.6cqmin] px-[1cqmin] rounded-full bg-[var(--foreground)] text-[var(--background)]">{order.shortNo}</span> : null}</span>}
    </header>
  );
}
const whereText = (o: any) => (o.tableName ? `${t('ترابيزة')} ${o.tableName}` : o.channel === 'TAKEAWAY' ? t('تيك أواي') : o.channel === 'DELIVERY' ? t('دليفري') : t('صالة'));
const whereIcon = (o: any) => { const I = o.channel === 'TAKEAWAY' ? ShoppingBag : o.channel === 'DELIVERY' ? Bike : Utensils; return <I className="w-[2.6cqmin] h-[2.6cqmin] text-[var(--primary)]" />; };

/** The line the guest just saw being added: the one the cashier touched last, else the newest. */
function currentLine(order: any, lastLineId: string | null) {
  return order.lines.find((l: any) => l.id === lastLineId) ?? [...order.lines].sort((a: any, b: any) => String(a.addedAt).localeCompare(String(b.addedAt))).pop() ?? null;
}

function LinesAndTotals({ order, lastLineId }: { order: any; lastLineId: string | null }) {
  const cur = currentLine(order, lastLineId);
  const list = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => [...order.lines].sort((a: any, b: any) => String(a.addedAt).localeCompare(String(b.addedAt))), [order]);
  // newest at the bottom, always in view
  useEffect(() => { const el = list.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [lines.length, cur?.id, cur?.quantity]);
  const tt = order.totals;
  return (
    <section className="min-h-0 flex flex-col rounded-[2.6cqmin] border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] overflow-hidden" data-fb="cd-lines">
      <div className="grid grid-cols-[1fr_auto_auto] gap-[2cqmin] px-[2.2cqmin] py-[1.2cqmin] text-[1.8cqmin] font-bold text-dim border-b line">
        <span>{t('الصنف')}</span><span className="w-[7cqmin] text-center">{t('الكمية')}</span><span className="min-w-[12cqmin] text-end">{t('الإجمالي')}</span>
      </div>
      <div ref={list} className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-[1cqmin] py-[0.8cqmin]">
        {lines.map((l: any) => {
          const on = l.id === cur?.id;
          return (
            <div key={l.id} data-fb={`cd-line:${l.name.ar}`} data-current={on || undefined} className={cn('grid grid-cols-[1fr_auto_auto] gap-[2cqmin] items-center px-[1.2cqmin] py-[1cqmin] rounded-[1.6cqmin] transition-colors', on && 'bg-[var(--primary-container)] cd-pop')}>
              <span className="min-w-0"><span className="block text-[2.5cqmin] font-bold leading-tight truncate">{L(l.name)}{l.variant ? <span className="text-soft font-semibold"> · {L(l.variant)}</span> : null}</span>{l.modifiers?.length ? <span className="block text-[1.7cqmin] text-dim truncate">{l.modifiers.map((m: any) => L(m)).join(t('، '))}</span> : null}</span>
              <span className="num w-[7cqmin] text-center text-[2.5cqmin] font-bold">{qty(l.quantity)}</span>
              <Money v={l.lineTotal} className="min-w-[12cqmin] justify-end text-[2.5cqmin]" />
            </div>
          );
        })}
      </div>
      <div className="border-t line px-[2.2cqmin] py-[1.4cqmin] space-y-[0.5cqmin] text-[2cqmin] bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)]" data-fb="cd-totals">
        <Row k={t('الإجمالي الفرعي')} v={tt.itemsSubtotal} />
        {nz(tt.discountTotal) && <Row k={t('الخصم')} v={tt.discountTotal} minus />}
        {nz(tt.serviceCharge) && <Row k={t('الخدمة')} v={tt.serviceCharge} />}
        {nz(tt.tax) && <Row k={t('الضريبة')} v={tt.tax} />}
        <div className="flex items-end justify-between pt-[0.8cqmin]"><span className="text-[3.2cqmin] font-extrabold">{t('الإجمالي')}</span><Money v={tt.payable} className="text-[6.4cqmin] leading-none text-[var(--primary)]" /></div>
      </div>
    </section>
  );
}
const Row = ({ k, v, minus }: { k: string; v: string; minus?: boolean }) => <div className="flex items-center justify-between text-soft"><span>{k}</span><span className="font-bold">{minus ? <span className="num">−</span> : null}<Money v={v} /></span></div>;

function CurrentItem({ order, lastLineId }: { order: any; lastLineId: string | null }) {
  const l = currentLine(order, lastLineId);
  if (!l) return null;
  return (
    <section key={`${l.id}:${l.quantity}`} className="flex-[3] min-h-0 rounded-[2.6cqmin] border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] p-[2.6cqmin] flex items-center gap-[3cqmin] cd-pop" data-fb="cd-current" data-line={l.name.ar}>
      <div className="w-[min(34cqmin,38%)] aspect-square shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,color-mix(in_srgb,var(--primary)_30%,transparent),color-mix(in_srgb,var(--warning)_14%,transparent))] flex items-center justify-center overflow-hidden">
        {l.imageUrl ? <img src={l.imageUrl} alt="" className="w-[78%] h-[78%] object-contain cd-float" /> : <Sparkles className="w-1/3 h-1/3 text-[var(--primary)]" />}
      </div>
      <div className="min-w-0 flex-1 space-y-[1.6cqmin]">
        <div className="font-display font-extrabold text-[5.6cqmin] leading-[1.15] break-words">{L(l.name)}</div>
        {(!!l.variant || !!l.modifiers?.length) && <div className="text-[2.4cqmin] text-soft">{[l.variant ? L(l.variant) : null, ...(l.modifiers ?? []).map((m: any) => L(m))].filter(Boolean).join(t('، '))}</div>}
        <div className="flex items-end gap-[2.4cqmin] flex-wrap">
          <div className="rounded-[1.6cqmin] surface-2 px-[2cqmin] py-[1cqmin]"><div className="text-[1.7cqmin] text-dim">{t('الكمية')}</div><div className="num text-[5cqmin] font-black leading-none" data-fb="cd-current-qty">{qty(l.quantity)}</div></div>
          <div className="rounded-[1.6cqmin] surface-2 px-[2cqmin] py-[1cqmin]"><div className="text-[1.7cqmin] text-dim">{t('السعر')}</div><Money v={l.unitTotal} className="text-[5cqmin] leading-none" /></div>
        </div>
      </div>
    </section>
  );
}

function Paying({ order, paying }: { order: any; paying: { method: string; walletProvider?: string | null; due: string; entered: string; change: string | null; short: string | null } }) {
  const paidBefore = order.settlement?.paid ?? '0.0000';
  return (
    <section className="min-h-0 rounded-[2.6cqmin] border-[0.3cqmin] border-[var(--primary)] bg-[var(--glass-bg-strong)] p-[3cqmin] flex flex-col gap-[2.4cqmin] cd-pop" data-fb="cd-paying">
      <div className="flex items-center justify-between gap-[2cqmin]"><span className="text-[3cqmin] font-bold text-soft">{t('المطلوب')}</span><span className="h-[6cqh] px-[2cqmin] rounded-full bg-[var(--primary-container)] text-[var(--primary)] font-bold text-[2.3cqmin] inline-flex items-center" data-fb="cd-tender">{tenderLabel(paying.method, paying.walletProvider)}</span></div>
      <Money v={paying.due} className="text-[11cqmin] leading-none" />
      <div className="grid grid-cols-2 gap-[2cqmin]">
        <div className="rounded-[2cqmin] surface-2 p-[2cqmin]"><div className="text-[2.2cqmin] text-dim">{t('المدفوع')}</div><Money v={paying.entered} className="text-[6cqmin] leading-tight" /></div>
        {nz(paidBefore) && <div className="rounded-[2cqmin] surface-2 p-[2cqmin]"><div className="text-[2.2cqmin] text-dim">{t('دُفع سابقًا')}</div><Money v={paidBefore} className="text-[6cqmin] leading-tight" /></div>}
      </div>
      <div className="flex-1" />
      {paying.change ? (
        <div className="rounded-[2.4cqmin] bg-[var(--success)] text-[#04130a] p-[2.4cqmin] flex items-end justify-between" data-fb="cd-change"><span className="text-[3.4cqmin] font-extrabold">{t('الباقي')}</span><span className="amount font-black text-[10cqmin] leading-none"><span className="num">{money(paying.change, false)}</span><span className="amount-unit !text-current">{currency()}</span></span></div>
      ) : paying.short ? (
        <div className="rounded-[2.4cqmin] border-[0.3cqmin] border-[var(--warning)] p-[2.4cqmin] flex items-end justify-between" data-fb="cd-short"><span className="text-[3cqmin] font-bold text-[var(--warning-text)]">{t('المتبقي')}</span><Money v={paying.short} className="text-[7cqmin] leading-none text-[var(--warning-text)]" /></div>
      ) : null}
    </section>
  );
}

function Thanks({ order, paid }: { order: any; paid: { change: string; method: string } }) {
  return (
    <div className="h-full grid grid-cols-[1fr_auto] gap-[4cqmin] items-center px-[4cqmin] cd-pop" data-fb="cd-thanks">
      <div className="space-y-[2.6cqmin]">
        <div className="inline-flex items-center gap-[1.4cqmin] text-[var(--primary)]"><Heart className="w-[6cqmin] h-[6cqmin] fill-current" /></div>
        <div className="font-display font-extrabold text-[8.4cqmin] leading-[1.1]">{t('شكرًا لزيارتكم')}</div>
        {order.shortNo && order.channel !== 'DINE_IN' && <div className="text-[3.4cqmin] text-soft">{t('رقم طلبك')} <span className="num font-black text-[6cqmin] text-[var(--foreground)] align-middle px-[1.6cqmin] rounded-[1.4cqmin] bg-[var(--primary-container)]" data-fb="cd-short-no">{order.shortNo}</span></div>}
        {nz(paid.change) && <div className="inline-flex items-end gap-[2cqmin] rounded-[2.4cqmin] bg-[var(--success)] text-[#04130a] px-[2.6cqmin] py-[1.8cqmin]" data-fb="cd-change"><span className="text-[3cqmin] font-extrabold">{t('الباقي')}</span><span className="amount font-black text-[8cqmin] leading-none"><span className="num">{money(paid.change, false)}</span><span className="amount-unit !text-current">{currency()}</span></span></div>}
        <div className="text-[2.4cqmin] text-dim flex items-center gap-[1cqmin]"><span>{t('الإجمالي')}</span><Money v={order.totals.payable} /><span>·</span><span>{tenderLabel(paid.method)}</span></div>
      </div>
      {order.receiptUrl && (
        <div className="flex flex-col items-center gap-[1.6cqmin]" data-fb="cd-qr" data-url={order.receiptUrl}>
          <div className="rounded-[2.4cqmin] bg-white p-[2cqmin] shadow-lg"><QRCodeSVG value={order.receiptUrl} size={256} level="M" style={{ width: '32cqmin', height: '32cqmin' }} /></div>
          <div className="text-[2.2cqmin] text-soft text-center max-w-[36cqmin]">{t('امسح الرمز لاستلام الإيصال الإلكتروني')}</div>
        </div>
      )}
    </div>
  );
}

/** Promotions and dishes for the idle screen and the small card beside the current item. */
function slidesOf(view: any) {
  const promos = (view?.promos ?? []).map((p: any) => ({ id: p.id, kind: 'promo' as const, p }));
  const dishes = (view?.featured ?? []).map((d: any) => ({ id: d.id, kind: 'dish' as const, d }));
  return [...promos, ...dishes];
}
function useRotate(n: number, ms: number) {
  const [i, setI] = useState(0);
  useEffect(() => { if (n < 2) return; const iv = setInterval(() => setI((x) => (x + 1) % n), ms); return () => clearInterval(iv); }, [n, ms]);
  return n ? i % n : 0;
}
const benefit = (p: any) => <>{t('خصم')} <span className="num">{p.benefit.kind === 'PERCENT' ? `${qty(p.benefit.value)}%` : money(p.benefit.value, false)}</span>{p.benefit.kind === 'PERCENT' ? null : <> {currency()}</>}</>;

function PromoCard({ view }: { view: any }) {
  const slides = slidesOf(view).filter((s) => s.kind === 'promo');
  const i = useRotate(slides.length, 7000);
  const s = slides[i];
  if (!s) return <div className="flex-[1]" />;
  return (
    <section key={s.id} className="flex-[1] min-h-0 rounded-[2.6cqmin] bg-[linear-gradient(120deg,color-mix(in_srgb,var(--primary)_22%,transparent),color-mix(in_srgb,var(--warning)_18%,transparent))] border border-[var(--glass-border)] px-[2.6cqmin] py-[1.8cqmin] flex items-center gap-[2cqmin] cd-fade" data-fb="cd-promo">
      <Tag className="w-[5cqmin] h-[5cqmin] text-[var(--primary)] shrink-0" />
      <div className="min-w-0 flex-1"><div className="font-display font-extrabold text-[3cqmin] leading-tight truncate">{L(s.p.name)}</div><div className="text-[2cqmin] text-soft truncate">{benefit(s.p)}{s.p.schedule ? <> · <span className="num">{s.p.schedule.start}–{s.p.schedule.end}</span></> : null}{s.p.code ? <> · {t('الكود')} <span className="num">{s.p.code}</span></> : null}</div></div>
    </section>
  );
}

function Idle({ view }: { view: any }) {
  const b = view?.branding;
  const slides = slidesOf(view);
  const i = useRotate(slides.length, 6000);
  const s = slides[i];
  return (
    <div className="h-full grid grid-cols-[42fr_58fr] gap-[3cqmin] items-stretch" data-fb="cd-idle">
      <div className="flex flex-col justify-center gap-[2.4cqmin] ps-[2cqmin]">
        {b?.logoDataUrl && <span className="w-[44cqmin] aspect-[5/2] rounded-[2.4cqmin] bg-white/95 p-[1.4cqmin] flex items-center justify-center shadow-lg"><img src={b.logoDataUrl} alt="" className="max-h-full max-w-full" /></span>}
        <div className="font-display font-extrabold text-[7.4cqmin] leading-[1.1]">{t('أهلًا بكم')}</div>
        {b?.name && <div className="text-[3.4cqmin] text-soft font-bold">{b.name}</div>}
        {(b?.footerLines ?? []).slice(0, 1).map((x: string) => <div key={x} className="text-[2.2cqmin] text-dim">{x}</div>)}
      </div>
      <div className="relative min-h-0 flex flex-col">
        {s ? (
          <div key={s.id} className="flex-1 min-h-0 rounded-[3.4cqmin] border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] overflow-hidden flex flex-col cd-fade" data-fb="cd-slide" data-kind={s.kind}>
            {s.kind === 'promo' ? (
              <div className="flex-1 flex flex-col justify-center gap-[2.4cqmin] p-[5cqmin] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_26%,transparent),color-mix(in_srgb,var(--warning)_20%,transparent))]">
                <span className="inline-flex items-center gap-[1.2cqmin] text-[2.6cqmin] font-bold text-[var(--primary)]"><Sparkles className="w-[3cqmin] h-[3cqmin]" />{t('عرض اليوم')}</span>
                <div className="font-display font-extrabold text-[6.4cqmin] leading-[1.15]">{L(s.p.name)}</div>
                <div className="text-[4cqmin] font-black">{benefit(s.p)}</div>
                <div className="flex flex-wrap gap-[1.4cqmin] text-[2.2cqmin] text-soft">
                  {s.p.schedule && <span className="inline-flex items-center gap-[0.8cqmin] px-[1.6cqmin] py-[0.6cqmin] rounded-full surface-2"><Clock className="w-[2.4cqmin] h-[2.4cqmin]" /><span className="num">{s.p.schedule.start}–{s.p.schedule.end}</span></span>}
                  {s.p.code && <span className="px-[1.6cqmin] py-[0.6cqmin] rounded-full surface-2">{t('الكود')} <b className="num">{s.p.code}</b></span>}
                </div>
              </div>
            ) : (
              <div className="flex-1 grid grid-rows-[1fr_auto]">
                <div className="flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,color-mix(in_srgb,var(--primary)_20%,transparent),transparent_70%)]"><img src={s.d.imageUrl} alt="" className="h-[70%] max-h-[40cqmin] object-contain cd-float" /></div>
                <div className="p-[3cqmin] pt-0"><span className="text-[2.2cqmin] font-bold text-[var(--primary)]">{t('من قائمتنا')}</span><div className="font-display font-extrabold text-[5cqmin] leading-tight">{L(s.d.name)}</div></div>
              </div>
            )}
          </div>
        ) : <div className="flex-1" />}
        {slides.length > 1 && <div className="flex justify-center gap-[1cqmin] pt-[1.6cqmin]">{slides.map((x, k) => <span key={x.id} className={cn('h-[1.2cqmin] rounded-full transition-all', k === i ? 'w-[4cqmin] bg-[var(--primary)]' : 'w-[1.2cqmin] bg-[var(--glass-border)]')} />)}</div>}
      </div>
    </div>
  );
}
