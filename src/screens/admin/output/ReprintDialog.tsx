// Reprint dialog shared by G1 (receipt) and G2 (print queue): Print.Reprint makes a REPRINT job ("نسخة").
import React, { useState } from 'react';
import { Printer, Copy } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../../app/hooks';
import { StateBadge, Banner, Button, Select, Modal, Field } from '../../../ui';
import { t, L } from '../../../i18n';
import { docTypeLabel } from './labels';

export function ReprintDialog({ job, onClose, terminalId, onDone }: { job: { documentType: string; documentId: string; label?: string }; onClose: () => void; terminalId: string | null; onDone?: (job: any) => void }) {
  const { run, busy } = useCommand();
  const reasons = useQuery<any>('ReasonCode.List', { query: { kind: 'REPRINT', active: true } });
  const [reasonCode, setReasonCode] = useState('');
  const go = async () => {
    const r = await run('Print.Reprint', { body: { documentType: job.documentType, documentId: job.documentId, terminalId, ...(reasonCode ? { reasonCode } : {}) } }, { success: t('النسخة اتبعتت للطابور — مكتوب عليها "نسخة"') });
    if (r) { onDone?.(r); onClose(); }
  };
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><Printer className="w-5 h-5" />{t('اطبع نسخة')}</span>} badge={<StateBadge ops={['Print.Reprint']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!terminalId} onClick={go} data-fb="reprint:confirm"><Copy className="w-4 h-4" />{t('اطبع نسخة')}</Button></>}>
      <div className="space-y-3">
        <div className="font-bold">{job.label ?? job.documentId} <span className="text-xs text-dim">· {docTypeLabel(job.documentType)}</span></div>
        <Banner tone="info">{t('النسخة بتتطبع من نفس البيانات المحفوظة ومكتوب عليها "نسخة". مش بتعمل إيصال جديد ولا إيصال إلكتروني جديد.')}</Banner>
        <ReprintRuleNote />
        <Field label={<span className="flex items-center gap-2">{t('السبب')} <StateBadge state="PROPOSED" /></span>} hint={t('العقد الحالي لـ Print.Reprint مفيهوش سبب — مقترح (docs/30 §6)')}>
          <Select data-fb="reprint:reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} options={[{ value: '', label: t('من غير سبب') }, ...((reasons.data?.items ?? reasons.data ?? []) as any[]).map((r: any) => ({ value: r.code, label: L(r.label) }))]} />
        </Field>
        {!terminalId && <Banner tone="error">{t('الطباعة محتاجة جهاز — افتح الشاشة دي من جهاز فيه طابعة')}</Banner>}
      </div>
    </Modal>
  );
}

/** The current RECEIPT_REPRINT approval rule, read from ApprovalRequirementPolicy (never a local copy). */
export function ReprintRuleNote() {
  const { can, me, auth } = useDev();
  const branchId = me?.branchId ?? auth.branchId;
  const q = useQuery<any>(can('settings:read') && branchId ? 'Settings.Effective' : null, { query: { policyId: 'ApprovalRequirementPolicy', scopeType: 'BRANCH', scopeId: branchId } });
  const rule = q.data?.value?.RECEIPT_REPRINT;
  const proposal = t('اقتراح docs/30 §6: أول نسخة مجانية، وأي نسخة بعدها محتاجة موافقة مدير (عدد النسخ السابقة > 0).');
  let text: string;
  if (!rule) text = t('موافقة المدير على النسخة حسب السياسة (RECEIPT_REPRINT في ApprovalRequirementPolicy).');
  else if (rule.mode === 'NEVER') text = t('السياسة الحالية: النسخة من غير موافقة مدير (RECEIPT_REPRINT = أبدًا).');
  else if (rule.mode === 'ALWAYS') text = t('السياسة الحالية: كل نسخة محتاجة موافقة مدير.');
  else if (rule.mode === 'ABOVE_THRESHOLD') text = t('السياسة الحالية: موافقة مدير لما عدد النسخ السابقة أكتر من {n}.', { n: rule.threshold });
  else text = `RECEIPT_REPRINT: ${rule.mode}`;
  return <Banner tone="warning"><div data-fb="reprint:rule">{text}</div><div className="text-[11px] text-dim mt-0.5">{proposal} {t('بتتغير من لوحة السياسات.')}</div></Banner>;
}
