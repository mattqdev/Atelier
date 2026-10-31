/* =========================================================
   ATELIER — export, Figma-style
   Boards are rendered by headless Chrome through the local server
   (atelier.py → /__atelier/render), so the output matches the
   browser exactly. The server keeps one Chrome running and renders
   several boards at once, so jobs are sent in parallel. Files come
   straight from Chrome when the size is exact; otherwise the PNG is
   resampled here. Several PDFs can be merged into one (a page per
   board). Several files are bundled into a ZIP (stored, no
   compression, no dependencies).

   Each export setting is { scale, suffix, format, quality }:
     scale   → "2x" | "512w" (width in px) | "1080h" (height in px)
     suffix  → appended to the file name; empty = "@2x" style default
     format  → png | jpg | webp | pdf (pdf is vector, scale ignored)
     quality → 1–100, jpg/webp only
   Settings are remembered in localStorage (atelier-export, and
   atelier-export-merge for the single-PDF checkbox).

   API: ATELIER_EXPORT.open({ projectName, base, groups, checked })
        ATELIER_EXPORT.copyImage(base, def)
        ATELIER_EXPORT.available() → Promise<'ok'|'nochrome'|'noserver'>
   ========================================================= */
(() => {
  const { t } = window.ATELIER_I18N;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'atelier-export', MERGE_KEY = 'atelier-export-merge';
  const PARALLEL = 4; // requests in flight; the server caps its own Chrome tabs
  const FORMATS = {
    png: { label: 'PNG', mime: 'image/png' },
    jpg: { label: 'JPG', mime: 'image/jpeg', quality: true },
    webp: { label: 'WEBP', mime: 'image/webp', quality: true },
    pdf: { label: 'PDF', mime: 'application/pdf', vector: true }
  };
  const SCALES = ['0.5x', '0.75x', '1x', '1.5x', '2x', '3x', '4x', '512w', '1080w', '2048w', '1080h'];
  const MAX_SIDE = 16384;

  /* ---------- SERVER ---------- */
  let ping;
  const available = () => ping ||= /^https?:$/.test(location.protocol)
    ? fetch('__atelier/ping').then(r => r.ok ? r.json().then(j => j.export ? 'ok' : 'nochrome') : 'noserver').catch(() => 'noserver')
    : Promise.resolve('noserver');

  // defs: one board, or several for a single multi-page PDF
  async function render(base, defs, scale, format, quality) {
    const q = new URLSearchParams({ scale, format });
    if (quality) q.set('quality', quality);
    for (const def of [].concat(defs)) {
      q.append('src', base + def.src); q.append('type', def.type === 'image' ? 'image' : 'html');
      q.append('w', def.w); q.append('h', def.h);
    }
    const r = await fetch('__atelier/render?' + q);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.blob();
  }

  /* ---------- SETTINGS ---------- */
  // "2x" → 2 · "512w" → 512 / w · "1080h" → 1080 / h
  function parseScale(str, w, h) {
    const m = String(str).trim().match(/^(\d*\.?\d+)\s*(x|w|h)?$/i);
    if (!m) return null;
    const v = +m[1], u = (m[2] || 'x').toLowerCase();
    const s = u === 'x' ? v : u === 'w' ? v / w : v / h;
    return s > 0 && Math.max(w, h) * s <= MAX_SIDE ? s : null;
  }
  const autoSuffix = p => {
    if (FORMATS[p.format].vector) return '';
    const m = String(p.scale).trim().match(/^(\d*\.?\d+)\s*x?$/i);
    return m && +m[1] !== 1 ? '@' + +m[1] + 'x' : '';
  };
  const suffixOf = p => p.suffix || autoSuffix(p);
  const safe = s => String(s).replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'board';
  const fileName = (def, p) => safe(def.title || def.id) + suffixOf(p) + '.' + p.format;
  const sizeOf = (def, p) => {
    const s = parseScale(p.scale, def.w, def.h);
    return s && [Math.max(1, Math.round(def.w * s)), Math.max(1, Math.round(def.h * s))];
  };

  const load = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(v) && v.length && v.every(p => FORMATS[p.format])) return v;
    } catch {}
    return [{ scale: '1x', suffix: '', format: 'png', quality: 90 }];
  };
  const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
  const loadMerge = () => { try { return localStorage.getItem(MERGE_KEY) === '1'; } catch { return false; } };
  const saveMerge = v => { try { localStorage.setItem(MERGE_KEY, v ? '1' : '0'); } catch {} };

  /* ---------- PRODUCE ONE FILE ---------- */
  async function produce(base, def, p, cache) {
    const f = FORMATS[p.format];
    if (f.vector) return render(base, def, 1, 'pdf');
    const s = parseScale(p.scale, def.w, def.h);
    const [tw, th] = sizeOf(def, p);
    // whole-pixel size: Chrome encodes the final file itself, no round trip through a canvas
    if (Number.isInteger(def.w * s) && Number.isInteger(def.h * s)) {
      if (p.format !== 'png') return render(base, def, s, p.format, p.quality);
      return cache[def.src + '|' + s] ||= render(base, def, s, 'png');
    }
    const png = await (cache[def.src + '|' + s] ||= render(base, def, s, 'png'));
    const bmp = await createImageBitmap(png);
    if (p.format === 'png' && bmp.width === tw && bmp.height === th) return png;
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    const g = c.getContext('2d');
    if (p.format === 'jpg') { g.fillStyle = '#fff'; g.fillRect(0, 0, tw, th); }
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, tw, th);
    const blob = await new Promise(ok => c.toBlob(ok, f.mime, f.quality ? p.quality / 100 : undefined));
    if (!blob || blob.type !== f.mime) throw new Error(t('export.unsupported', { format: f.label }));
    return blob;
  }

  /* ---------- ZIP (store) ---------- */
  const CRC = (() => {
    const tb = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; }
    return tb;
  })();
  const crc32 = b => { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };

  async function zip(files) {
    const enc = new TextEncoder(), local = [], central = [];
    const d = new Date();
    const time = d.getHours() << 11 | d.getMinutes() << 5 | d.getSeconds() >> 1;
    const date = (d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate();
    let off = 0;
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); // UTF-8 names
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      local.push(h, name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, off, true);
      central.push(c, name);
      off += 30 + name.length + data.length;
    }
    const size = central.reduce((s, p) => s + p.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...local, ...central, e], { type: 'application/zip' });
  }

  // keep a copy in projects/<id>/exports/<dir>/ so no export is ever lost
  async function store(base, dir, f) {
    const q = new URLSearchParams({ base, dir, name: f.name });
    const r = await fetch('__atelier/save?' + q, { method: 'POST', body: f.blob });
    // 501/404: an atelier.py started before /__atelier/save existed is still running
    if (r.status === 501 || r.status === 404) throw new Error(t('export.serverOutdated'));
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  }
  const stamp = (d = new Date()) => {
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}.${z(d.getSeconds())}`;
  };

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  /* ---------- DIALOG ---------- */
  const ICON_X = '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  const ICON_MINUS = '<svg viewBox="0 0 16 16"><path d="M4 8h8"/></svg>';
  const ICON_PLUS = '<svg viewBox="0 0 16 16"><path d="M8 4v8M4 8h8"/></svg>';

  let closeCurrent = null;
  async function open({ projectName = 'Atelier', base, groups, checked = [] }) {
    closeCurrent?.();
    const status = await available();
    const presets = load();
    const want = new Set(checked);
    const all = groups.flatMap((g, gi) => g.items.map((def, ii) => ({ key: gi + ':' + ii, gi, def })));
    const on = new Set(all.filter(x => want.has(x.def.id)).map(x => x.key));
    if (!on.size) all.forEach(x => on.add(x.key)); // nothing selected: start from every board
    let running = false, cancelled = false, merge = loadMerge();

    const dlg = document.createElement('dialog');
    dlg.className = 'xp';
    dlg.innerHTML = `
      <div class="xp-head"><b>${esc(t('export.title'))}</b><span>${esc(projectName)}</span>
        <button class="xp-icon" data-close title="${esc(t('export.close'))}">${ICON_X}</button></div>
      ${status === 'ok' ? '' : `<div class="xp-notice"><b>${esc(t(status === 'nochrome' ? 'export.noChromeTitle' : 'export.serverTitle'))}</b>
        <span>${t(status === 'nochrome' ? 'export.noChrome' : 'export.serverBody')}</span></div>`}
      <div class="xp-body">
        <section class="xp-col xp-list">
          <div class="xp-sub"><span>${esc(t('export.boards'))}</span><em class="xp-count"></em>
            <button class="xp-link" data-all>${esc(t('export.all'))}</button>
            <button class="xp-link" data-none>${esc(t('export.none'))}</button></div>
          <div class="xp-tree">${groups.map((g, gi) => `
            <label class="xp-sec"><input type="checkbox" data-sec="${gi}"><span>${esc(g.title || '')}</span></label>
            ${g.items.map((d, ii) => `<label class="xp-item"><input type="checkbox" data-key="${gi}:${ii}">
              <span>${esc(d.title || d.id)}</span><small>${d.w}×${d.h}</small></label>`).join('')}`).join('')}
          </div>
        </section>
        <section class="xp-col xp-set">
          <div class="xp-sub"><span>${esc(t('export.settings'))}</span>
            <button class="xp-icon" data-add title="${esc(t('export.add'))}">${ICON_PLUS}</button></div>
          <div class="xp-rows"></div>
          <label class="xp-merge"><input type="checkbox" data-merge><span>${esc(t('export.mergePdf'))}</span></label>
          <datalist id="xp-scales">${SCALES.map(s => `<option value="${s}">`).join('')}</datalist>
        </section>
      </div>
      <div class="xp-foot"><span class="xp-status"></span>
        <button class="xp-btn" data-cancel>${esc(t('export.cancel'))}</button>
        <button class="xp-btn primary" data-run></button></div>`;
    document.body.appendChild(dlg);

    const $ = s => dlg.querySelector(s), $$ = s => [...dlg.querySelectorAll(s)];
    const rows = $('.xp-rows'), runBtn = $('[data-run]'), statusEl = $('.xp-status');
    const setStatus = (msg, kind = '') => { statusEl.textContent = msg; statusEl.className = 'xp-status ' + kind; };
    const picked = () => all.filter(x => on.has(x.key));
    // one job per file: a board × setting, or every board in one PDF when merging
    const jobs = () => {
      const defs = picked().map(x => x.def), single = merge && defs.length > 1;
      return presets.flatMap(p => single && FORMATS[p.format].vector
        ? [{ defs, p }] : defs.map(def => ({ def, p })));
    };

    function sync() {
      $$('[data-key]').forEach(cb => { cb.checked = on.has(cb.dataset.key); });
      $$('[data-sec]').forEach(cb => {
        const mine = all.filter(x => x.gi === +cb.dataset.sec), n = mine.filter(x => on.has(x.key)).length;
        cb.checked = n > 0 && n === mine.length;
        cb.indeterminate = n > 0 && n < mine.length;
      });
      const n = jobs().length;
      const mergeEl = $('.xp-merge');
      mergeEl.hidden = !presets.some(p => FORMATS[p.format].vector);
      mergeEl.classList.toggle('off', picked().length < 2);
      $('[data-merge]').checked = merge;
      $('.xp-count').textContent = t('export.selected', { n: picked().length });
      runBtn.textContent = t(n === 1 ? 'export.runOne' : 'export.run', { n });
      runBtn.disabled = running || !n || status !== 'ok';
      const first = picked()[0]?.def;
      $$('.xp-row').forEach((row, i) => {
        const p = presets[i], f = FORMATS[p.format], sz = first && !f.vector && sizeOf(first, p);
        row.querySelector('.xp-scale').classList.toggle('bad', !f.vector && first && !sz);
        row.querySelector('.xp-suffix').placeholder = autoSuffix(p) || t('export.suffix');
        row.querySelector('.xp-dim').textContent = f.vector ? t('export.vector')
          : !first ? '' : sz ? `${sz[0]} × ${sz[1]} px` : t('export.badScale');
      });
    }

    function drawRows() {
      rows.innerHTML = presets.map((p, i) => `
        <div class="xp-row" data-i="${i}">
          <input class="xp-scale" list="xp-scales" value="${esc(p.scale)}" title="${esc(t('export.scale'))}" ${FORMATS[p.format].vector ? 'disabled' : ''}>
          <input class="xp-suffix" value="${esc(p.suffix)}" title="${esc(t('export.suffix'))}" spellcheck="false">
          <select class="xp-fmt" title="${esc(t('export.format'))}">${Object.entries(FORMATS).map(([k, f]) =>
            `<option value="${k}" ${k === p.format ? 'selected' : ''}>${f.label}</option>`).join('')}</select>
          <button class="xp-icon" data-del title="${esc(t('export.remove'))}" ${presets.length < 2 ? 'disabled' : ''}>${ICON_MINUS}</button>
          <div class="xp-meta"><span class="xp-dim"></span>${FORMATS[p.format].quality ? `
            <label class="xp-q">${esc(t('export.quality'))}<input type="range" min="1" max="100" value="${p.quality}"><b>${p.quality}</b></label>` : ''}</div>
        </div>`).join('');
      sync();
    }

    rows.addEventListener('input', e => {
      const row = e.target.closest('.xp-row'), p = presets[row.dataset.i];
      if (e.target.matches('.xp-scale')) p.scale = e.target.value;
      if (e.target.matches('.xp-suffix')) p.suffix = e.target.value;
      if (e.target.matches('[type=range]')) { p.quality = +e.target.value; e.target.nextElementSibling.textContent = p.quality; }
      if (e.target.matches('.xp-fmt')) { p.format = e.target.value; save(presets); return drawRows(); }
      save(presets); sync();
    });
    rows.addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (!del) return;
      presets.splice(del.closest('.xp-row').dataset.i, 1);
      save(presets); drawRows();
    });
    $('[data-add]').onclick = () => {
      const last = presets.at(-1);
      // like Figma: each new row steps up the scale
      const m = String(last.scale).match(/^(\d*\.?\d+)x?$/i);
      presets.push({ ...last, suffix: '', scale: m ? (+m[1] >= 1 ? Math.floor(+m[1]) + 1 : 1) + 'x' : '1x' });
      save(presets); drawRows();
    };
    $('.xp-tree').addEventListener('change', e => {
      const cb = e.target;
      if (cb.dataset.key) cb.checked ? on.add(cb.dataset.key) : on.delete(cb.dataset.key);
      if (cb.dataset.sec) all.filter(x => x.gi === +cb.dataset.sec).forEach(x => cb.checked ? on.add(x.key) : on.delete(x.key));
      sync();
    });
    $('[data-merge]').onchange = e => { merge = e.target.checked; saveMerge(merge); sync(); };
    $('[data-all]').onclick = () => { all.forEach(x => on.add(x.key)); sync(); };
    $('[data-none]').onclick = () => { on.clear(); sync(); };

    const close = () => { cancelled = true; dlg.close(); dlg.remove(); document.removeEventListener('keydown', onKey, true); };
    // Escape from anywhere (Chrome ignores it on dialogs opened without a user gesture)
    const onKey = e => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      running ? (cancelled = true) : close();
    };
    document.addEventListener('keydown', onKey, true);
    closeCurrent = close;
    $('[data-close]').onclick = close;
    $('[data-cancel]').onclick = () => running ? (cancelled = true) : close();
    dlg.addEventListener('close', close);
    dlg.addEventListener('click', e => { if (e.target === dlg && !running) close(); }); // click on the backdrop
    dlg.addEventListener('cancel', e => e.preventDefault()); // Escape goes through onKey

    runBtn.onclick = async () => {
      const list = jobs();
      if (list.some(j => j.def && !FORMATS[j.p.format].vector && !sizeOf(j.def, j.p))) return setStatus(t('export.badScale'), 'err');
      running = true; cancelled = false; sync();
      const files = [], cache = {};
      let next = 0, done = 0;
      setStatus(t('export.progress', { i: 0, n: list.length }));
      // a few workers pull jobs in order; each file keeps its job's slot so the order is stable
      const worker = async () => {
        while (next < list.length && !cancelled) {
          const i = next++, j = list[i];
          const blob = j.defs ? await render(base, j.defs, 1, 'pdf') : await produce(base, j.def, j.p, cache);
          const name = j.defs ? safe(projectName) + (j.p.suffix || '') + '.pdf' : fileName(j.def, j.p);
          files[i] = { name, blob };
          if (!cancelled) setStatus(t('export.progress', { i: ++done, n: list.length }));
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, worker));
        if (cancelled) return setStatus(t('export.cancelled'));
        const used = new Map();
        for (const f of files) {
          const n = (used.get(f.name) || 0) + 1; used.set(f.name, n);
          if (n > 1) f.name = f.name.replace(/(\.\w+)$/, ` (${n})$1`);
        }
        const dir = stamp();
        const saved = Promise.all(files.map(f => store(base, dir, f))).then(() => null, err => err);
        if (files.length === 1) download(files[0].blob, files[0].name);
        else { setStatus(t('export.zipping')); download(await zip(files), safe(projectName) + '.zip'); }
        const done = t(files.length === 1 ? 'export.doneOne' : 'export.done', { n: files.length });
        const err = await saved;
        if (err) setStatus(done + ' · ' + t('export.saveFailed', { msg: err.message }), 'err');
        else setStatus(done + ' · ' + t('export.savedIn', { path: base + 'exports/' + dir }), 'ok');
        statusEl.title = statusEl.textContent;
      } catch (err) {
        cancelled = true; // stop the other workers
        setStatus(t('export.failed', { msg: err.message }), 'err');
      } finally {
        running = false;
        if (dlg.isConnected) sync();
      }
    };

    drawRows();
    dlg.showModal();
    runBtn.focus();
  }

  /* ---------- COPY IMAGE ---------- */
  function copyImage(base, def) {
    const s = Math.min(2, 8192 / Math.max(def.w, def.h));
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': render(base, def, s, 'png') })]);
  }

  window.ATELIER_EXPORT = { open, available, copyImage, render };
})();
