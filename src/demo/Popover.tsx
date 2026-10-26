import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/format';

export function Popover({ button, children, width = 320, title }: { button: (open: boolean) => React.ReactNode; children: React.ReactNode | ((close: () => void) => React.ReactNode); width?: number; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="relative shrink-0" ref={ref} data-chrome>
      <div onClick={() => setOpen(!open)} title={title}>{button(open)}</div>
      {open && (
        <div className={cn('fixed mt-2 glass-strong rounded-xl p-3 z-[80] animate-fade-in')} style={{ width, top: 48, insetInlineEnd: 12 }}>
          {typeof children === 'function' ? (children as any)(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}
