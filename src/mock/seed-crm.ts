// Demo data for customers, delivery zones, drivers, loyalty tiers, past deliveries and the online-orders inbox.
// Called once from buildSeed. Realistic Cairo data; nothing here touches the J-R journeys.
import { m4 } from './money';
import type { DB, Channel, PriceRule } from './types';
import type { Customer, CustomerAddress, Delivery, DeliveryZone, Driver, ExternalOrder, LoyaltyEntry, LoyaltyTier, ChannelItemMap } from './types-crm';

const DAY = 86_400_000;

export const ZONE_SEED: Omit<DeliveryZone, 'version' | 'branchId'>[] = [
  { id: 'zone_nasr', name: { ar: 'مدينة نصر', en: 'Nasr City' }, areas: ['الحي السابع', 'الحي الثامن', 'الحي العاشر', 'الحي السادس', 'عباس العقاد', 'مكرم عبيد', 'الزهراء', 'مصطفى النحاس'], fee: m4('15'), minOrder: m4('100'), etaMinutes: 30, active: true, color: '#22d3ee', map: { x: 55, y: 32, w: 40, h: 30 } },
  { id: 'zone_heliopolis', name: { ar: 'مصر الجديدة', en: 'Heliopolis' }, areas: ['الكوربة', 'روكسي', 'الماظة', 'ميدان الحجاز', 'شيراتون', 'النزهة', 'الميرغني'], fee: m4('25'), minOrder: m4('150'), etaMinutes: 40, active: true, color: '#a78bfa', map: { x: 52, y: 2, w: 43, h: 27 } },
  { id: 'zone_maadi', name: { ar: 'المعادي', en: 'Maadi' }, areas: ['المعادي السرايات', 'دجلة', 'زهراء المعادي', 'المعادي الجديدة', 'كورنيش المعادي'], fee: m4('40'), minOrder: m4('250'), etaMinutes: 55, active: true, color: '#34d399', map: { x: 20, y: 44, w: 32, h: 24 } },
  { id: 'zone_zamalek', name: { ar: 'الزمالك ووسط البلد', en: 'Zamalek & Downtown' }, areas: ['الزمالك', 'جاردن سيتي', 'وسط البلد', 'المنيل'], fee: m4('45'), minOrder: m4('300'), etaMinutes: 60, active: true, color: '#f59e0b', map: { x: 4, y: 8, w: 34, h: 32 } },
];
/** Where the restaurant sits on the simple map (0..100 × 0..70). */
export const RESTAURANT_XY = { x: 72, y: 46 };

export const TIER_SEED: Omit<LoyaltyTier, 'version'>[] = [
  { id: 'tier_silver', name: { ar: 'فضي', en: 'Silver' }, minPoints: 0, multiplier: '1', color: '#94a3b8', perks: { ar: 'نقطة على كل 10 جنيه', en: '1 point per 10 EGP' }, active: true, sortOrder: 10 },
  { id: 'tier_gold', name: { ar: 'دهبي', en: 'Gold' }, minPoints: 500, multiplier: '1.25', color: '#f59e0b', perks: { ar: 'نقاط أكتر بـ 25% + مشروب هدية في عيد ميلاده', en: '+25% points, birthday drink' }, active: true, sortOrder: 20 },
  { id: 'tier_platinum', name: { ar: 'بلاتيني', en: 'Platinum' }, minPoints: 1500, multiplier: '1.5', color: '#22d3ee', perks: { ar: 'نقاط أكتر بـ 50% + أولوية في التوصيل', en: '+50% points, delivery priority' }, active: true, sortOrder: 30 },
];

type C = [name: string, phone: string, area: string, street: string, building: string, floor: string, apt: string, landmark: string, tags: string[], allergies: string[], notes: string, orders: number, spent: number, fav: string, daysAgo: number];
const CUSTOMERS: C[] = [
  ['أحمد محمود عبد الله', '01001234567', 'الحي الثامن', 'شارع عباس العقاد', '14', '3', '12', 'جنب سيتي ستارز', ['VIP', 'REGULAR'], [], 'بيحب الكفتة مستوية كويس', 64, 21450, 'كفتة مشوية', 1],
  ['منى إبراهيم السيد', '01112345678', 'الكوربة', 'شارع بغداد', '7', '2', '4', 'قدام صيدلية العزبي', ['REGULAR'], ['DAIRY'], 'حساسية ألبان — من غير جبنة', 31, 9870, 'شاورما فراخ', 3],
  ['محمد علي حسن', '01223456789', 'دجلة', 'شارع 9', '22', '5', '17', 'بعد محطة مترو المعادي', [], [], '', 9, 3120, 'مشويات مشكلة', 9],
  ['سارة خالد فهمي', '01098765432', 'الزمالك', 'شارع 26 يوليو', '3', '6', '21', 'فوق كافيه سيلانترو', ['VIP'], ['NUTS'], 'حساسية مكسرات شديدة — بلّغ المطبخ', 42, 18200, 'سلطة خضراء', 2],
  ['كريم مصطفى عادل', '01234567890', 'الحي العاشر', 'شارع أحمد الزمر', '41', '1', '2', 'عمارات الضباط', [], [], '', 5, 1240, 'برجر لحم', 20],
  ['ياسمين عمرو الشريف', '01155554444', 'روكسي', 'شارع الخليفة المأمون', '12', '8', '33', 'جنب البنك الأهلي', ['VIP', 'REGULAR'], [], 'بتدفع إنستاباي غالبًا', 57, 24300, 'مشويات مشكلة', 1],
  ['عمر طارق سليمان', '01011223344', 'مكرم عبيد', 'شارع مكرم عبيد', '88', '4', '9', 'فوق محل بلبن', [], [], '', 12, 2980, 'شاورما فراخ', 6],
  ['هبة سمير جاد', '01277788899', 'الماظة', 'شارع جسر السويس', '5', '3', '7', 'جنب نادي الماظة', [], ['GLUTEN'], 'بتسأل دايمًا عن الجلوتين', 7, 1890, 'سلطة خضراء', 14],
  ['مصطفى حسام الدين', '01566677788', 'الزهراء', 'شارع الطيران', '19', '2', '5', 'قدام مسجد رابعة', [], [], '', 3, 760, 'كفتة مشوية', 30],
  ['نورهان أشرف', '01099887766', 'شيراتون', 'شارع النزهة', '120', '7', '28', 'برج الياسمين', ['REGULAR'], [], '', 22, 6700, 'حمص', 4],
  ['يوسف وليد منصور', '01144433322', 'المعادي الجديدة', 'شارع النصر', '7', '10', '41', 'كمبوند جاردينيا', [], [], 'البوابة بتطلب اسم الساكن', 4, 1650, 'مشويات مشكلة', 18],
  ['دينا رأفت', '01212121212', 'وسط البلد', 'شارع طلعت حرب', '30', '4', '15', 'جنب سينما ميامي', [], ['SESAME'], 'من غير طحينة', 6, 1420, 'بابا غنوج', 25],
  ['شركة النور للمقاولات — أ. عزت', '01000011122', 'عباس العقاد', 'شارع عباس العقاد', '60', '9', 'مكتب 902', 'برج النور', ['CORPORATE', 'VIP'], [], 'طلبات غدا للموظفين — فاتورة باسم الشركة', 38, 31500, 'مشويات مشكلة', 2],
  ['حسن عبد الرحمن', '01588899900', 'الحي السابع', 'شارع حسن المأمون', '9', '3', '6', 'جنب مدرسة الحرية', [], [], '', 15, 4210, 'كفتة مشوية', 8],
  ['رانيا فؤاد', '01033344455', 'الميرغني', 'شارع الميرغني', '44', '2', '3', 'قصاد قصر الاتحادية', ['REGULAR'], [], '', 19, 5600, 'شاورما فراخ', 5],
  ['طارق زكي', '01122233344', 'كورنيش المعادي', 'كورنيش النيل', '200', '12', '120', 'برج النيل', [], [], '', 2, 980, 'برجر لحم', 40],
  ['إيمان عادل', '01299988877', 'الحي السادس', 'شارع الطيران', '3', '1', '1', 'محل ورد على الناصية', [], ['EGG'], '', 8, 2100, 'أم علي', 11],
  ['خالد سعيد البنا', '01055566677', 'النزهة', 'شارع عمر بن الخطاب', '17', '5', '10', 'جنب سوبرماركت خير زمان', ['CAUTION'], [], 'رجّع طلب قبل كده — اتأكد من العنوان بالتليفون', 4, 870, 'شاورما فراخ', 16],
  ['مريم هشام', '01177788811', 'جاردن سيتي', 'شارع قصر العيني', '11', '3', '8', 'جنب السفارة', [], [], '', 3, 1310, 'سلطة خضراء', 22],
  ['شريف نبيل', '01266655544', 'مصطفى النحاس', 'شارع مصطفى النحاس', '75', '6', '24', 'فوق كارفور', ['REGULAR'], [], 'بيكلم من الشغل — كلّمه على الموبايل بس', 27, 8150, 'برجر لحم', 2],
  ['أمل يحيى', '01522211100', 'المعادي السرايات', 'شارع 77', '4', 'أرضي', '1', 'فيلا ببوابة خضرا', [], [], 'كبيرة في السن — استنى شوية على الباب', 11, 3900, 'أم علي', 7],
  ['وليد فاروق', '01044455566', 'ميدان الحجاز', 'شارع الحجاز', '102', '4', '14', 'قدام ميدان الحجاز', [], [], '', 1, 260, 'شاورما فراخ', 45],
  ['ريهام جمال', '01188899922', 'المنيل', 'شارع عبد العزيز آل سعود', '15', '7', '19', 'جنب كوبري الجامعة', [], ['DAIRY', 'NUTS'], '', 5, 1980, 'حمص', 13],
  ['إسلام حمدي', '01233322211', 'الحي الثامن', 'شارع الطيران', '50', '2', '6', 'جنب الحديقة الدولية', ['NEW'], [], '', 0, 0, '', 0],
  ['نادية كمال', '01011122200', 'الكوربة', 'شارع إبراهيم اللقاني', '8', '1', '2', 'عمارة بلكونات حديد', ['VIP'], [], 'بتطلب من الأرضي 0224150000', 48, 15600, 'مشويات مشكلة', 3],
  // a likely duplicate of منى إبراهيم السيد (her second number) — for the merge demo
  ['مني ابراهيم', '01512345678', 'الكوربة', 'شارع بغداد', '7', '2', '4', 'قدام صيدلية العزبي', [], [], 'ممكن تكون نفس العميلة برقم تاني', 2, 540, 'شاورما فراخ', 35],
];

const DRIVERS: [string, string, Driver['vehicle'], string, boolean][] = [
  ['محمود السيد', '01007766554', 'MOTORCYCLE', 'م ن ر 4821', true],
  ['كريم عادل', '01119988776', 'MOTORCYCLE', 'ق ط ب 1937', true],
  ['أحمد فتحي', '01225544332', 'MOTORCYCLE', 'س و ع 6604', true],
  ['مصطفى رجب', '01553322110', 'CAR', 'ل ك م 902', false],
];

/** Extra sale prices for the DELIVERY channel (same as takeaway; the price grid can change them). */
function deliveryPrices(db: DB, from: number) {
  let n = db.priceRules.length + 500;
  const fresh: PriceRule[] = [];
  for (const r of db.priceRules) {
    if (r.channel !== 'TAKEAWAY' || r.effectiveTo !== null) continue;
    if (db.priceRules.some((x) => x.productId === r.productId && x.branchId === r.branchId && x.channel === 'DELIVERY')) continue;
    fresh.push({ ...r, id: `pr_${++n}`, channel: 'DELIVERY' as Channel, effectiveFrom: from, createdAt: new Date(from).toISOString(), replacesRuleId: null });
  }
  db.priceRules.push(...fresh);
}

export function seedCrm(db: DB, nowMs: number) {
  const iso = (ms: number) => new Date(ms).toISOString();
  db.deliveryZones = ZONE_SEED.map((z) => ({ ...z, branchId: 'branch_main', version: 1 }));
  db.loyaltyTiers = TIER_SEED.map((x) => ({ ...x, version: 1 }));
  db.drivers = DRIVERS.map(([name, phone, vehicle, plate, onShift], i) => ({
    id: `drv_${i + 1}`, branchId: 'branch_main', name, phone, vehicle, plate, onShift, active: true, version: 1, createdAt: iso(nowMs - 200 * DAY),
    location: onShift ? { x: 70 + i * 2, y: 44 + i, at: iso(nowMs) } : null, owed: m4(i === 2 ? '35' : '0'), userId: null,
  }));

  // delivery orders are priced like takeaway; the confirmation policy must list the channel
  deliveryPrices(db, nowMs - 30 * DAY);
  for (const pv of db.policyValues) {
    if (pv.policyId === 'OrderConfirmationPricingPolicy' && pv.value && typeof pv.value === 'object') {
      const v = pv.value as { channels?: string[] };
      if (Array.isArray(v.channels) && !v.channels.includes('DELIVERY')) v.channels.push('DELIVERY');
    }
  }

  const zoneOf = (area: string) => db.deliveryZones!.find((z) => z.areas.includes(area))?.id ?? null;
  const customers: Customer[] = [];
  const entries: LoyaltyEntry[] = [];
  const deliveries: Delivery[] = [];
  let dno = 0;
  CUSTOMERS.forEach((c, i) => {
    const [name, phone, area, street, building, floor, apartment, landmark, tags, allergies, notes, orders, spent, fav, daysAgo] = c;
    const id = `cus_${i + 1}`;
    const created = nowMs - (120 + i * 7) * DAY;
    const addr: CustomerAddress = { id: `adr_${i + 1}_1`, label: i === 12 ? 'المكتب' : 'البيت', area, street, building, floor, apartment, landmark, zoneId: zoneOf(area), city: 'القاهرة', active: true, isDefault: true, version: 1, createdAt: iso(created) };
    const addresses = [addr];
    if (i === 0) addresses.push({ id: 'adr_1_2', label: 'الشغل', area: 'روكسي', street: 'شارع الأهرام', building: '33', floor: '5', apartment: 'مكتب 51', landmark: 'جنب سينما روكسي', zoneId: zoneOf('روكسي'), city: 'القاهرة', active: true, version: 1, createdAt: iso(created + 20 * DAY) });
    if (i === 5) addresses.push({ id: 'adr_6_2', label: 'بيت الوالدة', area: 'الحي السابع', street: 'شارع ذاكر حسين', building: '2', floor: '3', apartment: '9', landmark: 'جنب مسجد السلام', zoneId: zoneOf('الحي السابع'), city: 'القاهرة', active: true, version: 1, createdAt: iso(created + 40 * DAY) });
    customers.push({
      id, code: `C-${String(i + 1).padStart(4, '0')}`, name, phone, altPhone: i === 24 ? '0224150000' : null, email: i === 12 ? 'orders@alnour-demo.eg' : null,
      notes: notes || null, allergies, tags, addresses, createdAt: iso(created), createdBy: 'seed', version: 1, active: true, mergedInto: null, source: 'SEED',
      history: orders ? { orders, spent: m4(spent), lastOrderAt: iso(nowMs - daysAgo * DAY - 3 * 3600_000), favourite: fav } : undefined,
    });
    // loyalty: points earned on past orders (1 point / 10 EGP), some redeemed
    if (spent > 0) {
      let bal = 0;
      const earned = Math.floor(spent / 10);
      bal += earned;
      entries.push({ id: `le_${id}_1`, customerId: id, kind: 'EARN', points: earned, balanceAfter: bal, orderNumber: null, amount: m4(spent), reason: 'نقاط طلبات سابقة (قبل تشغيل النظام)', at: iso(created + 10 * DAY), by: 'seed' });
      if (earned > 600) {
        const used = Math.floor(earned / 3 / 100) * 100;
        bal -= used;
        entries.push({ id: `le_${id}_2`, customerId: id, kind: 'REDEEM', points: -used, balanceAfter: bal, orderNumber: `H-${3000 + i}`, amount: m4((used * 0.25).toFixed(2)), reason: 'اتصرفت كدفع', at: iso(nowMs - (daysAgo + 5) * DAY), by: 'u_cashier_a' });
      }
      if (i === 3) { bal += 150; entries.push({ id: `le_${id}_3`, customerId: id, kind: 'ADJUST', points: 150, balanceAfter: bal, reason: 'تعويض عن تأخير طلب', at: iso(nowMs - 6 * DAY), by: 'u_manager_1' }); }
    }
  });

  // past deliveries (this week) for the customer profile, driver history and the board's "delivered" column history
  const pastPlan: [cust: number, drv: number, daysAgo: number, hour: number, amount: string, mode: Delivery['paymentMode'], late: boolean][] = [
    [0, 0, 1, 14, '486.40', 'CASH_ON_DELIVERY', false], [5, 1, 1, 20, '742.90', 'PAID_ONLINE', false], [3, 2, 2, 13, '318.20', 'CASH_ON_DELIVERY', true],
    [12, 0, 2, 13, '1840.00', 'CARD_ON_DELIVERY', false], [19, 1, 2, 21, '402.50', 'CASH_ON_DELIVERY', false], [1, 0, 3, 19, '265.80', 'CASH_ON_DELIVERY', false],
    [24, 2, 3, 15, '690.30', 'CASH_ON_DELIVERY', false], [9, 1, 4, 20, '233.70', 'PAID_ONLINE', true], [14, 0, 5, 22, '371.40', 'CASH_ON_DELIVERY', false],
    [6, 2, 6, 18, '298.10', 'CASH_ON_DELIVERY', false], [20, 1, 7, 16, '520.00', 'CASH_ON_DELIVERY', false],
  ];
  for (const [ci, di, daysAgo, hour, amount, mode, late] of pastPlan) {
    const cu = customers[ci];
    const a = cu.addresses[0];
    const z = db.deliveryZones!.find((x) => x.id === a.zoneId)!;
    const created = nowMs - daysAgo * DAY - (new Date(nowMs).getUTCHours() - hour + 2) * 3600_000;
    const promised = created + z.etaMinutes * 60_000;
    const delivered = promised + (late ? 18 : -6) * 60_000;
    const num = `H-${String(2400 + ++dno)}`;
    deliveries.push({
      id: `dlv_h${dno}`, branchId: 'branch_main', number: `D-${String(dno).padStart(4, '0')}`, orderId: null, orderNumber: num, customerId: cu.id, customerName: cu.name, phone: cu.phone,
      address: { area: a.area, street: a.street, building: a.building, floor: a.floor, apartment: a.apartment, landmark: a.landmark, zoneId: z.id }, zoneId: z.id, zoneName: z.name.ar, fee: z.fee, amount: m4(amount),
      state: 'DELIVERED', driverId: `drv_${di + 1}`, paymentMode: mode, source: 'CALL_CENTER', createdAt: iso(created), createdAtMs: created, promisedAt: iso(promised), promisedAtMs: promised,
      assignedAt: iso(created + 14 * 60_000), pickedUpAt: iso(created + 20 * 60_000), deliveredAt: iso(delivered), attempts: [], cancel: null,
      cod: mode === 'CASH_ON_DELIVERY' ? { amount: m4(amount), settled: true, settlementId: null } : null, collected: null, timeline: [], version: 1, historical: true,
    });
  }

  db.customers = customers;
  db.loyaltyEntries = entries;
  db.deliveries = deliveries;
  db.seq['delivery_no'] = dno;
  db.driverSettlements = [];
  db.paymentAuthorizations = [];

  // online-orders inbox: item map from the apps' codes to our menu, and two orders waiting for a decision
  const map: ChannelItemMap[] = [
    ['APP_1', 'A1-SHAW-CH', 'p_chicken_shawarma'], ['APP_1', 'A1-KOFTA', 'p_kofta'], ['APP_1', 'A1-HUMMUS', 'p_hummus'], ['APP_1', 'A1-MIXGRILL', 'p_mixed_grill'], ['APP_1', 'A1-BURGER', 'p_beef_burger'],
    ['APP_2', 'X2-778', 'p_chicken_shawarma'], ['APP_2', 'X2-912', 'p_om_ali'], ['WEBSITE', 'WEB-KOFTA', 'p_kofta'], ['WEBSITE', 'WEB-SALAD', 'p_green_salad'], ['WHATSAPP', 'WA-SHAW', 'p_chicken_shawarma'],
  ].map(([source, code, productId]) => ({ source: source as ChannelItemMap['source'], code, productId, updatedAt: iso(nowMs - 20 * DAY), by: 'seed' }));
  db.channelItemMap = map;
  const ext: ExternalOrder[] = [
    {
      id: 'ext_1', branchId: 'branch_main', source: 'APP_1', externalRef: 'A1-58213', receivedAt: iso(nowMs - 2 * 60_000), receivedAtMs: nowMs - 2 * 60_000,
      customer: { name: 'حازم عبد العزيز', phone: '01019283746', address: { area: 'الحي الثامن', street: 'شارع الطيران', building: '27', floor: '4', apartment: '11', landmark: 'جنب بنزينة موبيل' } },
      fulfillment: 'DELIVERY', payment: 'PAID_ONLINE', sourceTotal: m4('512.00'), note: 'من غير بصل في الشاورما',
      items: [{ code: 'A1-SHAW-CH', name: 'Chicken Shawarma Plate', quantity: '2', unitPrice: m4('155') }, { code: 'A1-HUMMUS', name: 'Hummus', quantity: '1', unitPrice: m4('62') }, { code: 'A1-COLA', name: 'Cola Can', quantity: '2', unitPrice: m4('25') }],
      state: 'NEW', version: 1,
    },
    {
      id: 'ext_2', branchId: 'branch_main', source: 'WEBSITE', externalRef: 'WEB-10442', receivedAt: iso(nowMs - 6 * 60_000), receivedAtMs: nowMs - 6 * 60_000,
      customer: { name: 'نورهان أشرف', phone: '01099887766' }, fulfillment: 'PICKUP', payment: 'CASH_ON_DELIVERY', sourceTotal: m4('330.00'), note: 'هعدي آخدها الساعة 9',
      items: [{ code: 'WEB-KOFTA', name: 'كفتة مشوية', quantity: '1', unitPrice: m4('220') }, { code: 'WEB-SALAD', name: 'سلطة خضراء', quantity: '2', unitPrice: m4('55') }],
      state: 'NEW', version: 1,
    },
  ];
  db.externalOrders = ext;
  db.seq['ext'] = 100;
}

/** "Start from zero": none of the crm demo data. */
export const CRM_EMPTY = {
  customers: [], loyaltyEntries: [], loyaltyTiers: [], deliveryZones: [], drivers: [], deliveries: [], driverSettlements: [], externalOrders: [], channelItemMap: [], paymentAuthorizations: [],
};
