// Tells a keyboard-wedge barcode scanner apart from a person typing: a scanner sends its characters a few
// milliseconds apart and ends with Enter. A capture-phase listener runs before every screen's own key handler,
// so handlers can ask `inScanBurst()` about the key they are handling (typed quantity, Enter = primary action).
let last = 0;
let len = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key.length !== 1 && e.key !== 'Enter') return;
    const now = performance.now();
    len = now - last < 60 ? len + 1 : 1;
    last = now;
  }, true);
}
/** The key being handled belongs to a fast burst of 4+ keys (a scan), not to a person typing. */
export const inScanBurst = () => len >= 4;
/** Length of the current burst (1 for a single human key press). */
export const burstLength = () => len;
