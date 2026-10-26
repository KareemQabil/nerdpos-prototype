// A0 Business, branches & devices (J-A1 steps 2–4 and the step-6 provisioning tool).
import React, { useState } from 'react';
import { Building2, GitBranch, MonitorSmartphone, Plus, Pencil, Power, Wrench, Landmark, Info } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, KV, Pill, Section, Select, StateBadge, Switch, Table, Textarea, toast } from '../../ui';
import { t } from '../../i18n';
import { demo } from '../../mock/demo';
import { egProfile } from '../../mock/contracts';
import { useList, show, usePerm, terminalKindLabel, Refused, Modal } from './org/common';

export default function Org() {
  return (
    <div className="space-y-4" data-fb="screen:A0">
      <Section
        title={t('النشاط والفروع والأجهزة')}
        badge={<StateBadge ops={['Business.Get', 'Business.Configure', 'Branch.List', 'Branch.Create', 'Terminal.List', 'Terminal.Register', 'Terminal.Decommission']} />}
        sub={t('أول خطوات التجهيز (J-A1 من 2 لـ 4): بيانات النشاط، الفروع بالتقويم بتاعها، والأجهزة. كل جهاز جديد بيظهر فوق كشريحة جهاز تقدر تشتغل عليه.')}
      />
      <div className="grid xl:grid-cols-2 gap-4">
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
    <Card title={<span className="flex items-center gap-2"><Building2 className="w-4 h-4 text-[var(--primary)]" />{t('بيانات النشاط')}</span>} badge={<StateBadge ops={['Business.Get', 'Business.Configure']} />}
      actions={<Button size="sm" variant="outline" data-fb="org:business-edit" disabled={!b || !perm.ok} title={perm.title} onClick={() => setOpen(true)}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>}>
      <Refused error={biz.error} />
      {b && (
        <div className="space-y-3">
          <KV rows={[
            [t('الاسم (إنجليزي)'), b.name || <span className="text-dim">{t('لسه متكتبش')}</span>],
            [t('الاسم (عربي)'), <span className="flex items-center gap-2">{b.nameAr || <span className="text-dim">—</span>}<StateBadge state="PROPOSED" /></span>],
            [t('الاسم القانوني'), b.legalName || <span className="text-dim">—</span>],
            [t('العملة'), <span className="flex items-center gap-2"><span className="num">{b.currency}</span><Pill tone="neutral">{t('ثابتة بعد التجهيز')}</Pill></span>],
            [t('النسخة'), <span className="num">v{b.version}</span>],
          ]} />
          <Banner tone="info" action={<Button size="sm" variant="ghost" onClick={() => nav('fiscal')}><Landmark className="w-3.5 h-3.5" />G4</Button>}>
            {t('بيانات التسجيل في الإيصال الإلكتروني (رقم التسجيل، كود الفرع، النشاط) مش هنا: مكانها شاشة التسجيل الضريبي G4 (E-40). مفيش أي حقل ضريبي على سجل النشاط.')}
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
    <Modal open onClose={onClose} title={t('بيانات النشاط')} badge={<StateBadge ops={['Business.Configure']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save} data-fb="org:business-save">{t('حفظ')}</Button></>}>
      <div className="space-y-3">
        <Field label={t('الاسم (إنجليزي) — name')}><Input value={name} onChange={(e) => setName(e.target.value)} dir="ltr" data-fb="org:business-name" /></Field>
        <Field label={<span className="flex items-center gap-2">{t('الاسم (عربي)')}<StateBadge state="PROPOSED" /></span>} hint={t('Business.Configure فيه حقل name واحد بس؛ الاسم العربي إضافة مقترحة (PROTOTYPE_GAPS).')}><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></Field>
        <Field label={t('الاسم القانوني (السجل التجاري)')}><Input value={legalName} onChange={(e) => setLegalName(e.target.value)} /></Field>
        <div className="text-[11px] text-dim">{t('بنبعت expectedVersion = {v}. لو حد تاني عدّل في نفس الوقت هيرجع CONCURRENCY_CONFLICT.', { v: b.version })}</div>
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
    <Card title={<span className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-[var(--primary)]" />{t('الفروع')}</span>} badge={<StateBadge ops={['Branch.List', 'Branch.Create']} />}
      actions={<Button size="sm" variant="primary" data-fb="org:branch-new" disabled={!perm.ok} title={perm.title} onClick={() => setOpen(true)}><Plus className="w-3.5 h-3.5" />{t('فرع جديد')}</Button>}>
      <Refused error={branches.error} />
      <Table head={[t('الكود'), t('الاسم'), t('المنطقة الزمنية'), t('بداية اليوم التجاري'), t('الحالة')]}
        rows={branches.items.map((b) => [
          <span className="num font-bold">{b.code}</span>, b.name, <span className="num">{b.timezone}</span>, <span className="num">{b.businessDayCutoff}</span>,
          b.active ? <Pill tone="success">{t('شغال')}</Pill> : <Pill tone="neutral">{t('موقوف')}</Pill>,
        ])}
        empty={t('مفيش فروع لسه — ابدأ بإنشاء الفرع الأول')} />
      <div className="mt-3 space-y-2">
        <Banner tone="info">{t('اليوم التجاري بيتحسب على السيرفر لكل فرع من المنطقة الزمنية وساعة بداية اليوم، عمره ما بيتاخد من ساعة الجهاز. أي عملية قبل ساعة البداية بتتحسب على اليوم اللي فات: بيعة الساعة 2 الفجر بتدخل في تقارير امبارح.')}</Banner>
        {cal && <div className="text-[11px] rounded-lg bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] px-2 py-1"><b>{t('سؤال للخبير')}</b> <Pill tone="warning">{cal.confidence}</Pill> {cal.expertQuestion}</div>}
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
        <Field label={t('الكود')} hint={t('فريد؛ تكراره بيرجع BRANCH_CODE_TAKEN')}><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} dir="ltr" data-fb="org:branch-code" /></Field>
        <Field label={t('الاسم')}><Input value={name} onChange={(e) => setName(e.target.value)} data-fb="org:branch-name" /></Field>
        <Field label={t('المنطقة الزمنية (IANA)')} hint={t('غلط بيرجع TIMEZONE_INVALID')}><Input value={timezone} onChange={(e) => setTimezone(e.target.value)} dir="ltr" /></Field>
        <Field label={t('بداية اليوم التجاري')} hint={t('بروفايل مصر: 04:00 (ثقة متوسطة — اسأل صاحب المطعم بيقفل إمتى)')}><Input type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} dir="ltr" data-fb="org:branch-cutoff" /></Field>
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
  const bName = (id: string) => branches.items.find((b) => b.id === id)?.code ?? id;
  const kinds = new Set(terms.items.filter((x) => x.lifecycle === 'ACTIVE').map((x) => x.kind));
  return (
    <Card title={<span className="flex items-center gap-2"><MonitorSmartphone className="w-4 h-4 text-[var(--primary)]" />{t('الأجهزة')}</span>} badge={<StateBadge ops={['Terminal.List', 'Terminal.Register', 'Terminal.Decommission']} />}
      actions={<Button size="sm" variant="primary" data-fb="org:terminal-new" disabled={!perm.ok || branches.items.length === 0} title={perm.title} onClick={() => setOpen(true)}><Plus className="w-3.5 h-3.5" />{t('تسجيل جهاز')}</Button>}>
      <Refused error={terms.error} />
      <div className="flex flex-wrap gap-1 mb-3 text-xs items-center">
        <span className="text-dim">{t('المطلوب للتجهيز:')}</span>
        {(['CASH', 'FLOOR', 'KDS', 'ADMIN'] as const).map((k) => <Pill key={k} tone={kinds.has(k) ? 'success' : 'neutral'}>{kinds.has(k) ? '✓ ' : ''}{terminalKindLabel(k)}</Pill>)}
        <span className="text-dim">{t('— جهاز الكاشير بس اللي عليه درج.')}</span>
      </div>
      <Table head={[t('الكود'), t('الاسم'), t('الفرع'), t('النوع'), t('درج'), t('الحالة'), t('وردية مفتوحة'), '']}
        rows={terms.items.map((x) => [
          <span className="num font-bold">{x.code}</span>,
          <span>{x.name}{terminal?.id === x.id && <Pill tone="primary" className="ms-1">{t('الجهاز ده')}</Pill>}</span>,
          <span className="num">{bName(x.branchId)}</span>,
          terminalKindLabel(x.kind),
          x.drawer ? <Pill tone="success">{t('بدرج')}</Pill> : <span className="text-dim">—</span>,
          x.lifecycle === 'ACTIVE' ? <Pill tone="success">ACTIVE</Pill> : <Pill tone="neutral">DECOMMISSIONED</Pill>,
          x.openSession ? <span className="num text-xs">{x.openSession}</span> : <span className="text-dim">—</span>,
          x.lifecycle === 'ACTIVE' ? <Button size="sm" variant="danger" data-fb={`org:terminal-decommission:${x.code}`} disabled={!permDec.ok} title={permDec.title} onClick={() => setDec(x)}><Power className="w-3.5 h-3.5" />{t('إيقاف نهائي')}</Button> : null,
        ])}
        empty={t('مفيش أجهزة متسجلة')} />
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
        <Field label={t('الكود')} hint={t('فريد؛ تكراره بيرجع TERMINAL_CODE_TAKEN')}><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} dir="ltr" data-fb="org:terminal-code" /></Field>
        <Field label={t('الاسم')}><Input value={name} onChange={(e) => setName(e.target.value)} data-fb="org:terminal-name" /></Field>
        <Field label={t('الفرع')} className="col-span-2"><Select value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}${b.active ? '' : ' — ' + t('موقوف')}` }))} /></Field>
        <Field label={<span className="flex items-center gap-2">{t('النوع')}<StateBadge state="PROPOSED" /></span>}>
          <Select value={kind} onChange={(e) => { const k = e.target.value as any; setKind(k); setDrawer(k === 'CASH'); }} options={(['CASH', 'FLOOR', 'KDS', 'ADMIN'] as const).map((k) => ({ value: k, label: `${terminalKindLabel(k)} (${k})` }))} data-fb="org:terminal-kind" />
        </Field>
        <Field label={<span className="flex items-center gap-2">{t('عليه درج فلوس')}<StateBadge state="PROPOSED" /></span>}><Switch checked={drawer} onChange={setDrawer} label={drawer ? t('أيوه') : t('لأ')} /></Field>
      </div>
      <div className="text-[11px] text-dim mt-3">{t('Terminal.Register في العقد فيه الكود والاسم والفرع بس. النوع والدرج إضافة مقترحة عشان النموذج يعرف شكل الجهاز (PROTOTYPE_GAPS).')}</div>
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
    <Modal open onClose={onClose} title={t('إيقاف الجهاز {c} نهائي', { c: term.code })} badge={<StateBadge ops={['Terminal.Decommission']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={save} data-fb="org:terminal-decommission-confirm">{t('إيقاف نهائي')}</Button></>}>
      <div className="space-y-3">
        <Banner tone="warning">{t('الإيقاف نهائي: أي طلب من الجهاز ده بعد كده بيرجع TERMINAL_NOT_ACTIVE، وشريحته هتختفي من فوق.')}</Banner>
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
    toast('success', t('اتطبق بروفايل مصر (EG.profile 1.4.0) على النشاط كله'), 'settings.ApplyMarketProfile · internal');
    setConfirmAgain(false);
  };
  return (
    <Card className="border-[rgba(168,85,247,.4)]" title={<span className="flex items-center gap-2"><Wrench className="w-4 h-4 text-[#c084fc]" />{t('تجهيز (داخلي)')} <span className="num text-xs text-dim font-normal">settings.ApplyMarketProfile</span></span>}
      badge={<Pill tone="violet">{t('أداة تجهيز داخلية — مش endpoint في العقد')}</Pill>}
      actions={<Button size="sm" variant="primary" data-fb="org:apply-eg-profile" disabled={!can('*') && !can('settings:updatepolicy')} onClick={() => (applied ? setConfirmAgain(true) : apply())}>{t('طبّق بروفايل مصر')}</Button>}>
      <div className="space-y-3">
        <div className="text-sm text-soft">{t('فريق التركيب بيطبق ملف السوق المصري مرة واحدة على نشاط فاضي (من غير HTTP ومن غير موافقة)، وبعدها يراجع كل قيمة مع صاحب المطعم. بعد كده أي تغيير بيعدي من شاشة الإعدادات بموافقة.')}</div>
        {applied && <Banner tone="info">{t('البروفايل متطبق بالفعل. في النظام الحقيقي التطبيق التاني بيترفض بـ SETTINGS_PROFILE_ALREADY_APPLIED.')}</Banner>}
        {confirmAgain && (
          <Banner tone="warning" action={<div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setConfirmAgain(false)}>{t('إلغاء')}</Button><Button size="sm" variant="warning" onClick={apply} data-fb="org:apply-eg-profile-again">{t('طبّقه تاني (عرض)')}</Button></div>}>
            <div className="font-bold">SETTINGS_PROFILE_ALREADY_APPLIED</div>
            <div className="text-xs">{t('للعرض بس: تقدر ترجّع قيم البروفايل تاني فوق التعديلات اللي اتعملت.')}</div>
          </Banner>
        )}
        <Table head={[t('السياسة'), t('النطاق'), t('القيمة'), t('النوع'), t('الثقة'), t('المراجع'), t('سؤال للخبير')]}
          rows={egProfile.values.map((v) => [
            <span className="num text-xs font-bold">{v.policyId}</span>, <span className="num text-xs">{v.scope}</span>,
            <span className="num text-[11px] break-all max-w-[260px] inline-block">{show(v.value)}</span>, <span className="num text-[11px]">{v.label}</span>,
            <Pill tone={v.confidence === 'HIGH' ? 'success' : v.confidence === 'MEDIUM' ? 'warning' : 'error'}>{v.confidence}</Pill>, <span className="num text-[11px]">{v.reviewer}</span>,
            <span className="text-xs">{v.expertQuestion}</span>,
          ])} />
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-xs font-bold text-soft mb-1">{t('بيانات صاحب المطعم (بتتعمل من شاشاتها)')}</div>
            <div className="space-y-1">{egProfile.owner_data.map((d) => <div key={d.id} className="text-xs rounded-lg surface-1 px-2 py-1"><span className="num font-bold">{d.id}</span> · <span className="num text-dim">{d.operation}</span> <Pill tone={d.confidence === 'HIGH' ? 'success' : 'warning'}>{d.confidence}</Pill><div className="text-dim">{d.expertQuestion}</div></div>)}</div>
          </div>
          <div>
            <div className="text-xs font-bold text-soft mb-1">{t('قيم مستنية رد الخبير')}</div>
            <div className="space-y-1">{egProfile.pending.map((d, i) => <div key={d.policyId + i} className="text-xs rounded-lg surface-1 px-2 py-1"><span className="num font-bold">{d.policyId}</span> · <span className="text-dim">{d.awaiting}</span> <Pill tone="warning">{d.confidence}</Pill><div className="text-dim">{d.expertQuestion}</div></div>)}</div>
          </div>
        </div>
        <div className="text-[11px] text-dim">{t('المصدر: rules/EG.profile.json')}</div>
      </div>
    </Card>
  );
}
