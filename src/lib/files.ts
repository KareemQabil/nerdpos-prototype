// Offer a generated file to the user. Inside a claude.ai Artifact the frame blocks direct downloads, so the
// `downloads` capability is used when present; otherwise a plain <a download> link (local `npm run dev`).
type Saver = { save(r: { filename: string; data: string | Blob | ArrayBuffer | ArrayBufferView }): Promise<unknown> };
let saver: Promise<Saver | null> | null = null;

function getSaver(): Promise<Saver | null> {
  const c = (window as any).claude;
  if (!c?.use) return Promise.resolve(null);
  saver ??= Promise.resolve(c.use('downloads')).catch(() => null);
  return saver;
}

/** Resolves true when saved, false when the user declined. Throws only when no way to save exists. */
export async function saveFile(filename: string, data: string | Blob | ArrayBuffer | ArrayBufferView, mime = 'application/octet-stream'): Promise<boolean> {
  const s = await getSaver();
  if (s) {
    try { await s.save({ filename, data }); return true; } catch (e: any) {
      if (e?.code === 'declined') return false;
      if (e?.code !== 'unavailable' && e?.code !== 'not_granted') throw e;
    }
  }
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
