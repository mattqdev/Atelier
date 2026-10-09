// Static checks for Atelier. Plain Node, no dependencies.
// - every locale has exactly the keys (and {placeholders}) of en.js
// - every locale file is loaded by Atelier.html and view.html
// - the example manifest points to existing boards whose @page size matches w/h
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');
const errors = [];
const fail = (msg) => errors.push(msg);

// ---------- i18n ----------
const sandbox = { window: {} };
vm.createContext(sandbox);
const localeFiles = readdirSync(join(root, 'app/locales')).filter((f) => f.endsWith('.js'));
for (const f of localeFiles) vm.runInContext(read(`app/locales/${f}`), sandbox, { filename: f });
const locales = sandbox.window.ATELIER_LOCALES || {};
const ref = locales.en;
if (!ref) fail('app/locales/en.js does not define ATELIER_LOCALES.en');

const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const [code, dict] of Object.entries(locales)) {
  if (code === 'en' || !ref) continue;
  for (const k of Object.keys(ref)) {
    if (!(k in dict)) fail(`locale ${code}: missing key "${k}"`);
    else if (vars(dict[k]) !== vars(ref[k])) fail(`locale ${code}: placeholders differ for "${k}"`);
  }
  for (const k of Object.keys(dict)) if (!(k in ref)) fail(`locale ${code}: unknown key "${k}" (not in en.js)`);
}

for (const page of ['Atelier.html', 'view.html']) {
  const html = read(page);
  const i18nAt = html.indexOf('app/i18n.js');
  for (const f of localeFiles) {
    const at = html.indexOf(`app/locales/${f}`);
    if (at < 0) fail(`${page}: missing <script> for app/locales/${f}`);
    else if (i18nAt >= 0 && at > i18nAt) fail(`${page}: app/locales/${f} must load before app/i18n.js`);
  }
}

// UI keys used in the markup must exist in en.js
for (const page of ['Atelier.html', 'view.html']) {
  for (const m of read(page).matchAll(/data-i18n(?:-title|-html)?="([^"]+)"/g)) {
    if (ref && !(m[1] in ref)) fail(`${page}: data-i18n key "${m[1]}" not in en.js`);
  }
}

// ---------- example manifest ----------
const ws = { window: {} };
vm.createContext(ws);
vm.runInContext(read('projects/example/manifest.js'), ws);
for (const section of ws.window.WORKSPACE?.sections || []) {
  for (const item of section.items || []) {
    const src = join(root, 'projects/example', item.src);
    if (!existsSync(src)) { fail(`example: ${item.id} → ${item.src} not found`); continue; }
    if (item.type !== 'html') continue;
    const m = readFileSync(src, 'utf8').match(/@page\s*{[^}]*size:\s*(\d+)px\s+(\d+)px/);
    if (!m) fail(`example: ${item.src} has no @page size`);
    else if (+m[1] !== item.w || +m[2] !== item.h) fail(`example: ${item.id} is ${item.w}×${item.h} in the manifest but @page is ${m[1]}×${m[2]}`);
  }
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log(`✓ ${localeFiles.length} locales, ${Object.keys(ref).length} keys, example manifest OK`);
