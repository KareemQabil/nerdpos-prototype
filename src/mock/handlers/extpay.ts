// External payment authorizations (card terminal / online card / InstaPay / wallet), simulated approve or decline.
// An approved authorization is captured through the normal Payment.Capture with `authorizationId` on the tender.
import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, event } from '../store';
import { D, m4, isMoney } from '../money';
import { getOrder, need, page, requireFields, settlementOf, userName } from './util';
import type { Order } from '../types';
import type { PaymentAuthorization } from '../types-crm';

const auths = (db: Ctx['db']) => (db.paymentAuthorizations ??= []);
export const PROVIDERS: Record<string, { method: 'CARD' | 'DIGITAL_WALLET'; ar: string }> = {
  CARD_TERMINAL: { method: 'CARD', ar: 'مكنة الكارت' },
  ONLINE_CARD: { method: 'CARD', ar: 'كارت أونلاين (لينك دفع)' },
  INSTAPAY: { method: 'DIGITAL_WALLET', ar: 'إنستاباي' },
  WALLET: { method: 'DIGITAL_WALLET', ar: 'محفظة موبايل' },
};
const DECLINES = ['رصيد غير كافي', 'العميل لغى العملية', 'الكارت مرفوض من البنك', 'انتهت مهلة الدفع'];

/** Payment.Capture calls this for a tender carrying authorizationId (small hook in money.ts). */
export function authorizationForCapture(ctx: Ctx, o: Order, tender: any): PaymentAuthorization {
  const a = auths(ctx.db).find((x) => x.id === tender.authorizationId);
  if (!a) throw new ApiError('PAYMENT_AUTHORIZATION_NOT_FOUND', { authorizationId: tender.authorizationId });
  const amount = D(tender.amount ?? a.amount);
  if (a.state !== 'APPROVED' || a.orderId !== o.id || a.method !== tender.method || amount.gt(D(a.amount))) {
    throw new ApiError('PAYMENT_AUTHORIZATION_INVALID', { authorizationId: a.id, state: a.state, orderMatches: a.orderId === o.id, method: a.method, authorized: a.amount });
  }
  return a;
}

export const extPayHandlers: Record<string, Handler> = {
  // POST /payments/authorizations {orderId, amount, provider, outcome?: APPROVE|DECLINE}
  'Payment.AuthorizeExternal': (ctx) => {
    requireFields(ctx, 'orderId', 'provider');
    const o = getOrder(ctx, ctx.body.orderId);
    if (o.status === 'DRAFT') throw new ApiError('ORDER_NOT_CONFIRMED');
    if (o.status !== 'CONFIRMED') throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    const prov = PROVIDERS[ctx.body.provider];
    need(prov, 'VALIDATION_FAILED', { field: 'provider', allowed: Object.keys(PROVIDERS) });
    const st = settlementOf(ctx.db, o);
    const amount = ctx.body.amount ? String(ctx.body.amount) : st.remaining;
    need(isMoney(amount) && D(amount).gt(0), 'VALIDATION_FAILED', { field: 'amount' });
    if (D(amount).gt(D(st.remaining))) throw new ApiError('OVERPAYMENT', { remaining: st.remaining, amount: m4(amount) });
    const n = auths(ctx.db).length + 1;
    const declined = ctx.body.outcome === 'DECLINE';
    const a: PaymentAuthorization = {
      id: nextId('auth'), orderId: o.id, orderNumber: o.number, amount: m4(amount), method: prov.method, provider: ctx.body.provider,
      state: declined ? 'DECLINED' : 'APPROVED', reference: declined ? null : `${prov.method === 'CARD' ? 'AUTH' : 'TRX'}-${String(482900 + n * 37).slice(-6)}`,
      declineReason: declined ? (ctx.body.declineReason ?? DECLINES[n % DECLINES.length]) : null, at: ctx.nowIso, by: ctx.user!.id, terminalId: ctx.terminal?.id ?? null, captureId: null,
    };
    auths(ctx.db).unshift(a);
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, byName: ctx.user!.displayName, terminal: ctx.terminal?.code, kind: 'AUTHORIZATION', text: { ar: declined ? `${prov.ar}: العملية اترفضت (${a.declineReason})` : `${prov.ar}: اتوافق على ${m4(amount)} — رقم الموافقة ${a.reference}`, en: `${ctx.body.provider} ${a.state} ${amount}` } });
    event('PaymentAuthorization', o.id, `${o.number} ${ctx.body.provider} ${a.state}`);
    return { status: 201, body: { ...a, providerLabel: prov.ar } };
  },
  'Payment.AuthorizationFind': (ctx) => page(auths(ctx.db).filter((a) => (!ctx.query.orderId || a.orderId === ctx.query.orderId)).map((a) => ({ ...a, providerLabel: PROVIDERS[a.provider]?.ar ?? a.provider, byName: userName(ctx.db, a.by) })), ctx.query),
};
