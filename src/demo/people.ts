// Friendly names for the demo: personas for the seeded users, plain device names, plain role names, branch names.
// Pure data + pure helpers (no imports) so any file — including src/ui — can use it without import cycles.
// Usernames, ids and terminal codes stay unchanged; they are shown only inside <Tech>.

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

export const personaDisplayName = (username: string) => { const p = PERSONAS[username]; return p ? `${p.name} — ${p.role}` : username; };
/** Short first name for sentences ("منى فتحت الوردية"). Falls back to the part of the display name before " — ". */
export function personName(username: string | null | undefined, displayName?: string | null): string {
  if (username && PERSONAS[username]) return PERSONAS[username].name;
  if (displayName) return displayName.split(' — ')[0];
  return username ?? '—';
}
export function personLabel(username: string | null | undefined, displayName?: string | null): string {
  if (username && PERSONAS[username]) return personaDisplayName(username);
  return displayName ?? username ?? '—';
}
export const isFemale = (username: string | null | undefined) => !!(username && PERSONAS[username]?.f);
/** Pick the masculine or feminine verb form for a person. */
export const verb = (username: string | null | undefined, m: string, f: string) => (isFemale(username) ? f : m);

// ───────── devices
export interface DeviceName { name: string; short: string; en: string; hint: string }
/** Seeded device ids and the short top-bar codes (T1, T2…) → plain names. */
export const DEVICE_NAMES: Record<string, DeviceName> = {
  t_cash: { name: 'جهاز الكاشير', short: 'الكاشير', en: 'Cashier station', hint: 'جهاز الكاشير اللي عليه درج الفلوس: بيع تيك أواي، تحصيل الشيكات، الوردية' },
  t_floor: { name: 'تابلت الويتر', short: 'الويتر', en: 'Waiter tablet', hint: 'تابلت الويتر في الصالة: فتح الترابيزات والشيكات والإرسال للمطبخ (من غير درج)' },
  t_kds: { name: 'شاشة المطبخ', short: 'المطبخ', en: 'Kitchen screen', hint: 'شاشة المطبخ: الطلبات بتوصل هنا لكل محطة' },
  t_admin: { name: 'كمبيوتر المدير', short: 'المدير', en: "Manager's PC", hint: 'كمبيوتر المدير في المكتب: الموافقات والتقارير والإعدادات' },
  t_second_floor: { name: 'تابلت الفرع التاني', short: 'الفرع التاني', en: 'Second-branch tablet', hint: 'تابلت ويتر في الفرع التاني' },
  t_cash2: { name: 'كاشير التيك أواي', short: 'التيك أواي', en: 'Takeaway counter', hint: 'كاشير تاني بدرج لطلبات التيك أواي' },
  BO: { name: 'الإدارة من أي مكان', short: 'الإدارة', en: 'Back office', hint: 'الإدارة من أي كمبيوتر (من غير جهاز في المطعم): المنيو والإعدادات والتقارير' },
};
const SHORT_TO_ID: Record<string, string> = { T1: 't_cash', T2: 't_floor', K1: 't_kds', ADM: 't_admin', B2: 't_second_floor', BO: 'BO' };
const KIND_NAME: Record<string, string> = { CASH: 'جهاز الكاشير', FLOOR: 'تابلت الويتر', KDS: 'شاشة المطبخ', ADMIN: 'كمبيوتر المدير' };
export const terminalKindName = (kind: string) => KIND_NAME[kind] ?? kind;

/** A device id, a top-bar code (T1…) or a terminal code (DEMO-CASH-1, CASH-1…) → a plain device name. */
export function deviceName(idOrCode: string | null | undefined, kind?: string | null, terminalName?: string | null): string {
  if (!idOrCode) return kind ? terminalKindName(kind) : '';
  const id = SHORT_TO_ID[idOrCode] ?? idOrCode;
  if (DEVICE_NAMES[id]) return DEVICE_NAMES[id].name;
  if (terminalName && /[\u0600-\u06FF]/.test(terminalName)) return terminalName;
  const code = idOrCode.toUpperCase();
  if (code === 'DEMO-CASH-1') return DEVICE_NAMES.t_cash.name;
  if (code === 'DEMO-FLOOR-1') return DEVICE_NAMES.t_floor.name;
  if (code === 'DEMO-KDS-1') return DEVICE_NAMES.t_kds.name;
  if (code === 'DEMO-ADMIN-1') return DEVICE_NAMES.t_admin.name;
  if (code === 'DEMO-SECOND-FLOOR-1') return DEVICE_NAMES.t_second_floor.name;
  if (kind && KIND_NAME[kind]) return KIND_NAME[kind];
  if (code.includes('CASH')) return KIND_NAME.CASH;
  if (code.includes('FLOOR')) return KIND_NAME.FLOOR;
  if (code.includes('KDS')) return KIND_NAME.KDS;
  if (code.includes('ADMIN')) return KIND_NAME.ADMIN;
  return idOrCode;
}

// ───────── roles & branches
const ROLE_NAMES: Record<string, string> = {
  'demo waiter': 'ويتر', 'demo cashier': 'كاشير', 'demo manager': 'مدير', 'demo chef': 'المطبخ', 'demo owner': 'صاحب المطعم',
  owner: 'صاحب المطعم', manager: 'مدير', cashier: 'كاشير', waiter: 'ويتر', chef: 'المطبخ',
  bootstrap: 'تركيب السيستم', 'bootstrap admin': 'تركيب السيستم', 'implementation': 'تركيب السيستم',
  'waiter without fire (n8)': 'ويتر من غير إرسال للمطبخ',
};
/** Role name from the server ("Demo Waiter", "owner"…) → plain Arabic. Unknown names are shown as they are. */
export function roleLabel(name: string | null | undefined): string {
  if (!name) return '';
  const k = name.trim().toLowerCase();
  if (ROLE_NAMES[k]) return ROLE_NAMES[k];
  if (k.includes('bootstrap')) return 'تركيب السيستم';
  return name.replace(/^Demo /, '');
}

const BRANCH_NAMES: Record<string, string> = { 'DEMO-MAIN': 'الفرع الرئيسي', 'DEMO-SECOND': 'الفرع التاني', 'TAHRIR-1': 'فرع التحرير' };
export function branchLabel(b: { code?: string; name?: string } | null | undefined): string {
  if (!b) return '';
  return (b.code && BRANCH_NAMES[b.code]) || b.name || b.code || '';
}
