/* =========================================================
   ATELIER — export, Figma-style
   Boards are rendered by headless Chrome through the local server
   (atelier.py → /__atelier/render), so the output matches the
   browser exactly. PNG and PDF come straight from Chrome; JPG and
   WEBP are re-encoded here with the chosen quality. Several files
   are bundled into a ZIP (stored, no compression, no dependencies).

   Each export setting is { scale, suffix, format, quality }:
     scale   → "2x" | "512w" (width in px) | "1080h" (height in px)
     suffix  → appended to the file name; empty = "@2x" style default
     format  → png | jpg | webp | pdf (pdf is vector, scale ignored)
     quality → 1–100, jpg/webp only
   Settings are remembered in localStorage (atelier-export).

   API: ATELIER_EXPORT.open({ projectName, base, groups, checked })
        ATELIER_EXPORT.copyImage(base, def)
        ATELIER_EXPORT.available() → Promise<'ok'|'nochrome'|'noserver'>
   ========================================================= */
(() => {
  const { t } = window.ATELIER_I18N;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'atelier-export';
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

  async function render(base, def, scale, format) {
    const q = new URLSearchParams({
      src: base + def.src, type: def.type === 'image' ? 'image' : 'html',
      w: def.w, h: def.h, scale, format
    });
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

  /* ---------- PRODUCE ONE FILE ---------- */
  async function produce(base, def, p, cache) {
    const f = FORMATS[p.format];
    if (f.vector) return render(base, def, 1, 'pdf');
    const s = parseScale(p.scale, def.w, def.h);
    const [tw, th] = sizeOf(def, p);
    const key = def.src + '|' + s + '|' + (def.rev ?? '');
    const png = await (cache[key] ||= render(base, def, s, 'png'));
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
    let running = false, cancelled = false;

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

    function sync() {
      $$('[data-key]').forEach(cb => { cb.checked = on.has(cb.dataset.key); });
      $$('[data-sec]').forEach(cb => {
        const mine = all.filter(x => x.gi === +cb.dataset.sec), n = mine.filter(x => on.has(x.key)).length;
        cb.checked = n > 0 && n === mine.length;
        cb.indeterminate = n > 0 && n < mine.length;
      });
      const n = picked().length * presets.length;
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
      const jobs = picked().flatMap(x => presets.map(p => ({ def: x.def, p })));
      if (jobs.some(j => !FORMATS[j.p.format].vector && !sizeOf(j.def, j.p))) return setStatus(t('export.badScale'), 'err');
      running = true; cancelled = false; sync();
      const files = [], used = new Map(), cache = {};
      try {
        for (const [i, j] of jobs.entries()) {
          if (cancelled) return setStatus(t('export.cancelled'));
          setStatus(t('export.progress', { i: i + 1, n: jobs.length }));
          const blob = await produce(base, j.def, j.p, cache);
          let name = fileName(j.def, j.p);
          const n = (used.get(name) || 0) + 1; used.set(name, n);
          if (n > 1) name = name.replace(/(\.\w+)$/, ` (${n})$1`);
          files.push({ name, blob });
        }
        if (cancelled) return setStatus(t('export.cancelled'));
        if (files.length === 1) download(files[0].blob, files[0].name);
        else { setStatus(t('export.zipping')); download(await zip(files), safe(projectName) + '.zip'); }
        setStatus(t(files.length === 1 ? 'export.doneOne' : 'export.done', { n: files.length }), 'ok');
      } catch (err) {
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
