// Drawing of one floor plan: decor (bar, doors, windows, plants, labels) and tables at their positions.
// Used live on the floor screen (states, timers) and by the floor plan editor (drag to move / resize).
import React from 'react';
import { DoorOpen, Sprout, Wine, Type, PanelTop, Square } from 'lucide-react';
import { cn } from '../../lib/format';

export interface CanvasTable { id: string; name: string; x: number; y: number; w: number; h: number; shape: string; seats: number; rotation?: number }
export interface CanvasDecor { id: string; kind: string; x: number; y: number; w: number; h: number; label?: string }

const DECOR_ICON: Record<string, React.ComponentType<{ className?: string }>> = { DOOR: DoorOpen, PLANT: Sprout, BAR: Wine, LABEL: Type, WINDOW: PanelTop, WALL: Square };
export const shapeClass = (shape: string) => (shape === 'ROUND' ? 'rounded-full' : shape === 'BOOTH' ? 'rounded-[28px]' : shape === 'RECT' ? 'rounded-2xl' : 'rounded-xl');

/** Absolute layout in floor units, scaled to the container width (keeps the floor's aspect ratio). */
export function FloorCanvas({ width, height, decor, tables, renderTable, onPointerDownTable, onPointerDownDecor, onBackgroundClick, canvasRef, className, editing, children }: {
  width: number; height: number; decor: CanvasDecor[]; tables: CanvasTable[]; renderTable: (t: CanvasTable) => React.ReactNode;
  onPointerDownTable?: (e: React.PointerEvent, t: CanvasTable, mode: 'move' | 'resize') => void; onPointerDownDecor?: (e: React.PointerEvent, d: CanvasDecor, mode: 'move' | 'resize') => void;
  onBackgroundClick?: () => void; canvasRef?: React.Ref<HTMLDivElement>; className?: string; editing?: boolean; children?: React.ReactNode;
}) {
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div ref={canvasRef} onPointerDown={(e) => { if (e.target === e.currentTarget) onBackgroundClick?.(); }}
      className={cn('relative w-full rounded-2xl border line overflow-hidden select-none touch-none', editing ? 'bg-[length:24px_24px] bg-[radial-gradient(circle,rgba(255,255,255,0.08)_1px,transparent_1px)]' : 'surface-1', className)}
      style={{ aspectRatio: `${width} / ${height}` }} data-fb="floor-canvas">
      {decor.map((d) => {
        const Icon = DECOR_ICON[d.kind] ?? Square;
        const tone = d.kind === 'BAR' ? 'bg-amber-500/15 border-amber-400/40 text-amber-200' : d.kind === 'DOOR' ? 'bg-sky-500/10 border-sky-400/40 text-sky-200 border-dashed' : d.kind === 'WINDOW' ? 'bg-cyan-400/10 border-cyan-300/30 text-cyan-200' : d.kind === 'PLANT' ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300 rounded-full' : d.kind === 'WALL' ? 'bg-white/15 border-white/20 text-white/50' : 'border-transparent text-dim';
        return (
          <div key={d.id} onPointerDown={editing ? (e) => onPointerDownDecor?.(e, d, 'move') : undefined}
            className={cn('absolute border rounded-lg flex items-center justify-center gap-1 text-[11px] overflow-hidden', tone, editing && 'cursor-move hover:ring-2 hover:ring-[var(--primary)]')}
            style={{ left: pct(d.x, width), top: pct(d.y, height), width: pct(d.w, width), height: pct(d.h, height) }} data-decor={d.kind}>
            <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" />{d.label && d.w > 50 && <span className="truncate">{d.label}</span>}
            {editing && <span onPointerDown={(e) => { e.stopPropagation(); onPointerDownDecor?.(e, d, 'resize'); }} className="absolute bottom-0 end-0 w-3 h-3 cursor-nwse-resize bg-[var(--primary)]/60 rounded-ss" />}
          </div>
        );
      })}
      {tables.map((t) => (
        <div key={t.id} className="absolute" style={{ left: pct(t.x, width), top: pct(t.y, height), width: pct(t.w, width), height: pct(t.h, height) }}
          onPointerDown={editing ? (e) => onPointerDownTable?.(e, t, 'move') : undefined} data-table-pos={t.name}>
          {renderTable(t)}
          {editing && <span onPointerDown={(e) => { e.stopPropagation(); onPointerDownTable?.(e, t, 'resize'); }} className="absolute -bottom-1 -end-1 w-4 h-4 cursor-nwse-resize bg-[var(--primary)] rounded-full border-2 border-[var(--background)]" data-fb={`table-resize:${t.name}`} />}
        </div>
      ))}
      {children}
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
      return <span key={i} className="absolute w-2 h-2 rounded-full bg-white/25 pointer-events-none" style={{ left: `calc(50% + ${Math.cos(a) * r}% - 4px)`, top: `calc(50% + ${Math.sin(a) * r}% - 4px)` }} />;
    })}</>
  );
}
