// Back-office home: the setup-from-zero path (J-A1 order) with a checklist computed from simple reads,
// and today's numbers (daily sales for the server business date, e-receipt queue).
import React from 'react';
import { CheckCircle2, Circle, ArrowLeft, CalendarDays, FileCheck2, TrendingUp, AlertTriangle } from 'lucide-react';
import { useDev, useQuery } from '../app/hooks';
import { screenById } from '../app/registry';
import { Banner, Button, Card, Money, Pill, Section, StateBadge } from '../ui';
import { t, L, useLang } from '../i18n';
import { cn } from '../lib/format';
import { clock, businessDate } from '../mock/clock';
import { useList } from './admin/org/common';

type Status = boolean | null; // null = not known (read refused or no simple read)

export default function Home() {
  const { me, auth } = useDev();
  const branchId = me?.branchId ?? auth.branchId;
  const branch = useQuery<any>(branchId ? 'Branch.Get' : null, { params: { branchId } });
  // display of the server rule (branch timezone + cutoff); every command resolves its own business date on the server
  const bd = branch.data ? businessDate(clock.now(), branch.data.timezone, branch.data.businessDayCutoff) : null;
  return (
    <div className="space-y-4" data-fb="screen:HOME">
      <Section
        title={t('أهلًا {n}', { n: me?.user?.displayName ?? '' })}
        badge={<StateBadge ops={['Access.Me', 'Report.Run', 'Compliance.Find']} />}
        sub={t('الباك أوفيس: خطوات تجهيز المطعم من الصفر بالترتيب، وأرقام النهارده.')}
      />
      <div className="grid xl:grid-cols-[2fr_1fr] gap-4 items-start">
        <SetupPath bd={bd} />
        <div className="space-y-4">
          <Today bd={bd} branchName={branch.data?.name} />
          <EReceiptQueue />
        </div>
      </div>
    </div>
  );
}

function SetupPath({ bd }: { bd: string | null }) {
  const { nav, kind } = useDev();
  const lang = useLang();
  const biz = useQuery<any>('Business.Get');
  const branches = useList<any>('Branch.List');
  const terms = useList<any>('Terminal.List');
  const users = useList<any>('User.Find');
  const roles = useList<any>('Role.List');
  const reasons = useList<any>('ReasonCode.List', { query: { active: true } });
  const floor = useQuery<any>('Settings.Effective', { query: { policyId: 'FloorIntakePolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const taxes = useList<any>('TaxPolicy.List');
  const products = useList<any>('Catalog.Search', { query: { limit: 500 } });
  const stations = useList<any>('KitchenStation.List');
  const rules = useList<any>('RoutingRule.List');
  const tables = useList<any>('Table.List');
  const fiscal = useQuery<any>('Settings.Effective', { query: { policyId: 'FiscalDocumentPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const sales = useQuery<any>(bd ? 'Report.Run' : null, { params: { reportId: 'daily_sales' }, query: { fromBusinessDate: bd } });

  const known = (...qs: { data: any; error: any }[]) => qs.every((q) => q.data && !q.error);
  const activeTerms = terms.items.filter((x) => x.lifecycle === 'ACTIVE');
  const kinds = new Set(activeTerms.map((x) => x.kind));
  const catchAll = rules.items.some((r) => r.active && !r.match?.productId && !r.match?.categoryId && !r.match?.channel);
  const orderCount = sales.data?.sections?.[0]?.rows?.find((r: any[]) => r[0] === 'order_count')?.[1];
  const fiscalMode = fiscal.data?.value?.mode ?? fiscal.data?.value;

  const steps: { screen: string; title: string; step: string; status: Status; detail: string; note?: string }[] = [
    { screen: 'org', title: t('النشاط والفروع والأجهزة'), step: '2–4', status: known(biz, branches, terms) ? !!biz.data?.name && branches.items.length > 0 && ['CASH', 'FLOOR', 'KDS', 'ADMIN'].every((k) => kinds.has(k)) : null,
      detail: t('{b} فرع · {d} جهاز ({k}/4 أنواع)', { b: branches.items.length, d: activeTerms.length, k: kinds.size }) },
    { screen: 'users', title: t('المستخدمين والأدوار'), step: '5', status: known(users, roles) ? users.items.length >= 2 && roles.items.length >= 1 : null,
      detail: t('{u} مستخدم · {r} دور', { u: users.items.length, r: roles.items.length }) },
    { screen: 'settings', title: t('الإعدادات وبروفايل مصر والأسباب'), step: '6، 8', status: known(floor, reasons) ? (floor.data?.rows ?? []).length > 0 && reasons.items.length > 0 : null,
      detail: t('{n} سبب شغال · بروفايل مصر {p}', { n: reasons.items.length, p: (floor.data?.rows ?? []).length > 0 ? t('متطبق') : t('لسه') }) },
    { screen: 'taxes', title: t('الضرايب (ضريبة القيمة المضافة 14%)'), step: '7', status: known(taxes) ? taxes.items.some((x) => x.active) : null,
      detail: t('{n} ضريبة شغالة', { n: taxes.items.filter((x) => x.active).length }), note: t('المحاسب يأكدها قبل أول بيع حقيقي') },
    { screen: 'import', title: t('المنيو (استيراد أو من الشاشات)'), step: '9–10', status: known(products) ? products.items.length > 0 : null,
      detail: t('{n} صنف', { n: products.items.length }) },
    { screen: 'prices', title: t('الأسعار لكل فرع وقناة'), step: '10', status: null, detail: t('راجع من شاشة الأسعار: صنف من غير سعر بيرجع PRICE_NOT_FOUND') },
    { screen: 'stations', title: t('المحطات والتوجيه والترابيزات'), step: '11', status: known(stations, rules, tables) ? stations.items.length > 0 && catchAll && tables.items.length > 0 : null,
      detail: t('{s} محطة · {r} قاعدة{c} · {tb} ترابيزة', { s: stations.items.length, r: rules.items.length, c: catchAll ? '' : ' ' + t('(من غير قاعدة عامة!)'), tb: tables.items.length }) },
    { screen: 'fiscal', title: t('التسجيل الضريبي (الإيصال الإلكتروني)'), step: '13', status: fiscal.data ? (typeof fiscalMode === 'string' ? fiscalMode !== 'OFF' : null) : null,
      detail: t('وضع الإيصال: {m}', { m: typeof fiscalMode === 'string' ? fiscalMode : '—' }), note: t('SANDBOX الأول؛ الإنتاج بعد الاعتماد') },
    { screen: 'counter', title: t('أول بيعة على الكاشير'), step: '14', status: sales.data ? Number(orderCount ?? 0) > 0 : null,
      detail: t('{n} طلب مقفول النهارده', { n: orderCount ?? '—' }), note: kind === 'BO' ? t('على جهاز الكاشير T1 (فوق)') : undefined },
    { screen: 'reports', title: t('تقارير اليوم'), step: '15', status: null, detail: t('المبيعات ووسائل الدفع لنفس اليوم التجاري') },
  ];
  const done = steps.filter((s) => s.status === true).length;
  const measurable = steps.filter((s) => s.status !== null).length;
  return (
    <Card title={<span className="flex items-center gap-2">{t('تجهيز المطعم من الصفر (J-A1)')}</span>} badge={<><Pill tone={done === measurable ? 'success' : 'warning'} title={t('الخطوات اللي اتعملت من كل الخطوات')}>{t('{d} من {n} خطوات', { d: done, n: steps.length })}</Pill>{steps.length > measurable && <Pill tone="neutral">{t('{m} من غير حالة (مراجعة يدوية أو مفيش صلاحية)', { m: steps.length - measurable })}</Pill>}</>}>
      <div className="space-y-2">
        {steps.map((s, i) => {
          const def = screenById.get(s.screen);
          const Icon = def?.icon;
          return (
            <div key={s.screen} className={cn('flex items-center gap-3 rounded-xl px-3 py-2 border line', s.status === true ? 'surface-1' : 'surface-2')} data-fb={`home:step:${s.screen}`}>
              <span className="num text-dim w-5 text-center font-bold">{i + 1}</span>
              {s.status === true ? <CheckCircle2 className="w-5 h-5 text-[var(--success)] shrink-0" /> : s.status === false ? <AlertTriangle className="w-5 h-5 text-[var(--warning)] shrink-0" /> : <Circle className="w-5 h-5 text-dim shrink-0" />}
              {Icon && <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br text-slate-900 shrink-0', def?.gradient)}><Icon className="w-4 h-4" /></span>}
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm flex items-center gap-2 flex-wrap">{s.title}<span className="num text-[10px] text-dim font-normal">{def?.code} · J-A1 {t('خطوة')} {s.step}</span></div>
                <div className="text-xs text-dim">{s.detail}{s.note ? ` — ${s.note}` : ''}</div>
              </div>
              <Button size="sm" variant={s.status === false ? 'primary' : 'ghost'} onClick={() => nav(s.screen)} data-fb={`home:go:${s.screen}`}>{lang === 'ar' ? def?.title ?? s.screen : def?.titleEn ?? s.screen}<ArrowLeft className="w-3.5 h-3.5 ltr:rotate-180" /></Button>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-dim mt-3">{t('الحالة محسوبة من قراءات بسيطة (عدد الفروع والأجهزة والمستخدمين والضرايب والأصناف…). الدائرة الفاضية = مفيش قراءة بسيطة أو المستخدم مالوش صلاحية عليها.')}</div>
    </Card>
  );
}

const MONEY_KEYS = new Set(['gross_sales', 'discounts', 'comps', 'net_sales', 'service_charge', 'tax', 'refunds_paid', 'net_sales_after_refunds', 'average_order_value', 'charges']);
const LABELS: Record<string, string> = {
  order_count: 'عدد الطلبات', net_sales: 'صافي المبيعات', service_charge: 'الخدمة (لوحدها)', tax: 'الضريبة', refunds_paid: 'مرتجعات اتصرفت', discounts: 'الخصومات', average_order_value: 'متوسط الطلب',
};

function Today({ bd, branchName }: { bd: string | null; branchName?: string }) {
  const { nav } = useDev();
  const r = useQuery<any>(bd ? 'Report.Run' : null, { params: { reportId: 'daily_sales' }, query: { fromBusinessDate: bd } });
  const rows: any[][] = r.data?.sections?.find((s: any) => s.id === 'summary')?.rows ?? [];
  const outstanding = r.data?.sections?.find((s: any) => s.id === 'outstanding_checks')?.rows?.length ?? 0;
  const pick = ['order_count', 'net_sales', 'service_charge', 'tax', 'discounts', 'refunds_paid'];
  return (
    <Card title={<span className="flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[var(--primary)]" />{t('النهارده')}</span>} badge={<StateBadge ops={['Report.Run']} />}
      actions={<Button size="sm" variant="ghost" onClick={() => nav('reports')}>{t('التقارير')}</Button>}>
      <div className="flex items-center gap-2 flex-wrap mb-3 text-xs">
        <Pill tone="primary"><CalendarDays className="w-3 h-3" />{t('اليوم التجاري')} <span className="num">{bd ?? '—'}</span></Pill>
        {branchName && <Pill tone="neutral">{branchName}</Pill>}
        {r.data?.provisional && <Pill tone="warning">{t('مؤقت — اليوم لسه مفتوح')}</Pill>}
      </div>
      {!bd && <Banner tone="info">{t('الجهاز ده من غير فرع — اختار فرع عشان تشوف أرقام اليوم.')}</Banner>}
      {r.error && <Banner tone="warning">{t('التقرير مش متاح')} <span className="num text-xs">{r.error.code}</span></Banner>}
      {r.data && (
        <div className="grid grid-cols-2 gap-2">
          {pick.map((k) => {
            const v = rows.find((x) => x[0] === k)?.[1];
            return (
              <div key={k} className="rounded-xl surface-1 p-2" data-fb={`home:kpi:${k}`}>
                <div className="text-[11px] text-dim">{t(LABELS[k] ?? k)}</div>
                <div className="text-lg">{MONEY_KEYS.has(k) ? <Money v={v ?? '0'} /> : <span className="num font-bold">{v ?? 0}</span>}</div>
              </div>
            );
          })}
        </div>
      )}
      {outstanding > 0 && <div className="mt-2"><Pill tone="warning">{t('{n} شيك مأكد ومش مدفوع', { n: outstanding })}</Pill></div>}
      {r.data?.note && <div className="text-[11px] text-dim mt-2">{L(r.data.note)}</div>}
    </Card>
  );
}

function EReceiptQueue() {
  const { nav } = useDev();
  const q = useList<any>('Compliance.Find', { query: { submission: 'PENDING_DATA,BUILT,SUBMITTED,REJECTED', limit: 500 } });
  const by = (s: string) => q.items.filter((d) => d.state === s).length;
  const alerts = q.items.filter((d) => d.alert).length;
  return (
    <Card title={<span className="flex items-center gap-2"><FileCheck2 className="w-4 h-4 text-[var(--primary)]" />{t('طابور الإيصال الإلكتروني')}</span>} badge={<StateBadge ops={['Compliance.Find']} />}
      actions={<Button size="sm" variant="ghost" onClick={() => nav('ereceipts')}>{t('افتح')}</Button>}>
      {q.error ? <Banner tone="warning">{t('مش متاح للمستخدم ده')} <span className="num text-xs">{q.error.code}</span></Banner> : (
        <div className="space-y-2">
          <div className="flex items-baseline gap-2"><span className="num text-3xl font-bold">{q.items.length}</span><span className="text-sm text-dim">{t('مستند لسه متقبلش')}</span></div>
          <div className="flex flex-wrap gap-1">
            <Pill tone={by('PENDING_DATA') ? 'warning' : 'neutral'}>{t('ناقصه بيانات')} <span className="num">{by('PENDING_DATA')}</span></Pill>
            <Pill tone="neutral">{t('اتبنى')} <span className="num">{by('BUILT')}</span></Pill>
            <Pill tone="info">{t('اتبعت')} <span className="num">{by('SUBMITTED')}</span></Pill>
            <Pill tone={by('REJECTED') ? 'error' : 'neutral'}>{t('مرفوض')} <span className="num">{by('REJECTED')}</span></Pill>
          </div>
          {alerts > 0 && <Banner tone="warning">{t('{n} مستند قرب من مهلة الـ 24 ساعة (تنبيه 12 و20 ساعة).', { n: alerts })}</Banner>}
          <div className="text-[11px] text-dim">{t('عطل الإيصال الإلكتروني عمره ما بيوقف البيع؛ المستند بيستنى في الطابور.')}</div>
        </div>
      )}
    </Card>
  );
}
