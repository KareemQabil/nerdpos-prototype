// Inventory & purchasing records of the mock server (one optional `inv` key on the DB).
// Quantities are decimal strings in the item's stock unit; money is scale-4 strings. Never floating point.
import type { Money } from './money';
import type { Loc } from './types';

export type MovementKind =
  | 'OPENING' | 'RECEIPT' | 'RECEIPT_REVERSAL' | 'SALE' | 'SALE_REVERSAL' | 'VOID_WASTE' | 'WASTE' | 'ADJUSTMENT' | 'COUNT_VARIANCE'
  | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'PRODUCTION_IN' | 'PRODUCTION_OUT' | 'SUPPLIER_RETURN' | 'CUSTOMER_RETURN';

export type WasteReason = 'BURNT' | 'EXPIRED' | 'DROPPED' | 'SPOILED' | 'PREP_ERROR' | 'OVER_PRODUCTION' | 'OTHER';
export type AdjustmentReason = 'FOUND' | 'LOST' | 'DAMAGED' | 'CORRECTION' | 'OPENING' | 'STAFF_USE' | 'TASTING' | 'OTHER';

export interface Warehouse {
  id: string; branchId: string; name: string; kind: 'STORE' | 'KITCHEN' | 'BAR'; active: boolean; salesDefault: boolean;
  version: number; createdAt: string; history: { at: string; by: string; text: string }[];
}

/** A purchase/count pack of an item, e.g. "شيكارة 25 كجم" = 25 stock units. */
export interface InvPack { id: string; name: Loc; factor: string }

export interface InvLevel { min: string; par: string }

export interface InvItem {
  id: string;
  /** Contract: Ref<catalog.Product>. Stock-only ingredients point at themselves (they never appear on the menu). */
  productId: string;
  sku: string; name: Loc; category: string; kind: 'RAW' | 'PREP' | 'RESALE';
  stockUnitId: string; packs: InvPack[]; purchasePackId: string | null;
  allowNegative: boolean | null; active: boolean; trackLots: boolean; shelfLifeDays: number | null; defaultSupplierId: string | null;
  avgCost: Money; lastCost: Money;
  costHistory: { at: string; avgCost: Money; unitCost: Money; source: string; ref: string }[];
  levels: Record<string, InvLevel>; // warehouseId → min / par
  version: number; createdAt: string;
}

export interface InvBalance { itemId: string; warehouseId: string; quantity: string; version: number; updatedAt: string }

export interface InvLot {
  id: string; itemId: string; warehouseId: string; lotCode: string; expiryDate: string | null; receivedAt: string;
  initialQty: string; remaining: string; unitCost: Money; sourceRef: string | null;
}

export interface MovementSource { module: string; command: string; id: string; number?: string; orderId?: string; lineId?: string; label?: string }

export interface StockMovement {
  id: string; seq: number; at: string; atMs: number; businessDate: string;
  itemId: string; warehouseId: string; kind: MovementKind;
  quantity: string; unitCost: Money; value: Money; balanceAfter: string; avgCostAfter: Money;
  reason: string | null; note: string | null; userId: string | null;
  source: MovementSource; lots: { lotId: string; lotCode: string; expiryDate: string | null; quantity: string }[];
  commandId: string | null; approvalGrantId: string | null; negative?: boolean;
}

export type StockCountState = 'DRAFT' | 'SUBMITTED' | 'POSTED' | 'CANCELLED';
export interface StockCountLine {
  itemId: string; baselineQty: string; baselineSeq: number; countedQty: string | null; countedBy: string | null; countedAt: string | null;
  expectedQty?: string; varianceQty?: string; varianceValue?: Money; unitCost?: Money;
}
export interface StockCount {
  id: string; number: string; warehouseId: string; state: StockCountState; lines: StockCountLine[];
  startedAt: string; startedBy: string; submittedAt: string | null; submittedBy: string | null; postedAt: string | null; postedBy: string | null;
  cancelledAt: string | null; cancelReason: string | null; varianceValue: Money | null; approvalGrantId: string | null; version: number; note: string | null;
  counters: string[];
}

export type TransferState = 'DRAFT' | 'DISPATCHED' | 'RECEIVED' | 'CANCELLED';
export interface TransferLine {
  itemId: string; quantity: string; unitCost: Money | null; receivedQuantity: string | null; shortQuantity: string | null;
  lots: { lotCode: string; expiryDate: string | null; quantity: string }[];
}
export interface Transfer {
  id: string; number: string; fromWarehouseId: string; toWarehouseId: string; state: TransferState; lines: TransferLine[]; note: string | null;
  createdAt: string; createdBy: string; dispatchedAt: string | null; dispatchedBy: string | null; receivedAt: string | null; receivedBy: string | null;
  cancelledAt: string | null; cancelReason: string | null; version: number; shortValue: Money | null;
}

export interface WasteRecord {
  id: string; number: string; at: string; businessDate: string; warehouseId: string; itemId: string; itemKind: 'ITEM' | 'PRODUCT'; name: Loc;
  quantity: string; reason: WasteReason; note: string | null; sourceType: string; sourceId: string | null; value: Money; movementIds: string[];
  userId: string | null; approvalGrantId: string | null;
}

export interface RecipeInput { itemId: string; quantity: string; enteredQuantity: string; enteredUnit: string; wastePercent: string }
export interface RecipeVersion {
  id: string; version: number; effectiveFrom: string; inputsPerBatch: RecipeInput[]; outputQuantityPerBatch: string;
  createdAt: string; createdBy: string; note: string | null;
}
export interface Recipe {
  id: string; outputProductId: string; outputKind: 'MENU' | 'PREP' | 'MODIFIER'; modifierOptionId: string | null; appliesToProductId: string | null;
  name: Loc; activeVersionId: string; versions: RecipeVersion[]; createdAt: string; version: number;
}

export interface ProductionRun {
  id: string; number: string; at: string; businessDate: string; recipeId: string; recipeVersionId: string; warehouseId: string; outputItemId: string;
  plannedOutput: string; actualOutput: string; inputs: { itemId: string; planned: string; actual: string; unitCost: Money; value: Money }[];
  totalCost: Money; unitCost: Money; userId: string | null; movementIds: string[]; note: string | null; lotCode: string | null; expiryDate: string | null;
}

export interface Supplier {
  id: string; name: string; taxId: string | null; phone: string | null; contactName: string | null; paymentTerms: string | null; address: string | null;
  notes: string | null; active: boolean; version: number; createdAt: string;
}

export type PurchaseOrderState = 'DRAFT' | 'ISSUED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
export interface PurchaseOrderLine { id: string; itemId: string; packId: string | null; factor: string; orderedQuantity: string; orderedUnitCost: Money }
export interface PurchaseOrder {
  id: string; number: string; supplierId: string; warehouseId: string; branchId: string; state: PurchaseOrderState; lines: PurchaseOrderLine[];
  expectedDate: string | null; note: string | null; createdAt: string; createdBy: string; issuedAt: string | null; issuedBy: string | null;
  closedAt: string | null; closedBy: string | null; closeReason: string | null; cancelledAt: string | null; cancelReason: string | null; version: number;
  history: { at: string; by: string; text: string }[];
}

export interface GoodsReceiptLine {
  id: string; poLineId: string | null; itemId: string; packId: string | null; factor: string; packQuantity: string; quantity: string;
  packCost: Money; unitCost: Money; value: Money; lotCode: string | null; expiryDate: string | null;
}
export interface GoodsReceipt {
  id: string; number: string; supplierId: string; purchaseOrderId: string | null; warehouseId: string; state: 'POSTED' | 'REVERSED';
  supplierInvoiceNo: string | null; lines: GoodsReceiptLine[]; total: Money; at: string; businessDate: string; userId: string | null; note: string | null;
  reversal: { at: string; by: string; reason: string; approvalGrantId: string | null; movementIds: string[] } | null; movementIds: string[];
}

export interface SupplierReturn {
  id: string; number: string; supplierId: string; warehouseId: string; receiptId: string | null; lines: { itemId: string; quantity: string; unitCost: Money; value: Money }[];
  total: Money; reason: string; at: string; businessDate: string; userId: string | null; approvalGrantId: string | null; movementIds: string[];
}

export interface CustomerReturn {
  id: string; number: string; orderId: string; orderNumber: string; orderLineId: string; productId: string; name: Loc; quantity: string;
  disposition: 'RESTOCK' | 'DISCARD'; warehouseId: string | null; value: Money; at: string; userId: string | null; refundEntryId: string | null; movementIds: string[];
}

/** What the sales consumer has done for one order line (idempotent reconciliation). */
export interface OrderEffect {
  orderId: string; lineId: string; state: 'SALE' | 'WASTE' | 'NONE' | 'SKIPPED'; warehouseId: string | null; movementIds: string[]; at: string; note?: string;
}

export interface InventoryState {
  warehouses: Warehouse[];
  items: InvItem[];
  balances: InvBalance[];
  lots: InvLot[];
  movements: StockMovement[];
  counts: StockCount[];
  transfers: Transfer[];
  waste: WasteRecord[];
  recipes: Recipe[];
  production: ProductionRun[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  supplierReturns: SupplierReturn[];
  customerReturns: CustomerReturn[];
  orderEffects: Record<string, OrderEffect>;
  seq: number;
  numbers: Record<string, number>;
}
