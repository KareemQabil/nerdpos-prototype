// Demo inventory: Egyptian ingredients for the demo menu, warehouses for both branches, suppliers, recipes for every
// demo product, three weeks of history (receipts, transfers, production, sales consumption, waste, a count), some items
// below minimum and some lots near expiry so the dashboards have content. Built through the same engine as the API.
import { zonedParts } from './clock';
import { D, m4, Decimal } from './money';
import type { DB } from './types';
import type { InventoryState, InvItem, Recipe, RecipeInput, PurchaseOrder, GoodsReceipt, Transfer, StockCount, ProductionRun, WasteRecord, SupplierReturn } from './types-inventory';
import { emptyInventory, invOf, post, qn, nextNumber, newId, versionNeeds, explodeProduct, onHand, activeVersion, type Actor } from './handlers/inventory-engine';

const DAY = 86_400_000;
type Lv = [number, number] | null;
interface ItemDef {
  id: string; ar: string; en: string; cat: string; kind?: 'RAW' | 'PREP' | 'RESALE'; unit: string; cost: string; pack?: [string, string, number];
  sup?: string; lots?: number; levels?: { s?: Lv; k?: Lv; s2?: Lv; k2?: Lv }; target?: { s?: number; k?: number; s2?: number; k2?: number }; productId?: string;
}

const CAT = { legumes: 'بقوليات وحبوب', meat: 'لحوم وفراخ', veg: 'خضار وفاكهة', dairy: 'ألبان وأجبان', grocery: 'بقالة وتوابل', oil: 'زيوت وسمن', bread: 'مخبوزات', drinks: 'مشروبات', prep: 'تجهيزات المطبخ', sweets: 'حلويات', shisha: 'شيشة', pack: 'تغليف' };

// [id, ar, en, category, unit, avg cost (EGP / stock unit), pack [ar, en, factor], supplier, lots: shelf-life days, levels, final targets]
const ITEMS: ItemDef[] = [
  { id: 'inv_fava_dry', ar: 'فول مدمس ناشف', en: 'Dry fava beans', cat: CAT.legumes, unit: 'unit_kg', cost: '48', pack: ['شيكارة 25 كجم', '25kg sack', 25], sup: 'sup_ahram', levels: { s: [10, 50], k: [3, 10] }, target: { s: 32, k: 6 } },
  { id: 'inv_chickpeas', ar: 'حمص الشام ناشف', en: 'Dry chickpeas', cat: CAT.legumes, unit: 'unit_kg', cost: '75', pack: ['شيكارة 10 كجم', '10kg sack', 10], sup: 'sup_ahram', levels: { s: [5, 20], k: [2, 6] }, target: { s: 14, k: 3.5 } },
  { id: 'inv_flour', ar: 'دقيق فاخر', en: 'Flour', cat: CAT.legumes, unit: 'unit_kg', cost: '30', pack: ['شيكارة 25 كجم', '25kg sack', 25], sup: 'sup_ahram', levels: { s: [10, 50], k: [3, 10], s2: [5, 25] }, target: { s: 40, k: 6, s2: 12 } },
  { id: 'inv_tahini', ar: 'طحينة', en: 'Tahini', cat: CAT.grocery, unit: 'unit_kg', cost: '165', pack: ['جركن 5 كجم', '5kg tub', 5], sup: 'sup_ahram', lots: 180, levels: { s: [5, 15], k: [3, 8], k2: [2, 5] }, target: { s: 4, k: 1.2, k2: 1 } },
  { id: 'inv_sugar', ar: 'سكر', en: 'Sugar', cat: CAT.grocery, unit: 'unit_kg', cost: '38', pack: ['شوال 50 كجم', '50kg sack', 50], sup: 'sup_ahram', levels: { s: [10, 50], k: [3, 10], s2: [5, 20] }, target: { s: 45, k: 7, s2: 9 } },
  { id: 'inv_salt', ar: 'ملح', en: 'Salt', cat: CAT.grocery, unit: 'unit_kg', cost: '12', pack: ['شيكارة 25 كجم', '25kg sack', 25], sup: 'sup_ahram', levels: { s: [2, 10], k: [1, 3] }, target: { s: 8, k: 2 } },
  { id: 'inv_cumin', ar: 'كمون مطحون', en: 'Ground cumin', cat: CAT.grocery, unit: 'unit_kg', cost: '260', sup: 'sup_ahram', levels: { s: [0.5, 2], k: [0.2, 0.5] }, target: { s: 1.5, k: 0.35 } },
  { id: 'inv_spice_shawarma', ar: 'بهارات شاورما', en: 'Shawarma spices', cat: CAT.grocery, unit: 'unit_kg', cost: '320', sup: 'sup_ahram', levels: { s: [0.5, 2], k: [0.2, 0.5] }, target: { s: 1.2, k: 0.3 } },
  { id: 'inv_tomato_paste', ar: 'صلصة طماطم', en: 'Tomato paste', cat: CAT.grocery, unit: 'unit_kg', cost: '65', pack: ['جردل 4 كجم', '4kg bucket', 4], sup: 'sup_ahram', lots: 365, levels: { s: [2, 8], k: [1, 3] }, target: { s: 6, k: 1.5 } },
  { id: 'inv_ketchup', ar: 'كاتشب', en: 'Ketchup', cat: CAT.grocery, unit: 'unit_kg', cost: '70', pack: ['جردل 5 كجم', '5kg bucket', 5], sup: 'sup_ahram', levels: { s: [2, 10], k: [1, 3] }, target: { s: 7, k: 1.6 } },
  { id: 'inv_mayo', ar: 'مايونيز', en: 'Mayonnaise', cat: CAT.grocery, unit: 'unit_kg', cost: '120', pack: ['جردل 4 كجم', '4kg bucket', 4], sup: 'sup_ahram', lots: 90, levels: { s: [2, 8], k: [1, 2] }, target: { s: 5, k: 1.2 } },
  { id: 'inv_vinegar', ar: 'خل', en: 'Vinegar', cat: CAT.grocery, unit: 'unit_l', cost: '20', pack: ['جركن 5 لتر', '5L jerrycan', 5], sup: 'sup_ahram', levels: { s: [2, 10], k: [1, 3] }, target: { s: 6, k: 1.5 } },
  { id: 'inv_tea', ar: 'شاي ناعم', en: 'Loose tea', cat: CAT.drinks, unit: 'unit_kg', cost: '280', pack: ['كرتونة 5 كجم', '5kg carton', 5], sup: 'sup_ahram', levels: { s: [2, 6], k: [1, 3] }, target: { s: 4.5, k: 0.6 } },
  { id: 'inv_coffee_tr', ar: 'بن تركي محوج', en: 'Turkish coffee (spiced)', cat: CAT.drinks, unit: 'unit_kg', cost: '720', pack: ['كيس 1 كجم', '1kg bag', 1], sup: 'sup_ahram', lots: 90, levels: { s: [1, 4], k: [0.5, 2] }, target: { s: 2.5, k: 0.8 } },
  { id: 'inv_coffee_esp', ar: 'بن إسبريسو', en: 'Espresso beans', cat: CAT.drinks, unit: 'unit_kg', cost: '950', pack: ['كيس 1 كجم', '1kg bag', 1], sup: 'sup_ahram', lots: 120, levels: { s: [1, 4], k: [0.5, 2] }, target: { s: 3, k: 1.2 } },
  { id: 'inv_soda_can', ar: 'مشروب غازي كانز', en: 'Soft drink can', cat: CAT.drinks, kind: 'RESALE', productId: 'p_soda', unit: 'unit_pcs', cost: '12', pack: ['كرتونة 24 كانز', 'Case of 24', 24], sup: 'sup_ahram', lots: 180, levels: { s: [48, 144], k: [24, 48] }, target: { s: 96, k: 30 } },
  { id: 'inv_oil', ar: 'زيت عباد الشمس', en: 'Sunflower oil', cat: CAT.oil, unit: 'unit_l', cost: '85', pack: ['جركن 18 لتر', '18L jerrycan', 18], sup: 'sup_ahram', levels: { s: [18, 54], k: [5, 18], k2: [3, 10] }, target: { s: 50, k: 9, k2: 2 } },
  { id: 'inv_olive_oil', ar: 'زيت زيتون', en: 'Olive oil', cat: CAT.oil, unit: 'unit_l', cost: '450', pack: ['جركن 5 لتر', '5L jerrycan', 5], sup: 'sup_ahram', levels: { s: [2, 10], k: [1, 3] }, target: { s: 7, k: 1.8 } },
  { id: 'inv_ghee', ar: 'سمنة بلدي', en: 'Ghee', cat: CAT.oil, unit: 'unit_kg', cost: '290', pack: ['برطمان 2 كجم', '2kg jar', 2], sup: 'sup_ahram', levels: { s: [2, 8], k: [1, 3] }, target: { s: 5, k: 1.5 } },
  { id: 'inv_milk', ar: 'لبن كامل الدسم', en: 'Full-cream milk', cat: CAT.dairy, unit: 'unit_l', cost: '40', pack: ['كرتونة 12 لتر', '12L carton', 12], sup: 'sup_ahram', lots: 7, levels: { s: [6, 24], k: [3, 12] }, target: { s: 10, k: 3 } },
  { id: 'inv_cream', ar: 'قشطة', en: 'Clotted cream', cat: CAT.dairy, unit: 'unit_kg', cost: '190', pack: ['علبة 1 كجم', '1kg tub', 1], sup: 'sup_ahram', lots: 5, levels: { s: [1, 4], k: [1, 3] }, target: { s: 2, k: 1.4 } },
  { id: 'inv_yogurt', ar: 'زبادي', en: 'Yogurt', cat: CAT.dairy, unit: 'unit_kg', cost: '70', pack: ['كرتونة 6 كجم', '6kg carton', 6], sup: 'sup_ahram', lots: 10, levels: { s: [2, 6], k: [1, 3] }, target: { s: 4, k: 1.2 } },
  { id: 'inv_cheddar', ar: 'جبنة شيدر شرايح', en: 'Cheddar slices', cat: CAT.dairy, unit: 'unit_kg', cost: '380', pack: ['كيس 1 كجم', '1kg pack', 1], sup: 'sup_ahram', lots: 30, levels: { s: [1, 4], k: [0.5, 2] }, target: { s: 3, k: 0.9 } },
  { id: 'inv_mozzarella', ar: 'جبنة موتزاريلا', en: 'Mozzarella', cat: CAT.dairy, unit: 'unit_kg', cost: '330', pack: ['كيس 2 كجم', '2kg pack', 2], sup: 'sup_ahram', lots: 20, levels: { s: [2, 6], k: [1, 3] }, target: { s: 3, k: 1.6 } },
  { id: 'inv_eggs', ar: 'بيض', en: 'Eggs', cat: CAT.dairy, unit: 'unit_pcs', cost: '4.5', pack: ['كرتونة 30 بيضة', 'Tray of 30', 30], sup: 'sup_nile', lots: 21, levels: { s: [60, 180], k: [30, 60] }, target: { s: 120, k: 42 } },
  { id: 'inv_beef_mince', ar: 'لحمة مفرومة', en: 'Minced beef', cat: CAT.meat, unit: 'unit_kg', cost: '390', sup: 'sup_butcher', lots: 3, levels: { s: [8, 25], k: [3, 8], k2: [2, 6] }, target: { s: 6, k: 3.5, k2: 0 } },
  { id: 'inv_beef_cubes', ar: 'لحمة كندوز مكعبات', en: 'Beef cubes', cat: CAT.meat, unit: 'unit_kg', cost: '460', sup: 'sup_butcher', lots: 3, levels: { s: [4, 12], k: [2, 5] }, target: { s: 9, k: 2.6 } },
  { id: 'inv_chicken_breast', ar: 'صدور فراخ', en: 'Chicken breast', cat: CAT.meat, unit: 'unit_kg', cost: '230', pack: ['كرتونة 10 كجم', '10kg carton', 10], sup: 'sup_nile', lots: 4, levels: { s: [8, 25], k: [3, 8] }, target: { s: 15, k: 4 } },
  { id: 'inv_pepperoni', ar: 'بيبروني', en: 'Pepperoni', cat: CAT.meat, unit: 'unit_kg', cost: '650', pack: ['كيس 1 كجم', '1kg pack', 1], sup: 'sup_ahram', lots: 60, levels: { s: [0.5, 2], k: [0.3, 1] }, target: { s: 1.5, k: 0.6 } },
  { id: 'inv_tomato', ar: 'طماطم', en: 'Tomatoes', cat: CAT.veg, unit: 'unit_kg', cost: '16', pack: ['قفص 20 كجم', '20kg crate', 20], sup: 'sup_nile', levels: { s: [10, 40], k: [3, 10], k2: [2, 8] }, target: { s: 24, k: 5, k2: 4 } },
  { id: 'inv_cucumber', ar: 'خيار', en: 'Cucumbers', cat: CAT.veg, unit: 'unit_kg', cost: '18', pack: ['قفص 15 كجم', '15kg crate', 15], sup: 'sup_nile', levels: { s: [5, 20], k: [2, 6] }, target: { s: 11, k: 3 } },
  { id: 'inv_lettuce', ar: 'خس بلدي', en: 'Lettuce (head)', cat: CAT.veg, unit: 'unit_pcs', cost: '10', pack: ['شوال 20 راس', 'Bag of 20', 20], sup: 'sup_nile', levels: { s: [10, 40], k: [4, 12] }, target: { s: 22, k: 6 } },
  { id: 'inv_onion', ar: 'بصل', en: 'Onions', cat: CAT.veg, unit: 'unit_kg', cost: '14', pack: ['شوال 25 كجم', '25kg sack', 25], sup: 'sup_nile', levels: { s: [10, 40], k: [3, 8] }, target: { s: 28, k: 4 } },
  { id: 'inv_garlic', ar: 'ثوم', en: 'Garlic', cat: CAT.veg, unit: 'unit_kg', cost: '85', pack: ['شوال 10 كجم', '10kg sack', 10], sup: 'sup_nile', levels: { s: [2, 8], k: [0.5, 2] }, target: { s: 5, k: 1.2 } },
  { id: 'inv_eggplant', ar: 'باذنجان رومي', en: 'Eggplant', cat: CAT.veg, unit: 'unit_kg', cost: '20', pack: ['قفص 15 كجم', '15kg crate', 15], sup: 'sup_nile', levels: { s: [5, 20], k: [2, 6] }, target: { s: 9, k: 3 } },
  { id: 'inv_parsley', ar: 'بقدونس (حزمة)', en: 'Parsley (bunch)', cat: CAT.veg, unit: 'unit_pcs', cost: '4', sup: 'sup_nile', levels: { k: [10, 30] }, target: { k: 18 } },
  { id: 'inv_mint', ar: 'نعناع (حزمة)', en: 'Mint (bunch)', cat: CAT.veg, unit: 'unit_pcs', cost: '5', sup: 'sup_nile', levels: { k: [6, 20] }, target: { k: 11 } },
  { id: 'inv_lemon', ar: 'ليمون', en: 'Lemons', cat: CAT.veg, unit: 'unit_kg', cost: '45', pack: ['شوال 10 كجم', '10kg sack', 10], sup: 'sup_nile', levels: { s: [5, 15], k: [2, 5] }, target: { s: 8, k: 2.4 } },
  { id: 'inv_orange', ar: 'برتقال بلدي للعصير', en: 'Juice oranges', cat: CAT.veg, unit: 'unit_kg', cost: '28', pack: ['قفص 20 كجم', '20kg crate', 20], sup: 'sup_nile', levels: { s: [20, 60], k: [8, 20] }, target: { s: 12, k: 6 } },
  { id: 'inv_potato', ar: 'بطاطس', en: 'Potatoes', cat: CAT.veg, unit: 'unit_kg', cost: '18', pack: ['شوال 25 كجم', '25kg sack', 25], sup: 'sup_nile', levels: { s: [15, 50], k: [5, 15] }, target: { s: 34, k: 8 } },
  { id: 'inv_baladi_bread', ar: 'عيش بلدي', en: 'Baladi bread', cat: CAT.bread, unit: 'unit_pcs', cost: '1.5', pack: ['كيس 50 رغيف', 'Bag of 50', 50], sup: 'sup_bakery', levels: { k: [60, 200], k2: [20, 60] }, target: { k: 140, k2: 25 } },
  { id: 'inv_shami_bread', ar: 'عيش شامي', en: 'Pita bread', cat: CAT.bread, unit: 'unit_pcs', cost: '3', pack: ['كيس 40 رغيف', 'Bag of 40', 40], sup: 'sup_bakery', levels: { k: [40, 120] }, target: { k: 70 } },
  { id: 'inv_burger_bun', ar: 'عيش برجر بالسمسم', en: 'Sesame burger buns', cat: CAT.bread, unit: 'unit_pcs', cost: '6', pack: ['كيس 12 عيشة', 'Bag of 12', 12], sup: 'sup_bakery', levels: { k: [24, 72] }, target: { k: 36 } },
  { id: 'inv_kunafa_dough', ar: 'كنافة خام', en: 'Kunafa dough', cat: CAT.sweets, unit: 'unit_kg', cost: '60', pack: ['كيس 5 كجم', '5kg bag', 5], sup: 'sup_bakery', lots: 4, levels: { k: [2, 6] }, target: { k: 0 } },
  { id: 'inv_puff', ar: 'رقاق (لأم علي)', en: 'Roqaq pastry', cat: CAT.sweets, unit: 'unit_kg', cost: '95', pack: ['كيس 1 كجم', '1kg bag', 1], sup: 'sup_bakery', lots: 10, levels: { s: [1, 4], k: [0.5, 2] }, target: { s: 2, k: 1.1 } },
  { id: 'inv_nuts', ar: 'مكسرات مشكلة', en: 'Mixed nuts', cat: CAT.sweets, unit: 'unit_kg', cost: '620', pack: ['كيس 1 كجم', '1kg bag', 1], sup: 'sup_ahram', levels: { s: [1, 3], k: [0.5, 1.5] }, target: { s: 2.2, k: 0.7 } },
  { id: 'inv_molasses', ar: 'معسل تفاح', en: 'Apple molasses', cat: CAT.shisha, unit: 'unit_kg', cost: '420', pack: ['علبة 250 جم', '250g tin', 0.25], sup: 'sup_ahram', levels: { k: [0.5, 2] }, target: { k: 1.25 } },
  { id: 'inv_charcoal', ar: 'فحم شيشة', en: 'Shisha charcoal', cat: CAT.shisha, unit: 'unit_kg', cost: '35', pack: ['كرتونة 10 كجم', '10kg carton', 10], sup: 'sup_ahram', levels: { k: [3, 10] }, target: { k: 6 } },
  { id: 'inv_fava_split', ar: 'فول مدشوش (للطعمية)', en: 'Split fava beans', cat: CAT.legumes, unit: 'unit_kg', cost: '45', pack: ['شيكارة 25 كجم', '25kg sack', 25], sup: 'sup_ahram', levels: { s: [10, 40], k: [3, 10] }, target: { s: 20, k: 4 } },
  { id: 'inv_sesame', ar: 'سمسم', en: 'Sesame', cat: CAT.grocery, unit: 'unit_kg', cost: '180', pack: ['كيس 1 كجم', '1kg bag', 1], sup: 'sup_ahram', levels: { s: [1, 3], k: [0.5, 1] }, target: { s: 2, k: 0.6 } },
  { id: 'inv_pickles', ar: 'مخلل مشكل', en: 'Mixed pickles', cat: CAT.grocery, unit: 'unit_kg', cost: '40', pack: ['جردل 5 كجم', '5kg bucket', 5], sup: 'sup_ahram', levels: { s: [2, 10], k: [1, 3] }, target: { s: 6, k: 1.8 } },
  { id: 'inv_olives', ar: 'زيتون أسود', en: 'Black olives', cat: CAT.grocery, unit: 'unit_kg', cost: '120', pack: ['جردل 3 كجم', '3kg bucket', 3], sup: 'sup_ahram', levels: { s: [1, 4], k: [0.5, 1.5] }, target: { s: 3, k: 1 } },
  { id: 'inv_honey', ar: 'عسل نحل', en: 'Honey', cat: CAT.grocery, unit: 'unit_kg', cost: '260', pack: ['برطمان 1 كجم', '1kg jar', 1], sup: 'sup_ahram', levels: { s: [1, 4], k: [0.5, 1.5] }, target: { s: 2, k: 0.7 } },
  { id: 'inv_white_cheese', ar: 'جبنة بيضا', en: 'White cheese', cat: CAT.dairy, unit: 'unit_kg', cost: '130', pack: ['علبة 2 كجم', '2kg tub', 2], sup: 'sup_ahram', lots: 30, levels: { s: [2, 8], k: [1, 3] }, target: { s: 5, k: 1.5 } },
  { id: 'inv_basterma', ar: 'بسطرمة', en: 'Basterma', cat: CAT.meat, unit: 'unit_kg', cost: '950', sup: 'sup_ahram', lots: 30, levels: { s: [0.5, 2], k: [0.3, 1] }, target: { s: 1, k: 0.4 } },
  { id: 'inv_sausage', ar: 'سجق إسكندراني', en: 'Alexandrian sausage', cat: CAT.meat, unit: 'unit_kg', cost: '380', sup: 'sup_butcher', lots: 3, levels: { s: [2, 6], k: [1, 3] }, target: { s: 3, k: 1.2 } },
  { id: 'inv_pepper', ar: 'فلفل رومي', en: 'Bell peppers', cat: CAT.veg, unit: 'unit_kg', cost: '30', pack: ['قفص 10 كجم', '10kg crate', 10], sup: 'sup_nile', levels: { s: [3, 10], k: [1, 3] }, target: { s: 6, k: 1.5 } },
  { id: 'inv_mushroom', ar: 'مشروم فريش', en: 'Fresh mushrooms', cat: CAT.veg, unit: 'unit_kg', cost: '160', pack: ['علبة 1 كجم', '1kg box', 1], sup: 'sup_nile', lots: 5, levels: { s: [1, 3], k: [0.5, 1.5] }, target: { s: 1.5, k: 0.8 } },
  { id: 'inv_fino_bread', ar: 'عيش فينو', en: 'Fino rolls', cat: CAT.bread, unit: 'unit_pcs', cost: '2.5', pack: ['كيس 25 عيشة', 'Bag of 25', 25], sup: 'sup_bakery', levels: { k: [30, 90] }, target: { k: 45 } },
  { id: 'inv_saj_bread', ar: 'عيش صاج', en: 'Saj bread', cat: CAT.bread, unit: 'unit_pcs', cost: '4', pack: ['كيس 20 رغيف', 'Bag of 20', 20], sup: 'sup_bakery', levels: { k: [20, 60] }, target: { k: 25 } },
  { id: 'inv_water', ar: 'مياه معدنية 600 مل', en: 'Mineral water 600ml', cat: CAT.drinks, kind: 'RESALE', productId: 'p_water', unit: 'unit_pcs', cost: '4.5', pack: ['كرتونة 12 زجاجة', 'Case of 12', 12], sup: 'sup_ahram', levels: { s: [48, 144], k: [24, 48] }, target: { s: 72, k: 30 } },
  { id: 'inv_box', ar: 'علبة تيك أواي', en: 'Takeaway box', cat: CAT.pack, unit: 'unit_pcs', cost: '3', pack: ['كرتونة 100 علبة', 'Carton of 100', 100], sup: 'sup_ahram', levels: { s: [100, 400], k: [50, 150] }, target: { s: 250, k: 80 } },
  // preparations (made in the kitchen with a production run)
  { id: 'inv_prep_taameya', ar: 'عجينة طعمية', en: 'Taameya mix', cat: CAT.prep, kind: 'PREP', unit: 'unit_kg', cost: '0', lots: 2, levels: { k: [2, 6] }, target: { k: 2.5 } },
  { id: 'inv_prep_tahini_sauce', ar: 'صوص طحينة جاهز', en: 'Tahini sauce (prepared)', cat: CAT.prep, kind: 'PREP', unit: 'unit_kg', cost: '0', lots: 3, levels: { k: [2, 6] }, target: { k: 2.8 } },
  { id: 'inv_prep_chickpeas', ar: 'حمص مسلوق', en: 'Boiled chickpeas', cat: CAT.prep, kind: 'PREP', unit: 'unit_kg', cost: '0', lots: 3, levels: { k: [2, 6] }, target: { k: 3.1 } },
  { id: 'inv_prep_foul', ar: 'فول مدمس مطبوخ', en: 'Cooked foul medames', cat: CAT.prep, kind: 'PREP', unit: 'unit_kg', cost: '0', lots: 2, levels: { k: [3, 8] }, target: { k: 2.4 } },
  { id: 'inv_prep_kofta', ar: 'كفتة متبلة', en: 'Seasoned kofta mix', cat: CAT.prep, kind: 'PREP', unit: 'unit_kg', cost: '0', lots: 2, levels: { k: [3, 8] }, target: { k: 4.2 } },
  { id: 'inv_prep_shawarma', ar: 'فراخ شاورما متبلة', en: 'Marinated shawarma chicken', cat: CAT.prep, kind: 'PREP', unit: 'unit_kg', cost: '0', lots: 2, levels: { k: [3, 8] }, target: { k: 3.6 } },
  { id: 'inv_prep_pizza_dough', ar: 'عجينة بيتزا', en: 'Pizza dough', cat: CAT.prep, kind: 'PREP', unit: 'unit_kg', cost: '0', lots: 2, levels: { k: [1, 4] }, target: { k: 1.8 } },
  { id: 'inv_prep_toumeya', ar: 'ثومية', en: 'Toumeya (garlic sauce)', cat: CAT.prep, kind: 'PREP', unit: 'unit_kg', cost: '0', lots: 5, levels: { k: [1, 3] }, target: { k: 1.3 } },
];

// recipes: [itemId, quantity in stock unit, waste %]
type In = [string, number, number?];
const PREP_RECIPES: [string, number, In[], string?][] = [
  ['inv_prep_tahini_sauce', 5, [['inv_tahini', 2], ['inv_lemon', 0.6, 10], ['inv_garlic', 0.1, 5], ['inv_salt', 0.03], ['inv_cumin', 0.01]], 'طحينة + ليمون + ثوم + مية (المية ملهاش تكلفة)'],
  ['inv_prep_chickpeas', 2.2, [['inv_chickpeas', 1], ['inv_salt', 0.01]], 'الحمص بيتنقع ليلة ويتسلق — الكيلو بيطلع 2.2 كيلو'],
  ['inv_prep_foul', 2.5, [['inv_fava_dry', 1], ['inv_salt', 0.01], ['inv_cumin', 0.005]], 'تدميس على نار هادية — الكيلو بيطلع 2.5 كيلو'],
  ['inv_prep_kofta', 5.5, [['inv_beef_mince', 5], ['inv_onion', 0.4, 10], ['inv_parsley', 2], ['inv_salt', 0.05], ['inv_cumin', 0.03]], ''],
  ['inv_prep_shawarma', 5, [['inv_chicken_breast', 5, 4], ['inv_yogurt', 0.5], ['inv_spice_shawarma', 0.08], ['inv_oil', 0.15], ['inv_garlic', 0.05], ['inv_vinegar', 0.1], ['inv_lemon', 0.1]], ''],
  ['inv_prep_pizza_dough', 1.6, [['inv_flour', 1], ['inv_oil', 0.03], ['inv_salt', 0.02], ['inv_sugar', 0.01]], 'الكيلو دقيق + مية وخميرة = 1.6 كيلو عجينة'],
  ['inv_prep_taameya', 3, [['inv_fava_split', 2], ['inv_parsley', 4], ['inv_onion', 0.3, 10], ['inv_garlic', 0.1, 5], ['inv_salt', 0.03], ['inv_cumin', 0.02]], 'الفول المدشوش بيتنقع ويتفرم مع الخضرة'],
  ['inv_prep_toumeya', 2, [['inv_garlic', 0.3, 5], ['inv_oil', 1.4], ['inv_lemon', 0.2], ['inv_salt', 0.02]], ''],
];
const MENU_RECIPES: [string, In[]][] = [
  ['p_tea', [['inv_tea', 0.004], ['inv_sugar', 0.015]]],
  ['p_turkish_coffee', [['inv_coffee_tr', 0.008], ['inv_sugar', 0.007]]],
  ['p_espresso', [['inv_coffee_esp', 0.018]]],
  ['p_orange_juice', [['inv_orange', 0.45, 5], ['inv_sugar', 0.02]]],
  ['p_lemon_mint', [['inv_lemon', 0.12], ['inv_mint', 0.15], ['inv_sugar', 0.03]]],
  ['p_hummus', [['inv_prep_chickpeas', 0.15], ['inv_prep_tahini_sauce', 0.05], ['inv_olive_oil', 0.01], ['inv_lemon', 0.02], ['inv_baladi_bread', 2]]],
  ['p_baba_ghanoush', [['inv_eggplant', 0.3, 15], ['inv_prep_tahini_sauce', 0.04], ['inv_garlic', 0.005], ['inv_olive_oil', 0.01], ['inv_baladi_bread', 2]]],
  ['p_green_salad', [['inv_tomato', 0.15, 5], ['inv_cucumber', 0.12, 5], ['inv_lettuce', 0.25], ['inv_onion', 0.03], ['inv_lemon', 0.02], ['inv_olive_oil', 0.01]]],
  ['p_chicken_shawarma', [['inv_prep_shawarma', 0.17], ['inv_shami_bread', 2], ['inv_prep_toumeya', 0.03], ['inv_tomato', 0.03], ['inv_potato', 0.1, 10], ['inv_oil', 0.02]]],
  ['p_kofta', [['inv_prep_kofta', 0.22], ['inv_baladi_bread', 2], ['inv_prep_tahini_sauce', 0.04], ['inv_tomato', 0.05], ['inv_onion', 0.03]]],
  ['p_mixed_grill', [['inv_prep_kofta', 0.15], ['inv_chicken_breast', 0.15, 5], ['inv_beef_cubes', 0.15, 5], ['inv_baladi_bread', 2], ['inv_prep_tahini_sauce', 0.05], ['inv_tomato', 0.05]]],
  ['p_beef_burger', [['inv_beef_mince', 0.13, 3], ['inv_burger_bun', 1], ['inv_cheddar', 0.02], ['inv_lettuce', 0.1], ['inv_tomato', 0.03], ['inv_potato', 0.15, 10], ['inv_oil', 0.03], ['inv_ketchup', 0.02]]],
  ['p_om_ali', [['inv_puff', 0.08], ['inv_milk', 0.25], ['inv_sugar', 0.04], ['inv_nuts', 0.008], ['inv_cream', 0.02], ['inv_ghee', 0.01]]],
  ['p_kunafa', [['inv_kunafa_dough', 0.12], ['inv_ghee', 0.03], ['inv_cream', 0.04], ['inv_sugar', 0.05], ['inv_nuts', 0.01]]],
  ['p_pizza_margherita', [['inv_prep_pizza_dough', 0.25], ['inv_tomato_paste', 0.08], ['inv_mozzarella', 0.12], ['inv_olive_oil', 0.01]]],
  ['p_pizza_pepperoni', [['inv_prep_pizza_dough', 0.25], ['inv_tomato_paste', 0.08], ['inv_mozzarella', 0.12], ['inv_pepperoni', 0.04]]],
  ['p_fries', [['inv_potato', 0.25, 10], ['inv_oil', 0.04], ['inv_salt', 0.003]]],
  ['p_rings', [['inv_onion', 0.2, 10], ['inv_flour', 0.05], ['inv_eggs', 1], ['inv_oil', 0.05]]],
  ['p_burger_combo', [['inv_beef_mince', 0.13, 3], ['inv_burger_bun', 1], ['inv_cheddar', 0.02], ['inv_lettuce', 0.1], ['inv_tomato', 0.03]]],
  ['p_shisha', [['inv_molasses', 0.02], ['inv_charcoal', 0.15]]],
  // menu & pricing area products (breakfast, sandwiches, pizzas); sandwich bread comes from the bread choice
  ['p_foul', [['inv_prep_foul', 0.25], ['inv_oil', 0.02], ['inv_cumin', 0.001], ['inv_baladi_bread', 2]]],
  ['p_taameya', [['inv_prep_taameya', 0.18], ['inv_oil', 0.03], ['inv_sesame', 0.005]]],
  ['p_eggs_basterma', [['inv_eggs', 3], ['inv_basterma', 0.025], ['inv_ghee', 0.01], ['inv_baladi_bread', 2]]],
  ['p_egyptian_breakfast', [['inv_prep_foul', 0.2], ['inv_prep_taameya', 0.12], ['inv_eggs', 2], ['inv_white_cheese', 0.05], ['inv_pickles', 0.03], ['inv_oil', 0.02], ['inv_baladi_bread', 3]]],
  ['p_feteer', [['inv_flour', 0.25], ['inv_ghee', 0.06], ['inv_honey', 0.05], ['inv_white_cheese', 0.05]]],
  ['p_shawarma_sandwich', [['inv_prep_shawarma', 0.1], ['inv_prep_toumeya', 0.02], ['inv_pickles', 0.02], ['inv_tomato', 0.02]]],
  ['p_beef_shawarma_sandwich', [['inv_beef_cubes', 0.1, 5], ['inv_spice_shawarma', 0.003], ['inv_prep_tahini_sauce', 0.02], ['inv_onion', 0.02], ['inv_tomato', 0.02]]],
  ['p_fries_side', [['inv_potato', 0.25, 10], ['inv_oil', 0.04], ['inv_salt', 0.003]]],
  ['p_shawarma_meal', [['inv_box', 1]]],
  ['p_pepsi', [['inv_soda_can', 1]]],
  ['p_pizza_chicken_ranch', [['inv_prep_pizza_dough', 0.25], ['inv_mozzarella', 0.12], ['inv_chicken_breast', 0.1, 5], ['inv_mayo', 0.04], ['inv_tomato_paste', 0.05]]],
  ['p_pizza_veggie', [['inv_prep_pizza_dough', 0.25], ['inv_tomato_paste', 0.08], ['inv_mozzarella', 0.1], ['inv_pepper', 0.05], ['inv_mushroom', 0.04], ['inv_olives', 0.03], ['inv_onion', 0.03]]],
  ['p_pizza_sausage', [['inv_prep_pizza_dough', 0.25], ['inv_tomato_paste', 0.08], ['inv_mozzarella', 0.12], ['inv_sausage', 0.07]]],
  ['p_mixed_nuts', [['inv_nuts', 0.04]]],
];
const MOD_RECIPES: [string, string | null, In[]][] = [
  ['opt_size_large', 'p_tea', [['inv_tea', 0.002], ['inv_sugar', 0.005]]],
  ['opt_size_large', 'p_turkish_coffee', [['inv_coffee_tr', 0.004]]],
  ['opt_size_large', 'p_orange_juice', [['inv_orange', 0.2, 5]]],
  ['opt_size_large', 'p_lemon_mint', [['inv_lemon', 0.05], ['inv_mint', 0.05], ['inv_sugar', 0.01]]],
  ['opt_cheese', null, [['inv_cheddar', 0.03]]],
  ['opt_egg', null, [['inv_eggs', 1]]],
  ['opt_x_cheese', null, [['inv_mozzarella', 0.06]]],
  ['opt_garlic', null, [['inv_prep_toumeya', 0.03]]],
  ['opt_ketchup', null, [['inv_ketchup', 0.02]]],
  ['opt_olives', null, [['inv_olives', 0.03]]],
  ['opt_mushroom', null, [['inv_mushroom', 0.04]]],
  ['opt_bread_shami', null, [['inv_shami_bread', 1]]],
  ['opt_bread_fino', null, [['inv_fino_bread', 1]]],
  ['opt_bread_saj', null, [['inv_saj_bread', 1]]],
  ['opt_bf_egg', null, [['inv_eggs', 2]]],
  ['opt_bf_cheese', null, [['inv_white_cheese', 0.05]]],
  ['opt_bf_fries', null, [['inv_potato', 0.15, 10], ['inv_oil', 0.02]]],
];
// portions sold per day in the main branch (consumption history)
const DAILY: Record<string, number> = {
  p_tea: 42, p_turkish_coffee: 18, p_espresso: 10, p_orange_juice: 15, p_lemon_mint: 12, p_hummus: 14, p_baba_ghanoush: 10, p_green_salad: 12,
  p_chicken_shawarma: 24, p_kofta: 16, p_mixed_grill: 8, p_beef_burger: 14, p_om_ali: 9, p_kunafa: 6, p_pizza_margherita: 4, p_pizza_pepperoni: 3, p_fries: 8, p_soda: 20, p_shisha: 6,
  p_foul: 20, p_taameya: 18, p_eggs_basterma: 6, p_egyptian_breakfast: 8, p_feteer: 4, p_shawarma_sandwich: 22, p_beef_shawarma_sandwich: 10, p_fries_side: 12, p_pepsi: 15, p_water: 25, p_pizza_chicken_ranch: 2, p_pizza_veggie: 2, p_pizza_sausage: 2,
};

const WH = { s: 'wh_main_store', k: 'wh_main_kitchen', s2: 'wh_second_store', k2: 'wh_second_kitchen' } as const;

function enteredOf(db: DB, item: { stockUnitId: string }, q: number): { q: string; u: string } {
  const code = db.units.find((u) => u.id === item.stockUnitId)?.code;
  if (code === 'KG' && q < 1) return { q: qn(D(q).times(1000)), u: 'unit_g' };
  if (code === 'L' && q < 1) return { q: qn(D(q).times(1000)), u: 'unit_ml' };
  return { q: qn(q), u: item.stockUnitId };
}

export function seedInventory(db: DB, nowMs: number) {
  // units for stock (catalog units; the menu keeps "each")
  const units: [string, string, number][] = [['unit_kg', 'KG', 3], ['unit_g', 'G', 0], ['unit_l', 'L', 3], ['unit_ml', 'ML', 0], ['unit_pcs', 'PCS', 0]];
  for (const [id, code, precision] of units) if (!db.units.some((u) => u.id === id || u.code === code)) db.units.push({ id, code, precision, active: true, used: true, version: 1 });

  const p = zonedParts(nowMs, 'Africa/Cairo');
  const midnight = nowMs - ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 - (nowMs % 1000);
  const at = (daysAgo: number, hh: number, mm = 0) => Math.min(midnight - daysAgo * DAY + (hh * 60 + mm) * 60_000, nowMs - (daysAgo === 0 ? 20 * 60_000 : 0));
  const iso = (ms: number) => new Date(ms).toISOString();
  const ymd = (ms: number) => { const z = zonedParts(ms, 'Africa/Cairo'); return `${z.year}-${String(z.month).padStart(2, '0')}-${String(z.day).padStart(2, '0')}`; };
  const created = iso(at(30, 9));

  const base = emptyInventory();
  base.warehouses = [
    { id: WH.s, branchId: 'branch_main', name: 'المخزن الرئيسي', kind: 'STORE', active: true, salesDefault: false, version: 1, createdAt: created, history: [{ at: created, by: 'provisioning', text: 'created' }] },
    { id: WH.k, branchId: 'branch_main', name: 'المطبخ', kind: 'KITCHEN', active: true, salesDefault: true, version: 1, createdAt: created, history: [{ at: created, by: 'provisioning', text: 'created — sales warehouse of the branch' }] },
    { id: WH.s2, branchId: 'branch_second', name: 'مخزن الفرع التاني', kind: 'STORE', active: true, salesDefault: false, version: 1, createdAt: created, history: [{ at: created, by: 'provisioning', text: 'created' }] },
    { id: WH.k2, branchId: 'branch_second', name: 'مطبخ الفرع التاني', kind: 'KITCHEN', active: true, salesDefault: true, version: 1, createdAt: created, history: [{ at: created, by: 'provisioning', text: 'created — sales warehouse of the branch' }] },
  ];
  base.suppliers = [
    { id: 'sup_ahram', name: 'مخازن الأهرام للمواد الغذائية', taxId: '512-334-871', phone: '01001234567', contactName: 'أ. مجدي عبد الحميد', paymentTerms: 'آجل 15 يوم', address: 'العبور — المنطقة الصناعية', notes: 'بقالة وزيوت وألبان وبقوليات. التوريد يوم الأحد والأربع.', active: true, version: 1, createdAt: created },
    { id: 'sup_nile', name: 'مزارع النيل', taxId: '498-221-063', phone: '01112345678', contactName: 'الحاج سعيد', paymentTerms: 'كاش عند الاستلام', address: 'سوق العبور — عنبر 12', notes: 'خضار وفاكهة وفراخ وبيض — توريد يومي الصبح بدري.', active: true, version: 1, createdAt: created },
    { id: 'sup_butcher', name: 'جزارة الأمانة', taxId: null, phone: '01223456789', contactName: 'المعلم رضا', paymentTerms: 'أسبوعي', address: 'مدينة نصر — شارع مكرم عبيد', notes: 'لحمة مفرومة وكندوز — طازة كل يومين.', active: true, version: 1, createdAt: created },
    { id: 'sup_bakery', name: 'مخبز الشروق', taxId: null, phone: '01098765432', contactName: 'أم محمد', paymentTerms: 'كاش', address: 'مدينة نصر', notes: 'عيش بلدي وشامي وبرجر وكنافة ورقاق — كل يوم الساعة 7.', active: true, version: 1, createdAt: created },
  ];
  base.items = ITEMS.map((d): InvItem => {
    const levels: InvItem['levels'] = {};
    for (const [k, v] of Object.entries(d.levels ?? {})) if (v) levels[WH[k as keyof typeof WH]] = { min: qn(v[0]), par: qn(v[1]) };
    const packs = d.pack ? [{ id: `pk_${d.id}`, name: { ar: d.pack[0], en: d.pack[1] }, factor: qn(d.pack[2]) }] : [];
    return {
      id: d.id, productId: d.productId ?? d.id, sku: d.id.replace('inv_', '').toUpperCase(), name: { ar: d.ar, en: d.en }, category: d.cat, kind: d.kind ?? 'RAW',
      stockUnitId: d.unit, packs, purchasePackId: packs[0]?.id ?? null, allowNegative: null, active: true, trackLots: !!d.lots, shelfLifeDays: d.lots ?? null,
      defaultSupplierId: d.sup ?? null, avgCost: m4(d.cost), lastCost: m4(d.cost), costHistory: [], levels, version: 1, createdAt: created,
    };
  });
  const mkRecipe = (id: string, kind: Recipe['outputKind'], output: string, outQty: number, ins: In[], note: string | null, opt?: string | null, applies?: string | null): Recipe => {
    const inputs: RecipeInput[] = ins.map(([itemId, q, w]) => { const it = base.items.find((i) => i.id === itemId)!; const e = enteredOf(db, it, q); return { itemId, quantity: qn(q), enteredQuantity: e.q, enteredUnit: e.u, wastePercent: qn(w ?? 0) }; });
    const name = base.items.find((i) => i.id === output)?.name ?? db.products.find((x) => x.id === output)?.name ?? { ar: output, en: output };
    return { id, outputProductId: output, outputKind: kind, modifierOptionId: opt ?? null, appliesToProductId: applies ?? null, name, activeVersionId: `${id}_v1`, version: 1, createdAt: created,
      versions: [{ id: `${id}_v1`, version: 1, effectiveFrom: created, inputsPerBatch: inputs, outputQuantityPerBatch: qn(outQty), createdAt: created, createdBy: 'u_manager_1', note }] };
  };
  for (const [out, q, ins, note] of PREP_RECIPES) base.recipes.push(mkRecipe(`rcp_${out.replace('inv_prep_', 'prep_')}`, 'PREP', out, q, ins, note || null));
  for (const [pid, ins] of MENU_RECIPES) if (db.products.some((x) => x.id === pid)) base.recipes.push(mkRecipe(`rcp_${pid.replace('p_', '')}`, 'MENU', pid, 1, ins, null));
  for (const [opt, pid, ins] of MOD_RECIPES) if (db.modifierGroups.some((g) => g.options.some((o) => o.id === opt))) base.recipes.push(mkRecipe(`rcp_mod_${opt.replace('opt_', '')}${pid ? '_' + pid.replace('p_', '') : ''}`, 'MODIFIER', pid ?? opt, 1, ins, null, opt, pid));
  // a second, newer version of the kofta recipe (portion reduced last week) so the version history has content
  const kofta = base.recipes.find((r) => r.id === 'rcp_kofta');
  if (kofta) {
    const v1 = kofta.versions[0];
    v1.inputsPerBatch = v1.inputsPerBatch.map((i) => (i.itemId === 'inv_prep_kofta' ? { ...i, quantity: '0.25', enteredQuantity: '250' } : i));
    kofta.versions.push({ ...structuredClone(v1), id: 'rcp_kofta_v2', version: 2, effectiveFrom: iso(at(8, 10)), createdAt: iso(at(8, 10)), note: 'تقليل البورشن من 250 لـ 220 جرام بعد زيادة سعر اللحمة', inputsPerBatch: v1.inputsPerBatch.map((i) => (i.itemId === 'inv_prep_kofta' ? { ...i, quantity: '0.22', enteredQuantity: '220' } : i)) });
    kofta.activeVersionId = 'rcp_kofta_v2';
    kofta.version = 2;
  }

  // ───── history (run twice: first to learn the net movement, then for real on top of opening balances)
  const history = (db2: DB) => {
    const inv = invOf(db2);
    const A = (u: string, ms: number): Actor => ({ userId: u, nowMs: ms });
    const S = (module: string, id: string, number?: string, label?: string) => ({ module, command: 'seed', id, number, label });
    const events: { ms: number; run: () => void }[] = [];
    const ev = (ms: number, run: () => void) => events.push({ ms, run });

    // receipts against purchase orders
    const receive = (po: PurchaseOrder | null, sup: string, wh: string, ms: number, lines: [string, number, string][], invoice: string, userId = 'u_manager_1') => {
      const gr: GoodsReceipt = { id: newId(inv, 'grn'), number: nextNumber(inv, 'GRN'), supplierId: sup, purchaseOrderId: po?.id ?? null, warehouseId: wh, state: 'POSTED', supplierInvoiceNo: invoice, lines: [], total: m4(0), at: iso(ms), businessDate: ymd(ms), userId, note: null, reversal: null, movementIds: [] };
      lines.forEach(([itemId, packs, packCost], i) => {
        const it = inv.items.find((x) => x.id === itemId)!;
        const pack = it.packs[0] ?? null;
        const qty = pack ? D(packs).times(pack.factor) : D(packs);
        const unitCost = pack ? D(packCost).dividedBy(pack.factor) : D(packCost);
        const pl = po?.lines.find((l) => l.itemId === itemId);
        const expiry = it.shelfLifeDays ? ymd(ms + it.shelfLifeDays * DAY) : null;
        gr.lines.push({ id: `grl_${i + 1}`, poLineId: pl?.id ?? null, itemId, packId: pack?.id ?? null, factor: pack?.factor ?? '1', packQuantity: qn(packs), quantity: qn(qty), packCost: m4(packCost), unitCost: m4(unitCost), value: m4(qty.times(unitCost)), lotCode: null, expiryDate: expiry });
        gr.movementIds.push(post(db2, A(userId, ms), { itemId, warehouseId: wh, kind: 'RECEIPT', quantity: qty, unitCost: m4(unitCost), updateAvg: true, source: S('receiving', gr.id, gr.number, inv.suppliers.find((s) => s.id === sup)?.name), lot: it.trackLots ? { lotCode: gr.number, expiryDate: expiry } : null, negative: 'ALLOW' }).id);
      });
      gr.total = m4(gr.lines.reduce((a, l) => a.plus(l.value), D(0)));
      inv.receipts.unshift(gr);
      return gr;
    };
    const mkPo = (sup: string, wh: string, ms: number, state: PurchaseOrder['state'], lines: [string, number, string][], note: string | null, issuedMs: number | null): PurchaseOrder => {
      const po: PurchaseOrder = {
        id: newId(inv, 'po'), number: nextNumber(inv, 'PO'), supplierId: sup, warehouseId: wh, branchId: inv.warehouses.find((w) => w.id === wh)!.branchId, state,
        lines: lines.map(([itemId, q, cost], i) => { const it = inv.items.find((x) => x.id === itemId)!; return { id: `pol_${i + 1}_${itemId}`, itemId, packId: it.packs[0]?.id ?? null, factor: it.packs[0]?.factor ?? '1', orderedQuantity: qn(q), orderedUnitCost: m4(cost) }; }),
        expectedDate: ymd(ms + DAY), note, createdAt: iso(ms), createdBy: 'u_manager_1', issuedAt: issuedMs ? iso(issuedMs) : null, issuedBy: issuedMs ? 'u_manager_1' : null,
        closedAt: null, closedBy: null, closeReason: null, cancelledAt: null, cancelReason: null, version: 3, history: [{ at: iso(ms), by: 'u_manager_1', text: 'DRAFT' }, ...(issuedMs ? [{ at: iso(issuedMs), by: 'u_manager_1', text: 'ISSUED' }] : [])],
      };
      inv.purchaseOrders.unshift(po);
      return po;
    };
    const transfer = (from: string, to: string, ms: number, lines: [string, number][], received: boolean, by = 'u_manager_1') => {
      const t: Transfer = { id: newId(inv, 'trf'), number: nextNumber(inv, 'TRF'), fromWarehouseId: from, toWarehouseId: to, state: 'DISPATCHED', lines: [], note: received ? 'تحويل الصبح للمطبخ' : 'مستلزمات للفرع التاني', createdAt: iso(ms - 30 * 60_000), createdBy: by, dispatchedAt: iso(ms), dispatchedBy: by, receivedAt: null, receivedBy: null, cancelledAt: null, cancelReason: null, version: 2, shortValue: null };
      for (const [itemId, q] of lines) {
        const mv = post(db2, A(by, ms), { itemId, warehouseId: from, kind: 'TRANSFER_OUT', quantity: -q, source: S('transfers', t.id, t.number), negative: 'ALLOW' });
        t.lines.push({ itemId, quantity: qn(q), unitCost: mv.unitCost, receivedQuantity: null, shortQuantity: null, lots: mv.lots.map((x) => ({ lotCode: x.lotCode, expiryDate: x.expiryDate, quantity: x.quantity })) });
      }
      if (received) {
        const rms = ms + 40 * 60_000;
        for (const l of t.lines) {
          const rec = l.itemId === 'inv_tomato' ? D(l.quantity).minus(1) : D(l.quantity);
          l.receivedQuantity = qn(rec); l.shortQuantity = qn(D(l.quantity).minus(rec));
          post(db2, A('u_chef_1', rms), { itemId: l.itemId, warehouseId: to, kind: 'TRANSFER_IN', quantity: rec, unitCost: l.unitCost, lotsIn: [], source: S('transfers', t.id, t.number), reason: D(l.shortQuantity).gt(0) ? 'SHORT_RECEIVED' : null, negative: 'ALLOW' });
        }
        t.state = 'RECEIVED'; t.receivedAt = iso(rms); t.receivedBy = 'u_chef_1'; t.version = 3;
        t.shortValue = m4(t.lines.reduce((a, l) => a.plus(D(l.shortQuantity ?? 0).times(l.unitCost ?? 0)), D(0)));
      }
      inv.transfers.unshift(t);
    };
    const produce = (itemId: string, out: number, ms: number) => {
      const r = inv.recipes.find((x) => x.outputKind === 'PREP' && x.outputProductId === itemId)!;
      const v = activeVersion(r, ms);
      const needs = versionNeeds(v, D(out).dividedBy(v.outputQuantityPerBatch));
      const run = { id: newId(inv, 'prd'), number: nextNumber(inv, 'PRD') };
      const s = S('production', run.id, run.number, inv.items.find((i) => i.id === itemId)!.name.ar);
      const inputs: ProductionRun['inputs'] = [];
      const ids: string[] = [];
      let total = D(0);
      for (const [id, q] of needs) {
        const mv = post(db2, A('u_chef_1', ms), { itemId: id, warehouseId: WH.k, kind: 'PRODUCTION_OUT', quantity: q.negated(), source: s, negative: 'ALLOW' });
        ids.push(mv.id); total = total.plus(D(mv.value).negated());
        inputs.push({ itemId: id, planned: qn(q), actual: qn(q), unitCost: mv.unitCost, value: m4(D(mv.value).negated()) });
      }
      const it = inv.items.find((i) => i.id === itemId)!;
      const expiry = it.shelfLifeDays ? ymd(ms + it.shelfLifeDays * DAY) : null;
      ids.push(post(db2, A('u_chef_1', ms), { itemId, warehouseId: WH.k, kind: 'PRODUCTION_IN', quantity: out, unitCost: total.dividedBy(out), updateAvg: true, source: s, lot: { lotCode: run.number, expiryDate: expiry }, negative: 'ALLOW' }).id);
      inv.production.unshift({ ...run, at: iso(ms), businessDate: ymd(ms), recipeId: r.id, recipeVersionId: v.id, warehouseId: WH.k, outputItemId: itemId, plannedOutput: qn(out), actualOutput: qn(out), inputs, totalCost: m4(total), unitCost: m4(total.dividedBy(out)), userId: 'u_chef_1', movementIds: ids, note: null, lotCode: run.number, expiryDate: expiry });
    };
    const waste = (itemId: string, q: number, reason: WasteRecord['reason'], ms: number, note: string | null, wh: string = WH.k) => {
      const rec = { id: newId(inv, 'wst'), number: nextNumber(inv, 'WST') };
      const item = inv.items.find((i) => i.id === itemId);
      const product = item ? null : db2.products.find((x) => x.id === itemId)!;
      const needs = item ? new Map([[itemId, D(q)]]) : explodeProduct(db2, itemId, q, [], ms).needs;
      const ids: string[] = [];
      let value = D(0);
      for (const [id, n] of needs) { const mv = post(db2, A('u_chef_1', ms), { itemId: id, warehouseId: wh, kind: 'WASTE', quantity: n.negated(), reason, note, source: S('waste', rec.id, rec.number, product?.name.ar), negative: 'ALLOW' }); ids.push(mv.id); value = value.plus(D(mv.value).negated()); }
      inv.waste.unshift({ ...rec, at: iso(ms), businessDate: ymd(ms), warehouseId: wh, itemId, itemKind: item ? 'ITEM' : 'PRODUCT', name: item?.name ?? product!.name, quantity: qn(q), reason, note, sourceType: 'MANUAL', sourceId: null, value: m4(value), movementIds: ids, userId: 'u_chef_1', approvalGrantId: null });
    };
    const daySales = (daysAgo: number, share: number) => {
      const ms = daysAgo === 0 ? nowMs - 90 * 60_000 : at(daysAgo, 22, 30);
      const need = new Map<string, Decimal>();
      for (const [pid, n] of Object.entries(DAILY)) {
        if (!db2.products.some((x) => x.id === pid)) continue;
        if (pid === 'p_kunafa' && daysAgo < 2) continue; // sold out since yesterday
        const qty = Math.round(n * share * (1 + ((daysAgo * 7 + pid.length) % 5 - 2) / 20));
        if (qty <= 0) continue;
        explodeProduct(db2, pid, qty, [], ms).needs.forEach((v, k) => need.set(k, (need.get(k) ?? D(0)).plus(v)));
      }
      const label = daysAgo === 0 ? 'مبيعات النهارده لحد دلوقتي (بيانات العرض)' : `مبيعات يوم ${ymd(ms)} (بيانات العرض)`;
      for (const [itemId, q] of need) post(db2, A('u_cashier_a', ms), { itemId, warehouseId: WH.k, kind: 'SALE', quantity: q.negated(), source: S('orders', `seed-sales-${ymd(ms)}`, undefined, label), negative: 'ALLOW' });
    };

    // purchase orders and receipts
    ev(at(10, 9), () => {
      const po = mkPo('sup_ahram', WH.s, at(10, 9), 'RECEIVED', [['inv_flour', 2, '720'], ['inv_sugar', 1, '1850'], ['inv_oil', 3, '1500'], ['inv_tahini', 3, '800'], ['inv_tea', 1, '1375'], ['inv_milk', 3, '470'], ['inv_cheddar', 3, '370'], ['inv_mozzarella', 2, '650'], ['inv_soda_can', 6, '280']], 'طلبية أول الشهر', at(10, 10));
      receive(po, 'sup_ahram', WH.s, at(9, 9, 30), po.lines.map((l) => [l.itemId, Number(l.orderedQuantity), l.orderedUnitCost]), 'AH-77812');
      po.history.unshift({ at: iso(at(9, 9, 30)), by: 'u_manager_1', text: 'received GRN-0001 → RECEIVED' });
    });
    ev(at(6, 7, 30), () => receive(null, 'sup_nile', WH.s, at(6, 7, 30), [['inv_tomato', 2, '300'], ['inv_cucumber', 1, '255'], ['inv_onion', 1, '330'], ['inv_lettuce', 2, '190'], ['inv_lemon', 1, '430'], ['inv_orange', 3, '540'], ['inv_potato', 2, '430'], ['inv_eggplant', 1, '290']], 'سوق — بدون أمر شراء', 'u_manager_2'));
    ev(at(3, 9), () => {
      const po = mkPo('sup_nile', WH.s, at(3, 9), 'PARTIALLY_RECEIVED', [['inv_chicken_breast', 3, '2350'], ['inv_eggs', 6, '138'], ['inv_tomato', 2, '320'], ['inv_orange', 3, '560'], ['inv_mint', 30, '5']], null, at(3, 9, 15));
      const gr = receive(po, 'sup_nile', WH.s, at(2, 7, 45), [['inv_chicken_breast', 3, '2350'], ['inv_eggs', 6, '138'], ['inv_tomato', 2, '320']], 'NL-5521');
      po.history.unshift({ at: iso(at(2, 7, 45)), by: 'u_manager_1', text: `received ${gr.number} → PARTIALLY_RECEIVED` });
      // 2 kg of tomatoes came crushed: back to the supplier
      const srMs = at(2, 8, 30);
      const rec = { id: newId(inv, 'srt'), number: nextNumber(inv, 'SRT') };
      const unit = gr.lines.find((l) => l.itemId === 'inv_tomato')!.unitCost;
      const mv = post(db2, A('u_manager_1', srMs), { itemId: 'inv_tomato', warehouseId: WH.s, kind: 'SUPPLIER_RETURN', quantity: -2, unitCost: unit, updateAvg: true, reason: 'SUPPLIER_RETURN', note: 'طماطم مفعوصة في القفص', source: S('suppliers', rec.id, rec.number, 'مزارع النيل'), negative: 'ALLOW' });
      const sr: SupplierReturn = { ...rec, supplierId: 'sup_nile', warehouseId: WH.s, receiptId: gr.id, lines: [{ itemId: 'inv_tomato', quantity: '2', unitCost: unit, value: m4(D(unit).times(2)) }], total: m4(D(unit).times(2)), reason: 'طماطم مفعوصة في القفص', at: iso(srMs), businessDate: ymd(srMs), userId: 'u_manager_1', approvalGrantId: null, movementIds: [mv.id] };
      inv.supplierReturns.unshift(sr);
    });
    ev(at(1, 8), () => {
      const po = mkPo('sup_butcher', WH.s, at(2, 18), 'RECEIVED', [['inv_beef_mince', 12, '395'], ['inv_beef_cubes', 6, '465']], 'لحمة طازة للويك إند', at(2, 18, 10));
      receive(po, 'sup_butcher', WH.s, at(1, 8), po.lines.map((l) => [l.itemId, Number(l.orderedQuantity), l.orderedUnitCost]), 'AM-118');
      po.history.unshift({ at: iso(at(1, 8)), by: 'u_manager_1', text: 'received → RECEIVED' });
    });
    ev(at(0, 8), () => { mkPo('sup_bakery', WH.k, at(0, 8), 'ISSUED', [['inv_baladi_bread', 3, '75'], ['inv_shami_bread', 2, '120'], ['inv_kunafa_dough', 2, '300']], 'العيش والكنافة — توريد النهارده', at(0, 8, 5)); });
    // daily bread straight to the kitchen (no purchase order)
    for (const d of [7, 6, 5, 4, 3, 2, 1]) ev(at(d, 7), () => receive(null, 'sup_bakery', WH.k, at(d, 7), [['inv_baladi_bread', 3, '75'], ['inv_shami_bread', 1, '120'], ['inv_burger_bun', 1, '72'], ['inv_fino_bread', 1, '62.5'], ['inv_saj_bread', 1, '80']], `خبز-${ymd(at(d, 7)).slice(5)}`, 'u_chef_1'));
    // store → kitchen transfers
    const kitchenTop: [string, number][] = [['inv_flour', 5], ['inv_sugar', 6], ['inv_oil', 9], ['inv_tahini', 3], ['inv_tomato', 6], ['inv_cucumber', 4], ['inv_lettuce', 8], ['inv_onion', 5], ['inv_lemon', 4], ['inv_orange', 18], ['inv_potato', 10], ['inv_eggplant', 4], ['inv_milk', 6], ['inv_eggs', 30], ['inv_chickpeas', 3], ['inv_cheddar', 1], ['inv_mozzarella', 1.5], ['inv_soda_can', 48], ['inv_garlic', 1]];
    ev(at(6, 9), () => transfer(WH.s, WH.k, at(6, 9), kitchenTop, true));
    ev(at(3, 9, 30), () => transfer(WH.s, WH.k, at(3, 9, 30), [...kitchenTop.slice(0, 13), ['inv_chicken_breast', 8], ['inv_beef_mince', 8], ['inv_beef_cubes', 3]], true));
    ev(at(1, 9), () => transfer(WH.s, WH.k, at(1, 9), [['inv_beef_mince', 10], ['inv_beef_cubes', 4], ['inv_chicken_breast', 6], ['inv_orange', 12], ['inv_tomato', 6], ['inv_potato', 8]], true));
    ev(at(0, 10), () => transfer(WH.s, WH.k2, at(0, 10), [['inv_tahini', 2], ['inv_oil', 4], ['inv_beef_mince', 3]], false));
    // kitchen production every two days
    for (const d of [7, 5, 3, 1]) {
      ev(at(d, 10), () => { produce('inv_prep_tahini_sauce', 3.75, at(d, 10)); produce('inv_prep_chickpeas', 3.3, at(d, 10, 20)); produce('inv_prep_kofta', 8.25, at(d, 10, 40)); produce('inv_prep_shawarma', 8, at(d, 11)); produce('inv_prep_toumeya', 1.2, at(d, 11, 20)); produce('inv_prep_pizza_dough', 3.2, at(d, 11, 40)); });
    }
    for (const d of [7, 5, 3, 1]) ev(at(d, 6), () => { produce('inv_prep_foul', 10, at(d, 6)); produce('inv_prep_taameya', 6, at(d, 6, 30)); });
    // sales consumption (main branch)
    for (const d of [7, 6, 5, 4, 3, 2, 1]) ev(at(d, 22, 30), () => daySales(d, 1));
    ev(nowMs - 90 * 60_000, () => daySales(0, 0.35));
    // waste
    ev(at(4, 16), () => waste('inv_milk', 2, 'EXPIRED', at(4, 16), 'كرتونة لبن عدّت التاريخ'));
    ev(at(2, 13), () => waste('inv_baladi_bread', 10, 'BURNT', at(2, 13), 'العيش اتحرق في الفرن'));
    ev(at(1, 21), () => waste('p_kofta', 1, 'DROPPED', at(1, 21), 'الطبق وقع من الويتر'));
    ev(nowMs - 40 * 60_000, () => waste('inv_tomato', 1.5, 'SPOILED', nowMs - 40 * 60_000, 'طماطم معطوبة'));
    // a posted kitchen count last week
    ev(at(5, 23, 30), () => {
      const ms = at(5, 23, 30);
      const deltas: [string, number][] = [['inv_tomato', -0.4], ['inv_baladi_bread', -6], ['inv_sugar', 0.1], ['inv_oil', -0.3], ['inv_lettuce', -1], ['inv_orange', -0.8], ['inv_eggs', 0], ['inv_lemon', 0]];
      const c: StockCount = { id: newId(inv, 'cnt'), number: nextNumber(inv, 'CNT'), warehouseId: WH.k, state: 'POSTED', lines: [], startedAt: iso(ms - 45 * 60_000), startedBy: 'u_manager_1', submittedAt: iso(ms - 5 * 60_000), submittedBy: 'u_manager_1', postedAt: iso(ms), postedBy: 'u_manager_2', cancelledAt: null, cancelReason: null, varianceValue: null, approvalGrantId: null, version: 4, note: 'جرد آخر الليل للخضار والعيش', counters: ['u_chef_1', 'u_manager_1'] };
      let total = D(0);
      for (const [itemId, dq] of deltas) {
        const have = onHand(inv, itemId, WH.k);
        const it = inv.items.find((i) => i.id === itemId)!;
        const counted = D(have).plus(dq); // exact delta so both seed passes agree
        const vq = counted.minus(have);
        const val = vq.times(it.avgCost);
        total = total.plus(val);
        c.lines.push({ itemId, baselineQty: have, baselineSeq: inv.numbers.mv ?? 0, countedQty: qn(counted), countedBy: 'u_chef_1', countedAt: iso(ms - 20 * 60_000), expectedQty: have, varianceQty: qn(vq), varianceValue: m4(val), unitCost: it.avgCost });
        if (!vq.isZero()) post(db2, A('u_manager_2', ms), { itemId, warehouseId: WH.k, kind: 'COUNT_VARIANCE', quantity: vq, unitCost: it.avgCost, reason: 'COUNT', source: S('counts', c.id, c.number), negative: 'ALLOW' });
      }
      c.varianceValue = m4(total);
      inv.counts.unshift(c);
    });
    events.sort((a, b) => a.ms - b.ms).forEach((e) => e.run());
  };

  // pass 1: learn the net effect of the history per (item, warehouse)
  const dry = { ...db, inv: structuredClone(base) } as DB;
  history(dry);
  const net = new Map<string, Decimal>();
  for (const b of (dry as any).inv.balances as InventoryState['balances']) net.set(`${b.itemId}|${b.warehouseId}`, D(b.quantity));
  // pass 2: opening balances three weeks ago, then the same history
  (db as any).inv = base;
  const inv = base;
  const openMs = at(21, 8);
  const keys = new Set<string>(net.keys());
  for (const d of ITEMS) for (const [k, v] of Object.entries(d.target ?? {})) if (v !== undefined) keys.add(`${d.id}|${WH[k as keyof typeof WH]}`);
  const targetOf = (itemId: string, wh: string) => { const d = ITEMS.find((x) => x.id === itemId)!; const k = (Object.keys(WH) as (keyof typeof WH)[]).find((x) => WH[x] === wh)!; return d.target?.[k]; };
  for (const key of keys) {
    const [itemId, wh] = key.split('|');
    const n = net.get(key) ?? D(0);
    const t = targetOf(itemId, wh);
    let open = t !== undefined ? D(t).minus(n) : n.lt(0) ? n.negated() : D(0);
    if (open.plus(n).lt(0)) open = n.negated();
    if (!open.gt(0)) continue;
    const it = inv.items.find((i) => i.id === itemId)!;
    if (it.kind === 'PREP') {
      post(db, { userId: 'u_chef_1', nowMs: openMs }, { itemId, warehouseId: wh, kind: 'OPENING', quantity: open, unitCost: itemTheoretical(db, inv, itemId), updateAvg: true, reason: 'OPENING', source: { module: 'inventory', command: 'seed', id: 'opening', label: 'رصيد أول المدة' }, negative: 'ALLOW' });
    } else {
      post(db, { userId: 'u_manager_1', nowMs: openMs }, { itemId, warehouseId: wh, kind: 'OPENING', quantity: open, unitCost: it.avgCost, updateAvg: true, reason: 'OPENING', source: { module: 'inventory', command: 'seed', id: 'opening', label: 'رصيد أول المدة' }, negative: 'ALLOW' });
    }
  }
  history(db);

  // lots: rebuild for expiry-tracked items so the remaining lots match the balances, with a few deliberately near expiry
  const special: Record<string, [number, number][]> = {
    // key → [qty, days until expiry]; the rest of the balance goes into a fresh lot
    'inv_milk|wh_main_kitchen': [[3, 2]],
    'inv_milk|wh_main_store': [[4, 4]],
    'inv_cream|wh_main_kitchen': [[1.4, 1]],
    'inv_mozzarella|wh_main_store': [[0.8, -1]],
    'inv_beef_mince|wh_main_store': [[6, 2]],
    'inv_chicken_breast|wh_main_kitchen': [[4, 1]],
    'inv_prep_tahini_sauce|wh_main_kitchen': [[1.2, 0]],
    'inv_yogurt|wh_main_kitchen': [[1.2, 3]],
  };
  inv.lots = [];
  for (const b of inv.balances) {
    const it = inv.items.find((i) => i.id === b.itemId)!;
    if (!it.trackLots || !D(b.quantity).gt(0)) continue;
    let left = D(b.quantity);
    const lastReceipt = inv.movements.filter((m) => m.itemId === it.id && m.warehouseId === b.warehouseId && (m.kind === 'RECEIPT' || m.kind === 'PRODUCTION_IN' || m.kind === 'TRANSFER_IN')).at(-1);
    for (const [q, days] of special[`${b.itemId}|${b.warehouseId}`] ?? []) {
      const take = Decimal.min(left, D(q));
      if (!take.gt(0)) continue;
      inv.lots.push({ id: newId(inv, 'lot'), itemId: it.id, warehouseId: b.warehouseId, lotCode: `${lastReceipt?.source.number ?? 'L'}-${Math.abs(days)}${days < 0 ? 'X' : ''}`, expiryDate: ymd(nowMs + days * DAY), receivedAt: iso(nowMs - Math.max(1, (it.shelfLifeDays ?? 3) - days) * DAY), initialQty: qn(take), remaining: qn(take), unitCost: it.avgCost, sourceRef: lastReceipt?.source.id ?? null });
      left = left.minus(take);
    }
    if (left.gt(0)) {
      const recMs = lastReceipt?.atMs ?? nowMs - DAY;
      inv.lots.push({ id: newId(inv, 'lot'), itemId: it.id, warehouseId: b.warehouseId, lotCode: lastReceipt?.source.number ?? `L-${it.sku}`, expiryDate: ymd(Math.max(recMs + (it.shelfLifeDays ?? 7) * DAY, nowMs + 4 * DAY)), receivedAt: iso(recMs), initialQty: qn(left), remaining: qn(left), unitCost: it.avgCost, sourceRef: lastReceipt?.source.id ?? null });
    }
  }
  (db as any).inv = inv;
}

function itemTheoretical(db: DB, inv: InventoryState, itemId: string): string {
  const r = inv.recipes.find((x) => x.outputKind === 'PREP' && x.outputProductId === itemId);
  if (!r) return m4(0);
  const v = r.versions[0];
  const total = v.inputsPerBatch.reduce((a, i) => a.plus(D(i.quantity).times(D(1).plus(D(i.wastePercent).dividedBy(100))).times(inv.items.find((x) => x.id === i.itemId)?.avgCost ?? 0)), D(0));
  void db;
  return m4(total.dividedBy(v.outputQuantityPerBatch));
}
