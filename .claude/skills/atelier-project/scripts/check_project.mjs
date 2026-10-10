// Validate one Atelier project. Plain Node, no dependencies.
// Usage: node check_project.mjs <projectId> [--root <atelierRoot>]
// - project is registered in projects/index.js
// - manifest.js loads, ids are unique, every src exists
// - html boards: one @page size matching w/h, one <section class="page">
// - images: pixel size has the same aspect ratio as w/h (cropping otherwise:
//   the canvas uses object-fit: cover) and is at least w×h (blurry otherwise)
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
const ri = args.indexOf('--root');
// default root: the repo this skill lives in (.claude/skills/<skill>/scripts → 4 levels up)
const root = ri >= 0 ? resolve(args[ri + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
if (!id) { console.error('usage: node check_project.mjs <projectId> [--root <dir>]'); process.exit(2); }

const errors = [], warnings = [];
const dir = join(root, 'projects', id);
const load = (file, key) => {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(file, 'utf8'), ctx, { filename: file });
  return ctx.window[key];
};

// ---------- registry ----------
const indexFile = join(root, 'projects/index.js');
if (!existsSync(indexFile)) errors.push('projects/index.js not found');
else {
  const reg = load(indexFile, 'ATELIER_PROJECTS') || [];
  if (!reg.some((p) => p.id === id)) errors.push(`"${id}" is not registered in projects/index.js`);
}

// ---------- image size (png, jpg, gif, webp, svg) ----------
function imageSize(file) {
  const b = readFileSync(file);
  if (b.slice(1, 4).toString() === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.slice(0, 3).toString() === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') {
    const k = b.slice(12, 16).toString();
    if (k === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (k === 'VP8L') { const n = b.readUInt32LE(21); return [1 + (n & 0x3fff), 1 + ((n >> 14) & 0x3fff)]; }
    if (k === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  }
  const s = b.toString('utf8', 0, Math.min(b.length, 4096));
  if (/<svg/i.test(s)) {
    const vb = s.match(/viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    const w = s.match(/<svg[^>]*\swidth=["']([\d.]+)(px)?["']/), h = s.match(/<svg[^>]*\sheight=["']([\d.]+)(px)?["']/);
    if (w && h) return [+w[1], +h[1]];
    if (vb) return [+vb[1], +vb[2]];
  }
  return null;
}

// ---------- manifest ----------
const mf = join(dir, 'manifest.js');
let ws;
if (!existsSync(mf)) errors.push(`projects/${id}/manifest.js not found`);
else {
  try { ws = load(mf, 'WORKSPACE'); } catch (e) { errors.push(`manifest.js does not load: ${e.message}`); }
  if (ws && !ws.name) warnings.push('manifest has no name');
}
let boards = 0;
if (ws) {
  if (ws.logo && !existsSync(join(dir, ws.logo))) errors.push(`logo ${ws.logo} not found`);
  const ids = new Set(), secIds = new Set();
  for (const s of ws.sections || []) {
    if (secIds.has(s.id)) errors.push(`duplicate section id "${s.id}"`);
    secIds.add(s.id);
    for (const it of s.items || []) {
      boards++;
      const at = `${s.id}/${it.id}`;
      if (ids.has(it.id)) errors.push(`duplicate item id "${it.id}"`);
      ids.add(it.id);
      for (const k of ['id', 'title', 'type', 'src', 'w', 'h']) if (it[k] == null) errors.push(`${at}: missing "${k}"`);
      if (!['html', 'image'].includes(it.type)) errors.push(`${at}: type must be "html" or "image"`);
      if (it.status && !['draft', 'review', 'approved'].includes(it.status)) warnings.push(`${at}: unknown status "${it.status}"`);
      const src = join(dir, it.src || '');
      if (!it.src || !existsSync(src)) { errors.push(`${at}: ${it.src} not found`); continue; }
      if (it.type === 'html') {
        const html = readFileSync(src, 'utf8');
        const pages = [...html.matchAll(/@page\s*{[^}]*size:\s*(\d+)px\s+(\d+)px/g)];
        if (!pages.length) errors.push(`${at}: no @page size in ${it.src}`);
        else if (+pages[0][1] !== it.w || +pages[0][2] !== it.h) errors.push(`${at}: manifest ${it.w}×${it.h} but @page ${pages[0][1]}×${pages[0][2]}`);
        const secs = (html.match(/<section[^>]*class=["'][^"']*\bpage\b/g) || []).length;
        if (secs !== 1) warnings.push(`${at}: expected one <section class="page">, found ${secs}`);
      } else {
        const sz = imageSize(src);
        if (!sz) { warnings.push(`${at}: could not read image size`); continue; }
        const [pw, ph] = sz;
        if (Math.abs(pw / ph - it.w / it.h) > 0.01) errors.push(`${at}: image is ${pw}×${ph}, aspect differs from ${it.w}×${it.h} (it would be cropped)`);
        else if (!/\.svg$/i.test(it.src) && pw < it.w - 1) warnings.push(`${at}: image is ${pw}×${ph}, smaller than ${it.w}×${it.h} (upscaled)`);
      }
    }
  }
}

for (const w of warnings) console.log(`! ${w}`);
if (errors.length) { console.error(errors.map((e) => `✗ ${e}`).join('\n')); process.exit(1); }
console.log(`✓ ${id}: ${(ws?.sections || []).length} sections, ${boards} boards OK`);
