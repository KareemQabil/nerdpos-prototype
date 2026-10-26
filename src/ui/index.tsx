// UI atoms in the legacy NerdPOS look (glass, cyan, Almarai, rounded-xl).
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn, money } from '../lib/format';
import { t, L } from '../i18n';
import type { BadgeState } from '../mock/contracts';
import { badgeOfOps, opsById } from '../mock/contracts';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'outline';
export function Button({ variant = 'secondary', size = 'md', className, loading, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg' | 'xl'; loading?: boolean }) {
  const v: Record<BtnVariant, string> = {
    primary: 'btn-primary-grad font-bold hover:brightness-110',
    secondary: 'surface-2 border border-[var(--glass-border)] hover:border-[var(--primary)] text-[var(--foreground)]',
    ghost: 'hover:surface-2 text-soft',
    danger: 'bg-[color-mix(in_srgb,var(--error)_18%,transparent)] border border-[color-mix(in_srgb,var(--error)_45%,transparent)] text-[var(--error)] hover:bg-[color-mix(in_srgb,var(--error)_28%,transparent)]',
    success: 'bg-[var(--success)] text-white font-bold hover:brightness-110',
    warning: 'bg-[var(--warning)] text-black font-bold hover:brightness-110',
    outline: 'border border-[color-mix(in_srgb,var(--primary)_50%,transparent)] text-[var(--primary)] hover:bg-[var(--primary-container)]',
  };
  const s = { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-base', xl: 'h-14 px-6 text-lg' }[size];
  return (
    <button {...rest} disabled={rest.disabled || loading} className={cn('inline-flex items-center justify-center gap-2 rounded-xl transition-all duration-150 active:scale-[.97] disabled:opacity-40 disabled:active:scale-100 select-none whitespace-nowrap', v[variant], s, className)}>
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

export function IconButton({ className, children, title, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...rest} title={title} aria-label={title} className={cn('w-9 h-9 rounded-lg flex items-center justify-center surface-1 border border-[var(--glass-border)] hover:border-[var(--primary)] disabled:opacity-40', className)}>{children}</button>;
}

export function Modal({ open, onClose, title, children, footer, wide, xwide, badge }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; xwide?: boolean; badge?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  // Keep the opener's device/screen tags on the portaled overlay (feedback mode reads them from the DOM).
  const [ctx, setCtx] = useState<{ device?: string; screen?: string }>({});
  const anchor = React.useCallback((el: HTMLSpanElement | null) => {
    if (!el) return;
    const device = (el.closest('[data-device]') as HTMLElement | null)?.dataset.device;
    const screen = (el.closest('[data-screen]') as HTMLElement | null)?.dataset.screen;
    setCtx((c) => (c.device === device && c.screen === screen ? c : { device, screen }));
  }, []);
  if (!open) return null;
  // Portaled to <body>: a backdrop-filter (.glass) ancestor would otherwise clip a fixed overlay to that card.
  return <><span ref={anchor} hidden />{createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal data-device={ctx.device} data-screen={ctx.screen}>
      <div className="absolute inset-0 glass-overlay" onClick={onClose} />
      <div className={cn('relative glass-strong rounded-2xl w-full max-h-[92vh] flex flex-col animate-scale-in', xwide ? 'max-w-6xl' : wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b line">
          <div className="flex items-center gap-2 min-w-0"><h2 className="text-lg font-bold truncate">{title}</h2>{badge}</div>
          <IconButton onClick={onClose} title={t('إغلاق')}><X className="w-4 h-4" /></IconButton>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-4 border-t line flex flex-wrap gap-2 justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  )}</>;
}

export function Card({ className, children, title, actions, badge }: { className?: string; children: React.ReactNode; title?: React.ReactNode; actions?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className={cn('glass rounded-xl', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b line">
          <div className="flex items-center gap-2 font-bold min-w-0">{title}{badge}</div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Pill({ tone = 'neutral', children, className, title }: { tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'violet'; children: React.ReactNode; className?: string; title?: string }) {
  const c = {
    neutral: 'surface-2 text-soft border-[var(--glass-border)]',
    primary: 'bg-[var(--primary-container)] text-[var(--primary)] border-[color-mix(in_srgb,var(--primary)_35%,transparent)]',
    success: 'bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)] border-[color-mix(in_srgb,var(--success)_35%,transparent)]',
    warning: 'bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] text-[var(--warning)] border-[color-mix(in_srgb,var(--warning)_35%,transparent)]',
    error: 'bg-[color-mix(in_srgb,var(--error)_15%,transparent)] text-[var(--error)] border-[color-mix(in_srgb,var(--error)_35%,transparent)]',
    info: 'bg-[color-mix(in_srgb,var(--info)_15%,transparent)] text-[var(--info)] border-[color-mix(in_srgb,var(--info)_35%,transparent)]',
    violet: 'bg-[rgba(168,85,247,.15)] text-[#c084fc] border-[rgba(168,85,247,.4)]',
  }[tone];
  return <span title={title} className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap', c, className)}>{children}</span>;
}

const BADGE: Record<BadgeState, { ar: string; en: string; tone: 'success' | 'info' | 'violet' }> = {
  BUILT: { ar: 'مبني', en: 'Built', tone: 'success' },
  SPECIFIED: { ar: 'متصمم', en: 'Specified', tone: 'info' },
  PROPOSED: { ar: 'مقترح', en: 'Proposed', tone: 'violet' },
};
/** Backend state badge from operations.json (backend_state) or the direction (مقترح). */
export function StateBadge({ ops, state, className }: { ops?: string[]; state?: BadgeState; className?: string }) {
  const s = state ?? badgeOfOps(ops ?? []);
  const b = BADGE[s];
  const tip = ops?.map((o) => `${o}: ${opsById.get(o)?.backend_state ?? 'PROPOSED'}`).join('\n');
  return <Pill tone={b.tone} className={className} title={tip}><span data-state-badge>{L(b)}</span></Pill>;
}

export function Field({ label, children, hint, error, className }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode; error?: string | null; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5 min-w-0', className)}>
      <span className="text-xs font-bold text-soft">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-dim">{hint}</span>}
      {error && <span className="text-[11px] text-[var(--error)]">{error}</span>}
    </label>
  );
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('glass-input w-full', props.type === 'number' || props.inputMode === 'decimal' ? 'num' : '', props.className)} />;
}
export function Select({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={cn('glass-input w-full', props.className)}>
      {options.map((o) => <option key={o.value} value={o.value} style={{ background: 'var(--card)' }}>{o.label}</option>)}
    </select>
  );
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('glass-input w-full min-h-[70px]', props.className)} />;
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 disabled:opacity-40">
      <span className={cn('w-10 h-6 rounded-full relative transition-colors', checked ? 'bg-[var(--primary)]' : 'surface-3')}>
        <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all', checked ? 'start-[18px]' : 'start-0.5')} />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1 p-1 rounded-xl surface-1 overflow-x-auto scrollbar-hide', className)}>
      {tabs.map((tb) => (
        <button key={tb.id} onClick={() => onChange(tb.id)} className={cn('px-3 h-9 rounded-lg text-sm whitespace-nowrap transition-colors', value === tb.id ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-bold' : 'text-soft hover:surface-2')}>{tb.label}</button>
      ))}
    </div>
  );
}

export function Money({ v, className, big, tone }: { v: string | null | undefined; className?: string; big?: boolean; tone?: 'primary' | 'error' | 'success' | 'dim' }) {
  const c = tone === 'primary' ? 'text-[var(--primary)]' : tone === 'error' ? 'text-[var(--error)]' : tone === 'success' ? 'text-[var(--success)]' : tone === 'dim' ? 'text-dim' : '';
  return <span className={cn('num font-bold', big ? 'text-2xl' : '', c, className)}>{money(v)}</span>;
}

export function Empty({ icon, text, children }: { icon?: React.ReactNode; text: React.ReactNode; children?: React.ReactNode }) {
  return <div className="flex flex-col items-center justify-center gap-3 py-10 text-dim text-sm text-center">{icon}<div>{text}</div>{children}</div>;
}
export function Spinner({ className }: { className?: string }) { return <Loader2 className={cn('w-5 h-5 animate-spin text-[var(--primary)]', className)} />; }

export function KV({ rows, className }: { rows: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm', className)}>
      {rows.map(([k, v], i) => (<React.Fragment key={i}><span className="text-dim">{k}</span><span className="min-w-0 break-words">{v}</span></React.Fragment>))}
    </div>
  );
}

export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warning' | 'error' | 'success'; children: React.ReactNode; action?: React.ReactNode }) {
  const Icon = tone === 'error' ? XCircle : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  const c = { info: 'glass-tinted-info', warning: 'border-[color-mix(in_srgb,var(--warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]', error: 'border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_10%,transparent)]', success: 'border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)]' }[tone];
  const ic = { info: 'text-[var(--info)]', warning: 'text-[var(--warning)]', error: 'text-[var(--error)]', success: 'text-[var(--success)]' }[tone];
  return (
    <div className={cn('flex items-start gap-2 rounded-xl border px-3 py-2 text-sm', c, tone === 'info' && 'border-[color-mix(in_srgb,var(--info)_40%,transparent)] bg-[color-mix(in_srgb,var(--info)_10%,transparent)]')}>
      <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', ic)} />
      <div className="flex-1 min-w-0">{children}</div>
      {action}
    </div>
  );
}

// ───────── toasts
export interface Toast { id: number; tone: 'info' | 'success' | 'warning' | 'error'; text: string; sub?: string; device?: string }
let toasts: Toast[] = [];
let tid = 0;
const tl = new Set<() => void>();
export function toast(tone: Toast['tone'], text: string, sub?: string, device?: string) {
  const item = { id: ++tid, tone, text, sub, device };
  toasts = [...toasts, item].slice(-5);
  tl.forEach((f) => f());
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== item.id); tl.forEach((f) => f()); }, tone === 'error' ? 7000 : 3500);
}
export function Toasts() {
  const list = useSyncExternalStore((cb) => { tl.add(cb); return () => tl.delete(cb); }, () => toasts);
  return (
    <div className="fixed bottom-4 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 z-[100] flex flex-col gap-2 w-[min(520px,92vw)] pointer-events-none">
      {list.map((x) => (
        <div key={x.id} className="pointer-events-auto animate-slide-up"><Banner tone={x.tone}><div className="font-bold">{x.device && <span className="text-dim font-normal">[{x.device}] </span>}{x.text}</div>{x.sub && <div className="text-xs text-dim mt-0.5 num" style={{ direction: 'ltr', textAlign: 'start' }}>{x.sub}</div>}</Banner></div>
      ))}
    </div>
  );
}

export function useNow(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const i = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(i); }, [ms]);
}

export function Section({ title, children, actions, badge, sub }: { title: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode; badge?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
      <div className="min-w-0"><div className="flex items-center gap-2 flex-wrap"><h1 className="text-2xl font-bold">{title}</h1>{badge}</div>{sub && <p className="text-sm text-dim mt-1">{sub}</p>}{children}</div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Table({ head, rows, empty, className }: { head: React.ReactNode[]; rows: React.ReactNode[][]; empty?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border line', className)}>
      <table className="w-full text-sm">
        <thead className="surface-1"><tr>{head.map((h, i) => <th key={i} className="text-start font-bold text-xs text-soft px-3 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={head.length} className="px-3 py-6 text-center text-dim">{empty ?? t('مفيش بيانات')}</td></tr>}
          {rows.map((r, i) => <tr key={i} className="border-t line hover:surface-1">{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

// In-page confirmation (window.confirm is blocked inside embedded frames such as claude.ai Artifacts).
type Ask = { id: number; text: string; danger?: boolean; resolve: (ok: boolean) => void };
let asks: Ask[] = [];
let askId = 0;
const al = new Set<() => void>();
export function confirmDialog(text: string, opts: { danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => { asks = [...asks, { id: ++askId, text, danger: opts.danger, resolve }]; al.forEach((f) => f()); });
}
export function ConfirmHost() {
  const list = useSyncExternalStore((cb) => { al.add(cb); return () => al.delete(cb); }, () => asks);
  const cur = list[0];
  if (!cur) return null;
  const done = (ok: boolean) => { asks = asks.filter((a) => a.id !== cur.id); al.forEach((f) => f()); cur.resolve(ok); };
  return (
    <Modal open onClose={() => done(false)} title={t('تأكيد')} footer={<><Button variant="ghost" onClick={() => done(false)}>{t('إلغاء')}</Button><Button variant={cur.danger ? 'danger' : 'primary'} onClick={() => done(true)} data-fb="confirm-ok">{t('أيوه، كمّل')}</Button></>}>
      <div className="text-sm leading-relaxed">{cur.text}</div>
    </Modal>
  );
}
