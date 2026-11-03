// ux-04: the customer-facing display of a cashier terminal (PROPOSED read model). It returns only what may face the
// guest: the venue's branding, active promotions, and — for the check the cashier has on screen — its lines, the
// server's totals and its settlement. No costs, no customer contact data, no staff data beyond what a receipt shows.
import type { Handler } from '../kernel';
import { need, orderView, settlementOf, m4, D } from './util';
import { docTemplateOf } from '../r3b';
import { activeLines } from '../pricing';

const benefitText = (p: { benefitType: string; benefitValue: string }) => (p.benefitType === 'PERCENTAGE' ? { kind: 'PERCENT', value: p.benefitValue } : { kind: 'AMOUNT', value: m4(D(p.benefitValue)) });

export const displayHandlers: Record<string, Handler> = {
  'CustomerDisplay.View': (ctx) => {
    const tpl = docTemplateOf(ctx.db);
    const br = ctx.db.branches.find((b) => b.id === ctx.branchId) ?? null;
    const branding = {
      name: ctx.db.business.nameAr || ctx.db.business.name, nameEn: ctx.db.business.name || null,
      branch: br ? br.name : null, logoDataUrl: tpl.logoDataUrl, headerLines: tpl.headerLines, footerLines: tpl.footerLines,
    };
    const promos = ctx.db.promotions
      .filter((p) => p.active && (!p.branchIds.length || p.branchIds.includes(ctx.branchId ?? '')) && (!p.validTo || p.validTo > ctx.now))
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind, code: p.kind === 'CODED' ? p.code : null, benefit: benefitText(p), schedule: p.schedule ? { start: p.schedule.start, end: p.schedule.end } : null, minSubtotal: p.minSubtotal }));
    const featured = ctx.db.products.filter((p) => p.active !== false && p.imageUrl && !(p as any).direction).slice(0, 6).map((p) => ({ id: p.id, name: p.name, imageUrl: p.imageUrl }));
    let order = null;
    if (ctx.query.orderId) {
      const o = ctx.db.orders.find((x) => x.id === ctx.query.orderId && x.branchId === ctx.branchId);
      need(o, 'ORDER_NOT_FOUND');
      const v = orderView(ctx.db, o!);
      const st = o!.status === 'CONFIRMED' || o!.status === 'COMPLETED' ? settlementOf(ctx.db, o!) : null;
      const caps = ctx.db.captures.filter((c) => c.orderId === o!.id && !c.correctionOf && !c.corrected);
      const last = caps[caps.length - 1] ?? null;
      order = {
        id: o!.id, number: o!.number, shortNo: o!.shortNo ?? null, channel: o!.channel, status: o!.status, tableName: v.tableName,
        lines: activeLines(o!).map((l) => ({
          id: l.id, name: l.name, quantity: l.quantity, unitTotal: l.unitTotal, lineTotal: l.lineTotal, variant: l.variant ? l.variant.name : null,
          modifiers: (l.modifiers ?? []).map((m: any) => m.name), imageUrl: ctx.db.products.find((p) => p.id === l.productId)?.imageUrl ?? null, addedAt: l.addedAt,
        })),
        totals: v.totals,
        settlement: st ? { payable: st.payable, paid: st.paid, remaining: st.remaining, settled: st.settled } : null,
        lastTender: last ? { method: last.method, walletProvider: last.walletProvider ?? null, amount: last.amount, tendered: last.tendered, change: last.change } : null,
        // demo placeholder: the e-receipt link the QR opens (the real one comes from the e-receipt platform)
        receiptUrl: o!.status === 'COMPLETED' ? `https://receipt.nerdpos.example/r/${encodeURIComponent(o!.number)}` : null,
      };
    }
    return { branding, promos, featured, order, at: ctx.nowIso };
  },
};
