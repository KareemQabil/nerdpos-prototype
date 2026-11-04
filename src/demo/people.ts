// Friendly names for the demo: personas for the seeded users, plain device names, plain role names, branch names.
// Pure data + pure helpers (only the i18n language getter is imported) so any file — including src/ui — can use it.
// Usernames, ids and terminal codes stay unchanged; they are shown only inside <Tech>.
// Every helper follows the UI language: Arabic names in Arabic mode, the English persona/device/role names in English.
import { getLang, tv } from '../i18n';
const isEn = () => getLang() === 'en';

export interface Persona { name: string; role: string; f?: boolean; en: string; roleEn: string }

/** username → persona. The seeded displayName is "<name> — <role>". */
export const PERSONAS: Record<string, Persona> = {
  'demo-manager-1': { name: 'أحمد', role: 'مدير الصالة', en: 'Ahmed', roleEn: 'Floor manager' },
  'demo-manager-2': { name: 'هبة', role: 'مديرة الفرع', f: true, en: 'Heba', roleEn: 'Branch manager' },
  'demo-waiter-1': { name: 'محمود', role: 'ويتر', en: 'Mahmoud', roleEn: 'Waiter' },
  'demo-waiter-2': { name: 'يوسف', role: 'ويتر', en: 'Youssef', roleEn: 'Waiter' },
  'demo-cashier-a': { name: 'سارة', role: 'الكاشير أ', f: true, en: 'Sara', roleEn: 'Cashier A' },
  'demo-cashier-b': { name: 'منى', role: 'الكاشير ب', f: true, en: 'Mona', roleEn: 'Cashier B' },
  'demo-chef-1': { name: 'الشيف حسن', role: 'المطبخ', en: 'Chef Hassan', roleEn: 'Kitchen' },
  'demo-waiter-second': { name: 'علي', role: 'ويتر الفرع الثاني', en: 'Ali', roleEn: 'Second-branch waiter' },
  'demo-owner': { name: 'الحاج سامي', role: 'صاحب المطعم', en: 'Hajj Sami', roleEn: 'Owner' },
  'demo-accountant': { name: 'نادر', role: 'المحاسب', en: 'Nader', roleEn: 'Accountant' },
  'implementation-engineer': { name: 'كريم', role: 'مهندس التركيب', en: 'Karim', roleEn: 'Setup engineer' },
  'nerdpos-support': { name: 'دعم NerdPOS', role: 'فريق NerdPOS (من خارج المطعم)', en: 'NerdPOS support', roleEn: 'NerdPOS team (not the restaurant)' }, // r3C: vendor-only licensed modules
  // ux-09: one demo user per work profile that had nobody (seed-profiles.ts)
  'demo-host': { name: 'ريم', role: 'الاستقبال والحجوزات', f: true, en: 'Reem', roleEn: 'Host & reservations' },
  'demo-captain': { name: 'شريف', role: 'كابتن الصالة', en: 'Sherif', roleEn: 'Floor captain' },
  'demo-runner': { name: 'عمرو', role: 'رانر', en: 'Amr', roleEn: 'Runner' },
  'demo-barista': { name: 'ندى', role: 'باريستا', f: true, en: 'Nada', roleEn: 'Barista' },
  'demo-bartender': { name: 'مصطفى', role: 'بارتندر', en: 'Mostafa', roleEn: 'Bartender' },
  'demo-expediter': { name: 'الشيف وليد', role: 'منسق التسليم', en: 'Chef Walid', roleEn: 'Expediter' },
  'demo-area-manager': { name: 'هشام', role: 'مدير المنطقة', en: 'Hesham', roleEn: 'Area manager' },
  'demo-auditor': { name: 'دينا', role: 'المراجعة الداخلية', f: true, en: 'Dina', roleEn: 'Internal auditor' },
  'demo-storekeeper': { name: 'عبد الرحمن', role: 'أمين المخزن', en: 'Abdelrahman', roleEn: 'Storekeeper' },
  'demo-purchasing': { name: 'رانيا', role: 'مسؤولة المشتريات', f: true, en: 'Rania', roleEn: 'Purchasing officer' },
  'demo-driver': { name: 'سعيد', role: 'طيار', en: 'Saeed', roleEn: 'Driver' },
  'demo-dispatcher': { name: 'إسلام', role: 'موزع الدليفري', en: 'Eslam', roleEn: 'Delivery dispatcher' },
  'demo-callcenter': { name: 'مروة', role: 'مركز الاتصال', f: true, en: 'Marwa', roleEn: 'Call center' },
  // users created by the "setup from zero" journey (J-A1)
  'owner-1': { name: 'عم سيد', role: 'صاحب المطعم', en: 'Uncle Sayed', roleEn: 'Owner' },
  'manager-1': { name: 'طارق', role: 'المدير', en: 'Tarek', roleEn: 'Manager' },
  'manager-2': { name: 'نادية', role: 'مديرة تانية', f: true, en: 'Nadia', roleEn: 'Second manager' },
  'cashier-1': { name: 'إيمان', role: 'الكاشير', f: true, en: 'Eman', roleEn: 'Cashier' },
  'waiter-1': { name: 'خالد', role: 'ويتر', en: 'Khaled', roleEn: 'Waiter' },
  'chef-1': { name: 'الشيف رضا', role: 'المطبخ', en: 'Chef Reda', roleEn: 'Kitchen' },
};

/** The Arabic "<name> — <role>" stored as the seeded displayName (data — always Arabic). */
export const personaDisplayName = (username: string) => { const p = PERSONAS[username]; return p ? `${p.name} — ${p.role}` : username; };
/** Display form of a persona in the UI language. */
const personaLabelNow = (p: Persona) => (isEn() ? `${p.en} — ${p.roleEn}` : `${p.name} — ${p.role}`);
// Reverse lookups so a stored Arabic display name (or a bare first name) can be shown in English.
const BY_TEXT: Record<string, { p: Persona; full: boolean }> = {};
for (const p of Object.values(PERSONAS)) { BY_TEXT[`${p.name} — ${p.role}`] = { p, full: true }; BY_TEXT[p.name] ??= { p, full: false }; BY_TEXT[p.name.replace(/^ال(?=حاج|شيف)/, '')] ??= { p, full: false }; }
// The reverse lookup (stored Arabic text → persona) is used in English mode only, so Arabic mode shows stored names exactly as before.
const personaOf = (username: string | null | undefined, displayName?: string | null): Persona | undefined =>
  (username && PERSONAS[username]) || (displayName && isEn() ? BY_TEXT[displayName.trim()]?.p ?? BY_TEXT[displayName.split(' — ')[0].trim()]?.p : undefined);

/** Short first name for sentences ("منى فتحت الوردية"). Falls back to the part of the display name before " — ". */
export function personName(username: string | null | undefined, displayName?: string | null): string {
  const p = personaOf(username, displayName);
  if (p) return isEn() ? p.en : p.name;
  if (displayName) return displayName.split(' — ')[0];
  return username ?? '—';
}
export function personLabel(username: string | null | undefined, displayName?: string | null): string {
  if (username && PERSONAS[username]) return personaLabelNow(PERSONAS[username]);
  if (displayName) return personText(displayName);
  return username ?? '—';
}
/** A user's stored display name, shown as the English persona label in English mode (Arabic mode: exactly the stored name). */
export const userLabel = (username: string | null | undefined, displayName?: string | null): string => (isEn() ? personLabel(username, displayName) : displayName ?? username ?? '—');
/** The role part of a persona ("الكاشير أ" / "Cashier A"), or '' when unknown. */
export function personRole(username: string | null | undefined, displayName?: string | null): string {
  const p = personaOf(username, displayName);
  if (p) return isEn() ? p.roleEn : p.role;
  return displayName?.split(' — ')[1] ?? '';
}
/** Any text that may be a stored persona display name ("أحمد — مدير الصالة", "سارة") → the UI-language form. Other text is returned as is. */
export function personText(s: string | null | undefined): string {
  if (!s) return s as unknown as string; // keep null/undefined so `personText(x) ?? '—'` still falls back
  if (!isEn()) return s;
  const hit = BY_TEXT[s.trim()];
  if (!hit) return s;
  return hit.full ? personaLabelNow(hit.p) : isEn() ? hit.p.en : hit.p.name;
}
export const isFemale = (username: string | null | undefined) => !!(username && PERSONAS[username]?.f);
/** Pick the masculine or feminine verb form for a person. */
export const verb = (username: string | null | undefined, m: string, f: string) => (isFemale(username) ? f : m);

// ───────── devices
export interface DeviceName { name: string; short: string; en: string; shortEn?: string; hint: string }
/** Seeded device ids and the short top-bar codes (T1, T2…) → plain names. */
export const DEVICE_NAMES: Record<string, DeviceName> = {
  // ux-07: ONE canonical name per device, used by the seed (terminal.name), the top bar, headers, toasts and English.
  // A device is never named after a role (المدير / الإدارة) or a cashier mode (تيك أواي).
  t_cash: { name: 'جهاز الكاشير 1', short: 'كاشير 1', en: 'Cashier station 1', shortEn: 'Cashier 1', hint: 'جهاز الكاشير الذي عليه درج النقدية: البيع وتحصيل الشيكات والوردية' },
  t_floor: { name: 'تابلت الويتر', short: 'الويتر', en: 'Waiter tablet', shortEn: 'Waiter', hint: 'تابلت الويتر في الصالة: فتح الترابيزات والشيكات والإرسال للمطبخ (بلا درج)' },
  t_kds: { name: 'شاشة التسليم', short: 'التسليم', en: 'Dispatch screen', shortEn: 'Dispatch', hint: 'شاشة المطبخ للتسليم: كل المحطات، وعليها «جاهز للتسليم» والتسليم للويتر' },
  t_admin: { name: 'كمبيوتر المكتب', short: 'المكتب', en: 'Office PC', shortEn: 'Office', hint: 'كمبيوتر المكتب في المطعم: الموافقات والتقارير والإعدادات' },
  t_second_floor: { name: 'تابلت الفرع الثاني', short: 'الفرع الثاني', en: 'Second-branch tablet', shortEn: 'Branch 2', hint: 'تابلت ويتر في الفرع الثاني' },
  t_kds2: { name: 'محطة المشويات', short: 'المشويات', en: 'Grill station', shortEn: 'Grill', hint: 'شاشة محطة المشويات: تعرض أصناف المشويات فقط، و«جاهز» يرسل الطلب لشاشة التسليم' },
  t_cash2: { name: 'جهاز الكاشير 2', short: 'كاشير 2', en: 'Cashier station 2', shortEn: 'Cashier 2', hint: 'جهاز كاشير ثانٍ عليه درج نقدية' },
  BO: { name: 'الإدارة عن بُعد', short: 'عن بُعد', en: 'Remote back office', shortEn: 'Remote', hint: 'الإدارة من أي كمبيوتر خارج المطعم (بلا جهاز مسجّل): القائمة والإعدادات والتقارير' },
  // ux-04: display screens (attached to a terminal; no sign-in of their own)
  d_callboard: { name: 'شاشة النداء', short: 'شاشة النداء', en: 'Call board', shortEn: 'Call board', hint: 'شاشة أرقام الطلبات للعملاء: قيد التحضير وجاهز، تعمل مع شاشة التسليم' },
  d_customer: { name: 'شاشة العميل', short: 'شاشة العميل', en: 'Customer display', shortEn: 'Customer display', hint: 'الشاشة المواجهة للعميل عند الكاشير: الأصناف والإجمالي والدفع' },
};
const SHORT_TO_ID: Record<string, string> = { T1: 't_cash', T2: 't_floor', K1: 't_kds', K2: 't_kds2', ADM: 't_admin', B2: 't_second_floor', T3: 't_cash2', BO: 'BO' };
const KIND_NAME: Record<string, string> = { CASH: 'جهاز الكاشير', FLOOR: 'تابلت الويتر', KDS: 'شاشة المطبخ', ADMIN: 'كمبيوتر المكتب' };
const KIND_NAME_EN: Record<string, string> = { CASH: 'Cashier station', FLOOR: 'Waiter tablet', KDS: 'Kitchen screen', ADMIN: 'Office PC' };
const kindName = (k: string) => (isEn() ? KIND_NAME_EN[k] : KIND_NAME[k]);
export const terminalKindName = (kind: string) => kindName(kind) ?? kind;
const devName = (id: string) => (isEn() ? DEVICE_NAMES[id].en : DEVICE_NAMES[id].name);
/** The device's one-line hint (tooltip) in the UI language. */
export const deviceHint = (id: string) => (DEVICE_NAMES[id] ? (isEn() ? DEVICE_HINT_EN[id] ?? DEVICE_NAMES[id].hint : DEVICE_NAMES[id].hint) : '');
const DEVICE_HINT_EN: Record<string, string> = {
  t_cash: 'The cashier station with the cash drawer: sales, collecting checks, the shift',
  t_floor: 'The waiter tablet on the floor: opening tables and checks, sending to the kitchen (no drawer)',
  t_kds: 'The kitchen dispatch screen: every station, with “ready for hand-off” and the hand-off to the waiter',
  t_admin: 'The office PC in the restaurant: approvals, reports and settings',
  t_second_floor: 'A waiter tablet in the second branch',
  t_cash2: 'A second cashier station with a cash drawer',
  t_kds2: 'The grill station screen: grill items only; “Ready” sends the order to the dispatch screen',
  BO: 'Management from any computer outside the restaurant (no registered device): menu, settings and reports',
  d_callboard: 'The order-number board for guests: preparing and ready, driven by the dispatch screen',
  d_customer: 'The guest-facing screen at the cashier: items, total and payment',
};

/** A device id, a top-bar code (T1…) or a terminal code (DEMO-CASH-1, CASH-1…) → a plain device name. */
export function deviceName(idOrCode: string | null | undefined, kind?: string | null, terminalName?: string | null): string {
  if (!idOrCode) return kind ? terminalKindName(kind) : '';
  const id = SHORT_TO_ID[idOrCode] ?? idOrCode;
  if (DEVICE_NAMES[id]) return devName(id);
  if (terminalName && /[\u0600-\u06FF]/.test(terminalName)) return tv(terminalName);
  const code = idOrCode.toUpperCase();
  if (code === 'DEMO-CASH-1') return devName('t_cash');
  if (code === 'DEMO-FLOOR-1') return devName('t_floor');
  if (code === 'DEMO-KDS-1') return devName('t_kds');
  if (code === 'DEMO-KDS-2') return devName('t_kds2');
  if (code === 'DEMO-ADMIN-1') return devName('t_admin');
  if (code === 'DEMO-SECOND-FLOOR-1') return devName('t_second_floor');
  if (code === 'DEMO-CASH-2') return devName('t_cash2');
  if (kind && KIND_NAME[kind]) return kindName(kind);
  if (code.includes('CASH')) return kindName('CASH');
  if (code.includes('FLOOR')) return kindName('FLOOR');
  if (code.includes('KDS')) return kindName('KDS');
  if (code.includes('ADMIN')) return kindName('ADMIN');
  return idOrCode;
}

// ───────── roles & branches
const ROLE_NAMES: Record<string, string> = {
  'demo waiter': 'ويتر', 'demo cashier': 'كاشير', 'demo manager': 'مدير', 'demo chef': 'المطبخ', 'demo owner': 'صاحب المطعم',
  owner: 'صاحب المطعم', manager: 'مدير', cashier: 'كاشير', waiter: 'ويتر', chef: 'المطبخ',
  bootstrap: 'تركيب السيستم', 'bootstrap admin': 'تركيب السيستم', 'implementation': 'تركيب السيستم',
  'waiter without fire (n8)': 'ويتر من غير إرسال للمطبخ',
  'nerdpos support': 'دعم NerdPOS',
  // ux-09: the demo roles of the work profiles
  'demo host': 'الاستقبال والحجوزات', 'demo floor captain': 'كابتن الصالة', 'demo runner': 'رانر', 'demo barista': 'باريستا', 'demo bartender': 'بارتندر',
  'demo expediter': 'منسق التسليم', 'demo area manager': 'مدير المنطقة', 'demo internal auditor': 'المراجعة الداخلية', 'demo storekeeper': 'أمين المخزن',
  'demo purchasing officer': 'المشتريات', 'demo driver': 'طيار', 'demo delivery dispatcher': 'موزع الدليفري', 'demo call center': 'مركز الاتصال', 'demo accountant': 'المحاسب',
};
const ROLE_EN: Record<string, string> = {
  'ويتر': 'Waiter', 'كاشير': 'Cashier', 'مدير': 'Manager', 'المطبخ': 'Kitchen', 'صاحب المطعم': 'Owner',
  'تركيب السيستم': 'System setup', 'ويتر من غير إرسال للمطبخ': 'Waiter without sending to the kitchen', 'دعم NerdPOS': 'NerdPOS support',
  'الاستقبال والحجوزات': 'Host & reservations', 'كابتن الصالة': 'Floor captain', 'رانر': 'Runner', 'باريستا': 'Barista', 'بارتندر': 'Bartender', 'منسق التسليم': 'Expediter',
  'مدير المنطقة': 'Area manager', 'المراجعة الداخلية': 'Internal auditor', 'أمين المخزن': 'Storekeeper', 'المشتريات': 'Purchasing', 'طيار': 'Driver',
  'موزع الدليفري': 'Delivery dispatcher', 'مركز الاتصال': 'Call center', 'المحاسب': 'Accountant',
};
/** Role name from the server ("Demo Waiter", "owner"…) → plain words in the UI language. Unknown names are shown as they are. */
export function roleLabel(name: string | null | undefined): string {
  if (!name) return '';
  const k = name.trim().toLowerCase();
  const ar = ROLE_NAMES[k] ?? (k.includes('bootstrap') ? 'تركيب السيستم' : null);
  if (ar) return isEn() ? ROLE_EN[ar] ?? ar : ar;
  return tv(name.replace(/^Demo /, ''));
}

const BRANCH_NAMES: Record<string, string> = { 'DEMO-MAIN': 'الفرع الرئيسي', 'DEMO-SECOND': 'الفرع الثاني', 'TAHRIR-1': 'فرع التحرير' };
const BRANCH_NAMES_EN: Record<string, string> = { 'DEMO-MAIN': 'Main branch', 'DEMO-SECOND': 'Second branch', 'TAHRIR-1': 'Tahrir branch' };
export function branchLabel(b: { code?: string; name?: string } | null | undefined): string {
  if (!b) return '';
  if (b.code && BRANCH_NAMES[b.code]) return isEn() ? BRANCH_NAMES_EN[b.code] : BRANCH_NAMES[b.code];
  return tv(b.name) || b.code || '';
}
