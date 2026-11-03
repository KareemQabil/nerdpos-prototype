// Round 3 (r3B) seed: two kitchen screens (the grill station screen and the dispatch / expo screen), the venue's
// receipt template (a sample logo, header and footer lines). Called once from buildSeed.
import type { DB } from './types';
import { r3bOf } from './r3b';

/** Sample venue logo (SVG data URL) — the manager replaces it from «قوالب الإيصال والتقارير». */
export const SAMPLE_LOGO = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 96"><rect x="2" y="2" width="236" height="92" rx="18" fill="none" stroke="#111" stroke-width="4"/>' +
  '<path d="M48 70c-14 0-22-10-22-21 0-12 9-17 12-27 6 7 4 13 9 17 2-7 6-12 12-16-2 9 4 14 6 20 2 6 4 9 4 13 0 9-8 14-21 14z" fill="#111"/>' +
  '<text x="150" y="46" font-family="Tahoma, Arial, sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#111">الحاج سامي</text>' +
  '<text x="150" y="76" font-family="Tahoma, Arial, sans-serif" font-size="17" text-anchor="middle" fill="#111">للمشويات · مدينة نصر</text></svg>');

export function seedR3B(db: DB, nowMs: number) {
  const nowIso = new Date(nowMs).toISOString();
  const kds = db.terminals.find((t) => t.id === 't_kds');
  if (!kds) return; // "start from zero" has no terminals
  kds.name = 'شاشة المطبخ 1 — التسليم (كل المحطات)';
  if (!db.terminals.some((t) => t.id === 't_kds2')) db.terminals.push({ id: 't_kds2', code: 'DEMO-KDS-2', name: 'شاشة المشويات', branchId: 'branch_main', drawer: false, lifecycle: 'ACTIVE', purpose: 'grill station screen', kind: 'KDS', version: 1 });
  const r = r3bOf(db);
  const grill = db.stations.find((s) => s.id === 'st_grill');
  r.kdsScreens = [
    { terminalId: 't_kds', stationIds: [], dispatch: true, start: 'HIDDEN', version: 1, updatedAt: nowIso, updatedBy: 'provisioning' },
    { terminalId: 't_kds2', stationIds: grill ? [grill.id] : [], dispatch: false, start: 'OPTIONAL', warnMinutes: 8, lateMinutes: 15, itemBump: true, version: 1, updatedAt: nowIso, updatedBy: 'provisioning' }, // ux-04: its own timer colours
  ];
  r.docTemplate = {
    logoDataUrl: SAMPLE_LOGO, logoName: 'logo-sample.svg', logoWidthPct: 60, logoOnReceipt: true, logoOnReports: true,
    headerLines: ['12 شارع عباس العقاد — مدينة نصر', 'تليفون 0222700000 · واتساب 01000000000'],
    footerLines: ['شكرًا لزيارتكم — نتمنى نشوفك تاني', 'الأسعار شاملة الضريبة حسب الإيصال'],
    paper: '80MM', version: 1, updatedAt: nowIso, updatedBy: 'provisioning',
  };
}
