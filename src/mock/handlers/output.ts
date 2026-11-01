import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId } from '../store';
import { computeTotals } from '../pricing';
import { enqueuePrint, buildFiscal, issueFiscal, runOutbox } from '../outbox';
import { getOrder, need, page, requireFields, settlementOf, userName } from './util';
import type { Order, DB } from '../types';
import { docTemplateOf, secondLangOf, secondName } from '../r3b'; // round 3 r3B: receipt template, second language

function receiptView(ctx: Ctx, o: Order) {
  const db = ctx.db;
  const totals = computeTotals(o);
  const br = db.branches.find((b) => b.id === o.branchId)!;
  const fdoc = db.fiscalDocuments.find((d) => d.orderId === o.id && d.state !== 'SUPERSEDED') ?? null;
  const caps = db.captures.filter((c) => c.orderId === o.id);
  const profile = db.fiscalProfiles.find((p) => p.branchId === o.branchId);
  // round 3 (E08/E16): the immutable transaction number is always printed; the short call-out number is extra;
  // the venue template (logo, header, footer, paper); second-language names only where the item has one
  const lang2 = secondLangOf(o.branchId).receipt;
  const tpl = docTemplateOf(db);
  return {
    shortNo: o.shortNo ?? null, transactionId: o.number,
    template: { logoDataUrl: tpl.logoOnReceipt ? tpl.logoDataUrl : null, logoWidthPct: tpl.logoWidthPct, headerLines: tpl.headerLines, footerLines: tpl.footerLines, paper: tpl.paper, version: tpl.version },
    orderId: o.id, number: o.number, kind: o.kind, status: o.status, channel: o.channel, table: o.tableId ? db.tables.find((t) => t.id === o.tableId)?.name : null, checkNo: o.checkNo,
    business: { name: db.business.name, nameAr: db.business.nameAr, legalName: db.business.legalName, taxNumber: profile?.issuerId ?? null, address: profile ? `${profile.address.street} ${profile.address.buildingNumber}، ${profile.address.city}` : null },
    branch: { code: br.code, name: br.name }, server: userName(db, o.serverUserId), cashier: userName(db, caps.at(-1)?.by), completedAt: o.completedAt, businessDate: o.completedBusinessDate ?? o.businessDate,
    lines: o.lines.filter((l) => l.status === 'ACTIVE' || l.status === 'VOIDED').map((l) => ({ id: l.id, name: l.name, name2: lang2 ? secondName(l.name) : null, quantity: l.quantity, unitTotal: l.unitTotal, lineTotal: l.lineTotal, modifiers: l.modifiers.map((m) => m.name), variant: l.variant?.name ?? null, children: l.children ?? [], voided: l.status === 'VOIDED', seat: l.seat ?? null })),
    totals, payments: caps.map((c) => ({ method: c.method, amount: c.amount, tendered: c.tendered, change: c.change, reference: c.reference, walletProvider: c.walletProvider, tip: c.tip })),
    settlement: o.status === 'DRAFT' ? null : settlementOf(db, o),
    fiscal: fdoc ? { state: fdoc.state, uuid: fdoc.uuid, mode: fdoc.mode, qr: fdoc.uuid ? `https://invoicing.eta.gov.eg/receipts/search/${fdoc.uuid}` : null, issues: fdoc.issues } : null,
    serviceOffReceipt: totals.serviceCharge !== '0.0000' && !!fdoc,
  };
}

export const outputHandlers: Record<string, Handler> = {
  'Receipt.Get': (ctx) => receiptView(ctx, getOrder(ctx, ctx.params.orderId)),
  'Print.Reprint': (ctx) => {
    requireFields(ctx, 'documentType', 'documentId');
    const db = ctx.db;
    const prior = db.printJobs.filter((j) => j.documentId === ctx.body.documentId && j.documentType === ctx.body.documentType && j.copyKind === 'REPRINT').length;
    if (ctx.body.documentType === 'RECEIPT' || ctx.body.documentType === 'FISCAL_DOCUMENT') {
      ctx.requireApproval({ action: 'RECEIPT_REPRINT', targetType: 'printing.Document', targetId: ctx.body.documentId, context: { documentType: ctx.body.documentType, documentId: ctx.body.documentId, priorReprintCount: prior }, grantId: ctx.body.approvalGrantId });
    }
    const o = db.orders.find((x) => x.id === ctx.body.documentId);
    const j = enqueuePrint(db, { documentType: ctx.body.documentType, documentId: ctx.body.documentId, copyKind: 'REPRINT', terminalId: ctx.body.terminalId ?? ctx.terminal!.id, createdBy: ctx.user!.id, label: `نسخة ${o?.number ?? ctx.body.documentId}`, reason: ctx.body.reasonCode });
    ctx.audit(`reprint ${ctx.body.documentType} ${ctx.body.documentId} (copy #${prior + 1})`, ctx.body.documentId, true);
    return { status: 201, body: j };
  },
  'Print.PreBill': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (!(o.status === 'DRAFT' || o.status === 'CONFIRMED')) throw new ApiError('ORDER_NOT_EDITABLE');
    const j = enqueuePrint(ctx.db, { documentType: 'PRE_BILL', documentId: o.id, copyKind: 'ORIGINAL', terminalId: ctx.body.terminalId ?? ctx.terminal!.id, createdBy: ctx.user!.id, label: `شيك مبدئي ${o.number}` });
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, kind: 'PRE_BILL', text: { ar: 'اتطبع شيك مبدئي (ليس فاتورة ضريبية) — الشيك ما اتغيرش', en: 'pre-bill printed' } });
    return { status: 201, body: j };
  },
  'Print.Document': (ctx) => {
    requireFields(ctx, 'documentType', 'documentId');
    const prior = ctx.db.printJobs.some((j) => j.documentId === ctx.body.documentId && j.documentType === ctx.body.documentType);
    const j = enqueuePrint(ctx.db, { documentType: ctx.body.documentType, documentId: ctx.body.documentId, copyKind: prior ? 'REPRINT' : 'ORIGINAL', terminalId: ctx.body.terminalId ?? ctx.terminal!.id, createdBy: ctx.user!.id, label: ctx.body.label ?? `${ctx.body.documentType} ${ctx.body.documentId}` });
    return { status: 201, body: j };
  },
  'PrintJob.Find': (ctx) => page(ctx.db.printJobs.filter((j) => (!ctx.query.state || ctx.query.state.split(',').includes(j.state)) && (!ctx.query.terminalId || j.terminalId === ctx.query.terminalId) && (!ctx.query.documentType || j.documentType === ctx.query.documentType)).map((j) => ({ ...j, terminalCode: ctx.db.terminals.find((t) => t.id === j.terminalId)?.code })), ctx.query),
  'PrintJob.Get': (ctx) => {
    const j = ctx.db.printJobs.find((x) => x.id === ctx.params.printJobId);
    need(j, 'PRINT_JOB_NOT_FOUND');
    return j;
  },
  'PrintJob.Retry': (ctx) => {
    const j = ctx.db.printJobs.find((x) => x.id === ctx.params.printJobId);
    need(j, 'PRINT_JOB_NOT_FOUND');
    if (j!.state !== 'FAILED' && j!.state !== 'DEAD') throw new ApiError('PRINT_JOB_NOT_RETRYABLE', { state: j!.state });
    j!.state = 'PENDING';
    j!.nextAtMs = ctx.now;
    (j as any).retryFrom = j!.attempts.length; // an operator retry starts a fresh backoff cycle (docs/30 silent; listed in gaps)
    return j; // the same job, the same copy — never a new copy
  },

  // ───────── e-receipt (compliance adapter EG_ETA)
  'Compliance.Find': (ctx) => {
    const items = ctx.db.fiscalDocuments.filter((d) => d.branchId === ctx.branchId && (!ctx.query.orderId || d.orderId === ctx.query.orderId) && (!ctx.query.submission || ctx.query.submission.split(',').includes(d.state)));
    return page(items.map((d) => ({ ...d, ageHours: Number(((ctx.now - d.createdAtMs) / 3_600_000).toFixed(1)), deadlineHours: 24, alert: d.state === 'ACCEPTED' || d.state === 'SUPERSEDED' ? null : (ctx.now - d.createdAtMs) / 3_600_000 >= 20 ? 'H20' : (ctx.now - d.createdAtMs) / 3_600_000 >= 12 ? 'H12' : null })), ctx.query);
  },
  'Compliance.Get': (ctx) => {
    const d = ctx.db.fiscalDocuments.find((x) => x.id === ctx.params.documentId);
    need(d, 'FISCAL_DOCUMENT_NOT_FOUND');
    return d;
  },
  'Compliance.IssueDocument': (ctx) => {
    const o = getOrder(ctx, ctx.body.orderId);
    need(o.status === 'COMPLETED', 'VALIDATION_FAILED', { rule: 'issued from the frozen snapshot at completion' });
    const d = issueFiscal(ctx.db, o);
    need(d, 'CAPABILITY_NOT_AVAILABLE', { reason: 'FiscalDocumentPolicy OFF' });
    return d;
  },
  'Compliance.ReissueDocument': (ctx) => {
    requireFields(ctx, 'reason');
    const d = ctx.db.fiscalDocuments.find((x) => x.id === ctx.params.documentId && x.branchId === ctx.branchId);
    need(d, 'FISCAL_DOCUMENT_NOT_FOUND');
    if (d!.state === 'PENDING_DATA') {
      buildFiscal(ctx.db, d!);
      d!.history.push({ at: ctx.nowIso, by: ctx.user!.id, kind: 'REBUILD', text: `إعادة بناء بعد تصحيح البيانات: ${ctx.body.reason}` });
      queueMicrotask(() => runOutbox());
      return { document: d, result: d!.state === 'PENDING_DATA' ? 'STILL_PENDING_DATA' : 'BUILT' };
    }
    if (d!.state === 'REJECTED') {
      const o = ctx.db.orders.find((x) => x.id === d!.orderId)!;
      d!.state = 'SUPERSEDED';
      const n = issueFiscal(ctx.db, o, d!);
      d!.history.push({ at: ctx.nowIso, by: ctx.user!.id, kind: 'SUPERSEDED', text: `اتصحح بإيصال جديد ${n?.id}: ${ctx.body.reason}` });
      return { document: n, supersedes: d!.id, referenceOldUUID: d!.uuid };
    }
    throw new ApiError('VALIDATION_FAILED', { rule: 'only PENDING_DATA (rebuild) or REJECTED (correct) can be reissued', state: d!.state });
  },
  'Compliance.VerifyChain': (ctx) => {
    const out = ctx.db.fiscalDevices.map((dev) => {
      const docs = ctx.db.fiscalDocuments.filter((d) => d.deviceId === dev.id && d.sequence !== null).sort((a, b) => a.sequence! - b.sequence!);
      let ok = true; let prev: string | null = null;
      for (const d of docs) { if (d.previousUUID !== prev) ok = false; prev = d.uuid; }
      return { deviceId: dev.id, documents: docs.length, ok, head: dev.lastDocumentHash };
    });
    return { devices: out, ok: out.every((x) => x.ok) };
  },
  'FiscalSetup.Get': (ctx) => ({ profiles: ctx.db.fiscalProfiles, devices: ctx.db.fiscalDevices.map((d) => ({ ...d, terminalCode: ctx.db.terminals.find((t) => t.id === d.terminalId)?.code })), mappings: ctx.db.itemMappings }),
  'FiscalProfile.Configure': (ctx) => {
    requireFields(ctx, 'issuerId', 'issuerName', 'issuerBranchCode', 'activityCode', 'receiptType', 'address');
    need(ctx.db.branches.some((b) => b.id === ctx.params.branchId), 'ORGANIZATION_BRANCH_NOT_FOUND');
    const p = ctx.db.fiscalProfiles.find((x) => x.branchId === ctx.params.branchId);
    if (p && ctx.body.expectedVersion !== undefined && Number(ctx.body.expectedVersion) !== p.version) throw new ApiError('CONCURRENCY_CONFLICT');
    const data = { branchId: ctx.params.branchId, adapter: 'EG_ETA' as const, issuerId: ctx.body.issuerId, issuerName: ctx.body.issuerName, issuerBranchCode: ctx.body.issuerBranchCode, activityCode: ctx.body.activityCode, receiptType: ctx.body.receiptType, address: ctx.body.address, version: (p?.version ?? 0) + 1 };
    if (p) Object.assign(p, data); else ctx.db.fiscalProfiles.push(data);
    return { ok: true, profile: data };
  },
  'FiscalDevice.Register': (ctx) => {
    requireFields(ctx, 'terminalId', 'deviceSerial', 'credentialRef');
    need(ctx.db.terminals.some((t) => t.id === ctx.body.terminalId), 'ORGANIZATION_TERMINAL_NOT_FOUND');
    need(!ctx.db.fiscalDevices.some((d) => d.terminalId === ctx.body.terminalId && d.state === 'ACTIVE'), 'VALIDATION_FAILED', { rule: 'one active device per terminal' });
    need(/^secret:\/\//.test(ctx.body.credentialRef), 'VALIDATION_FAILED', { field: 'credentialRef', rule: 'names a secret (secret://...), never the secret itself' });
    const d = { id: nextId('fd'), terminalId: ctx.body.terminalId, adapter: 'EG_ETA' as const, deviceSerial: ctx.body.deviceSerial, credentialRef: ctx.body.credentialRef, state: 'ACTIVE' as const, lastSequence: 0, lastDocumentHash: null, version: 1 };
    ctx.db.fiscalDevices.push(d);
    return { ok: true, device: d };
  },
  'FiscalDevice.SetState': (ctx) => {
    const d = ctx.db.fiscalDevices.find((x) => x.id === ctx.params.deviceId);
    need(d, 'VALIDATION_FAILED', { reason: 'device not found' });
    d!.state = ctx.body.state === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
    d!.version++;
    return { ok: true, device: d };
  },
  'FiscalItemMapping.SetMany': (ctx) => {
    const rows = ctx.body.rows ?? [];
    for (const r of rows) {
      need(ctx.db.products.some((p) => p.id === r.productId), 'CATALOG_PRODUCT_NOT_FOUND', { productId: r.productId });
      need(/^[A-Z0-9-]{4,40}$/i.test(r.itemCode ?? ''), 'VALIDATION_FAILED', { productId: r.productId, field: 'itemCode' });
    }
    for (const r of rows) {
      const m = ctx.db.itemMappings.find((x) => x.productId === r.productId);
      const data = { productId: r.productId, codeType: r.codeType ?? 'EGS', itemCode: r.itemCode, unitType: r.unitType ?? 'EA' };
      if (m) Object.assign(m, data); else ctx.db.itemMappings.push(data);
    }
    return { ok: true, count: rows.length };
  },

  // ───────── reports: moved to src/mock/handlers/reports.ts (engine: src/reports/**)
};

export type { DB };
