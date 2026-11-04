// ux-12: reservation and deposit state labels (Arabic keys through t()), shared by «الحجوزات» and the customer profile.
type Tone = 'primary' | 'success' | 'error' | 'neutral' | 'warning' | 'violet' | 'info';
export const RES_STATE: Record<string, [string, Tone]> = { BOOKED: ['محجوز', 'primary'], SEATED: ['جلس الضيوف', 'success'], NO_SHOW: ['لم يحضر', 'error'], CANCELLED: ['ملغى', 'neutral'] };
export const DEP_STATE: Record<string, [string, Tone]> = { HELD: ['محتفظ به', 'warning'], APPLIED: ['خُصم من الشيك', 'success'], FORFEITED: ['مُصادَر', 'error'], REFUNDED: ['مردود', 'neutral'] };
