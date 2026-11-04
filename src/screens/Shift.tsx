// E1–E3 shift history: every drawer shift of the branch with its count difference, and the Z report of a closed shift
// (frozen at close). ux-10: read only on every device — opening, cash moves, no-sale, X and the blind count that closes a
// shift are popups over the sale screen (src/screens/cashier/DrawerPopups.tsx), so there is no open / close flow here.
import React, { useState } from 'react';
import { FileText, Clock, History } from 'lucide-react';
import { useDev, useQuery } from '../app/hooks';
import { PageHeader, Card, Button, Table, Pill, EmptyState, DateTime } from '../ui';
import { t } from '../i18n';
import { deviceName, personName, personText } from '../demo/people';
import { VarianceText, ZPopup } from './cashier/ShiftReport';

export default function Shift() {
  const { can } = useDev();
  const canZ = can('session:zreport');
  const past = useQuery<any>('Session.Find', { query: { limit: 30 } });
  const [z, setZ] = useState<string | null>(null);
  return (
    <div data-screen="E1–E3" className="space-y-4">
      <PageHeader title={t('الوردية والدرج')} ops={['Session.Find', 'Session.ZReport']} />
      <Card title={<span className="flex items-center gap-2"><History className="w-4 h-4" />{t('الورديات')}</span>} padding="none">
        <Table align={['start', 'start', 'start', 'start', 'start', 'end', 'end']} loading={past.loading} maxHeight={560}
          head={[t('الجهاز'), t('الكاشير'), t('الحالة'), t('فتحت'), t('اتقفلت'), t('فرق العد'), '']}
          rows={(past.data?.items ?? []).map((s: any) => [
            deviceName(s.terminalId), personName(null, personText(s.cashierName)), <Pill tone={s.state === 'OPEN' ? 'success' : 'neutral'} dot>{s.state === 'OPEN' ? t('مفتوحة') : t('مقفولة')}</Pill>, <DateTime v={s.openedAt} className="text-xs" />, <span className="text-xs">{s.closedAt ? <DateTime v={s.closedAt} /> : '—'}</span>,
            s.close ? <VarianceText v={s.close.variance} /> : <span className="text-dim">—</span>,
            s.state === 'CLOSED' && canZ ? <Button size="sm" variant="ghost" onClick={() => setZ(s.id)} data-fb={`z-open:${s.id}`}><FileText className="w-3.5 h-3.5" />{t('تقرير Z')}</Button> : null,
          ])} empty={<EmptyState compact icon={<Clock />} title={t('لا توجد ورديات')} />} />
      </Card>
      {z && <ZPopup sid={z} onClose={() => setZ(null)} />}
    </div>
  );
}
