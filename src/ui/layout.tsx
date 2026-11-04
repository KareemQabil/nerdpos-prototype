// ux-06 page layouts that replace side drawers (UX brief §3): in-page master-detail, full pages with a back button and a
// sticky action footer, list pages that fill the screen (one scroll container per region), and small helpers for
// popups (Enter saves, body scroll lock).
//
//   MasterDetail  list + detail. Wide pane (main ≥ SPLIT_MIN px): detail beside the list; narrow: the detail is a
//                 full page with a back button. The list stays mounted (invisible) under a full page, so its scroll
//                 position is kept when the user comes back. `side={false}` always shows the detail as a full page
//                 (long forms: product editor, recipe editor, count sheet, role editor).
//   DetailPane    header (back or close, title, badge, actions) · body (the only scroller) · footer (actions, never
//                 covers the content). Esc closes it when no popup/menu is open.
//   FillPage      list content that fills the region: header and filters stay, the table scrolls with a sticky head.
//   useEnterSave  Enter in a text input saves a popup form (textarea, select and buttons keep their own Enter).
//   useScrollLock no page scroll behind an open popup.
import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { cn } from '../lib/format';
import { t } from '../i18n';
import { keyPane } from '../app/devices';

/** Width of the screen area (main minus sidebar) from which a detail sits beside its list (≈ a 1280 px wide window). */
export const SPLIT_MIN = 1040;

type Mode = 'side' | 'page';
const ModeCtx = createContext<Mode>('page');
export const useDetailMode = () => useContext(ModeCtx);
const CompactCtx = createContext(false);
/** True while the list shares the width with an open detail: show fewer columns and no KPI tiles. */
export const useListCompact = () => useContext(CompactCtx);

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const inert = (on: boolean) => (on ? ({ inert: '' } as Record<string, string>) : {});

/**
 * List + detail in the page (never an overlay). Fills the screen area: the list and the detail each scroll on their own.
 * `open` = a record is selected (its id lives in the route params, so refresh and back keep it).
 */
export function MasterDetail({ list, detail, open, side = true, detailWidth = 'clamp(440px, 48%, 820px)', fb, className, extra }: { list: React.ReactNode | ((compact: boolean) => React.ReactNode); detail: React.ReactNode; open: boolean; side?: boolean; detailWidth?: string; fb?: string; className?: string; extra?: React.ReactNode }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const split = side && w >= SPLIT_MIN;
  const covered = open && !split;
  useEffect(() => {
    if (!split || !open) return;
    const id = requestAnimationFrame(() => ref.current?.querySelector('[data-list-region] .row-selected, [data-list-region] [data-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(id);
  }, [split, open, ref]);
  return (
    <div ref={ref} className={cn('relative -m-5 h-[calc(100%+2.5rem)] min-h-0 flex', className)} data-master-detail={split ? 'split' : 'single'} data-fb={fb}>
      <div className={cn('@container/list flex flex-col min-w-0 min-h-0 overflow-y-auto p-5', covered ? 'invisible absolute inset-0 pointer-events-none' : 'flex-1')} aria-hidden={covered || undefined} data-list-region {...inert(covered)}>
        <CompactCtx.Provider value={split && open}>{typeof list === 'function' ? list(split && open) : list}</CompactCtx.Provider>
      </div>
      {open && (
        <div className={cn('flex flex-col min-h-0 min-w-0', split ? 'shrink-0 border-s line detail-side' : 'flex-1 detail-page')} style={split ? { width: detailWidth } : undefined} data-detail={split ? 'side' : 'page'}>
          <ModeCtx.Provider value={split ? 'side' : 'page'}>{detail}</ModeCtx.Provider>
        </div>
      )}
      {extra}
    </div>
  );
}

/** A record's details or a long form: header, body (the only scroller), sticky footer. */
export function DetailPane({ title, icon, badge, actions, onClose, backLabel, footer, children, fb, bodyClassName, escape = true, meta }: { title: React.ReactNode; icon?: React.ReactNode; badge?: React.ReactNode; actions?: React.ReactNode; onClose: () => void; backLabel?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode; fb?: string; bodyClassName?: string; escape?: boolean; meta?: React.ReactNode }) {
  const mode = useDetailMode();
  const close = useRef(onClose);
  close.current = onClose;
  const self = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!escape) return;
    // document (bubble) runs before the popups' window listeners, so an open popup/menu takes Esc first;
    // with two devices side by side only the pane last touched reacts
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      const dev = self.current?.closest('[data-device]')?.getAttribute('data-device');
      if (dev && dev !== keyPane()) return;
      close.current();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [escape]);
  return (
    <section ref={self} className="flex flex-col h-full min-h-0 min-w-0" data-fb={fb} data-detail-pane={mode}>
      <header className="shrink-0 px-5 pt-4 pb-3 border-b line">
        {mode === 'page' && (
          <button type="button" onClick={onClose} data-fb="detail:back" className="mb-2 -ms-1 inline-flex items-center gap-1.5 h-8 px-2 rounded-lg text-sm font-bold text-soft hover:text-[var(--foreground)] hover:bg-[var(--surface-2)]">
            <ArrowRight className="w-4 h-4 ltr:rotate-180" />{backLabel ?? t('رجوع')}
          </button>
        )}
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="flex items-start gap-3 min-w-0">
            {icon && <span className="w-9 h-9 rounded-xl bg-[var(--primary-container)] text-[var(--primary)] flex items-center justify-center shrink-0 [&_svg]:w-5 [&_svg]:h-5">{icon}</span>}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap min-w-0"><h2 className="text-lg font-bold leading-snug min-w-0 break-words" data-detail-title>{title}</h2>{badge}</div>
              {meta && <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-dim">{meta}</div>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {actions}
            {mode === 'side' && <button type="button" onClick={onClose} title={t('إغلاق')} aria-label={t('إغلاق')} data-fb="detail:close" className="w-9 h-9 -me-2 rounded-xl flex items-center justify-center text-soft hover:text-[var(--foreground)] hover:bg-[var(--surface-2)]"><X className="w-4 h-4" /></button>}
          </div>
        </div>
      </header>
      <div className={cn('@container/detail flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4', bodyClassName)} data-scroll-region>{children}</div>
      {footer && <footer className="shrink-0 px-5 py-3 border-t line flex flex-wrap gap-2 justify-end items-center overlay-footer" data-detail-footer>{footer}</footer>}
    </section>
  );
}

/** List content that fills its region: put the table in a `fill` Card (or give it className "flex-1 min-h-0"). */
export function FillPage({ children, className, fb }: { children: React.ReactNode; className?: string; fb?: string }) {
  return <div className={cn('flex-1 min-h-0 flex flex-col gap-4', className)} data-fb={fb}>{children}</div>;
}
/** Classes for a Card that holds the filling table, and for its body. */
export const FILL_CARD = 'flex-1 min-h-[16rem] flex flex-col';
export const FILL_BODY = 'flex-1 min-h-0 flex flex-col';

/** Enter in a text field submits a popup form (Esc is the popup's own). */
export function useEnterSave(save: () => void, enabled: boolean) {
  return (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    const el = e.target as HTMLElement;
    if (el.tagName !== 'INPUT') return;
    const type = (el as HTMLInputElement).type;
    if (['checkbox', 'radio', 'button', 'submit', 'color', 'file', 'range'].includes(type)) return;
    e.preventDefault();
    if (enabled) save();
  };
}

let locks = 0;
/** No page scroll behind an open popup (the popup body scrolls on its own, with a fixed header and footer). */
export function useScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    locks++;
    document.documentElement.classList.add('overlay-open');
    return () => { locks = Math.max(0, locks - 1); if (!locks) document.documentElement.classList.remove('overlay-open'); };
  }, [open]);
}
