// Builds the browser contract bundle in src/contracts from the spec pack in docs/pack.
// Run automatically by `npm run dev` and `npm run build`.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pack = path.join(root, 'docs', 'pack');
const out = path.join(root, 'src', 'contracts');
fs.mkdirSync(out, { recursive: true });

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(pack, p), 'utf8'));
const write = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 1));

// 1. Operations: operations.json + operations that exist only in the accepted OpenAPI (Auth.*).
const ops = readJson('contracts/operations.json');
const known = new Set(ops.map((o) => o.id));
const openapi = readJson('contracts/openapi.main.json');
for (const [p, methods] of Object.entries(openapi.paths)) {
  for (const [m, def] of Object.entries(methods)) {
    const id = def.operationId;
    if (!id || known.has(id)) continue;
    const props = def.requestBody?.content?.['application/json']?.schema?.properties ?? {};
    const required = def.requestBody?.content?.['application/json']?.schema?.required ?? [];
    const input = {};
    for (const [k, v] of Object.entries(props)) input[k] = { type: v.type ?? v.$ref?.split('/').pop() ?? 'any', required: required.includes(k) };
    ops.push({
      id,
      module: id.split('.')[0].toLowerCase(),
      kind: m === 'get' ? 'QRY' : 'CMD',
      method: m.toUpperCase(),
      path: p.replace(/\{(\w+)\}/g, '{$1}'),
      route_class: 'PUBLIC_POS',
      permission: id === 'Auth.Login' ? 'PUBLIC' : 'AUTHENTICATED',
      input,
      output: null,
      errors: id === 'Auth.Login' ? ['UNAUTHENTICATED', 'CREDENTIAL_LOCKED'] : ['UNAUTHENTICATED'],
      approval: null,
      backend_state: 'BUILT_ON_MAIN',
      note: 'from contracts/openapi.main.json (not in operations.json)',
      source: 'openapi',
    });
    known.add(id);
  }
}
write('operations.json', ops);
write('errors.json', readJson('contracts/errors.json'));
write('policies.json', readJson('rules/policies.json'));
write('approval_actions.json', readJson('rules/approval_actions.json'));
write('eg-profile.json', readJson('rules/EG.profile.json'));
write('seed.json', readJson('data/demo-provisioning-1.2.json'));

// 2. Journeys: parse the generated markdown walkthroughs into steps.
const stripDiv = (s) => s.replace(/<div[^>]*>/g, '').replace(/<\/div>/g, '').trim();
function parseJourney(file) {
  const text = fs.readFileSync(path.join(pack, file), 'utf8');
  const lines = text.split('\n');
  const steps = [];
  let journey = null;
  let journeyTitle = '';
  let journeyTitleAr = '';
  let cur = null;
  let lastKey = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h2 = line.match(/^## (J-[A-Z]\d+): (.*)$/) || line.match(/^## (Phase [A-Z]): (.*)$/);
    if (h2) {
      journey = h2[1];
      journeyTitle = h2[2];
      journeyTitleAr = '';
      const next = lines.slice(i + 1, i + 4).find((l) => l.includes('dir="rtl"'));
      if (next) journeyTitleAr = stripDiv(next);
      continue;
    }
    const h3 = line.match(/^### (J-[A-Z]\d+) · step (\d+)/);
    if (h3) {
      cur = { id: `${h3[1]}-${h3[2]}`, journey: h3[1], group: journey, groupTitle: journeyTitle, groupTitleAr: journeyTitleAr, step: Number(h3[2]), who: '', do_en: '', do_ar: '', expect_en: '', expect_ar: '', note: '', operations: [] };
      steps.push(cur);
      lastKey = null;
      continue;
    }
    if (!cur || !line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length === 2) {
      const [k, v] = cells;
      const kk = stripDiv(k);
      if (/^Who/.test(kk)) cur.who = v.replace(/`/g, '');
      else if (kk === 'Do') { cur.do_en = v; lastKey = 'do'; }
      else if (kk === 'نفّذ') cur.do_ar = stripDiv(v);
      else if (/^Expect/.test(kk)) { cur.expect_en = v; lastKey = 'expect'; }
      else if (kk === 'المتوقع') cur.expect_ar = stripDiv(v);
      else if (kk === 'Note' || kk === 'Approver') cur.note += (cur.note ? ' · ' : '') + `${kk}: ${v.replace(/`/g, '')}`;
    } else if (cells.length === 5 && cells[0].startsWith('`')) {
      cur.operations.push({ op: cells[0].replace(/`/g, ''), http: cells[2], actor: cells[3].replace(/`/g, ''), expected: cells[4].replace(/<br>/g, ' · ').replace(/`/g, '') });
    }
  }
  return steps;
}
const journeys = [
  ...parseJourney('journeys/SETUP_JOURNEY_J-A1.md'),
  ...parseJourney('journeys/OPERATOR_WALKTHROUGH_J-R1_R4.md'),
];
write('journeys.json', journeys);

// 3. Negative controls.
const neg = fs.readFileSync(path.join(pack, 'journeys/NEGATIVE_CONTROLS_N1_N12.md'), 'utf8');
const negatives = [];
for (const block of neg.split(/\n## /).slice(1)) {
  const m = block.match(/^(N\d+): (.*)/);
  if (!m) continue;
  const get = (label) => (block.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n- \\*\\*|$)`)) || [])[1]?.trim() ?? '';
  negatives.push({ id: m[1], title: m[2].trim(), operation: get('Operation').replace(/`/g, ''), precondition: get('Precondition'), steps: get('Steps'), expected: get('Expected'), codes: get('Codes').replace(/`/g, '') });
}
write('negatives.json', negatives);

// 4. 1000 situation titles.
const sit = fs.readFileSync(path.join(pack, 'journeys/SITUATIONS_1000_TITLES.md'), 'utf8');

const groups = [];
for (const line of sit.replace(/\r/g, '').split('\n')) {
  const g = line.match(/^## (G\d+) (.*)$/);
  if (g) { groups.push({ id: g[1], title: g[2], items: [] }); continue; }
  const s = line.match(/^- (SC-\d+) (.*)$/);
  if (s && groups.length) groups[groups.length - 1].items.push({ id: s[1], title: s[2] });
}
write('situations.json', groups);

console.log(`contracts: ${ops.length} operations, ${journeys.length} journey steps, ${negatives.length} negative controls, ${groups.reduce((a, g) => a + g.items.length, 0)} situations`);
