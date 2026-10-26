// Customers, delivery, drivers, loyalty, online (aggregator) orders and external payment authorizations.
// All collections are OPTIONAL on DB (see types.ts) and always read with a default.
import type { Money } from './money';
import type { HistoryEntry, Loc } from './types';

/** Egyptian-style address: area (حي/منطقة) → zone, then street, building, floor, apartment and a landmark. */
export interface AddressSnapshot {
  area: string; street: string; building?: string; floor?: string; apartment?: string; landmark?: string; notes?: string;
  zoneId?: string | null; city?: string;
}
export interface CustomerAddress extends AddressSnapshot {
  id: string; label?: string; active: boolean; isDefault?: boolean; version: number; createdAt: string;
}
export interface Customer {
  id: string; code: string; name: string; phone: string; altPhone?: string | null; email?: string | null;
  notes?: string | null; allergies: string[]; tags: string[]; addresses: CustomerAddress[];
  createdAt: string; createdBy: string; version: number; active: boolean; mergedInto?: string | null;
  source: 'POS' | 'CALL_CENTER' | 'ONLINE' | 'SEED';
  /** Orders before the prototype's database existed (seed history only). */
  history?: { orders: number; spent: Money; lastOrderAt: string | null; favourite?: string };
}

export type LoyaltyEntryKind = 'EARN' | 'REDEEM' | 'ADJUST' | 'MERGE_IN' | 'MERGE_OUT' | 'REVERSE';
export interface LoyaltyEntry {
  id: string; customerId: string; kind: LoyaltyEntryKind; points: number; balanceAfter: number;
  orderId?: string | null; orderNumber?: string | null; amount?: Money | null; reason?: string | null;
  at: string; by: string; approvalGrantId?: string | null; captureId?: string | null;
}
export interface LoyaltyTier {
  id: string; name: Loc; minPoints: number; multiplier: string; color: string; perks: Loc; active: boolean; sortOrder: number; version: number;
}

export interface DeliveryZone {
  id: string; branchId: string; name: Loc; areas: string[]; fee: Money; minOrder: Money; etaMinutes: number; active: boolean;
  color: string; map: { x: number; y: number; w: number; h: number }; version: number;
}
export interface Driver {
  id: string; branchId: string; name: string; phone: string; vehicle: 'MOTORCYCLE' | 'CAR' | 'BICYCLE'; plate?: string | null;
  onShift: boolean; active: boolean; location: { x: number; y: number; at: string } | null; version: number; createdAt: string;
  /** Running shortage the driver still owes from past settlements. */
  owed: Money; userId?: string | null;
}
export type DeliveryState = 'PENDING' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED' | 'FAILED' | 'CANCELLED';
export type DeliveryPaymentMode = 'CASH_ON_DELIVERY' | 'PAID_ONLINE' | 'CARD_ON_DELIVERY';
export interface Delivery {
  id: string; branchId: string; number: string; orderId: string | null; orderNumber: string; customerId: string | null; customerName: string; phone: string;
  address: AddressSnapshot; zoneId: string | null; zoneName: string; fee: Money; amount: Money;
  state: DeliveryState; driverId: string | null; paymentMode: DeliveryPaymentMode; source: 'CALL_CENTER' | 'ONLINE' | 'POS';
  sourceLabel?: string | null; externalOrderId?: string | null; note?: string | null;
  createdAt: string; createdAtMs: number; promisedAt: string; promisedAtMs: number;
  assignedAt?: string | null; pickedUpAt?: string | null; deliveredAt?: string | null; failedAt?: string | null; cancelledAt?: string | null;
  attempts: { at: string; by: string; reasonCode: string; reason?: string | null; driverId: string | null }[];
  cancel?: { at: string; by: string; reason: string; approvalGrantId?: string | null; orderOutcome: string } | null;
  /** Cash the driver collected on delivery (cash on delivery) and still has to hand over. */
  cod: { amount: Money; settled: boolean; settlementId: string | null } | null;
  collected?: { method: string; amount: Money; reference: string | null; captureId: string | null } | null;
  timeline: HistoryEntry[]; version: number; historical?: boolean;
}
export interface DriverSettlement {
  id: string; driverId: string; branchId: string; sessionId: string; terminalId: string; at: string; by: string;
  deliveryIds: string[]; expected: Money; counted: Money; variance: Money; approvalGrantId?: string | null; reason?: string | null;
}

export type ExternalSource = 'APP_1' | 'APP_2' | 'WEBSITE' | 'WHATSAPP';
export interface ExternalOrderItem { code: string; name: string; quantity: string; unitPrice: Money; note?: string | null; productId?: string | null }
export interface ExternalOrder {
  id: string; branchId: string; source: ExternalSource; externalRef: string; receivedAt: string; receivedAtMs: number;
  customer: { name: string; phone: string; address?: AddressSnapshot | null };
  fulfillment: 'DELIVERY' | 'PICKUP'; payment: 'PAID_ONLINE' | 'CASH_ON_DELIVERY';
  items: ExternalOrderItem[]; sourceTotal: Money; note?: string | null;
  state: 'NEW' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';
  prepMinutes?: number | null; acceptedAt?: string | null; acceptedBy?: string | null; rejectedAt?: string | null; rejectReason?: string | null;
  orderId?: string | null; deliveryId?: string | null; customerId?: string | null; version: number;
}
export interface ChannelItemMap { source: ExternalSource; code: string; productId: string; updatedAt: string; by: string }

export interface PaymentAuthorization {
  id: string; orderId: string; orderNumber: string; amount: Money; method: 'CARD' | 'DIGITAL_WALLET'; provider: string;
  state: 'APPROVED' | 'DECLINED' | 'CAPTURED'; reference: string | null; declineReason?: string | null;
  at: string; by: string; terminalId: string | null; captureId?: string | null;
}

export interface CrmCollections {
  customers?: Customer[];
  loyaltyEntries?: LoyaltyEntry[];
  loyaltyTiers?: LoyaltyTier[];
  deliveryZones?: DeliveryZone[];
  drivers?: Driver[];
  deliveries?: Delivery[];
  driverSettlements?: DriverSettlement[];
  externalOrders?: ExternalOrder[];
  channelItemMap?: ChannelItemMap[];
  paymentAuthorizations?: PaymentAuthorization[];
}
