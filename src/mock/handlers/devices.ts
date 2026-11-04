// ux-14 (PROPOSED): the device registry — printers, cash drawers, scanners and display screens attached to the
// terminals (owner module: organization) — the display content library and each display's playlist, the test page,
// and each terminal's keyboard changes. Authorization precedes every read and write (the operation's permission in
// the kernel, then the rules below); every write is CAS-checked and audited (reasons persisted).
import { ApiError } from '../errors';
import type { Ctx, Handler } from '../kernel';
import { nextId, event } from '../store';
import { enqueuePrint } from '../outbox';
import { checkVersion, need, page, userName } from './util';
import { reasonText } from '../drawer-count';
import { devOf, deviceStatus, contentActiveNow, isDisplayKind, keyMapRule, customerDisplayRule, CONTENT_IMAGE_MAX, EMPTY_SCHEDULE, roleOf } from '../devices';
import type { Device, DeviceKind, DisplayContent, PrintRole, ContentSchedule } from '../types-devices';
import type { Loc } from '../types';

const KINDS: DeviceKind[] = ['PRINTER', 'CASH_DRAWER', 'SCANNER', 'CUSTOMER_DISPLAY', 'CALL_BOARD'];
const ROLES: PrintRole[] = ['RECEIPT', 'KITCHEN', 'REPORT'];
/** The terminal kind each device needs: a drawer, a scanner and a customer display sit on a cashier terminal, a call
 *  board follows a kitchen screen, a printer may sit on any terminal or on the network. */
const HOST_KIND: Partial<Record<DeviceKind, string[]>> = { CASH_DRAWER: ['CASH'], SCANNER: ['CASH', 'FLOOR', 'ADMIN'], CUSTOMER_DISPLAY: ['CASH'], CALL_BOARD: ['KDS'] };
/** Only one per terminal: its drawer and its customer-facing second screen. */
const ONE_PER_HOST: DeviceKind[] = ['CASH_DRAWER', 'CUSTOMER_DISPLAY'];

const deviceOf = (ctx: Ctx, id: string) => {
  const d = devOf(ctx.db).devices.find((x) => x.id === id);
  if (!d || (ctx.branchId && d.branchId !== ctx.branchId)) throw new ApiError('DEVICE_NOT_FOUND', { deviceId: id }, 404);
  return d;
};
const text = (v: unknown, field: string, max: number, required = true): string => {
  const s = String(v ?? '').trim();
  if (required) need(s.length > 0, 'VALIDATION_FAILED', { field, rule: 'required' });
  need(s.length <= max, 'VALIDATION_FAILED', { field, rule: `at most ${max} characters` });
  return s;
};
const loc = (v: any, field: string, max: number, required = true): Loc | null => {
  const ar = text(v?.ar, `${field}.ar`, max, required);
  const en = text(v?.en, `${field}.en`, max, false);
  return ar || en ? { ar, en: en || ar } : null;
};

/** The terminal a device attaches to: active, in the branch, of the right kind; one drawer / customer display each. */
function checkHost(ctx: Ctx, kind: DeviceKind, terminalId: unknown, branchId: string, self?: string): string | null {
  if (terminalId === null || terminalId === undefined || terminalId === '') {
    if (kind === 'PRINTER') return null;
    throw new ApiError('DEVICE_HOST_INVALID', { kind, rule: 'attached to a terminal' }, 409);
  }
  const t = ctx.db.terminals.find((x) => x.id === terminalId);
  if (!t || t.lifecycle !== 'ACTIVE' || t.branchId !== branchId) throw new ApiError('DEVICE_HOST_INVALID', { kind, terminalId, rule: 'an active terminal of the branch' }, 409);
  const kinds = HOST_KIND[kind];
  if (kinds && !kinds.includes(t.kind)) throw new ApiError('DEVICE_HOST_INVALID', { kind, terminalId, terminalKind: t.kind, allowed: kinds }, 409);
  if (ONE_PER_HOST.includes(kind) && devOf(ctx.db).devices.some((d) => d.kind === kind && d.terminalId === t.id && d.id !== self)) throw new ApiError('DEVICE_HOST_TAKEN', { kind, terminalId }, 409);
  return t.id;
}
function printerSettings(ctx: Ctx, v: any, cur?: Device['printer']): NonNullable<Device['printer']> {
  const roles: PrintRole[] = v?.roles ?? cur?.roles ?? ['RECEIPT'];
  need(Array.isArray(roles) && roles.length > 0 && roles.every((r) => ROLES.includes(r)), 'VALIDATION_FAILED', { field: 'printer.roles', allowed: ROLES });
  const stationIds: string[] = v?.stationIds ?? cur?.stationIds ?? [];
  need(Array.isArray(stationIds) && stationIds.every((s) => ctx.db.stations.some((x) => x.id === s)), 'VALIDATION_FAILED', { field: 'printer.stationIds', rule: 'existing kitchen stations' });
  const paper = v?.paper ?? cur?.paper ?? '80MM';
  need(paper === '80MM' || paper === '58MM', 'VALIDATION_FAILED', { field: 'printer.paper', allowed: ['80MM', '58MM'] });
  const connection = v?.connection ?? cur?.connection ?? 'USB';
  need(['USB', 'NETWORK', 'BLUETOOTH'].includes(connection), 'VALIDATION_FAILED', { field: 'printer.connection', allowed: ['USB', 'NETWORK', 'BLUETOOTH'] });
  const address = v?.address !== undefined ? (v.address ? text(v.address, 'printer.address', 64) : null) : cur?.address ?? null;
  if (address) need(/^[A-Za-z0-9.:\-]+$/.test(address), 'VALIDATION_FAILED', { field: 'printer.address', rule: 'a host name or address' });
  return { roles: [...new Set(roles)], stationIds: roles.includes('KITCHEN') ? [...new Set(stationIds)] : [], paper, connection, address, backup: v?.backup ?? cur?.backup ?? false };
}
function displaySettings(v: any, cur?: Device['display']): NonNullable<Device['display']> {
  const style = v?.style ?? cur?.style ?? 'theme';
  need(style === 'theme' || style === 'display', 'VALIDATION_FAILED', { field: 'display.style', allowed: ['theme', 'display'] });
  const branding = v?.branding ?? cur?.branding ?? true;
  need(typeof branding === 'boolean', 'VALIDATION_FAILED', { field: 'display.branding', rule: 'true | false' });
  return { style, branding, playlist: cur?.playlist ?? [] };
}

/** What the screens and the tests read: the device with its status, host and (printer) last job. */
export function deviceView(ctx: Ctx, d: Device) {
  const host = d.terminalId ? ctx.db.terminals.find((t) => t.id === d.terminalId) : null;
  const jobs = d.kind === 'PRINTER' || d.kind === 'CASH_DRAWER' ? ctx.db.printJobs.filter((j) => j.printerId === d.id) : [];
  const last = jobs[0] ?? null;
  return {
    ...d, status: deviceStatus(ctx.db, d, ctx.now),
    terminal: host ? { id: host.id, code: host.code, name: host.name, kind: host.kind, active: host.lifecycle === 'ACTIVE' } : null,
    lastJob: last ? { id: last.id, state: last.state, label: last.label, at: last.attempts.at(-1)?.at ?? last.createdAt, error: last.attempts.at(-1)?.error ?? null } : null,
    failedJobs: jobs.filter((j) => j.state === 'FAILED' || j.state === 'DEAD').length,
    stations: (d.printer?.stationIds ?? []).map((id) => ({ id, name: ctx.db.stations.find((s) => s.id === id)?.name ?? id })),
    playlistItems: d.display ? d.display.playlist.map((id) => devOf(ctx.db).content.find((c) => c.id === id)).filter(Boolean).map((c) => ({ id: c!.id, kind: c!.kind, title: c!.title, retired: c!.retired, activeNow: contentActiveNow(c!, ctx.now, tzOf(ctx, d.branchId)) })) : undefined,
    createdByName: userName(ctx.db, d.createdBy), updatedByName: userName(ctx.db, d.updatedBy),
  };
}
const tzOf = (ctx: Ctx, branchId: string | null | undefined) => ctx.db.branches.find((b) => b.id === branchId)?.timezone ?? 'Africa/Cairo';

function contentView(ctx: Ctx, c: DisplayContent) {
  const p = c.promotionId ? ctx.db.promotions.find((x) => x.id === c.promotionId) : null;
  const pr = c.productId ? ctx.db.products.find((x) => x.id === c.productId) : null;
  const usedBy = devOf(ctx.db).devices.filter((d) => d.display?.playlist.includes(c.id)).map((d) => ({ id: d.id, code: d.code, name: d.name }));
  return { ...c, activeNow: contentActiveNow(c, ctx.now, tzOf(ctx, ctx.branchId)), promotion: p ? { id: p.id, name: p.name, active: p.active } : null, product: pr ? { id: pr.id, name: pr.name, imageUrl: pr.imageUrl ?? null } : null, usedBy, updatedByName: userName(ctx.db, c.updatedBy) };
}
function schedule(v: any): ContentSchedule {
  const s = { ...EMPTY_SCHEDULE, ...(v ?? {}) };
  const date = (x: unknown, f: string) => { if (x === null || x === undefined || x === '') return null; need(/^\d{4}-\d{2}-\d{2}$/.test(String(x)), 'VALIDATION_FAILED', { field: `schedule.${f}`, rule: 'YYYY-MM-DD' }); return String(x); };
  const hm = (x: unknown, f: string) => { if (x === null || x === undefined || x === '') return null; need(/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x)), 'VALIDATION_FAILED', { field: `schedule.${f}`, rule: 'HH:MM' }); return String(x); };
  const out: ContentSchedule = { from: date(s.from, 'from'), to: date(s.to, 'to'), start: hm(s.start, 'start'), end: hm(s.end, 'end'), days: Array.isArray(s.days) ? [...new Set<number>((s.days as unknown[]).map(Number))].sort() : [] };
  need(!out.from || !out.to || out.from <= out.to, 'VALIDATION_FAILED', { field: 'schedule.to', rule: 'on or after the first day' });
  need(!!out.start === !!out.end, 'VALIDATION_FAILED', { field: 'schedule.end', rule: 'a daily window has a start and an end' });
  need(!out.start || out.start !== out.end, 'VALIDATION_FAILED', { field: 'schedule.end', rule: 'the window is not empty' });
  need(out.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6), 'VALIDATION_FAILED', { field: 'schedule.days', rule: '0 (Sunday) .. 6' });
  return out;
}

/** A display screen reads with the session of the terminal it is attached to: it must be a registered display of that
 *  kind on that very terminal (DISPLAY_NOT_ATTACHED 403). Marks it seen (telemetry, not business truth). */
export function displayFor(ctx: Ctx, displayId: string, kind: 'CUSTOMER_DISPLAY' | 'CALL_BOARD') {
  const d = devOf(ctx.db).devices.find((x) => x.id === displayId && x.kind === kind);
  if (!d) throw new ApiError('DEVICE_NOT_FOUND', { deviceId: displayId }, 404);
  if (!ctx.terminal || d!.terminalId !== ctx.terminal.id) throw new ApiError('DISPLAY_NOT_ATTACHED', { deviceId: displayId, terminalId: ctx.terminal?.id ?? null }, 403);
  if (d!.enabled) d!.lastSeenAt = ctx.nowIso;
  const rule = customerDisplayRule(d!.branchId);
  return { id: d!.id, code: d!.code, name: d!.name, kind: d!.kind, enabled: d!.enabled, style: d!.display?.style ?? 'theme', branding: d!.display?.branding ?? true, slideSeconds: rule.slideSeconds, thanksSeconds: rule.thanksSeconds, idleContent: rule.idleContent, playlist: d!.display?.playlist ?? [] };
}
/** The content a customer display shows now: its playlist, in order, inside each item's schedule; a promotion only while
 *  it is active (its benefit from the server), a dish only while it is on the menu. */
export function displayContentNow(ctx: Ctx, playlist: string[], benefit: (p: any) => unknown) {
  const all = devOf(ctx.db).content;
  const out: any[] = [];
  for (const id of playlist) {
    const c = all.find((x) => x.id === id);
    if (!c || !contentActiveNow(c, ctx.now, tzOf(ctx, ctx.branchId))) continue;
    if (c.kind === 'PROMOTION') {
      const p = ctx.db.promotions.find((x) => x.id === c.promotionId);
      if (!p || !p.active || (p.branchIds.length && !p.branchIds.includes(ctx.branchId ?? '')) || (p.validTo && p.validTo <= ctx.now)) continue;
      out.push({ id: c.id, kind: c.kind, title: c.title, body: c.body, promo: { id: p.id, name: p.name, kind: p.kind, code: p.kind === 'CODED' ? p.code : null, benefit: benefit(p), schedule: p.schedule ? { start: p.schedule.start, end: p.schedule.end } : null } });
    } else if (c.kind === 'DISH') {
      const pr = ctx.db.products.find((x) => x.id === c.productId);
      if (!pr || pr.active === false) continue;
      out.push({ id: c.id, kind: c.kind, title: c.title, body: c.body, dish: { id: pr.id, name: pr.name, imageUrl: pr.imageUrl ?? null } });
    } else out.push({ id: c.id, kind: c.kind, title: c.title, body: c.body, imageDataUrl: c.kind === 'IMAGE' ? c.imageDataUrl : null });
  }
  return out;
}

const stamp = (ctx: Ctx, d: { version: number; updatedAt: string; updatedBy: string }) => { d.version++; d.updatedAt = ctx.nowIso; d.updatedBy = ctx.user!.id; };

export const deviceHandlers: Record<string, Handler> = {
  'Device.List': (ctx) => {
    const items = devOf(ctx.db).devices
      .filter((d) => (!ctx.branchId || d.branchId === ctx.branchId) && (!ctx.query.kind || ctx.query.kind.split(',').includes(d.kind)) && (!ctx.query.terminalId || d.terminalId === ctx.query.terminalId))
      .map((d) => deviceView(ctx, d));
    return page(items, ctx.query);
  },
  'Device.Get': (ctx) => deviceView(ctx, deviceOf(ctx, ctx.params.deviceId)),
  'Device.Register': (ctx) => {
    const b = ctx.body ?? {};
    const kind = b.kind as DeviceKind;
    need(KINDS.includes(kind), 'VALIDATION_FAILED', { field: 'kind', allowed: KINDS });
    const branchId = ctx.branchId ?? b.branchId;
    need(branchId && ctx.db.branches.some((x) => x.id === branchId), 'CONTEXT_REQUIRED', { field: 'branchId' });
    const code = text(b.code, 'code', 24).toUpperCase();
    need(/^[A-Z0-9-]{2,24}$/.test(code), 'VALIDATION_FAILED', { field: 'code', rule: 'Latin letters, digits and dashes' });
    if (devOf(ctx.db).devices.some((d) => d.code === code)) throw new ApiError('DEVICE_CODE_TAKEN', { code }, 409);
    const name = text(b.name, 'name', 60);
    const terminalId = checkHost(ctx, kind, b.terminalId, branchId);
    const d: Device = {
      id: nextId(kind === 'PRINTER' ? 'prn' : kind === 'CASH_DRAWER' ? 'drw' : kind === 'SCANNER' ? 'scn' : 'disp'), code, name, kind, branchId, terminalId, enabled: true,
      printer: kind === 'PRINTER' ? printerSettings(ctx, b.printer) : undefined,
      display: isDisplayKind(kind) ? displaySettings(b.display) : undefined,
      lastSeenAt: null, version: 1, createdAt: ctx.nowIso, createdBy: ctx.user!.id, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id,
    };
    devOf(ctx.db).devices.push(d);
    ctx.audit(`device ${d.code} registered: ${kind}${terminalId ? ` on ${ctx.db.terminals.find((t) => t.id === terminalId)?.code}` : ''}${d.printer ? ` (${d.printer.roles.join('+')})` : ''}`, d.id);
    event('DeviceRegistered', d.id, `${d.code} ${kind}`);
    return { status: 201, body: deviceView(ctx, d) };
  },
  'Device.Update': (ctx) => {
    const d = deviceOf(ctx, ctx.params.deviceId);
    checkVersion(d, ctx.body.expectedVersion);
    const b = ctx.body ?? {};
    const changes: string[] = [];
    if (b.name !== undefined) { const n = text(b.name, 'name', 60); if (n !== d.name) { changes.push(`name «${d.name}» → «${n}»`); d.name = n; } }
    if (b.terminalId !== undefined) {
      const t = checkHost(ctx, d.kind, b.terminalId, d.branchId, d.id);
      if (t !== d.terminalId) { const code = (id: string | null) => (id ? ctx.db.terminals.find((x) => x.id === id)?.code ?? id : 'none'); changes.push(`terminal ${code(d.terminalId)} → ${code(t)}`); d.terminalId = t; }
    }
    if (b.printer !== undefined) {
      need(d.kind === 'PRINTER', 'VALIDATION_FAILED', { field: 'printer', rule: 'printers only' });
      const next = printerSettings(ctx, b.printer, d.printer);
      if (JSON.stringify(next) !== JSON.stringify(d.printer)) { changes.push(`printer ${d.printer?.roles.join('+')}/${d.printer?.stationIds.length} stations → ${next.roles.join('+')}/${next.stationIds.length} stations, ${next.paper}, ${next.connection}${next.backup ? ', backup' : ''}`); d.printer = next; }
    }
    if (b.display !== undefined) {
      need(isDisplayKind(d.kind), 'VALIDATION_FAILED', { field: 'display', rule: 'display screens only' });
      const next = displaySettings(b.display, d.display);
      if (next.style !== d.display?.style || next.branding !== d.display?.branding) { changes.push(`display ${d.display?.style}/${d.display?.branding ? 'branding' : 'no branding'} → ${next.style}/${next.branding ? 'branding' : 'no branding'}`); d.display = next; }
    }
    if (!changes.length) return deviceView(ctx, d);
    stamp(ctx, d);
    ctx.audit(`device ${d.code}: ${changes.join('; ')}`, d.id);
    return deviceView(ctx, d);
  },
  'Device.SetEnabled': (ctx) => {
    const d = deviceOf(ctx, ctx.params.deviceId);
    checkVersion(d, ctx.body.expectedVersion);
    const enabled = ctx.body.enabled;
    need(typeof enabled === 'boolean', 'VALIDATION_FAILED', { field: 'enabled', rule: 'true | false' });
    if (enabled === d.enabled) return deviceView(ctx, d);
    const reason = enabled ? (ctx.body.reason ? String(ctx.body.reason).trim().slice(0, 200) : null) : reasonText(ctx, ctx.body.reason, 'REASON_REQUIRED');
    d.enabled = enabled;
    d.disabledReason = enabled ? null : reason;
    stamp(ctx, d);
    ctx.audit(`device ${d.code} ${enabled ? 'enabled' : 'disabled'}${reason ? `: ${reason}` : ''}`, d.id, !enabled);
    event(enabled ? 'DeviceEnabled' : 'DeviceDisabled', d.id, d.code);
    return deviceView(ctx, d);
  },
  'Device.TestPrint': (ctx) => {
    const d = deviceOf(ctx, ctx.params.deviceId);
    need(d.kind === 'PRINTER', 'VALIDATION_FAILED', { field: 'deviceId', rule: 'a printer' });
    if (!d.enabled) throw new ApiError('DEVICE_DISABLED', { deviceId: d.id }, 409);
    const j = enqueuePrint(ctx.db, { documentType: 'TEST_PAGE', documentId: d.id, copyKind: 'ORIGINAL', terminalId: d.terminalId ?? ctx.terminal?.id ?? '', createdBy: ctx.user!.id, label: `صفحة تجربة ${d.code}`, printerId: d.id, pinned: true });
    ctx.audit(`test page on ${d.code}`, d.id);
    return { status: 201, body: j };
  },
  'Display.SetPlaylist': (ctx) => {
    const d = deviceOf(ctx, ctx.params.deviceId);
    need(d.kind === 'CUSTOMER_DISPLAY', 'VALIDATION_FAILED', { field: 'deviceId', rule: 'a customer display' });
    checkVersion(d, ctx.body.expectedVersion);
    const ids: string[] = ctx.body.contentIds;
    need(Array.isArray(ids) && ids.length <= 30, 'VALIDATION_FAILED', { field: 'contentIds', rule: 'a list of at most 30 content items' });
    need(new Set(ids).size === ids.length, 'VALIDATION_FAILED', { field: 'contentIds', rule: 'each item once' });
    const all = devOf(ctx.db).content;
    for (const id of ids) {
      const c = all.find((x) => x.id === id);
      if (!c) throw new ApiError('DISPLAY_CONTENT_NOT_FOUND', { contentId: id }, 404);
      if (c.retired) throw new ApiError('DISPLAY_CONTENT_RETIRED', { contentId: id }, 409);
    }
    const before = d.display!.playlist;
    d.display = { ...d.display!, playlist: [...ids] };
    stamp(ctx, d);
    ctx.audit(`display ${d.code} playlist: ${before.length} → ${ids.length} items (${ids.join(', ') || 'empty'})`, d.id);
    return deviceView(ctx, d);
  },
  'DisplayContent.List': (ctx) => page(devOf(ctx.db).content.filter((c) => ctx.query.retired === 'true' ? true : !c.retired).map((c) => contentView(ctx, c)), ctx.query),
  'DisplayContent.Upsert': (ctx) => {
    const b = ctx.body ?? {};
    const st = devOf(ctx.db);
    const cur = b.id ? st.content.find((x) => x.id === b.id) : null;
    if (b.id) { if (!cur) throw new ApiError('DISPLAY_CONTENT_NOT_FOUND', { contentId: b.id }, 404); checkVersion(cur, b.expectedVersion); if (cur.retired) throw new ApiError('DISPLAY_CONTENT_RETIRED', { contentId: cur.id }, 409); }
    const kind = (b.kind ?? cur?.kind) as DisplayContent['kind'];
    need(['MESSAGE', 'IMAGE', 'PROMOTION', 'DISH'].includes(kind), 'VALIDATION_FAILED', { field: 'kind', allowed: ['MESSAGE', 'IMAGE', 'PROMOTION', 'DISH'] });
    need(!cur || cur.kind === kind, 'VALIDATION_FAILED', { field: 'kind', rule: 'the kind stays' });
    const title = loc(b.title ?? cur?.title, 'title', 60)!;
    const body = b.body !== undefined ? loc(b.body, 'body', 120, false) : cur?.body ?? null;
    let imageDataUrl: string | null = null, promotionId: string | null = null, productId: string | null = null;
    if (kind === 'IMAGE') {
      const v = String(b.imageDataUrl ?? cur?.imageDataUrl ?? '');
      need(/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)[;,]/i.test(v), 'VALIDATION_FAILED', { field: 'imageDataUrl', rule: 'an image (PNG, JPEG, WebP, GIF or SVG) as a data URL' });
      if (v.length > CONTENT_IMAGE_MAX) throw new ApiError('VALIDATION_FAILED', { field: 'imageDataUrl', rule: 'the picture is at most about 220 KB', size: v.length, max: CONTENT_IMAGE_MAX });
      imageDataUrl = v;
    }
    if (kind === 'PROMOTION') { promotionId = String(b.promotionId ?? cur?.promotionId ?? ''); need(ctx.db.promotions.some((p) => p.id === promotionId), 'VALIDATION_FAILED', { field: 'promotionId', rule: 'an existing promotion' }); }
    if (kind === 'DISH') { productId = String(b.productId ?? cur?.productId ?? ''); need(ctx.db.products.some((p) => p.id === productId), 'VALIDATION_FAILED', { field: 'productId', rule: 'an existing menu item' }); }
    const sch = b.schedule !== undefined ? schedule(b.schedule) : cur?.schedule ?? { ...EMPTY_SCHEDULE };
    if (cur) {
      const before = JSON.stringify({ t: cur.title, b: cur.body, s: cur.schedule, p: cur.promotionId, d: cur.productId, i: cur.imageDataUrl?.length });
      Object.assign(cur, { title, body, imageDataUrl, promotionId, productId, schedule: sch });
      if (JSON.stringify({ t: cur.title, b: cur.body, s: cur.schedule, p: cur.promotionId, d: cur.productId, i: cur.imageDataUrl?.length }) !== before) {
        stamp(ctx, cur);
        ctx.audit(`display content ${cur.id} «${cur.title.ar}» updated (schedule ${sch.from ?? '…'}–${sch.to ?? '…'} ${sch.start ?? ''}${sch.start ? '–' : ''}${sch.end ?? ''})`, cur.id);
      }
      return contentView(ctx, cur);
    }
    const c: DisplayContent = { id: nextId('dc'), kind, title, body, imageDataUrl, promotionId, productId, schedule: sch, retired: false, retiredReason: null, version: 1, createdAt: ctx.nowIso, createdBy: ctx.user!.id, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id };
    st.content.push(c);
    ctx.audit(`display content ${c.id} «${c.title.ar}» created (${kind})`, c.id);
    return { status: 201, body: contentView(ctx, c) };
  },
  'DisplayContent.Retire': (ctx) => {
    const st = devOf(ctx.db);
    const c = st.content.find((x) => x.id === ctx.params.contentId);
    if (!c) throw new ApiError('DISPLAY_CONTENT_NOT_FOUND', { contentId: ctx.params.contentId }, 404);
    checkVersion(c, ctx.body.expectedVersion);
    if (c.retired) throw new ApiError('DISPLAY_CONTENT_RETIRED', { contentId: c.id }, 409);
    const reason = reasonText(ctx, ctx.body.reason, 'REASON_REQUIRED');
    c.retired = true; c.retiredReason = reason;
    stamp(ctx, c);
    // it leaves every playlist (the playlists' own versions move: what each screen shows changed)
    const from: string[] = [];
    for (const d of st.devices) if (d.display?.playlist.includes(c.id)) { d.display = { ...d.display, playlist: d.display.playlist.filter((x) => x !== c.id) }; stamp(ctx, d); from.push(d.code); }
    ctx.audit(`display content ${c.id} «${c.title.ar}» retired: ${reason}${from.length ? ` (removed from ${from.join(', ')})` : ''}`, c.id);
    return contentView(ctx, c);
  },
  // ───────── keyboard: a terminal's own key changes, kept by the server (the device keeps a copy for a quick start)
  'Terminal.KeyMap': (ctx) => {
    const t = ctx.db.terminals.find((x) => x.id === ctx.params.terminalId);
    need(t && (!ctx.branchId || t.branchId === ctx.branchId), 'TERMINAL_NOT_FOUND');
    const k = devOf(ctx.db).keys.find((x) => x.terminalId === t!.id);
    return { terminalId: t!.id, sale: k?.sale ?? {}, kds: k?.kds ?? {}, version: k?.version ?? 0, updatedAt: k?.updatedAt ?? null, updatedByName: k ? userName(ctx.db, k.updatedBy) : null, canChange: mayChangeKeys(ctx, t!.id), changeBy: keyMapRule(t!.branchId).changeBy };
  },
  'Terminal.SetKeyMap': (ctx) => {
    const t = ctx.db.terminals.find((x) => x.id === ctx.params.terminalId);
    need(t && (!ctx.branchId || t.branchId === ctx.branchId), 'TERMINAL_NOT_FOUND');
    if (!mayChangeKeys(ctx, t!.id)) throw new ApiError('KEYMAP_CHANGE_NOT_ALLOWED', { changeBy: keyMapRule(t!.branchId).changeBy }, 403);
    const scope = ctx.body.scope;
    need(scope === 'sale' || scope === 'kds', 'VALIDATION_FAILED', { field: 'scope', allowed: ['sale', 'kds'] });
    const changes = ctx.body.changes ?? {};
    need(changes && typeof changes === 'object' && !Array.isArray(changes), 'VALIDATION_FAILED', { field: 'changes', rule: 'action → key' });
    const entries = Object.entries(changes as Record<string, unknown>);
    need(entries.length <= 40 && entries.every(([a, k]) => /^[A-Za-z]{2,24}$/.test(a) && typeof k === 'string' && k.length >= 1 && k.length <= 16), 'VALIDATION_FAILED', { field: 'changes', rule: 'an action name and a key name each' });
    need(new Set(entries.map(([, k]) => k)).size === entries.length, 'VALIDATION_FAILED', { field: 'changes', rule: 'two actions never share a key' });
    const st = devOf(ctx.db);
    let k = st.keys.find((x) => x.terminalId === t!.id);
    const current = k?.version ?? 0;
    if (ctx.body.expectedVersion !== undefined && Number(ctx.body.expectedVersion) !== current) throw new ApiError('CONCURRENCY_CONFLICT', { expected: ctx.body.expectedVersion, current });
    if (!k) { k = { terminalId: t!.id, sale: {}, kds: {}, version: 0, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id }; st.keys.push(k); }
    const before = Object.keys(k[scope as 'sale' | 'kds']).length;
    k[scope as 'sale' | 'kds'] = Object.fromEntries(entries) as Record<string, string>;
    k.version++; k.updatedAt = ctx.nowIso; k.updatedBy = ctx.user!.id;
    ctx.audit(`keys of ${t!.code} (${scope}): ${before} → ${entries.length} changes${entries.length ? ` (${entries.map(([a, key]) => `${a}=${key}`).join(', ')})` : ' — back to the profile'}`, t!.id);
    return deviceHandlers['Terminal.KeyMap'](ctx);
  },
};

/** KeyMapPolicy: MANAGERS — holders of device:manage only; ANY_SIGNED_IN — also whoever is signed in on that terminal. */
function mayChangeKeys(ctx: Ctx, terminalId: string): boolean {
  if (ctx.can('device:manage')) return true;
  const t = ctx.db.terminals.find((x) => x.id === terminalId);
  return keyMapRule(t?.branchId).changeBy === 'ANY_SIGNED_IN' && ctx.terminal?.id === terminalId;
}

export { roleOf };
