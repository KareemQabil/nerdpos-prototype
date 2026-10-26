// Mock database shape. One in-memory object, persisted to localStorage.
import type { Money } from './money';
import type { CrmCollections } from './types-crm';

export type Channel = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type Loc = { ar: string; en: string };
export type ScopeType = 'TENANT' | 'BRANCH' | 'CHANNEL' | 'TERMINAL';
export type TenderMethod = 'CASH' | 'CARD' | 'DIGITAL_WALLET' | 'DEPOSIT' | 'LOYALTY' | 'ONLINE'; // LOYALTY/ONLINE: crm area (points redeemed, paid on a delivery app)

export interface Business { id: string; name: string; legalName: string | null; currency: 'EGP'; nameAr?: string; version: number }
export interface Branch { id: string; code: string; name: string; timezone: string; businessDayCutoff: string; active: boolean; version: number }
export interface Terminal { id: string; code: string; name: string; branchId: string; drawer: boolean; lifecycle: 'ACTIVE' | 'DECOMMISSIONED'; purpose: string; kind: 'FLOOR' | 'CASH' | 'KDS' | 'ADMIN'; version: number }
export interface Role { id: string; name: string; permissionIds: string[]; active: boolean; version: number }
export interface RoleAssignment { roleId: string; branchIds: string[] }
export interface User {
  id: string; username: string; displayName: string; active: boolean; version: number;
  pin: string; password: string; roleAssignments: RoleAssignment[];
  failedAttempts: number; lockedUntil: number | null; credentialVersion: number; mustChangeCredentials: boolean;
}
export interface AuthSession { id: string; userId: string; terminalId: string | null; branchId: string | null; credentialKind: 'PIN' | 'PASSWORD'; createdAt: string; expiresAt: number; revokedAt: string | null; credentialVersion: number }

export interface Unit { id: string; code: string; precision: number; active: boolean; used: boolean; version: number }
export interface Category { id: string; name: Loc; active: boolean; sortOrder: number; colorCode?: string; version: number }
export interface ModifierOption { id: string; name: Loc; priceDelta: Money; active: boolean; allergens?: string[]; version: number;
  /** menu area (proposed): preselected, display order, a sub-choice (one level), price of an EXTRA level */
  isDefault?: boolean; sortOrder?: number; nestedGroupId?: string | null; extraPriceDelta?: Money | null }
export interface ModifierGroup { id: string; name: Loc; selectionRule: 'SINGLE' | 'MULTIPLE'; min: number; max: number; active: boolean; options: ModifierOption[]; version: number;
  /** menu area (proposed): INGREDIENTS = no/less/extra per ingredient; size multiplier on or off; toppings per pizza half */
  kind?: 'STANDARD' | 'INGREDIENTS'; scalesWithSize?: boolean; allowHalfPlacement?: boolean }
/** Direction D1: a size of a product. */
export interface Variant { id: string; name: Loc; priceDelta: Money; modifierMultiplier: string; active: boolean;
  sku?: string | null; barcode?: string | null; attributes?: { name: string; value: string }[]; calories?: number | null; isDefault?: boolean; sortOrder?: number; version?: number }
/** Direction D1: a combo slot. */
export interface ComboSlot { id: string; name: Loc; options: { productId: string; upcharge: Money; nestedGroupId?: string; variantId?: string | null }[]; defaultProductId: string; required?: boolean; sortOrder?: number }
export interface Product {
  id: string; sku: string; name: Loc; categoryId: string; unitId: string; taxPolicyId: string | null;
  modifierGroupIds: string[]; imageUrl?: string; colorCode?: string; description?: Loc;
  active: boolean; version: number; createdAt: string; createdBranchId?: string;
  // direction (مقترح)
  direction?: boolean; allergens?: string[]; variants?: Variant[]; halfAndHalf?: boolean; combo?: ComboSlot[];
  chargeTags?: string[]; // e.g. TABLE_TAX
  // menu area (proposed): calories, which products can be paired as halves, the half price ratio for SUM_OF_HALVES
  calories?: number | null; halfGroup?: string | null; halfPriceRatio?: string | null;
}
export interface Availability { productId: string; branchId: string; state: 'AVAILABLE' | 'SOLD_OUT' | 'BLOCKED'; reason: string | null; updatedAt: string; updatedBy: string | null; /** sold out for this business date only (auto back next day) */ soldOutFor?: string | null }
export interface PriceRule {
  id: string; productId: string; branchId: string; channel: Channel; amount: Money; currency: 'EGP';
  effectiveFrom: number; effectiveTo: number | null; createdAt: string; createdBy: string; version: number; replacesRuleId?: string | null;
  /** menu area (proposed): own price of one size; absent = the product price */ variantId?: string | null; bulkChangeId?: string | null;
}
export interface TaxPolicy {
  id: string; name: Loc; jurisdiction: string; rate: string; calculationMode: 'EXCLUSIVE' | 'INCLUSIVE';
  roundingMode: 'HALF_UP' | 'HALF_EVEN' | 'DOWN'; roundingScale: number; fiscalTaxType?: string | null; fiscalSubtype?: string | null;
  active: boolean; version: number; history: { at: string; by: string; change: string }[];
  exemption?: 'NONE' | 'EXEMPT' | 'ZERO_RATED';
}

export interface Table { id: string; branchId: string; name: string; area: string; capacity: number; active: boolean; version: number }
export interface TableVisit {
  id: string; tableId: string; branchId: string; state: 'OPEN' | 'CLOSED'; guestCount: number; serverUserId: string;
  openedAt: string; openedAtMs: number; closedAt: string | null; version: number; joinedTableIds: string[]; history: HistoryEntry[];
}

export interface HistoryEntry { at: string; by: string; byName?: string; terminal?: string; kind: string; text: Loc | string; data?: unknown }

export interface LineModifier { optionId: string; groupId: string; name: Loc; priceDelta: Money; level?: string; placement?: string; parentOptionId?: string }
export type LineStatus = 'ACTIVE' | 'VOIDED' | 'REMOVED' | 'MOVED';
export interface OrderLine {
  id: string; productId: string; sku: string; name: Loc; categoryId: string;
  quantity: string; unitPrice: Money; modifiers: LineModifier[]; unitTotal: Money; lineTotal: Money;
  taxPolicy: { id: string; rate: string; mode: 'EXCLUSIVE' | 'INCLUSIVE'; version: number; name: Loc; roundingMode: TaxPolicy['roundingMode']; roundingScale: number; exemption?: string };
  priceRuleId: string; status: LineStatus; version: number; note?: string;
  fireRound: number | null; firedAt: string | null; addedAt: string; addedBy: string;
  voided?: { at: string; by: string; reasonCode: string; reason?: string; approvalGrantId?: string; disposition: string; approverId?: string };
  movedTo?: string; movedFrom?: string;
  // direction
  seat?: number | null; variant?: { id: string; name: Loc; priceDelta: Money } | null;
  children?: { kind: 'COMBO_SLOT' | 'HALF' | 'NESTED'; name: Loc; productId?: string; upcharge: Money; detail?: Loc; slotId?: string; variantId?: string | null; allocated?: Money; taxPolicyId?: string; categoryId?: string }[];
  taxSplit?: import('./menu-types').LineTaxPart[];
  allergens?: string[]; chargeTags?: string[]; kitchenMods?: { id: string; at: string; by: string; text: string }[];
  shareOf?: { lineId: string; parts: number; index: number } | null;
}
export interface OrderDiscount {
  id: string; type: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: string; reasonCode: string; reason?: string; approvalGrantId?: string;
  appliedAt: string; appliedBy: string; active: boolean; promotionId?: string; label?: Loc;
}
export interface FireRound { round: number; firedAt: string; firedBy: string; lineIds: string[]; via: 'FIRE' | 'CONFIRM'; commandId: string }
export interface PolicySnapshot {
  pricingOrder: 'DISCOUNT_BEFORE_TAX' | 'DISCOUNT_AFTER_TAX'; rounding: { mode: 'HALF_UP' | 'HALF_EVEN' | 'DOWN'; scale: number };
  confirmationMode: string | null; confirmationChannels: Channel[];
  charges: ChargeComponent[]; tableTax: { enabled: boolean; rate: string; order: 'BEFORE_VAT' | 'AFTER_VAT' };
  halfAndHalf: 'HIGHER_HALF' | 'AVERAGE'; capturedAt: string;
}
export interface ChargeComponent { id: string; label: Loc; basis: 'PER_CHECK' | 'PER_GUEST' | 'MINIMUM_PER_GUEST'; amount: Money; channels: Channel[]; taxable: boolean; fiscalCode: string | null }
export interface ServiceCapture { rate: string; taxable: boolean; origin: 'POLICY' | 'CHANNEL_ABSENT' | 'NOT_ACTIVATED'; capturedAt: string; channel: Channel }
export interface Totals {
  itemsSubtotal: Money; itemDiscount: Money; serviceCharge: Money; serviceDiscount: Money; serviceRate: string | null;
  charges: { id: string; label: Loc; amount: Money; taxable: boolean }[]; tableTax: Money;
  taxBase: Money; tax: Money; taxLines: { rate: string; base: Money; amount: Money; name: Loc; mode?: string }[];
  discountTotal: Money; discountAfterTax: Money; payable: Money; netSales: Money; comp: boolean;
}
export type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'VOIDED' | 'MERGED';
export interface Order {
  id: string; number: string; branchId: string; channel: Channel; status: OrderStatus; kind: 'SALE' | 'STAFF_MEAL';
  visitId: string | null; tableId: string | null; sessionId: string | null; terminalId: string; serverUserId: string;
  createdAt: string; createdAtMs: number; businessDate: string; createdBy: string;
  confirmedAt: string | null; confirmedBy: string | null; completedAt: string | null; completedAtMs: number | null; completedBusinessDate: string | null; completedSessionId: string | null;
  cancelledAt?: string | null; voidedAt?: string | null; endReason?: { code: string; note?: string; approvalGrantId?: string } | null;
  version: number; label?: string; note?: string; checkNo: number;
  fireMode: 'EXPLICIT_ROUNDS' | 'AT_CONFIRM' | null; rounds: FireRound[];
  lines: OrderLine[]; discounts: OrderDiscount[]; comp: { reasonCode: string; reason?: string; at: string; by: string } | null;
  policy: PolicySnapshot; service: ServiceCapture | null; confirmation: Totals | null;
  history: HistoryEntry[]; customerName?: string; guestCount?: number;
  // crm area (types-crm.ts): customer snapshot, delivery and online-order links
  customerId?: string | null; customerPhone?: string | null; deliveryId?: string | null; externalOrderId?: string | null;
}

export interface KitchenStation { id: string; branchId: string; name: string; active: boolean; version: number; targetMinutes?: number }
export interface RoutingRule { id: string; branchId: string; priority: number; match: { productId?: string; categoryId?: string; channel?: Channel }; stationId: string; destination: 'STATION' | 'NO_TICKET'; active: boolean; version: number }
export type KitchenState = 'NEW' | 'IN_PROGRESS' | 'READY' | 'DONE';
export interface KitchenTicketItem { lineId: string; name: Loc; quantity: string; modifiers: Loc[]; note?: string; status: 'ACTIVE' | 'CANCELLED'; allergens?: string[]; children?: string[]; seat?: number | null; mods?: { at: string; text: string }[] }
export interface KitchenTicket {
  id: string; orderId: string; orderNumber: string; tableName: string | null; channel: Channel; round: number; stationId: string;
  state: KitchenState; items: KitchenTicketItem[]; createdAt: string; createdAtMs: number; startedAt: string | null; readyAt: string | null; doneAt: string | null; version: number; serverName: string;
}
export interface KitchenDelivery { id: string; orderId: string; round: number; state: 'PENDING' | 'DELIVERED' | 'FAILED'; attempts: number; lastError: string | null; createdAt: string; deliveredAt: string | null; ticketIds: string[]; nextAt: number }

export interface Session {
  id: string; terminalId: string; branchId: string; userId: string; state: 'OPEN' | 'CLOSED'; openingFloat: Money;
  openedAt: string; openedAtMs: number; businessDate: string; closedAt: string | null; closedBy: string | null; version: number;
  close: { countedCash: Money; expectedCash: Money; variance: Money; approvalGrantId?: string; reason?: string; z: ZReport } | null;
}
export interface CashEntry { id: string; sessionId: string; kind: 'OPENING_FLOAT' | 'TENDER_IN' | 'REFUND_OUT' | 'PAY_IN' | 'PAY_OUT' | 'SAFE_DROP' | 'NO_SALE' | 'TIP_IN' | 'TIP_OUT' | 'DEPOSIT_IN' | 'TENDER_CORRECTION_IN' | 'TENDER_CORRECTION_OUT'; amount: Money; at: string; by: string; reasonCode?: string; reason?: string; ref?: string; approvalGrantId?: string }
export interface ZReport {
  sessionId: string; terminalCode: string; cashierName: string; openedAt: string; closedAt: string; businessDate: string;
  openingFloat: Money; tenderBreakdown: Record<string, Money>; refundBreakdown: Record<string, Money>; cashByKind: Record<string, Money>;
  expectedCash: Money; countedCash: Money; variance: Money; orderCounts: Record<string, number>; outstandingChecks: { orderId: string; number: string; payable: Money; table: string | null }[];
  tips: Money; snapshotAt: string;
}
export interface Capture {
  id: string; orderId: string; method: TenderMethod; amount: Money; tendered: Money | null; change: Money; reference: string | null; walletProvider?: string | null;
  sessionId: string; terminalId: string; branchId: string; at: string; atMs: number; businessDate: string; by: string; commandId: string; tip: Money; corrected?: boolean; rounding?: Money; correctionOf?: string | null; depositId?: string | null;
}
export interface RefundCase {
  id: string; orderId: string; amount: Money; method: TenderMethod; reasonCode: string; reason: string; state: 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED';
  allocations: { captureId: string; amount: Money }[]; lines: { lineId: string; quantity: string }[]; requestedBy: string; requestedAt: string;
  decidedBy?: string; decidedAt?: string; paidAt?: string; paidSessionId?: string; businessDate?: string; version: number; approvalGrantId?: string;
}
export interface ApprovalGrant {
  id: string; action: string; targetType: string; targetId: string; context: Record<string, unknown>; contextHash: string;
  requesterUserId: string; approverUserId: string; branchId: string | null; terminalId: string | null;
  issuedAt: string; expiresAtMs: number; consumedAt: string | null; consumedBy: string | null; reason?: string;
}
export interface ReasonCode { id: string; kind: string; code: string; label: Loc; requiresNote: boolean; sortOrder: number; active: boolean; version: number }
export interface PolicyValue { id: string; policyId: string; scopeType: ScopeType; scopeId: string; value: unknown; version: number; updatedAt: string; updatedBy: string; source: string }
export interface PolicyHistory { id: string; policyId: string; scopeType: ScopeType; scopeId: string; oldValue: unknown; newValue: unknown; at: string; by: string; via: 'PANEL' | 'SETTINGS' | 'SEED' | 'PROFILE'; note?: string }

export type PrintState = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'DEAD';
export interface PrintJob { id: string; documentType: 'RECEIPT' | 'KITCHEN_TICKET' | 'PRE_BILL' | 'X_REPORT' | 'Z_REPORT' | 'FISCAL_DOCUMENT'; documentId: string; copyKind: 'ORIGINAL' | 'REPRINT'; terminalId: string; state: PrintState; attempts: { at: string; error: string | null }[]; nextAtMs: number; createdAt: string; createdBy: string; label: string; reason?: string }

export interface FiscalProfile { branchId: string; adapter: 'EG_ETA'; issuerId: string; issuerName: string; issuerBranchCode: string; activityCode: string; receiptType: string; address: { governate: string; city: string; street: string; buildingNumber: string }; version: number }
export interface FiscalDevice { id: string; terminalId: string; adapter: 'EG_ETA'; deviceSerial: string; credentialRef: string; state: 'ACTIVE' | 'SUSPENDED'; lastSequence: number; lastDocumentHash: string | null; version: number }
export interface FiscalItemMapping { productId: string; codeType: 'EGS' | 'GS1'; itemCode: string; unitType: string }
export type FiscalState = 'PENDING_DATA' | 'BUILT' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';
export interface FiscalDocument {
  id: string; orderId: string; orderNumber: string; branchId: string; terminalId: string; deviceId: string | null; documentType: 'RECEIPT' | 'RETURN_RECEIPT';
  state: FiscalState; issues: { code: string; detail: string }[]; uuid: string | null; previousUUID: string | null; referenceOldUUID: string | null; sequence: number | null;
  createdAt: string; createdAtMs: number; builtAt: string | null; submittedAt: string | null; acceptedAt: string | null; rejectedReason: string | null; attempts: number; mode: 'SANDBOX' | 'PRODUCTION'; total: Money; history: HistoryEntry[]; nextTryAtMs?: number;
}
export interface Promotion {
  id: string; name: Loc; kind: 'CODED' | 'AUTOMATIC'; code: string | null; benefitType: 'PERCENTAGE' | 'FIXED_AMOUNT'; benefitValue: string;
  branchIds: string[]; channels: Channel[]; minSubtotal: Money | null; schedule: { days: number[]; start: string; end: string } | null;
  validFrom: number | null; validTo: number | null; active: boolean; version: number;
}
export interface AuditEntry { id: string; at: string; userId: string | null; terminalId: string | null; op: string; target: string; sensitive: boolean; summary: string; commandId?: string; approvalGrantId?: string }
export interface Idem { opId: string; hash: string; status: number; body: unknown; at: string; userId: string | null }
export interface Alert { id: string; at: string; kind: string; severity: 'info' | 'warning' | 'error'; text: Loc; ref?: string; ack: boolean }

// direction (مقترح)
export interface Deposit { id: string; branchId: string; customer: string; phone?: string; amount: Money; method: TenderMethod; reference?: string; purpose: 'BOOKING' | 'PRE_ORDER' | 'CAKE'; state: 'HELD' | 'APPLIED' | 'REFUNDED' | 'FORFEITED'; reservationId?: string; appliedOrderId?: string; createdAt: string; sessionId: string | null; by: string }
export interface Reservation { id: string; branchId: string; customer: string; phone: string; partySize: number; at: string; tableId: string | null; depositId: string | null; noShowFee: Money; state: 'BOOKED' | 'SEATED' | 'NO_SHOW' | 'CANCELLED'; createdAt: string; visitId?: string | null }
export interface TipEntry { id: string; captureId: string; orderId: string; amount: Money; method: TenderMethod; serverUserId: string; sessionId: string; at: string; businessDate: string; distributed: boolean }

export interface DB extends CrmCollections {
  schema: number;
  seq: Record<string, number>;
  business: Business;
  branches: Branch[];
  terminals: Terminal[];
  roles: Role[];
  users: User[];
  authSessions: AuthSession[];
  units: Unit[];
  categories: Category[];
  modifierGroups: ModifierGroup[];
  products: Product[];
  availability: Availability[];
  priceRules: PriceRule[];
  taxPolicies: TaxPolicy[];
  tables: Table[];
  visits: TableVisit[];
  orders: Order[];
  stations: KitchenStation[];
  routingRules: RoutingRule[];
  tickets: KitchenTicket[];
  kitchenDeliveries: KitchenDelivery[];
  sessions: Session[];
  cashEntries: CashEntry[];
  captures: Capture[];
  refunds: RefundCase[];
  grants: ApprovalGrant[];
  reasonCodes: ReasonCode[];
  policyValues: PolicyValue[];
  policyHistory: PolicyHistory[];
  printJobs: PrintJob[];
  fiscalProfiles: FiscalProfile[];
  fiscalDevices: FiscalDevice[];
  itemMappings: FiscalItemMapping[];
  fiscalDocuments: FiscalDocument[];
  promotions: Promotion[];
  audit: AuditEntry[];
  idem: Record<string, Idem>;
  alerts: Alert[];
  deposits: Deposit[];
  reservations: Reservation[];
  tips: TipEntry[];
  events: { id: string; at: string; type: string; ref: string; text: string }[];
  // inventory & purchasing area (types-inventory.ts) — optional, read through invOf(db)
  inv?: import('./types-inventory').InventoryState;
  // menu & pricing area (menu-types.ts) — optional, read through menuState(db)
  menu?: import('./menu-types').MenuState;
  // operations & system area (types-ops.ts) — optional, always read with a default
  floors?: import('./types-ops').FloorPlan[];
  tableLayouts?: import('./types-ops').TableLayout[];
  tableTurns?: import('./types-ops').TableTurn[];
  ticketMeta?: import('./types-ops').TicketMeta[];
  approvalRequests?: import('./types-ops').ApprovalRequestRec[];
  offlineItems?: import('./types-ops').OfflineItem[];
  syncTerminals?: import('./types-ops').SyncTerminalState[];
  webhookDeliveries?: import('./types-ops').WebhookDelivery[];
  reconRuns?: import('./types-ops').ReconRun[];
  reconResults?: import('./types-ops').ReconResult[];
  settlementBatches?: import('./types-ops').SettlementBatch[];
  businessDays?: import('./types-ops').BusinessDayRec[];
  salesHistory?: import('./types-ops').SalesHistoryDay[];
  reportSchedules?: import('./types-ops').ReportSchedule[];
  reportExports?: import('./types-ops').ReportExport[];
  capabilities?: import('./types-ops').CapabilityState[];
}
