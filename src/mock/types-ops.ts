// Types for the operations & system area: floor plans, table cleaning, approval requests, offline sync,
// outbox webhooks, reconciliation, business-day close, report schedules, capabilities, promotion model.
import type { Loc, Channel, Promotion } from './types';
import type { Money } from './money';

export type TableShape = 'SQUARE' | 'ROUND' | 'RECT' | 'BOOTH';
export interface FloorDecor { id: string; kind: 'WALL' | 'BAR' | 'DOOR' | 'PLANT' | 'LABEL' | 'WINDOW'; x: number; y: number; w: number; h: number; label?: string }
export interface FloorPlan {
  id: string; branchId: string; name: Loc; sortOrder: number; width: number; height: number; active: boolean;
  decor: FloorDecor[]; version: number; updatedAt: string; updatedBy: string;
}
/** Where a table sits on a floor plan (one per table). */
export interface TableLayout { tableId: string; floorId: string; x: number; y: number; w: number; h: number; shape: TableShape; rotation: number; seats: number }
/** Table turn cycle: a table is "dirty" from the moment its visit closes until someone marks it clean. */
export interface TableTurn { tableId: string; state: 'DIRTY' | 'CLEAN'; since: string; sinceMs: number; by: string | null; visitId: string | null; history: { at: string; by: string; state: 'DIRTY' | 'CLEAN' }[] }

export interface TicketMeta {
  ticketId: string; priority: 'NORMAL' | 'RUSH'; priorityAt?: string; priorityBy?: string;
  refireOf?: string | null; refireReason?: string | null; refireNote?: string | null;
  transferredFrom?: string | null; transferReason?: string | null; recalledAt?: string | null;
  history: { at: string; by: string; text: Loc }[];
}

export type ApprovalRequestState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
export interface ApprovalRequestRec {
  id: string; state: ApprovalRequestState; action: string; actionTitle: string; targetType: string; targetId: string; context: Record<string, unknown>;
  summary: Loc; opId: string; commandId: string | null; requesterUserId: string; terminalId: string | null; branchId: string | null;
  createdAt: string; createdAtMs: number; expiresAtMs: number; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; grantId: string | null; version: number;
}

export type OfflineItemState = 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'REJECTED' | 'RESOLVED' | 'DISCARDED';
export interface OfflineItem {
  offlineCommandId: string; terminalId: string | null; deviceLabel: string; userId: string; operation: string; params: Record<string, string>; body: any;
  label: string; queuedAt: string; replayedAt: string; state: OfflineItemState; errorCode: string | null; errorDetails: any; conflictKind: string | null;
  resolution: string | null; resolvedBy: string | null; resolvedAt: string | null; result?: unknown; version: number;
}
export interface SyncTerminalState { terminalId: string; lastBootstrapAt: string | null; lastChangesAt: string | null; lastReplayAt: string | null; cursor: number }

export interface WebhookDelivery {
  id: string; consumerId: string; consumerName: Loc; eventType: string; ref: string; label: string; state: 'PENDING' | 'DELIVERED' | 'FAILED' | 'DEAD';
  attempts: { at: string; error: string | null }[]; createdAt: string; nextAtMs: number; version: number;
}

export type ReconStatus = 'MATCHED' | 'UNEXPLAINED_DIFFERENCE' | 'EXPLAINED' | 'MISSING';
export interface ReconResult {
  id: string; runId: string; ruleId: string; key: string; title: Loc; businessDate: string; expected: Money; actual: Money; difference: Money; status: ReconStatus;
  drilldown: { kind: string; id: string; label: string; amount?: Money }[]; note: Loc | null; ackBy: string | null; ackAt: string | null; ackReason: string | null; version: number;
}
export interface ReconRun { id: string; ruleId: string; branchId: string; from: string; to: string; at: string; by: string; resultIds: string[]; counts: Record<string, number> }
export interface SettlementBatch { id: string; branchId: string; businessDate: string; provider: string; method: 'CARD' | 'DIGITAL_WALLET'; amount: Money; count: number; receivedAt: string }

export interface BusinessDayRec {
  date: string; branchId: string; state: 'CLOSED'; closedAt: string; closedBy: string; note: string | null; warningsAcknowledged: string[];
  summary: BusinessDaySummary; nextBusinessDate: string; version: number; lateOrders?: number;
}
export interface BusinessDaySummary {
  orders: number; guests: number; netSales: Money; payable: Money; tax: Money; service: Money; avgCheck: Money;
  payments: Record<string, Money>; refunds: Money; refundCount: number; discounts: Money; discountCount: number; comps: number;
  voidedLines: number; voidedAmount: Money; cancelledOrders: number; voidedOrders: number; cashVariance: Money; tips: Money; sessions: number;
}
/** Daily aggregates for the days before the demo started (history for trends and comparisons). */
export interface SalesHistoryDay { branchId: string; businessDate: string; netSales: Money; orders: number; guests: number; byHour: number[]; byMethod: Record<string, Money>; topItems: { name: Loc; qty: number; amount: Money }[] }

export interface ReportSchedule {
  id: string; reportId: string; reportTitle: Loc; frequency: 'DAILY' | 'WEEKLY'; weekday: number | null; time: string; format: 'CSV' | 'XLSX'; recipients: string[];
  branchId: string; active: boolean; createdAt: string; createdBy: string; nextRunAt: string; nextRunMs: number; runs: { at: string; status: 'SENT' | 'FAILED'; note: string }[]; version: number;
}
export interface ReportExport { id: string; reportId: string; from: string; to: string; format: 'CSV' | 'XLSX'; at: string; by: string; rows: number; filename: string }

export interface CapabilityState { id: string; scopeType: 'TENANT' | 'BRANCH'; scopeId: string; enabled: boolean; updatedAt: string; updatedBy: string; version: number }

/** The full promotion model (Promotion.Upsert). Stored on the same record; older records lack the extra fields. */
export interface PromotionRule {
  mechanic: 'ORDER' | 'ITEMS' | 'BUY_X_GET_Y';
  benefitType: 'PERCENTAGE' | 'FIXED_AMOUNT'; benefitValue: string;
  productIds: string[]; categoryIds: string[];
  buyQty: number; getQty: number; getPercent: string; getProductIds: string[]; getCategoryIds: string[];
  maxDiscount: Money | null;
}
export type PromotionX = Promotion & Partial<PromotionRule> & {
  dayparts?: { days: number[]; start: string; end: string }[] | null;
  codes?: string[]; maxUses?: number | null; maxUsesPerDay?: number | null; stacking?: 'EXCLUSIVE' | 'STACKABLE'; priority?: number;
  description?: Loc | null; updatedAt?: string; updatedBy?: string;
};
export type { Channel };
