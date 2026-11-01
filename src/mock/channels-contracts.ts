// Proposed operations: sales channels as records (E13) and per-user permission overrides (P1-041).
// Named in the contract style; listed in the agent report for PROTOTYPE_GAPS.md and badged مقترح in the UI.
import type { OperationDef } from './contracts';

const op = (id: string, module: string, kind: 'CMD' | 'QRY', method: string, path: string, permission: string, note: string, errors: string[] = []): OperationDef => ({
  id, module, kind, method, path, permission, input: {}, output: null, errors, approval: null, backend_state: 'PROPOSED', note,
});

export const CHANNELS_PROPOSED_OPERATIONS: OperationDef[] = [
  op('SalesChannel.List', 'catalog', 'QRY', 'GET', '/sales-channels', 'AUTHENTICATED', 'Sales channels (صالة، تيك أواي، دليفري، طلبات…): order type, price list mode, colour, active; every device needs them to start an order'),
  op('SalesChannel.Upsert', 'catalog', 'CMD', 'PUT', '/sales-channels/{salesChannelId}', 'saleschannel:manage', 'Create or change a sales channel: name, order type (fixed after the first order), own prices or follow another channel ± %, colour, order, active; audited', ['VALIDATION_FAILED', 'SALES_CHANNEL_NAME_TAKEN', 'SALES_CHANNEL_NOT_FOUND', 'CONCURRENCY_CONFLICT']),
  op('User.PermissionOverrides', 'access', 'QRY', 'GET', '/users/{userId}/permission-overrides', 'user:read', 'Role permissions, per-user grants/revocations (with expiry) and the effective result for one user'),
  op('User.SetPermissionOverride', 'access', 'CMD', 'POST', '/users/{userId}/permission-overrides', 'user:manageaccess', 'Grant a permission to one user on top of the role, or take one away from them; optional expiry; USER_ACCESS_CHANGE approval by policy; audited', ['USER_NOT_FOUND', 'UNKNOWN_PERMISSION_ID', 'PERMISSION_ESCALATION', 'VENDOR_ONLY_PERMISSION', 'SELF_PERMISSION_CHANGE']),
  op('User.RemovePermissionOverride', 'access', 'CMD', 'POST', '/users/{userId}/permission-overrides/{overrideId}/remove', 'user:manageaccess', 'End a per-user grant/revocation (the user goes back to the role); audited', ['USER_NOT_FOUND', 'PERMISSION_OVERRIDE_NOT_FOUND', 'SELF_PERMISSION_CHANGE']),
];
