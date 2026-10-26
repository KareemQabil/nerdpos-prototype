import type { Handler } from '../kernel';
import { accessHandlers } from './access';
import { orgHandlers } from './org';
import { catalogHandlers } from './catalog';
import { floorHandlers } from './floor';
import { orderHandlers } from './orders';
import { kitchenHandlers } from './kitchen';
import { moneyHandlers } from './money';
import { outputHandlers } from './output';

/** Operation id → simulated handler. Operations without a handler answer CAPABILITY_NOT_AVAILABLE ("not simulated"). */
export const handlers: Record<string, Handler> = {
  ...accessHandlers,
  ...orgHandlers,
  ...catalogHandlers,
  ...floorHandlers,
  ...orderHandlers,
  ...kitchenHandlers,
  ...moneyHandlers,
  ...outputHandlers,
};
