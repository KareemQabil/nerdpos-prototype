// Round 3 (r3B) venue policies — proposed, shown in the Policy Panel and the real settings screen:
// tender reference capture per method (F3-06), the short display number (E08), second-language lines (E16/P1-034).
// Pushed into POLICIES by policyRegistry.ts. Plain texts live in src/demo/policyText.ts.
import type { PolicyMeta } from './policyRegistry';

const REF = ['OFF', 'OPTIONAL', 'REQUIRED'];

export const R3B_POLICIES: PolicyMeta[] = [
  {
    id: 'TenderReferencePolicy', group: 'payments', title: 'رقم العملية لكل طريقة دفع', titleEn: 'Payment reference per method',
    description: 'الكاشير يكتب رقم العملية (من مكنة الكارت / رقم التحويل / رقم طلب التطبيق) ولا لأ: مقفول، اختياري، أو لازم.',
    state: 'DIRECTION', scopes: ['TENANT', 'BRANCH'], appliesTo: 'NEW_ACTIONS',
    editor: { kind: 'object', fields: [
      { key: 'CARD', label: 'كارت (مكنة الكارت)', kind: 'enum', options: REF },
      { key: 'DIGITAL_WALLET', label: 'محفظة / تحويل', kind: 'enum', options: REF },
      { key: 'ONLINE', label: 'مدفوع قبل كده (تطبيق / لينك دفع)', kind: 'enum', options: REF },
    ] },
    canonicalDefault: { CARD: 'OPTIONAL', DIGITAL_WALLET: 'OPTIONAL', ONLINE: 'OPTIONAL' }, confidence: 'MEDIUM',
    reacts: 'خانة رقم العملية في شاشة التحصيل',
  },
  {
    id: 'ShortOrderNumberPolicy', group: 'orders', title: 'رقم النداء القصير', titleEn: 'Short display number',
    description: 'رقم صغير للنداء على الزبون والمطبخ (1، 2، 3…) جنب رقم العملية الثابت. يبدأ من 1 مع قفل اليوم، أو كل عدد معين من الطلبات. رقم العملية نفسه عمره ما بيتغير وبيطبع دايمًا.',
    state: 'DIRECTION', scopes: ['TENANT', 'BRANCH'], appliesTo: 'NEW_CHECKS',
    editor: { kind: 'object', fields: [
      { key: 'mode', label: 'رقم النداء', kind: 'enum', options: ['OFF', 'DAILY', 'EVERY_N'] },
      { key: 'every', label: 'يرجع لـ 1 بعد', kind: 'number', min: 10, max: 9999 },
    ] },
    canonicalDefault: { mode: 'DAILY', every: 100 }, confidence: 'MEDIUM',
    reacts: 'الإيصال وتذكرة المطبخ وشاشة التسليم',
  },
  {
    id: 'SecondLanguagePolicy', group: 'kitchen', title: 'اللغة التانية', titleEn: 'Second language',
    description: 'يطبع الاسم التاني للصنف (الإنجليزي) تحت الاسم العربي — بس لو الصنف ليه اسم تاني متسجل. مفيش ترجمة أوتوماتيك.',
    state: 'DIRECTION', scopes: ['TENANT', 'BRANCH'], appliesTo: 'NEW_ACTIONS',
    editor: { kind: 'object', fields: [
      { key: 'receipt', label: 'على إيصال الزبون', kind: 'bool' },
      { key: 'kitchen', label: 'على تذكرة المطبخ', kind: 'bool' },
      { key: 'menu', label: 'في المنيو (شاشة البيع)', kind: 'bool' },
    ] },
    canonicalDefault: { receipt: true, kitchen: false, menu: false }, confidence: 'MEDIUM',
    reacts: 'الإيصال، شاشة المطبخ، أزرار الأصناف',
  },
];
