// Round 3 (r3B): the venue's receipt / document template — logo (data URL, size-limited), header and footer lines,
// thermal paper width. Printed by the system on receipts and A4 reports (not burnt into the printer).
import { ApiError } from '../errors';
import type { Handler } from '../kernel';
import { event } from '../store';
import { checkVersion, need } from './util';
import { docTemplateOf, r3bOf, LOGO_MAX_CHARS, secondLangOf } from '../r3b';
import type { DocTemplate } from '../types-r3b';

const lines = (v: unknown, field: string): string[] => {
  if (v === undefined) return [];
  need(Array.isArray(v), 'VALIDATION_FAILED', { field, rule: 'a list of lines' });
  const out = (v as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean);
  need(out.length <= 6, 'VALIDATION_FAILED', { field, rule: 'at most 6 lines' });
  need(out.every((x) => x.length <= 64), 'VALIDATION_FAILED', { field, rule: 'a line is at most 64 characters' });
  return out;
};

export const templateHandlers: Record<string, Handler> = {
  'DocTemplate.Get': (ctx) => {
    const tpl = docTemplateOf(ctx.db);
    const br = ctx.db.branches.find((b) => b.id === ctx.branchId) ?? ctx.db.branches[0];
    return { ...tpl, business: { name: ctx.db.business.name, nameAr: ctx.db.business.nameAr ?? null }, branch: br ? { name: br.name, code: br.code } : null, secondLanguage: secondLangOf(ctx.branchId), logoMaxChars: LOGO_MAX_CHARS };
  },
  'DocTemplate.Update': (ctx) => {
    const st = r3bOf(ctx.db);
    const cur = docTemplateOf(ctx.db);
    if (st.docTemplate && ctx.body.expectedVersion !== undefined) checkVersion(st.docTemplate, ctx.body.expectedVersion);
    const b = ctx.body ?? {};
    let logo = cur.logoDataUrl;
    if (b.logoDataUrl !== undefined) {
      if (b.logoDataUrl === null || b.logoDataUrl === '') logo = null;
      else {
        const v = String(b.logoDataUrl);
        need(/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)[;,]/i.test(v), 'VALIDATION_FAILED', { field: 'logoDataUrl', rule: 'an image (PNG, JPEG, WebP, GIF or SVG) as a data URL' });
        if (v.length > LOGO_MAX_CHARS) throw new ApiError('VALIDATION_FAILED', { field: 'logoDataUrl', rule: 'the logo is at most about 200 KB', size: v.length, max: LOGO_MAX_CHARS });
        logo = v;
      }
    }
    const width = b.logoWidthPct === undefined ? cur.logoWidthPct : Number(b.logoWidthPct);
    need(Number.isFinite(width) && width >= 20 && width <= 100, 'VALIDATION_FAILED', { field: 'logoWidthPct', rule: '20..100' });
    const paper = b.paper ?? cur.paper;
    need(paper === '80MM' || paper === '58MM', 'VALIDATION_FAILED', { field: 'paper', rule: '80MM | 58MM' });
    const next: DocTemplate = {
      logoDataUrl: logo, logoName: b.logoDataUrl === undefined ? cur.logoName : logo ? String(b.logoName ?? 'logo') : null, logoWidthPct: Math.round(width),
      logoOnReceipt: b.logoOnReceipt ?? cur.logoOnReceipt, logoOnReports: b.logoOnReports ?? cur.logoOnReports,
      headerLines: b.headerLines === undefined ? cur.headerLines : lines(b.headerLines, 'headerLines'),
      footerLines: b.footerLines === undefined ? cur.footerLines : lines(b.footerLines, 'footerLines'),
      paper, version: cur.version + 1, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id,
    };
    st.docTemplate = next;
    ctx.audit(`document template v${next.version}: logo ${logo ? 'set' : 'none'}, ${next.headerLines.length} header / ${next.footerLines.length} footer lines, ${next.paper}`, 'doc-template');
    event('DocTemplateUpdated', 'doc-template', `v${next.version}`);
    return templateHandlers['DocTemplate.Get'](ctx);
  },
};
