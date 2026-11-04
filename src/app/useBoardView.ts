// ux-05: board or list view of a screen for the signed-in person. The first default comes from the work profile;
// after a switch the person's own choice is remembered (per user, per board).
import { useMemo } from 'react';
import { useDev } from './hooks';
import { profileFor, type BoardId } from './profiles';
import { useBoardPrefs, type BoardView } from '../ui/board';

export function useBoardView(board: BoardId): { view: BoardView; setView: (v: BoardView) => void; userId: string | null } {
  const { me, terminal } = useDev();
  const userId: string | null = me?.user?.id ?? null;
  const profile = useMemo(() => profileFor((me?.user?.roleAssignments ?? []).map((r: any) => String(r.roleName ?? '')), terminal?.kind ?? null), [me, terminal]);
  const [prefs, set] = useBoardPrefs(userId, board);
  return { view: prefs.view ?? profile.boards?.[board] ?? 'board', setView: (v) => set({ view: v }), userId };
}
