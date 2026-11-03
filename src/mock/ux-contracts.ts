// ux-04 (kitchen displays, call board, customer display, line size change): proposed operations and the input
// extensions of existing operations. Not in operations.json; badged «مقترح» in the UI and listed in PROTOTYPE_GAPS.md.
import type { OperationDef } from './contracts';

export const UX04_PROPOSED_OPERATIONS: OperationDef[] = [
  { id: 'Kitchen.CallOrder', module: 'kitchen', kind: 'CMD', method: 'POST', path: '/kitchen/orders/{orderId}/call', permission: 'kitchen:advanceticket', input: { orderId: { type: 'Ref<orders.Order>', required: true }, force: { type: 'Boolean', required: false } }, output: 'CallView', errors: ['ORDER_NOT_FOUND', 'KDS_DISPATCH_ONLY', 'KITCHEN_TRANSITION_INVALID', 'VALIDATION_FAILED'], approval: null, backend_state: 'PROPOSED', note: 'ux-04: the dispatch screen calls the order number to the call board (only when every station is ready); calling again re-announces it' },
  { id: 'CallBoard.View', module: 'kitchen', kind: 'QRY', method: 'GET', path: '/call-board', permission: 'kitchen:read', input: { readyMinutes: { type: 'Integer', required: false }, auto: { type: 'Boolean', required: false } }, output: 'CallBoardView', errors: [], approval: null, backend_state: 'PROPOSED', note: 'ux-04: numbers being prepared and numbers called; a number leaves after hand-off or readyMinutes after the call; orders with a table are served at the table and are not shown' },
  { id: 'CustomerDisplay.View', module: 'orders', kind: 'QRY', method: 'GET', path: '/customer-display', permission: 'order:read', input: { orderId: { type: 'Ref<orders.Order>', required: false } }, output: 'CustomerDisplayView', errors: ['ORDER_NOT_FOUND'], approval: null, backend_state: 'PROPOSED', note: 'ux-04: guest-facing read model of the check on a cashier terminal: venue branding, active promotions, lines, server totals and settlement only' },
];

/** Optional inputs added to existing operations by ux-04 (the handlers accept them; the shape stays backward compatible). */
export const UX04_INPUT_EXTENSIONS: Record<string, Record<string, { type: string; required: boolean }>> = {
  'Order.UpdateLine': { variantId: { type: 'Ref<catalog.Variant>', required: false } }, // size of an UNSENT line, re-priced by the server
  'KdsScreen.Configure': { warnMinutes: { type: 'Integer', required: false }, lateMinutes: { type: 'Integer', required: false }, itemBump: { type: 'Boolean', required: false } },
  'Ticket.Recall': { undo: { type: 'Boolean', required: false } }, // undo a hand-off within 2 minutes: back to ready, not to cooking
};

export function applyUx04Extensions(ops: OperationDef[]) {
  for (const op of ops) {
    const ext = UX04_INPUT_EXTENSIONS[op.id];
    if (!ext) continue;
    op.input = { ...(op.input ?? {}), ...ext };
    op.note = `${op.note ? op.note + ' · ' : ''}ux-04 extension: ${Object.keys(ext).join(', ')}`;
  }
}
