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
  'demo-waiter-second': { name: 'علي', role: 'ويتر الفرع التاني', en: 'Ali', roleEn: 'Second-branch waiter' },
  'demo-owner': { name: 'الحاج سامي', role: 'صاحب المطعم', en: 'Hajj Sami', roleEn: 'Owner' },
  'implementation-engineer': { name: 'كريم', role: 'مهندس التركيب', en: 'Karim', roleEn: 'Setup engineer' },
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
  t_cash: { name: 'جهاز الكاشير', short: 'الكاشير', en: 'Cashier station', shortEn: 'Cashier', hint: 'جهاز الكاشير اللي عليه درج الفلوس: بيع تيك أواي، تحصيل الشيكات، الوردية' },
  t_floor: { name: 'تابلت الويتر', short: 'الويتر', en: 'Waiter tablet', shortEn: 'Waiter', hint: 'تابلت الويتر في الصالة: فتح الترابيزات والشيكات والإرسال للمطبخ (من غير درج)' },
  t_kds: { name: 'شاشة المطبخ', short: 'المطبخ', en: 'Kitchen screen', shortEn: 'Kitchen', hint: 'شاشة المطبخ: الطلبات بتوصل هنا لكل محطة' },
  t_admin: { name: 'كمبيوتر المدير', short: 'المدير', en: "Manager's PC", shortEn: 'Manager', hint: 'كمبيوتر المدير في المكتب: الموافقات والتقارير والإعدادات' },
  t_second_floor: { name: 'تابلت الفرع التاني', short: 'الفرع التاني', en: 'Second-branch tablet', shortEn: 'Branch 2', hint: 'تابلت ويتر في الفرع التاني' },
  t_cash2: { name: 'كاشير التيك أواي', short: 'التيك أواي', en: 'Takeaway counter', shortEn: 'Takeaway', hint: 'كاشير تاني بدرج لطلبات التيك أواي' },
  BO: { name: 'الإدارة من أي مكان', short: 'الإدارة', en: 'Back office', shortEn: 'Back office', hint: 'الإدارة من أي كمبيوتر (من غير جهاز في المطعم): المنيو والإعدادات والتقارير' },
};
const SHORT_TO_ID: Record<string, string> = { T1: 't_cash', T2: 't_floor', K1: 't_kds', ADM: 't_admin', B2: 't_second_floor', BO: 'BO' };
const KIND_NAME: Record<string, string> = { CASH: 'جهاز الكاشير', FLOOR: 'تابلت الويتر', KDS: 'شاشة المطبخ', ADMIN: 'كمبيوتر المدير' };
const KIND_NAME_EN: Record<string, string> = { CASH: 'Cashier station', FLOOR: 'Waiter tablet', KDS: 'Kitchen screen', ADMIN: "Manager's PC" };
const kindName = (k: string) => (isEn() ? KIND_NAME_EN[k] : KIND_NAME[k]);
export const terminalKindName = (kind: string) => kindName(kind) ?? kind;
const devName = (id: string) => (isEn() ? DEVICE_NAMES[id].en : DEVICE_NAMES[id].name);
/** The device's one-line hint (tooltip) in the UI language. */
export const deviceHint = (id: string) => (DEVICE_NAMES[id] ? (isEn() ? DEVICE_HINT_EN[id] ?? DEVICE_NAMES[id].hint : DEVICE_NAMES[id].hint) : '');
const DEVICE_HINT_EN: Record<string, string> = {
  t_cash: 'The cashier station with the cash drawer: takeaway sales, collecting checks, the shift',
  t_floor: 'The waiter tablet on the floor: opening tables and checks, sending to the kitchen (no drawer)',
  t_kds: 'The kitchen screen: orders arrive here for each station',
  t_admin: "The manager's PC in the office: approvals, reports and settings",
  t_second_floor: 'A waiter tablet in the second branch',
  t_cash2: 'A second cashier with a drawer for takeaway orders',
  BO: 'Management from any computer (no device in the restaurant): menu, settings and reports',
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
  if (code === 'DEMO-ADMIN-1') return devName('t_admin');
  if (code === 'DEMO-SECOND-FLOOR-1') return devName('t_second_floor');
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
};
const ROLE_EN: Record<string, string> = {
  'ويتر': 'Waiter', 'كاشير': 'Cashier', 'مدير': 'Manager', 'المطبخ': 'Kitchen', 'صاحب المطعم': 'Owner',
  'تركيب السيستم': 'System setup', 'ويتر من غير إرسال للمطبخ': 'Waiter without sending to the kitchen',
};
/** Role name from the server ("Demo Waiter", "owner"…) → plain words in the UI language. Unknown names are shown as they are. */
export function roleLabel(name: string | null | undefined): string {
  if (!name) return '';
  const k = name.trim().toLowerCase();
  const ar = ROLE_NAMES[k] ?? (k.includes('bootstrap') ? 'تركيب السيستم' : null);
  if (ar) return isEn() ? ROLE_EN[ar] ?? ar : ar;
  return tv(name.replace(/^Demo /, ''));
}

const BRANCH_NAMES: Record<string, string> = { 'DEMO-MAIN': 'الفرع الرئيسي', 'DEMO-SECOND': 'الفرع التاني', 'TAHRIR-1': 'فرع التحرير' };
const BRANCH_NAMES_EN: Record<string, string> = { 'DEMO-MAIN': 'Main branch', 'DEMO-SECOND': 'Second branch', 'TAHRIR-1': 'Tahrir branch' };
export function branchLabel(b: { code?: string; name?: string } | null | undefined): string {
  if (!b) return '';
  if (b.code && BRANCH_NAMES[b.code]) return isEn() ? BRANCH_NAMES_EN[b.code] : BRANCH_NAMES[b.code];
  return tv(b.name) || b.code || '';
}
