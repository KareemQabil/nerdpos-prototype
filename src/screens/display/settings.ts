// ux-14: a display screen's settings are a server record of the device registry (managed in «الأجهزة»: which terminal
// it follows, its look, the branding strip; the customer display's content and timing come with it). The screen reads
// them with its own view (CustomerDisplay.View / CallBoard.View with displayId). The display device keeps only
// per-viewer conveniences — mute (app/sound) and full screen; nothing else is stored in its browser.
export type DisplayStyle = 'theme' | 'display';
export interface DisplayConfig {
  id: string; code: string; name: string; kind: 'CUSTOMER_DISPLAY' | 'CALL_BOARD'; enabled: boolean;
  style: DisplayStyle; branding: boolean; slideSeconds: number; thanksSeconds: number; idleContent: 'ASSIGNED_ONLY' | 'ASSIGNED_AND_PROMOTIONS';
}
/** Shown until the server answers (the strictest workable defaults of CustomerDisplayPolicy). */
export const DISPLAY_DEFAULT: Omit<DisplayConfig, 'id' | 'code' | 'name' | 'kind'> = { enabled: true, style: 'theme', branding: true, slideSeconds: 8, thanksSeconds: 60, idleContent: 'ASSIGNED_ONLY' };

// the settings a display kept in its own browser before ux-14 are dropped once (the server record replaces them)
try { if (typeof localStorage !== 'undefined') localStorage.removeItem('nerdpos.display.v1'); } catch { /* blocked storage: nothing to drop */ }
