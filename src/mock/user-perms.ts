// Per-user permission overrides (P1-041): effective permissions = role permissions ± the user's own grants/revocations.
// Expired or removed overrides are ignored. A revocation on a '*' holder is kept as a '-perm' marker (see hasPermission).
import { clock } from './clock';
import type { DB, User } from './types';
import type { PermOverride } from './types-channels';

export const permOverridesOf = (db: DB): PermOverride[] => (db.permOverrides ??= []);
export const overrideLive = (o: PermOverride, now: number) => !o.removedAt && (o.expiresAtMs === null || o.expiresAtMs > now);

export function applyUserOverrides(db: DB, user: User, out: Set<string>, now = clock.now()): Set<string> {
  for (const o of db.permOverrides ?? []) {
    if (o.userId !== user.id || !overrideLive(o, now)) continue;
    if (o.effect === 'GRANT') { out.add(o.permission); out.delete('-' + o.permission); }
    else { out.delete(o.permission); out.add('-' + o.permission); }
  }
  return out;
}
