// E1–E3 shift history: every drawer shift of the branch with its count difference, and the Z report of a closed shift
// (frozen at close). ux-10: read only on every device — opening, cash moves, no-sale, X and the blind count that closes a
// shift are popups over the sale screen (src/screens/cashier/DrawerPopups.tsx), so there is no open / close flow here.
import React, { useState } from 'react';
import { FileText, Clock, History, Repeat } from 'lucide-react';
import { useDev, useQuery } from '../app/hooks';
import { PageHeader, Card, Button, DataTable, cols, DensityToggle, EmptyState } from '../ui';
import { t } from '../i18n';
import { deviceName, personName, personText } from '../demo/people';
import { VarianceText, ZPopup } from './cashier/ShiftReport';
import { useHandoverDetails } from './cashier/HandoverPopups'; // ux-10b: handover links and both counts

export default function Shift() {
  const { can } = useDev();
  const canZ = can('session:zreport');
  const past = useQuery<any>('Session.Find', { query: { limit: 30 } });
  const [z, setZ] = useState<string | null>(null);
  const hd = useHandoverDetails();
  const C = cols<any>();
  const handoverCell = (s: any) => (
    <span className="inline-flex flex-col items-start gap-0.5">
      {s.handoverFrom && <button type="button" onClick={() => hd.open(s.handoverFrom)} className="text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1" data-fb={`handover-open:${s.handoverFrom.id}:in`}><Repeat className="w-3 h-3" />{t('استلمها من {n}', { n: personName(null, personText(s.handoverFrom.outgoingName ?? '')) })}</button>}
      {s.handover && <button type="button" onClick={() => hd.open(s.handover)} className="text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1" data-fb={`handover-open:${s.handover.id}`}><Repeat className="w-3 h-3" />{s.handover.state === 'PENDING' ? t('بانتظار الاستلام') : t('سلّمها إلى {n}', { n: personName(null, personText(s.handover.incomingName ?? '')) })}</button>}
      {!s.handover && !s.handoverFrom && <span className="text-dim">—</span>}
    </span>
  );
  return (
    <div data-screen="E1–E3" className="space-y-4">
      <PageHeader title={t('الوردية والدرج')} ops={['Session.Find', 'Session.ZReport']} />
      <Card title={<span className="flex items-center gap-2"><History className="w-4 h-4" />{t('الورديات')}</span>} padding="none" actions={<DensityToggle />}>
        <DataTable rows={past.data?.items ?? []} rowKey={(s: any) => s.id} loading={past.loading} maxHeight={560} label={t('الورديات')} defaultSort={{ id: 'opened', dir: 'desc' }}
          columns={[
            C.text('device', t('الجهاز'), (s) => deviceName(s.terminalId), { maxChars: 20 }),
            C.text('cashier', t('الكاشير'), (s) => personName(null, personText(s.cashierName)), { maxChars: 20 }),
            C.status('state', t('الحالة'), (s) => ({ label: s.state === 'OPEN' ? t('مفتوحة') : s.state === 'HANDOVER_PENDING' ? t('بانتظار الاستلام') : t('مقفولة'), tone: s.state === 'OPEN' ? 'success' : s.state === 'HANDOVER_PENDING' ? 'warning' : 'neutral' })),
            C.date('opened', t('فتحت'), (s) => s.openedAt),
            C.date('closed', t('اتقفلت'), (s) => s.closedAt),
            C.custom('handover', t('التسليم'), handoverCell),
            C.money('variance', t('فرق العد'), (s) => s.close?.variance, { cell: (s) => s.close ? <VarianceText v={s.close.variance} /> : <span className="text-dim">—</span> }),
            C.actions('z', (s) => s.state === 'CLOSED' && canZ ? <Button size="sm" variant="ghost" onClick={() => setZ(s.id)} data-fb={`z-open:${s.id}`}><FileText className="w-3.5 h-3.5" />{t('تقرير Z')}</Button> : null),
          ]}
          empty={<EmptyState compact icon={<Clock />} title={t('لا توجد ورديات')} />} />
      </Card>
      {z && <ZPopup sid={z} onClose={() => setZ(null)} />}
      {hd.node}
    </div>
  );
}
