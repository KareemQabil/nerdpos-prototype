// G1 Receipt preview: the ReceiptView (persisted snapshots only) rendered as an 80 mm Arabic thermal receipt.
// The browser formats server money; it never computes a total, tax or change.
import React, { useEffect, useState } from 'react';
import { ArrowRight, Copy, Printer, FileText } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { Section, StateBadge, Banner, Button, Empty, Spinner, Switch, Pill } from '../ui';
import { t, L } from '../i18n';
import { money, qty, dateTime, cn } from '../lib/format';
import { ReprintDialog, ReprintRuleNote } from './admin/output/ReprintDialog';
import { methodLabel, channelLabel, fiscalStateLabel } from './admin/output/labels';

const nz = (v: string | null | undefined) => !!v && !/^-?0(\.0+)?$/.test(v);
const pctText = (r: string | null | undefined) => (r ? `${qty(r)}%` : '');

function Row({ k, v, bold, big, strike, className, text }: { k: React.ReactNode; v: React.ReactNode; bold?: boolean; big?: boolean; strike?: boolean; className?: string; text?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-2', bold && 'font-bold', big && 'text-base', strike && 'line-through opacity-60', className)}>
      <span>{k}</span><span className={cn('whitespace-nowrap', !text && 'num')}>{v}</span>
    </div>
  );
}
const Rule = ({ dashed = true }: { dashed?: boolean }) => <div className={cn('my-2 border-t border-black/60', dashed && 'border-dashed')} />;

export default function ReceiptScreen() {
  const { params, nav, can, terminal } = useDev();
  const orderId: string | undefined = params.orderId;
  const prebill = !!params.prebill;
  const [copy, setCopy] = useState<boolean>(!!params.copy);
  useEffect(() => { setCopy(!!params.copy); }, [params.copy, orderId]);
  const [reprintOpen, setReprintOpen] = useState(false);
  const q = useQuery<any>(orderId ? 'Receipt.Get' : null, { params: { orderId } });
  const { run, busy } = useCommand();
  const r = q.data;

  if (!orderId) return (
    <div>
      <Section title={t('الإيصال')} badge={<StateBadge ops={['Receipt.Get', 'Print.Reprint']} />} />
      <Empty icon={<FileText className="w-8 h-8" />} text={t('اختار شيك من شاشة الشيكات عشان تشوف إيصاله')}><Button onClick={() => nav('checks')} data-fb="receipt:goto-checks">{t('الشيكات')}</Button></Empty>
    </div>
  );

  const tt = r?.totals;
  const completed = r?.status === 'COMPLETED';
  const isPrebill = prebill || (r && (r.status === 'DRAFT' || r.status === 'CONFIRMED'));
  const fiscal = r?.fiscal;

  return (
    <div className="space-y-4" data-screen-id="G1">
      <Section title={isPrebill ? t('شيك مبدئي') : t('الإيصال')} badge={<StateBadge ops={['Receipt.Get', 'Print.Reprint']} />}
        sub={t('الإيصال بيتبني من البيانات المحفوظة بس — مفيش أي حساب جديد. النسخة بيتكتب عليها "نسخة" ومش بتعمل إيصال جديد.')}
        actions={<>
          <Button size="sm" variant="ghost" onClick={() => nav('checks')} data-fb="receipt:back"><ArrowRight className="w-4 h-4 ltr:rotate-180" />{t('رجوع للشيكات')}</Button>
          {!isPrebill && <Switch checked={copy} onChange={setCopy} label={t('اعرض كنسخة')} />}
          {completed && !isPrebill && can('print:reprint') && <Button size="sm" variant="primary" onClick={() => setReprintOpen(true)} disabled={!terminal} title={terminal ? '' : t('الطباعة محتاجة جهاز')} data-fb="receipt:reprint"><Copy className="w-4 h-4" />{t('اطبع نسخة')}</Button>}
          {isPrebill && r && (r.status === 'DRAFT' || r.status === 'CONFIRMED') && terminal && <Button size="sm" variant="outline" loading={busy} onClick={() => run('Print.PreBill', { params: { orderId }, body: { terminalId: terminal.id } }, { success: t('الشيك المبدئي اتبعت للطابعة — الشيك ما اتغيرش') })} data-fb="receipt:prebill-print"><Printer className="w-4 h-4" />{t('اطبع شيك مبدئي')} <StateBadge state="PROPOSED" /></Button>}
        </>} />

      {q.loading && !r && <Spinner />}
      {q.error && <Banner tone="error">{q.error.code}</Banner>}
      {r && (
        <div className="flex flex-wrap gap-6 items-start">
          <div className="paper relative overflow-hidden rounded-md shadow-2xl px-4 py-5 text-[12px] leading-relaxed" style={{ width: '80mm', direction: 'rtl' }} data-fb="receipt:paper">
            {copy && !isPrebill && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
                <span className="font-black text-black/15 select-none" style={{ fontSize: 110, transform: 'rotate(-35deg)' }}>{t('نسخة')}</span>
              </div>
            )}
            <div className="text-center space-y-0.5">
              <div className="text-base font-bold">{r.business.nameAr || r.business.name}</div>
              {r.business.legalName && <div className="text-[11px]">{r.business.legalName}</div>}
              <div className="text-[11px]">{L(r.branch.name)} <span className="num">({r.branch.code})</span></div>
              {r.business.address && <div className="text-[11px]">{r.business.address}</div>}
              {r.business.taxNumber && <div className="text-[11px]">{t('رقم التسجيل الضريبي')}: <span className="num">{r.business.taxNumber}</span></div>}
            </div>
            <Rule />
            <div className="text-center font-bold text-[13px]">
              {isPrebill ? <><div>{t('ليست فاتورة ضريبية')}</div><div className="num text-[11px]">Not a tax receipt</div></> : t('إيصال بيع')}
              {copy && !isPrebill && <div className="text-[13px] border border-black inline-block px-2 mt-1">{t('نسخة')} / COPY</div>}
            </div>
            <Rule />
            <Row k={t('رقم الشيك')} v={<>{r.number}{r.checkNo > 1 ? ` / ${r.checkNo}` : ''}</>} />
            {r.table && <Row k={t('الطاولة')} v={r.table} text />}
            <Row k={t('القناة')} v={channelLabel(r.channel)} text />
            {r.server && <Row k={t('الويتر')} v={r.server} text />}
            {r.cashier && <Row k={t('الكاشير')} v={r.cashier} text />}
            {r.completedAt && <Row k={t('التاريخ')} v={dateTime(r.completedAt)} text />}
            <Row k={t('اليوم التجاري')} v={r.businessDate} />
            <Rule />
            <div className="space-y-1">
              {r.lines.map((l: any) => (
                <div key={l.id} className={cn(l.voided && 'opacity-60')}>
                  <div className="flex justify-between gap-2">
                    <span className={cn(l.voided && 'line-through')}><span className="num">{qty(l.quantity)}×</span> {L(l.name)}{l.variant ? ` (${L(l.variant)})` : ''}</span>
                    <span className={cn('num whitespace-nowrap', l.voided && 'line-through')}>{money(l.lineTotal, false)}</span>
                  </div>
                  {l.voided && <div className="text-[11px] font-bold">— {t('ملغي')}</div>}
                  {(l.modifiers ?? []).length > 0 && <div className="text-[11px] ps-3">+ {l.modifiers.map((m: any) => L(m)).join('، ')}</div>}
                  {(l.children ?? []).length > 0 && <div className="text-[11px] ps-3">{l.children.map((c: any) => `${L(c.name)}${c.detail ? ' (' + L(c.detail) + ')' : ''}`).join('، ')}</div>}
                  {qty(l.quantity) !== '1' && !l.voided && <div className="text-[10px] ps-3 num">@ {money(l.unitTotal, false)}</div>}
                </div>
              ))}
            </div>
            <Rule />
            <Row k={t('إجمالي الأصناف')} v={money(tt.itemsSubtotal, false)} />
            {tt.comp && <Row k={t('ضيافة')} v={`-${money(tt.discountTotal, false)}`} />}
            {!tt.comp && nz(tt.itemDiscount) && <Row k={t('خصم')} v={`-${money(tt.itemDiscount, false)}`} />}
            {nz(tt.serviceCharge) && <Row k={`${t('خدمة')} ${pctText(tt.serviceRate)}`} v={money(tt.serviceCharge, false)} className="font-bold" />}
            {!tt.comp && nz(tt.serviceDiscount) && <Row k={t('خصم على الخدمة')} v={`-${money(tt.serviceDiscount, false)}`} />}
            {(tt.charges ?? []).map((c: any) => <Row key={c.id} k={L(c.label)} v={money(c.amount, false)} />)}
            {nz(tt.tableTax) && <Row k={t('ضريبة الطاولة')} v={money(tt.tableTax, false)} />}
            {(tt.taxLines ?? []).length > 0 ? tt.taxLines.map((x: any, i: number) => <Row key={i} k={`${L(x.name) || t('ضريبة القيمة المضافة')} ${pctText(x.rate)}`} v={money(x.amount, false)} />)
              : nz(tt.tax) && <Row k={t('ضريبة القيمة المضافة')} v={money(tt.tax, false)} />}
            {!tt.comp && nz(tt.discountAfterTax) && <Row k={t('خصم بعد الضريبة')} v={`-${money(tt.discountAfterTax, false)}`} />}
            <Rule dashed={false} />
            <Row k={t('الإجمالي')} v={money(tt.payable)} bold big />
            <Rule />
            {(r.payments ?? []).length > 0 && (
              <div className="space-y-0.5">
                {r.payments.map((p: any, i: number) => (
                  <div key={i}>
                    <Row k={methodLabel(p.method + (p.walletProvider ? ':' + p.walletProvider : ''))} v={money(p.amount, false)} />
                    {p.tendered && <Row k={<span className="ps-3 text-[11px]">{t('المدفوع')}</span>} v={money(p.tendered, false)} />}
                    {p.change && nz(p.change) && <Row k={<span className="ps-3 text-[11px]">{t('الباقي للعميل')}</span>} v={money(p.change, false)} />}
                    {p.reference && <Row k={<span className="ps-3 text-[11px]">{t('مرجع الكارت')}</span>} v={p.reference} />}
                    {p.tip && nz(p.tip) && <Row k={<span className="ps-3 text-[11px]">{t('بقشيش')}</span>} v={money(p.tip, false)} />}
                  </div>
                ))}
              </div>
            )}
            {r.settlement && nz(r.settlement.remaining) && <Row k={t('المطلوب')} v={money(r.settlement.remaining)} bold />}
            {r.settlement && nz(r.settlement.refunded) && <Row k={t('اترجع')} v={`-${money(r.settlement.refunded, false)}`} />}
            {!isPrebill && (
              <>
                <Rule />
                <div className="text-center space-y-1" data-fb="receipt:qr">
                  <div className="text-[11px] font-bold">{t('الإيصال الإلكتروني')}{fiscal?.mode === 'SANDBOX' ? ' (SANDBOX)' : ''}</div>
                  {fiscal?.qr ? (
                    <>
                      <div className="flex justify-center"><QRCodeSVG value={fiscal.qr} size={128} level="M" bgColor="#fffef8" /></div>
                      <div className="num text-[9px] break-all">{fiscal.uuid}</div>
                    </>
                  ) : fiscal ? (
                    <div className="border border-dashed border-black/60 rounded px-2 py-3 text-[12px] font-bold">{fiscal.state === 'PENDING_DATA' ? t('مستني بيانات') : fiscalStateLabel(fiscal.state)}<div className="text-[10px] font-normal">{t('الـ QR هيظهر في النسخة بعد ما الإيصال يتبني')}</div></div>
                  ) : <div className="text-[11px]">{t('الإيصال الإلكتروني مش مفعّل (FiscalDocumentPolicy = OFF)')}</div>}
                  {r.serviceOffReceipt && <div className="text-[10px]">{t('الخدمة مش على الإيصال الإلكتروني لحد قرار المحاسب (OD-EG-4)')}</div>}
                </div>
              </>
            )}
            <Rule />
            <div className="text-center text-[11px]">{t('شكرًا لزيارتكم')}</div>
          </div>

          <div className="flex-1 min-w-[260px] space-y-3">
            <Banner tone="info">{t('ترتيب السطور: إجمالي الأصناف ← الخصم ← الخدمة ← ضريبة القيمة المضافة ← الإجمالي. الخدمة سطر لوحدها بين الإجمالي والضريبة.')}</Banner>
            {isPrebill && <Banner tone="warning">{t('الشيك المبدئي "ليست فاتورة ضريبية": مفيهوش QR، وطباعته مش بتغير الشيك ومش محتاجة موافقة.')}</Banner>}
            {fiscal && (
              <div className="glass rounded-xl p-3 text-sm space-y-1">
                <div className="flex items-center gap-2"><span className="font-bold">{t('حالة الإيصال الإلكتروني')}</span><Pill tone={fiscal.state === 'ACCEPTED' ? 'success' : fiscal.state === 'PENDING_DATA' || fiscal.state === 'REJECTED' ? 'warning' : 'info'}>{fiscalStateLabel(fiscal.state)}</Pill></div>
                {(fiscal.issues ?? []).map((i: any, k: number) => <div key={k} className="text-xs text-soft">• {i.detail} <span className="num text-dim">({i.code})</span></div>)}
                {can('compliance:read') && <Button size="sm" variant="ghost" onClick={() => nav('ereceipts')} data-fb="receipt:goto-ereceipts">{t('طابور الإيصالات الإلكترونية')}</Button>}
              </div>
            )}
            {completed && can('print:reprint') && <ReprintRuleNote />}
          </div>
        </div>
      )}

      {reprintOpen && r && <ReprintDialog job={{ documentType: 'RECEIPT', documentId: r.orderId, label: `${t('إيصال')} ${r.number}` }} terminalId={terminal?.id ?? null} onClose={() => setReprintOpen(false)} onDone={() => setCopy(true)} />}
    </div>
  );
}
