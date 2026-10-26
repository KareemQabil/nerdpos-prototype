// Menu & pricing demo data (proposed area): breakfast daypart items, a shawarma meal (combo) with upgrades,
// pizzas with sizes (own size prices) and half-and-half, ingredient no/less/extra, sub-choices, an exempt tax group,
// dayparts and channel menus, images (small inline SVG), descriptions, calories, and two "sold out today" examples.
// Existing demo products keep their prices, SKUs and modifier groups (the journeys depend on them).
import { m4 } from './money';
import { businessDate } from './clock';
import type { Channel, DB, Product, PriceRule } from './types';
import type { MenuState } from './menu-types';

/** A tiny product picture: an emoji on a soft gradient, as an SVG data URL (no network, a few hundred bytes). */
export function svgImage(emoji: string, from: string, to: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 120'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${from}'/><stop offset='1' stop-color='${to}'/></linearGradient></defs><rect width='160' height='120' fill='url(#g)'/><circle cx='80' cy='62' r='40' fill='white' fill-opacity='0.18'/><text x='80' y='80' font-size='54' text-anchor='middle'>${emoji}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const L = (ar: string, en: string) => ({ ar, en });

export function seedMenu(db: DB, nowMs: number) {
  const from = nowMs - 30 * 86_400_000;
  const now = new Date(from).toISOString();

  // ───────── tax: an exempt group (bottled water, bread) next to the VAT group
  db.taxPolicies.push({ id: 'tax_exempt', name: L('معفي من الضريبة (مياه وخبز)', 'Exempt (water, bread)'), jurisdiction: 'DEMO_NOT_CERTIFIED', rate: '0', calculationMode: 'EXCLUSIVE', roundingMode: 'HALF_UP', roundingScale: 2, active: true, version: 1, history: [{ at: now, by: 'provisioning', change: 'created (demo exempt group)' }], exemption: 'EXEMPT', fiscalTaxType: null, fiscalSubtype: null });

  // ───────── categories
  db.categories.push({ id: 'cat_breakfast', name: L('فطار', 'Breakfast'), active: true, sortOrder: 5, version: 1, colorCode: '#f97316' });
  db.categories.push({ id: 'cat_meals', name: L('وجبات وساندوتشات', 'Meals & sandwiches'), active: true, sortOrder: 45, version: 1, colorCode: '#eab308' });
  db.categories.push({ id: 'cat_pizza', name: L('بيتزا', 'Pizza'), active: true, sortOrder: 47, version: 1, colorCode: '#dc2626' });

  // ───────── modifier groups
  const opt = (id: string, ar: string, en: string, delta = '0', extra: Record<string, unknown> = {}) => ({ id, name: L(ar, en), priceDelta: m4(delta), active: true, version: 1, ...extra });
  db.modifierGroups.push(
    { id: 'mod_bread', name: L('نوع العيش', 'Bread'), selectionRule: 'SINGLE', min: 1, max: 1, active: true, version: 1, kind: 'STANDARD', scalesWithSize: false, options: [
      opt('opt_bread_shami', 'عيش شامي', 'Pita', '0', { isDefault: true, sortOrder: 10 }), opt('opt_bread_fino', 'عيش فينو', 'Fino roll', '0', { sortOrder: 20 }), opt('opt_bread_saj', 'عيش صاج', 'Saj', '5', { sortOrder: 30 }),
    ] },
    { id: 'mod_sandwich_ing', name: L('مكونات الساندوتش', 'Sandwich ingredients'), selectionRule: 'MULTIPLE', min: 0, max: 5, active: true, version: 1, kind: 'INGREDIENTS', scalesWithSize: false, options: [
      opt('opt_ing_onion', 'بصل', 'Onion', '0', { sortOrder: 10 }), opt('opt_ing_tomato', 'طماطم', 'Tomato', '0', { sortOrder: 20 }), opt('opt_ing_pickles', 'مخلل', 'Pickles', '0', { sortOrder: 30 }),
      opt('opt_ing_tahini', 'طحينة', 'Tahini', '0', { sortOrder: 40, extraPriceDelta: m4('5'), allergens: ['SESAME'] }), opt('opt_ing_garlic', 'ثومية', 'Garlic sauce', '0', { sortOrder: 50, extraPriceDelta: m4('5') }),
    ] },
    { id: 'mod_egg_style', name: L('طريقة البيض', 'Egg style'), selectionRule: 'SINGLE', min: 1, max: 1, active: true, version: 1, kind: 'STANDARD', options: [
      opt('opt_egg_omelette', 'أومليت', 'Omelette', '0', { isDefault: true, sortOrder: 10 }), opt('opt_egg_boiled', 'مسلوق', 'Boiled', '0', { sortOrder: 20 }), opt('opt_egg_sunny', 'عيون', 'Sunny side up', '0', { sortOrder: 30 }),
    ] },
    { id: 'mod_cheese_type', name: L('نوع الجبنة', 'Cheese type'), selectionRule: 'SINGLE', min: 1, max: 1, active: true, version: 1, kind: 'STANDARD', options: [
      opt('opt_cheese_white', 'جبنة بيضا', 'White cheese', '0', { isDefault: true, sortOrder: 10, allergens: ['DAIRY'] }), opt('opt_cheese_roumy', 'جبنة رومي', 'Roumy cheese', '5', { sortOrder: 20, allergens: ['DAIRY'] }),
    ] },
    { id: 'mod_breakfast_addons', name: L('إضافات الفطار', 'Breakfast add-ons'), selectionRule: 'MULTIPLE', min: 0, max: 3, active: true, version: 1, kind: 'STANDARD', options: [
      opt('opt_bf_egg', 'بيض', 'Eggs', '15', { sortOrder: 10, nestedGroupId: 'mod_egg_style', allergens: ['EGGS'] }), opt('opt_bf_cheese', 'جبنة', 'Cheese', '10', { sortOrder: 20, nestedGroupId: 'mod_cheese_type' }), opt('opt_bf_fries', 'بطاطس', 'Fries', '15', { sortOrder: 30 }),
    ] },
  );
  // existing direction groups: defaults and toppings per pizza half
  const sauce = db.modifierGroups.find((g) => g.id === 'mod_side_sauce');
  if (sauce) { sauce.options.forEach((o, i) => { o.sortOrder = (i + 1) * 10; }); const k = sauce.options.find((o) => o.id === 'opt_ketchup'); if (k) k.isDefault = true; sauce.scalesWithSize = false; }
  const tops = db.modifierGroups.find((g) => g.id === 'mod_pizza_toppings');
  if (tops) { tops.allowHalfPlacement = true; tops.scalesWithSize = true; tops.options.forEach((o, i) => { o.sortOrder = (i + 1) * 10; }); }

  // ───────── products
  const P = (p: Partial<Product> & Pick<Product, 'id' | 'sku' | 'name' | 'categoryId'>): Product => ({ unitId: 'unit_ea', taxPolicyId: 'tax_demo', modifierGroupIds: [], active: true, version: 1, createdAt: now, createdBranchId: 'branch_main', ...p });
  const sizes = (prefix: string, l: number) => [
    { id: 'v_s', name: L('صغير', 'Small'), priceDelta: m4('-35'), modifierMultiplier: '0.75', active: true, sku: `${prefix}-S`, barcode: `62210000${l}1`, calories: 650, sortOrder: 10, version: 1 },
    { id: 'v_m', name: L('وسط', 'Medium'), priceDelta: m4('0'), modifierMultiplier: '1', active: true, sku: `${prefix}-M`, barcode: `62210000${l}2`, calories: 950, isDefault: true, sortOrder: 20, version: 1 },
    { id: 'v_l', name: L('كبير', 'Large'), priceDelta: m4('45'), modifierMultiplier: '1.5', active: true, sku: `${prefix}-L`, barcode: `62210000${l}3`, calories: 1350, sortOrder: 30, version: 1 },
  ];
  const prods: Product[] = [
    // breakfast (breakfast daypart only)
    P({ id: 'p_foul', sku: 'BF-FOUL', name: L('فول بالزيت الحار', 'Foul with chili oil'), categoryId: 'cat_breakfast', colorCode: '#a16207', imageUrl: svgImage('🫘', '#fcd34d', '#b45309'), description: L('فول مدمس بالزيت الحار والكمون، معاه عيش بلدي', 'Fava beans with chili oil and cumin, with baladi bread'), calories: 420, modifierGroupIds: ['mod_bread'] }),
    P({ id: 'p_taameya', sku: 'BF-TAAMEYA', name: L('طعمية (6 قطع)', 'Taameya (6 pcs)'), categoryId: 'cat_breakfast', colorCode: '#65a30d', imageUrl: svgImage('🧆', '#bef264', '#4d7c0f'), description: L('طعمية خضرا مقرمشة بالسمسم', 'Crispy green falafel with sesame'), calories: 380, allergens: ['SESAME'], modifierGroupIds: ['mod_sandwich_ing'] }),
    P({ id: 'p_eggs_basterma', sku: 'BF-BASTERMA', name: L('بيض بالبسطرمة', 'Eggs with basterma'), categoryId: 'cat_breakfast', colorCode: '#ea580c', imageUrl: svgImage('🍳', '#fed7aa', '#c2410c'), description: L('3 بيضات بالبسطرمة في طاسة', 'Three eggs with basterma in a pan'), calories: 520, allergens: ['EGGS'], modifierGroupIds: ['mod_egg_style'] }),
    P({ id: 'p_egyptian_breakfast', sku: 'BF-COMPLETE', name: L('فطار مصري كامل', 'Full Egyptian breakfast'), categoryId: 'cat_breakfast', colorCode: '#f97316', imageUrl: svgImage('🥙', '#fdba74', '#9a3412'), description: L('فول، طعمية، بتنجان، سلطة، طحينة وعيش', 'Foul, taameya, eggplant, salad, tahini and bread'), calories: 980, allergens: ['SESAME', 'GLUTEN'], modifierGroupIds: ['mod_breakfast_addons'] }),
    P({ id: 'p_feteer', sku: 'BF-FETEER', name: L('فطير مشلتت', 'Feteer meshaltet'), categoryId: 'cat_breakfast', colorCode: '#d97706', imageUrl: svgImage('🥐', '#fde68a', '#b45309'), description: L('فطير بالسمنة البلدي، معاه عسل وجبنة قديمة', 'Layered pastry with honey and aged cheese'), calories: 1100, allergens: ['GLUTEN', 'DAIRY'] }),
    // meals & sandwiches
    P({ id: 'p_shawarma_sandwich', sku: 'ML-SHW-CHK', name: L('ساندوتش شاورما فراخ', 'Chicken shawarma sandwich'), categoryId: 'cat_meals', colorCode: '#eab308', imageUrl: svgImage('🌯', '#fde047', '#a16207'), description: L('شاورما فراخ بالثومية والمخلل', 'Chicken shawarma with garlic sauce and pickles'), calories: 560, allergens: ['GLUTEN'], modifierGroupIds: ['mod_bread', 'mod_sandwich_ing'] }),
    P({ id: 'p_beef_shawarma_sandwich', sku: 'ML-SHW-BEEF', name: L('ساندوتش شاورما لحمة', 'Beef shawarma sandwich'), categoryId: 'cat_meals', colorCode: '#b45309', imageUrl: svgImage('🥙', '#fcd34d', '#92400e'), description: L('شاورما لحمة بالطحينة والبصل', 'Beef shawarma with tahini and onion'), calories: 640, allergens: ['GLUTEN', 'SESAME'], modifierGroupIds: ['mod_bread', 'mod_sandwich_ing'] }),
    P({ id: 'p_fries_side', sku: 'ML-FRIES', name: L('بطاطس محمرة', 'French fries'), categoryId: 'cat_meals', colorCode: '#facc15', imageUrl: svgImage('🍟', '#fef08a', '#ca8a04'), description: L('بطاطس محمرة مقرمشة', 'Crispy french fries'), calories: 320, modifierGroupIds: ['mod_side_sauce'],
      variants: [
        { id: 'v_reg', name: L('عادي', 'Regular'), priceDelta: m4('0'), modifierMultiplier: '1', active: true, sku: 'ML-FRIES-R', barcode: '6221000010', calories: 320, isDefault: true, sortOrder: 10, version: 1 },
        { id: 'v_large', name: L('كبيرة', 'Large'), priceDelta: m4('12'), modifierMultiplier: '1', active: true, sku: 'ML-FRIES-L', barcode: '6221000011', calories: 480, sortOrder: 20, version: 1 },
      ] }),
    P({ id: 'p_shawarma_meal', sku: 'ML-MEAL-SHW', name: L('وجبة شاورما', 'Shawarma meal'), categoryId: 'cat_meals', colorCode: '#ca8a04', imageUrl: svgImage('🍱', '#fde68a', '#854d0e'), description: L('ساندوتش شاورما + بطاطس + مشروب. ترقية للحمة أو بطاطس كبيرة أو عصير فريش.', 'Shawarma sandwich + fries + drink. Upgrade to beef, large fries or fresh juice.'), calories: 1050, allergens: ['GLUTEN'], modifierGroupIds: ['mod_sandwich_ing'],
      combo: [
        { id: 'slot_sandwich', name: L('الساندوتش', 'Sandwich'), defaultProductId: 'p_shawarma_sandwich', required: true, sortOrder: 10, options: [{ productId: 'p_shawarma_sandwich', upcharge: m4('0') }, { productId: 'p_beef_shawarma_sandwich', upcharge: m4('20') }] },
        { id: 'slot_fries', name: L('البطاطس', 'Fries'), defaultProductId: 'p_fries_side', required: true, sortOrder: 20, options: [{ productId: 'p_fries_side', upcharge: m4('0'), variantId: 'v_reg', nestedGroupId: 'mod_side_sauce' }, { productId: 'p_fries_side', upcharge: m4('10'), variantId: 'v_large', nestedGroupId: 'mod_side_sauce' }] },
        { id: 'slot_drink', name: L('المشروب', 'Drink'), defaultProductId: 'p_pepsi', required: true, sortOrder: 30, options: [{ productId: 'p_pepsi', upcharge: m4('0') }, { productId: 'p_water', upcharge: m4('0') }, { productId: 'p_orange_juice', upcharge: m4('20') }] },
      ] }),
    // drinks (bar)
    P({ id: 'p_pepsi', sku: 'CD-PEPSI', name: L('بيبسي كانز', 'Pepsi can'), categoryId: 'cat_cold', colorCode: '#2563eb', imageUrl: svgImage('🥤', '#93c5fd', '#1d4ed8'), calories: 150 }),
    P({ id: 'p_water', sku: 'CD-WATER', name: L('مياه معدنية', 'Mineral water'), categoryId: 'cat_cold', taxPolicyId: 'tax_exempt', colorCode: '#0ea5e9', imageUrl: svgImage('💧', '#bae6fd', '#0369a1'), description: L('زجاجة 600 مل — معفاة من الضريبة', '600 ml bottle — tax exempt'), calories: 0 }),
    // pizzas: sizes with their own Large price, half-and-half in group PIZZA, toppings per half
    P({ id: 'p_pizza_chicken_ranch', sku: 'PZ-RANCH', name: L('بيتزا فراخ رانش', 'Chicken ranch pizza'), categoryId: 'cat_pizza', colorCode: '#dc2626', imageUrl: svgImage('🍕', '#fecaca', '#b91c1c'), description: L('فراخ مشوية، صوص رانش، موتزاريلا وفلفل ألوان', 'Grilled chicken, ranch sauce, mozzarella and peppers'), allergens: ['GLUTEN', 'DAIRY'], modifierGroupIds: ['mod_pizza_toppings'], halfAndHalf: true, halfGroup: 'PIZZA', halfPriceRatio: '0.5', variants: sizes('PZ-RANCH', 1), calories: 950 }),
    P({ id: 'p_pizza_veggie', sku: 'PZ-VEGGIE', name: L('بيتزا خضار', 'Veggie pizza'), categoryId: 'cat_pizza', colorCode: '#16a34a', imageUrl: svgImage('🍕', '#bbf7d0', '#15803d'), description: L('فلفل، مشروم، زيتون، بصل وطماطم', 'Peppers, mushroom, olives, onion and tomato'), allergens: ['GLUTEN', 'DAIRY'], modifierGroupIds: ['mod_pizza_toppings'], halfAndHalf: true, halfGroup: 'PIZZA', halfPriceRatio: '0.5', variants: sizes('PZ-VEGGIE', 2), calories: 820 }),
    P({ id: 'p_pizza_sausage', sku: 'PZ-SAUSAGE', name: L('بيتزا سجق', 'Sausage pizza'), categoryId: 'cat_pizza', colorCode: '#9a3412', imageUrl: svgImage('🍕', '#fed7aa', '#9a3412'), description: L('سجق إسكندراني، موتزاريلا وصوص طماطم', 'Alexandrian sausage, mozzarella and tomato sauce'), allergens: ['GLUTEN', 'DAIRY'], modifierGroupIds: ['mod_pizza_toppings'], halfAndHalf: true, halfGroup: 'PIZZA', halfPriceRatio: '0.5', variants: sizes('PZ-SAUSAGE', 3), calories: 1020 }),
  ];
  const price: Record<string, string> = { p_foul: '35', p_taameya: '30', p_eggs_basterma: '75', p_egyptian_breakfast: '140', p_feteer: '120', p_shawarma_sandwich: '85', p_beef_shawarma_sandwich: '105', p_fries_side: '30', p_shawarma_meal: '175', p_pepsi: '25', p_water: '15', p_pizza_chicken_ranch: '185', p_pizza_veggie: '150', p_pizza_sausage: '170' };
  let n = 0;
  const rule = (productId: string, channel: Channel, amount: string, variantId?: string): PriceRule => ({ id: `pr_m${++n}`, productId, branchId: 'branch_main', channel, amount: m4(amount), currency: 'EGP', effectiveFrom: from, effectiveTo: null, createdAt: now, createdBy: 'provisioning', version: 1, replacesRuleId: null, ...(variantId ? { variantId } : {}) });
  for (const p of prods) {
    db.products.push(p);
    db.availability.push({ productId: p.id, branchId: 'branch_main', state: 'AVAILABLE', reason: null, updatedAt: now, updatedBy: 'provisioning' });
    for (const ch of ['DINE_IN', 'TAKEAWAY'] as Channel[]) db.priceRules.push(rule(p.id, ch, price[p.id]));
    // delivery menu prices (+10 %, rounded to 5) for the meals and pizzas
    if (p.categoryId === 'cat_meals' || p.categoryId === 'cat_pizza' || p.id === 'p_pepsi' || p.id === 'p_water') db.priceRules.push(rule(p.id, 'DELIVERY', String(Math.ceil((Number(price[p.id]) * 1.1) / 5) * 5)));
  }
  // e-receipt item codes for the new items (the demo keeps a few older items unmapped on purpose)
  prods.forEach((p, i) => db.itemMappings.push({ productId: p.id, codeType: 'EGS', itemCode: `EG-DEMO-${String(100 + i).padStart(4, '0')}`, unitType: 'EA' }));
  // own Large prices (a size price rule overrides product price + size delta)
  for (const pid of ['p_pizza_chicken_ranch', 'p_pizza_veggie', 'p_pizza_sausage']) for (const ch of ['DINE_IN', 'TAKEAWAY'] as Channel[]) db.priceRules.push(rule(pid, ch, String(Number(price[pid]) + 55), 'v_l'));

  // existing direction pizzas join the PIZZA half group; their sizes get codes and a default
  for (const pid of ['p_pizza_margherita', 'p_pizza_pepperoni']) {
    const p = db.products.find((x) => x.id === pid);
    if (!p) continue;
    p.halfGroup = 'PIZZA'; p.halfPriceRatio = '0.5';
    p.imageUrl = svgImage('🍕', pid.endsWith('margherita') ? '#fecdd3' : '#fca5a5', '#be123c');
    (p.variants ?? []).forEach((v, i) => { v.sku = `${p.sku}-${v.name.en}`; v.sortOrder = (i + 1) * 10; v.version = 1; v.isDefault = v.id === 'v_m'; });
  }
  // pictures, descriptions and calories for the existing demo items (display only: prices and SKUs unchanged)
  const look: Record<string, [string, string, string, number, string?]> = {
    p_tea: ['🍵', '#fde68a', '#92400e', 5, 'شاي كشري بالنعناع أو من غير'], p_turkish_coffee: ['☕', '#d6d3d1', '#44403c', 10, 'قهوة تركي محوجة'], p_espresso: ['☕', '#e7e5e4', '#292524', 5],
    p_orange_juice: ['🍊', '#fed7aa', '#ea580c', 110, 'برتقال فريش معصور'], p_lemon_mint: ['🍋', '#d9f99d', '#4d7c0f', 90, 'ليمون بالنعناع ساقع'], p_hummus: ['🥣', '#fef3c7', '#a16207', 330, 'حمص بالطحينة وزيت الزيتون'],
    p_baba_ghanoush: ['🍆', '#e9d5ff', '#6b21a8', 280], p_green_salad: ['🥗', '#bbf7d0', '#166534', 120, 'خيار وطماطم وخس'], p_chicken_shawarma: ['🌯', '#fde047', '#a16207', 780, 'طبق شاورما فراخ بالرز والثومية'],
    p_kofta: ['🍢', '#fecaca', '#991b1b', 690, 'كفتة مشوية على الفحم'], p_mixed_grill: ['🍖', '#fca5a5', '#7f1d1d', 1150, 'كفتة، طرب، شيش طاووق وريش'], p_beef_burger: ['🍔', '#fcd34d', '#92400e', 860, 'برجر لحم بلدي 200 جرام'],
    p_om_ali: ['🥧', '#fde68a', '#b45309', 540, 'أم علي بالمكسرات والقشطة'], p_kunafa: ['🍮', '#fdba74', '#c2410c', 610],
  };
  for (const [pid, [e, a, b, cal, desc]] of Object.entries(look)) {
    const p = db.products.find((x) => x.id === pid);
    if (!p) continue;
    p.imageUrl = svgImage(e, a, b); p.calories = cal;
    if (desc) p.description = { ar: desc, en: p.name.en };
  }

  // ───────── dayparts and menus (Cairo time). The base menu is all day on every channel, without breakfast and
  // the shisha corner; breakfast is a daypart menu; shisha and nuts are dine-in dinner only.
  const businessToday = businessDate(nowMs, 'Africa/Cairo', '04:00');
  const ms: MenuState = {
    dayparts: [
      { id: 'dp_breakfast', name: L('فطار', 'Breakfast'), start: '07:00', end: '12:00', days: [0, 1, 2, 3, 4, 5, 6], color: '#f97316', active: true, sortOrder: 10, version: 1 },
      { id: 'dp_lunch', name: L('غدا', 'Lunch'), start: '12:00', end: '17:00', days: [0, 1, 2, 3, 4, 5, 6], color: '#22c55e', active: true, sortOrder: 20, version: 1 },
      { id: 'dp_dinner', name: L('عشا', 'Dinner'), start: '17:00', end: '02:00', days: [0, 1, 2, 3, 4, 5, 6], color: '#6366f1', active: true, sortOrder: 30, version: 1 },
    ],
    menus: [
      { id: 'menu_main', name: L('المنيو الأساسي', 'Main menu'), channels: ['DINE_IN', 'TAKEAWAY', 'DELIVERY'], branchIds: [], daypartIds: [], allCategories: true, categoryIds: [], productIds: [], excludedCategoryIds: ['cat_breakfast'], excludedProductIds: ['p_shisha', 'p_mixed_nuts'], active: true, sortOrder: 10, version: 1, updatedAt: now, updatedBy: 'provisioning' },
      { id: 'menu_breakfast', name: L('منيو الفطار', 'Breakfast menu'), channels: ['DINE_IN', 'TAKEAWAY', 'DELIVERY'], branchIds: [], daypartIds: ['dp_breakfast'], allCategories: false, categoryIds: ['cat_breakfast'], productIds: [], excludedCategoryIds: [], excludedProductIds: [], active: true, sortOrder: 20, version: 1, updatedAt: now, updatedBy: 'provisioning' },
      { id: 'menu_shisha', name: L('ركن الشيشة (صالة بالليل)', 'Shisha corner (dine-in, evening)'), channels: ['DINE_IN'], branchIds: ['branch_main'], daypartIds: ['dp_dinner'], allCategories: false, categoryIds: [], productIds: ['p_shisha', 'p_mixed_nuts'], excludedCategoryIds: [], excludedProductIds: [], active: true, sortOrder: 30, version: 1, updatedAt: now, updatedBy: 'provisioning' },
    ],
    optionAvailability: [
      { optionId: 'opt_mushroom', groupId: 'mod_pizza_toppings', branchId: 'branch_main', state: 'SOLD_OUT', soldOutFor: businessToday, reason: 'المشروم خلص من المورد', updatedAt: new Date(nowMs).toISOString(), updatedBy: 'u_manager_1' },
    ],
    bulkChanges: [],
  };
  db.menu = ms;
  const feteer = db.availability.find((a) => a.productId === 'p_feteer');
  if (feteer) Object.assign(feteer, { state: 'SOLD_OUT', reason: 'العجينة خلصت', soldOutFor: businessToday, updatedAt: new Date(nowMs).toISOString(), updatedBy: 'u_manager_1' });
}
