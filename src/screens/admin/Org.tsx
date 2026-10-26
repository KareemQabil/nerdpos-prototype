// A0 Business, branches & devices (J-A1 steps 2–4 and the step-6 provisioning tool).
import React, { useState } from 'react';
import { Building2, GitBranch, MonitorSmartphone, Plus, Pencil, Power, Wrench, Landmark, Info, Clock3 } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Banner, Button, Card, EmptyState, Field, Input, KV, PageHeader, Pill, Select, StatCard, StatGrid, StateBadge, Switch, Table, Textarea, toast } from '../../ui';
import { t, getLang } from '../../i18n';
import { Tech } from '../../app/tech';
import { demo } from '../../mock/demo';
import { egProfile } from '../../mock/contracts';
import { policyMeta } from '../../mock/policyRegistry';
import { policyTitle, policyQuestion, valueSummary, confidenceText } from '../../demo/policyText';
import { branchLabel, deviceName } from '../../demo/people';
import { useList, show, usePerm, terminalKindLabel, Refused, Modal } from './org/common';

export default function Org() {
  const branches = useList<any>('Branch.List');
  const terms = useList<any>('Terminal.List');
  const biz = useQuery<any>('Business.Get');
  const active = terms.items.filter((x) => x.lifecycle === 'ACTIVE');
  const kinds = new Set(active.map((x) => x.kind));
  const open = active.filter((x) => x.openSession).length;
  const loading = branches.loading && !branches.data;
  return (
    <div className="space-y-4" data-fb="screen:A0">
      <PageHeader
        icon={<Building2 />}
        title={t('المطعم والفروع والأجهزة')}
        badge={<StateBadge ops={['Business.Get', 'Business.Configure', 'Branch.List', 'Branch.Create', 'Terminal.List', 'Terminal.Register', 'Terminal.Decommission']} />}
        description={t('أول خطوة في التجهيز: اسم المطعم، الفروع ومواعيد اليوم التجاري، والأجهزة اللي في كل فرع.')}
      />
      <StatGrid>
        <StatCard label={t('اسم المطعم')} value={<span className="text-lg">{(getLang() === 'en' ? biz.data?.name || biz.data?.nameAr : biz.data?.nameAr || biz.data?.name) || '—'}</span>} icon={<Building2 />} loading={biz.loading && !biz.data} />
        <StatCard label={t('فروع شغالة')} value={branches.items.filter((b) => b.active).length} icon={<GitBranch />} loading={loading} hint={t('كل فرع ليه يوم تجاري لوحده')} />
        <StatCard label={t('أجهزة شغالة')} value={active.length} icon={<MonitorSmartphone />} tone={kinds.size === 4 ? 'success' : 'warning'} loading={loading} hint={kinds.size === 4 ? t('كل الأنواع موجودة') : t('{k} من 4 أنواع — كمّل الباقي', { k: kinds.size })} />
        <StatCard label={t('ورديات مفتوحة دلوقتي')} value={open} icon={<Clock3 />} loading={loading} hint={t('على أجهزة الكاشير')} />
      </StatGrid>
      <div className="grid xl:grid-cols-2 gap-4 items-start">
        <BusinessCard />
        <BranchesCard />
      </div>
      <TerminalsCard />
      <ProvisioningCard />
    </div>
  );
}

// ───────── business (J-A1 step 2)
function BusinessCard() {
  const biz = useQuery<any>('Business.Get');
  const { nav } = useDev();
  const perm = usePerm('business:configure');
  const [open, setOpen] = useState(false);
  const b = biz.data;
  return (
    <Card title={<span className="flex items-center gap-2"><Building2 className="w-4 h-4 text-[var(--primary)]" />{t('بيانات المطعم')}</span>} description={t('الاسم اللي بيظهر على الإيصال والتقارير.')}
      actions={<Button size="sm" variant="outline" data-fb="org:business-edit" disabled={!b || !perm.ok} title={perm.title} onClick={() => setOpen(true)}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>}>
      <Refused error={biz.error} />
      {b && (
        <div className="space-y-3">
          <KV rows={[
            [t('الاسم (إنجليزي)'), b.name || <span className="text-dim">{t('لسه متكتبش')}</span>],
            [t('الاسم (عربي)'), <span className="flex items-center gap-2">{b.nameAr || <span className="text-dim">—</span>}<Tech><StateBadge state="PROPOSED" /></Tech></span>],
            [t('الاسم القانوني'), b.legalName || <span className="text-dim">—</span>],
            [t('العملة'), <span className="flex items-center gap-2"><span className="num">{b.currency}</span><Pill tone="neutral">{t('ثابتة بعد التجهيز')}</Pill></span>],
          ]} />
          <Tech><div className="num text-[11px] text-dim">v{b.version}</div></Tech>
          <Banner tone="info" action={<Button size="sm" variant="ghost" onClick={() => nav('fiscal')}><Landmark className="w-3.5 h-3.5" />{t('التسجيل الضريبي')}</Button>}>
            {t('بيانات الإيصال الإلكتروني (رقم التسجيل الضريبي، كود الفرع، النشاط) بتتكتب في شاشة التسجيل الضريبي، مش هنا.')}<Tech> (G4 · E-40)</Tech>
          </Banner>
        </div>
      )}
      {open && b && <BusinessModal b={b} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function BusinessModal({ b, onClose }: { b: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [name, setName] = useState(b.name ?? '');
  const [nameAr, setNameAr] = useState(b.nameAr ?? '');
  const [legalName, setLegalName] = useState(b.legalName ?? '');
  const save = async () => {
    const r = await run('Business.Configure', { body: { name, nameAr, legalName: legalName || null, expectedVersion: b.version } }, { success: t('اتحفظت بيانات النشاط') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={t('بيانات المطعم')} badge={<StateBadge ops={['Business.Configure']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save} data-fb="org:business-save">{t('حفظ')}</Button></>}>
      <div className="space-y-3">
        <Field label={t('الاسم (إنجليزي)')} required hint={t('بيظهر في النسخة الإنجليزي والتقارير')}><Input value={name} onChange={(e) => setName(e.target.value)} dir="ltr" data-fb="org:business-name" /></Field>
        <Field label={t('الاسم (عربي)')} hint={<>{t('بيظهر على الإيصال.')}<Tech> {t('Business.Configure فيه حقل name واحد بس؛ الاسم العربي إضافة مقترحة (PROTOTYPE_GAPS).')}</Tech></>}><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></Field>
        <Field label={t('الاسم القانوني (السجل التجاري)')}><Input value={legalName} onChange={(e) => setLegalName(e.target.value)} /></Field>
        <Tech><div className="text-[11px] text-dim">{t('بنبعت expectedVersion = {v}. لو حد تاني عدّل في نفس الوقت هيرجع CONCURRENCY_CONFLICT.', { v: b.version })}</div></Tech>
      </div>
    </Modal>
  );
}

// ───────── branches (J-A1 step 3)
function BranchesCard() {
  const branches = useList<any>('Branch.List');
  const perm = usePerm('branch:create');
  const [open, setOpen] = useState(false);
  const cal = egProfile.owner_data.find((d) => d.id === 'EG-BRANCH-CALENDAR');
  return (
    <Card title={<span className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-[var(--primary)]" />{t('الفروع')}</span>} description={t('اليوم التجاري لكل فرع بيبدأ في الساعة اللي تحددها.')}
      actions={<Button size="sm" variant="primary" data-fb="org:branch-new" disabled={!perm.ok} title={perm.title} onClick={() => setOpen(true)}><Plus className="w-3.5 h-3.5" />{t('فرع جديد')}</Button>}>
      <Refused error={branches.error} />
      <Table head={[t('الفرع'), t('التوقيت'), t('اليوم بيبدأ'), t('الحالة')]} loading={branches.loading && !branches.data}
        rows={branches.items.map((b) => [
          <div><div className="font-bold">{branchLabel(b)}</div><Tech><div className="num text-[11px] text-dim">{b.code} · {b.name}</div></Tech></div>,
          <span>{b.timezone === 'Africa/Cairo' ? t('توقيت القاهرة') : <span className="num">{b.timezone}</span>}</span>, <span className="num">{b.businessDayCutoff}</span>,
          b.active ? <Pill tone="success" dot>{t('شغال')}</Pill> : <Pill tone="neutral" dot>{t('موقوف')}</Pill>,
        ])}
        empty={<EmptyState compact icon={<GitBranch />} title={t('مفيش فروع لسه')} text={t('ابدأ بالفرع الأول من «فرع جديد».')} />} />
      <div className="mt-3 space-y-2">
        <div className="text-xs text-dim leading-relaxed">{t('أي بيعة قبل ساعة البداية بتتحسب على اليوم اللي فات: بيعة الساعة 2 الفجر بتدخل في تقارير امبارح. الساعة دي من السيرفر، مش من ساعة الجهاز.')}</div>
        {cal && <div className="text-[11px] rounded-lg bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] px-2 py-1"><b>{t('سؤال للخبير')}:</b> {t('المطعم بيقفل الساعة كام؟ بداية اليوم 4 الفجر مناسبة؟')}<Tech> <Pill tone="warning">{cal.confidence}</Pill> {cal.expertQuestion}</Tech></div>}
      </div>
      {open && <BranchModal onClose={() => setOpen(false)} />}
    </Card>
  );
}

function BranchModal({ onClose }: { onClose: () => void }) {
  const { run, busy } = useCommand();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Africa/Cairo');
  const [cutoff, setCutoff] = useState('04:00');
  const save = async () => {
    const r = await run('Branch.Create', { body: { code: code.trim(), name: name.trim(), timezone: timezone.trim(), businessDayCutoff: cutoff } }, { success: t('اتعمل الفرع') });
    if (r) onClose();
  };
  // display-only example of the cutoff rule (the server computes the real business date)
  const prev = '02:00' < cutoff;
  return (
    <Modal open onClose={onClose} title={t('فرع جديد')} badge={<StateBadge ops={['Branch.Create']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!code.trim() || !name.trim()} onClick={save} data-fb="org:branch-save">{t('إنشاء الفرع')}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('الكود')} required hint={t('حروف إنجليزي قصيرة ومينفعش تتكرر، مثلًا: MAADI-1')}><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} dir="ltr" data-fb="org:branch-code" /></Field>
        <Field label={t('اسم الفرع')} required><Input value={name} onChange={(e) => setName(e.target.value)} data-fb="org:branch-name" /></Field>
        <Field label={t('التوقيت')} hint={t('مصر: Africa/Cairo')}><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} dir="ltr" /></Field>
        <Field label={t('اليوم التجاري بيبدأ الساعة')} hint={t('في مصر غالبًا 4 الفجر — اسأل صاحب المطعم بيقفل إمتى')}><Input type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} dir="ltr" data-fb="org:branch-cutoff" /></Field>
      </div>
      <Banner tone="info"><span className="flex items-start gap-1"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />{prev ? t('مثال: بيعة الساعة 02:00 يوم 27 هتتحسب على اليوم التجاري 26.') : t('مثال: بيعة الساعة 02:00 يوم 27 هتتحسب على اليوم التجاري 27.')}</span></Banner>
    </Modal>
  );
}

// ───────── terminals (J-A1 step 4)
function TerminalsCard() {
  const terms = useList<any>('Terminal.List');
  const branches = useList<any>('Branch.List');
  const perm = usePerm('terminal:register');
  const permDec = usePerm('terminal:decommission');
  const { terminal } = useDev();
  const [open, setOpen] = useState(false);
  const [dec, setDec] = useState<any | null>(null);
  const bName = (id: string) => branchLabel(branches.items.find((b) => b.id === id)) || id;
  const kinds = new Set(terms.items.filter((x) => x.lifecycle === 'ACTIVE').map((x) => x.kind));
  return (
    <Card title={<span className="flex items-center gap-2"><MonitorSmartphone className="w-4 h-4 text-[var(--primary)]" />{t('الأجهزة')}</span>} description={t('كل جهاز جديد بيظهر فوق في شريط الأجهزة وتقدر تشتغل عليه.')}
      actions={<Button size="sm" variant="primary" data-fb="org:terminal-new" disabled={!perm.ok || branches.items.length === 0} title={perm.title} onClick={() => setOpen(true)}><Plus className="w-3.5 h-3.5" />{t('تسجيل جهاز')}</Button>}>
      <Refused error={terms.error} />
      <div className="flex flex-wrap gap-1 mb-3 text-xs items-center">
        <span className="text-dim">{t('المطلوب للتجهيز:')}</span>
        {(['CASH', 'FLOOR', 'KDS', 'ADMIN'] as const).map((k) => <Pill key={k} tone={kinds.has(k) ? 'success' : 'neutral'}>{kinds.has(k) ? '✓ ' : ''}{terminalKindLabel(k)}</Pill>)}
        <span className="text-dim">{t('— جهاز الكاشير بس اللي عليه درج.')}</span>
      </div>
      <Table head={[t('الجهاز'), t('الفرع'), t('النوع'), t('درج فلوس'), t('الحالة'), t('وردية'), '']} align={[undefined, undefined, undefined, undefined, undefined, undefined, 'end']} loading={terms.loading && !terms.data}
        rows={terms.items.map((x) => [
          <div className="min-w-0"><div className="font-bold flex items-center gap-1.5 flex-wrap">{deviceName(x.code, x.kind, x.name)}{terminal?.id === x.id && <Pill tone="primary">{t('الجهاز ده')}</Pill>}</div><Tech><div className="num text-[11px] text-dim">{x.code} · {x.name}</div></Tech></div>,
          <span>{bName(x.branchId)}</span>,
          terminalKindLabel(x.kind),
          x.drawer ? <Pill tone="success">{t('بدرج')}</Pill> : <span className="text-dim">—</span>,
          x.lifecycle === 'ACTIVE' ? <Pill tone="success" dot>{t('شغال')}</Pill> : <Pill tone="neutral" dot>{t('متوقف نهائي')}</Pill>,
          x.openSession ? <Pill tone="info">{t('مفتوحة')}<Tech> <span className="num">{x.openSession}</span></Tech></Pill> : <span className="text-dim">—</span>,
          x.lifecycle === 'ACTIVE' ? <Button size="sm" variant="danger" data-fb={`org:terminal-decommission:${x.code}`} disabled={!permDec.ok} title={permDec.title} onClick={() => setDec(x)}><Power className="w-3.5 h-3.5" />{t('إيقاف نهائي')}</Button> : null,
        ])}
        empty={<EmptyState compact icon={<MonitorSmartphone />} title={t('مفيش أجهزة متسجلة')} text={t('سجّل جهاز كاشير وتابلت وشاشة مطبخ وكمبيوتر إدارة.')} />} />
      {open && <TerminalModal branches={branches.items} onClose={() => setOpen(false)} />}
      {dec && <DecommissionModal term={dec} self={terminal?.id === dec.id} onClose={() => setDec(null)} />}
    </Card>
  );
}

function TerminalModal({ branches, onClose }: { branches: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState(branches.find((b) => b.active)?.id ?? branches[0]?.id ?? '');
  const [kind, setKind] = useState<'CASH' | 'FLOOR' | 'KDS' | 'ADMIN'>('CASH');
  const [drawer, setDrawer] = useState(true);
  const save = async () => {
    const r = await run('Terminal.Register', { body: { code: code.trim(), name: name.trim(), branchId, kind, drawer } }, { success: t('اتسجل الجهاز — ظهر فوق كشريحة جهاز') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={t('تسجيل جهاز')} badge={<StateBadge ops={['Terminal.Register']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!code.trim() || !name.trim() || !branchId} onClick={save} data-fb="org:terminal-save">{t('تسجيل')}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('الكود')} required hint={t('حروف إنجليزي قصيرة ومينفعش تتكرر، مثلًا: CASH-2')}><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} dir="ltr" data-fb="org:terminal-code" /></Field>
        <Field label={t('اسم الجهاز')} required hint={t('مثلًا: كاشير التيك أواي')}><Input value={name} onChange={(e) => setName(e.target.value)} data-fb="org:terminal-name" /></Field>
        <Field label={t('الفرع')} className="col-span-2"><Select value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branches.map((b) => ({ value: b.id, label: `${branchLabel(b)}${b.active ? '' : ' — ' + t('موقوف')}` }))} /></Field>
        <Field label={<span className="flex items-center gap-2">{t('نوع الجهاز')}<Tech><StateBadge state="PROPOSED" /></Tech></span>}>
          <Select value={kind} onChange={(e) => { const k = e.target.value as any; setKind(k); setDrawer(k === 'CASH'); }} options={(['CASH', 'FLOOR', 'KDS', 'ADMIN'] as const).map((k) => ({ value: k, label: terminalKindLabel(k) }))} data-fb="org:terminal-kind" />
        </Field>
        <Field label={<span className="flex items-center gap-2">{t('عليه درج فلوس')}<Tech><StateBadge state="PROPOSED" /></Tech></span>} hint={t('جهاز الكاشير بس اللي عليه درج')}><Switch checked={drawer} onChange={setDrawer} label={drawer ? t('أيوه') : t('لأ')} /></Field>
      </div>
      <Tech><div className="text-[11px] text-dim mt-3">{t('Terminal.Register في العقد فيه الكود والاسم والفرع بس. النوع والدرج إضافة مقترحة عشان النموذج يعرف شكل الجهاز (PROTOTYPE_GAPS).')}</div></Tech>
    </Modal>
  );
}

function DecommissionModal({ term, self, onClose }: { term: any; self: boolean; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [reason, setReason] = useState('');
  const save = async () => {
    const r = await run('Terminal.Decommission', { params: { terminalId: term.id }, body: { reason: reason.trim(), expectedVersion: term.version } }, { success: t('الجهاز اتوقف نهائي') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={t('إيقاف «{c}» نهائي', { c: deviceName(term.code, term.kind, term.name) })} badge={<StateBadge ops={['Terminal.Decommission']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={save} data-fb="org:terminal-decommission-confirm">{t('إيقاف نهائي')}</Button></>}>
      <div className="space-y-3">
        <Banner tone="warning">{t('الإيقاف نهائي: الجهاز ده مش هيقدر يعمل أي حركة بعد كده، وهيختفي من شريط الأجهزة فوق.')}<Tech> TERMINAL_NOT_ACTIVE</Tech></Banner>
        {self && <Banner tone="error">{t('ده الجهاز اللي إنت شغال عليه دلوقتي.')}</Banner>}
        {term.openSession && <Banner tone="warning">{t('عليه وردية مفتوحة — اقفلها الأول.')}</Banner>}
        <Field label={t('السبب (إجباري)')}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} data-fb="org:terminal-decommission-reason" /></Field>
      </div>
    </Modal>
  );
}

// ───────── provisioning (J-A1 step 6, internal tool)
function ProvisioningCard() {
  const eff = useQuery<any>('Settings.Effective', { query: { policyId: 'FloorIntakePolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const hist = useList<any>('Policy.History', { params: { policyId: 'FloorIntakePolicy' } });
  const { can } = useDev();
  const [confirmAgain, setConfirmAgain] = useState(false);
  const applied = (eff.data?.rows ?? []).some((r: any) => String(r.source ?? '').startsWith('EG.profile')) || hist.items.some((h) => h.via === 'PROFILE');
  const apply = () => {
    demo.applyEgProfile();
    toast('success', t('اتطبقت إعدادات السوق المصري على المطعم كله'), 'settings.ApplyMarketProfile · internal');
    setConfirmAgain(false);
  };
  const ownerTitle: Record<string, string> = { 'EG-VAT': 'ضريبة القيمة المضافة 14%', 'EG-BRANCH-CALENDAR': 'توقيت الفرع وبداية اليوم (4 الفجر)', 'EG-CURRENCY-RECEIPT': 'العملة (جنيه مصري) وبيانات الإيصال', 'EG-REASON-CODES': 'أسباب الإلغاء والخصم والمرتجع الجاهزة' };
  const ownerScreen: Record<string, string> = { 'EG-VAT': 'شاشة الضرايب', 'EG-BRANCH-CALENDAR': 'الفروع (فوق)', 'EG-CURRENCY-RECEIPT': 'بيانات المطعم (فوق)', 'EG-REASON-CODES': 'الإعدادات والأسباب' };
  return (
    <Card className="border-[rgba(168,85,247,.4)]" title={<span className="flex items-center gap-2"><Wrench className="w-4 h-4 text-[#c084fc]" />{t('إعدادات السوق المصري — أداة فريق التركيب')}<Tech><span className="num text-xs text-dim font-normal">settings.ApplyMarketProfile</span></Tech></span>}
      description={t('فريق التركيب بيطبقها مرة واحدة على مطعم جديد، وبعدها يراجع كل قيمة مع صاحب المطعم. أي تغيير بعد كده بيتعمل من شاشة الإعدادات.')}
      badge={<Pill tone="violet">{t('أداة داخلية')}</Pill>}
      actions={<Button size="sm" variant="primary" data-fb="org:apply-eg-profile" disabled={!can('*') && !can('settings:updatepolicy')} onClick={() => (applied ? setConfirmAgain(true) : apply())}>{t('طبّق إعدادات مصر')}</Button>}>
      <div className="space-y-4">
        {applied && <Banner tone="success">{t('الإعدادات دي متطبقة بالفعل على المطعم.')}<Tech> {t('في النظام الحقيقي التطبيق التاني بيترفض بـ SETTINGS_PROFILE_ALREADY_APPLIED.')}</Tech></Banner>}
        {confirmAgain && (
          <Banner tone="warning" action={<div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setConfirmAgain(false)}>{t('إلغاء')}</Button><Button size="sm" variant="warning" onClick={apply} data-fb="org:apply-eg-profile-again">{t('طبّقها تاني (للعرض)')}</Button></div>}>
            <div className="font-bold">{t('الإعدادات متطبقة قبل كده')}<Tech> SETTINGS_PROFILE_ALREADY_APPLIED</Tech></div>
            <div className="text-xs">{t('للعرض بس: تقدر ترجّع القيم الأصلية تاني فوق التعديلات اللي اتعملت.')}</div>
          </Banner>
        )}
        <Table dense maxHeight={460} head={[t('الإعداد'), t('القيمة في مصر'), t('مين يأكدها'), t('سؤال للخبير')]}
          rows={egProfile.values.map((v) => {
            const meta = policyMeta.get(v.policyId);
            const q = meta ? policyQuestion(meta) : undefined;
            return [
              <div className="min-w-0"><div className="font-bold text-sm">{meta ? policyTitle(meta) : v.policyId}</div><Tech><div className="num text-[10px] text-dim">{v.policyId} · {v.scope}</div></Tech></div>,
              <div className="text-xs leading-relaxed max-w-[340px]">{meta ? valueSummary(meta, v.value) : show(v.value)}<Tech><div className="num text-[10px] text-dim break-all" dir="ltr">{show(v.value)}</div></Tech></div>,
              <span className="text-xs">{confidenceText(v.confidence, v.reviewer)}</span>,
              <span className="text-xs text-dim">{q ?? '—'}<Tech><span className="block" dir="ltr">{v.expertQuestion}</span></Tech></span>,
            ];
          })} />
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-xs font-bold text-soft mb-1.5">{t('بيانات بيدخلها صاحب المطعم من شاشاتها')}</div>
            <div className="space-y-1.5">{egProfile.owner_data.map((d) => <div key={d.id} className="text-xs rounded-lg surface-1 border line px-3 py-2"><div className="font-bold">{t(ownerTitle[d.id] ?? d.id)}</div><div className="text-dim">{t('من: {s}', { s: t(ownerScreen[d.id] ?? '—') })} · {confidenceText(d.confidence)}</div><Tech><div className="num text-[10px] text-dim" dir="ltr">{d.id} · {d.operation} · {d.expertQuestion}</div></Tech></div>)}</div>
          </div>
          <div>
            <div className="text-xs font-bold text-soft mb-1.5">{t('قيم لسه مستنية رأي الخبير')}</div>
            <div className="space-y-1.5">{egProfile.pending.map((d, i) => { const meta = policyMeta.get(d.policyId); return <div key={d.policyId + i} className="text-xs rounded-lg surface-1 border line px-3 py-2"><div className="font-bold">{meta ? policyTitle(meta) : d.policyId}</div><div className="text-dim">{meta && d.policyId !== 'ApprovalRequirementPolicy' ? valueSummary(meta, d.value) : t('قواعد موافقة إضافية')} · {confidenceText(d.confidence)}</div><Tech><div className="num text-[10px] text-dim" dir="ltr">{d.policyId} · {d.awaiting} · {d.expertQuestion}</div></Tech></div>; })}</div>
          </div>
        </div>
        <Tech><div className="text-[11px] text-dim">{t('المصدر: rules/EG.profile.json')}</div></Tech>
      </div>
    </Card>
  );
}
