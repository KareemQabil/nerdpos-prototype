// Headless check: runs every walkthrough journey and the negative controls against the mock.
(globalThis as any).window = globalThis;
const { installMockFetch } = await import('../src/mock/fetch');
const { demo } = await import('../src/mock/demo');
const { sim } = await import('../src/mock/sim');
const { JOURNEYS } = await import('../src/demo/scripts');
const { NEGATIVE_RUNS } = await import('../src/demo/negatives');
const { devices } = await import('../src/app/devices');
installMockFetch();
let failures = 0;
const runJourney = async (id: string) => {
  const j = JOURNEYS.find((x) => x.id === id)!;
  console.log(`\n=== ${j.id} ${j.titleEn}`);
  for (const s of j.steps) {
    const lines: any[] = [];
    try { await s.run((l) => lines.push(l)); } catch (e: any) { lines.push({ ok: false, text: 'THROWN ' + (e.code ?? '') + ' ' + (e.message ?? e) }); }
    const bad = lines.filter((l) => l.ok === false);
    failures += bad.length;
    console.log(`${bad.length ? '✗' : '✓'} ${s.id}  ${lines.map((l) => (l.ok === false ? '[FAIL] ' : '') + l.text).join(' | ').slice(0, 600)}`);
  }
};
demo.reset('DEMO'); devices.resetAll(); sim.set({ latencyMs: 0 });
for (const id of ['J-R1', 'J-R2', 'J-R3', 'J-R4', 'J-C1', 'J-F1', 'J-P1', 'J-D1', 'J-B1', 'J-H1', 'J-K1', 'J-V1']) await runJourney(id); // ux-11: J-D1 riders · ux-12: J-B1 reservations · ux-10b: J-H1 handover and settings · ux-13: J-K1 customers and loyalty · ux-14: J-V1 devices and displays
sim.set({ dropNextResponse: null, kds: 'UP', eta: 'UP', printers: {} });
console.log('\n=== NEGATIVE CONTROLS (fresh demo data)');
demo.reset('DEMO'); devices.resetAll(); sim.set({ latencyMs: 0 });
for (const [id, fn] of Object.entries(NEGATIVE_RUNS)) {
  const lines: any[] = [];
  let ok = false;
  try { ok = await fn((l) => lines.push(l)); } catch (e: any) { lines.push({ ok: false, text: 'THROWN ' + (e.code ?? '') + ' ' + (e.message ?? e) }); }
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}  ${lines.filter((l) => l.ok !== null).map((l) => (l.ok === false ? '[x] ' : '') + l.text).join(' | ').slice(0, 500)}`);
}
console.log('\n=== J-A1 from zero');
demo.reset('ZERO'); devices.resetAll(); sim.set({ latencyMs: 0 });
await runJourney('J-A1');
console.log(`\nFAILURES: ${failures}`);
process.exit(0);
