// Reports engine public surface (layers L0–L4 + assistant). Importing this module registers the reconciliation source.
import './recon';
export { query, explain, metricList, launchDate, dimLabel, ReportRefusal, type Caller } from './engine';
export { eodBridge } from './recon';
export { compare, trend, decompose, menuMatrix, previousPeriod, CLASS_LABEL } from './analysis';
export { runManifest, catalog, venueOf } from './run';
export { MANIFESTS, manifestById } from './manifests';
export { METRICS, metricById } from './registry/metrics';
export { DIMENSIONS, dimensionById } from './registry/dimensions';
export { CHECKLIST } from './expert';
export { LEGACY_REPORTS, runLegacyReport } from './legacy';
