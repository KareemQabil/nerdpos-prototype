// DEV «الأجهزة» (ux-14): the devices attached to the terminals in one place — printers (receipt / kitchen / report
// routing, test page), cash drawers, scanners, the display screens (customer display, call board: settings, host,
// enable / disable, last seen) and the customer display content (messages, pictures, promotions, dishes; schedule; which
// display shows what, in which order). Every change is a declared command (audited); a device failure shows here and in
// the print queue and never undoes a committed sale. Terminals themselves are registered in «النشاط والفروع والأجهزة».
import React, { useMemo, useState } from 'react';
import { Printer, MonitorSmartphone, ScanBarcode, Archive, MonitorPlay, BellRing, Plus, Pencil, Power, PowerOff, FileText, ListOrdered, Trash2, ArrowUp, ArrowDown, Image as ImageIcon, Megaphone, Tag, UtensilsCrossed, Settings2, AlertTriangle, CheckCircle2, Ban, ExternalLink, Wifi } from 'lucide-react';
import { useCommand, useDev } from '../../app/hooks';
import { Banner, Button, Card, EmptyState, Field, Input, PageHeader, Pill, Select, StatCard, StatGrid, StateBadge, Switch, Tabs, SegmentedControl, Textarea, DateTime } from '../../ui';
import { t, tv, L, getLang } from '../../i18n';
import { cn } from '../../lib/format';
import { Tech } from '../../app/tech';
import { deviceName } from '../../demo/people';
import { stationName } from '../../demo/humanLog';
import { useList, usePerm, Refused, Modal, terminalKindLabel } from './org/common';
import { PolicyCard } from '../customers/PolicyCard';
import { useReasonMin } from '../../app/hooks';

type Tab = 'peripherals' | 'displays' | 'content' | 'settings';
const PERIPHERALS = ['PRINTER', 'CASH_DRAWER', 'SCANNER'] as const;
const DISPLAYS = ['CUSTOMER_DISPLAY', 'CALL_BOARD'] as const;

// ───────── labels (display only)
export const kindLabel = (k: string) => ({ PRINTER: t('طابعة'), CASH_DRAWER: t('درج النقدية'), SCANNER: t('ماسح الباركود'), CUSTOMER_DISPLAY: t('شاشة العميل'), CALL_BOARD: t('شاشة النداء') } as Record<string, string>)[k] ?? k;
const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = { PRINTER: Printer, CASH_DRAWER: Archive, SCANNER: ScanBarcode, CUSTOMER_DISPLAY: MonitorPlay, CALL_BOARD: BellRing };
export const statusLabel = (s: string) => ({ ONLINE: t('متصل'), OFFLINE: t('غير متصل'), PAPER_OUT: t('نفد الورق'), ERROR: t('عطل'), DISABLED: t('متوقف'), NOT_SEEN: t('لم يتصل بعد') } as Record<string, string>)[s] ?? s;
export function StatusPill({ status }: { status: string }) {
  const tone = status === 'ONLINE' ? 'success' : status === 'PAPER_OUT' ? 'warning' : status === 'OFFLINE' || status === 'ERROR' ? 'error' : 'neutral';
  return <Pill tone={tone} dot>{statusLabel(status)}</Pill>;
}
const roleLabel = (r: string) => ({ RECEIPT: t('الإيصالات والشيك المبدئي'), KITCHEN: t('تذاكر المطبخ'), REPORT: t('تقارير الوردية') } as Record<string, string>)[r] ?? r;
const connLabel = (c: string) => ({ USB: 'USB', NETWORK: t('شبكة'), BLUETOOTH: t('بلوتوث') } as Record<string, string>)[c] ?? c;
const contentKindLabel = (k: string) => ({ MESSAGE: t('رسالة'), IMAGE: t('صورة'), PROMOTION: t('عرض'), DISH: t('صنف من القائمة') } as Record<string, string>)[k] ?? k;
const CONTENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = { MESSAGE: Megaphone, IMAGE: ImageIcon, PROMOTION: Tag, DISH: UtensilsCrossed };
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const needsAttention = (s: string) => s === 'OFFLINE' || s === 'PAPER_OUT' || s === 'ERROR';

export function scheduleText(s: any): string {
  const parts: string[] = [];
  if (s?.from || s?.to) parts.push(`${s.from ?? '…'} – ${s.to ?? '…'}`);
  parts.push(s?.days?.length && s.days.length < 7 ? s.days.map((d: number) => t(DAYS[d])).join(t('، ')) : t('كل يوم'));
  parts.push(s?.start && s?.end ? `${s.start}–${s.end}` : t('طوال اليوم'));
  return parts.join(' · ');
}

export default function Devices() {
  const { params, nav } = useDev();
  const [tab, setTab] = useState<Tab>((['peripherals', 'displays', 'content', 'settings'] as Tab[]).includes(params?.tab) ? params.tab : 'peripherals');
  const list = useList<any>('Device.List');
  const content = useList<any>('DisplayContent.List');
  const failed = useList<any>('PrintJob.Find', { query: { state: 'FAILED,DEAD', limit: 200 } });
  const items = list.items;
  const loading = list.loading && !list.data;
  const attention = items.filter((d) => needsAttention(d.status)).length;
  return (
    <div className="space-y-4" data-fb="screen:DEV">
      <PageHeader icon={<MonitorSmartphone />} title={t('الأجهزة')}
        badge={<StateBadge ops={['Device.List', 'Device.Register', 'Device.Update', 'Device.SetEnabled', 'Device.TestPrint', 'Display.SetPlaylist', 'DisplayContent.Upsert', 'DisplayContent.Retire']} />}
        actions={<Button variant="ghost" onClick={() => nav('org')} data-fb="devices:terminals"><ExternalLink className="w-4 h-4" />{t('أجهزة البيع')}</Button>} />
      <Refused error={list.error} />
      <StatGrid>
        <StatCard label={t('متصلة')} value={items.filter((d) => d.status === 'ONLINE').length} icon={<CheckCircle2 />} tone="success" loading={loading} fb="devices:count:online" />
        <StatCard label={t('تحتاج انتباهًا')} value={attention} icon={<AlertTriangle />} tone={attention ? 'error' : 'neutral'} loading={loading} fb="devices:count:attention" />
        <StatCard label={t('متوقفة')} value={items.filter((d) => d.status === 'DISABLED').length} icon={<Ban />} loading={loading} fb="devices:count:disabled" />
        <StatCard label={t('مهام طباعة فاشلة')} value={failed.items.length} icon={<Printer />} tone={failed.items.length ? 'warning' : 'neutral'} onClick={() => nav('prints', {})} fb="devices:failed-jobs" loading={failed.loading && !failed.data} />
      </StatGrid>
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[
        { id: 'peripherals', icon: <Printer className="w-4 h-4" />, label: <span data-fb="devices:tab:peripherals">{t('الطابعات والأدراج والماسحات')}</span>, count: items.filter((d) => (PERIPHERALS as readonly string[]).includes(d.kind)).length || undefined },
        { id: 'displays', icon: <MonitorPlay className="w-4 h-4" />, label: <span data-fb="devices:tab:displays">{t('شاشات العرض')}</span>, count: items.filter((d) => (DISPLAYS as readonly string[]).includes(d.kind)).length || undefined },
        { id: 'content', icon: <ListOrdered className="w-4 h-4" />, label: <span data-fb="devices:tab:content">{t('محتوى شاشة العميل')}</span>, count: content.items.length || undefined },
        { id: 'settings', icon: <Settings2 className="w-4 h-4" />, label: <span data-fb="devices:tab:settings">{t('الإعدادات')}</span> },
      ]} />
      {tab === 'peripherals' && <PeripheralsTab items={items} loading={loading} />}
      {tab === 'displays' && <DisplaysTab items={items} content={content.items} loading={loading} />}
      {tab === 'content' && <ContentTab items={content.items} loading={content.loading && !content.data} />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}

// ───────── peripherals, grouped by the terminal they are attached to
function PeripheralsTab({ items, loading }: { items: any[]; loading: boolean }) {
  const perm = usePerm('device:manage');
  const [form, setForm] = useState<{ device?: any } | null>(null);
  const peri = items.filter((d) => (PERIPHERALS as readonly string[]).includes(d.kind));
  const groups = useMemo(() => {
    const m = new Map<string, { terminal: any | null; devices: any[] }>();
    for (const d of peri) { const k = d.terminal?.id ?? '—'; if (!m.has(k)) m.set(k, { terminal: d.terminal, devices: [] }); m.get(k)!.devices.push(d); }
    return [...m.values()].sort((a, b) => (a.terminal ? 0 : 1) - (b.terminal ? 0 : 1) || String(a.terminal?.code ?? '').localeCompare(String(b.terminal?.code ?? '')));
  }, [peri]);
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button variant="primary" size="sm" disabled={!perm.ok} title={perm.title} onClick={() => setForm({})} data-fb="devices:new-peripheral"><Plus className="w-4 h-4" />{t('تسجيل طابعة أو درج أو ماسح')}</Button></div>
      {!loading && !peri.length && <EmptyState icon={<Printer />} title={t('لا توجد أجهزة مسجلة')} />}
      <div className="grid @5xl/main:grid-cols-2 gap-3 items-start">
        {groups.map((g) => (
          <Card key={g.terminal?.id ?? 'net'} padding="sm" data-fb={`devices:host:${g.terminal?.id ?? 'network'}`}
            title={<span className="flex items-center gap-2">{g.terminal ? <MonitorSmartphone className="w-4 h-4 text-[var(--primary)]" /> : <Wifi className="w-4 h-4 text-[var(--primary)]" />}{g.terminal ? deviceName(g.terminal.id, g.terminal.kind, g.terminal.name) : t('طابعات الشبكة')}</span>}
            badge={g.terminal ? <Pill tone="neutral">{terminalKindLabel(g.terminal.kind)}</Pill> : undefined}>
            <div className="divide-y divide-[var(--line)]">{g.devices.map((d) => <DeviceRow key={d.id} d={d} onEdit={() => setForm({ device: d })} />)}</div>
          </Card>
        ))}
      </div>
      {form && <DeviceForm device={form.device} kinds={PERIPHERALS} onClose={() => setForm(null)} />}
    </div>
  );
}

function DeviceRow({ d, onEdit }: { d: any; onEdit: () => void }) {
  const manage = usePerm('device:manage');
  const test = usePerm('device:test');
  const { run, busy } = useCommand();
  const [toggle, setToggle] = useState(false);
  const Icon = KIND_ICON[d.kind] ?? Printer;
  const testPrint = () => run('Device.TestPrint', { params: { deviceId: d.id } }, { success: t('أُرسلت صفحة التجربة إلى الطابعة') });
  return (
    <div className="py-2.5 flex items-start gap-3" data-fb={`device-row:${d.id}`} data-status={d.status}>
      <span className="w-9 h-9 rounded-xl surface-2 flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap"><span className="font-bold">{tv(d.name)}</span><StatusPill status={d.status} /><Tech><span className="num text-[11px] text-dim">{d.code}</span></Tech></div>
        <div className="text-xs text-soft flex flex-wrap gap-x-3 gap-y-0.5">
          <span>{kindLabel(d.kind)}</span>
          {d.printer && <span>{d.printer.roles.map(roleLabel).join(t('، '))}</span>}
          {d.printer && d.stations?.length > 0 && <span>{t('المحطات')}: {d.stations.map((s: any) => stationName(s.name)).join(t('، '))}</span>}
          {d.printer && <span><span className="num">{d.printer.paper === '58MM' ? '58' : '80'}</span> {t('مم')} · {connLabel(d.printer.connection)}{d.printer.address ? <> · <span className="num" dir="ltr">{d.printer.address}</span></> : null}</span>}
          {d.printer?.backup && <Pill tone="info" size="sm">{t('الطابعة البديلة')}</Pill>}
        </div>
        {d.lastJob && <div className="text-xs text-dim">{t('آخر مهمة')}: <DateTime v={d.lastJob.at} time /> · {d.lastJob.state === 'SUCCEEDED' ? t('أُرسلت') : d.lastJob.state === 'PENDING' ? t('بالانتظار') : t('فشلت')}{d.failedJobs > 0 && <span className="text-[var(--error)] font-bold"> · {t('{n} مهمة فاشلة', { n: d.failedJobs })}</span>}</div>}
        {!d.enabled && d.disabledReason && <div className="text-xs text-dim">{t('سبب الإيقاف')}: {d.disabledReason}</div>}
      </div>
      <div className="flex gap-1.5 flex-wrap justify-end shrink-0">
        {d.kind === 'PRINTER' && d.enabled && <Button size="sm" variant="outline" loading={busy} disabled={!test.ok} title={test.title} onClick={testPrint} data-fb={`device-test:${d.id}`}><FileText className="w-3.5 h-3.5" />{t('صفحة تجربة')}</Button>}
        <Button size="sm" variant="ghost" disabled={!manage.ok} title={manage.title} onClick={onEdit} data-fb={`device-edit:${d.id}`}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>
        <Button size="sm" variant={d.enabled ? 'ghost' : 'secondary'} disabled={!manage.ok} title={manage.title} onClick={() => setToggle(true)} data-fb={`device-toggle:${d.id}`}>{d.enabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}{d.enabled ? t('إيقاف') : t('تشغيل')}</Button>
      </div>
      {toggle && <EnableModal d={d} onClose={() => setToggle(false)} />}
    </div>
  );
}

function EnableModal({ d, onClose }: { d: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const min = useReasonMin();
  const [reason, setReason] = useState('');
  const disabling = d.enabled;
  const save = async () => {
    const r = await run('Device.SetEnabled', { params: { deviceId: d.id }, body: { enabled: !disabling, reason: disabling ? reason.trim() : undefined, expectedVersion: d.version } }, { success: disabling ? t('أُوقف الجهاز') : t('شُغّل الجهاز') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={disabling ? t('إيقاف {n}', { n: tv(d.name) }) : t('تشغيل {n}', { n: tv(d.name) })} badge={<StateBadge ops={['Device.SetEnabled']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant={disabling ? 'danger' : 'primary'} loading={busy} disabled={disabling && reason.trim().length < min} onClick={save} data-fb="device-toggle-confirm">{disabling ? t('إيقاف') : t('تشغيل')}</Button></>}>
      {disabling ? (
        <div className="space-y-3">
          {d.kind === 'PRINTER' && <Banner tone="warning">{t('مهام هذه الطابعة تبقى ظاهرة في طابور الطباعة حتى تُعاد.')}</Banner>}
          <Field label={t('السبب')} required hint={t('{n} أحرف على الأقل', { n: min })}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-fb="device-toggle-reason" /></Field>
        </div>
      ) : <div className="text-sm">{t('يعود الجهاز إلى العمل فورًا.')}</div>}
    </Modal>
  );
}

/** Register or edit a device: name, host terminal, and the printer / display settings. */
function DeviceForm({ device, kinds, onClose }: { device?: any; kinds: readonly string[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const terms = useList<any>('Terminal.List');
  const stations = useList<any>('KitchenStation.List');
  const edit = !!device;
  const [kind, setKind] = useState<string>(device?.kind ?? kinds[0]);
  const [code, setCode] = useState('');
  const [name, setName] = useState(device ? tv(device.name) : '');
  const [host, setHost] = useState<string>(device?.terminalId ?? '');
  const [roles, setRoles] = useState<string[]>(device?.printer?.roles ?? ['RECEIPT']);
  const [stationIds, setStationIds] = useState<string[]>(device?.printer?.stationIds ?? []);
  const [paper, setPaper] = useState<string>(device?.printer?.paper ?? '80MM');
  const [conn, setConn] = useState<string>(device?.printer?.connection ?? 'USB');
  const [address, setAddress] = useState<string>(device?.printer?.address ?? '');
  const [backup, setBackup] = useState<boolean>(!!device?.printer?.backup);
  const [style, setStyle] = useState<string>(device?.display?.style ?? 'theme');
  const [branding, setBranding] = useState<boolean>(device?.display?.branding ?? true);
  const hostKinds: Record<string, string[] | null> = { PRINTER: null, CASH_DRAWER: ['CASH'], SCANNER: ['CASH', 'FLOOR', 'ADMIN'], CUSTOMER_DISPLAY: ['CASH'], CALL_BOARD: ['KDS'] };
  const hosts = terms.items.filter((x) => x.lifecycle === 'ACTIVE' && (!hostKinds[kind] || hostKinds[kind]!.includes(x.kind)) && x.kind !== 'MOBILE');
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const printer = kind === 'PRINTER' ? { roles, stationIds: roles.includes('KITCHEN') ? stationIds : [], paper, connection: conn, address: conn === 'NETWORK' ? address.trim() || null : null, backup } : undefined;
  const display = kind === 'CUSTOMER_DISPLAY' || kind === 'CALL_BOARD' ? { style, branding } : undefined;
  const save = async () => {
    const r = edit
      ? await run('Device.Update', { params: { deviceId: device.id }, body: { expectedVersion: device.version, name: name.trim(), terminalId: host || null, printer, display } }, { success: t('حُفظت إعدادات الجهاز') })
      : await run('Device.Register', { body: { kind, code: code.trim(), name: name.trim(), terminalId: host || null, printer, display } }, { success: t('سُجّل الجهاز') });
    if (r) onClose();
  };
  const ok = name.trim() && (edit || code.trim()) && (kind === 'PRINTER' || host) && (kind !== 'PRINTER' || roles.length > 0);
  return (
    <Modal open onClose={onClose} wide title={edit ? t('تعديل {n}', { n: tv(device.name) }) : t('تسجيل جهاز')} badge={<StateBadge ops={[edit ? 'Device.Update' : 'Device.Register']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!ok} onClick={save} data-fb="device-save">{edit ? t('حفظ') : t('تسجيل')}</Button></>}>
      <div className="space-y-4" data-fb="device-form">
        {!edit && <Field label={t('النوع')}><SegmentedControl value={kind} onChange={(v) => { setKind(v); setHost(''); }} options={kinds.map((k) => ({ id: k, label: kindLabel(k), fb: `device-kind:${k}` }))} /></Field>}
        <div className="grid sm:grid-cols-2 gap-3">
          {!edit && <Field label={t('الكود')} required><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} dir="ltr" maxLength={24} data-fb="device-code" /></Field>}
          <Field label={t('الاسم')} required><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-fb="device-name" /></Field>
          <Field label={kind === 'CALL_BOARD' ? t('تتبع شاشة') : t('مربوط بجهاز')} required={kind !== 'PRINTER'} className={edit ? undefined : 'sm:col-span-2'}>
            <Select value={host} onChange={(e) => setHost(e.target.value)} data-fb="device-host" options={[{ value: '', label: kind === 'PRINTER' ? t('بلا جهاز (طابعة شبكة)') : t('اختر جهازًا') }, ...hosts.map((h) => ({ value: h.id, label: `${deviceName(h.id, h.kind, h.name)} — ${terminalKindLabel(h.kind)}` }))]} />
          </Field>
        </div>
        {kind === 'PRINTER' && (
          <div className="space-y-3 rounded-xl surface-1 border line p-3">
            <Field label={t('تطبع')}><div className="flex flex-wrap gap-1.5">{['RECEIPT', 'KITCHEN', 'REPORT'].map((r) => <Chip key={r} on={roles.includes(r)} onClick={() => setRoles(toggle(roles, r))} fb={`device-role:${r}`}>{roleLabel(r)}</Chip>)}</div></Field>
            {roles.includes('KITCHEN') && <Field label={t('محطات المطبخ')}><div className="flex flex-wrap gap-1.5">{stations.items.filter((s) => s.active).map((s) => <Chip key={s.id} on={stationIds.includes(s.id)} onClick={() => setStationIds(toggle(stationIds, s.id))} fb={`device-station:${s.id}`}>{stationName(s.name)}</Chip>)}</div></Field>}
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label={t('عرض الورق')}><SegmentedControl value={paper} onChange={setPaper} options={[{ id: '80MM', label: <><span className="num">80</span> {t('مم')}</> }, { id: '58MM', label: <><span className="num">58</span> {t('مم')}</> }]} /></Field>
              <Field label={t('الاتصال')}><SegmentedControl value={conn} onChange={setConn} options={['USB', 'NETWORK', 'BLUETOOTH'].map((c) => ({ id: c, label: connLabel(c) }))} /></Field>
            </div>
            {conn === 'NETWORK' && <Field label={t('العنوان')}><Input value={address} onChange={(e) => setAddress(e.target.value)} dir="ltr" maxLength={64} data-fb="device-address" /></Field>}
            <Switch checked={backup} onChange={setBackup} label={t('الطابعة البديلة للفرع')} />
          </div>
        )}
        {display && (
          <div className="grid sm:grid-cols-2 gap-3 rounded-xl surface-1 border line p-3">
            <Field label={t('المظهر')}><SegmentedControl value={style} onChange={setStyle} options={[{ id: 'theme', label: t('ألوان التطبيق'), fb: 'device-style:theme' }, { id: 'display', label: t('تباين عالٍ'), fb: 'device-style:display' }]} /></Field>
            <Field label={t('شريط الهوية')}><SegmentedControl value={branding ? 'on' : 'off'} onChange={(v) => setBranding(v === 'on')} options={[{ id: 'on', label: t('ظاهر'), fb: 'device-branding:on' }, { id: 'off', label: t('مخفي'), fb: 'device-branding:off' }]} /></Field>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Chip({ on, onClick, children, fb }: { on: boolean; onClick: () => void; children: React.ReactNode; fb?: string }) {
  return <button type="button" onClick={onClick} aria-pressed={on} data-fb={fb} className={cn('min-h-9 px-3 rounded-xl border text-sm font-bold transition-colors', on ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'border-[var(--glass-border)] surface-1 text-soft')}>{children}</button>;
}

// ───────── display screens
function DisplaysTab({ items, content, loading }: { items: any[]; content: any[]; loading: boolean }) {
  const perm = usePerm('device:manage');
  const [form, setForm] = useState<{ device?: any } | null>(null);
  const [playlist, setPlaylist] = useState<any | null>(null);
  const displays = items.filter((d) => (DISPLAYS as readonly string[]).includes(d.kind));
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button variant="primary" size="sm" disabled={!perm.ok} title={perm.title} onClick={() => setForm({})} data-fb="devices:new-display"><Plus className="w-4 h-4" />{t('تسجيل شاشة')}</Button></div>
      {!loading && !displays.length && <EmptyState icon={<MonitorPlay />} title={t('لا توجد شاشات عرض')} />}
      <div className="grid @4xl/main:grid-cols-2 gap-3 items-start">
        {displays.map((d) => <DisplayCard key={d.id} d={d} onEdit={() => setForm({ device: d })} onPlaylist={() => setPlaylist(d)} />)}
      </div>
      {form && <DeviceForm device={form.device} kinds={DISPLAYS} onClose={() => setForm(null)} />}
      {playlist && <PlaylistModal d={displays.find((x) => x.id === playlist.id) ?? playlist} content={content} onClose={() => setPlaylist(null)} />}
    </div>
  );
}

function DisplayCard({ d, onEdit, onPlaylist }: { d: any; onEdit: () => void; onPlaylist: () => void }) {
  const manage = usePerm('device:manage');
  const contentPerm = usePerm('displaycontent:manage');
  const [toggle, setToggle] = useState(false);
  const Icon = KIND_ICON[d.kind] ?? MonitorPlay;
  const items: any[] = d.playlistItems ?? [];
  return (
    <Card padding="sm" data-fb={`display-card:${d.id}`} data-status={d.status}
      title={<span className="flex items-center gap-2"><Icon className="w-4 h-4 text-[var(--primary)]" />{tv(d.name)}</span>} badge={<StatusPill status={d.status} />}
      actions={<div className="flex gap-1.5 flex-wrap justify-end">
        {d.kind === 'CUSTOMER_DISPLAY' && <Button size="sm" variant="outline" disabled={!contentPerm.ok} title={contentPerm.title} onClick={onPlaylist} data-fb={`display-playlist:${d.id}`}><ListOrdered className="w-3.5 h-3.5" />{t('المحتوى')}</Button>}
        <Button size="sm" variant="ghost" disabled={!manage.ok} title={manage.title} onClick={onEdit} data-fb={`device-edit:${d.id}`}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>
        <Button size="sm" variant="ghost" disabled={!manage.ok} title={manage.title} onClick={() => setToggle(true)} data-fb={`device-toggle:${d.id}`}>{d.enabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}{d.enabled ? t('إيقاف') : t('تشغيل')}</Button>
      </div>}>
      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-soft">{t('النوع')}</span><span>{kindLabel(d.kind)}</span>
          <span className="text-soft">{d.kind === 'CALL_BOARD' ? t('تتبع شاشة') : t('مربوطة بجهاز')}</span><span data-fb={`display-host:${d.id}`}>{d.terminal ? deviceName(d.terminal.id, d.terminal.kind, d.terminal.name) : '—'}</span>
          <span className="text-soft">{t('آخر اتصال')}</span><span>{d.lastSeenAt ? <DateTime v={d.lastSeenAt} /> : t('لم تتصل بعد')}</span>
          <span className="text-soft">{t('المظهر')}</span><span>{d.display?.style === 'display' ? t('تباين عالٍ') : t('ألوان التطبيق')} · {d.display?.branding ? t('شريط الهوية ظاهر') : t('شريط الهوية مخفي')}</span>
        </div>
        {!d.enabled && d.disabledReason && <div className="text-xs text-dim">{t('سبب الإيقاف')}: {d.disabledReason}</div>}
        {d.kind === 'CUSTOMER_DISPLAY' && (
          <div className="rounded-xl surface-1 border line p-2.5 space-y-1" data-fb={`display-items:${d.id}`}>
            <div className="text-xs font-bold text-soft">{t('المحتوى بالترتيب')} · <span className="num">{items.length}</span></div>
            {items.length ? items.map((c, i) => { const CI = CONTENT_ICON[c.kind] ?? Megaphone; return <div key={c.id} className="flex items-center gap-2 text-xs" data-fb={`display-item:${c.id}`}><span className="num text-dim w-4">{i + 1}</span><CI className="w-3.5 h-3.5 text-soft" /><span className="flex-1 min-w-0 truncate">{L(c.title)}</span>{c.activeNow ? <Pill tone="success" size="sm">{t('يُعرض الآن')}</Pill> : <Pill tone="neutral" size="sm">{t('خارج وقته')}</Pill>}</div>; }) : <div className="text-xs text-dim">{t('لا يوجد محتوى')}</div>}
          </div>
        )}
      </div>
      {toggle && <EnableModal d={d} onClose={() => setToggle(false)} />}
    </Card>
  );
}

/** Which content a customer display shows while idle and in which order. */
function PlaylistModal({ d, content, onClose }: { d: any; content: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [ids, setIds] = useState<string[]>(d.display?.playlist ?? []);
  const byId = new Map(content.map((c) => [c.id, c]));
  const rest = content.filter((c) => !c.retired && !ids.includes(c.id));
  const move = (i: number, by: number) => { const a = [...ids]; const j = i + by; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setIds(a); };
  const save = async () => {
    const r = await run('Display.SetPlaylist', { params: { deviceId: d.id }, body: { contentIds: ids, expectedVersion: d.version } }, { success: t('حُفظ محتوى الشاشة') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} wide title={t('محتوى {n}', { n: tv(d.name) })} badge={<StateBadge ops={['Display.SetPlaylist']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} onClick={save} data-fb="playlist-save">{t('حفظ')}</Button></>}>
      <div className="grid md:grid-cols-2 gap-4" data-fb="playlist-popup">
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-soft">{t('يُعرض بالترتيب')}</div>
          {!ids.length && <div className="text-sm text-dim">{t('لا يوجد محتوى')}</div>}
          {ids.map((id, i) => { const c = byId.get(id); return (
            <div key={id} className="flex items-center gap-2 rounded-xl surface-1 border line px-2 py-1.5" data-fb={`playlist-row:${id}`}>
              <span className="num text-dim w-5">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate text-sm">{c ? L(c.title) : id}</span>
              {c && <span className="text-[11px] text-dim">{contentKindLabel(c.kind)}</span>}
              <button className="w-8 h-8 rounded-lg hover:bg-[var(--surface-2)] flex items-center justify-center" onClick={() => move(i, -1)} aria-label={t('أعلى')} data-fb={`playlist-up:${id}`}><ArrowUp className="w-4 h-4" /></button>
              <button className="w-8 h-8 rounded-lg hover:bg-[var(--surface-2)] flex items-center justify-center" onClick={() => move(i, 1)} aria-label={t('أسفل')} data-fb={`playlist-down:${id}`}><ArrowDown className="w-4 h-4" /></button>
              <button className="w-8 h-8 rounded-lg hover:bg-[var(--surface-2)] flex items-center justify-center text-[var(--error)]" onClick={() => setIds(ids.filter((x) => x !== id))} aria-label={t('إزالة')} data-fb={`playlist-remove:${id}`}><Trash2 className="w-4 h-4" /></button>
            </div>
          ); })}
        </div>
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-soft">{t('المكتبة')}</div>
          {!rest.length && <div className="text-sm text-dim">{t('كل المحتوى مضاف')}</div>}
          {rest.map((c) => (
            <button key={c.id} onClick={() => setIds([...ids, c.id])} className="w-full flex items-center gap-2 rounded-xl border border-dashed border-[var(--glass-border)] px-2 py-1.5 text-start hover:bg-[var(--surface-2)]" data-fb={`playlist-add:${c.id}`}>
              <Plus className="w-4 h-4 text-[var(--primary)]" /><span className="flex-1 min-w-0 truncate text-sm">{L(c.title)}</span><span className="text-[11px] text-dim">{contentKindLabel(c.kind)}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ───────── the content library
function ContentTab({ items, loading }: { items: any[]; loading: boolean }) {
  const perm = usePerm('displaycontent:manage');
  const [form, setForm] = useState<{ c?: any } | null>(null);
  const [retire, setRetire] = useState<any | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button variant="primary" size="sm" disabled={!perm.ok} title={perm.title} onClick={() => setForm({})} data-fb="content:new"><Plus className="w-4 h-4" />{t('محتوى جديد')}</Button></div>
      {!loading && !items.length && <EmptyState icon={<ListOrdered />} title={t('لا يوجد محتوى')} />}
      <div className="grid @3xl/main:grid-cols-2 @6xl/main:grid-cols-3 gap-3 items-start">
        {items.map((c) => <ContentCard key={c.id} c={c} perm={perm} onEdit={() => setForm({ c })} onRetire={() => setRetire(c)} />)}
      </div>
      {form && <ContentForm c={form.c} onClose={() => setForm(null)} />}
      {retire && <RetireModal c={retire} onClose={() => setRetire(null)} />}
    </div>
  );
}

function ContentCard({ c, perm, onEdit, onRetire }: { c: any; perm: { ok: boolean; title?: string }; onEdit: () => void; onRetire: () => void }) {
  const Icon = CONTENT_ICON[c.kind] ?? Megaphone;
  const img = c.kind === 'IMAGE' ? c.imageDataUrl : c.kind === 'DISH' ? c.product?.imageUrl : null;
  return (
    <Card padding="sm" data-fb={`content-card:${c.id}`} data-active={c.activeNow}>
      <div className="flex gap-3">
        <div className="w-20 h-20 rounded-xl surface-2 flex items-center justify-center overflow-hidden shrink-0">{img ? <img src={img} alt="" className="max-w-full max-h-full object-contain" /> : <Icon className="w-7 h-7 text-[var(--primary)]" />}</div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-bold truncate">{L(c.title)}</div>
          {c.body && <div className="text-xs text-soft truncate">{L(c.body)}</div>}
          <div className="flex flex-wrap gap-1"><Pill tone="neutral" size="sm">{contentKindLabel(c.kind)}</Pill>{c.activeNow ? <Pill tone="success" size="sm">{t('يُعرض الآن')}</Pill> : <Pill tone="neutral" size="sm">{t('خارج وقته')}</Pill>}{c.kind === 'PROMOTION' && c.promotion && !c.promotion.active && <Pill tone="warning" size="sm">{t('العرض متوقف')}</Pill>}</div>
          <div className="text-[11px] text-dim">{scheduleText(c.schedule)}</div>
          {c.kind === 'PROMOTION' && c.promotion && <div className="text-[11px] text-dim">{t('العرض')}: {L(c.promotion.name)}</div>}
          <div className="text-[11px] text-dim" data-fb={`content-used:${c.id}`}>{c.usedBy?.length ? <>{t('على')}: {c.usedBy.map((d: any) => tv(d.name)).join(t('، '))}</> : t('غير مضاف لأي شاشة')}</div>
        </div>
      </div>
      <div className="flex gap-1.5 justify-end mt-2">
        <Button size="sm" variant="ghost" disabled={!perm.ok} title={perm.title} onClick={onEdit} data-fb={`content-edit:${c.id}`}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>
        <Button size="sm" variant="ghost" disabled={!perm.ok} title={perm.title} onClick={onRetire} data-fb={`content-retire:${c.id}`}><Trash2 className="w-3.5 h-3.5" />{t('إيقاف المحتوى')}</Button>
      </div>
    </Card>
  );
}

const IMAGE_MAX_W = 960;
/** Reads a picture, downsizes a raster image to IMAGE_MAX_W px (SVG kept as is) and returns a data URL. */
async function readPicture(file: File): Promise<string> {
  const raw = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  if (/^data:image\/svg\+xml/i.test(raw)) return raw;
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = raw; });
  const scale = Math.min(1, IMAGE_MAX_W / img.width);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const jpg = c.toDataURL('image/jpeg', 0.82);
  return jpg.length < raw.length || scale < 1 ? jpg : raw;
}

function ContentForm({ c, onClose }: { c?: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const promos = useList<any>('Promotion.Find', { query: { limit: 200 } });
  const products = useList<any>('Catalog.Search', { query: { active: 'true', limit: 500 } });
  const edit = !!c;
  const [kind, setKind] = useState<string>(c?.kind ?? 'MESSAGE');
  const [titleAr, setTitleAr] = useState(c?.title?.ar ?? '');
  const [titleEn, setTitleEn] = useState(c?.title?.en ?? '');
  const [bodyAr, setBodyAr] = useState(c?.body?.ar ?? '');
  const [bodyEn, setBodyEn] = useState(c?.body?.en ?? '');
  const [image, setImage] = useState<string | null>(c?.imageDataUrl ?? null);
  const [promotionId, setPromotionId] = useState<string>(c?.promotionId ?? '');
  const [productId, setProductId] = useState<string>(c?.productId ?? '');
  const [from, setFrom] = useState(c?.schedule?.from ?? '');
  const [to, setTo] = useState(c?.schedule?.to ?? '');
  const [allDay, setAllDay] = useState(!(c?.schedule?.start && c?.schedule?.end));
  const [start, setStart] = useState(c?.schedule?.start ?? '08:00');
  const [end, setEnd] = useState(c?.schedule?.end ?? '12:00');
  const [days, setDays] = useState<number[]>(c?.schedule?.days ?? []);
  const [imgError, setImgError] = useState<string | null>(null);
  const toggleDay = (d: number) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort());
  const pick = async (f: File | undefined) => { if (!f) return; setImgError(null); try { const v = await readPicture(f); if (v.length > 300_000) { setImgError(t('الصورة أكبر من المسموح')); return; } setImage(v); } catch { setImgError(t('تعذرت قراءة الصورة')); } };
  const save = async () => {
    const body = {
      id: c?.id, expectedVersion: c?.version, kind, title: { ar: titleAr.trim(), en: titleEn.trim() }, body: bodyAr.trim() || bodyEn.trim() ? { ar: bodyAr.trim(), en: bodyEn.trim() } : null,
      imageDataUrl: kind === 'IMAGE' ? image : undefined, promotionId: kind === 'PROMOTION' ? promotionId : undefined, productId: kind === 'DISH' ? productId : undefined,
      schedule: { from: from || null, to: to || null, start: allDay ? null : start, end: allDay ? null : end, days: days.length === 7 ? [] : days },
    };
    const r = await run('DisplayContent.Upsert', { body }, { success: t('حُفظ المحتوى') });
    if (r) onClose();
  };
  const ok = titleAr.trim() && (kind !== 'IMAGE' || image) && (kind !== 'PROMOTION' || promotionId) && (kind !== 'DISH' || productId);
  const en = getLang() === 'en';
  return (
    <Modal open onClose={onClose} wide title={edit ? t('تعديل المحتوى') : t('محتوى جديد')} badge={<StateBadge ops={['DisplayContent.Upsert']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!ok} onClick={save} data-fb="content-save">{t('حفظ')}</Button></>}>
      <div className="space-y-4" data-fb="content-form">
        {!edit && <Field label={t('النوع')}><SegmentedControl value={kind} onChange={setKind} options={['MESSAGE', 'IMAGE', 'PROMOTION', 'DISH'].map((k) => ({ id: k, label: contentKindLabel(k), fb: `content-kind:${k}` }))} /></Field>}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('العنوان بالعربية')} required><Input value={titleAr} onChange={(e) => setTitleAr(e.target.value)} maxLength={60} dir="rtl" data-fb="content-title-ar" /></Field>
          <Field label={t('العنوان بالإنجليزية')}><Input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} maxLength={60} dir="ltr" data-fb="content-title-en" /></Field>
          <Field label={t('سطر بالعربية')}><Input value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} maxLength={120} dir="rtl" data-fb="content-body-ar" /></Field>
          <Field label={t('سطر بالإنجليزية')}><Input value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} maxLength={120} dir="ltr" data-fb="content-body-en" /></Field>
        </div>
        {kind === 'IMAGE' && (
          <Field label={t('الصورة')} required error={imgError}>
            <div className="flex items-center gap-3">
              <div className="w-28 h-20 rounded-xl surface-2 flex items-center justify-center overflow-hidden">{image ? <img src={image} alt="" className="max-w-full max-h-full object-contain" /> : <ImageIcon className="w-6 h-6 text-dim" />}</div>
              <label className="inline-flex items-center gap-2 h-10 px-3 rounded-xl border border-[var(--glass-border)] surface-1 text-sm font-bold cursor-pointer"><ImageIcon className="w-4 h-4" />{t('اختيار صورة')}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} data-fb="content-image" /></label>
            </div>
          </Field>
        )}
        {kind === 'PROMOTION' && <Field label={t('العرض')} required hint={t('الخصم يُقرأ من العرض نفسه')}><Select value={promotionId} onChange={(e) => setPromotionId(e.target.value)} data-fb="content-promotion" options={[{ value: '', label: t('اختر عرضًا') }, ...promos.items.map((p) => ({ value: p.id, label: `${L(p.name)}${p.active ? '' : ' — ' + t('متوقف')}` }))]} /></Field>}
        {kind === 'DISH' && <Field label={t('الصنف')} required><Select value={productId} onChange={(e) => setProductId(e.target.value)} data-fb="content-product" options={[{ value: '', label: t('اختر صنفًا') }, ...products.items.filter((p) => p.active !== false).map((p) => ({ value: p.id, label: en ? p.name?.en ?? L(p.name) : L(p.name) }))]} /></Field>}
        <div className="rounded-xl surface-1 border line p-3 space-y-3" data-fb="content-schedule">
          <div className="text-xs font-bold text-soft">{t('الوقت')}</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('من يوم')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" data-fb="content-from" /></Field>
            <Field label={t('إلى يوم')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" data-fb="content-to" /></Field>
          </div>
          <Switch checked={allDay} onChange={setAllDay} label={t('طوال اليوم')} />
          {!allDay && <div className="grid sm:grid-cols-2 gap-3"><Field label={t('من الساعة')}><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} dir="ltr" data-fb="content-start" /></Field><Field label={t('إلى الساعة')}><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} dir="ltr" data-fb="content-end" /></Field></div>}
          <Field label={t('الأيام')} hint={days.length ? undefined : t('كل يوم')}><div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => <Chip key={d} on={days.includes(i)} onClick={() => toggleDay(i)} fb={`content-day:${i}`}>{t(d)}</Chip>)}</div></Field>
        </div>
      </div>
    </Modal>
  );
}

function RetireModal({ c, onClose }: { c: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const min = useReasonMin();
  const [reason, setReason] = useState('');
  const save = async () => {
    const r = await run('DisplayContent.Retire', { params: { contentId: c.id }, body: { reason: reason.trim(), expectedVersion: c.version } }, { success: t('أُوقف المحتوى') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={t('إيقاف «{n}»', { n: L(c.title) })} badge={<StateBadge ops={['DisplayContent.Retire']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < min} onClick={save} data-fb="content-retire-confirm">{t('إيقاف المحتوى')}</Button></>}>
      <div className="space-y-3" data-fb="content-retire-popup">
        {c.usedBy?.length > 0 && <Banner tone="warning">{t('يخرج من: {d}', { d: c.usedBy.map((d: any) => tv(d.name)).join(t('، ')) })}</Banner>}
        <Field label={t('السبب')} required hint={t('{n} أحرف على الأقل', { n: min })}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-fb="content-retire-reason" /></Field>
      </div>
    </Modal>
  );
}

// ───────── settings (the same records as «الإعدادات والأسباب»)
function SettingsTab() {
  return (
    <div className="grid @4xl/main:grid-cols-2 gap-3 items-start">
      <PolicyCard policyId="CustomerDisplayPolicy" title={t('محتوى شاشة العميل')} />
      <PolicyCard policyId="PrintRoutingPolicy" title={t('الطابعة البديلة')} />
      <PolicyCard policyId="DeviceHealthPolicy" title={t('انقطاع الشاشات')} />
      <PolicyCard policyId="KeyMapPolicy" title={t('تغيير مفاتيح الاختصار')} />
      <PolicyCard policyId="CallBoardPolicy" title={t('شاشة النداء')} />
    </div>
  );
}
