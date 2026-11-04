// ux-14: the device registry (PROPOSED, owner module: organization — the peripherals and display screens attached to its
// terminals) and the display content library. Printing keeps PrintJob and reads the printer of a job through the
// registry; display screens read their own settings and the content assigned to them. Read through devOf(db).
import type { Loc } from './types';

export type DeviceKind = 'PRINTER' | 'CASH_DRAWER' | 'SCANNER' | 'CUSTOMER_DISPLAY' | 'CALL_BOARD';
/** What a printer prints: customer receipts and pre-bills, kitchen tickets of its stations, shift reports (X / Z). */
export type PrintRole = 'RECEIPT' | 'KITCHEN' | 'REPORT';
export interface PrinterSettings {
  roles: PrintRole[];
  /** kitchen stations whose tickets this printer prints (role KITCHEN) */
  stationIds: string[];
  paper: '80MM' | '58MM';
  connection: 'USB' | 'NETWORK' | 'BLUETOOTH';
  /** network address (NETWORK) — never a secret */
  address: string | null;
  /** the branch's backup printer (PrintRoutingPolicy.fallback BRANCH_BACKUP) */
  backup: boolean;
}
export interface DisplaySettings {
  /** 'theme' = the app colours, 'display' = high contrast */
  style: 'theme' | 'display';
  /** the venue's logo / name strip */
  branding: boolean;
  /** customer display only: the content shown while idle, in order (DisplayContent ids) */
  playlist: string[];
}
export interface Device {
  id: string; code: string; name: string; kind: DeviceKind; branchId: string;
  /** the terminal it is attached to (a network printer may have none) */
  terminalId: string | null;
  enabled: boolean;
  printer?: PrinterSettings;
  display?: DisplaySettings;
  /** last time the device answered: a printed job (printer) or a read of its screen (display) — telemetry, not business truth */
  lastSeenAt: string | null;
  disabledReason?: string | null;
  version: number; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
}

export type ContentKind = 'MESSAGE' | 'IMAGE' | 'PROMOTION' | 'DISH';
export interface ContentSchedule {
  /** first and last day (YYYY-MM-DD, branch local) — null = open */
  from: string | null; to: string | null;
  /** daily window (HH:MM, branch local) — null = all day; end before start = over midnight */
  start: string | null; end: string | null;
  /** weekdays 0 (Sunday) .. 6; empty = every day */
  days: number[];
}
export interface DisplayContent {
  id: string; kind: ContentKind; title: Loc; body: Loc | null;
  /** IMAGE: a picture (data URL, size-limited) */
  imageDataUrl: string | null;
  /** PROMOTION: the promotion whose name and benefit the server shows; DISH: the menu item whose name and picture it shows */
  promotionId: string | null; productId: string | null;
  schedule: ContentSchedule;
  /** retired content stays for history and is never shown */
  retired: boolean; retiredReason: string | null;
  version: number; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
}

/** A terminal's own keyboard changes (action → key) over its work profile's map, per scope. */
export interface TerminalKeys { terminalId: string; sale: Record<string, string>; kds: Record<string, string>; version: number; updatedAt: string; updatedBy: string }

export interface DevState { devices: Device[]; content: DisplayContent[]; keys: TerminalKeys[] }
