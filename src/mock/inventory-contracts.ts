// Inventory & purchasing operations the prototype needs that are not in operations.json (listed in the report for
// PROTOTYPE_GAPS.md and badged مقترح in the UI).
import type { OperationDef } from './contracts';

export const INVENTORY_PROPOSED_OPERATIONS: OperationDef[] = [
  {
    id: 'InventoryItem.Find', module: 'inventory', kind: 'QRY', method: 'GET', path: '/inventory/items', permission: 'inventory:read',
    input: { text: { type: 'Text', required: false }, category: { type: 'Text', required: false }, kind: { type: 'Code', required: false }, warehouseId: { type: 'Ref<warehouses.Warehouse>', required: false }, branchId: { type: 'Ref<organization.Branch>', required: false }, state: { type: 'Code', required: false }, active: { type: 'Boolean', required: false }, cursor: { type: 'Cursor', required: false }, limit: { type: 'Integer', required: false } },
    output: 'Page<InventoryItemView{stock,value,state}>', errors: ['WAREHOUSE_NOT_FOUND'], approval: null, backend_state: 'PROPOSED',
    note: 'INV-GAP-01: the contract has InventoryItem.Get and Inventory.OnHand(item, warehouse) but no list of items',
  },
  {
    id: 'Inventory.Dashboard', module: 'inventory', kind: 'QRY', method: 'GET', path: '/inventory/dashboard', permission: 'inventory:read',
    input: { branchId: { type: 'Ref<organization.Branch>', required: false } },
    output: 'InventoryDashboardView', errors: [], approval: null, backend_state: 'PROPOSED',
    note: 'INV-GAP-02: one read for the stock overview (value, low stock, expiry, consumption, waste, count variance, food cost)',
  },
];
