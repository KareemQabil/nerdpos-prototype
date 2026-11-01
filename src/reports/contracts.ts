// Proposed reporting operations (not in operations.json): the layered engine exposed as read-only queries.
import type { OperationDef } from '../mock/contracts';

const Q = (id: string, path: string, note: string, input: OperationDef['input'] = {}, errors: string[] = []): OperationDef => ({ id, module: 'reporting', kind: 'QRY', method: 'GET', path, permission: 'report:run', input, output: id.replace('.', '') + 'View', errors: ['VALIDATION_FAILED', 'REPORT_SCOPE_DENIED', ...errors], approval: null, backend_state: 'PROPOSED', note });

export const REPORT_PROPOSED_OPERATIONS: OperationDef[] = [
  Q('Report.Query', '/reports/query', 'L1/L3: any registered metrics × dimensions × filters × period → rows + totals + meta (refused / not available listed, never 0)', { q: { type: 'JSON<QuerySpec>', required: true } }, ['METRIC_NOT_FOUND']),
  Q('Report.Explain', '/reports/explain', 'L4: the source records (checks, lines, payments, refunds, drawer entries…) behind one number, with the proof that they add up to it', { q: { type: 'JSON<ExplainSpec>', required: true } }, ['METRIC_NOT_FOUND']),
  Q('Report.Bridge', '/reports/bridge', 'EOD money bridge: gross → discounts → net → service → VAT → billed vs collected/refunded, drawers; every difference explained by linked events', { fromBusinessDate: { type: 'BusinessDate', required: true }, toBusinessDate: { type: 'BusinessDate', required: false } }),
  Q('Report.Analyze', '/reports/analyze', 'L3: compare periods, trend, decompose (volume × price × mix + unexplained), menu matrix', { q: { type: 'JSON<AnalyzeSpec>', required: true } }),
  Q('Report.Ask', '/reports/ask', 'Rule-based assistant: Egyptian-Arabic / English question → parsed query over the registry → structured answer with chips; one clarifying question when ambiguous; refuses to invent', { question: { type: 'Text', required: true }, clarify: { type: 'Text', required: false } }),
  Q('Metric.List', '/reports/metrics', 'L1 registry: metrics and dimensions with definitions, formula, grain, additivity, authority, version, availability'),
  Q('Report.Catalog', '/reports/catalog', 'The layers with counts and status (facts → metrics → reports → analysis → evidence → assistant)'),
];
