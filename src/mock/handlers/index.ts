import type { Handler } from '../kernel';
import { opsHandlers, gateByCapability } from './ops'; // operations & system area
import { accessHandlers } from './access';
import { orgHandlers } from './org';
import { catalogHandlers } from './catalog';
import { floorHandlers } from './floor';
import { orderHandlers } from './orders';
import { kitchenHandlers } from './kitchen';
import { moneyHandlers } from './money';
import { outputHandlers } from './output';
import { customerHandlers } from './customers';
import { deliveryHandlers } from './delivery';
import { loyaltyHandlers } from './loyalty';
import { channelHandlers } from './channels';
import { extPayHandlers } from './extpay';
import { menuHandlers } from '../menu-handlers'; // menu & pricing area (proposed ops)
import { inventoryHandlers } from './inventory'; // inventory & purchasing area

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
  ...customerHandlers, ...deliveryHandlers, ...loyaltyHandlers, ...channelHandlers, ...extPayHandlers, // crm area
  ...menuHandlers,
  ...inventoryHandlers,
};

// operations & system area (ops.ts): its handlers, then the capability gate around every handler
// (an operation whose product capability is switched off answers CAPABILITY_NOT_AVAILABLE).
Object.assign(handlers, opsHandlers);
Object.assign(handlers, gateByCapability(handlers));
