// Kitchen routing per combo component: each component of a meal goes to the station of its own product
// (e.g. the sandwich and fries to the grill, the drink to the bar). The meal's own modifiers stay with its own station.
import type { KitchenTicketItem, OrderLine, RoutingRule } from './types';

export interface ComboPart { idx: number[]; main: boolean }
type RuleFor = (productId: string | undefined, categoryId: string | undefined) => RoutingRule | undefined;

/** Routes a combo line by component. Returns false when the line has no combo components (normal routing applies). */
export function comboRoute(line: OrderLine, mainRule: RoutingRule | undefined, ruleFor: RuleFor, byStation: Map<string, string[]>, parts: Map<string, ComboPart>): boolean {
  const comps = (line.children ?? []).map((c, i) => ({ c, i })).filter((x) => x.c.kind === 'COMBO_SLOT' && x.c.productId);
  if (!comps.length) return false;
  const mainStation = mainRule && mainRule.destination === 'STATION' ? mainRule.stationId : null;
  const assign = new Map<string, number[]>();
  const push = (st: string, i: number) => assign.set(st, [...(assign.get(st) ?? []), i]);
  for (const { c, i } of comps) {
    const r = ruleFor(c.productId, c.categoryId);
    if (!r) { if (mainStation) push(mainStation, i); continue; }
    if (r.destination === 'NO_TICKET') continue;
    push(r.stationId, i);
  }
  if (mainStation && !assign.has(mainStation) && (line.modifiers.length || line.variant)) assign.set(mainStation, []);
  for (const [st, idx] of assign) {
    if (!(byStation.get(st) ?? []).includes(line.id)) byStation.set(st, [...(byStation.get(st) ?? []), line.id]);
    parts.set(`${st}|${line.id}`, { idx, main: st === mainStation || !mainStation });
  }
  return true;
}

const childText = (c: NonNullable<OrderLine['children']>[number]) => `${c.name.ar}${c.detail ? ' (' + c.detail.ar + ')' : ''}`;

/** One ticket item for a line at a station; a combo shows only the components routed there. */
export function kitchenItem(l: OrderLine, stationId: string, parts?: Map<string, ComboPart>): KitchenTicketItem {
  const part = parts?.get(`${stationId}|${l.id}`);
  const mods = [...(l.variant ? [l.variant.name] : []), ...l.modifiers.map((m) => m.name)];
  return {
    lineId: l.id, name: l.name, quantity: l.quantity,
    modifiers: !part || part.main ? mods : [],
    note: l.note, status: l.status === 'VOIDED' ? 'CANCELLED' : 'ACTIVE', allergens: l.allergens,
    children: part ? part.idx.map((i) => childText(l.children![i])) : l.children?.map(childText),
    seat: l.seat ?? null,
  };
}
