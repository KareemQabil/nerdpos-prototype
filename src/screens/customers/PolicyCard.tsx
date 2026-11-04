// A settings card for one policy (loyalty program, customer privacy): shows the values in plain words and edits them
// through Settings.UpdatePolicy (a sensitive change — a manager approves it). ux-13: the shared settings view / editor
// (every field kind: options, amounts, numbers with units) instead of numbers-only inputs.
import React, { useState } from 'react';
import { Pencil, Settings2 } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Card, Button, Modal, Field, Input, StateBadge, Spinner } from '../../ui';
import { Tech } from '../../app/tech';
import { t } from '../../i18n';
import { policyMeta } from '../../mock/policyRegistry';
import { PolicyEditor, PolicyValueView } from '../../demo/PolicyEditors';

export function usePolicy(policyId: string) {
  return useQuery<any>('Settings.Effective', { query: { policyId, scopeType: 'TENANT', scopeId: 'biz' } });
}

export function PolicyCard({ policyId, title }: { policyId: string; title: React.ReactNode }) {
  const { can } = useDev();
  const q = usePolicy(policyId);
  const [edit, setEdit] = useState(false);
  const meta = policyMeta.get(policyId);
  // a value stored before a field existed shows that field's default
  const value = { ...((meta?.canonicalDefault as object) ?? {}), ...(q.data?.value ?? {}) };
  return (
    <Card title={<span className="flex items-center gap-2"><Settings2 className="w-4 h-4" />{title}</span>} badge={<StateBadge state="PROPOSED" />}
      actions={can('settings:updatepolicy') && <Button size="sm" variant="ghost" onClick={() => setEdit(true)} data-fb={`edit-policy:${policyId}`}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>}>
      {!q.data || !meta ? <Spinner /> : (
        <div className="space-y-2" data-fb={`policy-card:${policyId}`}>
          <PolicyValueView p={meta} value={value} big />
          <Tech><div className="text-[10px] text-dim num">{policyId} · {JSON.stringify(q.data.value)}</div></Tech>
        </div>
      )}
      {edit && q.data && meta && <PolicyDialog policyId={policyId} value={value} rows={q.data.rows} onClose={() => setEdit(false)} />}
    </Card>
  );
}

function PolicyDialog({ policyId, value, rows, onClose }: { policyId: string; value: any; rows: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const meta = policyMeta.get(policyId)!;
  const [v, setV] = useState<any>({ ...value });
  const [note, setNote] = useState('');
  const tenantRow = rows?.find((r: any) => r.scopeType === 'TENANT');
  const save = async () => {
    const r = await run('Settings.UpdatePolicy', { params: { policyId }, body: { scopeType: 'TENANT', scopeId: 'biz', value: v, expectedVersion: tenantRow?.version, changeNote: note || undefined } }, { success: t('الإعداد اتحفظ — بيطبق على الحركات الجديدة') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} wide title={t('تعديل الإعداد')} badge={<StateBadge ops={['Settings.UpdatePolicy', 'Approval.Grant']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} onClick={save} data-fb="policy-save">{t('حفظ')}</Button></>}>
      <div className="space-y-3">
        <PolicyEditor p={meta} value={v} onChange={(x) => setV(x)} />
        <Field label={t('سبب التغيير')}><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} data-fb="policy-note" /></Field>
      </div>
    </Modal>
  );
}
