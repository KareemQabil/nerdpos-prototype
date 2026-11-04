// ux-09: the work profile of the person signed in on this device — from the role, or the user's override
// (User.SetProfile). Every screen that reads the profile (sidenav, start screen, sale screen bar and keys, kitchen
// keys, board views) uses this one resolution.
import { useMemo } from 'react';
import { useDev } from './hooks';
import { resolveProfile, type Profile } from './profiles';
import { screenById } from './registry';

/** Whether a device kind has a screen (registry kinds). */
export const kindHasScreen = (kind: string, screenId: string) => !!screenById.get(screenId)?.kinds.includes(kind as any);

/** The profile of a user (Access.Me / Auth.Login user view) on a device kind. */
export const profileOfUser = (user: any, kind: string) => resolveProfile(user, kind === 'BO' ? null : kind, (sid) => kindHasScreen(kind, sid));

/** The signed-in person's profile on this device. `asKind` reads it as another device kind (the kitchen screen on the
 *  office PC works like a kitchen screen). */
export function useProfile(asKind?: string): Profile {
  const { me, kind } = useDev();
  const k = asKind ?? kind;
  return useMemo(() => profileOfUser(me?.user ?? null, k), [me, k]);
}
