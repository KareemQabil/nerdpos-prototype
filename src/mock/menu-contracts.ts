// Proposed operations of the menu & pricing area (not in operations.json). Named in the contract style;
// listed in the agent report for PROTOTYPE_GAPS.md and badged مقترح in the UI.
import type { OperationDef } from './contracts';

const op = (id: string, kind: 'CMD' | 'QRY', method: string, path: string, permission: string, note: string, errors: string[] = []): OperationDef => ({
  id, module: 'catalog', kind, method, path, permission, input: {}, output: null, errors, approval: null, backend_state: 'PROPOSED', note,
});

export const MENU_PROPOSED_OPERATIONS: OperationDef[] = [
  op('Menu.Overview', 'QRY', 'GET', '/menus', 'catalog:read', 'Dayparts and channel/branch menus, with what is running now (mock clock)'),
  op('Menu.Upsert', 'CMD', 'PUT', '/menus/{menuId}', 'catalog:manage', 'Create or change a menu: channels, branches, dayparts, categories/products, exclusions', ['VALIDATION_FAILED', 'CONCURRENCY_CONFLICT']),
  op('Daypart.Upsert', 'CMD', 'PUT', '/dayparts/{daypartId}', 'catalog:manage', 'Create or change a daypart (breakfast/lunch/dinner), Cairo time, may cross midnight', ['VALIDATION_FAILED', 'CONCURRENCY_CONFLICT']),
  op('SoldOut.Board', 'QRY', 'GET', '/catalog/sold-out', 'catalog:read', 'What is sold out today in the caller branch (products and options) and when it resets'),
  op('ModifierOption.SetAvailability', 'CMD', 'POST', '/modifier-groups/{groupId}/options/{optionId}/availability', 'product:setavailability', 'Sold out today / back for one option in the caller branch', ['MODIFIER_OPTION_NOT_FOUND']),
  op('ModifierGroup.ReorderOptions', 'CMD', 'PUT', '/modifier-groups/{groupId}/options-order', 'catalog:manage', 'Display order of the options of a group', ['MODIFIER_DEFINITION_NOT_FOUND']),
  op('Product.SetCombo', 'CMD', 'PUT', '/catalog/products/{productId}/combo', 'catalog:manage', 'Combo choice groups: options with upgrade deltas, default, required, one sub-choice', ['CATALOG_PRODUCT_NOT_FOUND', 'VALIDATION_FAILED', 'CONCURRENCY_CONFLICT']),
  op('Product.SetHalfAndHalf', 'CMD', 'PUT', '/catalog/products/{productId}/half-and-half', 'catalog:manage', 'Allow half-and-half, its pairing group and half price ratio', ['CATALOG_PRODUCT_NOT_FOUND', 'VALIDATION_FAILED']),
  op('Catalog.PriceList', 'QRY', 'GET', '/catalog/prices', 'product:read', 'Every current and next price of a branch at once (products and sizes, per channel), with recipe cost when known'),
  op('Catalog.BulkPriceChange', 'CMD', 'POST', '/catalog/prices/bulk-change', 'catalog:setprice', 'Preview (dryRun) or apply a percent/fixed change with rounding by category/channel/branch, now or scheduled; one PRICE_CHANGE approval for the batch', ['VALIDATION_FAILED', 'PRICE_SCHEDULING_NOT_ALLOWED', 'APPROVAL_REQUIRED']),
  op('Catalog.PriceChangeBatches', 'QRY', 'GET', '/catalog/prices/bulk-change', 'catalog:setprice', 'History of bulk price changes (applied and scheduled)'),
];
