// Walkthrough player (deliverable 3): replays the guided journeys step by step in plain words —
// who does what, on which device, and what you should see. Each step can be shown on its device, or executed
// automatically through the same mock API. The original journey texts, operations and raw log stay inside <Tech>.
import React, { useEffect, useState } from 'react';
import { Play, ChevronLeft, ChevronRight, MonitorSmartphone, RotateCcw, FastForward, CheckCircle2, XCircle, Circle, ListChecks, Sparkles, ScrollText, Footprints, Info } from 'lucide-react';
import { JOURNEYS, type StepDef } from './scripts';
import { as, terminalByCode, type LogLine } from './runner';
import { devices } from '../app/devices';
import { demo } from '../mock/demo';
import { store } from '../mock/store';
import { apiLog } from '../mock/kernel';
import { Button, Pill, StateBadge, Banner, toast, confirmDialog } from '../ui';
import { Tech, useTech } from '../app/tech';
import { t, useLang } from '../i18n';
import { cn } from '../lib/format';
import { refreshAll, errorText } from '../app/hooks';
import { JOURNEY_PLAIN, STEP_PLAIN, pick } from './journeyText';
import { personLabel, deviceName } from './people';

const KEY = 'nerdpos.walk.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };

export function resolveDevice(d: string) {
  if (store.db.terminals.some((x) => x.id === d)) return d;
  const byCode = terminalByCode(d);
  return store.db.terminals.some((x) => x.id === byCode) ? byCode : 'BO';
}

/** Open a journey from elsewhere (welcome screen): the player reads this when it mounts. */
export function openJourney(jid: string) {
  const s = load();
  try { localStorage.setItem(KEY, JSON.stringify({ ...s, jid, idx: 0 })); } catch { /* ignore */ }
}

const journeyTitle = (j: { id: string; title: string; titleEn: string }) => pick(JOURNEY_PLAIN[j.id]?.title) || j.title;
function stepWho(s: StepDef): string {
  const ov = STEP_PLAIN[s.id]?.who;
  if (ov) return pick(ov);
  const dev = resolveDevice(s.device);
  const term = store.db.terminals.find((x) => x.id === dev);
  const u = store.db.users.find((x) => x.username === s.user);
  return t('{p} · على {d}', { p: personLabel(s.user, u?.displayName), d: deviceName(dev, term?.kind, term?.name) });
}

export function Walkthrough() {
  const lang = useLang();
  const tech = useTech();
  const saved = load();
  const [jid, setJid] = useState<string | null>(saved.jid ?? null);
  const [idx, setIdx] = useState<number>(saved.idx ?? 0);
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<'step' | 'log'>('step');
  const [done, setDone] = useState<Record<string, boolean | null>>(saved.done ?? {});
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ jid, idx, done })); } catch { /* ignore */ } }, [jid, idx, done]);
  const j = JOURNEYS.find((x) => x.id === jid);

  if (!j) return (
    <div className="flex flex-col h-full" data-screen="WALKTHROUGH">
      <div className="px-4 py-3 border-b line">
        <div className="font-bold flex items-center gap-2"><ListChecks className="w-5 h-5" />{t('رحلات بالخطوة')}</div>
        <div className="text-[11px] text-dim">{t('كل رحلة قصة من يوم في المطعم: مين بيعمل إيه وعلى أنهي جهاز، والمفروض تشوف إيه. اعمل الخطوة بإيدك على الجهاز، أو خلّي السيستم يعملها قدامك.')}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {JOURNEYS.map((x) => {
          const jp = JOURNEY_PLAIN[x.id];
          const doneN = x.steps.filter((s) => done[`${x.id}:${s.id}`] === true).length;
          return (
            <button key={x.id} data-fb={`walk-journey:${x.id}`} onClick={() => { setJid(x.id); setIdx(0); setView('step'); }} className="w-full text-start rounded-xl surface-1 border line p-3 hover:border-[var(--primary)]">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold">{journeyTitle(x)}<Tech><span className="num text-dim font-normal text-[10px] ms-1">{x.id}</span></Tech></div>
                <Pill tone={doneN === x.steps.length ? 'success' : 'neutral'}>{doneN ? t('{d} من {n} خطوة', { d: doneN, n: x.steps.length }) : t('{n} خطوة', { n: x.steps.length })}</Pill>
              </div>
              <div className="text-xs text-dim mt-1 leading-relaxed">{pick(jp?.intro) || x.intro}</div>
              {jp?.needs && <div className="text-[11px] text-[var(--info)] mt-1">{pick(jp.needs)}</div>}
              {x.reset === 'ZERO' && <div className="text-[11px] text-[var(--warning)] mt-1">{t('بتبدأ بمطعم فاضي خالص (بيانات التجربة بتتمسح، وتقدر ترجعها بعدين)')}</div>}
              {x.reset === 'DEMO' && <div className="text-[11px] text-dim mt-1">{t('بتبدأ ببيانات التجربة من الأول')}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );

  const step = j.steps[idx];
  const key = `${j.id}:${step.id}`;
  const plain = STEP_PLAIN[step.id];
  const text = step.text;
  const jp = JOURNEY_PLAIN[j.id];
  const status = (s: StepDef) => done[`${j.id}:${s.id}`];
  const doneCount = j.steps.filter((s) => status(s) === true).length;
  const failCount = j.steps.filter((s) => status(s) === false).length;
  const finished = j.steps.every((s) => status(s) !== undefined && status(s) !== null);
  const goDeviceOf = async (s: StepDef) => {
    try {
      const real = resolveDevice(s.device);
      if (store.db.terminals.some((x) => x.id === real) || real === 'BO') {
        devices.setPrimary(real);
        if (store.db.users.some((u) => u.username === s.user)) await as(real, s.user);
        let sc: [string, any] | null = null;
        try { sc = typeof s.screen === 'function' ? s.screen() : s.screen ? [s.screen, {}] : null; } catch { sc = null; } // the step's check may not exist yet / any more
        if (sc && sc[0] && (sc[1] === undefined || !('orderId' in (sc[1] ?? {})) || sc[1].orderId)) devices.navigate(real, sc[0], sc[1]);
      }
    } catch (e) { toast('error', errorText(e)); }
  };
  const goDevice = () => goDeviceOf(step);
  const runStep = async (s: StepDef, k: string) => {
    const lines: LogLine[] = [];
    const log = (l: LogLine) => { lines.push(l); setLogs((m) => ({ ...m, [k]: [...lines] })); };
    try {
      s.before?.();
      await s.run(log);
      setDone((d) => ({ ...d, [k]: !lines.some((l) => l.ok === false) }));
    } catch (e) {
      log({ ok: false, text: `${(e as any).code ?? ''} ${errorText(e)}`, plain: t('ما نفعش: {e}', { e: errorText(e) }) });
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
    setView('log');
    await goDeviceOf(j.steps[j.steps.length - 1]);
  };
  const restart = async () => {
    if (j.reset && !await confirmDialog(j.reset === 'ZERO' ? t('هنبدأ بمطعم فاضي خالص — كل بيانات التجربة هتتمسح (تقدر ترجعها من «البيانات»). نكمل؟') : t('هترجع بيانات التجربة زي الأول. نكمل؟'))) return;
    if (j.reset) { demo.reset(j.reset); devices.resetAll(); apiLog.clear(); }
    setIdx(0); setLogs({}); setView('step'); setDone((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(j.id + ':'))));
    toast('success', j.reset === 'ZERO' ? t('مطعم فاضي: مفيش غير «الإدارة»، وكريم مهندس التركيب يقدر يدخل') : t('جاهز — ابدأ من الخطوة 1'));
    setTimeout(() => goDeviceFor(j.steps[0]), 100);
  };
  const goDeviceFor = async (s: StepDef) => { const real = resolveDevice(s.device); devices.setPrimary(real); };
  const pct = Math.round((doneCount / j.steps.length) * 100);
  return (
    <div className="flex flex-col h-full" data-screen="WALKTHROUGH">
      <div className="px-4 py-3 border-b line space-y-2">
        <div className="flex items-center gap-2">
          <button className="text-xs text-dim hover:text-[var(--primary)]" onClick={() => setJid(null)}>{t('كل الرحلات')}</button>
          <span className="text-dim">/</span><b className="text-sm truncate">{journeyTitle(j)}</b><Tech><span className="num text-[10px] text-dim">{j.id}</span></Tech>
        </div>
        <div className="space-y-1" data-fb="walk-progress">
          <div className="flex items-center justify-between text-[11px]"><span className="text-soft">{t('خطوة {i} من {n}', { i: idx + 1, n: j.steps.length })}</span><span className="text-dim">{t('اتعمل {d}', { d: doneCount })}{failCount ? ` · ${t('فيها مشكلة {f}', { f: failCount })}` : ''}</span></div>
          <div className="h-1.5 rounded-full surface-3 overflow-hidden"><div className="h-full bg-[var(--success)] transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="flex gap-1 flex-wrap">
          {j.steps.map((s, i) => { const st = status(s); return <button key={s.id} onClick={() => { setIdx(i); setView('step'); }} title={pick(STEP_PLAIN[s.id]?.do).slice(0, 80)} className={cn('w-7 h-7 rounded-md text-[11px] num border', i === idx && view === 'step' ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)] font-bold' : st === true ? 'border-[color-mix(in_srgb,var(--success)_50%,transparent)] text-[var(--success)]' : st === false ? 'border-[color-mix(in_srgb,var(--error)_50%,transparent)] text-[var(--error)]' : 'border-[var(--glass-border)] text-dim')}>{i + 1}</button>; })}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="ghost" onClick={restart} data-fb="walk-restart"><RotateCcw className="w-4 h-4" />{t('ابدأ من الأول')}</Button>
          <Button size="sm" onClick={runAll} disabled={running} data-fb="walk-run-all"><FastForward className="w-4 h-4" />{t('خلّي السيستم يكمّل الباقي')}</Button>
          <div className="flex rounded-lg border line overflow-hidden ms-auto">
            <button onClick={() => setView('step')} className={cn('px-2 h-8 text-xs flex items-center gap-1', view === 'step' ? 'bg-[var(--primary-container)] text-[var(--primary)]' : 'text-soft')}><Footprints className="w-3.5 h-3.5" />{t('الخطوة')}</button>
            <button onClick={() => setView('log')} data-fb="walk-log-tab" className={cn('px-2 h-8 text-xs flex items-center gap-1', view === 'log' ? 'bg-[var(--primary-container)] text-[var(--primary)]' : 'text-soft')}><ScrollText className="w-3.5 h-3.5" />{t('اللي حصل')}</button>
          </div>
        </div>
      </div>

      {view === 'log' ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {finished && jp && <Summary j={j} done={doneCount} failed={failCount} />}
          {j.steps.every((s) => !logs[`${j.id}:${s.id}`]) && <div className="text-sm text-dim text-center py-6">{t('لسه ما حصلش حاجة — اضغط «خلّي السيستم يعملها» أو «يكمّل الباقي».')}</div>}
          {j.steps.map((s, i) => logs[`${j.id}:${s.id}`] ? (
            <div key={s.id} className="rounded-xl surface-1 border line p-2.5 space-y-1">
              <button className="text-xs font-bold flex items-center gap-1.5 hover:text-[var(--primary)]" onClick={() => { setIdx(i); setView('step'); }}>
                {status(s) === true ? <CheckCircle2 className="w-4 h-4 text-[var(--success)]" /> : status(s) === false ? <XCircle className="w-4 h-4 text-[var(--error)]" /> : <Circle className="w-4 h-4 text-dim" />}
                {t('خطوة {i}', { i: i + 1 })}: <span className="font-normal text-soft">{pick(STEP_PLAIN[s.id]?.do).split(/[.:،]/)[0]}</span>
              </button>
              <LogView lines={logs[`${j.id}:${s.id}`]} tech={tech} />
            </div>
          ) : null)}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-lg font-bold">{t('خطوة {i}', { i: idx + 1 })}<Tech><span className="num text-[10px] text-dim font-normal ms-1">{step.id}</span></Tech></div>
            <Pill tone="primary"><MonitorSmartphone className="w-3 h-3" />{stepWho(step)}</Pill>
          </div>
          {plain ? (
            <>
              <Block title={t('اعمل كده')} body={pick(plain.do)} />
              <Block title={t('المفروض تشوف')} body={pick(plain.expect)} tone="info" />
            </>
          ) : text ? (
            <>
              <Block title={t('اعمل كده')} body={lang === 'ar' ? text.do_ar || text.do_en : text.do_en} />
              <Block title={t('المفروض تشوف')} body={lang === 'ar' ? text.expect_ar || text.expect_en : text.expect_en} tone="info" />
            </>
          ) : <Banner tone="warning">{t('مفيش شرح للخطوة دي')}</Banner>}
          <Tech>
            {text && (
              <div className="rounded-xl border border-dashed line p-2 space-y-1.5 text-[11px]">
                <div className="text-dim font-bold">{t('النص الأصلي للرحلة')}</div>
                <div className="num text-dim" dir="ltr" style={{ textAlign: 'left' }}>{text.who}</div>
                <div><b>{t('اعمل')}:</b> {lang === 'ar' ? text.do_ar || text.do_en : text.do_en}</div>
                <div><b>{t('المتوقع')}:</b> {lang === 'ar' ? text.expect_ar || text.expect_en : text.expect_en}</div>
                {text.note && <div className="text-dim">{text.note}</div>}
                {text.operations?.length > 0 && (
                  <div className="rounded-lg border line overflow-hidden">
                    {text.operations.map((o, i) => <div key={i} className="px-2 py-1 border-t line first:border-t-0 flex items-start gap-2"><StateBadge ops={[o.op]} /><div className="min-w-0" dir="ltr" style={{ textAlign: 'left' }}><div className="num font-bold">{o.op} <span className="text-dim font-normal">{o.http}</span></div><div className="text-dim break-words">{o.expected}</div></div></div>)}
                  </div>
                )}
              </div>
            )}
          </Tech>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={goDevice} data-fb="walk-go-device" title={t('بيفتح الجهاز ويدخّل الشخص الصح ويفتح الشاشة — وإنت تعمل الخطوة بإيدك')}><MonitorSmartphone className="w-4 h-4" />{t('ورّيني على الجهاز')}</Button>
            <Button variant="primary" loading={running} onClick={runOne} data-fb="walk-run-step" title={t('السيستم بيعمل الخطوة دي قدامك على نفس الأجهزة')}><Play className="w-4 h-4" />{t('خلّي السيستم يعملها')}</Button>
          </div>
          <div className="text-[11px] text-dim flex items-start gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{t('«ورّيني على الجهاز» بيجهّز الجهاز وإنت تعمل الخطوة بنفسك. «خلّي السيستم يعملها» بيعملها لوحده وتشوف النتيجة على الأجهزة.')}</div>
          {logs[key] && <div className="rounded-xl surface-1 border line p-2.5"><div className="text-[11px] font-bold text-dim mb-1">{t('اللي حصل')}</div><LogView lines={logs[key]} tech={tech} /></div>}
          {idx === j.steps.length - 1 && finished && jp && <Summary j={j} done={doneCount} failed={failCount} />}
        </div>
      )}
      <div className="px-4 py-3 border-t line flex justify-between">
        <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => { setIdx(idx - 1); setView('step'); }}><ChevronRight className="w-4 h-4 ltr:rotate-180" />{t('السابق')}</Button>
        <Button size="sm" variant="secondary" disabled={idx >= j.steps.length - 1} onClick={() => { setIdx(idx + 1); setView('step'); }} data-fb="walk-next">{t('التالي')}<ChevronLeft className="w-4 h-4 ltr:rotate-180" /></Button>
      </div>
    </div>
  );
}

function LogView({ lines, tech }: { lines: LogLine[]; tech: boolean }) {
  const shown = tech ? lines : lines.filter((l) => l.plain || l.ok === false);
  return (
    <div className="space-y-1">
      {shown.map((l, i) => (
        <div key={i} className="flex gap-1.5 items-start text-xs">
          {l.ok === true ? <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)] shrink-0 mt-0.5" /> : l.ok === false ? <XCircle className="w-3.5 h-3.5 text-[var(--error)] shrink-0 mt-0.5" /> : <Circle className="w-3.5 h-3.5 text-dim shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <div className="break-words leading-relaxed">{l.plain ?? (l.ok === false ? t('حاجة ما مشيتش زي المتوقع') : l.text)}</div>
            {tech && <div className="num text-[10px] text-dim break-words" dir="ltr" style={{ textAlign: 'left' }}>{l.text}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Summary({ j, done, failed }: { j: { id: string; steps: StepDef[] }; done: number; failed: number }) {
  const jp = JOURNEY_PLAIN[j.id];
  if (!jp) return null;
  return (
    <div className="rounded-xl p-3 border border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] space-y-1.5" data-fb="walk-summary">
      <div className="font-bold flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-[var(--success)]" />{t('اللي شفته في الرحلة دي')}</div>
      <ul className="list-disc ps-5 space-y-0.5 text-sm">{jp.summary.map((b, i) => <li key={i}>{pick(b)}</li>)}</ul>
      <div className="text-[11px] text-dim">{failed ? t('{d} خطوة مشيت تمام، و{f} فيها مشكلة — شوف «اللي حصل».', { d: done, f: failed }) : t('كل الخطوات ({d}) مشيت زي المتوقع.', { d: done })}</div>
    </div>
  );
}

function Block({ title, body, tone }: { title: string; body: string; tone?: 'info' }) {
  return <div className={cn('rounded-xl p-3 text-sm', tone === 'info' ? 'bg-[color-mix(in_srgb,var(--info)_10%,transparent)] border border-[color-mix(in_srgb,var(--info)_30%,transparent)]' : 'surface-1 border line')}><div className="text-xs font-bold text-dim mb-1">{title}</div><div className="leading-relaxed">{body}</div></div>;
}
