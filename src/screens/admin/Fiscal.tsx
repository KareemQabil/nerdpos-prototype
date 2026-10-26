// G4 Fiscal setup (installation): branch fiscal profile, fiscal device per terminal, product → ETA item code mapping.
// Country fiscal data lives in the EG_ETA compliance adapter only (docs/19 §7).
import React, { useEffect, useMemo, useState } from 'react';
import { Landmark, Save, Cpu, Barcode, HelpCircle, Pause, Play, AlertTriangle } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { PageHeader, StateBadge, Banner, Button, Pill, Card, Field, Input, Select, Table, Spinner, Switch, Modal, Textarea, SearchInput, Toolbar, StatGrid, StatCard, EmptyState } from '../../ui';
import { t, L } from '../../i18n';
import { Tech } from '../../app/tech';
import { branchLabel, deviceName } from '../../demo/people';

const EMPTY_PROFILE = { issuerId: '', issuerName: '', issuerBranchCode: '0', activityCode: '5610', receiptType: 'SC', governate: '', city: '', street: '', buildingNumber: '' };

export default function Fiscal() {
  const { me, auth, nav } = useDev();
  const setup = useQuery<any>('FiscalSetup.Get');
  const branches = useQuery<any>('Branch.List');
  const terminals = useQuery<any>('Terminal.List');
  const [branchId, setBranchId] = useState<string>(me?.branchId ?? auth.branchId ?? '');
  const branchList: any[] = branches.data?.items ?? [];
  useEffect(() => { if (!branchId && branchList[0]) setBranchId(branchList[0].id); }, [branchId, branchList]);

  const profiles: any[] = setup.data?.profiles ?? [];
  const devices: any[] = setup.data?.devices ?? [];
  const mappings: any[] = setup.data?.mappings ?? [];
  const branchTerminals = (terminals.data?.items ?? []).filter((x: any) => x.branchId === branchId && x.lifecycle === 'ACTIVE');

  return (
    <div className="space-y-4" data-screen-id="G4">
      <PageHeader icon={<Landmark />} title={t('التسجيل الضريبي')} badge={<StateBadge ops={['FiscalProfile.Configure', 'FiscalDevice.Register', 'FiscalDevice.SetState', 'FiscalItemMapping.SetMany']} />}
        description={t('تجهيز الإيصال الإلكتروني مع مصلحة الضرايب: بيانات الفرع، جهاز ضريبي لكل كاشير، وكود لكل صنف. أي بيانات ناقصة بتخلّي الإيصال يستنى — والبيع بيكمل عادي.')}
        actions={<>
          <Select data-fb="fiscal:branch" className="!w-auto min-w-[180px]" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branchList.map((b) => ({ value: b.id, label: branchLabel(b) || L(b.name) }))} />
          <Button variant="outline" onClick={() => nav('ereceipts')} data-fb="fiscal:goto-queue">{t('طابور الإيصالات')}</Button>
        </>} />

      <Tech><Banner tone="info">
        <span className="flex items-center gap-2 flex-wrap">{t('القراءة هنا من FiscalSetup.Get')} <StateBadge state="PROPOSED" /> {t('— العقود فيها أوامر كتابة بس ومفيش قراءة للملف والأجهزة والأكواد، فالقراءة دي مقترحة.')}</span>
      </Banner></Tech>
      {setup.loading && !setup.data && <Spinner />}
      <FiscalStats profile={profiles.find((p) => p.branchId === branchId) ?? null} terminals={branchTerminals} devices={devices} mappings={mappings} />

      <div className="grid xl:grid-cols-2 gap-4">
        <ProfileCard key={branchId + ':' + (profiles.find((p) => p.branchId === branchId)?.version ?? 0)} branchId={branchId} profile={profiles.find((p) => p.branchId === branchId) ?? null} />
        <DevicesCard terminals={branchTerminals} devices={devices} />
      </div>

      <MappingCard mappings={mappings} />
      <OpenQuestions />
    </div>
  );
}

function FiscalStats({ profile, terminals, devices, mappings }: { profile: any | null; terminals: any[]; devices: any[]; mappings: any[] }) {
  const products = useQuery<any>('Catalog.Search', { query: { limit: 500 } });
  const list: any[] = products.data?.items ?? [];
  const mapped = new Set(mappings.map((m) => m.productId));
  const missing = list.filter((p) => !mapped.has(p.id)).length;
  const cashiers = terminals.filter((x) => x.drawer);
  const covered = cashiers.filter((x) => devices.some((d) => d.terminalId === x.id && d.state === 'ACTIVE')).length;
  return (
    <StatGrid>
      <StatCard label={t('بيانات الفرع')} value={profile ? t('متسجلة') : t('ناقصة')} tone={profile ? 'success' : 'warning'} icon={<Landmark />} hint={profile ? t('رقم التسجيل والعنوان موجودين') : t('اكتبها تحت')} />
      <StatCard label={t('كاشير عليه جهاز ضريبي')} value={<>{covered}<span className="text-sm text-dim font-normal"> / {cashiers.length}</span></>} tone={covered === cashiers.length ? 'success' : 'warning'} icon={<Cpu />} />
      <StatCard label={t('أصناف من غير كود')} value={missing} tone={missing ? 'warning' : 'success'} icon={<Barcode />} hint={missing ? t('إيصالاتها هتستنى') : t('كل الأصناف ليها كود')} loading={products.loading && !products.data} />
    </StatGrid>
  );
}

function ProfileCard({ branchId, profile }: { branchId: string; profile: any | null }) {
  const { run, busy } = useCommand();
  const [f, setF] = useState(() => profile ? { issuerId: profile.issuerId, issuerName: profile.issuerName, issuerBranchCode: profile.issuerBranchCode, activityCode: profile.activityCode, receiptType: profile.receiptType, ...profile.address } : { ...EMPTY_PROFILE });
  const set = (k: string, v: string) => setF((x: any) => ({ ...x, [k]: v }));
  const save = () => run('FiscalProfile.Configure', {
    params: { branchId },
    body: { adapter: 'EG_ETA', issuerId: f.issuerId, issuerName: f.issuerName, issuerBranchCode: f.issuerBranchCode, activityCode: f.activityCode, receiptType: f.receiptType, address: { governate: f.governate, city: f.city, street: f.street, buildingNumber: f.buildingNumber }, ...(profile ? { expectedVersion: profile.version } : {}) },
  }, { success: t('ملف التسجيل الضريبي للفرع اتحفظ') });
  const inp = (k: string, label: string, hint?: string, ltr = true) => (
    <Field label={label} hint={hint}><Input data-fb={`fiscal:profile:${k}`} dir={ltr ? 'ltr' : undefined} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></Field>
  );
  return (
    <Card title={<span className="flex items-center gap-2"><Landmark className="w-4 h-4" />{t('بيانات الفرع في المنظومة')}</span>} description={t('زي ما هي في شهادة التسجيل الضريبي بالظبط.')}
      actions={profile ? <Pill tone="success">{t('متسجل')}<Tech> · v<span className="num">{profile.version}</span></Tech></Pill> : <Pill tone="warning">{t('مش متسجل — الإيصالات هتستنى')}</Pill>}>
      <div className="grid grid-cols-2 gap-3">
        {inp('issuerId', t('رقم التسجيل الضريبي'), t('9 أرقام من البطاقة الضريبية'))}
        {inp('issuerName', t('الاسم التجاري المسجل'), undefined, false)}
        {inp('issuerBranchCode', t('كود الفرع في المنظومة'), t('0 = المركز الرئيسي'))}
        {inp('activityCode', t('كود النشاط'), t('5610 = مطاعم — المحاسب يأكده'))}
        <Field label={t('نوع الإيصال')} hint={t('إيصال المطاعم والكافيهات هو المعتاد')}>
          <Select data-fb="fiscal:profile:receiptType" value={f.receiptType} onChange={(e) => set('receiptType', e.target.value)} options={[{ value: 'SC', label: t('إيصال مطاعم وكافيهات') }, { value: 'S', label: t('إيصال مبسط') }]} />
        </Field>
        {inp('governate', t('المحافظة'), undefined, false)}
        {inp('city', t('المدينة / الحي'), undefined, false)}
        {inp('street', t('الشارع'), undefined, false)}
        {inp('buildingNumber', t('رقم المبنى'))}
      </div>
      <div className="flex justify-end mt-3"><Button variant="primary" loading={busy} onClick={save} disabled={!branchId} data-fb="fiscal:profile:save"><Save className="w-4 h-4" />{t('حفظ الملف')}</Button></div>
    </Card>
  );
}

function DevicesCard({ terminals, devices }: { terminals: any[]; devices: any[] }) {
  const { run, busy } = useCommand();
  const [terminalId, setTerminalId] = useState('');
  const [serial, setSerial] = useState('');
  const [cred, setCred] = useState('secret://eta/');
  const [stateFor, setStateFor] = useState<any | null>(null);
  const credOk = /^secret:\/\/.+/.test(cred);
  const register = async () => {
    const r = await run('FiscalDevice.Register', { body: { adapter: 'EG_ETA', terminalId, deviceSerial: serial, credentialRef: cred } }, { success: t('الجهاز الضريبي اتسجل ونشط') });
    if (r) { setSerial(''); setCred('secret://eta/'); setTerminalId(''); }
  };
  const tIds = new Set(terminals.map((x) => x.id));
  const rows = devices.filter((d) => tIds.has(d.terminalId));
  return (
    <Card title={<span className="flex items-center gap-2"><Cpu className="w-4 h-4" />{t('الأجهزة الضريبية (جهاز لكل كاشير)')}</span>} badge={<StateBadge ops={['FiscalDevice.Register', 'FiscalDevice.SetState']} />}>
      <Table head={[t('الكاشير'), t('سيريال الجهاز'), t('الحالة'), t('آخر إيصال'), '']} align={[undefined, undefined, undefined, undefined, 'end']}
        empty={<EmptyState compact icon={<Cpu />} title={t('مفيش أجهزة ضريبية على الفرع ده')} text={t('سجّل جهاز لكل كاشير من تحت.')} />}
        rows={rows.map((d) => [
          <div><div className="font-bold whitespace-nowrap">{deviceName(d.terminalCode ?? d.terminalId)}</div><Tech><div className="num text-[10px] text-dim">{d.terminalCode} · {d.credentialRef}</div></Tech></div>,
          <span className="num whitespace-nowrap">{d.deviceSerial}</span>,
          <Pill tone={d.state === 'ACTIVE' ? 'success' : 'warning'} dot>{d.state === 'ACTIVE' ? t('نشط') : t('موقوف')}</Pill>,
          <span className="text-xs whitespace-nowrap">{d.lastSequence ? t('رقم {n}', { n: d.lastSequence }) : t('لسه')}<Tech><span className="num"> · {d.lastDocumentHash ? d.lastDocumentHash.slice(0, 8) + '…' : '—'}</span></Tech></span>,
          <Button size="sm" variant={d.state === 'ACTIVE' ? 'danger' : 'success'} data-fb={`fiscal:device:state:${d.id}`} onClick={() => setStateFor(d)}>{d.state === 'ACTIVE' ? <><Pause className="w-3.5 h-3.5" />{t('إيقاف')}</> : <><Play className="w-3.5 h-3.5" />{t('تنشيط')}</>}</Button>,
        ])} />
      {terminals.filter((x) => x.drawer && !rows.some((d) => d.terminalId === x.id && d.state === 'ACTIVE')).length > 0 && (
        <Banner tone="warning"><span className="flex items-center gap-1 flex-wrap"><AlertTriangle className="w-4 h-4" />{t('كاشير من غير جهاز ضريبي نشط')}: {terminals.filter((x) => x.drawer && !rows.some((d) => d.terminalId === x.id && d.state === 'ACTIVE')).map((x) => deviceName(x.code, x.kind, x.name)).join(t('، '))} — {t('إيصالاته هتستنى لحد ما يتسجل جهاز')}<Tech> (NO_ACTIVE_DEVICE)</Tech></span></Banner>
      )}
      <div className="mt-4 rounded-xl surface-1 p-3 space-y-3">
        <div className="font-bold text-sm">{t('تسجيل جهاز جديد')}</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label={t('الجهاز (الكاشير)')}>
            <Select data-fb="fiscal:device:terminal" value={terminalId} onChange={(e) => setTerminalId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...terminals.map((x) => ({ value: x.id, label: `${deviceName(x.code, x.kind, x.name)}${x.drawer ? '' : ' (' + t('من غير درج') + ')'}` }))]} />
          </Field>
          <Field label={t('سيريال جهاز المنظومة')}><Input data-fb="fiscal:device:serial" dir="ltr" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="POS-0002" /></Field>
          <Field label={t('اسم السر في الخزنة')} hint={t('اسم بس، مش السر نفسه')} error={cred && !credOk ? t('لازم يبدأ بـ secret://') : null}>
            <Input data-fb="fiscal:device:cred" dir="ltr" value={cred} onChange={(e) => setCred(e.target.value)} />
          </Field>
        </div>
        <div className="text-[11px] text-dim">{t('بيانات دخول المنظومة والختم الإلكتروني بيتحفظوا في خزنة الأسرار بس — هنا بنكتب اسمها بس.')}<Tech> (OD-EG-2)</Tech></div>
        <div className="flex justify-end"><Button variant="primary" loading={busy} disabled={!terminalId || !serial} onClick={register} data-fb="fiscal:device:register"><Cpu className="w-4 h-4" />{t('سجّل الجهاز')}</Button></div>
      </div>
      {stateFor && <DeviceStateDialog d={stateFor} onClose={() => setStateFor(null)} />}
    </Card>
  );
}

function DeviceStateDialog({ d, onClose }: { d: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const next = d.state === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  const [reason, setReason] = useState(next === 'SUSPENDED' ? 'الجهاز في الصيانة' : 'رجع من الصيانة');
  const go = async () => {
    const r = await run('FiscalDevice.SetState', { params: { deviceId: d.id }, body: { state: next, expectedVersion: d.version, reason } }, { success: next === 'SUSPENDED' ? t('الجهاز اتوقف') : t('الجهاز اتنشط') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={next === 'SUSPENDED' ? t('إيقاف جهاز ضريبي') : t('تنشيط جهاز ضريبي')} badge={<StateBadge ops={['FiscalDevice.SetState']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant={next === 'SUSPENDED' ? 'danger' : 'success'} loading={busy} disabled={!reason.trim()} onClick={go} data-fb="fiscal:device:state:confirm">{t('تأكيد')}</Button></>}>
      <div className="space-y-3">
        <div className="font-bold">{deviceName(d.terminalCode)} · <span className="num">{d.deviceSerial}</span></div>
        {next === 'SUSPENDED' && <Banner tone="warning">{t('طول ما الجهاز موقوف، إيصالات الكاشير ده هتبقى "مستني بيانات" لحد ما يرجع نشط أو يتسجل جهاز تاني. البيع مش بيقف.')}</Banner>}
        <Field label={t('السبب (مطلوب)')}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

interface Row { itemCode: string; codeType: string; unitType: string }

function MappingCard({ mappings }: { mappings: any[] }) {
  const { run, busy } = useCommand();
  const products = useQuery<any>('Catalog.Search', { query: { limit: 500 } });
  const cats = useQuery<any>('Category.List');
  const [edits, setEdits] = useState<Record<string, Row>>({});
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [q, setQ] = useState('');
  const byProduct = useMemo(() => new Map(mappings.map((m) => [m.productId, m])), [mappings]);
  const catName = (id: string) => L((cats.data?.items ?? cats.data ?? []).find?.((c: any) => c.id === id)?.name) || id;
  const list: any[] = products.data?.items ?? [];
  const missing = list.filter((p) => !byProduct.get(p.id));
  const shown = (onlyMissing ? missing : list).filter((p) => !q.trim() || L(p.name).includes(q.trim()));
  const valueOf = (pid: string): Row => edits[pid] ?? (byProduct.get(pid) ? { itemCode: byProduct.get(pid).itemCode, codeType: byProduct.get(pid).codeType, unitType: byProduct.get(pid).unitType } : { itemCode: '', codeType: 'EGS', unitType: 'EA' });
  const setRow = (pid: string, patch: Partial<Row>) => setEdits((e) => ({ ...e, [pid]: { ...valueOf(pid), ...patch } }));
  const changed = Object.entries(edits).filter(([pid, r]) => {
    const m = byProduct.get(pid);
    if (!r.itemCode.trim()) return false;
    return !m || m.itemCode !== r.itemCode || m.codeType !== r.codeType || m.unitType !== r.unitType;
  });
  const save = async () => {
    const rows = changed.map(([productId, r]) => ({ productId, itemCode: r.itemCode.trim(), codeType: r.codeType, unitType: r.unitType || 'EA' }));
    const res = await run('FiscalItemMapping.SetMany', { body: { adapter: 'EG_ETA', rows } }, { success: t('اتحفظ {n} كود — روح طابور الإيصالات واعمل "إعادة بناء" للإيصالات اللي مستنية', { n: rows.length }) });
    if (res) setEdits({});
  };
  const fillDemo = () => {
    const next: Record<string, Row> = { ...edits };
    missing.forEach((p, i) => { next[p.id] = { itemCode: `EG-DEMO-${String(100 + i).padStart(4, '0')}`, codeType: 'EGS', unitType: 'EA' }; });
    setEdits(next);
  };
  return (
    <Card title={<span className="flex items-center gap-2"><Barcode className="w-4 h-4" />{t('أكواد الأصناف في المنظومة')}</span>} badge={<Pill tone={missing.length ? 'warning' : 'success'} >{missing.length ? t('{n} صنف من غير كود', { n: missing.length }) : t('كل الأصناف ليها كود')}</Pill>}
      description={t('كل صنف على الإيصال لازم يبقى له كود مسجل في المنظومة. الصنف اللي من غير كود إيصاله بيستنى لحد ما تضيفه وتعيد بناء الإيصال.')}>
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder={t('دوّر على صنف')} />
        <Switch checked={onlyMissing} onChange={setOnlyMissing} label={t('الناقص بس')} />
        <Tech><span className="text-[11px] text-dim">ITEM_CODE_MISSING · EGS / GS1</span></Tech>
      </Toolbar>
      {products.loading && !products.data ? <Spinner /> : (
        <Table maxHeight={520} dense head={[t('الصنف'), t('القسم'), t('نوع الكود'), t('كود الصنف'), t('الوحدة'), '']}
          rows={shown.map((p) => {
            const v = valueOf(p.id);
            const has = !!byProduct.get(p.id);
            const dirty = !!edits[p.id];
            return [
              <div className={has ? '' : 'text-[var(--warning)] font-bold'}>{L(p.name)}{!has && <div className="text-[10px] font-normal">{t('من غير كود — إيصاله هيستنى')}</div>}</div>,
              <span className="text-xs">{catName(p.categoryId)}</span>,
              <Select data-fb={`fiscal:map:type:${p.id}`} className="w-24" value={v.codeType} onChange={(e) => setRow(p.id, { codeType: e.target.value })} options={[{ value: 'EGS', label: t('كود مصري') }, { value: 'GS1', label: t('باركود عالمي') }]} />,
              <Input data-fb={`fiscal:map:code:${p.id}`} dir="ltr" className={`w-48 ${!has && !v.itemCode ? 'border-[var(--warning)]' : ''}`} placeholder={t('مثال EG-123456789-0001')} value={v.itemCode} onChange={(e) => setRow(p.id, { itemCode: e.target.value })} />,
              <Input data-fb={`fiscal:map:unit:${p.id}`} dir="ltr" className="w-20" value={v.unitType} onChange={(e) => setRow(p.id, { unitType: e.target.value.toUpperCase() })} />,
              dirty ? <Pill tone="primary">{t('اتعدل')}</Pill> : has ? <Pill tone="success">{t('متسجل')}</Pill> : null,
            ];
          })} />
      )}
      <div className="flex justify-between items-center gap-2 mt-3 flex-wrap">
        <Button size="sm" variant="ghost" onClick={fillDemo} disabled={!missing.length} data-fb="fiscal:map:fill-demo">{t('املأ أكواد تجريبية للناقص (عرض)')}</Button>
        <Button variant="primary" loading={busy} disabled={!changed.length} onClick={save} data-fb="fiscal:map:save"><Save className="w-4 h-4" />{t('حفظ التعديلات')} <span className="num">({changed.length})</span></Button>
      </div>
    </Card>
  );
}

function OpenQuestions() {
  const qs: [string, string][] = [
    ['OD-EG-1', 'المطعم داخل في إلزام الإيصال الإلكتروني للأفراد؟ وكود النشاط إيه؟ وإيصال المطاعم مناسب له؟'],
    ['OD-EG-2', 'مين ماسك شهادة التوقيع (فلاشة التوقيع ولا جهاز تشفير) وبيانات دخول المنظومة؟ — السر عمره ما بيتخزن في النظام.'],
    ['OD-EG-3', 'أكواد الأصناف: باركود عالمي ولا نسجّل أكواد مصرية للمنيو؟ ومين اللي يسجلها؟'],
    ['OD-EG-4', 'الخدمة: تتكتب على الإيصال كسطر لوحدها؟ وبأنهي نوع ضريبة؟ — لحد الإجابة بتفضل برة الإيصال.'],
    ['OD-EG-5', 'الكارت المسجل هيتستخدم في التجربة؟ وكود وسيلة الدفع بتاعه إيه؟'],
    ['OD-EG-6', 'شيك مدفوع كاش وكارت مع بعض والإيصال فيه وسيلة دفع واحدة — الافتراضي: الوسيلة الأكبر، والكاش لو اتساووا.'],
    ['OD-EG-7', 'فرق التقريب يظهر إزاي على الإيصال؟ — لحد الإجابة الإيصال اللي فيه تقريب بيستنى.'],
  ];
  return (
    <Card title={<span className="flex items-center gap-2"><HelpCircle className="w-4 h-4" />{t('أسئلة مفتوحة للمحاسب ومصلحة الضرائب')}</span>}>
      <ol className="space-y-2 text-sm list-decimal ps-5">
        {qs.map(([id, q]) => <li key={id} className="text-soft leading-relaxed">{t(q)}<Tech> <span className="num text-[10px] text-dim">{id}</span></Tech></li>)}
      </ol>
      <div className="text-[11px] text-dim mt-2">{t('ولا سؤال منهم بيوقف البيع.')}<Tech> {t('المصدر: docs/19 §3 و§7.')}</Tech></div>
    </Card>
  );
}
