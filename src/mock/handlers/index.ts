import type { Handler } from '../kernel';
import { opsHandlers, gateByCapability } from './ops'; // operations & system area
import { reportHandlers } from './reports';
import { reportStudioHandlers } from './report-studio'; // reports engine (src/reports/**): Report.* incl. Export/Schedule
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
import { reversalHandlers } from './reversals'; // r3A: removal trace, void review, staff-meal allowance & cancel
import { salesChannelHandlers } from './channels-sales'; // sales channels (E13)
import { templateHandlers } from './templates'; // round 3 r3B: receipt / document template
import { displayHandlers } from './displays'; // ux-04: customer display read model

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
  ...reversalHandlers,
  ...salesChannelHandlers,
  ...templateHandlers,
  ...displayHandlers,
};

// operations & system area (ops.ts): its handlers, then the capability gate around every handler
// (an operation whose product capability is switched off answers CAPABILITY_NOT_AVAILABLE).
Object.assign(handlers, opsHandlers);
Object.assign(handlers, reportHandlers);
Object.assign(handlers, reportStudioHandlers); // round 4 report studio: pivot, saved reports, templates, audit, schedule outputs // reports engine owns Report.* (overrides ops.ts Report.Export/Schedule)
Object.assign(handlers, gateByCapability(handlers));
