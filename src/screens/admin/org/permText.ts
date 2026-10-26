// Plain Arabic names for permission ids ("order:fire" → «الشيكات · يبعت للمطبخ»). Ids stay for <Tech> only.
import { t } from '../../../i18n';
import { actionTitle } from '../../../demo/policyText';

export const MODULE_TEXT: Record<string, string> = {
  order: 'الشيكات', payment: 'التحصيل', refund: 'المرتجعات', session: 'الوردية والدرج', cash: 'حركات الدرج', drawer: 'الدرج',
  table: 'الترابيزات', kitchen: 'المطبخ', catalog: 'المنيو', product: 'الأصناف', tax: 'الضرايب', settings: 'الإعدادات', reasoncode: 'الأسباب',
  report: 'التقارير', audit: 'السجل', approval: 'الموافقات', approve: 'موافقة مدير على', user: 'المستخدمين', role: 'الأدوار', credential: 'الأرقام السرية',
  security: 'الأمان', branch: 'الفروع', business: 'بيانات المطعم', terminal: 'الأجهزة', compliance: 'الإيصال الإلكتروني', print: 'الطباعة',
  inventory: 'المخزن', inventoryitem: 'الخامات', stock: 'حركات المخزن', stockcount: 'الجرد', transfer: 'التحويلات', warehouse: 'المخازن',
  recipe: 'الوصفات', production: 'التحضير', purchasing: 'المشتريات', purchaseorder: 'أوامر الشراء', goodsreceipt: 'استلام البضاعة',
  supplierreturn: 'مرتجع الموردين', supplier: 'الموردين', customer: 'العملاء', customeraddress: 'عناوين العملاء', loyalty: 'نقاط الولاء',
  delivery: 'الدليفري', channel: 'الطلبات الأونلاين', outbox: 'العمليات في الخلفية', sync: 'المزامنة', reconciliation: 'المطابقة', platform: 'النظام',
  menu: 'المنيوهات', promotion: 'العروض', floor: 'خريطة الصالة', driver: 'الطيارين', deposit: 'العربون', reservation: 'الحجوزات',
};

const ACTION_TEXT: Record<string, string> = {
  read: 'يشوف', create: 'يعمل جديد', update: 'يعدّل', manage: 'يدير', configure: 'يظبط', upsert: 'يضيف ويعدّل', upsertitem: 'يضيف ويعدّل أصناف',
  fire: 'يبعت للمطبخ', void: 'يلغي الشيك كله', voidline: 'يلغي صنف اتبعت', cancel: 'يلغي', confirm: 'يأكد', complete: 'يقفل', addlines: 'يضيف أصناف',
  updateline: 'يعدّل صنف', removeline: 'يشيل صنف', applydiscount: 'يعمل خصم', removediscount: 'يشيل خصم', comp: 'يعمل ضيافة', changechannel: 'يغيّر نوع الطلب',
  setcustomer: 'يحدد العميل', updatedetails: 'يعدّل البيانات', capture: 'يحصّل', correcttender: 'يصحح طريقة الدفع', request: 'يطلب', approve: 'يعتمد', reject: 'يرفض',
  open: 'يفتح', close: 'يقفل', move: 'يدخّل أو يصرف فلوس', opennosale: 'يفتح الدرج من غير بيع', xreport: 'يطلع تقرير نص الوردية', zreport: 'يطلع تقرير القفلة',
  release: 'يفضّي', assign: 'يوزّع', transfer: 'ينقل', advanceticket: 'يحرّك الطلبات', setprice: 'يغيّر الأسعار', setavailability: 'يعلّم «خلص»',
  updatepolicy: 'يغيّر الإعدادات', run: 'يشغّل', grant: 'يوافق', manageaccess: 'يغيّر الصلاحيات', reset: 'يعمل رقم سري جديد', setactive: 'يوقف ويشغّل',
  register: 'يسجّل', decommission: 'يشيل', issuedocument: 'يصدر إيصال', reprint: 'يعيد طباعة', retry: 'يعيد المحاولة', count: 'يجرد', start: 'يبدأ',
  submit: 'يعتمد', recordobservations: 'يسجل العد', adjust: 'يعمل تسوية', recordwaste: 'يسجل هالك', recordreturn: 'يسجل مرتجع', receive: 'يستلم',
  setsalesdefault: 'يحدد مخزن البيع', define: 'يعرّف', post: 'يسجّل', issue: 'يصدر', reverse: 'يعكس', dispatch: 'يطلّع الطيار', failattempt: 'يسجل محاولة فاشلة',
  redrive: 'يعيد الإرسال', replay: 'يعيد التشغيل', evaluate: 'يشغّل المطابقة', acknowledge: 'يأكد الفرق', pii: 'بيانات العملاء', settle: 'يحاسب',
};

/** «المطبخ · يبعت للمطبخ». */
export function permText(id: string): string {
  const parts = id.split(':');
  const mod = parts[0];
  if (mod === 'approve' && parts[1]) return t('موافقة مدير على: {a}', { a: actionTitle(parts[1].toUpperCase()) });
  if (parts.length === 1) return t(MODULE_TEXT[mod] ?? id);
  const act = parts.slice(1).map((a) => (ACTION_TEXT[a] ? t(ACTION_TEXT[a]) : a)).join(' — ');
  return `${t(MODULE_TEXT[mod] ?? mod)} · ${act}`;
}
export const moduleText = (m: string) => (m === '*' ? t('عام') : t(MODULE_TEXT[m] ?? m));

/** "Order.VoidLine" → «الشيكات · يلغي صنف اتبعت» (plain name of an operation for logs). */
export function opText(op: string): string {
  const [m, a] = String(op).split('.');
  if (!a) return t('حركة في السيستم');
  const mod = m.toLowerCase(), act = a.toLowerCase();
  const modName = MODULE_TEXT[mod] ?? MODULE_TEXT[mod.replace(/(item|policy|code|station|rule|profile|device|mapping|visit|job|delivery|request|ticket)$/, '')];
  const verb = ACTION_TEXT[act] ?? ACTION_TEXT[act.replace(/^(set|record)/, '')];
  if (!modName && !verb) return t('حركة في السيستم');
  return `${t(modName ?? '')}${modName && verb ? ' · ' : ''}${verb ? t(verb) : ''}`;
}
