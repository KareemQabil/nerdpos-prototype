// Drawing of one floor plan: decor (bar, doors, windows, plants, labels) and tables at their positions.
// Used live on the floor screen (states, timers) and by the floor plan editor (drag to move / resize).
// `fit`: the plan scales to fit the available box (width AND height) and `zoom` enlarges it (the box scrolls).
import React, { useEffect, useRef, useState } from 'react';
import { DoorOpen, Sprout, Wine, Type, PanelTop, Square } from 'lucide-react';
import { cn } from '../../lib/format';
import { tv } from '../../i18n';

export interface CanvasTable { id: string; name: string; x: number; y: number; w: number; h: number; shape: string; seats: number; rotation?: number }
export interface CanvasDecor { id: string; kind: string; x: number; y: number; w: number; h: number; label?: string }

const DECOR_ICON: Record<string, React.ComponentType<{ className?: string }>> = { DOOR: DoorOpen, PLANT: Sprout, BAR: Wine, LABEL: Type, WINDOW: PanelTop, WALL: Square };
export const shapeClass = (shape: string) => (shape === 'ROUND' ? 'rounded-full' : shape === 'BOOTH' ? 'rounded-[28px]' : shape === 'RECT' ? 'rounded-2xl' : 'rounded-xl');
const mix = (v: string, p: number) => `color-mix(in srgb, var(${v}) ${p}%, transparent)`;
const DECOR_STYLE: Record<string, React.CSSProperties> = {
  BAR: { background: mix('--warning', 13), borderColor: mix('--warning', 40), color: 'var(--warning)' },
  DOOR: { background: mix('--info', 9), borderColor: mix('--info', 40), color: 'var(--info)', borderStyle: 'dashed' },
  WINDOW: { background: mix('--primary', 9), borderColor: mix('--primary', 30), color: 'var(--primary)' },
  PLANT: { background: mix('--success', 13), borderColor: mix('--success', 30), color: 'var(--success)', borderRadius: 9999 },
  WALL: { background: 'var(--surface-3)', borderColor: 'var(--glass-border)', color: 'var(--text-dim)' },
};

/** Size of an element, kept up to date. */
function useBox(ref: React.RefObject<HTMLDivElement | null>, on: boolean) {
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    if (!on || !ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [on, ref]);
  return box;
}

/** Absolute layout in floor units. Default: scaled to the container width (keeps the floor's aspect ratio).
 *  With `fit`: scaled to fit the parent box in both directions, times `zoom`. `renderTable` gets the pixel scale. */
export function FloorCanvas({ width, height, decor, tables, renderTable, onPointerDownTable, onPointerDownDecor, onBackgroundClick, canvasRef, className, editing, children, fit, zoom = 1, onScale }: {
  width: number; height: number; decor: CanvasDecor[]; tables: CanvasTable[]; renderTable: (t: CanvasTable, view: { scale: number }) => React.ReactNode;
  onPointerDownTable?: (e: React.PointerEvent, t: CanvasTable, mode: 'move' | 'resize') => void; onPointerDownDecor?: (e: React.PointerEvent, d: CanvasDecor, mode: 'move' | 'resize') => void;
  onBackgroundClick?: () => void; canvasRef?: React.Ref<HTMLDivElement>; className?: string; editing?: boolean; children?: React.ReactNode;
  fit?: boolean; zoom?: number; onScale?: (s: number) => void;
}) {
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const boxRef = useRef<HTMLDivElement>(null);
  const box = useBox(boxRef, !!fit);
  const base = fit && box.w > 0 && box.h > 0 ? Math.min((box.w - 2) / width, (box.h - 2) / height) : 0;
  const scale = fit ? base * zoom : 0;
  useEffect(() => { if (fit && scale) onScale?.(scale); }, [fit, scale, onScale]);
  const canvas = (
    <div ref={canvasRef} onPointerDown={(e) => { if (e.target === e.currentTarget) onBackgroundClick?.(); }}
      className={cn('relative rounded-2xl border line overflow-hidden select-none', !fit && 'w-full touch-none', editing ? 'bg-[length:24px_24px] bg-[radial-gradient(circle,var(--line)_1px,transparent_1px)]' : 'surface-1', fit && 'mx-auto shrink-0', className)}
      style={fit ? { width: Math.max(0, width * scale), height: Math.max(0, height * scale), background: 'var(--surface-1)' } : { aspectRatio: `${width} / ${height}` }} data-fb="floor-canvas">
      {decor.map((d) => {
        const Icon = DECOR_ICON[d.kind] ?? Square;
        const st = DECOR_STYLE[d.kind] ?? { borderColor: 'transparent', color: 'var(--text-dim)' };
        return (
          <div key={d.id} onPointerDown={editing ? (e) => onPointerDownDecor?.(e, d, 'move') : undefined}
            className={cn('absolute border rounded-lg flex items-center justify-center gap-1 text-[11px] font-bold overflow-hidden', editing && 'cursor-move hover:ring-2 hover:ring-[var(--primary)]')}
            style={{ ...st, left: pct(d.x, width), top: pct(d.y, height), width: pct(d.w, width), height: pct(d.h, height) }} data-decor={d.kind}>
            <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" />{d.label && d.w > 50 && <span className="truncate">{tv(d.label)}</span>}
            {editing && <span onPointerDown={(e) => { e.stopPropagation(); onPointerDownDecor?.(e, d, 'resize'); }} className="absolute bottom-0 end-0 w-3 h-3 cursor-nwse-resize bg-[var(--primary)]/60 rounded-ss" />}
          </div>
        );
      })}
      {tables.map((t) => (
        <div key={t.id} className="absolute" style={{ left: pct(t.x, width), top: pct(t.y, height), width: pct(t.w, width), height: pct(t.h, height) }}
          onPointerDown={editing ? (e) => onPointerDownTable?.(e, t, 'move') : undefined} data-table-pos={t.name}>
          {renderTable(t, { scale: scale || 1 })}
          {editing && <span onPointerDown={(e) => { e.stopPropagation(); onPointerDownTable?.(e, t, 'resize'); }} className="absolute -bottom-1 -end-1 w-4 h-4 cursor-nwse-resize bg-[var(--primary)] rounded-full border-2 border-[var(--background)]" data-fb={`table-resize:${t.name}`} />}
        </div>
      ))}
      {children}
    </div>
  );
  if (!fit) return canvas;
  return (
    <div ref={boxRef} className={cn('relative w-full h-full min-h-0', zoom > 1 ? 'overflow-auto' : 'overflow-hidden', 'flex', zoom > 1 ? 'items-start' : 'items-center')} data-fb="floor-fit">
      {scale > 0 && canvas}
    </div>
  );
}

/** Seat dots around a table (decorative). */
export function Seats({ n, shape }: { n: number; shape: string }) {
  const k = Math.min(n, 12);
  return (
    <>{Array.from({ length: k }, (_, i) => {
      const a = (i / k) * Math.PI * 2 - Math.PI / 2;
      const r = shape === 'ROUND' ? 52 : 54;
      return <span key={i} className="absolute w-2 h-2 rounded-full pointer-events-none" style={{ background: 'color-mix(in srgb, var(--foreground) 22%, transparent)', left: `calc(50% + ${Math.cos(a) * r}% - 4px)`, top: `calc(50% + ${Math.sin(a) * r}% - 4px)` }} />;
    })}</>
  );
}
