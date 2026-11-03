// Round 3 — venue configuration of operations (Principle 3) owned by the r3B area: kitchen screens subscribed to
// stations, the receipt / document template (logo, header, footer, paper) and the short display-number counters.
// Read through r3bOf(db) (src/mock/r3b.ts) — the field is optional on DB.

/** "ابدأ" on a kitchen screen: hidden (default), optional, or required before "جاهز". The timer always starts when the
 *  ticket arrives; pressing start only records a separate startedAt. */
export type KdsStartPolicy = 'HIDDEN' | 'OPTIONAL' | 'REQUIRED';

export interface KdsScreenConfig {
  terminalId: string;
  /** stations this screen shows; empty = every station of the branch */
  stationIds: string[];
  /** dispatch / expo screen: only these show "جاهز للتسليم" and hand the order over */
  dispatch: boolean;
  start: KdsStartPolicy;
  /** ux-04: timer colours of this screen — green below warnMinutes, amber below lateMinutes, red from lateMinutes.
   *  null/absent = the station target and the KitchenTimingPolicy alert. */
  warnMinutes?: number | null; lateMinutes?: number | null;
  /** ux-04: tapping one item marks it ready (default on); off = only the whole ticket is bumped */
  itemBump?: boolean;
  version: number; updatedAt: string; updatedBy: string;
}

export interface DocTemplate {
  /** venue logo as a data URL (PNG/JPEG/SVG/WebP), size-limited; null = no logo */
  logoDataUrl: string | null; logoName: string | null;
  /** logo width as a share of the paper width (20–100) */
  logoWidthPct: number;
  logoOnReceipt: boolean; logoOnReports: boolean;
  headerLines: string[]; footerLines: string[];
  /** thermal receipt width */
  paper: '80MM' | '58MM';
  version: number; updatedAt: string; updatedBy: string;
}

export interface R3BState {
  kdsScreens: KdsScreenConfig[];
  docTemplate: DocTemplate | null;
  /** short display number counters per branch */
  shortNo: Record<string, { businessDate: string; count: number; afterClose?: boolean }>;
}
