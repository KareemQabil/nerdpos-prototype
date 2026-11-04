// ux-17: loads the PDF writer only when a PDF is made: jsPDF, jspdf-autotable and the embedded Arabic font (IBM Plex
// Sans Arabic Regular + Bold, unmodified, SIL Open Font License 1.1 — src/assets/fonts/OFL.txt). Bundled with the app (no
// network font service), fetched once and kept for the page.
import type { PdfKit } from './pdf';

let once: Promise<PdfKit> | null = null;
const b64 = (buf: ArrayBuffer) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export function loadPdfKit(): Promise<PdfKit> {
  once ??= (async () => {
    const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const get = async (u: URL) => { const r = await fetch(u.href); if (!r.ok) throw new Error(`font ${r.status}`); return b64(await r.arrayBuffer()); };
    const [regular, bold] = await Promise.all([
      get(new URL('../../assets/fonts/IBMPlexSansArabic-Regular.ttf', import.meta.url)),
      get(new URL('../../assets/fonts/IBMPlexSansArabic-Bold.ttf', import.meta.url)),
    ]);
    return { jsPDF, autoTable: (at as any).autoTable ?? (at as any).default, fonts: { regular, bold } };
  })().catch((e) => { once = null; throw e; });
  return once;
}
