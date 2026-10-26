// Lists every t('…') Arabic UI string that has no English entry in src/i18n/en.ts.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [];
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|ts)$/.test(f)) files.push(p); } };
walk(path.join(root, 'src'));
const keys = new Set();
const re = /\bt\(\s*'((?:[^'\\]|\\.)*)'/g;
for (const f of files) { const s = fs.readFileSync(f, 'utf8'); let m; while ((m = re.exec(s))) keys.add(m[1].replace(/\\'/g, "'")); }
const enSrc = fs.readFileSync(path.join(root, 'src/i18n/en.ts'), 'utf8');
const missing = [...keys].filter((k) => !enSrc.includes(JSON.stringify(k)));
fs.writeFileSync(process.argv[2] ?? '/dev/stdout', JSON.stringify(missing, null, 1));
console.error(`${keys.size} strings, ${missing.length} without English`);
