// Welcome / onboarding: shown on the first visit and from the "مساعدة" button.
// Explains in a few plain lines what this demo is, offers "جرّب كـ…" cards that log the right device in and open
// the right screen (and/or the matching guided journey), and a compact "how to use the demo" page.
import React, { useState } from 'react';
import { Armchair, ShoppingCart, ChefHat, Briefcase, Crown, Wrench, MonitorSmartphone, Columns2, Clock, Radio, MessageSquarePlus, RotateCcw, SlidersHorizontal, PlayCircle, FlaskConical, Code2, KeyRound, ArrowLeft } from 'lucide-react';
import { Modal, Button, Tabs, toast, confirmDialog } from '../ui';
import { t, getLang } from '../i18n';
import { cn } from '../lib/format';
import { devices } from '../app/devices';
import { store } from '../mock/store';
import { demo } from '../mock/demo';
import { apiLog } from '../mock/kernel';
import { errorText } from '../app/hooks';
import { as } from './runner';
import { openJourney } from './Walkthrough';
import { PERSONAS, DEVICE_NAMES, deviceName } from './people';

const SEEN = 'nerdpos.welcome.v1';
export const welcomeSeen = () => { try { return localStorage.getItem(SEEN) === '1'; } catch { return true; } };
export const markWelcomeSeen = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* ignore */ } };

interface Role { id: string; icon: React.ElementType; title: string; who: string; what: string; device: string; user: string | null; screen: string; journey?: string; journeyLabel?: string; tone: string; zero?: boolean }
const ROLES: Role[] = [
  { id: 'waiter', icon: Armchair, title: 'ويتر', who: 'محمود على تابلت الويتر', what: 'افتح ترابيزة، خد الطلب، وابعته للمطبخ على دفعات.', device: 't_floor', user: 'demo-waiter-1', screen: 'floor', journey: 'J-R1', journeyLabel: 'رحلة: يوم صالة كامل', tone: 'from-pink-400 to-rose-500' },
  { id: 'cashier', icon: ShoppingCart, title: 'كاشير', who: 'سارة على جهاز الكاشير', what: 'افتح الوردية، بيع تيك أواي، حصّل شيكات الترابيزات، واقفل الدرج.', device: 't_cash', user: 'demo-cashier-a', screen: 'counter', journey: 'J-C1', journeyLabel: 'رحلة: كاونتر وتيك أواي', tone: 'from-cyan-400 to-blue-600' },
  { id: 'kitchen', icon: ChefHat, title: 'المطبخ', who: 'الشيف حسن على شاشة المطبخ', what: 'شوف الطلبات اللي بتوصل لكل محطة، ابدأها وخلّصها.', device: 't_kds', user: 'demo-chef-1', screen: 'kitchen', tone: 'from-red-400 to-red-600' },
  { id: 'manager', icon: Briefcase, title: 'مدير', who: 'أحمد على كمبيوتر المدير', what: 'وافق على الإلغاءات والمرتجعات، تابع الشيكات والتقارير.', device: 't_admin', user: 'demo-manager-1', screen: 'home', journey: 'J-R2', journeyLabel: 'رحلة: إلغاء شيك بموافقة مدير', tone: 'from-amber-400 to-orange-600' },
  { id: 'owner', icon: Crown, title: 'صاحب المطعم', who: 'الحاج سامي من الإدارة (أي كمبيوتر)', what: 'المنيو والأسعار والإعدادات والتقارير — وكل الصلاحيات.', device: 'BO', user: 'demo-owner', screen: 'reports', tone: 'from-violet-400 to-purple-600' },
  { id: 'setup', icon: Wrench, title: 'تركيب مطعم من الصفر', who: 'كريم مهندس التركيب', what: 'ابدأ بمطعم فاضي: الفرع والأجهزة والناس والمنيو لحد أول بيعة.', device: 'BO', user: null, screen: 'home', journey: 'J-A1', journeyLabel: 'رحلة: تركيب مطعم من الصفر', tone: 'from-emerald-400 to-teal-600', zero: true },
];

export function Welcome({ open, onClose, onOpenPanel, startTab = 'start' }: { open: boolean; onClose: () => void; onOpenPanel: (p: 'walk' | 'policy') => void; startTab?: 'start' | 'help' }) {
  const [tab, setTab] = useState<'start' | 'help'>(startTab);
  const [busy, setBusy] = useState<string | null>(null);
  const close = () => { markWelcomeSeen(); onClose(); };
  const ensureDemoData = async (username: string) => {
    if (store.db.users.some((u) => u.username === username)) return true;
    if (!await confirmDialog(t('إنت دلوقتي في مطعم فاضي (من التركيب من الصفر)، والناس دي مش موجودة فيه. نرجّع بيانات التجربة؟'))) return false;
    demo.reset('DEMO'); devices.resetAll(); apiLog.clear();
    return true;
  };
  const tryRole = async (r: Role, withJourney: boolean) => {
    setBusy(r.id + (withJourney ? ':j' : ''));
    try {
      if (r.zero) {
        if (!await confirmDialog(t('هنبدأ بمطعم فاضي خالص — بيانات التجربة هتتمسح (تقدر ترجعها في أي وقت من «البيانات»). نكمل؟'))) return;
        demo.reset('ZERO'); devices.resetAll(); apiLog.clear();
        devices.setPrimary('BO'); devices.setSplit(false);
        openJourney('J-A1');
        close(); onOpenPanel('walk');
        toast('success', t('مطعم فاضي جاهز — امشي مع الرحلة خطوة بخطوة'));
        return;
      }
      if (!r.user || !await ensureDemoData(r.user)) return;
      devices.setPrimary(r.device);
      devices.setSplit(false);
      await as(r.device, r.user);
      devices.navigate(r.device, r.screen, {});
      const p = PERSONAS[r.user];
      if (withJourney && r.journey) { openJourney(r.journey); onOpenPanel('walk'); }
      close();
      toast('success', t('دخلت كـ {n} على {d}', { n: p ? (getLang() === 'en' ? `${p.en} (${p.roleEn})` : `${p.name} (${p.role})`) : t(r.title), d: DEVICE_NAMES[r.device] ? deviceName(r.device) : '' }));
    } catch (e) { toast('error', errorText(e)); } finally { setBusy(null); }
  };
  return (
    <Modal open={open} onClose={close} xwide title={<span className="flex items-center gap-2">{t('أهلًا بيك في تجربة NerdPOS')}</span>}
      footer={<><span className="text-[11px] text-dim me-auto">{t('تقدر ترجع للشاشة دي في أي وقت من زرار «مساعدة» فوق.')}</span><Button variant="primary" onClick={close} data-fb="welcome:close">{t('يلا نبدأ')}</Button></>}>
      <div className="space-y-4" data-screen="WELCOME">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'start', label: t('ابدأ من هنا') }, { id: 'help', label: t('إزاي أستخدم التجربة') }]} />
        {tab === 'start' ? (
          <>
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--primary)_25%,transparent)] bg-[linear-gradient(135deg,var(--primary-container),transparent_70%)] p-4 space-y-1.5 text-sm leading-relaxed">
              <p>{t('ده مطعم تجريبي كامل جوه المتصفح: صالة وكاشير ومطبخ ومدير وإدارة — كل جهاز زرار فوق.')}</p>
              <p>{t('كل البيانات وهمية: مفيش فلوس حقيقية بتتحرك، مفيش دفع بجد، ومفيش حاجة بتتبعت للضرايب. جرّب براحتك واغلط براحتك.')}</p>
              <p>{t('الرقم السري لكل الناس')}: <b className="num">{demo.pin}</b> — {t('أو اضغط «دخول سريع».')}</p>
              <p className="text-dim text-xs">{t('شايف حاجة غلط أو ناقصة؟ شغّل «ملاحظة» من الشريط اللي فوق واضغط عليها واكتب رأيك.')}</p>
            </div>
            <div>
              <div className="font-bold mb-2.5 text-base">{t('جرّب كـ…')}</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {ROLES.map((r) => {
                  const Icon = r.icon;
                  return (
                    <div key={r.id} className="rounded-2xl border border-[var(--glass-border)] bg-[var(--surface-1)] p-4 flex flex-col gap-2.5 card-surface card-interactive" data-fb={`welcome:role:${r.id}`}>
                      <div className="flex items-center gap-2">
                        <span className={cn('w-10 h-10 rounded-xl bg-gradient-to-br text-slate-900 flex items-center justify-center shrink-0', r.tone)}><Icon className="w-5 h-5" /></span>
                        <div className="min-w-0"><div className="font-bold">{t(r.title)}</div><div className="text-[11px] text-dim">{t(r.who)}</div></div>
                      </div>
                      <div className="text-xs text-soft flex-1">{t(r.what)}</div>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="subtle" loading={busy === r.id} onClick={() => tryRole(r, !!r.zero)} data-fb={`welcome:try:${r.id}`}>{r.zero ? t('ابدأ التركيب') : t('ادخل')}<ArrowLeft className="w-3.5 h-3.5 ltr:rotate-180" /></Button>
                        {r.journey && !r.zero && <Button size="sm" variant="ghost" loading={busy === r.id + ':j'} onClick={() => tryRole(r, true)} data-fb={`welcome:journey:${r.id}`}><PlayCircle className="w-3.5 h-3.5" />{t(r.journeyLabel!)}</Button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : <HelpPage onOpenPanel={(p) => { close(); onOpenPanel(p); }} />}
      </div>
    </Modal>
  );
}

function HelpPage({ onOpenPanel }: { onOpenPanel: (p: 'walk' | 'policy') => void }) {
  const items: { icon: React.ElementType; title: string; body: string }[] = [
    { icon: MonitorSmartphone, title: 'الأجهزة', body: 'كل زرار في أول الشريط جهاز في المطعم: الكاشير، تابلت الويتر، المطبخ، كمبيوتر المدير، والإدارة. كل جهاز عليه الشخص اللي داخل بيه، واللي بيحصل على جهاز بيبان على الباقيين.' },
    { icon: KeyRound, title: 'الدخول', body: 'اختار اسمك واكتب الرقم السري 123456 (أو «دخول سريع»). كل شخص بيشوف الشاشات اللي مسموح له بيها بس.' },
    { icon: Columns2, title: 'جهازين جنب بعض', body: 'اضغط «جهازين» عشان تشوف شاشتين مع بعض — مثلًا الويتر بيبعت والمطبخ بيستلم. كليك يمين على أي جهاز بيفتحه في الشاشة التانية.' },
    { icon: Clock, title: 'الساعة', body: 'السيستم ليه ساعة لوحده تقدر تقدّمها: مثلًا بعد نص الليل عشان تشوف إن البيع لسه على نفس اليوم التجاري، أو 12 ساعة عشان تنبيهات الإيصال الإلكتروني.' },
    { icon: Radio, title: 'محاكاة الأعطال', body: 'وقّع الطابعة أو شاشة المطبخ أو منظومة الضرايب أو البرامج المربوطة، اقطع النت عن جهاز، أو ضيّع رد الشبكة — وشوف إن البيع بيكمل ومفيش حاجة بتتكرر.' },
    { icon: SlidersHorizontal, title: 'إعدادات المطعم', body: 'غيّر أي إعداد (مثلًا الخدمة 12%، أو الويتر يفتح شيك من غير درج) وشوف الأجهزة بتتصرف إزاي. التغيير بيطبق على اللي جاي بس.' },
    { icon: PlayCircle, title: 'رحلات بالخطوة', body: 'قصص جاهزة من يوم المطعم: كل خطوة بتقولك مين يعمل إيه وعلى أنهي جهاز والمفروض تشوف إيه. تعملها بإيدك أو السيستم يعملها قدامك.' },
    { icon: FlaskConical, title: 'سيناريوهات الفشل', body: 'تجارب جاهزة لحاجات المفروض السيستم يرفضها: ضغطتين ورا بعض، جهازين في نفس اللحظة، مدير بيوافق لنفسه…' },
    { icon: MessageSquarePlus, title: 'الملاحظات', body: 'شغّل «ملاحظة» من الشريط اللي فوق واضغط على أي حاجة في الشاشة واكتب رأيك (غلط، ناقص، مش واضح). بعدين نزّل الملاحظات كملف وابعتهولنا.' },
    { icon: RotateCcw, title: 'البيانات', body: 'رجّع بيانات التجربة زي الأول، أو ابدأ بمطعم فاضي، أو احفظ نسخة وارجعلها بعدين.' },
    { icon: Code2, title: 'تفاصيل تقنية', body: 'للفريق بس: بيظهر أكواد العمليات والأخطاء والقيم الخام وسجل الطلبات. سيبه مقفول وإنت بتجرب.' },
  ];
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-2">
        {items.map((i) => { const Icon = i.icon; return (
          <div key={i.title} className="rounded-xl surface-1 border line p-3 flex gap-3">
            <span className="w-8 h-8 rounded-lg bg-[var(--primary-container)] text-[var(--primary)] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
            <div><div className="font-bold text-sm">{t(i.title)}</div><div className="text-xs text-soft leading-relaxed">{t(i.body)}</div></div>
          </div>
        ); })}
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => onOpenPanel('walk')}><PlayCircle className="w-4 h-4" />{t('افتح الرحلات')}</Button>
        <Button size="sm" onClick={() => onOpenPanel('policy')}><SlidersHorizontal className="w-4 h-4" />{t('افتح إعدادات المطعم')}</Button>
      </div>
    </div>
  );
}
