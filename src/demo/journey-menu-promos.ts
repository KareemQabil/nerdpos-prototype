// ux-15 journey J-M1 — menu and promotions against the mock: the new settings and who may do what; the manager adds an
// item with two sizes, prices it for dine-in and takeaway and schedules a price change (a past sale keeps its price);
// the item is sold, so deleting is refused and it is retired with a reason (no longer sold, its sale untouched) and put
// back on sale; a happy-hour promotion live this hour is offered to the cashier with the server's amount and applied,
// the one two hours later is not; a code is checked against the check before it is applied (the same command twice
// adds it once); a promotion for registered customers needs the customer; a second promotion is refused under
// NO_STACKING; removing a promotion needs a reason and the line stays on the check; editing a used promotion needs a
// reason and keeps its revisions.
import { api, as, expectRefusal, order, openSession, type Logger } from './runner';
import { store } from '../mock/store';
import { clock, zonedParts } from '../mock/clock';
import { t } from '../i18n';
import type { StepDef } from './scripts';

const check = (log: Logger, ok: boolean, text: string, plain: string) => log({ ok, text, plain });
const pv = (id: string) => store.db.policyValues.find((v) => v.policyId === id && v.scopeType === 'TENANT')?.value as any;
const prod = (id: string) => store.db.products.find((p) => p.id === id)!;
const S: { item?: string; sale?: string; check?: string; happy?: string; later?: string; code?: string; cust?: string } = {};
const hh = (x: number) => String((x + 24) % 24).padStart(2, '0') + ':00';
async function sale(log: Logger, lines: any[]) {
  const c = await as('t_cash', 'demo-cashier-a', log);
  if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'open the drawer');
  const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'new takeaway check');
  await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines } }, log, 'add items');
  return { c, id: o.id as string };
}

const M1: StepDef[] = [
  { id: 'J-M1-1', device: 't_admin', user: 'demo-manager-1', screen: 'promotions', run: async (log) => {
    const pp = pv('PromotionPolicy'), pr = pv('ProductRemovalPolicy');
    check(log, pp?.maxPromotionsPerCheck === 2 && pp?.stackBase === 'REMAINDER' && pp?.manualWithPromotion === 'DENY' && pp?.rounding === 'DOWN' && pp?.removeReason === 'REQUIRED' && pr?.mode === 'RETIRE_ONLY', `defaults: ${JSON.stringify({ PromotionPolicy: pp, ProductRemovalPolicy: pr })}`, t('الإعدادات الافتراضية: عرضان على الأكثر عند السماح بالتجميع، والعرض التالي على المتبقي، ولا خصم مدير مع عرض، والتقريب للأدنى، وسبب لإزالة العرض، والصنف المبيع يُوقف ولا يُحذف'));
    const c = await as('t_cash', 'demo-cashier-a', log);
    await expectRefusal(api(c, 'Promotion.Upsert', { params: { promotionId: 'promo_j1' }, body: { name: { ar: 'عرض' }, kind: 'AUTOMATIC', channels: ['DINE_IN'], benefitType: 'PERCENTAGE', benefitValue: '5' } }), 'PERMISSION_DENIED', log, 'the cashier creates a promotion', t('لا ينشئ الكاشير عرضًا'));
    await expectRefusal(api(c, 'Product.Retire', { params: { productId: 'p_espresso' }, body: { reason: 'تجربة', expectedVersion: prod('p_espresso').version } }), 'PERMISSION_DENIED', log, 'the cashier retires an item', t('لا يوقف الكاشير صنفًا'));
  } },
  { id: 'J-M1-2', device: 't_admin', user: 'demo-manager-1', screen: 'menu', run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    let item = store.db.products.find((p) => p.sku === 'J-LATTE');
    if (!item) {
      const r = await api<any>(m, 'Product.Create', { body: { name: { ar: 'لاتيه', en: 'Latte' }, categoryId: 'cat_hot', unitId: 'unit_ea', sku: 'J-LATTE', taxPolicyId: prod('p_espresso').taxPolicyId } }, log, 'new item: latte');
      item = prod(r.id);
    }
    S.item = item.id;
    await api(m, 'Variant.Upsert', { params: { productId: item.id, variantId: 'v_reg' }, body: { name: { ar: 'عادي', en: 'Regular' }, priceDelta: '0', isDefault: true } }, log, 'size: regular');
    await api(m, 'Variant.Upsert', { params: { productId: item.id, variantId: 'v_big' }, body: { name: { ar: 'كبير', en: 'Large' }, priceDelta: '15.00' } }, log, 'size: large +15.00');
    for (const ch of ['DINE_IN', 'TAKEAWAY']) await api(m, 'Catalog.SetPrice', { params: { productId: item.id }, body: { amount: '55.00', currency: 'EGP', branchId: 'branch_main', channel: ch } }, log, `price ${ch} 55.00`);
    await api(m, 'Product.SetAvailability', { params: { productId: item.id }, body: { state: 'AVAILABLE', branchId: 'branch_main' } }, log, 'on sale in the branch');
    const s = await sale(log, [{ productId: item.id, quantity: '1', variantId: 'v_big' }]);
    S.sale = s.id;
    const line = order(s.id).lines[0];
    check(log, line.unitTotal === '70.0000', `large latte on the check: ${line.unitTotal}`, t('الحجم الكبير يُباع بسعر الصنف مع فرق الحجم: 70.00'));
    await api(m, 'Catalog.SetPrice', { params: { productId: item.id }, body: { amount: '60.00', currency: 'EGP', branchId: 'branch_main', channel: 'TAKEAWAY', effectiveFrom: new Date(clock.now() + 3600_000).toISOString() } }, log, 'takeaway 60.00 from the next hour');
    const hist = await api<any>(m, 'Product.PriceHistory', { params: { productId: item.id }, query: { branchId: 'branch_main', channel: 'TAKEAWAY', variantId: 'BASE' } }, log, 'price history');
    check(log, hist.items.some((r: any) => r.state === 'SCHEDULED' && r.amount === '60.0000') && order(s.id).lines[0].unitTotal === '70.0000', `history: ${hist.items.map((r: any) => `${r.state} ${r.amount}`).join(' · ')}; the check keeps 70.00`, t('السعر الجديد مجدول من وقت محدد، والشيك الحالي يبقى بسعره'));
    await expectRefusal(api(m, 'Catalog.SetPrice', { params: { productId: item.id }, body: { amount: '50.00', currency: 'EGP', branchId: 'branch_main', channel: 'TAKEAWAY', effectiveFrom: new Date(clock.now() - 86400_000).toISOString() } }), 'VALIDATION_FAILED', log, 'a price from yesterday', t('لا يُغيَّر سعر بتاريخ فات'));
  } },
  { id: 'J-M1-3', device: 't_admin', user: 'demo-manager-1', screen: 'menu', run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    const c = await as('t_cash', 'demo-cashier-a', log);
    const id = S.item!;
    const sid = S.sale!;
    if (order(sid).status === 'DRAFT') {
      await api(c, 'Order.Confirm', { params: { orderId: sid }, body: { expectedVersion: order(sid).version } }, log, 'confirm the latte check');
      await api(c, 'Payment.Capture', { params: { orderId: sid }, body: { tenders: [{ method: 'CASH', tendered: order(sid).confirmation!.payable }] } }, log, 'cash');
      await api(c, 'Order.Complete', { params: { orderId: sid }, body: { expectedVersion: order(sid).version } }, log, 'complete');
    }
    const u = await api<any>(m, 'Product.Usage', { params: { productId: id } }, log, 'where the item is used');
    check(log, u.usage.completedChecks >= 1 && !u.canDelete, `sold on ${u.usage.completedChecks} check(s); blockers ${u.deleteBlockers.join(', ')}`, t('صنف بيع مرة لا يُحذف'));
    await expectRefusal(api(m, 'Product.Delete', { params: { productId: id }, body: { reason: 'أضيف بالخطأ', expectedVersion: prod(id).version } }), 'PRODUCT_DELETE_NOT_ALLOWED', log, 'delete the item (RETIRE_ONLY)', t('الحذف غير مسموح في الإعدادات — يُوقف الصنف بدلًا من ذلك'));
    await expectRefusal(api(m, 'Product.Retire', { params: { productId: id }, body: { reason: '', expectedVersion: prod(id).version } }), 'REASON_REQUIRED', log, 'retire without a reason', t('إيقاف الصنف يحتاج سببًا'));
    await api(m, 'Product.Retire', { params: { productId: id }, body: { reason: 'انتهى الموسم', expectedVersion: prod(id).version } }, log, 'retire: «انتهى الموسم»');
    const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'new check');
    await expectRefusal(api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: id, quantity: '1' }] } }), 'CATALOG_PRODUCT_NOT_FOUND', log, 'sell the retired item', t('الصنف الموقوف لا يُباع'));
    check(log, order(sid).status === 'COMPLETED' && order(sid).lines[0].productId === id && !!store.db.audit.find((a) => a.target === id && /retired: انتهى الموسم/.test(a.summary)), `the completed sale is untouched; audit «${store.db.audit.find((a) => a.target === id && /retired/.test(a.summary))?.summary}»`, t('مبيعات الصنف السابقة كما هي، والإيقاف مسجل بسببه'));
    await api(m, 'Product.Reinstate', { params: { productId: id }, body: { expectedVersion: prod(id).version } }, log, 'back on sale');
  } },
  { id: 'J-M1-4', device: 't_cash', user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    const h = zonedParts(clock.now()).hour;
    S.happy = 'promo_j_happy'; S.later = 'promo_j_later';
    const base = { kind: 'AUTOMATIC', channels: ['DINE_IN', 'TAKEAWAY'], branchIds: ['branch_main'], mechanic: 'ITEMS', benefitType: 'PERCENTAGE', benefitValue: '20', categoryIds: ['cat_hot'], stacking: 'EXCLUSIVE' };
    if (!store.db.promotions.some((p) => p.id === S.happy)) await api(m, 'Promotion.Upsert', { params: { promotionId: S.happy }, body: { ...base, name: { ar: 'هابي أور المشروبات الساخنة', en: 'Hot drinks happy hour' }, dayparts: [{ days: [0, 1, 2, 3, 4, 5, 6], start: hh(h), end: hh(h + 1) }] } }, log, `happy hour ${hh(h)}–${hh(h + 1)}`);
    if (!store.db.promotions.some((p) => p.id === S.later)) await api(m, 'Promotion.Upsert', { params: { promotionId: S.later }, body: { ...base, name: { ar: 'عرض المساء', en: 'Evening offer' }, dayparts: [{ days: [0, 1, 2, 3, 4, 5, 6], start: hh(h + 2), end: hh(h + 3) }] } }, log, `later ${hh(h + 2)}–${hh(h + 3)}`);
    const s = await sale(log, [{ productId: 'p_espresso', quantity: '2' }]);
    S.check = s.id;
    const opts = await api<any>(s.c, 'Order.PromotionOptions', { params: { orderId: s.id } }, log, 'the promotions this check can get');
    const happy = opts.items.find((x: any) => x.promotionId === S.happy);
    check(log, happy?.applicable && happy.amount === '18.0000' && !opts.items.some((x: any) => x.promotionId === S.later), `offered: ${opts.items.map((x: any) => `${x.promotionId} ${x.applicable ? x.amount : x.refusal?.rule}`).join(' · ')}`, t('يرى الكاشير هابي أور هذه الساعة بمبلغه من الخادم (20% من 90.00 = 18.00)، ولا يرى عرض المساء'));
    await expectRefusal(api(s.c, 'Order.ApplyDiscount', { params: { orderId: s.id }, body: { expectedVersion: order(s.id).version, discount: { promotionId: S.later } } }), 'PROMOTION_NOT_APPLICABLE', log, 'apply the evening offer now', t('عرض خارج موعده لا يُطبَّق'));
    await api(s.c, 'Order.ApplyDiscount', { params: { orderId: s.id }, body: { expectedVersion: order(s.id).version, discount: { promotionId: S.happy } } }, log, 'apply the happy hour');
    const tt = (await api<any>(s.c, 'Order.Get', { params: { orderId: s.id } })).totals;
    check(log, tt.discountTotal === '18.0000' && tt.discountLines?.[0]?.amount === '18.0000', `check discount ${tt.discountTotal}`, t('الخصم على الشيك كما عرضه الخادم'));
    await expectRefusal(api(s.c, 'Order.ApplyDiscount', { params: { orderId: s.id }, body: { expectedVersion: order(s.id).version, discount: { promotionCode: 'SHAWARMA3' } } }), 'DISCOUNT_STACKING_NOT_ALLOWED', log, 'a second promotion (NO_STACKING)', t('خصم واحد على الشيك حسب الإعدادات'));
  } },
  { id: 'J-M1-5', device: 't_cash', user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    const id = S.check!;
    const d = order(id).discounts.find((x) => x.active && x.promotionId === S.happy)!;
    await expectRefusal(api(c, 'Order.RemoveDiscount', { params: { orderId: id, discountId: d.id }, body: {} }), 'REASON_REQUIRED', log, 'remove without a reason', t('إزالة العرض تحتاج سببًا'));
    await api(c, 'Order.RemoveDiscount', { params: { orderId: id, discountId: d.id }, body: { reason: 'العميل يفضّل الرمز', expectedVersion: order(id).version } }, log, 'remove the happy hour: «العميل يفضّل الرمز»');
    const kept = order(id).discounts.find((x) => x.id === d.id)!;
    check(log, !kept.active && kept.removeReason === 'العميل يفضّل الرمز', `the line stays: active ${kept.active}, reason «${kept.removeReason}»`, t('العرض المُزال يبقى في سجل الشيك بسببه'));
    await expectRefusal(api(c, 'Order.ApplyDiscount', { params: { orderId: id }, body: { expectedVersion: order(id).version, discount: { promotionCode: 'NOPE99' } } }), 'PROMOTION_CODE_INVALID', log, 'a wrong code', t('رمز غير صحيح'));
    await expectRefusal(api(c, 'Order.ApplyDiscount', { params: { orderId: id }, body: { expectedVersion: order(id).version, discount: { promotionCode: 'WELCOME50' } } }), 'PROMOTION_NOT_APPLICABLE', log, 'WELCOME50 on a 90.00 check', t('رمز الترحيب يحتاج شيكًا فوق 300.00'));
    await api(c, 'Order.AddLines', { params: { orderId: id }, body: { expectedVersion: order(id).version, lines: [{ productId: 'p_kofta', quantity: '1', modifierOptionIds: ['opt_medium'] }] } }, log, 'add kofta');
    const cmd2 = `j-m1-code2-${id}`;
    const v2 = order(id).version;
    await api(c, 'Order.ApplyDiscount', { params: { orderId: id }, body: { expectedVersion: v2, discount: { promotionCode: 'WELCOME50' } }, commandId: cmd2 }, log, 'code WELCOME50');
    await api(c, 'Order.ApplyDiscount', { params: { orderId: id }, body: { expectedVersion: v2, discount: { promotionCode: 'WELCOME50' } }, commandId: cmd2 }, log, 'the same command again (network retry)');
    const on = order(id).discounts.filter((x) => x.active);
    check(log, on.length === 1 && on[0].code === 'WELCOME50', `${on.length} promotion on the check (code ${on[0]?.code})`, t('إعادة الأمر نفسه لا تضيف العرض مرتين'));
  } },
  { id: 'J-M1-6', device: 't_admin', user: 'demo-manager-1', screen: 'promotions', run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    const c = await as('t_cash', 'demo-cashier-a', log);
    S.cust = 'promo_j_members';
    if (!store.db.promotions.some((p) => p.id === S.cust)) await api(m, 'Promotion.Upsert', { params: { promotionId: S.cust }, body: { name: { ar: 'خصم الأعضاء', en: 'Members discount' }, kind: 'AUTOMATIC', channels: ['TAKEAWAY'], branchIds: ['branch_main'], mechanic: 'ORDER', benefitType: 'FIXED_AMOUNT', benefitValue: '15', customerScope: 'IDENTIFIED', maxUsesPerCustomer: 1 } }, log, 'members only, once per customer');
    const s = await sale(log, [{ productId: 'p_om_ali', quantity: '1' }]);
    await expectRefusal(api(c, 'Order.ApplyDiscount', { params: { orderId: s.id }, body: { expectedVersion: order(s.id).version, discount: { promotionId: S.cust } } }), 'PROMOTION_CUSTOMER_REQUIRED', log, 'no customer on the check', t('عرض الأعضاء يحتاج العميل على الشيك'));
    await api(c, 'Order.SetCustomer', { params: { orderId: s.id }, body: { expectedVersion: order(s.id).version, customerId: store.db.customers![3].id } }, log, 'a registered customer');
    await api(c, 'Order.ApplyDiscount', { params: { orderId: s.id }, body: { expectedVersion: order(s.id).version, discount: { promotionId: S.cust } } }, log, 'members discount');
    const s2 = await sale(log, [{ productId: 'p_om_ali', quantity: '1' }]);
    await api(c, 'Order.SetCustomer', { params: { orderId: s2.id }, body: { expectedVersion: order(s2.id).version, customerId: store.db.customers![3].id } }, log, 'the same customer again');
    await expectRefusal(api(c, 'Order.ApplyDiscount', { params: { orderId: s2.id }, body: { expectedVersion: order(s2.id).version, discount: { promotionId: S.cust } } }), 'PROMOTION_LIMIT_REACHED', log, 'second time for the same customer', t('مرة واحدة لكل عميل'));
    const pr = store.db.promotions.find((p) => p.id === S.cust)! as any;
    const body = { name: pr.name, kind: 'AUTOMATIC', channels: pr.channels, branchIds: pr.branchIds, mechanic: 'ORDER', benefitType: 'FIXED_AMOUNT', benefitValue: '20', customerScope: 'IDENTIFIED', maxUsesPerCustomer: 1, expectedVersion: pr.version };
    await expectRefusal(api(m, 'Promotion.Upsert', { params: { promotionId: S.cust }, body }), 'REASON_REQUIRED', log, 'edit a used promotion without a reason', t('تعديل عرض مستخدم يحتاج سببًا'));
    await api(m, 'Promotion.Upsert', { params: { promotionId: S.cust }, body: { ...body, changeReason: 'رفع الخصم لشهر رمضان' } }, log, 'edit with a reason: 20.00');
    const revs = (store.db.promotions.find((p) => p.id === S.cust) as any).revisions;
    check(log, revs.length >= 2 && revs.at(-1).reason === 'رفع الخصم لشهر رمضان' && order(s.id).discounts.some((x) => x.promotionId === S.cust && x.value === '15'), `revisions: ${revs.map((r: any) => `v${r.version} ${r.change}`).join(' · ')}`, t('سجل العرض يحفظ كل تعديل بسببه، والشيكات السابقة تبقى بنسختها'));
  } },
];

export const MENU_PROMOS_JOURNEY = {
  id: 'J-M1', title: 'قائمة الطعام والعروض', titleEn: 'Menu and promotions', reset: null,
  intro: 'صنف بمقاسين وسعر مجدول، إيقافه بدل حذفه بعد بيعه، هابي أور يظهر للكاشير بمبلغه من الخادم، رمز عرض بلا تكرار، عرض للأعضاء مرة لكل عميل، وإزالة العرض وتعديله بسبب.',
  steps: M1,
};
