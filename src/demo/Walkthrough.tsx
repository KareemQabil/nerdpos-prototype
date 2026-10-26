// Walkthrough player (deliverable 3): replays journeys/OPERATOR_WALKTHROUGH_J-R1_R4.md and SETUP_JOURNEY_J-A1.md
// step by step. Each step can be shown on its device, or executed automatically through the same mock API.
import React, { useEffect, useState } from 'react';
import { Play, ChevronLeft, ChevronRight, MonitorSmartphone, RotateCcw, FastForward, CheckCircle2, XCircle, Circle, ListChecks } from 'lucide-react';
import { JOURNEYS, type Journey, type StepDef } from './scripts';
import { as, terminalByCode, type LogLine } from './runner';
import { devices, deviceLabel } from '../app/devices';
import { demo } from '../mock/demo';
import { store } from '../mock/store';
import { apiLog } from '../mock/kernel';
import { Button, Pill, StateBadge, Banner, toast, confirmDialog } from '../ui';
import { t, useLang } from '../i18n';
import { cn } from '../lib/format';
import { refreshAll, errorText } from '../app/hooks';

const KEY = 'nerdpos.walk.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };

export function resolveDevice(d: string) {
  if (store.db.terminals.some((x) => x.id === d)) return d;
  const byCode = terminalByCode(d);
  return store.db.terminals.some((x) => x.id === byCode) ? byCode : 'BO';
}

export function Walkthrough() {
  const lang = useLang();
  const saved = load();
  const [jid, setJid] = useState<string | null>(saved.jid ?? null);
  const [idx, setIdx] = useState<number>(saved.idx ?? 0);
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Record<string, boolean | null>>(saved.done ?? {});
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ jid, idx, done })); } catch { /* ignore */ } }, [jid, idx, done]);
  const j = JOURNEYS.find((x) => x.id === jid);

  if (!j) return (
    <div className="flex flex-col h-full" data-screen="WALKTHROUGH">
      <div className="px-4 py-3 border-b line"><div className="font-bold flex items-center gap-2"><ListChecks className="w-5 h-5" />{t('الرحلات (Walkthrough)')}</div><div className="text-[11px] text-dim">{t('كل خطوة: مين بيعمل إيه وعلى أنهي جهاز، والمتوقع، والعمليات من العقد. ينفع تعملها بإيدك أو "نفّذ تلقائي".')}</div></div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {JOURNEYS.map((x) => (
          <button key={x.id} onClick={() => { setJid(x.id); setIdx(0); }} className="w-full text-start rounded-xl surface-1 border line p-3 hover:border-[var(--primary)]">
            <div className="flex items-center justify-between gap-2"><div className="font-bold">{lang === 'ar' ? x.title : x.titleEn}</div><Pill tone="neutral">{x.steps.length} {t('خطوة')}</Pill></div>
            <div className="text-xs text-dim mt-1">{x.intro}</div>
            {x.reset === 'ZERO' && <div className="text-[11px] text-[var(--warning)] mt-1">{t('بيبدأ بتركيب جديد فاضي (بيمسح بيانات العرض)')}</div>}
          </button>
        ))}
      </div>
    </div>
  );

  const step = j.steps[idx];
  const key = `${j.id}:${step.id}`;
  const text = step.text;
  const devId = resolveDevice(step.device);
  const goDevice = async () => {
    try {
      const real = resolveDevice(step.device);
      if (store.db.terminals.some((x) => x.id === real) || real === 'BO') {
        devices.setPrimary(real);
        if (store.db.users.some((u) => u.username === step.user)) await as(real, step.user);
        const sc = typeof step.screen === 'function' ? step.screen() : step.screen ? [step.screen, {}] as [string, any] : null;
        if (sc && sc[0]) devices.navigate(real, sc[0], sc[1]);
      }
    } catch (e) { toast('error', errorText(e)); }
  };
  const runStep = async (s: StepDef, k: string) => {
    const lines: LogLine[] = [];
    const log = (l: LogLine) => { lines.push(l); setLogs((m) => ({ ...m, [k]: [...lines] })); };
    try {
      s.before?.();
      await s.run(log);
      setDone((d) => ({ ...d, [k]: !lines.some((l) => l.ok === false) }));
    } catch (e) {
      log({ ok: false, text: `${(e as any).code ?? ''} ${errorText(e)}` });
      setDone((d) => ({ ...d, [k]: false }));
    }
    refreshAll();
  };
  const runOne = async () => { setRunning(true); await runStep(step, key); await goDevice(); setRunning(false); };
  const runAll = async () => {
    setRunning(true);
    for (let i = idx; i < j.steps.length; i++) {
      setIdx(i);
      const s = j.steps[i];
      await runStep(s, `${j.id}:${s.id}`);
      await new Promise((r) => setTimeout(r, 350));
    }
    setRunning(false);
    await goDevice();
  };
  const restart = async () => {
    if (j.reset && !await confirmDialog(j.reset === 'ZERO' ? t('هيبدأ تركيب جديد فاضي — كل البيانات هتتمسح. نكمل؟') : t('هترجع بيانات العرض الأصلية. نكمل؟'))) return;
    if (j.reset) { demo.reset(j.reset); devices.resetAll(); apiLog.clear(); }
    setIdx(0); setLogs({}); setDone((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(j.id + ':'))));
    toast('success', j.reset === 'ZERO' ? t('تركيب جديد: الباك أوفيس بس، ومستخدم implementation-engineer') : t('جاهز — ابدأ من الخطوة 1'));
    setTimeout(() => goDeviceFor(j.steps[0]), 100);
  };
  const goDeviceFor = async (s: StepDef) => { const real = resolveDevice(s.device); devices.setPrimary(real); };
  const lbl = deviceLabel(devId, lang);
  return (
    <div className="flex flex-col h-full" data-screen="WALKTHROUGH">
      <div className="px-4 py-3 border-b line space-y-2">
        <div className="flex items-center gap-2">
          <button className="text-xs text-dim hover:text-[var(--primary)]" onClick={() => setJid(null)}>{t('كل الرحلات')}</button>
          <span className="text-dim">/</span><b className="text-sm truncate">{lang === 'ar' ? j.title : j.titleEn}</b>
        </div>
        <div className="flex gap-1 flex-wrap">
          {j.steps.map((s, i) => { const st = done[`${j.id}:${s.id}`]; return <button key={s.id} onClick={() => setIdx(i)} title={s.id} className={cn('w-7 h-7 rounded-md text-[11px] num border', i === idx ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)] font-bold' : st === true ? 'border-emerald-400/50 text-emerald-300' : st === false ? 'border-red-400/50 text-red-300' : 'border-[var(--glass-border)] text-dim')}>{i + 1}</button>; })}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="ghost" onClick={restart}><RotateCcw className="w-4 h-4" />{t('ابدأ من الأول')}</Button>
          <Button size="sm" onClick={runAll} disabled={running}><FastForward className="w-4 h-4" />{t('شغّل الباقي تلقائي')}</Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between gap-2"><div className="text-lg font-bold">{step.id.replace(/-(\d+)$/, ' · خطوة $1')}</div><Pill tone="primary"><MonitorSmartphone className="w-3 h-3" />{lbl.short} · {step.user}</Pill></div>
        {text ? (
          <>
            <div className="text-[11px] text-dim num">{text.who}</div>
            <Block title={t('نفّذ')} body={lang === 'ar' ? text.do_ar || text.do_en : text.do_en} />
            <Block title={t('المتوقع')} body={lang === 'ar' ? text.expect_ar || text.expect_en : text.expect_en} tone="info" />
            {text.note && <div className="text-xs text-dim">{text.note}</div>}
            {text.operations?.length > 0 && (
              <div className="rounded-xl border line overflow-hidden">
                {text.operations.map((o, i) => <div key={i} className="px-3 py-1.5 text-[11px] border-t line first:border-t-0 flex items-start gap-2"><StateBadge ops={[o.op]} /><div className="min-w-0"><div className="num font-bold">{o.op} <span className="text-dim font-normal">{o.http}</span></div><div className="text-dim break-words">{o.expected}</div></div></div>)}
              </div>
            )}
          </>
        ) : <Banner tone="warning">{t('مفيش نص للخطوة دي')}</Banner>}
        <div className="flex gap-2 flex-wrap">
          <Button onClick={goDevice}><MonitorSmartphone className="w-4 h-4" />{t('روح للجهاز')}</Button>
          <Button variant="primary" loading={running} onClick={runOne} data-fb="walk-run-step"><Play className="w-4 h-4" />{t('نفّذ تلقائي')}</Button>
        </div>
        {logs[key] && (
          <div className="rounded-xl surface-1 border line p-2 space-y-1 text-[11px] num" dir="ltr">
            {logs[key].map((l, i) => <div key={i} className="flex gap-1.5 items-start">{l.ok === true ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : l.ok === false ? <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" /> : <Circle className="w-3.5 h-3.5 text-dim shrink-0" />}<span className="break-words" style={{ textAlign: 'left' }}>{l.text}</span></div>)}
          </div>
        )}
      </div>
      <div className="px-4 py-3 border-t line flex justify-between">
        <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}><ChevronRight className="w-4 h-4 ltr:rotate-180" />{t('السابق')}</Button>
        <Button size="sm" variant="secondary" disabled={idx >= j.steps.length - 1} onClick={() => setIdx(idx + 1)}>{t('التالي')}<ChevronLeft className="w-4 h-4 ltr:rotate-180" /></Button>
      </div>
    </div>
  );
}

function Block({ title, body, tone }: { title: string; body: string; tone?: 'info' }) {
  return <div className={cn('rounded-xl p-3 text-sm', tone === 'info' ? 'bg-[color-mix(in_srgb,var(--info)_10%,transparent)] border border-[color-mix(in_srgb,var(--info)_30%,transparent)]' : 'surface-1 border line')}><div className="text-xs font-bold text-dim mb-1">{title}</div><div className="leading-relaxed">{body}</div></div>;
}
