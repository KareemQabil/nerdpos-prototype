// G1 Receipt preview: the ReceiptView (persisted snapshots only) rendered as an 80 mm Arabic thermal receipt or an A4
// invoice page. The browser formats server money; it never computes a total, tax or change.
// Round 3: the venue template (logo, header/footer lines, paper — src/ui/doc), the short call-out number printed big
// next to the immutable transaction number (always printed), and second-language names only where the item has one.
import React, { useEffect, useState } from 'react';
import { ArrowRight, Copy, Printer, FileText } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useDev, useQuery, useCommand, errorText } from '../app/hooks';
import { Tech, useTech } from '../app/tech';
import { Section, StateBadge, Banner, Button, Empty, Skeleton, Switch, Pill, Money, DateTime } from '../ui';
import { t, L } from '../i18n';
import { money, qty, dateTime, cn } from '../lib/format';
import { ReprintDialog, ReprintRuleNote } from './admin/output/ReprintDialog';
import { methodLabel, channelLabel, fiscalStateLabel } from './admin/output/labels';
import { DocHeader, DocFooter, ReceiptPaper, A4Page, SecondName, ShortNumber } from '../ui/doc';
import { SegmentedControl } from '../ui';
import { Barcode128 } from '../ui/Barcode';

/** Server issue text without codes in brackets or tax-type codes (shown with technical details on). */
const plainDetail = (x: string) => String(x ?? '').replace(/\s*\([A-Za-z0-9_.\-:=, ]+\)/g, '').replace(/\bT\d+(\s*أو\s*T\d+)?/g, t('نوع الضريبة')).replace(/\s{2,}/g, ' ');
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
  const tech = useTech();
  const orderId: string | undefined = params.orderId;
  const prebill = !!params.prebill;
  const [copy, setCopy] = useState<boolean>(!!params.copy);
  useEffect(() => { setCopy(!!params.copy); }, [params.copy, orderId]);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [layout, setLayout] = useState<'80' | 'A4'>('80');
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
        actions={<>
          <Button size="sm" variant="ghost" onClick={() => nav('checks')} data-fb="receipt:back"><ArrowRight className="w-4 h-4 ltr:rotate-180" />{t('رجوع للشيكات')}</Button>
          <SegmentedControl size="sm" value={layout} onChange={setLayout} options={[{ id: '80', label: t('إيصال 80 مم'), fb: 'receipt:layout:80' }, { id: 'A4', label: t('صفحة A4'), fb: 'receipt:layout:A4' }]} />
          {!isPrebill && <Switch checked={copy} onChange={setCopy} label={t('اعرض كنسخة')} />}
          {completed && !isPrebill && can('print:reprint') && <Button size="sm" variant="primary" onClick={() => setReprintOpen(true)} disabled={!terminal} title={terminal ? '' : t('الطباعة محتاجة جهاز')} data-fb="receipt:reprint"><Copy className="w-4 h-4" />{t('اطبع نسخة')}</Button>}
          {isPrebill && r && (r.status === 'DRAFT' || r.status === 'CONFIRMED') && terminal && <Button size="sm" variant="outline" loading={busy} onClick={() => run('Print.PreBill', { params: { orderId }, body: { terminalId: terminal.id } }, { success: t('الشيك المبدئي اتبعت للطابعة — الشيك ما اتغيرش') })} data-fb="receipt:prebill-print"><Printer className="w-4 h-4" />{t('اطبع شيك مبدئي')} <StateBadge state="PROPOSED" /></Button>}
        </>} />

      {q.loading && !r && <div className="flex gap-6"><Skeleton className="h-[520px] w-[80mm] rounded-md" /><Skeleton className="h-40 flex-1 rounded-2xl" /></div>}
      {q.error && <Banner tone="error">{errorText(q.error)}</Banner>}
      {r && (
        <div className="flex flex-wrap gap-6 items-start">
          {layout === 'A4' ? <A4Receipt r={r} isPrebill={isPrebill} copy={copy && !isPrebill} /> : (
          <ReceiptPaper paper={r.template?.paper ?? '80MM'}>
            {copy && !isPrebill && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
                <span className="font-black text-black/15 select-none" style={{ fontSize: 110, transform: 'rotate(-35deg)' }}>{t('نسخة')}</span>
              </div>
            )}
            <DocHeader template={r.template} title={r.business.nameAr || r.business.name} sub={r.business.legalName}
              extra={<>
                <div className="text-[11px]">{L(r.branch.name)}<Tech> <span className="num">({r.branch.code})</span></Tech></div>
                {r.business.address && <div className="text-[11px]">{r.business.address}</div>}
                {r.business.taxNumber && <div className="text-[11px]">{t('رقم التسجيل الضريبي')}: <span className="num">{r.business.taxNumber}</span></div>}
              </>} />
            <Rule />
            <div className="text-center font-bold text-[13px]">
              {isPrebill ? <><div>{t('ليست فاتورة ضريبية')}</div><div className="num text-[11px]">Not a tax receipt</div></> : t('إيصال بيع')}
              {copy && !isPrebill && <div className="text-[13px] border border-black inline-block px-2 mt-1">{t('نسخة')} / COPY</div>}
            </div>
            <Rule />
            <ShortNumber value={r.shortNo} />
            <Row k={t('رقم العملية')} v={<span data-fb="receipt:transaction-id">{r.transactionId ?? r.number}{r.checkNo > 1 ? ` / ${r.checkNo}` : ''}</span>} />
            {r.table && <Row k={t('الطاولة')} v={r.table} text />}
            <Row k={t('القناة')} v={channelLabel(r.channel)} text />
            {r.server && <Row k={t('الويتر')} v={r.server} text />}
            {r.cashier && <Row k={t('الكاشير')} v={r.cashier} text />}
            {r.completedAt && <Row k={t('التاريخ')} v={<DateTime v={r.completedAt} />} text />}
            <Row k={t('اليوم التجاري')} v={r.businessDate} />
            <Rule />
            <div className="space-y-1">
              {r.lines.map((l: any) => (
                <div key={l.id} className={cn(l.voided && 'opacity-60')}>
                  <div className="flex justify-between gap-2">
                    <span className={cn(l.voided && 'line-through')}><span className="num">{qty(l.quantity)}×</span> {L(l.name)}{l.variant ? ` (${L(l.variant)})` : ''}<SecondName text={l.name2} className="ps-5" /></span>
                    <span className={cn('num whitespace-nowrap', l.voided && 'line-through')}>{money(l.lineTotal, false)}</span>
                  </div>
                  {l.voided && <div className="text-[11px] font-bold">— {t('ملغي')}</div>}
                  {(l.modifiers ?? []).length > 0 && <div className="text-[11px] ps-3">+ {l.modifiers.map((m: any) => L(m)).join(t('، '))}</div>}
                  {(l.children ?? []).length > 0 && <div className="text-[11px] ps-3">{l.children.map((c: any) => `${L(c.name)}${c.detail ? ' (' + L(c.detail) + ')' : ''}`).join(t('، '))}</div>}
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
            <Row k={t('الإجمالي')} v={<Money v={tt.payable} plain />} bold big />
            <Rule />
            {(r.payments ?? []).length > 0 && (
              <div className="space-y-0.5">
                {r.payments.map((p: any, i: number) => (
                  <div key={i}>
                    <Row k={methodLabel(p.method + (p.walletProvider ? ':' + p.walletProvider : ''))} v={money(p.amount, false)} />
                    {p.tendered && <Row k={<span className="ps-3 text-[11px]">{t('المدفوع')}</span>} v={money(p.tendered, false)} />}
                    {p.change && nz(p.change) && <Row k={<span className="ps-3 text-[11px]">{t('الباقي للعميل')}</span>} v={money(p.change, false)} />}
                    {p.reference && <Row k={<span className="ps-3 text-[11px]">{t('رقم العملية')}</span>} v={p.reference} />}
                    {p.tip && nz(p.tip) && <Row k={<span className="ps-3 text-[11px]">{t('بقشيش')}</span>} v={money(p.tip, false)} />}
                  </div>
                ))}
              </div>
            )}
            {r.settlement && nz(r.settlement.remaining) && <Row k={t('المطلوب')} v={<Money v={r.settlement.remaining} plain />} bold />}
            {r.settlement && nz(r.settlement.refunded) && <Row k={t('اترجع')} v={`-${money(r.settlement.refunded, false)}`} />}
            {!isPrebill && (
              <>
                <Rule />
                <div className="text-center space-y-1" data-fb="receipt:qr">
                  <div className="text-[11px] font-bold">{t('الإيصال الإلكتروني')}{fiscal?.mode === 'SANDBOX' ? ` (${t('تجريبي')})` : ''}</div>
                  {fiscal?.qr ? (
                    <>
                      <div className="flex justify-center"><QRCodeSVG value={fiscal.qr} size={128} level="M" bgColor="#fffef8" /></div>
                      <div className="num text-[9px] break-all">{fiscal.uuid}</div>
                    </>
                  ) : fiscal ? (
                    <div className="border border-dashed border-black/60 rounded px-2 py-3 text-[12px] font-bold">{fiscal.state === 'PENDING_DATA' ? t('مستني بيانات') : fiscalStateLabel(fiscal.state)}<div className="text-[10px] font-normal">{t('الـ QR هيظهر في النسخة بعد ما الإيصال يتبني')}</div></div>
                  ) : <div className="text-[11px]">{t('الإيصال الإلكتروني مش مفعّل')}<Tech> (FiscalDocumentPolicy = OFF)</Tech></div>}
                  {r.serviceOffReceipt && <div className="text-[10px]">{t('الخدمة مش على الإيصال الإلكتروني لحد قرار المحاسب')}<Tech> (OD-EG-4)</Tech></div>}
                </div>
              </>
            )}
            {/* ux-04: the check number as a plain 1D barcode (Code 128) — scanned in collect mode to open the check. Not a QR,
                so it is never mistaken for the e-receipt QR. */}
            {isPrebill && <><Rule /><div className="flex flex-col items-center gap-1" data-fb="prebill:barcode-box"><Barcode128 value={r.number} fb="prebill-barcode" /><div className="num text-[11px] tracking-[.3em]">{r.number}</div></div></>}
            <Rule />
            {r.template?.footerLines?.length ? <DocFooter lines={r.template.footerLines} /> : <div className="text-center text-[11px]">{t('شكرًا لزيارتكم')}</div>}
          </ReceiptPaper>
          )}

          <div className="flex-1 min-w-[260px] space-y-3">
            
            {isPrebill && <Banner tone="warning">{t('الشيك المبدئي "ليست فاتورة ضريبية": مفيهوش QR، وطباعته مش بتغير الشيك ومش محتاجة موافقة.')}</Banner>}
            {fiscal && (
              <div className="glass rounded-xl p-3 text-sm space-y-1">
                <div className="flex items-center gap-2"><span className="font-bold">{t('حالة الإيصال الإلكتروني')}</span><Pill tone={fiscal.state === 'ACCEPTED' ? 'success' : fiscal.state === 'PENDING_DATA' || fiscal.state === 'REJECTED' ? 'warning' : 'info'}>{fiscalStateLabel(fiscal.state)}</Pill></div>
                {(fiscal.issues ?? []).map((i: any, k: number) => <div key={k} className="text-xs text-soft">• {tech ? i.detail : plainDetail(i.detail)}<Tech> <span className="num text-dim">({i.code})</span></Tech></div>)}
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

/** The same receipt on an A4 page (invoice layout) with the venue template — the reports agent reuses A4Page. */
function A4Receipt({ r, isPrebill, copy }: { r: any; isPrebill: boolean; copy: boolean }) {
  const tt = r.totals;
  return (
    <A4Page template={r.template ? { ...r.template, logoOnReports: true } : null} venueName={r.business.nameAr || r.business.name} branchName={L(r.branch.name)}
      title={isPrebill ? t('شيك مبدئي — ليست فاتورة ضريبية') : copy ? `${t('إيصال بيع')} — ${t('نسخة')}` : t('إيصال بيع')}
      meta={<>
        {r.shortNo && <div className="text-base font-black" data-fb="a4:short-no">{t('رقم النداء')}: <span className="num">{r.shortNo}</span></div>}
        <div>{t('رقم العملية')}: <span className="num">{r.transactionId ?? r.number}</span></div>
        {r.completedAt && <div>{t('التاريخ')}: {dateTime(r.completedAt)}</div>}
        <div>{t('اليوم التجاري')}: <span className="num">{r.businessDate}</span></div>
        {r.business.taxNumber && <div>{t('رقم التسجيل الضريبي')}: <span className="num">{r.business.taxNumber}</span></div>}
      </>}
      footerNote={t('اتطبع من النظام — القالب بيتظبط من «قوالب الإيصال والتقارير».')}>
      <table className="w-full border-collapse text-[13px]">
        <thead><tr className="border-b-2 border-black/70 text-start"><th className="text-start py-1.5">{t('الصنف')}</th><th className="py-1.5">{t('الكمية')}</th><th className="py-1.5 text-end">{t('سعر الوحدة')}</th><th className="py-1.5 text-end">{t('الإجمالي')}</th></tr></thead>
        <tbody>
          {r.lines.map((l: any) => (
            <tr key={l.id} className={cn('border-b border-black/15 align-top', l.voided && 'opacity-60 line-through')}>
              <td className="py-1.5">{L(l.name)}{l.variant ? ` (${L(l.variant)})` : ''}<SecondName text={l.name2} />{(l.modifiers ?? []).length > 0 && <div className="text-[11px]">+ {l.modifiers.map((m: any) => L(m)).join(t('، '))}</div>}</td>
              <td className="py-1.5 text-center num">{qty(l.quantity)}</td>
              <td className="py-1.5 text-end num">{money(l.unitTotal, false)}</td>
              <td className="py-1.5 text-end num">{money(l.lineTotal, false)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 ms-auto w-[80mm] space-y-1">
        <Row k={t('إجمالي الأصناف')} v={money(tt.itemsSubtotal, false)} />
        {nz(tt.discountTotal) && <Row k={t('خصم')} v={`-${money(tt.discountTotal, false)}`} />}
        {nz(tt.serviceCharge) && <Row k={`${t('خدمة')} ${pctText(tt.serviceRate)}`} v={money(tt.serviceCharge, false)} />}
        {(tt.taxLines ?? []).map((x: any, i: number) => <Row key={i} k={`${L(x.name) || t('ضريبة القيمة المضافة')} ${pctText(x.rate)}`} v={money(x.amount, false)} />)}
        <div className="border-t-2 border-black pt-1"><Row k={t('الإجمالي')} v={<Money v={tt.payable} plain />} bold big /></div>
        {(r.payments ?? []).map((p: any, i: number) => <Row key={i} k={methodLabel(p.method + (p.walletProvider ? ':' + p.walletProvider : ''))} v={money(p.amount, false)} />)}
      </div>
      {isPrebill && <div className="mt-6 flex flex-col items-start gap-1" data-fb="a4:prebill-barcode"><Barcode128 value={r.number} module={1.8} height={48} /><div className="num text-[11px] tracking-[.3em]">{r.number}</div></div>}
    </A4Page>
  );
}
