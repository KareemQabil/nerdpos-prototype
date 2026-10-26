// A2 Users & roles: create users with roles and branch scope, manage access (approval by policy),
// credential reset (approval by policy), roles and their permissions.
import React, { useMemo, useState } from 'react';
import { UserPlus, ShieldCheck, KeyRound, Pencil, Plus, Power, Lock, Trash2, Info } from 'lucide-react';
import { useCommand, useQuery, useDev, errorText } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, Pill, Section, Select, StateBadge, Switch, Table, Tabs, toast } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { useList, usePerm, RulePill, Refused, Modal } from './org/common';

interface RA { roleId: string; branchIds: string[] }

export default function UsersScreen() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  return (
    <div className="space-y-4" data-fb="screen:A2">
      <Section
        title={t('المستخدمين والأدوار')}
        badge={<StateBadge ops={['User.Find', 'User.Create', 'User.ManageAccess', 'Credential.Reset', 'Role.List', 'Role.Create', 'Role.Update', 'Permission.List']} />}
        sub={t('كل مستخدم ليه دور أو أكتر، وكل دور على فروع معينة. تغيير الصلاحيات وإعادة تعيين الرقم السري ممكن يحتاجوا موافقة مدير حسب الإعدادات.')}
        actions={<div className="flex gap-1 flex-wrap"><RulePill action="USER_ACCESS_CHANGE" /><RulePill action="CREDENTIAL_RESET" /></div>}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'users', label: t('المستخدمين') }, { id: 'roles', label: t('الأدوار والصلاحيات') }]} />
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </div>
  );
}

function useCredentialPolicy() {
  const q = useQuery<any>('Settings.Effective', { query: { policyId: 'CredentialPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  return { passwordMinLength: Number(q.data?.value?.passwordMinLength ?? 10), pinLength: Number(q.data?.value?.pinLength ?? 6) };
}

// ───────── users
function UsersTab() {
  const users = useList<any>('User.Find');
  const roles = useList<any>('Role.List');
  const branches = useList<any>('Branch.List');
  const permCreate = usePerm('user:create');
  const permAccess = usePerm('user:manageaccess');
  const permReset = usePerm('credential:reset');
  const { run, busy } = useCommand();
  const [creating, setCreating] = useState(false);
  const [access, setAccess] = useState<any | null>(null);
  const [reset, setReset] = useState<any | null>(null);
  const bCode = (id: string) => (id === '*' ? t('كل الفروع') : branches.items.find((b) => b.id === id)?.code ?? id);
  const toggle = async (u: any) => {
    await run('User.ManageAccess', { params: { userId: u.id }, body: { active: !u.active, roleAssignments: u.roleAssignments.map((r: any) => ({ roleId: r.roleId, branchIds: r.branchIds })), expectedVersion: u.version } },
      { success: u.active ? t('اتوقف {n} — جلساته اتلغت', { n: u.displayName }) : t('اتفعّل {n}', { n: u.displayName }) });
  };
  return (
    <Card title={t('المستخدمين')} badge={<StateBadge ops={['User.Find', 'User.Create', 'User.ManageAccess', 'Credential.Reset']} />}
      actions={<Button size="sm" variant="primary" data-fb="users:new" disabled={!permCreate.ok} title={permCreate.title} onClick={() => setCreating(true)}><UserPlus className="w-4 h-4" />{t('مستخدم جديد')}</Button>}>
      <Refused error={users.error} />
      <Banner tone="info">{t('إيقاف مستخدم بيلغي كل جلساته فورًا: أي جهاز داخل بيه هيرجع لشاشة الدخول مع أول عملية (N8).')}</Banner>
      <div className="mt-3" />
      <Table head={[t('الاسم'), t('اسم الدخول'), t('الأدوار والفروع'), t('الحالة'), '']}
        rows={users.items.map((u) => [
          <span className="font-bold">{u.displayName}</span>,
          <span className="num text-xs">{u.username}</span>,
          <div className="flex flex-wrap gap-1">{u.roleAssignments.map((r: any, i: number) => <Pill key={i} tone="primary">{r.roleName ?? r.roleId} · <span className="num">{r.branchIds.map(bCode).join('، ')}</span></Pill>)}</div>,
          <div className="flex flex-wrap gap-1">
            {u.active ? <Pill tone="success">{t('شغال')}</Pill> : <Pill tone="neutral">{t('موقوف')}</Pill>}
            {u.locked && <Pill tone="error"><Lock className="w-3 h-3" />{t('مقفول')}</Pill>}
            {u.mustChangeCredentials && <Pill tone="warning">{t('لازم يغيّر الرقم السري')}</Pill>}
          </div>,
          <div className="flex gap-1 justify-end flex-wrap">
            <Button size="sm" variant="outline" data-fb={`users:access:${u.username}`} disabled={!permAccess.ok} title={permAccess.title} onClick={() => setAccess(u)}><ShieldCheck className="w-3.5 h-3.5" />{t('الصلاحيات')}</Button>
            <Button size="sm" variant="secondary" data-fb={`users:reset:${u.username}`} disabled={!permReset.ok} title={permReset.title} onClick={() => setReset(u)}><KeyRound className="w-3.5 h-3.5" />{t('رقم سري جديد')}</Button>
            <Button size="sm" variant={u.active ? 'danger' : 'success'} data-fb={`users:toggle:${u.username}`} disabled={!permAccess.ok || busy} title={permAccess.title} onClick={() => toggle(u)}><Power className="w-3.5 h-3.5" />{u.active ? t('إيقاف') : t('تفعيل')}</Button>
          </div>,
        ])} />
      {creating && <CreateUserModal roles={roles.items} branches={branches.items} onClose={() => setCreating(false)} />}
      {access && <AccessModal user={access} roles={roles.items} branches={branches.items} onClose={() => setAccess(null)} />}
      {reset && <ResetModal user={reset} onClose={() => setReset(null)} />}
    </Card>
  );
}

function AssignmentsEditor({ value, onChange, roles, branches }: { value: RA[]; onChange: (v: RA[]) => void; roles: any[]; branches: any[] }) {
  const set = (i: number, patch: Partial<RA>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {value.map((ra, i) => (
        <div key={i} className="rounded-xl surface-1 p-2 space-y-2" data-fb={`users:assignment:${i}`}>
          <div className="flex gap-2 items-center">
            <Select value={ra.roleId} onChange={(e) => set(i, { roleId: e.target.value })} options={[{ value: '', label: t('اختار الدور') }, ...roles.map((r) => ({ value: r.id, label: `${r.name}${r.active ? '' : ' — ' + t('موقوف')}` }))]} />
            <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} title={t('شيل')}><Trash2 className="w-4 h-4" /></Button>
          </div>
          <div className="flex flex-wrap gap-1">
            <span className="text-[11px] text-dim">{t('الفروع:')}</span>
            {branches.map((b) => {
              const on = ra.branchIds.includes(b.id);
              return <button key={b.id} type="button" onClick={() => set(i, { branchIds: on ? ra.branchIds.filter((x) => x !== b.id) : [...ra.branchIds.filter((x) => x !== '*'), b.id] })}
                className={cn('px-2 h-7 rounded-lg text-xs border num', on ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-2 border-[var(--glass-border)]')}>{b.code} · {b.name}</button>;
            })}
            {ra.branchIds.includes('*') && <Pill tone="violet">{t('كل الفروع (*)')}</Pill>}
          </div>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...value, { roleId: '', branchIds: branches[0] ? [branches[0].id] : [] }])}><Plus className="w-3.5 h-3.5" />{t('دور تاني')}</Button>
    </div>
  );
}

const validRA = (v: RA[]) => v.length > 0 && v.every((r) => r.roleId && r.branchIds.length > 0);

function CreateUserModal({ roles, branches, onClose }: { roles: any[]; branches: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const cp = useCredentialPolicy();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [ras, setRas] = useState<RA[]>([{ roleId: roles.find((r) => r.active)?.id ?? '', branchIds: branches[0] ? [branches[0].id] : [] }]);
  const save = async () => {
    const r = await run('User.Create', { body: { username: username.trim(), displayName: displayName.trim(), password, pin: pin || undefined, roleAssignments: ras } }, { success: t('اتعمل المستخدم {n}', { n: displayName }) });
    if (r) onClose();
  };
  return (
    <Modal open wide onClose={onClose} title={t('مستخدم جديد')} badge={<StateBadge ops={['User.Create']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!username.trim() || !displayName.trim() || !password || !validRA(ras)} onClick={save} data-fb="users:create-save">{t('إنشاء')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('اسم الدخول')} hint={t('فريد؛ تكراره بيرجع USERNAME_TAKEN')}><Input value={username} onChange={(e) => setUsername(e.target.value.trim().toLowerCase())} dir="ltr" data-fb="users:create-username" /></Field>
          <Field label={t('الاسم اللي بيظهر')}><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-fb="users:create-display" /></Field>
          <Field label={t('الباسورد')} hint={t('على الأقل {n} حروف (CredentialPolicy)', { n: cp.passwordMinLength })} error={password && password.length < cp.passwordMinLength ? t('قصير — السيرفر هيرفض CREDENTIAL_POLICY_VIOLATION') : null}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" data-fb="users:create-password" />
          </Field>
          <Field label={t('الرقم السري PIN (اختياري)')} hint={t('{n} أرقام بالظبط (CredentialPolicy)', { n: cp.pinLength })} error={pin && !new RegExp(`^\\d{${cp.pinLength}}$`).test(pin) ? t('لازم {n} أرقام', { n: cp.pinLength }) : null}>
            <Input inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} dir="ltr" data-fb="users:create-pin" />
          </Field>
        </div>
        <div className="text-xs font-bold text-soft">{t('الأدوار ونطاق الفروع')}</div>
        <AssignmentsEditor value={ras} onChange={setRas} roles={roles} branches={branches} />
        <Banner tone="info">{t('في التركيب الحقيقي الرقم السري والباسورد بيوصلوا للشخص نفسه (Credential.Reset)، عمرهم ما بيتكتبوا في محضر. من غير PIN المستخدم لازم يغيّر بياناته أول ما يدخل.')}</Banner>
      </div>
    </Modal>
  );
}

function AccessModal({ user, roles, branches, onClose }: { user: any; roles: any[]; branches: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [active, setActive] = useState<boolean>(user.active);
  const [ras, setRas] = useState<RA[]>(user.roleAssignments.map((r: any) => ({ roleId: r.roleId, branchIds: [...r.branchIds] })));
  const save = async () => {
    const r = await run('User.ManageAccess', { params: { userId: user.id }, body: { active, roleAssignments: ras, expectedVersion: user.version } }, { success: t('اتحدثت صلاحيات {n}', { n: user.displayName }) });
    if (r) onClose();
  };
  return (
    <Modal open wide onClose={onClose} title={t('صلاحيات {n}', { n: user.displayName })} badge={<StateBadge ops={['User.ManageAccess']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!validRA(ras)} onClick={save} data-fb="users:access-save">{t('حفظ')}</Button></>}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Switch checked={active} onChange={setActive} label={active ? t('الحساب شغال') : t('الحساب موقوف')} />
          <RulePill action="USER_ACCESS_CHANGE" />
        </div>
        {!active && user.active && <Banner tone="warning">{t('الإيقاف بيلغي كل جلسات المستخدم: الجهاز اللي داخل بيه هيرجع لشاشة الدخول مع أول عملية (N8).')}</Banner>}
        <AssignmentsEditor value={ras} onChange={setRas} roles={roles} branches={branches} />
        <div className="text-[11px] text-dim">{t('لو مفيش حد تاني يقدر يدير الصلاحيات، السيرفر بيرفض LAST_OWNER_PROTECTED. النسخة {v} (expectedVersion).', { v: user.version })}</div>
      </div>
    </Modal>
  );
}

function ResetModal({ user, onClose }: { user: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const cp = useCredentialPolicy();
  const [kind, setKind] = useState<'PIN' | 'PASSWORD'>('PIN');
  const [secret, setSecret] = useState('');
  const ok = kind === 'PIN' ? new RegExp(`^\\d{${cp.pinLength}}$`).test(secret) : secret.length >= cp.passwordMinLength;
  const save = async () => {
    // Credential.Reset answers 204 (no body): run() gives null for both success and refusal, so refusals are caught here.
    try {
      await run('Credential.Reset', { params: { userId: user.id }, body: { kind, newSecret: secret } }, { success: t('اتعمل رقم سري جديد لـ {n} — لازم يغيّره أول دخول', { n: user.displayName }), quiet: true });
      onClose();
    } catch (e: any) {
      toast('error', errorText(e), `${e.code} · ${e.status}`);
    }
  };
  return (
    <Modal open onClose={onClose} title={t('رقم سري جديد لـ {n}', { n: user.displayName })} badge={<StateBadge ops={['Credential.Reset']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!secret} onClick={save} data-fb="users:reset-save">{t('إعادة تعيين')}</Button></>}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Tabs value={kind} onChange={(k) => { setKind(k); setSecret(''); }} tabs={[{ id: 'PIN', label: 'PIN' }, { id: 'PASSWORD', label: t('باسورد') }]} />
          <RulePill action="CREDENTIAL_RESET" />
        </div>
        <Field label={kind === 'PIN' ? t('PIN جديد ({n} أرقام)', { n: cp.pinLength }) : t('باسورد جديد (على الأقل {n})', { n: cp.passwordMinLength })} error={secret && !ok ? t('مش مطابق لـ CredentialPolicy — السيرفر هيرفض') : null}>
          <Input type="password" inputMode={kind === 'PIN' ? 'numeric' : undefined} value={secret} onChange={(e) => setSecret(kind === 'PIN' ? e.target.value.replace(/\D/g, '') : e.target.value)} dir="ltr" data-fb="users:reset-secret" />
        </Field>
        <Banner tone="info">{t('إعادة التعيين بتفك القفل لو الحساب مقفول من محاولات غلط، وبتخلّي المستخدم يغيّر الرقم أول ما يدخل.')}</Banner>
      </div>
    </Modal>
  );
}

// ───────── roles
function RolesTab() {
  const roles = useList<any>('Role.List');
  const perms = useList<any>('Permission.List');
  const permCreate = usePerm('role:create');
  const permUpdate = usePerm('role:update');
  const [edit, setEdit] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Banner tone="info"><span className="flex items-center gap-1"><Info className="w-3.5 h-3.5" />{t('الصلاحيات اللي عليها "أضيفت للنموذج" مش في أدوار ملف التجهيز 1.2 — النموذج زوّدها عشان الخبير يقدر يجرب كل الشاشات (PROTOTYPE_GAPS).')}</span></Banner>
        <Button size="sm" variant="primary" data-fb="roles:new" disabled={!permCreate.ok} title={permCreate.title} onClick={() => setCreating(true)}><Plus className="w-4 h-4" />{t('دور جديد')}</Button>
      </div>
      <Refused error={roles.error} />
      <div className="grid xl:grid-cols-2 gap-3">
        {roles.items.map((r) => {
          const added: string[] = r.demoAdded ?? [];
          return (
            <Card key={r.id} title={<span>{r.name} <span className="num text-xs text-dim font-normal">{r.id} · v{r.version}</span></span>}
              badge={r.active ? <Pill tone="success">{t('شغال')}</Pill> : <Pill tone="neutral">{t('موقوف')}</Pill>}
              actions={<Button size="sm" variant="outline" data-fb={`roles:edit:${r.id}`} disabled={!permUpdate.ok} title={permUpdate.title} onClick={() => setEdit(r)}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>}>
              <div className="flex flex-wrap gap-1">
                {r.permissionIds.map((p: string) => {
                  const demo = added.includes(p);
                  return <span key={p} className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] num border', demo ? 'border-[rgba(168,85,247,.5)] bg-[rgba(168,85,247,.12)] text-[#c084fc]' : 'surface-2 border-[var(--glass-border)] text-soft')}>{p}{demo && <span className="font-bold font-sans">· {t('أضيفت للنموذج')}</span>}</span>;
                })}
              </div>
              {added.length > 0 && <div className="mt-2"><Pill tone="violet">{t('أضيفت للنموذج')}: {added.length}</Pill></div>}
            </Card>
          );
        })}
      </div>
      {(creating || edit) && <RoleModal role={edit} catalog={perms.items.map((p) => p.id)} onClose={() => { setCreating(false); setEdit(null); }} />}
    </div>
  );
}

function RoleModal({ role, catalog, onClose }: { role: any | null; catalog: string[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [name, setName] = useState(role?.name ?? '');
  const [active, setActive] = useState<boolean>(role?.active ?? true);
  const [sel, setSel] = useState<string[]>(role?.permissionIds ?? []);
  const [free, setFree] = useState('');
  const [filter, setFilter] = useState('');
  const added: string[] = role?.demoAdded ?? [];
  const all = useMemo(() => [...new Set([...catalog, ...sel])].sort(), [catalog, sel]);
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    all.filter((p) => !filter || p.includes(filter.toLowerCase())).forEach((p) => { const k = p.includes(':') ? p.split(':')[0] : '*'; m.set(k, [...(m.get(k) ?? []), p]); });
    return [...m.entries()];
  }, [all, filter]);
  const toggle = (p: string) => setSel((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  const addFree = () => {
    const ids = free.split(/[\s,،]+/).map((x) => x.trim()).filter(Boolean);
    setSel((s) => [...new Set([...s, ...ids])]);
    setFree('');
  };
  const save = async () => {
    const body = { name: name.trim(), permissionIds: sel };
    const r = role
      ? await run('Role.Update', { params: { roleId: role.id }, body: { ...body, active, expectedVersion: role.version } }, { success: t('اتحدث الدور') })
      : await run('Role.Create', { body }, { success: t('اتعمل الدور') });
    if (r) onClose();
  };
  return (
    <Modal open xwide onClose={onClose} title={role ? t('تعديل الدور {n}', { n: role.name }) : t('دور جديد')} badge={<StateBadge ops={[role ? 'Role.Update' : 'Role.Create', 'Permission.List']} />}
      footer={<><span className="text-xs text-dim me-auto">{t('{n} صلاحية مختارة', { n: sel.length })}</span><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save} data-fb="roles:save">{t('حفظ')}</Button></>}>
      <div className="space-y-3">
        <div className="grid md:grid-cols-3 gap-3 items-end">
          <Field label={t('اسم الدور')} hint={t('فريد؛ تكراره بيرجع ROLE_NAME_TAKEN')}><Input value={name} onChange={(e) => setName(e.target.value)} data-fb="roles:name" /></Field>
          {role && <Field label={t('الحالة')}><Switch checked={active} onChange={setActive} label={active ? t('شغال') : t('موقوف')} /></Field>}
          <Field label={t('دوّر')}><Input value={filter} onChange={(e) => setFilter(e.target.value)} dir="ltr" placeholder="order:" /></Field>
        </div>
        <div className="flex items-end gap-2">
          <Field label={t('صلاحية بالنص (لو مش في القايمة)')} hint={t('صلاحية مش متسجلة بترجع UNKNOWN_PERMISSION_ID')} className="flex-1"><Input value={free} onChange={(e) => setFree(e.target.value)} dir="ltr" placeholder="approve:price_change" onKeyDown={(e) => e.key === 'Enter' && addFree()} data-fb="roles:free" /></Field>
          <Button variant="secondary" onClick={addFree} disabled={!free.trim()} data-fb="roles:free-add">{t('ضيف')}</Button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto space-y-2 pe-1">
          {groups.map(([mod, ids]) => (
            <div key={mod} className="rounded-xl surface-1 p-2">
              <div className="text-xs font-bold num mb-1">{mod}</div>
              <div className="flex flex-wrap gap-1">
                {ids.map((p) => {
                  const on = sel.includes(p);
                  const demo = added.includes(p);
                  return <button key={p} type="button" onClick={() => toggle(p)} data-fb={`roles:perm:${p}`}
                    className={cn('px-1.5 h-6 rounded text-[10px] num border', on ? (demo ? 'bg-[rgba(168,85,247,.25)] border-[rgba(168,85,247,.6)] text-[#e9d5ff] font-bold' : 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold') : 'surface-2 border-[var(--glass-border)] text-soft')}>{on ? '✓ ' : ''}{p}{demo ? ` · ${t('أضيفت للنموذج')}` : ''}</button>;
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-dim">{t('التعديل ممكن يحتاج موافقة USER_ACCESS_CHANGE حسب الإعدادات. الصلاحيات الجديدة بتتطبق على الطلب الجاي لكل مستخدم عليه الدور ده.')}</div>
      </div>
    </Modal>
  );
}

