// Debug panel: every request with its X-Command-Id, status, error code and Idempotent-Replayed (needed for N2, N12).
import React, { useState, useSyncExternalStore } from 'react';
import { X, Trash2 } from 'lucide-react';
import { apiLog, type LogEntry } from '../mock/kernel';
import { opsById } from '../mock/contracts';
import { Pill, Switch } from '../ui';
import { t } from '../i18n';
import { cn } from '../lib/format';

export function ApiLogPanel({ onClose }: { onClose: () => void }) {
  const entries = useSyncExternalStore(apiLog.subscribe, () => apiLog.entries()[0]?.id ?? 0);
  const [showQ, setShowQ] = useState(false);
  const [sel, setSel] = useState<LogEntry | null>(null);
  const list = apiLog.entries().filter((e) => showQ || (e.opId ? opsById.get(e.opId)?.kind !== 'QRY' : e.method !== 'GET'));
  return (
    <div className="h-[38vh] shrink-0 glass-strong border-t line flex flex-col z-30" data-demo-chrome>
      <div className="flex items-center gap-3 px-3 py-2 border-b line text-sm">
        <b>{t('سجل الطلبات (API)')}</b><span className="text-dim text-xs">{t('كل الطلبات بتعدي على العقد: المسار والصلاحية وأكواد الأخطاء من operations.json و errors.json')}</span>
        <div className="flex-1" />
        <Switch checked={showQ} onChange={setShowQ} label={t('إظهار القراءات (QRY)')} />
        <button onClick={() => apiLog.clear()} className="text-dim"><Trash2 className="w-4 h-4" /></button>
        <button onClick={onClose}><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs num" dir="ltr">
            <thead className="surface-1 sticky top-0"><tr className="text-start">{['#', 'device', 'operation', 'method path', 'status', 'code', 'X-Command-Id', 'replayed', 'state', 'ms'].map((h) => <th key={h} className="px-2 py-1 text-left font-bold text-soft">{h}</th>)}</tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} onClick={() => setSel(e)} className={cn('border-t line cursor-pointer hover:surface-1', sel?.id === e.id && 'bg-[var(--primary-container)]')}>
                  <td className="px-2 py-1 text-dim">{e.id}</td>
                  <td className="px-2 py-1">{e.deviceLabel}</td>
                  <td className="px-2 py-1 font-bold">{e.opId ?? '—'}</td>
                  <td className="px-2 py-1 text-dim">{e.method} {e.path}</td>
                  <td className="px-2 py-1"><Pill tone={e.dropped ? 'warning' : e.status >= 400 || e.status === 0 ? 'error' : 'success'}>{e.dropped ? `${e.status}→lost` : e.status || 'net'}</Pill></td>
                  <td className="px-2 py-1 text-[var(--error)]">{e.errorCode ?? ''}</td>
                  <td className="px-2 py-1 text-dim">{e.commandId?.slice(0, 13) ?? ''}</td>
                  <td className="px-2 py-1">{e.replayed ? <Pill tone="info">true</Pill> : ''}</td>
                  <td className="px-2 py-1 text-dim">{e.backendState}</td>
                  <td className="px-2 py-1 text-dim">{e.ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sel && (
          <div className="w-[40%] border-s line overflow-auto p-2 text-[11px] num" dir="ltr">
            <div className="font-bold mb-1">{sel.method} {sel.path}</div>
            <div className="text-dim">X-Command-Id: {sel.commandId}</div>
            <div className="mt-2 font-bold">request</div>
            <pre className="whitespace-pre-wrap break-all">{JSON.stringify(sel.request, null, 1)}</pre>
            <div className="mt-2 font-bold">response</div>
            <pre className="whitespace-pre-wrap break-all">{JSON.stringify(sel.response, null, 1)?.slice(0, 6000)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
