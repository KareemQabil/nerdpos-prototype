// Principle 1 — "who did it vs who allowed it": reversal stages, dispositions and the removal trace.
import type { Loc } from './types';
import type { Money } from './money';

/** S0 unsent · S1 visible (pre-bill / kitchen), unpaid · S2 paid, day open · S3 paid, day closed. */
export type StageId = 'S0' | 'S1' | 'S2' | 'S3';
/** What happened to a removed item: nothing was made · back on the shelf (sealed can) · spoiled, kept for review. */
export type Disposition = 'NOT_PREPARED' | 'RETURN_TO_STOCK' | 'WASTE_HELD';
export type ReversalKind = 'LINE_REMOVE' | 'QTY_DECREASE' | 'ORDER_CANCEL' | 'LINE_VOID' | 'ORDER_VOID' | 'REFUND' | 'RETURN_AFTER_CLOSE' | 'STAFF_MEAL_CANCEL';
export type CredentialKind = 'PIN' | 'CARD' | 'FINGERPRINT' | 'REMOTE';

/** One removal of money or goods at any stage. Never deleted; the accountant reviews WASTE_HELD ones. */
export interface ReversalRec {
  id: string; at: string; atMs: number;
  /** the business date the reversal is booked on (today for a return after close) */
  businessDate: string; originalBusinessDate: string;
  branchId: string; orderId: string; orderNumber: string; orderKind: 'SALE' | 'STAFF_MEAL';
  lineId: string | null; productId: string | null; name: Loc; quantity: string; value: Money;
  stage: StageId; kind: ReversalKind;
  actorId: string; approverId: string | null; grantId: string | null; credentialKind: CredentialKind | null;
  terminalId: string | null; sessionId: string | null; drawerOwnerId: string | null;
  reasonCode: string | null; reason: string | null;
  disposition: Disposition | null;
  refundId?: string | null; afterClose: boolean;
  review: { state: 'PENDING' | 'VERIFIED' | 'MISSING'; by?: string; at?: string; note?: string } | null;
}

/** On a staff-meal order: who it is for and how it was counted against the daily allowance. */
export interface StaffMealInfo {
  employeeUserId: string; employeeName: string; basis: 'SALE_PRICE' | 'COST'; value: Money; saleValue: Money;
  approverId: string | null; grantId: string | null; sentToKitchen: boolean;
}
