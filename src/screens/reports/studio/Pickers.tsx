// «ضيف رقم» and «قسّم حسب»: friendly cards grouped by topic with the plain definition; a choice the current report
// can't show is greyed with the reason (same rule as the server — the registry).
import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Lock, Search } from 'lucide-react';
import { Modal, Button, SearchInput, Pill } from '../../../ui';
import { t, L } from '../../../i18n';
import { cn } from '../../../lib/format';
import { Tech } from '../../../app/tech';
import { FAMILY, FAMILY_ORDER, DIM_GROUPS, whyNot, dimWhyNot, useClickAway, type Registry } from './common';

const UNIT: Record<string, () => string> = { EGP: () => t('فلوس'), count: () => t('عدد'), '%': () => t('نسبة'), minutes: () => t('دقايق'), unit: () => t('كمية'), hours: () => t('ساعات') };

export function MetricPicker({ open, onClose, reg, selected, dims, onToggle }: { open: boolean; onClose: () => void; reg: Registry; selected: string[]; dims: string[]; onToggle: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [fam, setFam] = useState<string>('all');
  const list = useMemo(() => reg.metrics.filter((m) => !q.trim() || [L(m.label), L(m.definition), m.label.ar, m.label.en].join(' ').toLowerCase().includes(q.trim().toLowerCase())), [reg.metrics, q]);
  const fams = FAMILY_ORDER.filter((f) => list.some((m) => m.family === f));
  const shown = list.filter((m) => fam === 'all' || m.family === fam);
  const byFam = FAMILY_ORDER.map((f) => [f, shown.filter((m) => m.family === f)] as const).filter(([, xs]) => xs.length);
  return (
    <Modal open={open} onClose={onClose} size="xl" title={t('عايز تشوف إيه؟')} description={t('اختار رقم أو أكتر. كل رقم معتمد ومكتوب تعريفه — اللي ما ينفعش مع التقسيم الحالي متعلّم وسببه مكتوب.')}
      footer={<Button variant="primary" onClick={onClose} data-fb="mp:done">{t('تمام')} <span className="num">({selected.length})</span></Button>}>
      <div className="space-y-3" data-fb="metric-picker">
        <SearchInput value={q} onChange={setQ} placeholder={t('دوّر: مبيعات، خصم، أوردرات، كاش…')} autoFocus data-fb="mp:search" />
        <div className="flex flex-wrap gap-1.5">
          <Chip active={fam === 'all'} onClick={() => setFam('all')}>{t('الكل')}</Chip>
          {fams.map((f) => <Chip key={f} active={fam === f} onClick={() => setFam(f)} fb={`mp:fam:${f}`}>{(FAMILY[f] ?? (() => f))()}</Chip>)}
        </div>
        <div className="space-y-4 max-h-[52vh] overflow-y-auto pe-1">
          {byFam.map(([f, xs]) => (
            <div key={f}>
              <div className="text-xs font-bold text-soft mb-1.5">{(FAMILY[f] ?? (() => f))()}</div>
              <div className="grid @3xl/main:grid-cols-2 @6xl/main:grid-cols-3 gap-2">
                {xs.map((m) => {
                  const on = selected.includes(m.id);
                  const why = on ? null : whyNot(reg, m.id, dims);
                  const blocked = !!why;
                  return (
                    <button key={m.id} type="button" onClick={() => !blocked && onToggle(m.id)} disabled={blocked && m.status !== 'AVAILABLE'} data-fb={`mp:${m.id}`}
                      className={cn('text-start rounded-xl border p-3 transition-colors min-w-0', on ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--glass-border)] hover:border-[var(--primary)]/50', blocked && 'opacity-55 cursor-not-allowed hover:border-[var(--glass-border)]')}>
                      <div className="flex items-center gap-2">
                        <span className={cn('w-5 h-5 rounded-md border flex items-center justify-center shrink-0', on ? 'bg-[var(--primary)] border-transparent text-[var(--primary-foreground)]' : 'border-[var(--glass-border)]')}>{on ? <Check className="w-3.5 h-3.5" /> : blocked ? <Lock className="w-3 h-3 text-dim" /> : null}</span>
                        <span className="font-bold text-sm truncate">{L(m.label)}</span>
                        <span className="ms-auto shrink-0"><Pill size="sm" tone="neutral">{(UNIT[m.unit] ?? UNIT.count)()}</Pill></span>
                      </div>
                      <div className="text-xs text-soft mt-1 line-clamp-2">{L(m.definition)}</div>
                      {why && <div className="text-[11px] text-[var(--warning-text)] mt-1 line-clamp-2">{why}</div>}
                      <Tech><div className="text-[10px] text-dim num mt-0.5" dir="ltr">{m.id}</div></Tech>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!byFam.length && <div className="text-sm text-dim py-6 text-center flex items-center justify-center gap-2"><Search className="w-4 h-4" />{t('مفيش رقم بالاسم ده. جرّب كلمة تانية.')}</div>}
        </div>
      </div>
    </Modal>
  );
}
function Chip({ active, onClick, children, fb }: { active: boolean; onClick: () => void; children: React.ReactNode; fb?: string }) {
  return <button type="button" onClick={onClick} data-fb={fb} className={cn('px-3 h-8 rounded-full text-[13px] border transition-colors', active ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'border-[var(--glass-border)] hover:surface-2')}>{children}</button>;
}

/** A popover list of breakdowns grouped by topic. */
export function DimPicker({ anchor, onClose, reg, metrics, taken, onPick, title }: { anchor: DOMRect; onClose: () => void; reg: Registry; metrics: string[]; taken: string[]; onPick: (id: string) => void; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, onClose);
  const [q, setQ] = useState('');
  const W = 320;
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, anchor.left + anchor.width / 2 - W / 2));
  const topPos = Math.min(anchor.bottom + 6, window.innerHeight - 440);
  return createPortal(
    <div ref={ref} className="fixed z-[80] overlay-panel rounded-2xl shadow-[var(--shadow-pop)] border border-[var(--glass-border)] p-3 space-y-2" style={{ top: Math.max(56, topPos), left, width: W }} data-fb="dim-picker">
      <div className="text-sm font-bold">{title}</div>
      <SearchInput value={q} onChange={setQ} placeholder={t('دوّر: الفرع، الصنف، الساعة…')} autoFocus />
      <div className="max-h-80 overflow-y-auto space-y-2.5 pe-1">
        {DIM_GROUPS.map((g) => {
          const ds = g.dims.map((id) => reg.dim(id)).filter((d) => d && d.status === 'AVAILABLE' && !taken.includes(d.id) && (!q.trim() || L(d.label).includes(q.trim())));
          if (!ds.length) return null;
          return (
            <div key={g.id}>
              <div className="text-[11px] text-dim mb-1">{g.label()}</div>
              <div className="space-y-0.5">
                {ds.map((d) => { const why = dimWhyNot(reg, d.id, metrics); return (
                  <button key={d.id} type="button" disabled={!!why} onClick={() => { onPick(d.id); onClose(); }} data-fb={`dp:${d.id}`}
                    className={cn('w-full text-start rounded-lg px-2.5 py-1.5 hover:surface-2', why && 'opacity-50 cursor-not-allowed hover:bg-transparent')}>
                    <div className="text-sm font-medium">{L(d.label)}</div>
                    <div className="text-[11px] text-dim line-clamp-1">{why ?? L(d.description)}</div>
                  </button>); })}
              </div>
            </div>
          );
        })}
      </div>
    </div>, document.body);
}
