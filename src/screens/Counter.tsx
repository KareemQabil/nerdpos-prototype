// C2 — the sale screen: counter / takeaway sale and collecting dine-in checks (src/screens/cashier). Pay first at
// the counter (items fire when the check is confirmed by the first payment). Also opens the staff meal (D9): the old
// «staffmeal» route redirects here with ?staffMeal=1 (ux-07).
// ux-10: the drawer's work (open the shift, cash moves, no-sale, X, the blind count that closes the shift) is a set of
// popups over this screen (DrawerHost); with no shift open the screen shows one call to action. Never another route.
import React from 'react';
import { useDev, useQuery } from '../app/hooks';
import { Skeleton } from '../ui';
import { CashierScreen, NoDrawer } from './cashier/Cashier';
import { DrawerHost, NoShiftCta } from './cashier/DrawerPopups';

export default function Counter() {
  const { terminal, params } = useDev();
  const session = useQuery<any>(terminal?.drawer ? 'Session.Current' : null, { query: { terminalId: terminal?.id } });
  if (!terminal?.drawer) return <div data-screen="C2"><NoDrawer /></div>;
  // a refused re-read keeps the last data in useQuery: «no open session» after a close means no shift
  const open = session.error?.code === 'SESSION_NOT_FOUND' ? null : session.data ?? null;
  const body = session.loading && !session.data ? <Skeleton className="h-64 rounded-2xl" />
    : !open ? <div data-screen="C2" data-fb="no-shift" className="h-full flex items-center justify-center"><NoShiftCta /></div>
    : <CashierScreen sessionId={open.id} businessDate={open.businessDate ?? null} staffMealOnOpen={params.staffMeal === '1'} />;
  // the host keeps its place in the tree whatever the body is, so a closing count stays on screen after the close
  return <>{body}<DrawerHost session={open} /></>;
}
