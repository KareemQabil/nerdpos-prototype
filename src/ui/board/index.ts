// Reusable board system (ux-05): columns by state, filters, grouping, aging, drag only onto legal server transitions.
export { Board, BoardViewToggle } from './Board';
export type { BoardProps, ColumnDef, MoveCheck, FilterDef, CardAction, ColTone } from './Board';
export { heatOf, minutesSince, FRESH } from './aging';
export type { Aging, Heat } from './aging';
export { useBoardPrefs, getBoardPrefs, setBoardPrefs } from './prefs';
export type { BoardPrefs, BoardView, BoardDensity, BoardGroup } from './prefs';
