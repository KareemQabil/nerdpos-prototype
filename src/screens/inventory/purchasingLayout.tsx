// Purchasing long forms without side drawers (brief §3, ux-05): new / edit purchase order, low-stock suggestions,
// receiving, supplier return, store request and direct invoice take the whole screen area of their device with a back
// button — the same DetailPane chrome as ux-06 (header, one scrolling body, sticky action footer). They can be opened
// from any host (purchasing board, list, item page) because the page is positioned over the device's screen area.
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DetailPane, DetailModeProvider } from '../../ui';

/** The screen area (`main`) of the device that holds the anchor. */
function useMainRect(anchor: React.RefObject<HTMLElement>) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number; device?: string } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    const frame = a?.closest('[data-device]') as HTMLElement | null;
    const main = (frame?.querySelector('main') as HTMLElement | null) ?? (a?.closest('main') as HTMLElement | null);
    const measure = () => { const r = (main ?? document.body).getBoundingClientRect(); setRect({ left: r.left, top: r.top, width: r.width, height: r.height, device: frame?.dataset.device }); };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' && main ? new ResizeObserver(measure) : null;
    if (ro && main) ro.observe(main);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [anchor]);
  return rect;
}

export function FullPage({ title, badge, onBack, footer, children, fb, sub }: { title: React.ReactNode; badge?: React.ReactNode; onBack: () => void; footer?: React.ReactNode; children: React.ReactNode; fb?: string; sub?: React.ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const rect = useMainRect(anchor);
  return (
    <>
      <span ref={anchor} hidden />
      {rect && createPortal(
        <div role="region" aria-label={typeof title === 'string' ? title : undefined} data-device={rect.device} data-fb={fb} data-fullpage
          className="fixed z-[60] flex flex-col animate-fade-in" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, background: 'var(--background)' }}>
          <DetailModeProvider mode="page">
            <DetailPane title={title} badge={badge} meta={sub} onClose={onBack} footer={footer}>{children}</DetailPane>
          </DetailModeProvider>
        </div>,
        document.body,
      )}
    </>
  );
}
