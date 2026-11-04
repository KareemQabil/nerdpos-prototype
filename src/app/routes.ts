// ux-07: one entry point per job. Removed and merged screens redirect here (no React / registry imports, so the
// node test bundles and the device store can use it).
/**
 * ux-07: removed and merged screens. Old navigation targets (search links, deep links, stored device state, journeys)
 * land on the one surviving entry point for the job. `kind` is the device kind; `tech` the technical-details switch.
 *  - pay          → the payment popup: on a cashier terminal the sale screen with the check, elsewhere «الشيكات» with
 *                   the popup open (one payment UI everywhere)
 *  - staffmeal    → the sale screen with the staff-meal popup open
 *  - delivery-new → the sale screen in «دليفري» mode with the start popup (the cashier's delivery flow)
 *  - soldout      → the sale screen's sold-out popup (cashier terminal) or the Menu tab (office / remote back office)
 *  - report-catalog (technical details off) → التقارير
 */
export function resolveRoute(screen: string, params: Record<string, any>, kind: string | null, tech: boolean, orderVisit?: (orderId: string) => boolean): { screen: string; params: Record<string, any> } {
  const p = params ?? {};
  switch (screen) {
    case 'pay': {
      const orderId = p.orderId ?? null;
      if (kind === 'CASH') return { screen: 'counter', params: { ...(orderId ? { orderId, pay: '1' } : {}), ...(orderId && orderVisit?.(orderId) ? { mode: 'collect' } : {}) } };
      return { screen: 'checks', params: orderId ? { pay: orderId } : {} };
    }
    case 'staffmeal': return { screen: 'counter', params: { staffMeal: '1' } };
    case 'delivery-new': return { screen: 'counter', params: { mode: 'delivery', startDelivery: p.customerId ?? '1' } };
    case 'soldout':
      if (kind === 'CASH') return { screen: 'counter', params: { soldOut: '1' } };
      if (kind === 'ADMIN' || kind === 'BO') return { screen: 'menu', params: { tab: 'soldout' } };
      return { screen, params: p };
    case 'report-catalog': return tech ? { screen, params: p } : { screen: 'reports', params: {} };
    default: return { screen, params: p };
  }
}
