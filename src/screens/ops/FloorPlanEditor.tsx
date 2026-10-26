// Floor plan editor (setup): sections of the restaurant ("الصالة الرئيسية", "التراس", "الدور التاني"), tables dragged
// to their place, shapes and seats, decor (bar, doors, windows, plants, labels). Saving publishes the layout to every
// waiter tablet and cashier at once (Floor.Upsert).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Save, Undo2, Trash2, Square, Circle, RectangleHorizontal, Sofa, Wine, DoorOpen, PanelTop, Sprout, Type, MapPinned, EyeOff, Copy, LayoutGrid } from 'lucide-react';
import { useQuery, useCommand } from '../../app/hooks';
import { Section, StateBadge, Card, Button, Field, Input, Tabs, Pill, Banner, Empty, Modal, confirmDialog } from '../../ui';
import { t, L } from '../../i18n';
import { cn } from '../../lib/format';
import { Tech } from '../../app/tech';
import { FloorCanvas, Seats, shapeClass, type CanvasTable, type CanvasDecor } from './FloorCanvas';

interface DraftTable extends CanvasTable { tableId?: string; capacity: number; key: string }
interface Draft { id: string; isNew: boolean; name: { ar: string; en: string }; width: number; height: number; decor: CanvasDecor[]; tables: DraftTable[]; version: number | null; removeTableIds: string[] }

const SHAPES: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; w: number; h: number }[] = [
  { id: 'SQUARE', label: 'مربعة', icon: Square, w: 110, h: 110 },
  { id: 'ROUND', label: 'مدورة', icon: Circle, w: 100, h: 100 },
  { id: 'RECT', label: 'مستطيلة', icon: RectangleHorizontal, w: 170, h: 110 },
  { id: 'BOOTH', label: 'كنبة / بوث', icon: Sofa, w: 260, h: 120 },
];
const DECOR: { kind: string; label: string; icon: React.ComponentType<{ className?: string }>; w: number; h: number }[] = [
  { kind: 'BAR', label: 'بار', icon: Wine, w: 260, h: 60 }, { kind: 'DOOR', label: 'باب', icon: DoorOpen, w: 110, h: 28 }, { kind: 'WINDOW', label: 'شباك', icon: PanelTop, w: 20, h: 200 },
  { kind: 'PLANT', label: 'زرع', icon: Sprout, w: 56, h: 56 }, { kind: 'WALL', label: 'حيطة', icon: Square, w: 20, h: 240 }, { kind: 'LABEL', label: 'نص', icon: Type, w: 200, h: 36 },
];
const SNAP = 10;
const snap = (v: number) => Math.round(v / SNAP) * SNAP;
let keySeq = 0;

function toDraft(f: any): Draft {
  return { id: f.id, isNew: false, name: f.name, width: f.width, height: f.height, decor: (f.decor ?? []).map((d: any) => ({ ...d })), version: f.version,
    tables: (f.tables ?? []).map((tb: any) => ({ key: `k${++keySeq}`, tableId: tb.id, id: tb.id, name: tb.name, capacity: tb.capacity, x: tb.x, y: tb.y, w: tb.w, h: tb.h, shape: tb.shape, seats: tb.seats ?? tb.capacity })), removeTableIds: [] };
}

export default function FloorPlanEditor() {
  const floors = useQuery<any>('Floor.List');
  const tablesQ = useQuery<any>('Table.List', { query: {} });
  const { run, busy } = useCommand();
  const list: any[] = floors.data?.items ?? [];
  const [activeId, setActiveId] = useState<string>('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<{ kind: 'table' | 'decor'; key: string } | null>(null);
  const [newFloor, setNewFloor] = useState(false);
  const canvas = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ kind: 'table' | 'decor'; key: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);

  const current = list.find((f) => f.id === activeId) ?? list[0];
  useEffect(() => { if (!dirty && current && (!draft || draft.id !== current.id || draft.version !== current.version) && !draft?.isNew) { setDraft(toDraft(current)); setSel(null); } }, [current?.id, current?.version, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = useMemo(() => new Map<string, any>((tablesQ.data?.items ?? []).map((x: any) => [x.id, x])), [tablesQ.data]);
  const unplaced: any[] = (floors.data?.unplaced ?? []).filter((u: any) => !draft?.tables.some((x) => x.tableId === u.id));
  const otherFloors = (tablesQ.data?.items ?? []).filter((x: any) => x.floorId && x.floorId !== draft?.id && !x.layout?.auto);

  const update = (fn: (d: Draft) => Draft) => { setDraft((d) => (d ? fn(d) : d)); setDirty(true); };
  const selTable = draft?.tables.find((x) => sel?.kind === 'table' && x.key === sel.key) ?? null;
  const selDecor = draft?.decor.find((x) => sel?.kind === 'decor' && x.id === sel.key) ?? null;

  // ───── dragging (pointer events, snapped to a 10-unit grid, kept inside the floor)
  const scale = () => (canvas.current && draft ? canvas.current.getBoundingClientRect().width / draft.width : 1);
  const begin = (e: React.PointerEvent, kind: 'table' | 'decor', key: string, mode: 'move' | 'resize', r: { x: number; y: number; w: number; h: number }) => {
    e.preventDefault(); e.stopPropagation();
    setSel({ kind, key });
    drag.current = { kind, key, mode, sx: e.clientX, sy: e.clientY, ox: r.x, oy: r.y, ow: r.w, oh: r.h };
    const rtl = document.documentElement.dir === 'rtl';
    const move = (ev: PointerEvent) => {
      const g = drag.current; if (!g || !draft) return;
      const k = scale();
      const dx = (ev.clientX - g.sx) / k, dy = (ev.clientY - g.sy) / k;
      void rtl;
      setDraft((d) => {
        if (!d) return d;
        const clampMove = (o: { w: number; h: number }) => ({ x: Math.max(0, Math.min(d.width - o.w, snap(g.ox + dx))), y: Math.max(0, Math.min(d.height - o.h, snap(g.oy + dy))) });
        const size = () => ({ w: Math.max(40, Math.min(d.width - g.ox, snap(g.ow + dx))), h: Math.max(26, Math.min(d.height - g.oy, snap(g.oh + dy))) });
        if (g.kind === 'table') return { ...d, tables: d.tables.map((x) => (x.key !== g.key ? x : g.mode === 'move' ? { ...x, ...clampMove(x) } : { ...x, ...size() })) };
        return { ...d, decor: d.decor.map((x) => (x.id !== g.key ? x : g.mode === 'move' ? { ...x, ...clampMove(x) } : { ...x, ...size() })) };
      });
      setDirty(true);
    };
    const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const freeSpot = (w: number, h: number) => {
    if (!draft) return { x: 20, y: 20 };
    for (let y = 20; y + h < draft.height; y += 30) for (let x = 20; x + w < draft.width; x += 30) {
      const hit = [...draft.tables, ...draft.decor.filter((d) => d.kind !== 'LABEL')].some((o) => x < o.x + o.w + 20 && x + w + 20 > o.x && y < o.y + o.h + 20 && y + h + 20 > o.y);
      if (!hit) return { x, y };
    }
    return { x: 20, y: 20 };
  };
  const nextName = () => {
    const names = new Set<string>([...(tablesQ.data?.items ?? []).map((x: any) => x.name), ...(draft?.tables ?? []).map((x) => x.name)]);
    let n = 1; while (names.has(String(n))) n++;
    return String(n);
  };
  const addTable = (shape = 'SQUARE', from?: any) => {
    const sh = SHAPES.find((s) => s.id === shape)!;
    const pos = freeSpot(sh.w, sh.h);
    const key = `k${++keySeq}`;
    const cap = from?.capacity ?? (shape === 'RECT' ? 6 : shape === 'BOOTH' ? 8 : shape === 'ROUND' ? 2 : 4);
    update((d) => ({ ...d, tables: [...d.tables, { key, tableId: from?.id, id: from?.id ?? key, name: from?.name ?? nextName(), capacity: cap, seats: cap, shape, ...pos, w: sh.w, h: sh.h }], removeTableIds: d.removeTableIds.filter((x) => x !== from?.id) }));
    setSel({ kind: 'table', key });
  };
  const addDecor = (kind: string) => {
    const dd = DECOR.find((x) => x.kind === kind)!;
    const id = `d${Date.now().toString(36)}`;
    update((d) => ({ ...d, decor: [...d.decor, { id, kind, x: 40, y: 40, w: dd.w, h: dd.h, label: kind === 'LABEL' ? t('ركن') : kind === 'BAR' ? t('البار') : kind === 'DOOR' ? t('باب') : '' }] }));
    setSel({ kind: 'decor', key: id });
  };
  const patchTable = (p: Partial<DraftTable>) => selTable && update((d) => ({ ...d, tables: d.tables.map((x) => (x.key === selTable.key ? { ...x, ...p } : x)) }));
  const patchDecor = (p: Partial<CanvasDecor>) => selDecor && update((d) => ({ ...d, decor: d.decor.map((x) => (x.id === selDecor.id ? { ...x, ...p } : x)) }));

  const save = async () => {
    if (!draft) return;
    const body = {
      name: draft.name, width: draft.width, height: draft.height, decor: draft.decor, expectedVersion: draft.isNew ? undefined : draft.version,
      tables: draft.tables.map((x) => ({ tableId: x.tableId, name: x.name.trim(), capacity: x.capacity, seats: x.seats, shape: x.shape, x: x.x, y: x.y, w: x.w, h: x.h })),
      removeTableIds: draft.removeTableIds,
    };
    const r = await run<any>('Floor.Upsert', { params: { floorId: draft.id }, body }, { success: t('الخريطة اتحفظت — ظهرت على كل الأجهزة') });
    if (r) { setDirty(false); setActiveId(r.id); setDraft(toDraft(r)); }
  };
  const discard = async () => { if (!dirty || (await confirmDialog(t('تلغي التعديلات اللي ما اتحفظتش؟')))) { setDirty(false); setDraft(current ? toDraft(current) : null); setSel(null); } };
  const switchFloor = async (id: string) => { if (dirty && !(await confirmDialog(t('فيه تعديلات ما اتحفظتش على القسم ده. تسيبها؟')))) return; setDirty(false); setActiveId(id); setDraft(toDraft(list.find((f) => f.id === id))); setSel(null); };

  return (
    <div className="space-y-4" data-screen="FLP">
      <Section title={t('خريطة الصالة')} badge={<StateBadge ops={['Floor.List', 'Floor.Upsert']} />}
        sub={t('اقسم المطعم لأقسام، واسحب كل ترابيزة لمكانها الحقيقي. أول ما تحفظ، تابلت الويتر والكاشير بيشوفوا نفس الخريطة.')}
        actions={<>
          {dirty && <Pill tone="warning">{t('فيه تعديلات ما اتحفظتش')}</Pill>}
          <Button variant="ghost" onClick={discard} disabled={!dirty}><Undo2 className="w-4 h-4" />{t('رجّع')}</Button>
          <Button variant="primary" loading={busy} disabled={!dirty || !draft} onClick={save} data-fb="floorplan-save"><Save className="w-4 h-4" />{t('احفظ الخريطة')}</Button>
        </>} />
      <div className="flex items-center gap-2 flex-wrap">
        {list.length > 0 && <Tabs value={draft?.isNew ? '' : current?.id ?? ''} onChange={switchFloor} tabs={list.map((f) => ({ id: f.id, label: <span data-fb={`floorplan-tab:${f.name.ar}`}>{L(f.name)} <span className="num text-xs opacity-70">{f.tableCount}</span></span> }))} />}
        {draft?.isNew && <Pill tone="primary">{L(draft.name)} ({t('جديد')})</Pill>}
        <Button size="sm" variant="outline" onClick={() => setNewFloor(true)} data-fb="floorplan-new-floor"><Plus className="w-4 h-4" />{t('قسم جديد')}</Button>
      </div>
      {!draft && !floors.loading && <Empty text={t('مفيش أقسام لسه — اعمل أول قسم')}><Button variant="primary" onClick={() => setNewFloor(true)}><Plus className="w-4 h-4" />{t('قسم جديد')}</Button></Empty>}
      {draft && (
        <div className="grid xl:grid-cols-[1fr_300px] gap-4 items-start">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap rounded-xl surface-1 border line p-1.5" data-fb="floorplan-toolbar">
              <span className="text-xs text-soft px-1">{t('ترابيزة')}:</span>
              {SHAPES.map((s) => <Button key={s.id} size="sm" onClick={() => addTable(s.id)} data-fb={`floorplan-add:${s.id}`}><s.icon className="w-3.5 h-3.5" />{t(s.label)}</Button>)}
              <span className="w-px h-6 bg-white/10 mx-1" />
              <span className="text-xs text-soft px-1">{t('شكل المكان')}:</span>
              {DECOR.map((d) => <Button key={d.kind} size="sm" variant="ghost" onClick={() => addDecor(d.kind)}><d.icon className="w-3.5 h-3.5" />{t(d.label)}</Button>)}
            </div>
            <FloorCanvas editing canvasRef={canvas} width={draft.width} height={draft.height} decor={draft.decor} tables={draft.tables.map((x) => ({ ...x, id: x.key }))}
              onBackgroundClick={() => setSel(null)}
              onPointerDownTable={(e, ct, mode) => { const x = draft.tables.find((y) => y.key === ct.id)!; begin(e, 'table', x.key, mode, x); }}
              onPointerDownDecor={(e, d, mode) => begin(e, 'decor', d.id, mode, d)}
              renderTable={(ct) => {
                const x = draft.tables.find((y) => y.key === ct.id)!;
                const lv = x.tableId ? live.get(x.tableId) : null;
                return (
                  <div data-fb={`floorplan-table:${x.name}`} className={cn('relative w-full h-full flex flex-col items-center justify-center border-2 cursor-move', shapeClass(x.shape), sel?.key === x.key ? 'border-[var(--primary)] bg-[var(--primary-container)] shadow-[0_0_0_4px_rgba(34,211,238,.15)]' : 'border-white/30 bg-white/[0.06] hover:border-white/60')}>
                    <Seats n={x.seats} shape={x.shape} />
                    <span className="text-xl font-extrabold num">{x.name}</span>
                    <span className="text-[10px] text-dim">{x.seats} {t('كرسي')}</span>
                    {lv?.occupancy && <span className="absolute top-1 start-1 w-2 h-2 rounded-full bg-pink-400" title={t('عليها ضيوف دلوقتي')} />}
                    {!x.tableId && <span className="absolute -top-2 start-1/2 -translate-x-1/2 text-[9px] px-1 rounded bg-[var(--primary)] text-black font-bold">{t('جديدة')}</span>}
                  </div>
                );
              }} />
            <div className="text-[11px] text-dim">{t('اسحب الترابيزة عشان تحركها، واسحب النقطة اللي في الركن عشان تكبّرها أو تصغّرها. الحركة بتمشي على شبكة 10 سم.')}</div>
          </div>
          <div className="space-y-3">
            <Card title={t('القسم')}>
              <div className="space-y-3">
                <Field label={t('الاسم بالعربي')}><Input value={draft.name.ar} onChange={(e) => update((d) => ({ ...d, name: { ...d.name, ar: e.target.value } }))} data-fb="floorplan-name" /></Field>
                <Field label={t('الاسم بالإنجليزي')}><Input value={draft.name.en} onChange={(e) => update((d) => ({ ...d, name: { ...d.name, en: e.target.value } }))} dir="ltr" /></Field>
                <div className="flex gap-2 text-xs text-dim"><Pill tone="neutral">{draft.tables.length} {t('ترابيزة')}</Pill><Pill tone="neutral">{draft.tables.reduce((a, x) => a + Number(x.seats || 0), 0)} {t('كرسي')}</Pill></div>
                <Tech><div className="num text-[10px] text-dim">{draft.id} · v{draft.version ?? 'new'} · {draft.width}×{draft.height}</div></Tech>
              </div>
            </Card>
            {selTable && (
              <Card title={<span>{t('ترابيزة')} <span className="num">{selTable.name}</span></span>} actions={<Button size="sm" variant="ghost" onClick={() => setSel(null)}>{t('تم')}</Button>}>
                <div className="space-y-3" data-fb="floorplan-table-panel">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={t('الرقم / الاسم')}><Input value={selTable.name} onChange={(e) => patchTable({ name: e.target.value.slice(0, 12) })} data-fb="floorplan-table-name" /></Field>
                    <Field label={t('عدد الكراسي')}><Input type="number" min={1} max={30} value={selTable.seats} onChange={(e) => { const n = Math.max(1, Math.min(30, Number(e.target.value) || 1)); patchTable({ seats: n, capacity: n }); }} data-fb="floorplan-table-seats" /></Field>
                  </div>
                  <Field label={t('الشكل')}>
                    <div className="grid grid-cols-4 gap-1">{SHAPES.map((s) => <button key={s.id} onClick={() => patchTable({ shape: s.id, w: s.w, h: s.h })} title={t(s.label)} className={cn('h-10 rounded-lg border flex items-center justify-center', selTable.shape === s.id ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'border-[var(--glass-border)] surface-1')}><s.icon className="w-4 h-4" /></button>)}</div>
                  </Field>
                  <div className="flex gap-1.5 flex-wrap">
                    <Button size="sm" onClick={() => addTable(selTable.shape)}><Copy className="w-3.5 h-3.5" />{t('واحدة زيها')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { update((d) => ({ ...d, tables: d.tables.filter((x) => x.key !== selTable.key) })); setSel(null); }} data-fb="floorplan-table-unplace"><EyeOff className="w-3.5 h-3.5" />{t('شيلها من الخريطة')}</Button>
                    {selTable.tableId && <Button size="sm" variant="danger" disabled={!!live.get(selTable.tableId)?.occupancy} onClick={() => { update((d) => ({ ...d, tables: d.tables.filter((x) => x.key !== selTable.key), removeTableIds: [...d.removeTableIds, selTable.tableId!] })); setSel(null); }}><Trash2 className="w-3.5 h-3.5" />{t('وقّفها خالص')}</Button>}
                    {!selTable.tableId && <Button size="sm" variant="danger" onClick={() => { update((d) => ({ ...d, tables: d.tables.filter((x) => x.key !== selTable.key) })); setSel(null); }}><Trash2 className="w-3.5 h-3.5" />{t('امسحها')}</Button>}
                  </div>
                  {selTable.tableId && live.get(selTable.tableId)?.occupancy && <Banner tone="info">{t('عليها ضيوف دلوقتي — تقدر تحركها بس مينفعش توقفها.')}</Banner>}
                </div>
              </Card>
            )}
            {selDecor && (
              <Card title={t('عنصر في المكان')} actions={<Button size="sm" variant="ghost" onClick={() => setSel(null)}>{t('تم')}</Button>}>
                <div className="space-y-3">
                  <Field label={t('المكتوب عليه')}><Input value={selDecor.label ?? ''} onChange={(e) => patchDecor({ label: e.target.value.slice(0, 40) })} /></Field>
                  <Button size="sm" variant="danger" onClick={() => { update((d) => ({ ...d, decor: d.decor.filter((x) => x.id !== selDecor.id) })); setSel(null); }}><Trash2 className="w-3.5 h-3.5" />{t('امسحه')}</Button>
                </div>
              </Card>
            )}
            <Card title={<span className="flex items-center gap-2"><MapPinned className="w-4 h-4" />{t('ترابيزات مش على الخريطة')}</span>}>
              {unplaced.length === 0 && otherFloors.length === 0 ? <div className="text-xs text-dim">{t('كل الترابيزات متحطة في أماكنها')}</div> : (
                <div className="space-y-1.5">
                  {unplaced.map((u) => <div key={u.id} className="flex items-center justify-between gap-2 text-sm"><span><span className="num font-bold">{u.name}</span> · {u.capacity} {t('كرسي')}{!u.active && <Pill tone="neutral" className="ms-1">{t('موقوفة')}</Pill>}</span><Button size="sm" onClick={() => addTable(u.capacity > 4 ? 'RECT' : 'SQUARE', u)} data-fb={`floorplan-place:${u.name}`}>{t('حطها هنا')}</Button></div>)}
                  {otherFloors.length > 0 && <div className="text-[11px] text-dim pt-1 border-t line">{t('تقدر تنقل ترابيزة من قسم تاني:')}</div>}
                  {otherFloors.slice(0, 12).map((u: any) => <div key={u.id} className="flex items-center justify-between gap-2 text-xs"><span><span className="num font-bold">{u.name}</span> · {L(u.floorName)}</span><Button size="sm" variant="ghost" onClick={() => addTable(u.layout?.shape ?? 'SQUARE', u)}>{t('انقلها هنا')}</Button></div>)}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
      {newFloor && <NewFloorDialog onClose={() => setNewFloor(false)} onCreate={(name, size) => { setNewFloor(false); setDirty(true); setSel(null); setDraft({ id: `floor_${Date.now().toString(36)}`, isNew: true, name, width: size.w, height: size.h, decor: [], tables: [], version: null, removeTableIds: [] }); }} />}
    </div>
  );
}

function NewFloorDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: { ar: string; en: string }, size: { w: number; h: number }) => void }) {
  const [ar, setAr] = useState('');
  const [en, setEn] = useState('');
  const [size, setSize] = useState('M');
  const sizes: Record<string, { w: number; h: number; label: string }> = { S: { w: 800, h: 500, label: 'صغير' }, M: { w: 1000, h: 620, label: 'متوسط' }, L: { w: 1400, h: 800, label: 'كبير' } };
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><LayoutGrid className="w-5 h-5" />{t('قسم جديد')}</span>} badge={<StateBadge ops={['Floor.Upsert']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" disabled={!ar.trim()} onClick={() => onCreate({ ar: ar.trim(), en: en.trim() || ar.trim() }, sizes[size])} data-fb="floorplan-new-create">{t('ابدأ الرسم')}</Button></>}>
      <div className="space-y-3">
        <Field label={t('اسم القسم')}><Input value={ar} onChange={(e) => setAr(e.target.value)} placeholder={t('مثلاً: الروف، الجنينة، قاعة المناسبات')} data-fb="floorplan-new-name" /></Field>
        <Field label={t('بالإنجليزي (اختياري)')}><Input value={en} onChange={(e) => setEn(e.target.value)} dir="ltr" placeholder="Roof" /></Field>
        <Field label={t('مساحة الرسم')}><Tabs value={size} onChange={setSize} tabs={Object.entries(sizes).map(([k, v]) => ({ id: k, label: t(v.label) }))} /></Field>
        <div className="text-[11px] text-dim">{t('القسم مش هيظهر للويترز غير لما تحفظ.')}</div>
      </div>
    </Modal>
  );
}
