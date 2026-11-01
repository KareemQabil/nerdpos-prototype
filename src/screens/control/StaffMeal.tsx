// r3A — staff meals (F3-03, F3-01, E12, P0-018/019): the employee is picked from the users (not typed), the meal
// needs a manager's approval (PIN / card / finger / remote on the same device), it is counted against a daily
// allowance (sale value or cost), it goes to the kitchen and consumes stock like a sale — and it is never a sale or a
// discount. It can be cancelled before the kitchen, after the kitchen, or returned after the day closed.
import React, { useMemo, useState } from 'react';
import { Coffee, Send, Undo2, Users, ChefHat, CheckCircle2, AlertTriangle, Search } from 'lucide-react';
import { useQuery, useCommand } from '../../app/hooks';
import { MenuGrid } from '../order/MenuGrid';
import { ProductDialog, type LineDraft } from '../order/ProductDialog';
import { needsDialog } from '../OrderScreen';
import { Modal, StateBadge, Banner, Button, Pill, Field, Money, EmptyState, Skeleton, Switch, Avatar, SearchInput } from '../../ui';
import { t, L } from '../../i18n';
import { cn, money, time } from '../../lib/format';
import { Tech } from '../../app/tech';
import { personName, personRole } from '../../demo/people';
import { ReasonDialog, DispositionPicker } from '../order/CheckPanel';
import { STAGE_TEXT } from '../../mock/control-registry';

type Draft = LineDraft & { name: string };

export function StaffMealDialog({ onClose }: { onClose: () => void }) {
  const { run, busy } = useCommand();
  const [lines, setLines] = useState<Draft[]>([]);
  const [pick, setPick] = useState<any>(null);
  const [emp, setEmp] = useState('');
  const [find, setFind] = useState('');
  const [sendNow, setSendNow] = useState(true);
  const linesQ = useMemo(() => JSON.stringify(lines.map(({ name, ...l }) => ({ productId: l.productId, quantity: l.quantity, modifierOptionIds: l.modifierOptionIds, variantId: l.variantId ?? undefined }))), [lines]);
  const al = useQuery<any>('StaffMeal.Allowance', { query: lines.length ? { lines: linesQ } : {} });
  const a = al.data;
  const people: any[] = (a?.people ?? []).filter((p: any) => !find || (personName(p.username, p.displayName) + ' ' + personRole(p.username, p.displayName)).includes(find));
  const me = a?.people?.find((p: any) => p.userId === emp);
  const value = a?.quote?.value ?? '0.0000';
  const over = !!(a?.enabled && me && lines.length && Number(value) > Number(me.remaining));
  const submit = async () => {
    const r = await run<any>('Order.CreateStaffMeal', { body: { employeeUserId: emp, lines: lines.map(({ name, ...l }) => l), sendToKitchen: sendNow } }, { success: sendNow ? t('وجبة الموظف اتسجلت بموافقة المدير واتبعتت للمطبخ') : t('وجبة الموظف اتسجلت بموافقة المدير — هتتبعت للمطبخ لما تدوس «ابعت»') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} xwide title={<span className="flex items-center gap-2"><Coffee className="w-5 h-5" />{t('وجبة موظف')}</span>} badge={<StateBadge ops={['Order.CreateStaffMeal', 'StaffMeal.Allowance']} />}
      footer={<>
        <div className="me-auto text-sm min-w-0">
          {lines.length ? <span className="text-dim truncate">{lines.map((l) => `${l.name} ×${l.quantity}`).join(t('، '))}</span> : <span className="text-dim">{t('اختار الأصناف من المنيو')}</span>}
          {lines.length > 0 && <div className="text-xs mt-0.5" data-fb="staff-meal-value">{t('قيمة الوجبة')} <b className="num">{money(value)}</b> {a?.basis === 'COST' ? t('بالتكلفة') : t('بسعر البيع')}{a?.quote?.costUnknownLines ? <span className="text-[var(--warning-text)]"> · {t('{n} صنف من غير وصفة — اتحسب بسعر البيع', { n: a.quote.costUnknownLines })}</span> : null}</div>}
        </div>
        <Button variant="primary" loading={busy} disabled={!lines.length || !emp || over} onClick={submit} data-fb="staff-meal-save">{t('سجّل (موافقة مدير)')}</Button>
      </>}>
      <div className="grid gap-3 @3xl/main:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-3 min-w-0">
          <Banner tone="info">{t('وجبة الموظف مش بيع ولا خصم: المطلوب صفر، من غير إيصال، وبتسحب من المخزن وتروح المطبخ عادي. لازم المدير يوافق حتى لو الكاشير هو اللي بيسجل.')}</Banner>
          <Field label={t('الموظف')} hint={a?.enabled ? t('الحد لكل موظف {l} في اليوم {b}', { l: money(a.dailyLimit), b: a.basis === 'COST' ? t('بالتكلفة') : t('بسعر البيع') }) : t('مفيش حد يومي')}>
            <SearchInput value={find} onChange={setFind} placeholder={t('دوّر باسم الموظف')} className="!max-w-none mb-1.5" data-fb="staff-meal-find" />
            <div className="space-y-1 max-h-[34vh] overflow-y-auto" data-fb="staff-meal-people">
              {al.loading && !a && <Skeleton lines={4} />}
              {people.map((p) => (
                <button key={p.userId} type="button" onClick={() => setEmp(p.userId)} data-fb={`staff-meal-emp:${p.username}`}
                  className={cn('w-full flex items-center gap-2 rounded-xl border px-2.5 py-2 text-start', emp === p.userId ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)] hover:bg-[var(--surface-2)]')}>
                  <Avatar name={personName(p.username, p.displayName)} size="sm" />
                  <span className="flex-1 min-w-0"><span className="font-bold text-sm block truncate">{personName(p.username, p.displayName)}</span><span className="text-[11px] text-dim">{personRole(p.username, p.displayName)}</span></span>
                  {a?.enabled && <span className="text-end text-[11px]"><span className="block text-dim">{t('باقي')}</span><b className={cn('num', Number(p.remaining) <= 0 && 'text-[var(--error)]')}>{money(p.remaining, false)}</b></span>}
                </button>
              ))}
            </div>
          </Field>
          {me && a?.enabled && (
            <div className={cn('rounded-xl p-3 text-sm border', over ? 'border-[var(--error)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)]' : 'line surface-1')} data-fb="staff-meal-remaining">
              <div className="flex justify-between"><span className="text-dim">{t('استهلك النهارده')}</span><b className="num">{money(me.used)}</b></div>
              <div className="flex justify-between"><span className="text-dim">{t('الباقي من الحد')}</span><b className="num">{money(me.remaining)}</b></div>
              {lines.length > 0 && <div className="flex justify-between"><span className="text-dim">{t('بعد الوجبة دي')}</span><b className={cn('num', over && 'text-[var(--error)]')}>{money(String(Number(me.remaining) - Number(value)))}</b></div>}
              {over && <div className="text-[var(--error)] text-xs font-bold mt-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{t('الوجبة أكتر من الباقي — شيل صنف أو اختار أرخص')}</div>}
            </div>
          )}
          <label className="flex items-center justify-between gap-2 text-sm rounded-xl surface-1 border line px-3 py-2"><span><b>{t('ابعتها للمطبخ دلوقتي')}</b><span className="block text-[11px] text-dim">{t('لو مقفول: تتسجل وتتبعت وقت البريك')}</span></span><Switch checked={sendNow} onChange={setSendNow} data-fb="staff-meal-send-now" /></label>
          {lines.length > 0 && (
            <div className="space-y-1">{lines.map((l, i) => <div key={i} className="flex items-center justify-between text-sm rounded-lg surface-1 px-2.5 py-1.5"><span>{l.name} <span className="num text-dim">×{l.quantity}</span></span><button className="text-[var(--error)] text-xs" onClick={() => setLines(lines.filter((_, j) => j !== i))}>{t('شيل')}</button></div>)}</div>
          )}
        </div>
        <div className="h-[56vh] min-w-0"><MenuGrid channel="TAKEAWAY" onPick={(p) => (needsDialog(p) ? setPick(p) : setLines([...lines, { productId: p.id, quantity: '1', modifierOptionIds: [], name: L(p.name) }]))} /></div>
      </div>
      {pick && <ProductDialog product={pick} channel="TAKEAWAY" onClose={() => setPick(null)} onAdd={(l) => { setLines([...lines, { ...l, name: L(pick.name) }]); setPick(null); }} />}
    </Modal>
  );
}

/** The stage of a staff meal for cancellation (client view): closed day → S3, sent → S1, else S0. */
export function mealStage(o: any, closedDates: string[]): 'S0' | 'S1' | 'S3' {
  if (closedDates.includes(o.businessDate)) return 'S3';
  return o.lines.some((l: any) => l.status === 'ACTIVE' && l.fireRound !== null) ? 'S1' : 'S0';
}

export function StaffMealCancelDialog({ order, stage, onClose, onDone }: { order: any; stage: 'S0' | 'S1' | 'S3'; onClose: () => void; onDone?: () => void }) {
  const { run } = useCommand();
  const [disp, setDisp] = useState(stage === 'S3' ? 'WASTE_HELD' : '');
  const title = stage === 'S3' ? t('مرتجع وجبة موظف بعد قفل اليوم') : stage === 'S1' ? t('إلغاء وجبة موظف بعد ما اتبعتت للمطبخ') : t('إلغاء وجبة موظف قبل المطبخ');
  const note = stage === 'S3' ? t('اليوم بتاع الوجبة اتقفل: المرتجع بيتسجل على النهارده ومربوط بالوجبة الأصلية، ومحتاج الصلاحية التالتة (المحاسب أو صاحب المطعم).') : stage === 'S1' ? t('الوجبة راحت المطبخ: الإلغاء محتاج موافقة مدير، واختار الصنف هيروح فين.') : t('الوجبة لسه ما اتبعتتش: الإلغاء محتاج موافقة مدير ومفيش خسارة.');
  return (
    <ReasonDialog danger title={`${title} — ${personName(null, order.staffMeal?.employeeName ?? order.customerName)}`} kind="LINE_VOID" ops={['Order.CancelStaffMeal', 'Approval.Grant']} onClose={onClose} note={note}
      onOk={async (rc, n) => { const r = await run('Order.CancelStaffMeal', { params: { orderId: order.id }, body: { expectedVersion: order.version, reasonCode: rc, reason: n, ...(stage !== 'S0' && disp ? { disposition: disp } : {}) } }, { success: stage === 'S3' ? t('المرتجع اتسجل على النهارده') : t('وجبة الموظف اتلغت') }); if (r) onDone?.(); return r; }}>
      <div className="flex items-center gap-2 text-xs"><Pill tone={stage === 'S3' ? 'error' : stage === 'S1' ? 'warning' : 'info'} data-fb="staff-meal-stage">{t(STAGE_TEXT[stage].short)}</Pill><span className="text-dim">{t(STAGE_TEXT[stage].long)}</span></div>
      {stage !== 'S0' && <DispositionPicker value={disp} onChange={setDisp} allowAuto={stage !== 'S3'} />}
    </ReasonDialog>
  );
}

/** Today's staff meals on the counter: who, value, approver, kitchen, and the actions per stage. */
export function StaffMealsList({ dates }: { dates?: string }) {
  const q = useQuery<any>('Order.Find', { query: { lifecycle: 'COMPLETED,VOIDED', ...(dates ? { businessDate: dates } : {}) } });
  const al = useQuery<any>('StaffMeal.Allowance', {});
  const closed: string[] = al.data?.closedDates ?? [];
  const { run, busy } = useCommand();
  const [cancel, setCancel] = useState<any>(null);
  const meals: any[] = (q.data?.items ?? []).filter((o: any) => o.kind === 'STAFF_MEAL').slice(0, 30);
  if (q.loading && !q.data) return <Skeleton lines={3} />;
  if (!meals.length) return <EmptyState compact icon={<Coffee />} title={t('مفيش وجبات موظفين')} text={t('سجّل وجبة من زرار «وجبة موظف».')} />;
  return (
    <div className="space-y-1.5" data-fb="staff-meals-list">
      {meals.map((o) => {
        const stage = mealStage(o, closed);
        const voided = o.status === 'VOIDED';
        const held = !voided && o.rounds.length === 0;
        return (
          <div key={o.id} className={cn('rounded-xl border line surface-1 px-3 py-2 flex items-center gap-3 flex-wrap', voided && 'opacity-60')} data-fb={`staff-meal:${o.number}`}>
            <Avatar name={personName(null, o.staffMeal?.employeeName ?? o.customerName)} size="sm" />
            <div className="flex-1 min-w-[160px]">
              <div className="font-bold text-sm">{personName(null, o.staffMeal?.employeeName ?? o.customerName)} <span className="num text-[11px] text-dim">#{o.number} · {time(o.createdAt)}</span></div>
              <div className="text-[11px] text-dim">{o.lines.filter((l: any) => l.status !== 'REMOVED').map((l: any) => `${L(l.name)} ×${Number(l.quantity)}`).join(t('، '))}{o.staffMeal ? ` · ${money(o.staffMeal.value)} ${o.staffMeal.basis === 'COST' ? t('بالتكلفة') : t('بسعر البيع')}` : ''}</div>
            </div>
            {voided ? <Pill tone="neutral">{t('اتلغت')}</Pill> : held ? <Pill tone="warning"><ChefHat className="w-3 h-3" />{t('مستنية الإرسال')}</Pill> : <Pill tone="success"><CheckCircle2 className="w-3 h-3" />{t('راحت المطبخ')}</Pill>}
            {stage === 'S3' && <Pill tone="error">{t('يومها اتقفل')}</Pill>}
            {!voided && held && <Button size="sm" variant="outline" loading={busy} onClick={() => run('Order.Fire', { params: { orderId: o.id }, body: { expectedVersion: o.version } }, { success: t('الوجبة اتبعتت للمطبخ') })} data-fb={`staff-meal-fire:${o.number}`}><Send className="w-3.5 h-3.5" />{t('ابعت')}</Button>}
            {!voided && <Button size="sm" variant="ghost" onClick={() => setCancel({ o, stage })} data-fb={`staff-meal-cancel:${o.number}`}><Undo2 className="w-3.5 h-3.5" />{stage === 'S3' ? t('مرتجع') : t('إلغاء')}</Button>}
          </div>
        );
      })}
      {cancel && <StaffMealCancelDialog order={cancel.o} stage={cancel.stage} onClose={() => setCancel(null)} onDone={() => q.refetch()} />}
      <Tech><div className="text-[10px] num text-dim">Order.Find kind=STAFF_MEAL · Order.CancelStaffMeal</div></Tech>
    </div>
  );
}

void Money; void Search;
