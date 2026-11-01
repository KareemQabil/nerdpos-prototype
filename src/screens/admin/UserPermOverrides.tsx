// P1-041: per-user exceptions to the role — a permission added on top of the role («زيادة على دوره») or taken away
// from this one person («متشالة منه»), optional expiry, reason required, every change audited. Effective
// permissions = role permissions ± these exceptions (computed by the server for every request).
import React, { useMemo, useState } from 'react';
import { ShieldPlus, ShieldMinus, Clock, History, Trash2, UserCog } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Banner, Button, Field, Input, Pill, SegmentedControl, Select, StateBadge, EmptyState } from '../../ui';
import { t } from '../../i18n';
import { Tech } from '../../app/tech';
import { cn, dateTime } from '../../lib/format';
import { personName, personText, roleLabel } from '../../demo/people';
import { permText } from './org/permText';
import { useList, RulePill } from './org/common';
import { cairoLocal, cairoLocalToIso, serverNow } from './catalog/common';

type Expiry = 'NONE' | 'SHIFT' | 'DAY' | 'WEEK' | 'CUSTOM';

export function UserPermOverrides({ user }: { user: any }) {
  const { can } = useDev();
  const q = useQuery<any>('User.PermissionOverrides', { params: { userId: user.id } });
  const catalog = useList<any>('Permission.List');
  const { run, busy } = useCommand();
  const [effect, setEffect] = useState<'GRANT' | 'REVOKE'>('GRANT');
  const [perm, setPerm] = useState('');
  const [reason, setReason] = useState('');
  const [expiry, setExpiry] = useState<Expiry>('NONE');
  const [custom, setCustom] = useState(() => cairoLocal(serverNow() + 86_400_000));
  const [showPast, setShowPast] = useState(false);
  const d = q.data;
  const name = personName(user.username, user.displayName);
  const rolePerms: string[] = d?.rolePermissions ?? [];
  const roleAll = !!d?.roleHasAll;
  const live: any[] = (d?.overrides ?? []).filter((o: any) => o.state === 'ACTIVE');
  const past: any[] = (d?.overrides ?? []).filter((o: any) => o.state !== 'ACTIVE');
  const options = useMemo(() => {
    const all: string[] = catalog.items.map((p: any) => p.id).filter((p: string) => !p.startsWith('vendor:'));
    const taken = new Set(live.map((o) => o.permission));
    const list = effect === 'GRANT'
      ? all.filter((p) => !roleAll && !rolePerms.includes(p) && can(p) && !taken.has(p))
      : (roleAll ? all : rolePerms.filter((p) => p !== '*')).filter((p) => !taken.has(p));
    return list.map((p) => ({ value: p, label: permText(p) })).sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [catalog.items, effect, rolePerms, roleAll, live, can]);
  const expiresAt = (): string | undefined => {
    const now = serverNow();
    if (expiry === 'SHIFT') return new Date(now + 8 * 3_600_000).toISOString();
    if (expiry === 'DAY') return new Date(now + 24 * 3_600_000).toISOString();
    if (expiry === 'WEEK') return new Date(now + 7 * 86_400_000).toISOString();
    if (expiry === 'CUSTOM') return cairoLocalToIso(custom) ?? undefined;
    return undefined;
  };
  const add = async () => {
    const r = await run('User.SetPermissionOverride', { params: { userId: user.id }, body: { permission: perm, effect, reason: reason.trim(), expiresAt: expiresAt() } },
      { success: effect === 'GRANT' ? t('{n} بقى يقدر: {p}', { n: name, p: permText(perm) }) : t('اتشالت من {n}: {p}', { n: name, p: permText(perm) }) });
    if (r) { setPerm(''); setReason(''); setExpiry('NONE'); }
  };
  const remove = async (o: any) => {
    await run('User.RemovePermissionOverride', { params: { userId: user.id, overrideId: o.id }, body: { reason: 'رجوع للدور' } }, { success: t('{n} رجع لصلاحيات دوره في: {p}', { n: name, p: permText(o.permission) }) });
  };
  const self = !!d?.selfEdit;
  const canEdit = can('user:manageaccess') && !self;
  return (
    <section className="space-y-3 rounded-2xl border line p-3" data-fb="user-perms">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="text-sm font-bold flex items-center gap-1.5"><UserCog className="w-4 h-4" />{t('استثناءات لـ{n} بس', { n: name })}</div>
          <div className="text-xs text-dim mt-0.5">{t('من غير ما تغيّر الدور كله: زوّد صلاحية للشخص ده، أو شيل منه صلاحية، ولو عايز لمدة محددة. بيتحفظ لوحده وبيتسجل في السجل.')}</div>
        </div>
        <div className="flex items-center gap-1.5"><RulePill action="USER_ACCESS_CHANGE" /><StateBadge ops={['User.PermissionOverrides', 'User.SetPermissionOverride', 'User.RemovePermissionOverride']} /></div>
      </div>
      {d && (
        <div className="text-xs rounded-xl surface-1 px-3 py-2">
          <span className="font-bold">{t('من دوره')}: </span>{d.roles.map((r: any) => roleLabel(r.roleName)).join('، ')} — {roleAll ? t('كل الصلاحيات (ما عدا أجزاء NerdPOS المرخصة)') : t('{n} صلاحية', { n: String(rolePerms.length) })}
          {' · '}<span className="font-bold">{t('الفعلي دلوقتي')}: </span><span data-fb="user-perms:effective-count">{roleAll ? t('كل الصلاحيات') : String(d.effective.filter((p: string) => p !== '*').length)}</span>{d.revoked.length ? ` − ${d.revoked.length}` : ''}
        </div>
      )}
      {live.length === 0 ? <EmptyState compact title={t('مفيش استثناءات')} text={t('{n} ماشي بصلاحيات دوره بالظبط.', { n: name })} /> : (
        <div className="space-y-1.5" data-fb="user-perms:live">
          {live.map((o) => (
            <div key={o.id} className={cn('rounded-xl border px-3 py-2 flex items-start gap-2', o.effect === 'GRANT' ? 'border-[color-mix(in_srgb,var(--info)_45%,transparent)]' : 'border-[color-mix(in_srgb,var(--error)_45%,transparent)]')} data-fb={`user-perms:item:${o.permission}`}>
              {o.effect === 'GRANT' ? <ShieldPlus className="w-4 h-4 text-[var(--info)] mt-0.5 shrink-0" /> : <ShieldMinus className="w-4 h-4 text-[var(--error)] mt-0.5 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold flex items-center gap-1.5 flex-wrap">
                  <Pill size="sm" tone={o.effect === 'GRANT' ? 'info' : 'error'}>{o.effect === 'GRANT' ? t('زيادة على دوره') : t('متشالة منه')}</Pill>{permText(o.permission)}
                </div>
                <div className="text-[11px] text-dim mt-0.5">{t('السبب')}: {o.reason} · {o.expiresAt ? <span className="inline-flex items-center gap-0.5"><Clock className="w-3 h-3" />{t('لحد {d}', { d: dateTime(o.expiresAt) })}</span> : t('من غير نهاية')} · {personText(o.createdByName)} {dateTime(o.createdAt)}</div>
                <Tech><div className="num text-[10px] text-dim" dir="ltr">{o.permission} · {o.id}</div></Tech>
              </div>
              <Button size="sm" variant="ghost" disabled={!canEdit || busy} data-fb={`user-perms:remove:${o.permission}`} onClick={() => remove(o)}><Trash2 className="w-3.5 h-3.5" />{t('رجّعه لدوره')}</Button>
            </div>
          ))}
        </div>
      )}
      {self ? <Banner tone="info">{t('مينفعش تعدّل صلاحياتك إنت — لازم حد تاني يعملها.')}</Banner> : canEdit && (
        <div className="rounded-xl surface-1 border line p-3 space-y-3">
          <SegmentedControl<'GRANT' | 'REVOKE'> size="sm" value={effect} onChange={(v) => { setEffect(v); setPerm(''); }} options={[{ id: 'GRANT', label: t('زوّد صلاحية'), icon: <ShieldPlus className="w-3.5 h-3.5" />, fb: 'user-perms:effect:GRANT' }, { id: 'REVOKE', label: t('شيل صلاحية'), icon: <ShieldMinus className="w-3.5 h-3.5" />, fb: 'user-perms:effect:REVOKE' }]} />
          <Field label={effect === 'GRANT' ? t('الصلاحية اللي هتتزوّد') : t('الصلاحية اللي هتتشال')} hint={effect === 'GRANT' ? t('بتظهر بس الصلاحيات اللي معاك إنت ومش في دوره') : t('من صلاحيات دوره')}>
            <Select data-fb="user-perms:perm" value={perm} onChange={(e) => setPerm(e.target.value)} options={[{ value: '', label: t('اختار…') }, ...options]} />
          </Field>
          <Field label={t('لحد إمتى')}>
            <SegmentedControl<Expiry> size="sm" value={expiry} onChange={setExpiry} options={[{ id: 'NONE', label: t('من غير نهاية'), fb: 'user-perms:exp:NONE' }, { id: 'SHIFT', label: t('8 ساعات'), fb: 'user-perms:exp:SHIFT' }, { id: 'DAY', label: t('يوم'), fb: 'user-perms:exp:DAY' }, { id: 'WEEK', label: t('أسبوع'), fb: 'user-perms:exp:WEEK' }, { id: 'CUSTOM', label: t('تاريخ'), fb: 'user-perms:exp:CUSTOM' }]} />
          </Field>
          {expiry === 'CUSTOM' && <Input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} dir="ltr" />}
          <Field label={t('السبب')} required hint={t('هيتسجل في السجل — مثلًا: مسؤول الوردية الليلة')}><Input data-fb="user-perms:reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Button variant="primary" className="w-full" data-fb="user-perms:save" loading={busy} disabled={!perm || reason.trim().length < 3} onClick={add}>{effect === 'GRANT' ? t('زوّد الصلاحية لـ{n}', { n: name }) : t('شيل الصلاحية من {n}', { n: name })}</Button>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <button type="button" className="text-xs text-soft inline-flex items-center gap-1" onClick={() => setShowPast(!showPast)}><History className="w-3.5 h-3.5" />{showPast ? t('اخفي القديم') : t('استثناءات خلصت أو اتشالت ({n})', { n: String(past.length) })}</button>
          {showPast && <div className="mt-2 space-y-1">{past.map((o) => (
            <div key={o.id} className="text-[11px] text-dim">{o.effect === 'GRANT' ? t('زيادة') : t('شيل')} · {permText(o.permission)} · {o.state === 'EXPIRED' ? t('خلصت مدتها {d}', { d: dateTime(o.expiresAt) }) : t('اتشالت {d} — {w}', { d: dateTime(o.removedAt), w: personText(o.removedByName ?? '') })}</div>
          ))}</div>}
        </div>
      )}
    </section>
  );
}
