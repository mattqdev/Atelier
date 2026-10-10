/* =========================================================
   ATELIER — projects page (projects.html)
   One card per project in projects/index.js: a mini canvas with
   its first boards (or the manifest's `cover` item), name, logo,
   board/section counts, status totals and when it was last opened.
   Opened from "All projects" in the canvas project menu.
   ========================================================= */
(() => {
  const { t, lang } = window.ATELIER_I18N;
  const REG = window.ATELIER_REGISTRY, esc = REG.esc;
  const $ = s => document.querySelector(s);
  const grid = $('#hmGrid'), search = $('#hmSearch'), none = $('#hmNone');
  const SORT_KEY = 'atelier-home-sort', STATUS = ['approved', 'review', 'draft', 'other'];
  const THUMB_MAX = 4; // boards drawn in a card's mini canvas
  let sort = (() => { try { return localStorage.getItem(SORT_KEY); } catch { return null; } })() || 'recent';
  const data = new Map(); // id → manifest | null
  const last = (() => { try { return localStorage.getItem('atelier-last'); } catch { return null; } })();
  const opened = REG.opened();

  document.title = t('home.title') + ' — Atelier';
  search.placeholder = t('project.search');
  $('#hmCount').textContent = REG.list.length === 1 ? t('home.countOne') : t('home.count', { n: REG.list.length });
  if (last) $('#backBtn').href = 'Atelier.html?p=' + encodeURIComponent(last);

  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  function ago(ts) {
    const s = (ts - Date.now()) / 1000;
    for (const [unit, n] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
      if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit);
    }
    return rtf.format(0, 'minute');
  }

  // the first boards as a mini canvas, scaled to the card by `fit`
  function mini(p, ws) {
    const all = REG.summary(ws).items;
    const cover = ws.cover && all.find(i => i.id === ws.cover);
    const first = (ws.sections || []).find(s => s.items?.length);
    const items = cover ? [cover] : (first?.items || []).slice(0, THUMB_MAX);
    if (!items.length) return { html: `<div class="hm-blank">${esc(t('project.empty'))}</div>`, w: 0, h: 0 };
    // rows of `cols` boards: pick the arrangement whose shape best matches the 16:10 card
    const arrange = cols => {
      const rows = [];
      for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
      const gap = Math.round(Math.max(...items.map(i => i.h)) * 0.08);
      let y = 0, W = 0;
      const boxes = rows.flatMap(row => {
        const H = Math.max(...row.map(i => i.h));
        let x = 0;
        const out = row.map(i => { const b = { i, x, y: y + (H - i.h) / 2 }; x += i.w + gap; return b; });
        W = Math.max(W, x - gap); y += H + gap;
        return out;
      });
      return { boxes, w: W, h: y - gap };
    };
    const best = items.map((_, k) => arrange(k + 1))
      .sort((a, b) => Math.abs(Math.log(a.w / a.h / 1.6)) - Math.abs(Math.log(b.w / b.h / 1.6)))[0];
    const html = best.boxes.map(({ i, x, y }) => {
      const src = esc(REG.base(p.id) + i.src + (i.rev != null ? '?rev=' + encodeURIComponent(i.rev) : ''));
      return `<div class="hm-board" style="left:${x}px;top:${y}px;width:${i.w}px;height:${i.h}px">${i.type === 'image'
        ? `<img src="${src}" alt="" loading="lazy" draggable="false">`
        : `<iframe src="${src}" tabindex="-1" scrolling="no" loading="lazy" aria-hidden="true"></iframe>`}</div>`;
    }).join('');
    return { html: `<div class="hm-world" style="width:${best.w}px;height:${best.h}px">${html}</div>`, w: best.w, h: best.h };
  }

  const fit = new ResizeObserver(entries => entries.forEach(({ target }) => {
    const world = target.querySelector('.hm-world');
    if (!world) return;
    const pad = 0.12, w = +world.style.width.slice(0, -2), h = +world.style.height.slice(0, -2);
    const s = Math.min(target.clientWidth * (1 - pad * 2) / w, target.clientHeight * (1 - pad * 2) / h);
    world.style.transform = `translate(-50%, -50%) scale(${s})`;
  }));

  function card(p) {
    const ws = data.get(p.id), href = 'Atelier.html?p=' + encodeURIComponent(p.id);
    const name = p.name || ws?.name || p.id;
    const sm = ws && REG.summary(ws);
    const pills = sm ? STATUS.filter(k => sm.status[k]).map(k =>
      `<span class="hm-pill st-${k}" title="${esc(k === 'other' ? '' : t('status.' + k))}"><i></i>${sm.status[k]}</span>`).join('') : '';
    const when = opened[p.id] ? t('home.opened', { when: ago(opened[p.id]) }) : t('home.never');
    const thumb = ws === undefined ? '<div class="hm-blank hm-loading"></div>'
      : ws ? mini(p, ws).html : `<div class="hm-blank">${esc(t('project.unavailable'))}</div>`;
    return `<a class="hm-card${p.id === last ? ' last' : ''}" href="${href}" data-id="${esc(p.id)}">
      <div class="hm-thumb">${thumb}${p.id === last ? `<span class="hm-tag">${esc(t('home.last'))}</span>` : ''}</div>
      <div class="hm-info">
        ${REG.thumb(p, ws)}
        <div class="hm-text"><b>${esc(name)}</b><small>${ws ? esc(REG.metaText(sm)) : ws === null ? esc(t('project.unavailable')) : '&nbsp;'}</small></div>
      </div>
      <div class="hm-foot"><span>${esc(when)}</span><span class="hm-pills">${pills}</span></div>
    </a>`;
  }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = REG.list
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !q || (p.name || p.id).toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      .sort((a, b) => sort === 'name'
        ? (a.p.name || a.p.id).localeCompare(b.p.name || b.p.id, lang, { sensitivity: 'base' })
        : (opened[b.p.id] || 0) - (opened[a.p.id] || 0) || a.i - b.i)
      .map(x => x.p);
    fit.disconnect();
    grid.innerHTML = shown.map(card).join('') + (q ? '' : `<div class="hm-card hm-new">
      <svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg>
      <b>${esc(t('home.new'))}</b><small>${esc(t('home.newHint'))}</small></div>`);
    grid.querySelectorAll('.hm-thumb').forEach(el => fit.observe(el));
    none.hidden = shown.length > 0;
    document.querySelectorAll('.hm-seg button').forEach(b => b.classList.toggle('on', b.dataset.sort === sort));
  }

  search.addEventListener('input', draw);
  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') grid.querySelector('a.hm-card')?.click();
    if (e.key === 'Escape') { search.value = ''; draw(); }
  });
  document.querySelectorAll('.hm-seg button').forEach(b => b.onclick = () => {
    sort = b.dataset.sort;
    try { localStorage.setItem(SORT_KEY, sort); } catch {}
    draw();
  });
  window.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== search) { e.preventDefault(); search.focus(); }
  });

  draw();
  // manifests load one at a time; each card fills in as soon as its own is read
  REG.list.forEach(p => REG.readManifest(p.id).then(ws => {
    data.set(p.id, ws);
    const old = grid.querySelector(`.hm-card[data-id="${CSS.escape(p.id)}"]`);
    if (!old) return;
    fit.unobserve(old.querySelector('.hm-thumb'));
    old.outerHTML = card(p);
    fit.observe(grid.querySelector(`.hm-card[data-id="${CSS.escape(p.id)}"] .hm-thumb`));
  }));
})();
