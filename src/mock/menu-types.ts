// Menu & pricing area (proposed): dayparts, channel/branch menus, sold-out-today board for options,
// bulk price changes. Stored under db.menu (optional), always read through menuState(db).
import type { Channel, Loc } from './types';
import type { Money } from './money';

/** A named time window of the day (Cairo time). end < start crosses midnight (e.g. dinner 17:00–02:00). */
export interface Daypart { id: string; name: Loc; start: string; end: string; days: number[]; color?: string; active: boolean; sortOrder: number; version: number }

/**
 * A menu = what is sellable for some channels, branches and dayparts.
 * A product is on the menu when its category is listed (or allCategories) or it is listed itself, and it is not excluded.
 * Empty branchIds = every branch; empty daypartIds = all day.
 */
export interface MenuDef {
  id: string; name: Loc; channels: Channel[]; branchIds: string[]; daypartIds: string[];
  allCategories: boolean; categoryIds: string[]; productIds: string[]; excludedProductIds: string[]; excludedCategoryIds: string[];
  active: boolean; sortOrder: number; version: number; updatedAt: string; updatedBy: string;
}

/** Sold-out for a modifier option in one branch ("خلص النهارده"). */
export interface OptionAvailability { optionId: string; groupId: string; branchId: string; state: 'AVAILABLE' | 'SOLD_OUT'; soldOutFor: string | null; reason: string | null; updatedAt: string; updatedBy: string }

export interface BulkPriceRow { productId: string; variantId: string | null; branchId: string; channel: Channel; oldAmount: Money; newAmount: Money; changePercent: string | null; ruleId?: string | null; skipped?: string | null }
export interface BulkPriceChange {
  id: string; createdAt: string; createdBy: string; effectiveFrom: number; status: 'APPLIED' | 'SCHEDULED';
  filter: { categoryIds: string[]; branchIds: string[]; channels: Channel[]; productIds: string[]; includeVariants: boolean };
  change: { mode: 'PERCENT' | 'FIXED'; value: string }; rounding: { step: string; direction: 'NEAREST' | 'UP' | 'DOWN' };
  rows: BulkPriceRow[]; note?: string; approvalGrantId?: string | null;
}

export interface MenuState { dayparts: Daypart[]; menus: MenuDef[]; optionAvailability: OptionAvailability[]; bulkChanges: BulkPriceChange[] }

/** Per-line tax portion (combo components can carry different tax groups). weight = the portion of the unit price. */
export interface LineTaxPart { taxPolicyId: string; rate: string; mode: 'EXCLUSIVE' | 'INCLUSIVE'; version: number; name: Loc; roundingMode: 'HALF_UP' | 'HALF_EVEN' | 'DOWN'; roundingScale: number; exemption?: string; weight: Money; label?: Loc }

export type ModifierLevel = 'NO' | 'LESS' | 'EXTRA';
export type HalfPlacement = 'WHOLE' | 'LEFT' | 'RIGHT';
