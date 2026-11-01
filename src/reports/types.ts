// Reports engine — shared types for all layers (L0 facts → L1 registry → L2 manifests → L3 analysis → L4 evidence → assistant).
// Pure TypeScript: no React, no DOM. Used by the mock server (src/mock/handlers/reports.ts), the screens and the headless tests.
import type { Loc } from '../mock/types';

export type Additivity = 'ADD' | 'SEMI_ADDITIVE' | 'WEIGHTED_RATIO' | 'NON_ADDITIVE';
export type Authority = 'CANONICAL' | 'MARKET' | 'PROPOSED';
export type Unit = 'EGP' | 'count' | '%' | 'minutes' | 'unit' | 'EGP/check' | 'EGP/guest' | 'hours';
export type FactKind =
  | 'check' | 'line' | 'payment' | 'refund' | 'drawer' | 'cash_entry' | 'removal' | 'discount' | 'comp' | 'staff_meal'
  | 'kitchen' | 'fiscal' | 'approval' | 'stock' | 'count' | 'waste' | 'po' | 'grn' | 'visit' | 'delivery' | 'history' | 'reservation' | 'recon' | 'open_check' | 'composite' | 'none';

/** L1: one certified (or candidate) metric. Data only — the evaluator lives in engine.ts and is looked up by id. */
export interface MetricDef {
  id: string;
  family: string;
  label: Loc;
  definition: Loc;            // plain words, what the number means in the restaurant
  example?: Loc;              // a worked example the expert can check by hand
  formula: string;            // the exact rule (shown under «تفاصيل تقنية»)
  grain: string;              // the fact row the metric counts
  unit: Unit;
  additivity: Additivity;
  dimensions: string[];       // the dimensions it may be broken down by (anything else is refused)
  fact: FactKind;             // the L0 fact source
  authority: Authority;
  version: string;
  history: { version: string; date: string; change: string }[];
  pitfalls: Loc[];
  status: 'AVAILABLE' | 'NOT_AVAILABLE';
  reason?: Loc;               // why NOT_AVAILABLE (never 0)
  source: string;             // research CSV / doc 27 / meeting / DESIGN
  permission?: string;        // extra permission needed beyond report:run
  numerator?: string;         // WEIGHTED_RATIO: summed numerator metric
  denominator?: string;       // WEIGHTED_RATIO: summed denominator metric
  scale?: number;             // ratio multiplier (100 for %)
  terms?: { metric: string; sign: 1 | -1 }[]; // composite (ADD across facts): e.g. net = item net − returns
  hidden?: boolean;           // helper metric (ratio part), not listed to demo users
  synonyms?: { ar: string[]; en: string[] };
}

export interface DimensionDef {
  id: string;
  label: Loc;
  type: string;
  description: Loc;
  source: string;
  priority: 'MUST' | 'SHOULD' | 'LATER';
  warning: Loc;
  status: 'AVAILABLE' | 'NOT_AVAILABLE';
  reason?: Loc;
  permission?: string; // e.g. staff-level breakdowns are for managers
}

/** L4: a pointer to an immutable source record. Every number expands into a list of these whose amounts sum to it. */
export interface EvidenceRef {
  kind: 'CHECK' | 'LINE' | 'PAYMENT' | 'REFUND' | 'CASH_ENTRY' | 'SESSION' | 'REMOVAL' | 'DISCOUNT' | 'STAFF_MEAL' | 'TICKET' | 'FISCAL' | 'APPROVAL' | 'STOCK' | 'WASTE' | 'PO' | 'GRN' | 'VISIT' | 'DELIVERY' | 'HISTORY' | 'RESERVATION' | 'RECON';
  id: string;
  orderId?: string | null;
  label: string;
  businessDate?: string | null;
  at?: string | null;
  amount?: string | null; // the share of this record in the number (money 4dp or count)
  note?: string | null;
}

/** L0: one normalised fact row. `dims` holds the dimension values the row carries; numbers live in `n`. */
export interface Fact {
  kind: FactKind;
  id: string;
  branchId: string;
  businessDate: string | null;
  recordedMs: number;          // when the server recorded it (asOf filter)
  dims: Record<string, string | null>;
  n: Record<string, string>;   // decimal strings
  key?: Record<string, string>; // distinct-count keys (order identity, visit identity…)
  ref: EvidenceRef;
}

export interface MetricValue {
  value: string | null;          // decimal string, or null when not available / not defined
  availability: 'AVAILABLE' | 'NOT_AVAILABLE' | 'NOT_DEFINED' | 'REFUSED';
  reason?: Loc;
  numerator?: string;
  denominator?: string;
  evidenceCount?: number;
  snapshotAt?: string;           // semi-additive: the instant of the snapshot
}

export interface QuerySpec {
  metrics: string[];
  dimensions?: string[];
  filters?: Record<string, string | string[] | undefined>;
  exclude?: Record<string, string | string[] | undefined>; // «ما عدا»: drop facts whose dimension value is listed
  from: string;
  to?: string;
  branchIds?: string[];
  asOf?: string;
  limit?: number;
  sort?: { metric: string; dir: 'asc' | 'desc' };
}

export type DayStatus = 'CLOSED' | 'ENDED_NOT_CLOSED' | 'OPEN' | 'FUTURE';
export interface QueryMeta {
  from: string; to: string; branchIds: string[]; timezone: 'Africa/Cairo'; cutoff: string; asOf: string;
  days: { date: string; status: DayStatus; source: 'EVENTS' | 'HISTORY' | 'NONE' }[];
  provisional: boolean; provisionalReasons: Loc[];
  metrics: { id: string; label: Loc; version: string; definition: Loc; unit: Unit; additivity: Additivity; authority: Authority; status: string }[];
  refused: { metric: string; dimension?: string; reason: Loc }[];
  notAvailable: { metric: string; reason: Loc }[];
  weekStart: 'SATURDAY' | 'SUNDAY' | 'MONDAY';
  filters: Record<string, string | string[] | undefined>;
}
export interface QueryRow { key: string; dims: Record<string, string | null>; labels: Record<string, Loc>; values: Record<string, MetricValue>; source?: 'EVENTS' | 'HISTORY' }
export interface QueryResult { meta: QueryMeta; dimensions: string[]; metrics: string[]; rows: QueryRow[]; totals: Record<string, MetricValue> }

export interface ReconCheck {
  id: string; title: Loc; equation: string; expected: string; actual: string; difference: string;
  status: 'MATCHED' | 'EXPLAINED' | 'UNEXPLAINED' | 'NOT_RUN';
  explanations: { label: Loc; amount: string; evidence: EvidenceRef[] }[];
  note?: Loc;
}
