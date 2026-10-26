// A2 Users & roles: create users with roles and branch scope, manage access (approval by policy),
// credential reset (approval by policy), roles and their permissions.
import React, { useMemo, useState } from 'react';
import { UserPlus, ShieldCheck, KeyRound, Pencil, Plus, Power, Lock, Trash2, Users, UserCheck, UserX, KeySquare, Search } from 'lucide-react';
import { useCommand, useQuery, errorText } from '../../app/hooks';
import { Avatar, Banner, Button, Card, Drawer, EmptyState, Field, FilterChips, Input, PageHeader, Pill, SearchInput, Select, StatCard, StatGrid, StateBadge, Switch, Table, Tabs, Toolbar, toast } from '../../ui';
import { t } from '../../i18n';
import { Tech } from '../../app/tech';
import { cn } from '../../lib/format';
import { branchLabel, personName, roleLabel } from '../../demo/people';
import { useList, usePerm, RulePill, Refused, Modal } from './org/common';
import { permText, moduleText } from './org/permText';

interface RA { roleId: string; branchIds: string[] }

export default function UsersScreen() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [newUser, setNewUser] = useState(false);
  const [newRole, setNewRole] = useState(false);
  const users = useList<any>('User.Find');
  const roles = useList<any>('Role.List');
  const permCreate = usePerm('user:create');
  const permRole = usePerm('role:create');
  return (
    <div className="space-y-4" data-fb="screen:A2">
      <PageHeader
        icon={<Users />}
        title={t('المستخدمين والأدوار')}
        badge={<StateBadge ops={['User.Find', 'User.Create', 'User.ManageAccess', 'Credential.Reset', 'Role.List', 'Role.Create', 'Role.Update', 'Permission.List']} />}
        description={t('مين يدخل على السيستم، بأنهي دور، وعلى أنهي فرع. الدور بيحدد الشاشات والحركات المسموحة.')}
        meta={<><RulePill action="USER_ACCESS_CHANGE" /><RulePill action="CREDENTIAL_RESET" /></>}
        actions={tab === 'users'
          ? <Button variant="primary" data-fb="users:new" disabled={!permCreate.ok} title={permCreate.title} onClick={() => setNewUser(true)}><UserPlus className="w-4 h-4" />{t('مستخدم جديد')}</Button>
          : <Button variant="primary" data-fb="roles:new" disabled={!permRole.ok} title={permRole.title} onClick={() => setNewRole(true)}><Plus className="w-4 h-4" />{t('دور جديد')}</Button>}
      />
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'users', label: t('المستخدمين'), count: users.items.length || undefined }, { id: 'roles', label: t('الأدوار والصلاحيات'), count: roles.items.length || undefined }]} />
      {tab === 'users' ? <UsersTab users={users} roles={roles.items} creating={newUser} setCreating={setNewUser} /> : <RolesTab roles={roles} creating={newRole} setCreating={setNewRole} />}
    </div>
  );
}

function useCredentialPolicy() {
  const q = useQuery<any>('Settings.Effective', { query: { policyId: 'CredentialPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  return { passwordMinLength: Number(q.data?.value?.passwordMinLength ?? 10), pinLength: Number(q.data?.value?.pinLength ?? 6) };
}

const roleName = (r: { roleName?: string; name?: string; roleId?: string } | undefined) => roleLabel(r?.roleName ?? r?.name ?? '') || t('دور');

// ───────── users
function UsersTab({ users, roles, creating, setCreating }: { users: ReturnType<typeof useList<any>>; roles: any[]; creating: boolean; setCreating: (v: boolean) => void }) {
  const branches = useList<any>('Branch.List');
  const permAccess = usePerm('user:manageaccess');
  const permReset = usePerm('credential:reset');
  const { run, busy } = useCommand();
  const [access, setAccess] = useState<any | null>(null);
  const [reset, setReset] = useState<any | null>(null);
  const [q, setQ] = useState('');
  const [st, setSt] = useState<'all' | 'active' | 'off' | 'locked'>('all');
  const [role, setRole] = useState('');
  const bName = (id: string) => (id === '*' ? t('كل الفروع') : branchLabel(branches.items.find((b) => b.id === id)) || t('فرع'));
  const toggle = async (u: any) => {
    await run('User.ManageAccess', { params: { userId: u.id }, body: { active: !u.active, roleAssignments: u.roleAssignments.map((r: any) => ({ roleId: r.roleId, branchIds: r.branchIds })), expectedVersion: u.version } },
      { success: u.active ? t('اتوقف حساب {n} — خرج من كل الأجهزة', { n: personName(u.username, u.displayName) }) : t('اتفعّل حساب {n}', { n: personName(u.username, u.displayName) }) });
  };
  const all = users.items;
  const count = { active: all.filter((u) => u.active).length, off: all.filter((u) => !u.active).length, locked: all.filter((u) => u.locked).length, must: all.filter((u) => u.mustChangeCredentials).length };
  const list = all.filter((u) => {
    if (st === 'active' && !u.active) return false;
    if (st === 'off' && u.active) return false;
    if (st === 'locked' && !u.locked) return false;
    if (role && !u.roleAssignments.some((r: any) => r.roleId === role)) return false;
    if (q) { const s = q.trim().toLowerCase(); return `${u.displayName} ${u.username} ${u.roleAssignments.map((r: any) => roleName(r)).join(' ')}`.toLowerCase().includes(s); }
    return true;
  });
  return (
    <div className="space-y-4">
      <Refused error={users.error} />
      <StatGrid>
        <StatCard label={t('حسابات شغالة')} value={count.active} icon={<UserCheck />} tone="success" loading={users.loading && !users.data} />
        <StatCard label={t('حسابات موقوفة')} value={count.off} icon={<UserX />} hint={t('ما يقدروش يدخلوا من أي جهاز')} loading={users.loading && !users.data} />
        <StatCard label={t('مقفولة من محاولات غلط')} value={count.locked} icon={<Lock />} tone={count.locked ? 'error' : 'neutral'} hint={t('رقم سري جديد بيفك القفل')} loading={users.loading && !users.data} />
        <StatCard label={t('لازم يغيّروا الرقم السري')} value={count.must} icon={<KeySquare />} tone={count.must ? 'warning' : 'neutral'} hint={t('أول ما يدخلوا')} loading={users.loading && !users.data} />
      </StatGrid>
      <Card padding="sm">
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder={t('دوّر بالاسم أو الدور')} data-fb="users:search" />
          <FilterChips value={st} onChange={setSt} options={[
            { id: 'all', label: t('الكل'), count: all.length },
            { id: 'active', label: t('شغال'), count: count.active },
            { id: 'off', label: t('موقوف'), count: count.off },
            { id: 'locked', label: t('مقفول'), count: count.locked, tone: 'error' },
          ]} />
          <Select className="!w-auto min-w-[150px] h-9 !py-0" value={role} onChange={(e) => setRole(e.target.value)} options={[{ value: '', label: t('كل الأدوار') }, ...roles.map((r) => ({ value: r.id, label: roleName(r) }))]} />
        </Toolbar>
        <Table head={[t('الموظف'), t('الدور والفروع'), t('الحالة'), '']} align={['start', 'start', 'start', 'end']}
          loading={users.loading && !users.data}
          empty={<EmptyState compact icon={<Search />} title={all.length ? t('مفيش حد بالبحث ده') : t('لسه مفيش مستخدمين')} text={all.length ? t('غيّر البحث أو الفلتر.') : t('ضيف أول موظف من «مستخدم جديد».')} />}
          rows={list.map((u) => [
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar name={personName(u.username, u.displayName)} size="sm" />
              <div className="min-w-0"><div className="font-bold truncate">{u.displayName}</div><Tech><div className="num text-[11px] text-dim" dir="ltr">{u.username}</div></Tech></div>
            </div>,
            <div className="flex flex-wrap gap-1">{u.roleAssignments.map((r: any, i: number) => <Pill key={i} tone="primary">{roleName(r)} · {r.branchIds.map(bName).join('، ')}</Pill>)}</div>,
            <div className="flex flex-wrap gap-1">
              {u.active ? <Pill tone="success" dot>{t('شغال')}</Pill> : <Pill tone="neutral" dot>{t('موقوف')}</Pill>}
              {u.locked && <Pill tone="error"><Lock className="w-3 h-3" />{t('مقفول')}</Pill>}
              {u.mustChangeCredentials && <Pill tone="warning">{t('لازم يغيّر الرقم السري')}</Pill>}
            </div>,
            <div className="flex gap-1 justify-end flex-wrap">
              <Button size="sm" variant="outline" data-fb={`users:access:${u.username}`} disabled={!permAccess.ok} title={permAccess.title} onClick={() => setAccess(u)}><ShieldCheck className="w-3.5 h-3.5" />{t('الصلاحيات')}</Button>
              <Button size="sm" variant="ghost" data-fb={`users:reset:${u.username}`} disabled={!permReset.ok} title={permReset.title} onClick={() => setReset(u)}><KeyRound className="w-3.5 h-3.5" />{t('رقم سري جديد')}</Button>
              <Button size="sm" variant={u.active ? 'danger' : 'success'} data-fb={`users:toggle:${u.username}`} disabled={!permAccess.ok || busy} title={permAccess.title} onClick={() => toggle(u)}><Power className="w-3.5 h-3.5" />{u.active ? t('إيقاف') : t('تفعيل')}</Button>
            </div>,
          ])} />
        <div className="text-[11px] text-dim mt-2 px-1">{t('إيقاف الحساب بيخرّج الموظف من كل الأجهزة فورًا — أول حركة بعدها بترجّعه لشاشة الدخول.')}<Tech> (N8)</Tech></div>
      </Card>
      {creating && <CreateUserDrawer roles={roles} branches={branches.items} onClose={() => setCreating(false)} />}
      {access && <AccessDrawer user={access} roles={roles} branches={branches.items} onClose={() => setAccess(null)} />}
      {reset && <ResetModal user={reset} onClose={() => setReset(null)} />}
    </div>
  );
}

function AssignmentsEditor({ value, onChange, roles, branches }: { value: RA[]; onChange: (v: RA[]) => void; roles: any[]; branches: any[] }) {
  const set = (i: number, patch: Partial<RA>) => onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {value.map((ra, i) => (
        <div key={i} className="rounded-xl surface-1 border line p-3 space-y-2" data-fb={`users:assignment:${i}`}>
          <div className="flex gap-2 items-center">
            <Select value={ra.roleId} onChange={(e) => set(i, { roleId: e.target.value })} options={[{ value: '', label: t('اختار الدور') }, ...roles.map((r) => ({ value: r.id, label: `${roleName(r)}${r.active ? '' : ' — ' + t('موقوف')}` }))]} />
            <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} title={t('شيل الدور ده')}><Trash2 className="w-4 h-4" /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-dim">{t('على فروع:')}</span>
            {branches.map((b) => {
              const on = ra.branchIds.includes(b.id);
              return <button key={b.id} type="button" onClick={() => set(i, { branchIds: on ? ra.branchIds.filter((x) => x !== b.id) : [...ra.branchIds.filter((x) => x !== '*'), b.id] })}
                className={cn('px-2.5 h-7 rounded-full text-xs border', on ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-2 border-[var(--glass-border)]')}>{branchLabel(b)}</button>;
            })}
            {ra.branchIds.includes('*') && <Pill tone="violet">{t('كل الفروع')}</Pill>}
          </div>
          {ra.roleId && ra.branchIds.length === 0 && <div className="text-[11px] text-[var(--error)]">{t('اختار فرع واحد على الأقل.')}</div>}
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...value, { roleId: '', branchIds: branches[0] ? [branches[0].id] : [] }])}><Plus className="w-3.5 h-3.5" />{t('ضيف دور تاني')}</Button>
    </div>
  );
}

const validRA = (v: RA[]) => v.length > 0 && v.every((r) => r.roleId && r.branchIds.length > 0);

function FormGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div><div className="text-sm font-bold">{title}</div>{hint && <div className="text-xs text-dim mt-0.5">{hint}</div>}</div>
      {children}
    </section>
  );
}

function CreateUserDrawer({ roles, branches, onClose }: { roles: any[]; branches: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const cp = useCredentialPolicy();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [ras, setRas] = useState<RA[]>([{ roleId: roles.find((r) => r.active)?.id ?? '', branchIds: branches[0] ? [branches[0].id] : [] }]);
  const pwErr = password && password.length < cp.passwordMinLength ? t('قصير — لازم {n} حروف على الأقل', { n: cp.passwordMinLength }) : null;
  const pinErr = pin && !new RegExp(`^\\d{${cp.pinLength}}$`).test(pin) ? t('لازم {n} أرقام بالظبط', { n: cp.pinLength }) : null;
  const save = async () => {
    const r = await run('User.Create', { body: { username: username.trim(), displayName: displayName.trim(), password, pin: pin || undefined, roleAssignments: ras } }, { success: t('اتعمل حساب {n}', { n: displayName }) });
    if (r) onClose();
  };
  return (
    <Drawer open width="lg" onClose={onClose} icon={<UserPlus />} title={t('مستخدم جديد')} badge={<StateBadge ops={['User.Create']} />} description={t('الموظف هيدخل بالرقم السري على أي جهاز في الفروع اللي تختارها.')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!username.trim() || !displayName.trim() || !password || !!pwErr || !!pinErr || !validRA(ras)} onClick={save} data-fb="users:create-save">{t('إنشاء الحساب')}</Button></>}>
      <div className="space-y-6">
        <FormGroup title={t('بيانات الموظف')}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('الاسم اللي بيظهر')} required hint={t('مثلًا: منى — الكاشير ب')}><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-fb="users:create-display" /></Field>
            <Field label={t('اسم الدخول')} required hint={t('حروف إنجليزي صغيرة، ومينفعش يتكرر')}><Input value={username} onChange={(e) => setUsername(e.target.value.trim().toLowerCase())} dir="ltr" data-fb="users:create-username" /></Field>
          </div>
        </FormGroup>
        <FormGroup title={t('الدخول')} hint={t('الرقم السري (PIN) للدخول السريع على الأجهزة، والباسورد للإدارة.')}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('الباسورد')} required hint={t('على الأقل {n} حروف', { n: cp.passwordMinLength })} error={pwErr}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" data-fb="users:create-password" />
            </Field>
            <Field label={t('الرقم السري PIN (اختياري)')} hint={t('{n} أرقام بالظبط', { n: cp.pinLength })} error={pinErr}>
              <Input inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} dir="ltr" data-fb="users:create-pin" />
            </Field>
          </div>
          <div className="text-[11px] text-dim">{t('في التشغيل الحقيقي الرقم السري بيوصل للموظف نفسه وما بيتكتبش في أي ورق. من غير PIN الموظف هيغيّر بياناته أول ما يدخل.')}</div>
        </FormGroup>
        <FormGroup title={t('الدور والفروع')} hint={t('ممكن تدي الموظف أكتر من دور، كل دور على فروع مختلفة.')}>
          <AssignmentsEditor value={ras} onChange={setRas} roles={roles} branches={branches} />
        </FormGroup>
      </div>
    </Drawer>
  );
}

function AccessDrawer({ user, roles, branches, onClose }: { user: any; roles: any[]; branches: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [active, setActive] = useState<boolean>(user.active);
  const [ras, setRas] = useState<RA[]>(user.roleAssignments.map((r: any) => ({ roleId: r.roleId, branchIds: [...r.branchIds] })));
  const save = async () => {
    const r = await run('User.ManageAccess', { params: { userId: user.id }, body: { active, roleAssignments: ras, expectedVersion: user.version } }, { success: t('اتحدثت صلاحيات {n}', { n: personName(user.username, user.displayName) }) });
    if (r) onClose();
  };
  return (
    <Drawer open width="lg" onClose={onClose} icon={<ShieldCheck />} title={t('صلاحيات {n}', { n: user.displayName })} badge={<StateBadge ops={['User.ManageAccess']} />}
      description={t('غيّر الدور أو الفروع، أو أوقف الحساب. التغيير بيتطبق من أول حركة جاية.')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!validRA(ras)} onClick={save} data-fb="users:access-save">{t('حفظ')}</Button></>}>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-2 flex-wrap rounded-xl surface-1 border line p-3">
          <Switch checked={active} onChange={setActive} label={active ? t('الحساب شغال') : t('الحساب موقوف')} />
          <RulePill action="USER_ACCESS_CHANGE" />
        </div>
        {!active && user.active && <Banner tone="warning">{t('الإيقاف بيخرّج الموظف من كل الأجهزة: أول حركة بعدها بترجّعه لشاشة الدخول.')}</Banner>}
        <FormGroup title={t('الدور والفروع')}><AssignmentsEditor value={ras} onChange={setRas} roles={roles} branches={branches} /></FormGroup>
        <div className="text-[11px] text-dim">{t('لازم يفضل فيه شخص واحد على الأقل يقدر يدير الصلاحيات — السيستم مش هيسمح تشيله.')}<Tech> LAST_OWNER_PROTECTED · v{user.version}</Tech></div>
      </div>
    </Drawer>
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
      await run('Credential.Reset', { params: { userId: user.id }, body: { kind, newSecret: secret } }, { success: t('اتعمل رقم سري جديد لـ {n} — هيغيّره أول ما يدخل', { n: personName(user.username, user.displayName) }), quiet: true });
      onClose();
    } catch (e: any) {
      toast('error', errorText(e), `${e.code} · ${e.status}`);
    }
  };
  return (
    <Modal open onClose={onClose} title={t('رقم سري جديد لـ {n}', { n: user.displayName })} badge={<StateBadge ops={['Credential.Reset']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!secret || !ok} onClick={save} data-fb="users:reset-save">{t('إعادة تعيين')}</Button></>}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Tabs value={kind} onChange={(k) => { setKind(k); setSecret(''); }} tabs={[{ id: 'PIN', label: t('رقم سري (PIN)') }, { id: 'PASSWORD', label: t('باسورد') }]} />
          <RulePill action="CREDENTIAL_RESET" />
        </div>
        <Field label={kind === 'PIN' ? t('الرقم السري الجديد ({n} أرقام)', { n: cp.pinLength }) : t('الباسورد الجديد (على الأقل {n} حروف)', { n: cp.passwordMinLength })} error={secret && !ok ? (kind === 'PIN' ? t('لازم {n} أرقام بالظبط', { n: cp.pinLength }) : t('قصير — لازم {n} حروف على الأقل', { n: cp.passwordMinLength })) : null}>
          <Input type="password" inputMode={kind === 'PIN' ? 'numeric' : undefined} value={secret} onChange={(e) => setSecret(kind === 'PIN' ? e.target.value.replace(/\D/g, '') : e.target.value)} dir="ltr" data-fb="users:reset-secret" />
        </Field>
        <div className="text-xs text-dim">{t('الرقم الجديد بيفك القفل لو الحساب مقفول من محاولات غلط، والموظف هيغيّره أول ما يدخل.')}</div>
      </div>
    </Modal>
  );
}

// ───────── roles
const groupPerms = (ids: string[]) => {
  const m = new Map<string, string[]>();
  ids.forEach((p) => { const k = p.includes(':') ? p.split(':')[0] : '*'; m.set(k, [...(m.get(k) ?? []), p]); });
  return [...m.entries()].sort((a, b) => moduleText(a[0]).localeCompare(moduleText(b[0]), 'ar'));
};

function RolesTab({ roles, creating, setCreating }: { roles: ReturnType<typeof useList<any>>; creating: boolean; setCreating: (v: boolean) => void }) {
  const perms = useList<any>('Permission.List');
  const users = useList<any>('User.Find');
  const permUpdate = usePerm('role:update');
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <div className="space-y-3">
      <Refused error={roles.error} />
      <Tech><Banner tone="info">{t('الصلاحيات اللي عليها "أضيفت للنموذج" مش في أدوار ملف التجهيز 1.2 — النموذج زوّدها عشان الخبير يقدر يجرب كل الشاشات (PROTOTYPE_GAPS).')}</Banner></Tech>
      <div className="grid xl:grid-cols-2 gap-3">
        {roles.items.map((r) => {
          const added: string[] = r.demoAdded ?? [];
          const holders = users.items.filter((u) => u.roleAssignments.some((a: any) => a.roleId === r.id));
          const all = r.permissionIds.includes('*');
          return (
            <Card key={r.id} title={<span>{roleName(r)}<Tech><span className="num text-xs text-dim font-normal ms-2">{r.id} · v{r.version}</span></Tech></span>}
              description={all ? t('كل الصلاحيات') : t('{n} صلاحية · {u} موظف عليه الدور ده', { n: r.permissionIds.length, u: holders.length })}
              badge={r.active ? <Pill tone="success" dot>{t('شغال')}</Pill> : <Pill tone="neutral" dot>{t('موقوف')}</Pill>}
              actions={<Button size="sm" variant="outline" data-fb={`roles:edit:${r.id}`} disabled={!permUpdate.ok} title={permUpdate.title} onClick={() => setEdit(r)}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>}>
              <div className="space-y-2 max-h-56 overflow-y-auto pe-1">
                {groupPerms(r.permissionIds).map(([mod, ids]) => (
                  <div key={mod} className="flex items-start gap-2 text-xs">
                    <span className="font-bold text-soft w-28 shrink-0 pt-0.5">{moduleText(mod)}</span>
                    <div className="flex flex-wrap gap-1 min-w-0">
                      {ids.map((p) => <span key={p} title={p} className={cn('px-1.5 py-0.5 rounded-md border', added.includes(p) ? 'border-[rgba(168,85,247,.45)] bg-[rgba(168,85,247,.10)]' : 'surface-2 border-[var(--glass-border)] text-soft')}>{p === '*' ? t('كل حاجة') : permText(p).split(' · ').at(-1)}<Tech><span className="num text-[10px] text-dim ms-1">{p}</span></Tech></span>)}
                    </div>
                  </div>
                ))}
              </div>
              {holders.length > 0 && <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t line">{holders.slice(0, 6).map((u) => <Pill key={u.id}>{personName(u.username, u.displayName)}</Pill>)}{holders.length > 6 && <Pill>+{holders.length - 6}</Pill>}</div>}
              {added.length > 0 && <Tech><div className="mt-2"><Pill tone="violet">{t('أضيفت للنموذج')}: {added.length}</Pill></div></Tech>}
            </Card>
          );
        })}
      </div>
      {(creating || edit) && <RoleDrawer role={edit} catalog={perms.items.map((p) => p.id)} onClose={() => { setCreating(false); setEdit(null); }} />}
    </div>
  );
}

function RoleDrawer({ role, catalog, onClose }: { role: any | null; catalog: string[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [name, setName] = useState(role?.name ?? '');
  const [active, setActive] = useState<boolean>(role?.active ?? true);
  const [sel, setSel] = useState<string[]>(role?.permissionIds ?? []);
  const [free, setFree] = useState('');
  const [filter, setFilter] = useState('');
  const added: string[] = role?.demoAdded ?? [];
  const all = useMemo(() => [...new Set([...catalog, ...sel])].sort(), [catalog, sel]);
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return groupPerms(all.filter((p) => !f || p.includes(f) || permText(p).includes(filter.trim()) || moduleText(p.split(':')[0]).includes(filter.trim())));
  }, [all, filter]);
  const toggle = (p: string) => setSel((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  const toggleGroup = (ids: string[]) => setSel((s) => (ids.every((p) => s.includes(p)) ? s.filter((x) => !ids.includes(x)) : [...new Set([...s, ...ids])]));
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
    <Drawer open width="xl" onClose={onClose} icon={<ShieldCheck />} title={role ? t('تعديل دور {n}', { n: roleName(role) }) : t('دور جديد')} badge={<StateBadge ops={[role ? 'Role.Update' : 'Role.Create', 'Permission.List']} />}
      description={t('اختار الحركات المسموحة لأي حد عليه الدور ده. التغيير بيتطبق من أول حركة جاية.')}
      footer={<><span className="text-xs text-dim me-auto">{t('{n} صلاحية مختارة', { n: sel.length })}</span><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save} data-fb="roles:save">{t('حفظ الدور')}</Button></>}>
      <div className="space-y-4">
        <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
          <Field label={t('اسم الدور')} required hint={t('مينفعش يتكرر — مثلًا: كاشير، مشرف صالة')}><Input value={name} onChange={(e) => setName(e.target.value)} data-fb="roles:name" /></Field>
          {role && <Field label={t('الحالة')}><Switch checked={active} onChange={setActive} label={active ? t('شغال') : t('موقوف')} /></Field>}
        </div>
        <SearchInput value={filter} onChange={setFilter} placeholder={t('دوّر في الصلاحيات (مثلًا: المطبخ، خصم)')} className="max-w-none" />
        <div className="space-y-2">
          {groups.map(([mod, ids]) => {
            const allOn = ids.every((p) => sel.includes(p));
            return (
              <div key={mod} className="rounded-xl surface-1 border line p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-bold">{moduleText(mod)} <span className="text-xs text-dim font-normal num">{ids.filter((p) => sel.includes(p)).length}/{ids.length}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => toggleGroup(ids)}>{allOn ? t('شيل الكل') : t('اختار الكل')}</Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ids.map((p) => {
                    const on = sel.includes(p);
                    const demo = added.includes(p);
                    return <button key={p} type="button" onClick={() => toggle(p)} data-fb={`roles:perm:${p}`} title={p}
                      className={cn('px-2.5 h-7 rounded-full text-xs border transition-colors', on ? (demo ? 'bg-[rgba(168,85,247,.25)] border-[rgba(168,85,247,.6)] font-bold' : 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold') : 'surface-2 border-[var(--glass-border)] text-soft hover:text-[var(--foreground)]')}>{on ? '✓ ' : ''}{p === '*' ? t('كل حاجة') : permText(p).split(' · ').at(-1)}<Tech><span className="num text-[10px] opacity-70 ms-1">{p}{demo ? ` · ${t('أضيفت للنموذج')}` : ''}</span></Tech></button>;
                  })}
                </div>
              </div>
            );
          })}
          {groups.length === 0 && <EmptyState compact title={t('مفيش صلاحية بالاسم ده')} />}
        </div>
        <Tech>
          <div className="flex items-end gap-2">
            <Field label={t('صلاحية بالنص (لو مش في القايمة)')} hint={t('صلاحية مش متسجلة بترجع UNKNOWN_PERMISSION_ID')} className="flex-1"><Input value={free} onChange={(e) => setFree(e.target.value)} dir="ltr" placeholder="approve:price_change" onKeyDown={(e) => e.key === 'Enter' && addFree()} data-fb="roles:free" /></Field>
            <Button variant="secondary" onClick={addFree} disabled={!free.trim()} data-fb="roles:free-add">{t('ضيف')}</Button>
          </div>
        </Tech>
        <div className="text-[11px] text-dim">{t('تعديل الأدوار ممكن يحتاج موافقة مدير حسب الإعدادات.')}</div>
      </div>
    </Drawer>
  );
}
