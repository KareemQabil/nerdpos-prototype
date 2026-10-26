import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/format';

/** Demo-bar popover: opens under its button, kept inside the window, closes on outside click or Esc. */
export function Popover({ button, children, width = 320, title }: { button: (open: boolean) => React.ReactNode; children: React.ReactNode | ((close: () => void) => React.ReactNode); width?: number; title?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; w: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const trig = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !trig.current) return;
    const place = () => {
      const r = trig.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const w = Math.min(width, vw - 16);
      // Anchor to the button edge that is closer to the window edge, then keep it on screen.
      const left = r.left + r.width / 2 > vw / 2 ? r.right - w : r.left;
      setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(left, vw - w - 8)), w });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, width]);
  return (
    <div className="relative shrink-0" ref={ref} data-chrome>
      <div ref={trig} onClick={() => setOpen(!open)} title={title}>{button(open)}</div>
      {open && pos && (
        <div className={cn('fixed overlay-panel rounded-2xl p-4 z-[80] animate-fade-in overflow-y-auto')} style={{ width: pos.w, top: pos.top, left: pos.left, maxHeight: `calc(100vh - ${pos.top + 12}px)` }} role="dialog" aria-label={title}>
          {typeof children === 'function' ? (children as any)(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}
