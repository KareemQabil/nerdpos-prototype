// Purchasing layouts without side drawers (brief §3, ux-05):
// - FullPage: a long form (new / edit purchase order, receiving, store request, direct invoice) takes the whole screen
//   area of its device with a back button; one scroll region, the header and the action footer always visible.
// - SplitDetail: details (purchase order, receipt, invoice) open in the page — beside the list on wide screens, as
//   the whole page on narrow ones — never as an overlay.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ArrowLeft, X } from 'lucide-react';
import { Button, IconButton } from '../../ui';
import { t, useLang } from '../../i18n';
import { cn } from '../../lib/format';

/** The screen area (`main`) of the device that holds `el`. */
function useMainRect(anchor: React.RefObject<HTMLElement>) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number; device?: string } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    const frame = a?.closest('[data-device]') as HTMLElement | null;
    const main = (frame?.querySelector('main') as HTMLElement | null) ?? (a?.closest('main') as HTMLElement | null);
    const measure = () => {
      const r = (main ?? document.body).getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height, device: frame?.dataset.device });
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' && main ? new ResizeObserver(measure) : null;
    if (ro && main) ro.observe(main);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [anchor]);
  return rect;
}

export function FullPage({ title, badge, onBack, footer, children, fb, sub }: { title: React.ReactNode; badge?: React.ReactNode; onBack: () => void; footer?: React.ReactNode; children: React.ReactNode; fb?: string; sub?: React.ReactNode }) {
  const lang = useLang();
  const anchor = useRef<HTMLSpanElement>(null);
  const rect = useMainRect(anchor);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onBack(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onBack]);
  useEffect(() => { const id = requestAnimationFrame(() => panel.current?.focus({ preventScroll: true })); return () => cancelAnimationFrame(id); }, []);
  return (
    <>
      <span ref={anchor} hidden />
      {rect && createPortal(
        <div ref={panel} tabIndex={-1} role="region" aria-label={typeof title === 'string' ? title : undefined} data-device={rect.device} data-fb={fb} data-fullpage
          className="fixed z-[60] flex flex-col outline-none animate-fade-in" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, background: 'var(--background)' }}>
          <header className="shrink-0 flex items-center gap-3 px-5 py-3 border-b line" style={{ background: 'var(--card)' }}>
            <Button variant="ghost" size="sm" onClick={onBack} data-fb="page-back">{lang === 'ar' ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}{t('رجوع')}</Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold truncate flex items-center gap-2">{title}{badge}</h1>
              {sub && <div className="text-xs text-dim truncate">{sub}</div>}
            </div>
          </header>
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4" data-fb="page-body">{children}</div>
          {footer && <footer className="shrink-0 border-t line px-5 py-3 flex flex-wrap gap-2 items-center justify-end" style={{ background: 'var(--card)' }} data-fb="page-footer">{footer}</footer>}
        </div>,
        document.body,
      )}
    </>
  );
}

/** The width of an element, kept current. */
export function useWidthOf<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(1600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const SplitCtx = React.createContext<{ wide: boolean; onClose: () => void } | null>(null);

/**
 * A list with an in-page detail. Wide (≥ 1180 px): list and detail side by side, each its own scroll region.
 * Narrow: the detail is the page (with back).
 */
export function SplitDetail({ list, detail, onClose }: { list: React.ReactNode; detail: React.ReactNode | null; onClose: () => void }) {
  const [ref, w] = useWidthOf<HTMLDivElement>();
  const wide = w >= 1180;
  const open = !!detail;
  return (
    <div ref={ref} className={cn('min-h-0', open && wide && 'grid grid-cols-[minmax(0,1fr)_minmax(420px,44%)] gap-3 items-start')}>
      {(!open || wide) && <div className="min-w-0">{list}</div>}
      {open && <SplitCtx.Provider value={{ wide, onClose }}>{detail}</SplitCtx.Provider>}
    </div>
  );
}

/**
 * The detail of one document: title, body, and the action footer that always stays visible. Inside SplitDetail it is
 * its own panel (one scroll region); inside a board's detail pane it flows in that pane with a sticky footer.
 */
export function DetailPanel({ title, badge, footer, children, fb }: { title: React.ReactNode; badge?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode; fb?: string }) {
  const lang = useLang();
  const ctx = React.useContext(SplitCtx);
  if (!ctx) {
    return (
      <div className="flex flex-col gap-3 min-h-full" data-fb={fb}>
        <h2 className="text-lg font-bold flex items-center gap-2 flex-wrap">{title}{badge}</h2>
        <div className="flex-1">{children}</div>
        {footer && <footer className="sticky -bottom-4 -mx-4 -mb-4 px-4 py-3 border-t line flex flex-wrap gap-2 items-center justify-end" style={{ background: 'var(--card)' }} data-fb="detail-footer">{footer}</footer>}
      </div>
    );
  }
  const { wide, onClose } = ctx;
  return (
    <aside className={cn('glass rounded-2xl border flex flex-col min-h-0', wide ? 'sticky top-0 max-h-[calc(100vh-7.5rem)]' : 'h-[calc(100vh-7.5rem)]')} style={{ borderColor: 'var(--glass-border)' }} data-fb={fb ?? 'split-detail'} aria-label={t('التفاصيل')}>
      <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b line">
        {!wide && <Button size="sm" variant="ghost" onClick={onClose} data-fb="detail-back">{lang === 'ar' ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}{t('رجوع')}</Button>}
        <h2 className="flex-1 min-w-0 text-base font-bold truncate flex items-center gap-2">{title}{badge}</h2>
        {wide && <IconButton onClick={onClose} title={t('إغلاق')} data-fb="detail-close"><X className="w-4 h-4" /></IconButton>}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto p-4" data-fb="detail-body">{children}</div>
      {footer && <footer className="shrink-0 border-t line px-4 py-3 flex flex-wrap gap-2 items-center justify-end" data-fb="detail-footer">{footer}</footer>}
    </aside>
  );
}
