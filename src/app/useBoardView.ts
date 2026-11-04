// ux-05: board or list view of a screen for the signed-in person. The first default comes from the work profile;
// after a switch the person's own choice is remembered (per user, per board).
import { useDev } from './hooks';
import { type BoardId } from './profiles';
import { useProfile } from './useProfile';
import { useBoardPrefs, type BoardView } from '../ui/board';

export function useBoardView(board: BoardId): { view: BoardView; setView: (v: BoardView) => void; userId: string | null } {
  const { me } = useDev();
  const userId: string | null = me?.user?.id ?? null;
  const profile = useProfile();
  const [prefs, set] = useBoardPrefs(userId, board);
  return { view: prefs.view ?? profile.boards?.[board] ?? 'board', setView: (v) => set({ view: v }), userId };
}
