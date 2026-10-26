// Builds the initial mock database from data/demo-provisioning-1.2.json and rules/EG.profile.json.
import { seed, egProfile } from './contracts';
import { POLICIES, startingValue } from './policyRegistry';
import type { DB, Product, PriceRule, Channel, PolicyValue, ReasonCode } from './types';
import { m4 } from './money';
import { seedOps } from './seed-ops';
import { seedMenu } from './seed-menu';
import { seedCrm, CRM_EMPTY } from './seed-crm';
import { personaDisplayName } from '../demo/people'; // friendly demo names (displayName only)

import { seedInventory } from './seed-inventory';
export const DEMO_PIN = '123456';
export const DEMO_PASSWORD = 'demo-password-1';

/** Arabic display names for seeded branches and terminals (ids and codes unchanged). */
const DISPLAY_NAME_AR: Record<string, string> = {
  branch_main: 'الفرع الرئيسي — مدينة نصر', branch_second: 'الفرع التاني — المعادي',
  t_floor: 'تابلت الويتر 1 (من غير درج)', t_cash: 'جهاز الكاشير 1 (عليه درج)', t_kds: 'شاشة المطبخ 1', t_admin: 'كمبيوتر المدير', t_second_floor: 'تابلت ويتر الفرع التاني (من غير درج)',
};
const KIND: Record<string, 'FLOOR' | 'CASH' | 'KDS' | 'ADMIN'> = { t_floor: 'FLOOR', t_cash: 'CASH', t_kds: 'KDS', t_admin: 'ADMIN', t_second_floor: 'FLOOR' };

export function buildSeed(nowMs: number): DB {
  const nowIso = new Date(nowMs).toISOString();
  const startOfPrices = nowMs - 30 * 86_400_000; // provisioning time: 30 days ago
  const db: DB = {
    schema: 4,
    seq: {},
    business: { id: 'biz', name: seed.business.name, nameAr: 'مطعم الحاج سامي للمشويات', legalName: seed.business.legalName, currency: 'EGP', version: 1 },
    branches: seed.branches.map((b: any) => ({ id: b.key, code: b.code, name: DISPLAY_NAME_AR[b.key] ?? b.name, timezone: b.timezone, businessDayCutoff: b.businessDayCutoff, active: b.active, version: 1 })),
    terminals: seed.terminals.map((t: any) => ({ id: t.key, code: t.code, name: DISPLAY_NAME_AR[t.key] ?? t.name, branchId: t.branch, drawer: t.drawer, lifecycle: t.lifecycle, purpose: t.purpose, kind: KIND[t.key] ?? 'FLOOR', version: 1 })),
    roles: [
      ...seed.roles.map((r: any) => ({ id: r.key, name: r.name, permissionIds: [...r.permissionIds], active: true, version: 1 })),
    ],
    users: seed.users.map((u: any) => ({
      id: u.key, username: u.username, displayName: personaDisplayName(u.username), active: true, version: 1, pin: DEMO_PIN, password: DEMO_PASSWORD,
      roleAssignments: [{ roleId: u.role, branchIds: [u.branch] }], failedAttempts: 0, lockedUntil: null, credentialVersion: 1, mustChangeCredentials: false,
    })),
    authSessions: [],
    units: seed.units.map((u: any) => ({ id: u.key, code: u.code, precision: u.precision, active: true, used: true, version: 1 })),
    categories: seed.categories.map((c: any, i: number) => ({ id: c.key, name: c.name, active: c.active, sortOrder: (i + 1) * 10, version: 1 })),
    modifierGroups: seed.modifier_groups.map((g: any) => ({
      id: g.key, name: g.name, selectionRule: g.selectionRule, min: g.min, max: g.max, active: g.active, version: 1,
      options: g.options.map((o: any) => ({ id: o.key, name: { en: o.name, ar: OPTION_AR[o.key] ?? o.name }, priceDelta: m4(o.priceDelta), active: true, version: 1 })),
    })),
    products: seed.products.map((p: any): Product => ({
      id: p.key, sku: p.sku, name: p.name, categoryId: p.category, unitId: 'unit_ea', taxPolicyId: 'tax_demo', modifierGroupIds: [...p.modifier_groups],
      active: true, version: 1, createdAt: nowIso, createdBranchId: 'branch_main', colorCode: COLORS[p.category], allergens: ALLERGENS[p.key],
    })),
    availability: [],
    priceRules: [],
    taxPolicies: seed.tax_policies.map((t: any) => ({
      id: t.key, name: t.name, jurisdiction: t.jurisdiction, rate: t.rate, calculationMode: t.calculationMode, roundingMode: t.roundingMode, roundingScale: t.roundingScale,
      active: true, version: 1, history: [{ at: nowIso, by: 'provisioning', change: 'created from demo-provisioning 1.2.0' }], exemption: 'NONE', fiscalTaxType: null, fiscalSubtype: null,
    })),
    tables: seed.tables.items.map((t: any) => ({ id: t.key, branchId: t.branch ?? seed.tables.defaults.branch, name: t.name, area: t.area, capacity: t.capacity, active: true, version: 1 })),
    visits: [],
    orders: [],
    stations: seed.kitchen_stations.map((s: any) => ({ id: s.key, branchId: s.branch, name: s.name, active: s.active, version: 1 })),
    routingRules: seed.routing_rules.items.map((r: any) => ({
      id: r.key, branchId: 'branch_main', priority: r.priority, match: Object.fromEntries(Object.entries(r.match).map(([k, v]) => [k, v])), stationId: r.station, destination: 'STATION', active: true, version: 1,
    })),
    tickets: [],
    kitchenDeliveries: [],
    sessions: [],
    cashEntries: [],
    captures: [],
    refunds: [],
    grants: [],
    reasonCodes: [],
    policyValues: [],
    policyHistory: [],
    printJobs: [],
    fiscalProfiles: [],
    fiscalDevices: [],
    itemMappings: [],
    fiscalDocuments: [],
    promotions: [],
    audit: [],
    idem: {},
    alerts: [],
    deposits: [],
    reservations: [],
    tips: [],
    events: [],
  };

  // Prototype additions to the demo roles (listed in PROTOTYPE_GAPS.md and highlighted in A2):
  // demo-provisioning 1.2 roles were written for the J-R scripts only; the prototype lets experts try every screen.
  for (const r of db.roles) {
    const add = DEMO_ROLE_ADDITIONS[r.id] ?? [];
    (r as any).demoAdded = add.filter((p) => !r.permissionIds.includes(p));
    r.permissionIds = [...new Set([...r.permissionIds, ...add])];
  }
  db.roles.push({ id: 'role_owner', name: 'Demo Owner', permissionIds: ['*'], active: true, version: 1, demoAdded: ['*'] } as any);
  db.users.push({ id: 'u_owner', username: 'demo-owner', displayName: personaDisplayName('demo-owner'), active: true, version: 1, pin: DEMO_PIN, password: DEMO_PASSWORD, roleAssignments: [{ roleId: 'role_owner', branchIds: ['*'] }], failedAttempts: 0, lockedUntil: null, credentialVersion: 1, mustChangeCredentials: false });

  // Availability: seed product availability per branch (Kunafa SOLD_OUT).
  for (const p of seed.products) {
    db.availability.push({ productId: p.key, branchId: 'branch_main', state: p.availability ?? 'AVAILABLE', reason: p.availability === 'SOLD_OUT' ? 'خلصت النهارده' : null, updatedAt: nowIso, updatedBy: 'provisioning' });
  }
  // Prices: demo price list (branch_second sells nothing → PRICE_NOT_FOUND, N9).
  let n = 0;
  for (const r of seed.price_rules.items) {
    db.priceRules.push({ id: `pr_${++n}`, productId: r.product, branchId: r.branch, channel: r.channel as Channel, amount: m4(r.amount), currency: 'EGP', effectiveFrom: startOfPrices, effectiveTo: null, createdAt: new Date(startOfPrices).toISOString(), createdBy: 'provisioning', version: 1, replacesRuleId: null });
  }

  // Reason codes: demo 1.2 codes + EG profile owner data (codes not already present).
  const rc: ReasonCode[] = [];
  let r = 0;
  for (const c of seed.reason_codes.items) rc.push({ id: `rc_${++r}`, kind: c.kind, code: c.code, label: c.label, requiresNote: c.requiresNote, sortOrder: c.sortOrder, active: c.active, version: 1 });
  const egCodes = egProfile.owner_data.find((d) => d.id === 'EG-REASON-CODES')?.data.codes ?? [];
  for (const c of egCodes) {
    if (rc.some((x) => x.kind === c.kind && x.code === c.code)) continue;
    rc.push({ id: `rc_${++r}`, kind: c.kind, code: c.code, label: c.label, requiresNote: c.requiresNote, sortOrder: 100 + r, active: true, version: 1 });
  }
  // Reprint reasons (PRN-GAP-06 proposal)
  rc.push({ id: `rc_${++r}`, kind: 'REPRINT', code: 'CUSTOMER_ASKED', label: { en: 'Customer asked', ar: 'العميل طلب' }, requiresNote: false, sortOrder: 10, active: true, version: 1 });
  rc.push({ id: `rc_${++r}`, kind: 'REPRINT', code: 'PAPER_JAM', label: { en: 'Paper jam', ar: 'الورق علّق' }, requiresNote: false, sortOrder: 20, active: true, version: 1 });
  db.reasonCodes = rc;

  // Policy values: every registered policy at TENANT with its starting value (EG profile, else canonical),
  // then the demo provisioning branch-scoped values.
  const pv: PolicyValue[] = [];
  let p = 0;
  for (const meta of POLICIES) {
    const v = startingValue(meta);
    if (v === null || v === undefined || meta.editor.kind === 'readonly') continue;
    pv.push({ id: `pv_${++p}`, policyId: meta.id, scopeType: 'TENANT', scopeId: 'biz', value: structuredClone(v), version: 1, updatedAt: nowIso, updatedBy: 'provisioning', source: meta.egValue !== undefined ? 'EG.profile 1.4.0' : 'canonical default' });
  }
  for (const item of seed.policy_values.items) {
    if (item.scopeType !== 'BRANCH') continue;
    pv.push({ id: `pv_${++p}`, policyId: item.policyId, scopeType: 'BRANCH', scopeId: item.scope, value: structuredClone(item.value), version: 1, updatedAt: nowIso, updatedBy: 'provisioning', source: 'demo-provisioning 1.2.0' });
  }
  db.policyValues = pv;

  // Direction demo (مقترح): a "product direction" category with sizes, half-and-half, a combo and a table-tax item.
  addDirectionCatalog(db, startOfPrices);
  seedMenu(db, nowMs); // menu & pricing area: dayparts, menus, combos, sizes, half-and-half (seed-menu.ts)

  // E-receipt starting point: profile and device exist for the main branch cashier terminal; item codes missing for
  // a few products, so the queue shows PENDING_DATA until the manager maps them (G3/G4).
  db.fiscalProfiles.push({ branchId: 'branch_main', adapter: 'EG_ETA', issuerId: 'DEMO-RIN-000000000', issuerName: 'NerdPOS Demo Restaurant (DEMO)', issuerBranchCode: '0', activityCode: '5610', receiptType: 'SC', address: { governate: 'Cairo', city: 'Nasr City', street: 'Demo St.', buildingNumber: '1' }, version: 1 });
  db.fiscalDevices.push({ id: 'fd_1', terminalId: 't_cash', adapter: 'EG_ETA', deviceSerial: 'DEMO-POS-0001', credentialRef: 'secret://eta/demo-pos-0001', state: 'ACTIVE', lastSequence: 0, lastDocumentHash: null, version: 1 });
  const mapped = ['p_tea', 'p_turkish_coffee', 'p_espresso', 'p_orange_juice', 'p_lemon_mint', 'p_hummus', 'p_baba_ghanoush', 'p_green_salad', 'p_chicken_shawarma', 'p_kofta', 'p_mixed_grill', 'p_beef_burger'];
  mapped.forEach((pid, i) => db.itemMappings.push({ productId: pid, codeType: 'EGS', itemCode: `EG-DEMO-${String(i + 1).padStart(4, '0')}`, unitType: 'EA' }));

  // A demo happy-hour promotion (B6) and a coded promotion.
  db.promotions.push({ id: 'promo_1', name: { ar: 'هابي أور مشروبات باردة 20%', en: 'Happy hour cold drinks 20%' }, kind: 'AUTOMATIC', code: null, benefitType: 'PERCENTAGE', benefitValue: '20', branchIds: ['branch_main'], channels: ['DINE_IN', 'TAKEAWAY'], minSubtotal: null, schedule: { days: [0, 1, 2, 3, 4, 5, 6], start: '15:00', end: '18:00' }, validFrom: null, validTo: null, active: true, version: 1 });
  db.promotions.push({ id: 'promo_2', name: { ar: 'كود ترحيب 50 جنيه', en: 'Welcome code 50 EGP' }, kind: 'CODED', code: 'WELCOME50', benefitType: 'FIXED_AMOUNT', benefitValue: '50', branchIds: ['branch_main'], channels: ['DINE_IN', 'TAKEAWAY'], minSubtotal: m4('300'), schedule: null, validFrom: null, validTo: null, active: true, version: 1 });

  seedCrm(db, nowMs); // customers, delivery, loyalty, online orders (seed-crm.ts)
  seedOps(db, nowMs); // operations & system area: floor plans, history, reconciliation, webhooks, schedules
  seedInventory(db, nowMs); // inventory & purchasing area: warehouses, items, recipes, suppliers, history (seed-inventory.ts)
  db.events.push({ id: 'ev_0', at: nowIso, type: 'Provisioned', ref: 'biz', text: 'demo-provisioning 1.2.0 + EG.profile 1.4.0 applied' });
  return db;
}

export const DEMO_ROLE_ADDITIONS: Record<string, string[]> = {
  role_waiter: ['order:cancel', 'settings:read', 'print:read', 'order:changechannel', 'order:updatedetails', 'order:setcustomer', 'customer:pii:read', 'customer:create', 'customer:update', 'customeraddress:upsert', 'loyalty:read' /* crm area */],
  role_cashier: ['product:setavailability', 'order:changechannel', 'order:updatedetails', 'order:setcustomer', 'order:removediscount', 'order:create', 'order:addlines', 'order:updateline', 'order:removeline', 'order:fire', 'order:cancel', 'order:applydiscount', 'order:comp', 'cash:move', 'drawer:opennosale', 'print:reprint', 'print:retry', 'print:read', 'settings:read', 'report:run', 'kitchen:read', 'compliance:read', 'customer:pii:read', 'customer:create', 'customer:update', 'customeraddress:upsert', 'loyalty:read', 'delivery:read', 'delivery:create', 'delivery:assign', 'delivery:dispatch', 'delivery:complete', 'delivery:failattempt', 'delivery:cancel', 'delivery:settlecash', 'channel:manage', 'channel:ingest' /* crm area */],
  role_manager: ['order:changechannel', 'order:updatedetails', 'order:setcustomer', 'order:removediscount', 'tax:read', 'settings:read', 'order:create', 'order:addlines', 'order:updateline', 'order:removeline', 'order:fire', 'order:cancel', 'order:applydiscount', 'order:comp', 'payment:capture', 'session:open', 'session:close', 'drawer:opennosale', 'print:reprint', 'print:retry', 'print:read', 'compliance:read', 'compliance:issuedocument', 'user:read', 'user:create', 'user:manageaccess', 'role:read', 'role:create', 'role:update', 'credential:reset', 'approve:order_discount', 'approve:order_comp', 'approve:price_change', 'approve:product_tax_change', 'approve:receipt_reprint', 'approve:credential_reset', 'approve:user_access_change', 'approve:drawer_no_sale', 'approve:tender_correction', 'approve:price_override', 'payment:correcttender', 'business:read', 'branch:read', 'terminal:read', 'audit:read', 'approval:read', 'kitchen:advanceticket', 'customer:pii:read', 'customer:create', 'customer:update', 'customeraddress:upsert', 'loyalty:read', 'loyalty:adjust', 'loyalty:configure', 'delivery:read', 'delivery:create', 'delivery:assign', 'delivery:dispatch', 'delivery:complete', 'delivery:failattempt', 'delivery:cancel', 'delivery:settlecash', 'delivery:configure', 'channel:manage', 'channel:ingest', 'approve:loyalty_adjust', 'approve:delivery_cancel', 'approve:driver_cash_variance' /* crm area */, 'inventory:read', 'warehouse:configure', 'warehouse:setsalesdefault', 'inventoryitem:configure', 'inventory:adjust', 'stock:count', 'stockcount:start', 'stockcount:recordobservations', 'stockcount:submit', 'stockcount:cancel', 'stock:transfer', 'transfer:create', 'transfer:receive', 'transfer:cancel', 'stock:recordwaste', 'stock:recordreturn', 'recipe:define', 'recipe:read', 'production:post', 'supplier:upsert', 'purchasing:read', 'purchaseorder:create', 'purchaseorder:update', 'purchaseorder:issue', 'purchaseorder:close', 'purchaseorder:cancel', 'goodsreceipt:post', 'goodsreceipt:reverse', 'supplierreturn:post', 'approve:inventory_adjust', 'approve:stock_count_post', 'approve:stock_waste' /* inventory area */],
  role_chef: ['catalog:read', 'product:setavailability', 'inventory:read', 'recipe:read', 'stockcount:recordobservations', 'stock:recordwaste', 'production:post', 'transfer:receive' /* inventory area */, 'print:read', 'settings:read'],
};

const OPTION_AR: Record<string, string> = { opt_size_regular: 'عادي', opt_size_large: 'كبير', opt_medium: 'ميديم', opt_well: 'مستوي كويس', opt_cheese: 'جبنة زيادة', opt_egg: 'بيضة', opt_hot_sauce: 'صوص حار' };
const COLORS: Record<string, string> = { cat_hot: '#f59e0b', cat_cold: '#22d3ee', cat_starters: '#10b981', cat_mains: '#ef4444', cat_desserts: '#ec4899', cat_direction: '#a855f7' };
const ALLERGENS: Record<string, string[]> = { p_hummus: ['SESAME'], p_baba_ghanoush: ['SESAME'], p_beef_burger: ['GLUTEN', 'DAIRY'], p_om_ali: ['GLUTEN', 'DAIRY', 'NUTS'], p_kunafa: ['GLUTEN', 'DAIRY', 'NUTS'], p_chicken_shawarma: ['GLUTEN'] };

function addDirectionCatalog(db: DB, from: number) {
  db.categories.push({ id: 'cat_direction', name: { ar: 'اتجاه المنتج (مقترح)', en: 'Product direction (proposed)' }, active: true, sortOrder: 99, version: 1, colorCode: '#a855f7' });
  db.modifierGroups.push({ id: 'mod_side_sauce', name: { ar: 'صوص البطاطس', en: 'Side sauce' }, selectionRule: 'SINGLE', min: 1, max: 1, active: true, version: 1, options: [
    { id: 'opt_ketchup', name: { ar: 'كاتشب', en: 'Ketchup' }, priceDelta: m4('0'), active: true, version: 1 },
    { id: 'opt_garlic', name: { ar: 'ثومية', en: 'Garlic' }, priceDelta: m4('5'), active: true, version: 1 },
  ] });
  db.modifierGroups.push({ id: 'mod_pizza_toppings', name: { ar: 'إضافات البيتزا', en: 'Pizza toppings' }, selectionRule: 'MULTIPLE', min: 0, max: 4, active: true, version: 1, options: [
    { id: 'opt_olives', name: { ar: 'زيتون', en: 'Olives' }, priceDelta: m4('10'), active: true, version: 1 },
    { id: 'opt_mushroom', name: { ar: 'مشروم', en: 'Mushroom' }, priceDelta: m4('15'), active: true, version: 1 },
    { id: 'opt_x_cheese', name: { ar: 'جبنة موتزاريلا زيادة', en: 'Extra mozzarella' }, priceDelta: m4('20'), active: true, version: 1, allergens: ['DAIRY'] },
  ] });
  const now = new Date(from).toISOString();
  const prods: Product[] = [
    { id: 'p_pizza_margherita', sku: 'DIR-PIZZA-MARG', name: { ar: 'بيتزا مارجريتا', en: 'Margherita pizza' }, categoryId: 'cat_direction', unitId: 'unit_ea', taxPolicyId: 'tax_demo', modifierGroupIds: ['mod_pizza_toppings'], active: true, version: 1, createdAt: now, direction: true, allergens: ['GLUTEN', 'DAIRY'], halfAndHalf: true, colorCode: '#a855f7',
      variants: [
        { id: 'v_s', name: { ar: 'صغير', en: 'S' }, priceDelta: m4('-30'), modifierMultiplier: '0.75', active: true },
        { id: 'v_m', name: { ar: 'وسط', en: 'M' }, priceDelta: m4('0'), modifierMultiplier: '1', active: true },
        { id: 'v_l', name: { ar: 'كبير', en: 'L' }, priceDelta: m4('40'), modifierMultiplier: '1.5', active: true },
      ] },
    { id: 'p_pizza_pepperoni', sku: 'DIR-PIZZA-PEPP', name: { ar: 'بيتزا بيبروني', en: 'Pepperoni pizza' }, categoryId: 'cat_direction', unitId: 'unit_ea', taxPolicyId: 'tax_demo', modifierGroupIds: ['mod_pizza_toppings'], active: true, version: 1, createdAt: now, direction: true, allergens: ['GLUTEN', 'DAIRY'], halfAndHalf: true, colorCode: '#a855f7',
      variants: [
        { id: 'v_s', name: { ar: 'صغير', en: 'S' }, priceDelta: m4('-30'), modifierMultiplier: '0.75', active: true },
        { id: 'v_m', name: { ar: 'وسط', en: 'M' }, priceDelta: m4('0'), modifierMultiplier: '1', active: true },
        { id: 'v_l', name: { ar: 'كبير', en: 'L' }, priceDelta: m4('40'), modifierMultiplier: '1.5', active: true },
      ] },
    { id: 'p_fries', sku: 'DIR-FRIES', name: { ar: 'بطاطس', en: 'Fries' }, categoryId: 'cat_direction', unitId: 'unit_ea', taxPolicyId: 'tax_demo', modifierGroupIds: ['mod_side_sauce'], active: true, version: 1, createdAt: now, direction: true, colorCode: '#a855f7' },
    { id: 'p_rings', sku: 'DIR-RINGS', name: { ar: 'حلقات بصل', en: 'Onion rings' }, categoryId: 'cat_direction', unitId: 'unit_ea', taxPolicyId: 'tax_demo', modifierGroupIds: ['mod_side_sauce'], active: true, version: 1, createdAt: now, direction: true, allergens: ['GLUTEN'], colorCode: '#a855f7' },
    { id: 'p_soda', sku: 'DIR-SODA', name: { ar: 'مشروب غازي', en: 'Soft drink' }, categoryId: 'cat_direction', unitId: 'unit_ea', taxPolicyId: 'tax_demo', modifierGroupIds: [], active: true, version: 1, createdAt: now, direction: true, colorCode: '#a855f7' },
    { id: 'p_burger_combo', sku: 'DIR-COMBO-BURGER', name: { ar: 'وجبة برجر كومبو', en: 'Burger combo' }, categoryId: 'cat_direction', unitId: 'unit_ea', taxPolicyId: 'tax_demo', modifierGroupIds: ['mod_doneness'], active: true, version: 1, createdAt: now, direction: true, allergens: ['GLUTEN', 'DAIRY'], colorCode: '#a855f7',
      combo: [
        { id: 'slot_side', name: { ar: 'الجانب', en: 'Side' }, defaultProductId: 'p_fries', options: [{ productId: 'p_fries', upcharge: m4('0'), nestedGroupId: 'mod_side_sauce' }, { productId: 'p_rings', upcharge: m4('5'), nestedGroupId: 'mod_side_sauce' }] },
        { id: 'slot_drink', name: { ar: 'المشروب', en: 'Drink' }, defaultProductId: 'p_soda', options: [{ productId: 'p_soda', upcharge: m4('0') }, { productId: 'p_orange_juice', upcharge: m4('15') }] },
      ] },
    { id: 'p_shisha', sku: 'DIR-SHISHA', name: { ar: 'شيشة تفاح', en: 'Apple shisha' }, categoryId: 'cat_direction', unitId: 'unit_ea', taxPolicyId: 'tax_demo', modifierGroupIds: [], active: true, version: 1, createdAt: now, direction: true, chargeTags: ['TABLE_TAX'], colorCode: '#a855f7' },
    { id: 'p_mixed_nuts', sku: 'DIR-NUTS', name: { ar: 'مكسرات', en: 'Mixed nuts' }, categoryId: 'cat_direction', unitId: 'unit_ea', taxPolicyId: 'tax_demo', modifierGroupIds: [], active: true, version: 1, createdAt: now, direction: true, chargeTags: ['TABLE_TAX'], allergens: ['NUTS'], colorCode: '#a855f7' },
  ];
  const price: Record<string, string> = { p_pizza_margherita: '160', p_pizza_pepperoni: '190', p_fries: '40', p_rings: '45', p_soda: '25', p_burger_combo: '230', p_shisha: '90', p_mixed_nuts: '60' };
  let n = db.priceRules.length;
  for (const p of prods) {
    db.products.push(p);
    db.availability.push({ productId: p.id, branchId: 'branch_main', state: 'AVAILABLE', reason: null, updatedAt: now, updatedBy: 'provisioning' });
    for (const ch of ['DINE_IN', 'TAKEAWAY'] as Channel[]) {
      const rule: PriceRule = { id: `pr_${++n}`, productId: p.id, branchId: 'branch_main', channel: ch, amount: m4(price[p.id]), currency: 'EGP', effectiveFrom: from, effectiveTo: null, createdAt: now, createdBy: 'provisioning', version: 1, replacesRuleId: null };
      db.priceRules.push(rule);
    }
  }
}

/** "Start from zero" (J-A1): a fresh dedicated install with only the bootstrap administrator. */
export function buildEmpty(nowMs: number): DB {
  const full = buildSeed(nowMs);
  const nowIso = new Date(nowMs).toISOString();
  return {
    ...full,
    seq: {},
    business: { id: 'biz', name: '', nameAr: '', legalName: null, currency: 'EGP', version: 1 },
    branches: [], terminals: [],
    roles: [{ id: 'role_bootstrap', name: 'Bootstrap administrator', permissionIds: ['*'], active: true, version: 1 }],
    users: [{ id: 'u_engineer', username: 'implementation-engineer', displayName: personaDisplayName('implementation-engineer'), active: true, version: 1, pin: DEMO_PIN, password: DEMO_PASSWORD, roleAssignments: [{ roleId: 'role_bootstrap', branchIds: ['*'] }], failedAttempts: 0, lockedUntil: null, credentialVersion: 1, mustChangeCredentials: false }],
    authSessions: [], units: [], categories: [], modifierGroups: [], products: [], availability: [], priceRules: [], taxPolicies: [], tables: [], visits: [], orders: [],
    stations: [], routingRules: [], tickets: [], kitchenDeliveries: [], sessions: [], cashEntries: [], captures: [], refunds: [], grants: [], reasonCodes: [],
    policyValues: [], policyHistory: [], printJobs: [], fiscalProfiles: [], fiscalDevices: [], itemMappings: [], fiscalDocuments: [], promotions: [], audit: [], idem: {}, alerts: [],
    deposits: [], reservations: [], tips: [],
    ...CRM_EMPTY,
    menu: undefined, // menu area: no dayparts/menus on a fresh install (nothing restricted)
    inv: undefined, // inventory area: a fresh install starts with no warehouses or stock
    events: [{ id: 'ev_0', at: nowIso, type: 'Installed', ref: 'biz', text: 'dedicated deployment ready — bootstrap administrator only' }],
  };
}
