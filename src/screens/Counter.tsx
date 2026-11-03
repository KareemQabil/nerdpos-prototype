// C2 — the sale screen: counter / takeaway sale and collecting dine-in checks (src/screens/cashier). Pay first at
// the counter (items fire when the check is confirmed by the first payment). Also opens the staff meal (D9).
import React from 'react';
import { useDev, useQuery } from '../app/hooks';
import { Skeleton } from '../ui';
import { CashierScreen, NoDrawer, NoShift } from './cashier/Cashier';

export default function Counter() {
  const { terminal, nav, screen } = useDev();
  const session = useQuery<any>(terminal?.drawer ? 'Session.Current' : null, { query: { terminalId: terminal?.id } });
  if (!terminal?.drawer) return <div data-screen="C2"><NoDrawer /></div>;
  if (session.loading && !session.data) return <Skeleton className="h-64 rounded-2xl" />;
  if (!session.data) return <div data-screen="C2" className="h-full flex items-center justify-center"><NoShift onOpen={() => nav('shift')} /></div>;
  return <CashierScreen sessionId={session.data.id} businessDate={session.data.businessDate ?? null} staffMealOnOpen={screen === 'staffmeal'} />;
}
