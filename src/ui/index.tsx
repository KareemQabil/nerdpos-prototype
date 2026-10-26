// UI kit in the legacy NerdPOS look (glass, cyan, Almarai, rounded) — refined for a calmer, premium feel.
//
// Existing atoms (all props unchanged, new props optional):
//   Button (+ variant "subtle", size "icon"), IconButton, Modal (+ description, size), Card (+ description, footer,
//   padding, tone, interactive), Pill (+ dot, size), StateBadge, Field (+ required, label optional), Input, Select,
//   Textarea, Switch, Tabs (+ count/icon/fb per tab, variant "underline"), Money, Empty, Spinner, KV, Banner (+ title),
//   toast/Toasts, useNow, Section (page header), Table (+ align, loading, onRowClick, maxHeight, dense, rowKey),
//   confirmDialog (+ title, confirmLabel, cancelLabel, detail) / ConfirmHost.
// New building blocks (see scratchpad UI_KIT.md for examples):
//   Page                 page wrapper (vertical rhythm)
//   PageHeader           title + one plain sentence + small state badge (ops/badge) + actions at the end
//   StatGrid / StatCard  KPI tiles (label, value, hint, tone, icon, delta, onClick)
//   Drawer               side sheet sliding from the inline-end edge (RTL aware), portaled like Modal
//   Skeleton / SkeletonCard / SkeletonRows   loading placeholders
//   EmptyState           icon, title, text and the next action
//   Toolbar (+ Toolbar.Spacer), SearchInput, FilterChips   list filter bar
//   SegmentedControl     2–5 exclusive choices
//   Stepper              steps of a flow (horizontal / vertical)
//   Timeline             history list with dots and times
//   InputGroup, Kbd, Avatar, Divider
import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle, CheckCircle2, Info, XCircle, Search, Check, Inbox } from 'lucide-react';
import { cn, money } from '../lib/format';
import { t, L } from '../i18n';
import type { BadgeState } from '../mock/contracts';
import { badgeOfOps, opsById } from '../mock/contracts';
import { useTech } from '../app/tech';
import { deviceName } from '../demo/people';

// ───────── buttons
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning' | 'outline' | 'subtle';
type BtnSize = 'sm' | 'md' | 'lg' | 'xl' | 'icon';
export function Button({ variant = 'secondary', size = 'md', className, loading, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize; loading?: boolean }) {
  const v: Record<BtnVariant, string> = {
    primary: 'btn-primary-grad font-bold hover:brightness-110',
    secondary: 'btn-secondary font-bold text-[var(--foreground)]',
    ghost: 'text-soft hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]',
    subtle: 'bg-[var(--primary-container)] text-[var(--primary)] font-bold hover:bg-[color-mix(in_srgb,var(--primary)_22%,transparent)]',
    danger: 'bg-[color-mix(in_srgb,var(--error)_14%,transparent)] border border-[color-mix(in_srgb,var(--error)_40%,transparent)] text-[var(--error)] font-bold hover:bg-[color-mix(in_srgb,var(--error)_24%,transparent)]',
    success: 'bg-[var(--success)] text-white font-bold hover:brightness-110 shadow-[0_6px_18px_-8px_var(--success)]',
    warning: 'bg-[var(--warning)] text-black font-bold hover:brightness-110',
    outline: 'border border-[color-mix(in_srgb,var(--primary)_45%,transparent)] text-[var(--primary)] font-bold hover:bg-[var(--primary-container)]',
  };
  const s: Record<BtnSize, string> = { sm: 'h-8 px-3 text-xs rounded-lg', md: 'h-10 px-4 text-sm rounded-xl', lg: 'h-12 px-5 text-base rounded-xl', xl: 'h-14 px-6 text-lg rounded-2xl', icon: 'h-10 w-10 p-0 rounded-xl' };
  return (
    <button {...rest} aria-busy={loading || undefined} disabled={rest.disabled || loading} className={cn('inline-flex items-center justify-center gap-2 transition-[background,border-color,color,filter,transform,box-shadow] duration-150 active:scale-[.97] disabled:opacity-45 disabled:saturate-50 disabled:active:scale-100 disabled:pointer-events-none select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]', v[variant], s[size], className)}>
      {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
      {children}
    </button>
  );
}

export function IconButton({ className, children, title, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...rest} title={title} aria-label={title} className={cn('w-9 h-9 rounded-xl flex items-center justify-center text-soft hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] border border-transparent hover:border-[var(--glass-border)] transition-colors disabled:opacity-40', className)}>{children}</button>;
}

// ───────── overlays
/** Keeps the opener's device/screen tags on a portaled overlay (feedback mode reads them from the DOM). */
function useOverlayCtx() {
  const [ctx, setCtx] = useState<{ device?: string; screen?: string }>({});
  const anchor = React.useCallback((el: HTMLSpanElement | null) => {
    if (!el) return;
    const device = (el.closest('[data-device]') as HTMLElement | null)?.dataset.device;
    const screen = (el.closest('[data-screen]') as HTMLElement | null)?.dataset.screen;
    setCtx((c) => (c.device === device && c.screen === screen ? c : { device, screen }));
  }, []);
  return { ctx, anchor };
}
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}
/** Moves focus into the panel on open and back to the opener on close. */
function useFocusIn(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el || el.contains(document.activeElement)) return;
      const first = el.querySelector<HTMLElement>('[autofocus], [data-autofocus]'); // inputs are not auto-focused (no surprise keyboard on tablets)
      (first ?? el).focus({ preventScroll: true });
    });
    return () => { cancelAnimationFrame(id); if (prev && document.contains(prev)) prev.focus?.({ preventScroll: true }); };
  }, [open]);
  return ref;
}

export function Modal({ open, onClose, title, children, footer, wide, xwide, badge, description, size }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; xwide?: boolean; badge?: React.ReactNode; description?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEscape(open, onClose);
  const { ctx, anchor } = useOverlayCtx();
  const panel = useFocusIn(open);
  const titleId = useId();
  if (!open) return null;
  const w = size === 'sm' ? 'max-w-md' : size === 'lg' || (!size && wide) ? 'max-w-3xl' : size === 'xl' || (!size && xwide) ? 'max-w-6xl' : 'max-w-lg';
  // Portaled to <body>: a backdrop-filter (.glass) ancestor would otherwise clip a fixed overlay to that card.
  return <><span ref={anchor} hidden />{createPortal(
    <div className="fixed inset-x-0 bottom-0 top-12 z-[70] flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal aria-labelledby={titleId} data-device={ctx.device} data-screen={ctx.screen}>
      <div className="absolute inset-0 glass-overlay animate-fade-in" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className={cn('relative overlay-panel rounded-2xl w-full max-h-[calc(100vh-5rem)] flex flex-col animate-scale-in outline-none', w)}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-wrap"><h2 id={titleId} className="text-lg font-bold leading-snug min-w-0">{title}</h2>{badge}</div>
            {description && <p className="text-sm text-dim mt-1 leading-relaxed">{description}</p>}
          </div>
          <IconButton onClick={onClose} title={t('إغلاق')} className="-me-2 -mt-0.5 shrink-0"><X className="w-4 h-4" /></IconButton>
        </div>
        <div className="px-5 pb-5 pt-1 overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t line flex flex-wrap gap-2 justify-end items-center overlay-footer rounded-b-2xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  )}</>;
}

/** Side sheet for details/edit of one row. Slides in from the inline-end edge (left in Arabic). */
export function Drawer({ open, onClose, title, children, footer, badge, description, width = 'md', icon }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; badge?: React.ReactNode; description?: React.ReactNode; width?: 'sm' | 'md' | 'lg' | 'xl'; icon?: React.ReactNode }) {
  useEscape(open, onClose);
  const { ctx, anchor } = useOverlayCtx();
  const panel = useFocusIn(open);
  const titleId = useId();
  if (!open) return null;
  const w = { sm: 'w-[min(380px,100vw)]', md: 'w-[min(480px,100vw)]', lg: 'w-[min(640px,100vw)]', xl: 'w-[min(860px,100vw)]' }[width];
  return <><span ref={anchor} hidden />{createPortal(
    <div className="fixed inset-x-0 bottom-0 top-12 z-[70]" role="dialog" aria-modal aria-labelledby={titleId} data-device={ctx.device} data-screen={ctx.screen}>
      <div className="absolute inset-0 glass-overlay animate-fade-in" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className={cn('absolute inset-y-0 end-0 overlay-panel drawer-panel flex flex-col outline-none rounded-none border-y-0 border-e-0', w)}>
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b line">
          <div className="flex items-start gap-3 min-w-0">
            {icon && <span className="w-9 h-9 rounded-xl bg-[var(--primary-container)] text-[var(--primary)] flex items-center justify-center shrink-0 [&_svg]:w-5 [&_svg]:h-5">{icon}</span>}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap min-w-0"><h2 id={titleId} className="text-lg font-bold leading-snug min-w-0 break-words">{title}</h2>{badge}</div>
              {description && <p className="text-sm text-dim mt-0.5 leading-relaxed">{description}</p>}
            </div>
          </div>
          <IconButton onClick={onClose} title={t('إغلاق')} className="-me-2 shrink-0"><X className="w-4 h-4" /></IconButton>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t line flex flex-wrap gap-2 justify-end items-center overlay-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )}</>;
}

// ───────── surfaces
type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';
const TONE_TEXT: Record<Tone, string> = { neutral: '', primary: 'text-[var(--primary)]', success: 'text-[var(--success)]', warning: 'text-[var(--warning)]', error: 'text-[var(--error)]', info: 'text-[var(--info)]' };
const TONE_VAR: Record<Tone, string> = { neutral: 'var(--text-soft)', primary: 'var(--primary)', success: 'var(--success)', warning: 'var(--warning)', error: 'var(--error)', info: 'var(--info)' };

export function Card({ className, children, title, actions, badge, description, footer, padding = 'md', tone, interactive, onClick, ...rest }: { className?: string; children: React.ReactNode; title?: React.ReactNode; actions?: React.ReactNode; badge?: React.ReactNode; description?: React.ReactNode; footer?: React.ReactNode; padding?: 'none' | 'sm' | 'md' | 'lg'; tone?: Exclude<Tone, 'neutral'>; interactive?: boolean; onClick?: () => void } & Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'onClick'>) {
  const p = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' }[padding];
  const head = title || actions;
  return (
    <div {...rest} onClick={onClick} className={cn('glass card-surface rounded-2xl min-w-0', interactive && 'card-interactive cursor-pointer', className)} style={tone ? { ...rest.style, borderInlineStartWidth: 3, borderInlineStartColor: TONE_VAR[tone] } : rest.style} data-tone={tone}>
      {head && (
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b line">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-bold min-w-0 flex-wrap leading-snug">{title}{badge}</div>
            {description && <div className="text-xs text-dim mt-0.5 leading-relaxed">{description}</div>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">{actions}</div>}
        </div>
      )}
      <div className={p}>{children}</div>
      {footer && <div className="px-4 py-3 border-t line flex flex-wrap items-center gap-2 justify-end">{footer}</div>}
    </div>
  );
}

export function Pill({ tone = 'neutral', children, className, title, dot, size = 'md' }: { tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'violet'; children: React.ReactNode; className?: string; title?: string; dot?: boolean; size?: 'sm' | 'md' }) {
  const c = {
    neutral: 'bg-[var(--surface-2)] text-soft border-[var(--glass-border)]',
    primary: 'bg-[var(--primary-container)] text-[var(--primary)] border-[color-mix(in_srgb,var(--primary)_30%,transparent)]',
    success: 'bg-[color-mix(in_srgb,var(--success)_13%,transparent)] text-[var(--success)] border-[color-mix(in_srgb,var(--success)_30%,transparent)]',
    warning: 'bg-[color-mix(in_srgb,var(--warning)_13%,transparent)] text-[var(--warning-text)] border-[color-mix(in_srgb,var(--warning)_32%,transparent)]',
    error: 'bg-[color-mix(in_srgb,var(--error)_13%,transparent)] text-[var(--error)] border-[color-mix(in_srgb,var(--error)_30%,transparent)]',
    info: 'bg-[color-mix(in_srgb,var(--info)_13%,transparent)] text-[var(--info)] border-[color-mix(in_srgb,var(--info)_30%,transparent)]',
    violet: 'bg-[color-mix(in_srgb,var(--violet)_14%,transparent)] text-[var(--violet)] border-[color-mix(in_srgb,var(--violet)_32%,transparent)]',
  }[tone];
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-full font-bold border whitespace-nowrap leading-none', size === 'sm' ? 'px-1.5 py-[3px] text-[10px]' : 'px-2 py-1 text-[11px]', c, className)}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />}
      {children}
    </span>
  );
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
  return <Pill tone={b.tone} size="sm" className={cn('opacity-90', className)} title={tip}><span data-state-badge>{L(b)}</span></Pill>;
}

// ───────── form controls
export function Field({ label, children, hint, error, className, required }: { label?: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode; error?: string | null; className?: string; required?: boolean }) {
  return (
    <label className={cn('flex flex-col gap-1.5 min-w-0', className)}>
      {label && <span className="text-xs font-bold text-soft leading-snug">{label}{required && <span className="text-[var(--error)] ms-0.5" aria-hidden>*</span>}</span>}
      {children}
      {hint && !error && <span className="text-[11px] text-dim leading-relaxed">{hint}</span>}
      {error && <span className="text-[11px] text-[var(--error)] flex items-center gap-1"><AlertTriangle className="w-3 h-3 shrink-0" />{error}</span>}
    </label>
  );
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('glass-input w-full', props.type === 'number' || props.inputMode === 'decimal' || props.inputMode === 'numeric' ? 'num' : '', props.className)} />;
}
export function Select({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...props} className={cn('glass-input glass-select w-full', props.className)}>
      {options.map((o) => <option key={o.value} value={o.value} style={{ background: 'var(--card)', color: 'var(--foreground)' }}>{o.label}</option>)}
    </select>
  );
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('glass-input w-full min-h-[76px] leading-relaxed', props.className)} />;
}
/** An input with a text/icon before or after it (currency, unit, %). */
export function InputGroup({ prefix, suffix, children, className }: { prefix?: React.ReactNode; suffix?: React.ReactNode; children: React.ReactElement; className?: string }) {
  return (
    <div className={cn('relative flex items-center min-w-0', className)}>
      {prefix && <span className="absolute start-3 text-xs text-dim pointer-events-none flex items-center">{prefix}</span>}
      {React.cloneElement(children as React.ReactElement<any>, { className: cn((children.props as any).className, prefix ? 'ps-10' : '', suffix ? 'pe-12' : '') })}
      {suffix && <span className="absolute end-3 text-xs text-dim pointer-events-none flex items-center">{suffix}</span>}
    </div>
  );
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 disabled:opacity-40 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">
      <span className={cn('w-10 h-6 rounded-full relative transition-colors shrink-0 border', checked ? 'bg-[var(--primary)] border-transparent' : 'bg-[var(--surface-3)] border-[var(--glass-border)]')}>
        <span className={cn('absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all', checked ? 'start-[19px]' : 'start-0.5')} />
      </span>
      {label && <span className="text-sm text-start">{label}</span>}
    </button>
  );
}

export function SearchInput({ value, onChange, placeholder, className, autoFocus, onKeyDown, ...rest }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean; onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>; 'data-fb'?: string }) {
  return (
    <div className={cn('relative min-w-[180px] flex-1 max-w-sm', className)}>
      <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
      <input type="search" value={value} autoFocus={autoFocus} onKeyDown={onKeyDown} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? t('دوّر…')} data-fb={rest['data-fb']} className="glass-input w-full ps-9 pe-8 h-10 !py-0" />
      {value && <button type="button" onClick={() => onChange('')} title={t('امسح')} aria-label={t('امسح')} className="absolute end-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-dim hover:text-[var(--foreground)] hover:bg-[var(--surface-2)]"><X className="w-3.5 h-3.5" /></button>}
    </div>
  );
}

export function FilterChips<T extends string>({ options, value, onChange, className }: { options: { id: T; label: React.ReactNode; count?: number; tone?: Tone; fb?: string }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)} role="radiogroup">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} data-fb={o.fb} onClick={() => onChange(o.id)}
            className={cn('h-8 px-3 rounded-full text-xs font-bold border inline-flex items-center gap-1.5 transition-colors whitespace-nowrap', on ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent' : 'bg-[var(--surface-1)] border-[var(--glass-border)] text-soft hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]')}>
            {o.label}
            {o.count !== undefined && <span className={cn('num min-w-[18px] h-[18px] px-1 rounded-full text-[10px] inline-flex items-center justify-center', on ? 'bg-black/15' : o.tone && o.tone !== 'neutral' && o.count > 0 ? 'bg-[var(--surface-3)] ' + TONE_TEXT[o.tone] : 'bg-[var(--surface-3)]')}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange, size = 'md', className, full }: { options: { id: T; label: React.ReactNode; icon?: React.ReactNode; count?: number; fb?: string; disabled?: boolean }[]; value: T; onChange: (v: T) => void; size?: 'sm' | 'md' | 'lg'; className?: string; full?: boolean }) {
  const h = { sm: 'h-8 text-xs px-2.5', md: 'h-9 text-sm px-3', lg: 'h-12 text-base px-4' }[size];
  return (
    <div className={cn('inline-flex p-1 gap-1 rounded-xl bg-[var(--surface-1)] border border-[var(--glass-border)] max-w-full overflow-x-auto scrollbar-hide', full && 'flex w-full', className)} role="radiogroup">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} disabled={o.disabled} data-fb={o.fb} onClick={() => onChange(o.id)}
            className={cn('rounded-lg inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-all disabled:opacity-40', h, full && 'flex-1', on ? 'bg-[var(--card-raised)] text-[var(--foreground)] font-bold shadow-[0_1px_3px_rgba(0,0,0,.25)] ring-1 ring-[var(--glass-border)]' : 'text-soft hover:text-[var(--foreground)]')}>
            {o.icon && <span className={cn('[&_svg]:w-4 [&_svg]:h-4', on && 'text-[var(--primary)]')}>{o.icon}</span>}
            {o.label}
            {o.count !== undefined && <span className="num text-[10px] text-dim">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className, variant = 'pill' }: { tabs: { id: T; label: React.ReactNode; count?: number; icon?: React.ReactNode; fb?: string }[]; value: T; onChange: (v: T) => void; className?: string; variant?: 'pill' | 'underline' }) {
  if (variant === 'underline') {
    return (
      <div className={cn('flex gap-1 border-b line overflow-x-auto scrollbar-hide', className)} role="tablist">
        {tabs.map((tb) => {
          const on = value === tb.id;
          return (
            <button key={tb.id} role="tab" aria-selected={on} data-fb={tb.fb} onClick={() => onChange(tb.id)} className={cn('relative px-3 h-10 text-sm whitespace-nowrap inline-flex items-center gap-1.5 transition-colors', on ? 'text-[var(--foreground)] font-bold' : 'text-dim hover:text-[var(--foreground)]')}>
              {tb.icon && <span className="[&_svg]:w-4 [&_svg]:h-4">{tb.icon}</span>}{tb.label}
              {tb.count !== undefined && <span className={cn('num text-[10px] min-w-[18px] h-[18px] px-1 rounded-full inline-flex items-center justify-center', on ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'bg-[var(--surface-2)]')}>{tb.count}</span>}
              {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--primary)]" />}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div className={cn('flex gap-1 p-1 rounded-xl bg-[var(--surface-1)] border border-[var(--glass-border)] overflow-x-auto scrollbar-hide max-w-full w-fit', className)} role="tablist">
      {tabs.map((tb) => {
        const on = value === tb.id;
        return (
          <button key={tb.id} role="tab" aria-selected={on} data-fb={tb.fb} onClick={() => onChange(tb.id)} className={cn('px-3 h-9 rounded-lg text-sm whitespace-nowrap transition-colors inline-flex items-center gap-1.5', on ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-bold shadow-[0_2px_10px_-4px_var(--primary-glow)]' : 'text-soft hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]')}>
            {tb.icon && <span className="[&_svg]:w-4 [&_svg]:h-4">{tb.icon}</span>}{tb.label}
            {tb.count !== undefined && <span className={cn('num text-[10px] min-w-[18px] h-[18px] px-1 rounded-full inline-flex items-center justify-center', on ? 'bg-black/15' : 'bg-[var(--surface-3)]')}>{tb.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ───────── values
export function Money({ v, className, big, tone }: { v: string | null | undefined; className?: string; big?: boolean; tone?: 'primary' | 'error' | 'success' | 'dim' }) {
  const c = tone === 'primary' ? 'text-[var(--primary)]' : tone === 'error' ? 'text-[var(--error)]' : tone === 'success' ? 'text-[var(--success)]' : tone === 'dim' ? 'text-dim' : '';
  return <span className={cn('num font-bold whitespace-nowrap', big ? 'text-2xl tracking-tight' : '', c, className)}>{money(v)}</span>;
}

export function KV({ rows, className }: { rows: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm', className)}>
      {rows.map(([k, v], i) => (<React.Fragment key={i}><span className="text-dim">{k}</span><span className="min-w-0 break-words">{v}</span></React.Fragment>))}
    </div>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn('num inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md border border-[var(--glass-border)] bg-[var(--surface-2)] text-[10px] font-bold text-soft shadow-[inset_0_-1px_0_var(--line)]', className)}>{children}</kbd>;
}

const AVATAR_TONES = ['from-cyan-400 to-blue-600', 'from-emerald-400 to-teal-600', 'from-amber-400 to-orange-600', 'from-pink-400 to-rose-600', 'from-violet-400 to-purple-600', 'from-sky-400 to-indigo-600'];
export function Avatar({ name, size = 'md', className }: { name: string | null | undefined; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const n = (name ?? '?').replace(/^(ال)?(الشيف|الحاج|عم)\s+/, '').trim();
  const ch = n.charAt(0) || '?';
  const tone = AVATAR_TONES[[...(name ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  const s = { sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-12 h-12 text-lg' }[size];
  return <span className={cn('rounded-full bg-gradient-to-br text-slate-950 font-extrabold flex items-center justify-center shrink-0 ring-2 ring-[var(--glass-border)]', tone, s, className)} aria-hidden>{ch}</span>;
}

export function Divider({ label, className }: { label?: React.ReactNode; className?: string }) {
  if (!label) return <div className={cn('h-px bg-[var(--line)] my-3', className)} />;
  return <div className={cn('flex items-center gap-3 my-3 text-[11px] font-bold text-dim', className)}><span className="h-px flex-1 bg-[var(--line)]" />{label}<span className="h-px flex-1 bg-[var(--line)]" /></div>;
}

// ───────── states
export function Skeleton({ className, lines }: { className?: string; lines?: number }) {
  if (lines && lines > 1) return <div className={cn('space-y-2', className)}>{Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton h-3.5 rounded-md" style={{ width: `${100 - ((i * 17) % 40)}%` }} />)}</div>;
  return <div className={cn('skeleton rounded-md', className ?? 'h-4 w-full')} />;
}
export function SkeletonCard({ className, lines = 3 }: { className?: string; lines?: number }) {
  return <div className={cn('glass rounded-2xl p-4 space-y-3', className)}><Skeleton className="h-4 w-1/3" /><Skeleton lines={lines} /></div>;
}
export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }, (_, i) => <div key={i} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>{Array.from({ length: cols }, (_, j) => <Skeleton key={j} className={cn('h-4', j === 0 ? 'w-4/5' : 'w-3/5')} />)}</div>)}</div>;
}

export function EmptyState({ icon, title, text, action, compact, className }: { icon?: React.ReactNode; title?: React.ReactNode; text?: React.ReactNode; action?: React.ReactNode; compact?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 py-6' : 'gap-3 py-12', className)}>
      <span className={cn('rounded-2xl bg-[var(--surface-2)] border border-[var(--glass-border)] text-dim flex items-center justify-center', compact ? 'w-10 h-10 [&_svg]:w-5 [&_svg]:h-5' : 'w-14 h-14 [&_svg]:w-7 [&_svg]:h-7')}>{icon ?? <Inbox />}</span>
      {title && <div className={cn('font-bold text-[var(--foreground)]', compact ? 'text-sm' : 'text-base')}>{title}</div>}
      {text && <div className="text-sm text-dim max-w-md leading-relaxed">{text}</div>}
      {action && <div className="mt-1 flex flex-wrap gap-2 justify-center">{action}</div>}
    </div>
  );
}
/** Older empty state (kept): same look as EmptyState. */
export function Empty({ icon, text, children }: { icon?: React.ReactNode; text: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-dim text-sm text-center">
      {icon && <span className="w-11 h-11 rounded-2xl bg-[var(--surface-2)] border border-[var(--glass-border)] flex items-center justify-center [&_svg]:w-5 [&_svg]:h-5">{icon}</span>}
      <div className="max-w-md leading-relaxed">{text}</div>{children}
    </div>
  );
}
export function Spinner({ className }: { className?: string }) { return <Loader2 className={cn('w-5 h-5 animate-spin text-[var(--primary)]', className)} />; }

export function Banner({ tone = 'info', children, action, title, className }: { tone?: 'info' | 'warning' | 'error' | 'success'; children: React.ReactNode; action?: React.ReactNode; title?: React.ReactNode; className?: string }) {
  const Icon = tone === 'error' ? XCircle : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  const c = {
    info: 'border-[color-mix(in_srgb,var(--info)_32%,transparent)] bg-[color-mix(in_srgb,var(--info)_9%,var(--banner-base))]',
    warning: 'border-[color-mix(in_srgb,var(--warning)_36%,transparent)] bg-[color-mix(in_srgb,var(--warning)_9%,var(--banner-base))]',
    error: 'border-[color-mix(in_srgb,var(--error)_36%,transparent)] bg-[color-mix(in_srgb,var(--error)_9%,var(--banner-base))]',
    success: 'border-[color-mix(in_srgb,var(--success)_36%,transparent)] bg-[color-mix(in_srgb,var(--success)_9%,var(--banner-base))]',
  }[tone];
  const ic = { info: 'text-[var(--info)]', warning: 'text-[var(--warning)]', error: 'text-[var(--error)]', success: 'text-[var(--success)]' }[tone];
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed', c, className)} role={tone === 'error' ? 'alert' : undefined}>
      <Icon className={cn('w-4 h-4 mt-[3px] shrink-0', ic)} />
      <div className="flex-1 min-w-0">{title && <div className="font-bold mb-0.5">{title}</div>}{children}</div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

// ───────── toasts
export interface Toast { id: number; tone: 'info' | 'success' | 'warning' | 'error'; text: string; sub?: string; device?: string }
let toasts: Toast[] = [];
let tid = 0;
const tl = new Set<() => void>();
const dropToast = (id: number) => { toasts = toasts.filter((x) => x.id !== id); tl.forEach((f) => f()); };
export function toast(tone: Toast['tone'], text: string, sub?: string, device?: string) {
  const item = { id: ++tid, tone, text, sub, device };
  toasts = [...toasts, item].slice(-4);
  tl.forEach((f) => f());
  setTimeout(() => dropToast(item.id), tone === 'error' ? 7000 : 3500);
}
// A toast sub-line is shown to demo users only when it is plain Arabic; technical sub-lines
// ("Auth.Login 200 · DEMO-ADMIN-1", "CONCURRENCY_CONFLICT 409") appear only with technical details on.
const plainSub = (s: string) => /[؀-ۿ]/.test(s) && !/[A-Z]{2,}_[A-Z]|\b[A-Z][a-z]+\.[A-Z][a-z]+|\b\d{3}\b|X-Command|Idempotent/.test(s);
export function Toasts() {
  const list = useSyncExternalStore((cb) => { tl.add(cb); return () => tl.delete(cb); }, () => toasts);
  const tech = useTech();
  return (
    <div className="fixed bottom-4 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 z-[100] flex flex-col gap-2 w-[min(460px,92vw)] pointer-events-none" aria-live="polite">
      {list.map((x) => {
        const Icon = x.tone === 'error' ? XCircle : x.tone === 'warning' ? AlertTriangle : x.tone === 'success' ? CheckCircle2 : Info;
        return (
          <div key={x.id} className="pointer-events-auto animate-slide-up toast-card rounded-2xl px-3.5 py-3 flex items-start gap-3" data-tone={x.tone}>
            <span className={cn('w-7 h-7 rounded-full flex items-center justify-center shrink-0', { info: 'bg-[color-mix(in_srgb,var(--info)_18%,transparent)] text-[var(--info)]', success: 'bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[var(--success)]', warning: 'bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-[var(--warning)]', error: 'bg-[color-mix(in_srgb,var(--error)_18%,transparent)] text-[var(--error)]' }[x.tone])}><Icon className="w-4 h-4" /></span>
            <div className="flex-1 min-w-0 text-sm">
              {x.device && <div className="text-[11px] text-dim leading-tight mb-0.5">{tech ? `[${x.device}]` : deviceName(x.device)}</div>}
              <div className="font-bold leading-snug">{x.text}</div>
              {x.sub && (tech || plainSub(x.sub)) && <div className={cn('text-xs text-dim mt-0.5', tech && !plainSub(x.sub) && 'num')} style={tech && !plainSub(x.sub) ? { direction: 'ltr', textAlign: 'start' } : undefined}>{x.sub}</div>}
            </div>
            <button onClick={() => dropToast(x.id)} className="w-6 h-6 rounded-md flex items-center justify-center text-dim hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] shrink-0" title={t('إغلاق')} aria-label={t('إغلاق')}><X className="w-3.5 h-3.5" /></button>
          </div>
        );
      })}
    </div>
  );
}

export function useNow(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const i = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(i); }, [ms]);
}

// ───────── page structure
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('space-y-4 max-w-[1680px] mx-auto', className)}>{children}</div>;
}

/** Page header: title, one plain sentence of what the screen is for, small state badge, primary action at the end. */
export function PageHeader({ title, description, badge, ops, state, actions, icon, meta, children, className }: { title: React.ReactNode; description?: React.ReactNode; badge?: React.ReactNode; ops?: string[]; state?: BadgeState; actions?: React.ReactNode; icon?: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const b = badge ?? (ops || state ? <StateBadge ops={ops} state={state} /> : null);
  return (
    <div className={cn('flex items-start justify-between gap-x-4 gap-y-3 flex-wrap mb-5', className)} data-page-header>
      <div className="flex items-start gap-3 min-w-0 flex-1 basis-[320px]">
        {icon && <span className="w-10 h-10 rounded-xl bg-[var(--primary-container)] text-[var(--primary)] border border-[color-mix(in_srgb,var(--primary)_25%,transparent)] flex items-center justify-center shrink-0 [&_svg]:w-5 [&_svg]:h-5 mt-0.5">{icon}</span>}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap"><h1 className="text-[22px] leading-tight font-extrabold tracking-tight">{title}</h1>{b}</div>
          {description && <p className="text-sm text-dim mt-1 leading-relaxed max-w-3xl">{description}</p>}
          {meta && <div className="flex items-center gap-2 flex-wrap mt-2">{meta}</div>}
          {children}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap justify-end">{actions}</div>}
    </div>
  );
}
/** Older page header (kept, same look as PageHeader). */
export function Section({ title, children, actions, badge, sub }: { title: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode; badge?: React.ReactNode; sub?: React.ReactNode }) {
  return <PageHeader title={title} description={sub} badge={badge} actions={actions}>{children}</PageHeader>;
}

export function StatGrid({ children, className, min = 180 }: { children: React.ReactNode; className?: string; min?: number }) {
  return <div className={cn('grid gap-3', className)} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))` }}>{children}</div>;
}
export function StatCard({ label, value, hint, tone = 'neutral', icon, delta, onClick, fb, className, loading }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone; icon?: React.ReactNode; delta?: { text: React.ReactNode; tone?: Tone }; onClick?: () => void; fb?: string; className?: string; loading?: boolean }) {
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick} data-fb={fb} className={cn('glass card-surface rounded-2xl px-4 py-3.5 text-start min-w-0 flex flex-col gap-1', onClick && 'card-interactive cursor-pointer', className)}>
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-xs text-soft font-bold truncate">{label}</span>
        {icon && <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0 [&_svg]:w-4 [&_svg]:h-4', tone === 'neutral' ? 'bg-[var(--surface-2)] text-dim' : 'bg-[color-mix(in_srgb,currentColor_14%,transparent)] ' + TONE_TEXT[tone])}>{icon}</span>}
      </div>
      {loading ? <Skeleton className="h-7 w-24 mt-1" /> : <div className={cn('text-2xl font-extrabold tracking-tight num leading-tight truncate', TONE_TEXT[tone])} style={{ textAlign: 'start' }}>{value}</div>}
      {(hint || delta) && <div className="flex items-center gap-2 text-[11px] text-dim min-w-0">{delta && <span className={cn('font-bold num', TONE_TEXT[delta.tone ?? 'neutral'])}>{delta.text}</span>}{hint && <span className="truncate">{hint}</span>}</div>}
    </Comp>
  );
}

function ToolbarBase({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex items-center gap-2 flex-wrap mb-3', className)} data-toolbar>{children}</div>;
}
export const Toolbar = Object.assign(ToolbarBase, { Spacer: () => <div className="flex-1 min-w-0" /> });

export function Stepper({ steps, current, onStep, orientation = 'horizontal', className }: { steps: { label: React.ReactNode; hint?: React.ReactNode }[]; current: number; onStep?: (i: number) => void; orientation?: 'horizontal' | 'vertical'; className?: string }) {
  const dot = (i: number) => {
    const done = i < current, on = i === current;
    return <span className={cn('w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold num shrink-0 border transition-colors', done ? 'bg-[var(--success)] border-transparent text-white' : on ? 'bg-[var(--primary)] border-transparent text-[var(--primary-foreground)] shadow-[0_0_0_4px_var(--primary-container)]' : 'bg-[var(--surface-2)] border-[var(--glass-border)] text-dim')}>{done ? <Check className="w-3.5 h-3.5" /> : i + 1}</span>;
  };
  if (orientation === 'vertical') {
    return (
      <ol className={cn('space-y-0', className)}>
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">{dot(i)}{i < steps.length - 1 && <span className={cn('w-px flex-1 min-h-[16px] my-1', i < current ? 'bg-[var(--success)]' : 'bg-[var(--line)]')} />}</div>
            <button type="button" disabled={!onStep} onClick={() => onStep?.(i)} className="text-start pb-4 min-w-0 disabled:cursor-default">
              <div className={cn('text-sm leading-7', i === current ? 'font-bold' : i < current ? 'text-soft' : 'text-dim')}>{s.label}</div>
              {s.hint && <div className="text-[11px] text-dim">{s.hint}</div>}
            </button>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className={cn('flex items-start gap-2 overflow-x-auto scrollbar-hide', className)}>
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-2 min-w-0 flex-1 last:flex-none">
          <button type="button" disabled={!onStep} onClick={() => onStep?.(i)} className="flex items-center gap-2 min-w-0 disabled:cursor-default">
            {dot(i)}
            <span className="min-w-0 text-start"><span className={cn('block text-sm whitespace-nowrap', i === current ? 'font-bold' : i < current ? 'text-soft' : 'text-dim')}>{s.label}</span>{s.hint && <span className="block text-[11px] text-dim truncate">{s.hint}</span>}</span>
          </button>
          {i < steps.length - 1 && <span className={cn('h-px flex-1 min-w-[16px]', i < current ? 'bg-[var(--success)]' : 'bg-[var(--line)]')} />}
        </li>
      ))}
    </ol>
  );
}

export function Timeline({ items, className, empty }: { items: { id?: string | number; title: React.ReactNode; time?: React.ReactNode; text?: React.ReactNode; tone?: Tone; icon?: React.ReactNode; meta?: React.ReactNode }[]; className?: string; empty?: React.ReactNode }) {
  if (items.length === 0) return <>{empty ?? <Empty text={t('مفيش حاجة اتسجلت لسه')} />}</>;
  return (
    <ol className={cn('relative', className)}>
      {items.map((it, i) => (
        <li key={it.id ?? i} className="relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 && <span className="absolute top-7 bottom-0 start-[13px] w-px bg-[var(--line)]" />}
          <span className={cn('relative z-[1] w-7 h-7 rounded-full flex items-center justify-center shrink-0 border [&_svg]:w-3.5 [&_svg]:h-3.5', it.tone && it.tone !== 'neutral' ? 'border-transparent bg-[color-mix(in_srgb,currentColor_16%,var(--card))] ' + TONE_TEXT[it.tone] : 'border-[var(--glass-border)] bg-[var(--card)] text-dim')}>{it.icon ?? <span className="w-2 h-2 rounded-full bg-current" />}</span>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-baseline justify-between gap-3 flex-wrap"><div className="text-sm font-bold leading-snug min-w-0">{it.title}</div>{it.time && <div className="text-[11px] text-dim num shrink-0">{it.time}</div>}</div>
            {it.text && <div className="text-xs text-soft mt-0.5 leading-relaxed">{it.text}</div>}
            {it.meta && <div className="mt-1 flex flex-wrap gap-1.5">{it.meta}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Table({ head, rows, empty, className, align, loading, onRowClick, maxHeight, dense, rowKey, rowClassName }: { head: React.ReactNode[]; rows: React.ReactNode[][]; empty?: React.ReactNode; className?: string; align?: ('start' | 'end' | 'center' | undefined)[]; loading?: boolean; onRowClick?: (i: number) => void; maxHeight?: number | string; dense?: boolean; rowKey?: (i: number) => React.Key; rowClassName?: (i: number) => string | undefined }) {
  const al = (j: number) => (align?.[j] === 'end' ? 'text-end' : align?.[j] === 'center' ? 'text-center' : 'text-start');
  const py = dense ? 'py-1.5' : 'py-2.5';
  return (
    <div className={cn('overflow-auto rounded-xl border line table-wrap', className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full text-sm border-separate border-spacing-0">
        <thead><tr>{head.map((h, i) => <th key={i} className={cn('table-head sticky top-0 z-[1] font-bold text-[11px] text-soft px-3 py-2.5 whitespace-nowrap border-b line', al(i))}>{h}</th>)}</tr></thead>
        <tbody>
          {loading && rows.length === 0 && Array.from({ length: 4 }, (_, i) => <tr key={`sk${i}`}>{head.map((_, j) => <td key={j} className={cn('px-3 border-b line', py)}><Skeleton className={cn('h-4', j === 0 ? 'w-3/4' : 'w-1/2', align?.[j] === 'end' && 'ms-auto')} /></td>)}</tr>)}
          {!loading && rows.length === 0 && <tr><td colSpan={head.length} className="px-3 py-8 text-center text-dim">{empty ?? t('مفيش بيانات')}</td></tr>}
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(i) : i} onClick={onRowClick ? () => onRowClick(i) : undefined} className={cn('table-row transition-colors', onRowClick && 'cursor-pointer', rowClassName?.(i))}>
              {r.map((c, j) => <td key={j} className={cn('px-3 align-middle border-b line', py, al(j))}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────── confirm
// In-page confirmation (window.confirm is blocked inside embedded frames such as claude.ai Artifacts).
type Ask = { id: number; text: string; danger?: boolean; title?: string; confirmLabel?: string; cancelLabel?: string; detail?: React.ReactNode; resolve: (ok: boolean) => void };
let asks: Ask[] = [];
let askId = 0;
const al = new Set<() => void>();
export function confirmDialog(text: string, opts: { danger?: boolean; title?: string; confirmLabel?: string; cancelLabel?: string; detail?: React.ReactNode } = {}): Promise<boolean> {
  return new Promise((resolve) => { asks = [...asks, { id: ++askId, text, ...opts, resolve }]; al.forEach((f) => f()); });
}
export function ConfirmHost() {
  const list = useSyncExternalStore((cb) => { al.add(cb); return () => al.delete(cb); }, () => asks);
  const cur = list[0];
  if (!cur) return null;
  const done = (ok: boolean) => { asks = asks.filter((a) => a.id !== cur.id); al.forEach((f) => f()); cur.resolve(ok); };
  const Icon = cur.danger ? AlertTriangle : Info;
  return (
    <Modal open size="sm" onClose={() => done(false)} title={<span className="flex items-center gap-2.5"><span className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0', cur.danger ? 'bg-[color-mix(in_srgb,var(--error)_16%,transparent)] text-[var(--error)]' : 'bg-[var(--primary-container)] text-[var(--primary)]')}><Icon className="w-4 h-4" /></span>{cur.title ?? t('تأكيد')}</span>}
      footer={<><Button variant="ghost" onClick={() => done(false)}>{cur.cancelLabel ?? t('إلغاء')}</Button><Button autoFocus variant={cur.danger ? 'danger' : 'primary'} onClick={() => done(true)} data-fb="confirm-ok">{cur.confirmLabel ?? t('أيوه، كمّل')}</Button></>}>
      <div className="text-sm leading-relaxed">{cur.text}</div>
      {cur.detail && <div className="mt-3 text-xs text-dim">{cur.detail}</div>}
    </Modal>
  );
}
