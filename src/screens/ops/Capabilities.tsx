// Product capabilities: switch whole parts of the product on or off for the business or one branch.
// Off hides the related screens and the server refuses their operations with a clear message.
import React, { useState } from 'react';
import * as Icons from 'lucide-react';
import { useQuery, useCommand, useDev } from '../../app/hooks';
import { Section, StateBadge, Card, Pill, Switch, Tabs, Banner, Button } from '../../ui';
import { t, L, tv } from '../../i18n';
import { Tech } from '../../app/tech';
import { dateTime, cn } from '../../lib/format';
import { SCREENS } from '../../app/registry';
import { store } from '../../mock/store';
import { branchLabel, personText } from '../../demo/people';

export default function Capabilities() {
  const { auth, me } = useDev();
  const [scope, setScope] = useState<'TENANT' | 'BRANCH'>('TENANT');
  const q = useQuery<any>('Capability.List');
  const { run, busy } = useCommand();
  const items: any[] = q.data?.items ?? [];
  const branchName = tv(store.db.branches.find((b) => b.id === (me?.branchId ?? auth.branchId))?.name) ?? '—';
  const title = (c: any) => L({ ar: c.title, en: c.titleEn });
  const set = (c: any, enabled: boolean | null) => run('Profile.SetCapability', { params: { capability: c.id }, body: enabled === null ? { scopeType: scope, inherit: true } : { scopeType: scope, enabled } }, { success: enabled === null ? t('رجعت زي إعداد النشاط') : enabled ? t('{x} اتفتحت', { x: title(c) }) : t('{x} اتقفلت — الشاشات بتاعتها اختفت', { x: title(c) }) });
  const screensOf = (c: any) => SCREENS.filter((s) => !s.hidden && (c.screens.includes(s.id) || (s.group && c.groups.includes(s.group)))).map((s) => L({ ar: s.title, en: s.titleEn }));
  return (
    <div className="space-y-4" data-screen="CAP">
      <Section title={t('إمكانيات النظام')} badge={<StateBadge ops={['Capability.List', 'Profile.SetCapability']} />}
        sub={t('افتح أو اقفل أجزاء كاملة من السيستم حسب طريقة شغل المطعم. اللي بيتقفل بتختفي شاشاته من كل الأجهزة، ولو حد حاول يستخدمه السيستم بيقوله إنه مقفول.')}
        actions={<Tabs value={scope} onChange={setScope} tabs={[{ id: 'TENANT', label: t('النشاط كله') }, { id: 'BRANCH', label: `${t('الفرع ده بس')} (${branchName})` }]} />} />
      {scope === 'BRANCH' && <Banner tone="info">{t('إعداد الفرع بيغلب إعداد النشاط. "زي النشاط" بيشيل استثناء الفرع.')}</Banner>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map((c) => {
          const Icon = (Icons as any)[c.icon] ?? Icons.Puzzle;
          const own = scope === 'TENANT' ? c.tenant : c.branch;
          const value = own ? own.enabled : scope === 'BRANCH' ? c.enabled : c.tenant?.enabled ?? c.defaultOn;
          const scr = screensOf(c);
          return (
            <Card key={c.id} className={cn(!c.enabled && 'opacity-80')}>
              <div className="space-y-3" data-fb={`capability:${c.id}`}>
                <div className="flex items-start gap-3">
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', c.enabled ? 'bg-[var(--primary-container)] text-[var(--primary)]' : 'surface-2 text-dim')}><Icon className="w-5 h-5" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold flex items-center gap-2 flex-wrap">{title(c)}{c.enabled ? <Pill tone="success">{t('شغالة')}</Pill> : <Pill tone="neutral">{t('مقفولة')}</Pill>}</div>
                    <div className="text-xs text-dim mt-0.5">{t(c.description)}</div>
                  </div>
                  <Switch checked={!!value} disabled={busy} onChange={(v) => set(c, v)} />
                </div>
                <div className="rounded-lg surface-1 px-3 py-2 text-xs"><span className="font-bold text-soft">{t('لو اتقفلت')}: </span>{t(c.offEffect)}</div>
                {scr.length > 0 && <div className="flex flex-wrap gap-1">{scr.map((x) => <Pill key={x} tone="neutral">{x}</Pill>)}</div>}
                <div className="flex items-center justify-between text-[11px] text-dim gap-2">
                  <span>{own ? `${t('اتغيرت')} ${dateTime(own.updatedAt)} · ${personText(own.updatedByName)}` : scope === 'BRANCH' ? t('زي إعداد النشاط') : t('الإعداد الأصلي')}</span>
                  {scope === 'BRANCH' && own && <Button size="sm" variant="ghost" onClick={() => set(c, null)}>{t('زي النشاط')}</Button>}
                </div>
                <Tech><span className="num text-[10px] text-dim">{c.id} · {c.state}</span></Tech>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
