// Turns dist/index.html into dist/artifact.html: the page body for a claude.ai Artifact publish
// (the Artifact skeleton supplies doctype/head/body). CSS is inlined; JS chunks stay as published files.
import fs from 'node:fs';
const html = fs.readFileSync('dist/index.html', 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)].map((m) => fs.readFileSync('dist/' + m[1], 'utf8')).join('\n');
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g)].map((m) => m[1]);
const out = `<title>NerdPOS Prototype</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Almarai:wght@300;400;700;800&family=Inter:wght@400;500;600;700&display=swap">
<style>${css}</style>
<div id="root"></div>
${js.map((s) => `<script type="module" src="./${s}"></script>`).join('\n')}
`;
fs.writeFileSync('dist/artifact.html', out);
const files = fs.readdirSync('dist/assets').filter((f) => f.endsWith('.js'));
fs.writeFileSync('dist/artifact-files.json', JSON.stringify(Object.fromEntries(files.map((f) => [`assets/${f}`, `dist/assets/${f}`])), null, 1));
console.log(`artifact.html ${(out.length / 1024).toFixed(0)} KB, ${files.length} js files`);
