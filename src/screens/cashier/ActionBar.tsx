// The sale screen's action bar: fixed at the bottom, FIXED positions (muscle memory), 56px touch targets.
// Intelligence is in the states, never in moving buttons: the big primary at the end changes its label with the
// check (send to kitchen → pay → finish paying); every button shows its state (available, disabled, needs approval
// = small lock, waiting for the manager) and its badge; at most 5 secondary buttons, the rest under "المزيد";
// every button shows its key. Which buttons and in what order comes from the work profile.
import React, { useRef, useState } from 'react';
import { Lock, Clock, MoreHorizontal } from 'lucide-react';
import { Popover, Kbd, Money } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { keyLabel } from '../../app/keymap';

export interface BarAction {
  id: string;
  label: string;
  icon: React.ReactElement;
  run?: (anchor: HTMLElement | null) => void;
  disabled?: boolean;
  /** the action needs a manager's approval (shown as a small lock; the approval opens when it runs) */
  lock?: boolean;
  /** an approval request for this action is waiting for the manager */
  waiting?: boolean;
  badge?: number;
  danger?: boolean;
  fb?: string;
  hotkey?: string;
}
export interface PrimaryState { kind: 'send' | 'pay' | 'resume' | 'new' | 'prebill' | 'back'; label: string; icon: React.ReactElement; amount?: string | null; count?: number; disabled?: boolean; run: () => void; fb: string; hotkey?: string }

export function ActionBar({ secondary, overflow, primary, moreKey, showKeys, start, moreRef }: { secondary: BarAction[]; overflow: BarAction[]; primary: PrimaryState; moreKey?: string; showKeys: boolean; start?: React.ReactNode; moreRef?: React.MutableRefObject<(() => void) | null> }) {
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [more, setMore] = useState(false);
  if (moreRef) moreRef.current = () => setMore((x) => !x);
  const moreBadge = overflow.reduce((a, x) => a + (x.badge ?? 0), 0);
  return (
    <div className="shrink-0 border-t line chrome-bar px-3 py-2 flex items-center gap-2" data-fb="action-bar" role="toolbar" aria-label={t('شريط الإجراءات')}>
      <div className="flex items-stretch gap-1.5 min-w-0 overflow-x-auto scrollbar-hide">
        {secondary.map((a) => <BarButton key={a.id} a={a} showKeys={showKeys} />)}
        {overflow.length > 0 && (
          <>
            <BarButton showKeys={showKeys} a={{ id: 'more', label: t('المزيد'), icon: <MoreHorizontal />, badge: moreBadge || undefined, fb: 'bar:more', hotkey: moreKey, run: () => setMore(!more) }} btnRef={moreBtn} pressed={more} />
            <Popover anchor={moreBtn.current} open={more} onClose={() => setMore(false)} side="top" align="start" width={300} fb="bar:more-menu">
              <div className="grid gap-0.5">
                {overflow.map((a) => (
                  <button key={a.id} role="menuitem" disabled={a.disabled} data-fb={a.fb ?? `bar:${a.id}`} onClick={() => { setMore(false); a.run?.(moreBtn.current); }}
                    className={cn('h-12 px-3 rounded-xl flex items-center gap-3 text-sm text-start transition-colors disabled:opacity-40 hover:bg-[var(--surface-2)] [&>svg]:w-[18px] [&>svg]:h-[18px] [&>svg]:shrink-0', a.danger ? 'text-[var(--error)]' : 'text-[var(--foreground)]')}>
                    {React.cloneElement(a.icon as React.ReactElement<any>, { className: a.danger ? '' : 'text-soft' })}
                    <span className="flex-1 min-w-0 truncate">{a.label}</span>
                    {a.waiting && <Clock className="!w-3.5 !h-3.5 text-[var(--warning)]" />}
                    {a.lock && !a.waiting && <Lock className="!w-3.5 !h-3.5 text-[var(--warning-text)]" aria-label={t('يتطلب موافقة')} />}
                    {a.badge ? <span className="num min-w-5 h-5 px-1 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-[11px] font-bold inline-flex items-center justify-center">{a.badge}</span> : null}
                    {a.hotkey && showKeys && <Kbd>{keyLabel(a.hotkey)}</Kbd>}
                  </button>
                ))}
              </div>
            </Popover>
          </>
        )}
      </div>
      <div className="flex-1 min-w-2" />
      {start}
      <PrimaryButton p={primary} showKeys={showKeys} />
    </div>
  );
}

function BarButton({ a, showKeys, btnRef, pressed }: { a: BarAction; showKeys: boolean; btnRef?: React.Ref<HTMLButtonElement>; pressed?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const title = a.waiting ? `${a.label} · ${t('بانتظار المدير')}` : a.lock ? `${a.label} · ${t('يتطلب موافقة')}` : a.label;
  return (
    <button ref={(el) => { (ref as React.MutableRefObject<HTMLButtonElement | null>).current = el; if (typeof btnRef === 'function') btnRef(el); else if (btnRef) (btnRef as React.MutableRefObject<HTMLButtonElement | null>).current = el; }}
      type="button" disabled={a.disabled} onClick={() => a.run?.(ref.current)} data-fb={a.fb ?? `bar:${a.id}`} title={title} aria-label={title} aria-pressed={pressed || undefined}
      data-state={a.disabled ? 'disabled' : a.waiting ? 'waiting' : a.lock ? 'approval' : 'ready'}
      className={cn('relative shrink-0 w-[84px] h-14 rounded-xl border flex flex-col items-center justify-center gap-1 px-1 transition-[background,border-color,opacity,transform] duration-150 active:scale-[.97] disabled:opacity-35 disabled:active:scale-100 [&>svg]:w-5 [&>svg]:h-5',
        a.waiting ? 'border-[color-mix(in_srgb,var(--warning)_60%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] text-[var(--warning-text)]'
          : pressed ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]'
            : a.danger ? 'border-[color-mix(in_srgb,var(--error)_35%,transparent)] text-[var(--error)] surface-1 hover:bg-[color-mix(in_srgb,var(--error)_12%,transparent)]'
              : 'border-[var(--glass-border)] surface-1 text-soft hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]')}>
      {a.icon}
      <span className="text-xs font-semibold leading-none whitespace-nowrap max-w-full truncate">{a.label}</span>
      {a.hotkey && showKeys && <span className="absolute top-1 start-1.5 num text-[9px] font-semibold opacity-55 leading-none">{keyLabel(a.hotkey)}</span>}
      {a.badge ? <span className="absolute -top-1.5 -end-1.5 num min-w-5 h-5 px-1 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-[11px] font-bold inline-flex items-center justify-center ring-2 ring-[var(--background)]" data-fb={`${a.fb ?? 'bar:' + a.id}:badge`}>{a.badge}</span> : null}
      {a.waiting ? <span className="absolute top-1 end-1 text-[var(--warning)]"><Clock className="w-3.5 h-3.5 animate-pulse" /></span>
        : a.lock ? <span className="absolute top-1 end-1 text-[var(--warning-text)] opacity-90"><Lock className="w-3 h-3" /></span> : null}
    </button>
  );
}

function PrimaryButton({ p, showKeys }: { p: PrimaryState; showKeys: boolean }) {
  const tone = p.kind === 'send' ? 'btn-primary-grad' : p.kind === 'prebill' || p.kind === 'back' ? 'bg-[var(--violet)] text-white shadow-[0_8px_24px_-10px_var(--violet)] hover:brightness-110' : 'bg-[var(--success)] text-white shadow-[0_8px_24px_-10px_var(--success)] hover:brightness-110';
  return (
    <button type="button" onClick={p.run} disabled={p.disabled} data-fb={p.fb} data-kind={p.kind}
      className={cn('shrink-0 h-14 min-w-[188px] xl:min-w-[240px] px-5 rounded-2xl flex items-center justify-center gap-3 font-bold text-lg transition-[filter,transform,opacity] active:scale-[.98] disabled:opacity-40 disabled:saturate-50 disabled:active:scale-100 [&>svg]:w-6 [&>svg]:h-6', tone)}>
      {p.icon}
      <span className="whitespace-nowrap">{p.label}</span>
      {p.count ? <span className="num text-base opacity-90">({p.count})</span> : null}
      {p.amount && <Money v={p.amount} className="text-lg [&_.amount-unit]:!text-current [&_.amount-unit]:opacity-80" />}
      {showKeys && p.hotkey && <Kbd className="!bg-black/10 !border-black/10 !text-current">{keyLabel(p.hotkey)}</Kbd>}
    </button>
  );
}
