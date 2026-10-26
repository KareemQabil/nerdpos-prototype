// A settings card for one policy (loyalty program, delivery rules): shows the values in plain words and edits them
// through Settings.UpdatePolicy (a sensitive change — a manager approves it).
import React, { useState } from 'react';
import { Pencil, Settings2 } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Card, Button, Modal, Field, Input, Switch, StateBadge, Banner, Spinner } from '../../ui';
import { Tech } from '../../app/tech';
import { t } from '../../i18n';
import { money } from '../../lib/format';

export function usePolicy(policyId: string) {
  return useQuery<any>('Settings.Effective', { query: { policyId, scopeType: 'TENANT', scopeId: 'biz' } });
}

export function PolicyCard({ policyId, title, explain }: { policyId: string; title: React.ReactNode; explain?: (v: any) => React.ReactNode }) {
  const { can } = useDev();
  const q = usePolicy(policyId);
  const [edit, setEdit] = useState(false);
  const meta = q.data?.meta;
  const value = q.data?.value ?? {};
  const fields: any[] = meta?.editor?.kind === 'object' ? meta.editor.fields : [];
  const show = (f: any) => {
    const v = value?.[f.key];
    if (f.kind === 'bool') return v ? t('أيوه') : t('لأ');
    if (f.kind === 'money') return money(v);
    return v ?? '—';
  };
  return (
    <Card title={<span className="flex items-center gap-2"><Settings2 className="w-4 h-4" />{title}</span>} badge={<StateBadge state="PROPOSED" />}
      actions={can('settings:updatepolicy') && <Button size="sm" variant="ghost" onClick={() => setEdit(true)} data-fb={`edit-policy:${policyId}`}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>}>
      {!q.data ? <Spinner /> : (
        <div className="space-y-3">
          {meta?.description && <div className="text-xs text-dim">{t(meta.description)}</div>}
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {fields.map((f) => <div key={f.key} className="flex justify-between gap-3 border-b line py-1"><span className="text-dim">{t(f.label)}</span><b className="num">{show(f)}</b></div>)}
          </div>
          {explain && <div className="text-xs rounded-lg surface-1 px-3 py-2">{explain(value)}</div>}
          <Tech><div className="text-[10px] text-dim num">{policyId} · {JSON.stringify(value)}</div></Tech>
        </div>
      )}
      {edit && q.data && <PolicyDialog policyId={policyId} fields={fields} value={value} rows={q.data.rows} onClose={() => setEdit(false)} />}
    </Card>
  );
}

function PolicyDialog({ policyId, fields, value, rows, onClose }: { policyId: string; fields: any[]; value: any; rows: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [v, setV] = useState<any>({ ...value });
  const [note, setNote] = useState('');
  const tenantRow = rows?.find((r: any) => r.scopeType === 'TENANT');
  const save = async () => {
    const clean: any = { ...v };
    for (const f of fields) if (f.kind === 'number') clean[f.key] = Number(clean[f.key]);
    const r = await run('Settings.UpdatePolicy', { params: { policyId }, body: { scopeType: 'TENANT', scopeId: 'biz', value: clean, expectedVersion: tenantRow?.version, changeNote: note || undefined } }, { success: t('الإعداد اتحفظ — بيطبق على الحركات الجديدة') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={t('تعديل الإعداد')} badge={<StateBadge ops={['Settings.UpdatePolicy', 'Approval.Grant']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} onClick={save} data-fb="policy-save">{t('حفظ')}</Button></>}>
      <div className="space-y-3">
        <Banner tone="info">{t('تغيير الإعداد ده محتاج موافقة مدير، وبيطبق على الحركات الجديدة بس.')}</Banner>
        {fields.map((f) => (
          f.kind === 'bool'
            ? <div key={f.key}><Switch checked={!!v[f.key]} onChange={(x) => setV({ ...v, [f.key]: x })} label={t(f.label)} /></div>
            : <Field key={f.key} label={t(f.label)}><Input value={v[f.key] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" className="num" /></Field>
        ))}
        <Field label={t('سبب التغيير')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
