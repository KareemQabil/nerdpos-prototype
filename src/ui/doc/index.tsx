// Document template kit (round 3, E16 / P1-033 / P1-034) — shared by the receipt (80 mm), the A4 invoice view and the
// A4 report templates (reports agent: import { useDocTemplate, A4Page, DocHeader, DocFooter } from '../../ui/doc').
// The venue sets the logo, header and footer lines in «قوالب الإيصال والتقارير» (DocTemplate.Get / DocTemplate.Update).
// Display only: these components never compute money.
import React from 'react';
import { useQuery } from '../../app/hooks';
import { t } from '../../i18n';
import { cn } from '../../lib/format';

export interface DocTemplateView {
  logoDataUrl: string | null; logoName?: string | null; logoWidthPct: number; logoOnReceipt?: boolean; logoOnReports?: boolean;
  headerLines: string[]; footerLines: string[]; paper: '80MM' | '58MM'; version: number;
  business?: { name: string; nameAr: string | null }; branch?: { name: string; code: string } | null;
  secondLanguage?: { receipt: boolean; kitchen: boolean; menu: boolean };
}

/** The venue template (logo, header, footer, paper) — one query, cached like every other read. */
export function useDocTemplate() {
  const q = useQuery<DocTemplateView>('DocTemplate.Get');
  return { ...q, template: q.data ?? null };
}

/** The venue logo, sized as a share of the paper width (printed by the system, not burnt into the printer). */
export function DocLogo({ src, widthPct = 50, className }: { src: string | null | undefined; widthPct?: number; className?: string }) {
  if (!src) return null;
  return <img src={src} alt={t('لوجو المطعم')} data-fb="doc:logo" className={cn('mx-auto block object-contain', className)} style={{ width: `${Math.max(20, Math.min(100, widthPct))}%`, maxHeight: 120 }} />;
}

/** Header block of any venue document: logo, venue name, the template header lines and any extra rows. */
export function DocHeader({ template, title, sub, extra, variant = 'receipt', showLogo = true }: {
  template: Pick<DocTemplateView, 'logoDataUrl' | 'logoWidthPct' | 'headerLines'> | null | undefined;
  title: React.ReactNode; sub?: React.ReactNode; extra?: React.ReactNode; variant?: 'receipt' | 'a4'; showLogo?: boolean;
}) {
  if (variant === 'a4') {
    return (
      <div className="flex items-start justify-between gap-6 pb-4 border-b-2 border-black/80" data-fb="doc:header">
        <div className="min-w-0 space-y-0.5">
          <div className="text-xl font-extrabold">{title}</div>
          {sub && <div className="text-sm">{sub}</div>}
          {(template?.headerLines ?? []).map((l, i) => <div key={i} className="text-xs">{l}</div>)}
          {extra}
        </div>
        {showLogo && template?.logoDataUrl && <img src={template.logoDataUrl} alt={t('لوجو المطعم')} data-fb="doc:logo" className="object-contain shrink-0" style={{ width: `${Math.max(20, Math.min(100, template.logoWidthPct)) * 0.6}mm`, maxHeight: '28mm' }} />}
      </div>
    );
  }
  return (
    <div className="text-center space-y-0.5" data-fb="doc:header">
      {showLogo && <DocLogo src={template?.logoDataUrl} widthPct={template?.logoWidthPct} className="mb-1.5" />}
      <div className="text-base font-bold">{title}</div>
      {sub && <div className="text-[11px]">{sub}</div>}
      {(template?.headerLines ?? []).map((l, i) => <div key={i} className="text-[11px]">{l}</div>)}
      {extra}
    </div>
  );
}

/** Footer lines of the template (thank-you, return policy…). */
export function DocFooter({ lines, variant = 'receipt' }: { lines: string[] | null | undefined; variant?: 'receipt' | 'a4' }) {
  if (!lines?.length) return null;
  return <div className={cn(variant === 'a4' ? 'text-xs text-center pt-3 border-t border-black/40 space-y-0.5' : 'text-center text-[11px] space-y-0.5')} data-fb="doc:footer">{lines.map((l, i) => <div key={i}>{l}</div>)}</div>;
}

/** Thermal receipt paper (80 mm or 58 mm), right-to-left. */
export function ReceiptPaper({ paper = '80MM', children, className, fb = 'receipt:paper' }: { paper?: '80MM' | '58MM'; children: React.ReactNode; className?: string; fb?: string }) {
  return <div className={cn('paper relative overflow-hidden rounded-md shadow-2xl px-4 py-5 text-[12px] leading-relaxed', className)} style={{ width: paper === '58MM' ? '58mm' : '80mm', direction: 'rtl' }} data-fb={fb} data-paper={paper}>{children}</div>;
}

/** An A4 sheet with the venue header (logo, name, header lines), a title block, the content and the footer.
 *  `meta` is for the report's date range / as-of / provisional rows. */
export function A4Page({ template, venueName, branchName, title, meta, children, footerNote, className }: {
  template: DocTemplateView | null | undefined; venueName: React.ReactNode; branchName?: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode;
  children: React.ReactNode; footerNote?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('paper shadow-2xl rounded-sm mx-auto flex flex-col', className)} style={{ width: '210mm', minHeight: '297mm', padding: '14mm 14mm 12mm', direction: 'rtl' }} data-fb="doc:a4">
      <DocHeader variant="a4" template={template} title={venueName} sub={branchName} showLogo={template?.logoOnReports !== false} />
      <div className="py-4 flex items-end justify-between gap-4"><div className="text-lg font-extrabold">{title}</div>{meta && <div className="text-xs text-end space-y-0.5">{meta}</div>}</div>
      <div className="flex-1 text-[13px]">{children}</div>
      <DocFooter variant="a4" lines={template?.footerLines} />
      {footerNote && <div className="text-[10px] text-center mt-1 opacity-70">{footerNote}</div>}
    </div>
  );
}

/** The item's second-language name under the main one (only when the item has one — never machine translated). */
export function SecondName({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  return <span className={cn('block text-[10px] leading-tight opacity-80', className)} data-fb="doc:name2"><bdi>{text}</bdi></span>;
}

/** The short call-out number printed big (E08). The transaction number is printed separately and always. */
export function ShortNumber({ value, label, className }: { value: string | null | undefined; label?: string; className?: string }) {
  if (!value) return null;
  return (
    <div className={cn('text-center border-2 border-black rounded-lg py-1.5 my-2', className)} data-fb="doc:short-no">
      <div className="text-[11px] font-bold">{label ?? t('رقم النداء')}</div>
      <div className="num font-black leading-none" style={{ fontSize: 44 }}>{value}</div>
    </div>
  );
}
