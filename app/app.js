/* =========================================================
   ATELIER — Figma-style infinite canvas, multi-project
   Reads the registry (app/projects.js → window.ATELIER_REGISTRY),
   picks the project (?p=<id> → last opened → first) and loads
   projects/<id>/manifest.js (window.WORKSPACE), then lays out
   sections and boards. Adding content never requires touching
   this file: the project manifest is enough.
   The manifest is re-read every 2 s: changes show up on their
   own; an item whose `rev` changed reloads only its board.
   Sections can be grouped into pages (`page` on a section): only
   the current page is laid out. Boards show cached thumbnails and
   load their real document only when zoomed in on.
   ========================================================= */
(() => {
  const { t } = window.ATELIER_I18N;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const params = new URLSearchParams(location.search);
  const setParam = (k, v) => {
    const q = new URLSearchParams(location.search);
    v == null ? q.delete(k) : q.set(k, v);
    const s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
  };
  const REG = window.ATELIER_REGISTRY;
  const PROJECTS = REG.list;
  const LAST_KEY = 'atelier-last';
  const lastId = (() => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } })();
  const wanted = params.get('p');
  const PROJECT = PROJECTS.find(p => p.id === wanted)
    || (!wanted && PROJECTS.find(p => p.id === lastId))
    || (wanted ? { id: wanted, name: wanted } : PROJECTS[0]);
  const BASE = REG.base(PROJECT.id);

  document.querySelector('#projName').textContent = PROJECT.name || PROJECT.id;
  REG.menu(document.querySelector('#projBtn'), PROJECT);

  REG.readManifest(PROJECT.id).then(ws => ws ? start(ws) : notFound());

  function notFound() {
    document.title = 'Atelier';
    document.querySelector('#viewport').insertAdjacentHTML('beforeend',
      `<div class="empty-msg"><div><b>${t('project.notFound')}</b>${t('project.missing', { path: BASE + 'manifest.js' })}</div></div>`);
  }

  function start(WS) {
    try { localStorage.setItem(LAST_KEY, PROJECT.id); } catch {}
    REG.touch(PROJECT.id);
    if (!wanted) setParam('p', PROJECT.id); // a copied link reopens this project
    const LAYOUT = { sectionPad: 80, itemGap: 80, sectionGap: 220 };
    const ZOOM_MIN = 0.02, ZOOM_MAX = 4;

    const $ = s => document.querySelector(s);
    const viewport = $('#viewport'), world = $('#world'), layers = $('#layers'), pagesNav = $('#pages');
    const zoomVal = $('#zoomVal'), openBtn = $('#openBtn'), exportBtn = $('#exportBtn');

    const view = { x: 0, y: 0, s: 1 };
    let items = [];        // { def, section, x, y, w, h, el, layerEl }
    let sections = [];     // { def, x, y, w, h, items }
    const frames = new Map(); // item key → { el, type, title, url, thumbUrl, thumb, live, box, visible, seen } (reused across rebuilds)
    let pages = [], page = null; // page = { title, sections }: the one on the canvas

    /* ---------- THUMBNAILS AND LIVE BOARDS ----------
       Near the viewport a board shows its thumbnail: a small webp that
       atelier.py renders and caches in projects/<id>/.thumbs/ (served:
       on demand; from file://: `python3 atelier.py --thumbs <id>`).
       The real document (iframe/img) is loaded only when the board is
       big on screen, a few at a time, closest to the center first, and
       dropped as soon as the thumbnail is enough again. A board without
       a thumbnail stays live while near the viewport, and at most
       MAX_LIVE of those are kept, least recently seen dropped first. */
    const MAX_LIVE = 40, MAX_LOADING = 4, THUMB = 640; // THUMB = longest side, as in atelier.py
    const SERVED = location.protocol.startsWith('http');
    const fileKey = v => String(v).replace(/[^A-Za-z0-9_.-]/g, '_');
    const thumbOf = d => SERVED
      ? '__atelier/thumb?' + new URLSearchParams({ base: BASE, id: d.id, src: BASE + d.src, type: d.type || 'html',
        w: d.w, h: d.h, rev: d.rev ?? 0, ...(bust ? { v: bust } : {}) })
      : BASE + '.thumbs/' + fileKey(d.id) + '@' + fileKey(d.rev ?? 0) + '.webp';
    const queue = new Set();
    let loading = 0, tick = 0;
    const big = f => Math.max(f.box.w, f.box.h) * view.s * devicePixelRatio > THUMB * 1.25;
    const onScreen = f => {
      const x = f.box.x * view.s + view.x, y = f.box.y * view.s + view.y;
      return x < viewport.clientWidth && x + f.box.w * view.s > 0 && y < viewport.clientHeight && y + f.box.h * view.s > 0;
    };
    const wantsLive = f => f.visible && (f.thumb === 'missing' || (f.thumb === 'ok' && big(f) && onScreen(f)));
    const lazy = new IntersectionObserver(es => {
      es.forEach(e => {
        const f = e.target._frame;
        if (!f) return;
        f.visible = e.isIntersecting;
        f.seen = ++tick;
        if (f.visible) showThumb(f);
      });
      refresh();
    }, { root: viewport, rootMargin: '50%' });

    // re-evaluates which boards should be live (after scrolling, zooming, a thumbnail arriving)
    function refresh() {
      frames.forEach(f => { if (wantsLive(f) && !f.live) queue.add(f); else queue.delete(f); });
      prune();
      pump();
    }
    function showThumb(f) {
      if (f.thumb !== 'idle') return;
      f.thumb = 'loading';
      const img = f.el.querySelector('.thumb'), url = f.thumbUrl;
      img.onload = () => { if (url !== f.thumbUrl) return; f.thumb = 'ok'; f.el.classList.add('thumb-on'); refresh(); };
      img.onerror = () => {
        if (url !== f.thumbUrl) return;
        f.thumb = 'missing'; // never show an outdated thumbnail
        f.el.classList.remove('thumb-on'); img.removeAttribute('src');
        refresh();
      };
      img.src = url;
    }
    function pump() {
      if (loading >= MAX_LOADING || !queue.size) return;
      const cx = (viewport.clientWidth / 2 - view.x) / view.s, cy = (viewport.clientHeight / 2 - view.y) / view.s;
      const dist = f => Math.hypot(f.box.x + f.box.w / 2 - cx, f.box.y + f.box.h / 2 - cy);
      [...queue].sort((a, b) => dist(a) - dist(b)).slice(0, MAX_LOADING - loading).forEach(load);
    }
    function load(f) {
      queue.delete(f);
      const m = f.live = document.createElement(f.type === 'image' ? 'img' : 'iframe');
      m.className = 'live';
      if (f.type === 'image') { m.draggable = false; m.alt = f.title; } else { m.tabIndex = -1; m.scrolling = 'no'; m.title = f.title; }
      loading++;
      let done = false;
      f.end = () => {
        if (done) return;
        done = true; loading--; f.end = null;
        f.el.classList.add('live-on');
        pump();
      };
      m.onload = m.onerror = f.end;
      setTimeout(() => f.end?.(), 8000); // a board that never fires load doesn't block the queue
      m.src = f.url;
      f.el.querySelector('.item-frame').appendChild(m);
    }
    function unload(f) {
      f.end?.();
      f.live.remove(); // removing the iframe frees its whole document
      f.live = null;
      f.el.classList.remove('live-on');
    }
    function prune() {
      const live = [...frames.values()].filter(f => f.live);
      // with a thumbnail to fall back on, a board is live only while it needs to be
      live.filter(f => f.thumb === 'ok' && !wantsLive(f)).forEach(unload);
      const rest = live.filter(f => f.live);
      let extra = rest.length - MAX_LIVE;
      if (extra > 0) rest.filter(f => !f.visible).sort((a, b) => a.seen - b.seen).forEach(f => extra-- > 0 && unload(f));
    }
    function drop(f) {
      f.end?.();
      queue.delete(f);
      lazy.unobserve(f.el);
      f.el.remove();
    }

    let selected = null, bust = 0; // selected = primary selection (URL, Open, arrows)
    const picked = new Set();     // every selected item (Shift/⌘-click)

    // the view (pan, zoom, selection) is remembered per page
    const viewKey = () => 'ws-view:' + PROJECT.id + (pages.length > 1 ? '/' + page.title : '');
    const store = {
      get() { try { return JSON.parse(localStorage.getItem(viewKey())); } catch { return null; } },
      set(v) { try { localStorage.setItem(viewKey(), JSON.stringify(v)); } catch {} }
    };
    const PAGE_KEY = 'ws-page:' + PROJECT.id, FOLD_KEY = 'ws-folded:' + PROJECT.id;
    const folded = new Set((() => { try { return JSON.parse(localStorage.getItem(FOLD_KEY)) || []; } catch { return []; } })());
    const saveFolded = () => { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch {} };

    /* ---------- PAGES ---------- */
    // a section without `page` stays on the page of the section before it
    function paginate() {
      pages = [];
      let title = '';
      (WS.sections || []).forEach(sec => {
        title = sec.page != null ? String(sec.page) : title;
        let p = pages.find(p => p.title === title);
        if (!p) pages.push(p = { title, sections: [] });
        p.sections.push(sec);
      });
      if (!pages.length) pages.push({ title: '', sections: [] });
      page = pages.find(p => p.title === page?.title) || pages[0];
    }
    const pageName = p => p.title || t('pages.default');

    /* ---------- LAYOUT ---------- */
    function layout() {
      items = []; sections = [];
      let cursorY = 0;
      const P = LAYOUT.sectionPad;
      page.sections.forEach(sec => {
        const sx = sec.x ?? 0, sy = sec.y ?? cursorY;
        let x = sx + P, maxH = 0;
        const secItems = [];
        (sec.items || []).forEach(def => {
          const it = { def, section: sec.id, x, y: sy + P, w: def.w, h: def.h };
          items.push(it); secItems.push(it);
          x += def.w + LAYOUT.itemGap;
          maxH = Math.max(maxH, def.h);
        });
        const w = Math.max(x - LAYOUT.itemGap + P - sx, 400);
        const h = maxH + P * 2;
        sections.push({ def: sec, x: sx, y: sy, w, h, items: secItems });
        cursorY = Math.max(cursorY, sy + h + LAYOUT.sectionGap);
      });
    }

    /* ---------- RENDER ---------- */
    const ICONS = {
      page: '<svg class="ic" viewBox="0 0 16 16"><path d="M4 2h5.5L12 4.5V14H4z"/><path d="M9.5 2v2.5H12"/></svg>',
      chevron: '<svg class="chev" viewBox="0 0 16 16"><path d="M6 4.5 9.5 8 6 11.5"/></svg>',
      section: '<svg class="ic" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6h12"/></svg>',
      html: '<svg class="ic" viewBox="0 0 16 16"><rect x="3" y="2" width="10" height="12" rx="1"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3"/></svg>',
      image: '<svg class="ic" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="6" cy="6.5" r="1.2"/><path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3"/></svg>'
    };
    const STATUS = ['draft', 'review', 'approved'];
    const badge = st => st
      ? `<span class="status st-${STATUS.includes(st) ? st : 'other'}">${esc(STATUS.includes(st) ? t('status.' + st) : st)}</span>` : '';
    const srcOf = d => {
      const q = new URLSearchParams();
      if (d.rev != null) q.set('rev', d.rev);
      if (bust) q.set('v', bust);
      const s = q.toString();
      return BASE + d.src + (s ? '?' + s : '');
    };

    function render() {
      world.querySelectorAll('.section, .empty-msg').forEach(n => n.remove());
      viewport.querySelector('.empty-msg')?.remove();
      layers.innerHTML = '';
      renderPages();
      const keep = new Set();
      sections.forEach(sec => {
        const el = document.createElement('div');
        el.className = 'section';
        Object.assign(el.style, { left: sec.x + 'px', top: sec.y + 'px', width: sec.w + 'px', height: sec.h + 'px' });
        el.innerHTML = `<div class="section-title">${esc(sec.def.title)}${sec.def.note ? `<small>${esc(sec.def.note)}</small>` : ''}</div>`;
        world.prepend(el); // sections stay below the boards

        const lb = document.createElement('button');
        lb.className = 'layer l-section';
        lb.innerHTML = `<span class="fold" title="${esc(t('layers.fold'))}">${ICONS.chevron}</span>${ICONS.section}<span>${esc(sec.def.title)}</span><span class="meta">${sec.items.length}</span>`;
        lb.onclick = e => {
          if (e.target.closest('.fold')) return fold(sec, !sec.group.hidden);
          // Shift/⌘-click on a section adds all its boards to the selection
          if (e.shiftKey || e.metaKey || e.ctrlKey) return sec.items.forEach(it => picked.has(it) || select(it, true, true));
          select(null); zoomTo(sec, true);
        };
        const group = document.createElement('div');
        group.hidden = folded.has(sec.def.id);
        lb.classList.toggle('folded', group.hidden);
        layers.append(lb, group);
        Object.assign(sec, { layerEl: lb, group });

        sec.items.forEach(it => {
          const d = it.def, url = srcOf(d);
          let key = d.id;
          while (keep.has(key)) key += '*'; // duplicate ids: don't lose the board
          keep.add(key);
          let f = frames.get(key);
          if (!f || f.type !== d.type) {
            if (f) drop(f);
            const ie = document.createElement('div');
            ie.className = 'item';
            ie.innerHTML = `<div class="item-label"></div><div class="item-frame"><img class="thumb" alt="" draggable="false"></div>`;
            world.appendChild(ie);
            f = { el: ie, type: d.type, url, thumbUrl: thumbOf(d), thumb: 'idle', live: null, visible: false, seen: 0 };
            ie._frame = f;
            frames.set(key, f);
            lazy.observe(ie);
          } else if (f.url !== url) {
            // new rev: reload the live document, fetch the matching thumbnail
            if (f.live) f.live.src = url;
            f.url = url;
            f.thumbUrl = thumbOf(d);
            f.thumb = 'idle';
            if (f.visible) showThumb(f);
          }
          f.box = it;
          f.title = d.title;
          const ie = f.el;
          ie.dataset.id = d.id;
          Object.assign(ie.style, { left: it.x + 'px', top: it.y + 'px', width: it.w + 'px', height: it.h + 'px' });
          ie.querySelector('.item-label').innerHTML = esc(d.title) + badge(d.status);
          if (f.live) d.type === 'image' ? (f.live.alt = d.title) : (f.live.title = d.title);
          it.el = ie;

          const li = document.createElement('button');
          li.className = 'layer l-item';
          li.innerHTML = `${ICONS[d.type] || ICONS.html}<span>${esc(d.title)}</span>${d.status ? `<i class="dot st-${STATUS.includes(d.status) ? d.status : 'other'}" title="${esc(STATUS.includes(d.status) ? t('status.' + d.status) : d.status)}"></i>` : ''}`;
          li.onclick = e => {
            if (e.shiftKey || e.metaKey || e.ctrlKey) return select(it, true, true);
            select(it); zoomTo(it, true);
          };
          sec.group.appendChild(li);
          it.layerEl = li;
        });
      });
      frames.forEach((f, key) => { if (!keep.has(key)) { drop(f); frames.delete(key); } });
      refresh();
      if (!items.length) viewport.insertAdjacentHTML('beforeend',
        `<div class="empty-msg"><div><b>${esc(t('project.empty'))}</b>${esc(t('project.emptyHint'))}</div></div>`);
    }

    function renderPages() {
      pagesNav.innerHTML = '';
      pagesNav.parentElement.hidden = pages.length < 2;
      if (pages.length < 2) return;
      pages.forEach(p => {
        const n = p.sections.reduce((a, s) => a + (s.items || []).length, 0);
        const b = document.createElement('button');
        b.className = 'layer l-page' + (p === page ? ' active' : '');
        b.innerHTML = `${ICONS.page}<span>${esc(pageName(p))}</span><span class="meta">${n}</span>`;
        b.onclick = () => goPage(p);
        pagesNav.appendChild(b);
      });
    }

    function fold(sec, hide) {
      sec.group.hidden = hide;
      sec.layerEl.classList.toggle('folded', hide);
      hide ? folded.add(sec.def.id) : folded.delete(sec.def.id);
      saveFolded();
    }

    function goPage(p, itemId) {
      if (p !== page) {
        clearTimeout(saveT);
        store.set({ ...view, sel: selected?.def.id ?? null }); // the page we leave keeps its view
        page = p;
        try { localStorage.setItem(PAGE_KEY, p.title); } catch {}
        selected = null; picked.clear();
        build();
      }
      restoreView(itemId);
    }

    // itemId: zoom on that board; otherwise the page's last view, or fit
    function restoreView(itemId) {
      const saved = store.get();
      const target = itemId && items.find(i => i.def.id === itemId);
      if (target && saved?.sel !== itemId) {
        select(target); zoomTo(target, false);
      } else if (saved && Number.isFinite(saved.s)) {
        Object.assign(view, { x: saved.x, y: saved.y, s: saved.s });
        const it = items.find(i => i.def.id === saved.sel);
        it ? select(it) : select(null, true);
      } else {
        fitAll(false);
        select(null, true);
      }
    }

    // rebuilds the canvas from the manifest, keeping page, view and selection
    function build() {
      const selId = selected?.def.id, pickedIds = new Set([...picked].map(i => i.def.id));
      selected = null; picked.clear();
      paginate();
      setParam('pg', pages.length > 1 ? page.title : null);
      layout();
      render();
      document.title = (WS.name || PROJECT.name) + ' — Atelier';
      $('#projName').textContent = WS.name || PROJECT.name || PROJECT.id;
      const lg = $('#projLogo');
      if (WS.logo) { lg.src = BASE + WS.logo; lg.hidden = false; } else lg.hidden = true;
      items.forEach(i => i.def.id !== selId && pickedIds.has(i.def.id) && picked.add(i));
      const it = items.find(i => i.def.id === selId);
      select(it || null, true, picked.size > 0);
      exportBtn.disabled = !items.length;
    }

    /* ---------- VIEW ---------- */
    let saveT;
    let moveT;
    function apply() {
      // will-change only while moving: at rest Chrome re-rasterizes and boards stay sharp
      world.style.willChange = 'transform';
      clearTimeout(moveT);
      moveT = setTimeout(() => { world.style.willChange = 'auto'; refresh(); }, 150);
      world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
      world.style.setProperty('--inv', 1 / view.s);
      zoomVal.textContent = Math.round(view.s * 100) + '%';
      const g = 24 * view.s;
      viewport.style.backgroundSize = view.s < 0.25 ? '0 0' : `${g}px ${g}px`;
      viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
      clearTimeout(saveT);
      saveT = setTimeout(() => store.set({ ...view, sel: selected?.def.id ?? null }), 200);
    }

    const clamp = s => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

    function zoomAt(factor, cx, cy) {
      const s = clamp(view.s * factor);
      const k = s / view.s;
      view.x = cx - (cx - view.x) * k;
      view.y = cy - (cy - view.y) * k;
      view.s = s;
      apply();
    }
    const center = () => [viewport.clientWidth / 2, viewport.clientHeight / 2];

    let anim;
    function animateTo(target) {
      cancelAnimationFrame(anim);
      const from = { ...view }, t0 = performance.now(), D = 320;
      const ease = t => 1 - Math.pow(1 - t, 3);
      const step = now => {
        const t = Math.min(1, (now - t0) / D), e = ease(t);
        // interpolate the scale in log space for a natural zoom
        view.s = Math.exp(Math.log(from.s) + (Math.log(target.s) - Math.log(from.s)) * e);
        view.x = from.x + (target.x - from.x) * e;
        view.y = from.y + (target.y - from.y) * e;
        apply();
        if (t < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }

    function zoomTo(r, animate) {
      const vw = viewport.clientWidth, vh = viewport.clientHeight, m = 60;
      const s = clamp(Math.min((vw - m * 2) / r.w, (vh - m * 2) / r.h));
      const target = { s, x: vw / 2 - (r.x + r.w / 2) * s, y: vh / 2 - (r.y + r.h / 2) * s };
      animate ? animateTo(target) : (Object.assign(view, target), apply());
    }

    function bounds() {
      if (!sections.length) return { x: 0, y: 0, w: 1000, h: 1000 };
      const xs = sections.flatMap(s => [s.x, s.x + s.w]), ys = sections.flatMap(s => [s.y - 40, s.y + s.h]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    const fitAll = animate => zoomTo(bounds(), animate);

    /* ---------- SELECTION ---------- */
    // additive = Shift/⌘-click: toggles `it` without dropping the rest
    function select(it, quiet, additive) {
      if (!additive) picked.clear();
      if (it && additive && picked.has(it) && picked.size > 1) {
        picked.delete(it);
        if (selected === it) selected = [...picked].at(-1);
      } else {
        if (it) picked.add(it);
        selected = it;
      }
      items.forEach(i => { i.el.classList.toggle('selected', picked.has(i)); i.layerEl.classList.toggle('active', picked.has(i)); });
      if (selected && !quiet) {
        const sec = sections.find(s => s.items.includes(selected));
        if (sec?.group.hidden) fold(sec, false);
        selected.layerEl.scrollIntoView({ block: 'nearest' });
      }
      setParam('b', selected ? selected.def.id : null); // the URL always links to the selected board
      openBtn.disabled = !selected;
      apply();
    }
    const selectAll = () => items.forEach((it, i) => select(it, true, i > 0));
    const openSelected = () => selected && window.open(
      'view.html?p=' + encodeURIComponent(PROJECT.id) + '&b=' + encodeURIComponent(selected.def.id), '_blank');
    const openExport = () => items.length && window.ATELIER_EXPORT.open({
      projectName: WS.name || PROJECT.name, base: BASE,
      groups: sections.map(s => ({ title: s.def.title, items: s.items.map(i => i.def) })),
      checked: [...picked].map(i => i.def.id)
    });

    function step(dir) {
      if (!items.length) return;
      const i = selected ? items.indexOf(selected) : -1;
      const next = items[(i + dir + items.length) % items.length];
      select(next); zoomTo(next, true);
    }

    /* ---------- INPUT ---------- */
    const local = e => { const r = viewport.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    viewport.addEventListener('wheel', e => {
      e.preventDefault();
      cancelAnimationFrame(anim);
      if (e.ctrlKey || e.metaKey) {
        const [cx, cy] = local(e);
        const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        zoomAt(Math.exp(-d * (e.ctrlKey && !e.metaKey ? 0.01 : 0.0025)), cx, cy);
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        view.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
        view.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
        apply();
      }
    }, { passive: false });

    // Safari: pinch del trackpad
    let gScale = 1;
    viewport.addEventListener('gesturestart', e => { e.preventDefault(); gScale = 1; });
    viewport.addEventListener('gesturechange', e => {
      e.preventDefault();
      const [cx, cy] = local(e);
      zoomAt(e.scale / gScale, cx, cy); gScale = e.scale;
    });

    let drag = null;
    viewport.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.button !== 1) return;
      cancelAnimationFrame(anim);
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, id: e.pointerId };
      viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; viewport.classList.add('panning'); }
      if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; apply(); }
    });
    viewport.addEventListener('pointerup', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && e.button === 0) {
        const hit = document.elementsFromPoint(e.clientX, e.clientY).find(n => n.classList?.contains('item'));
        const it = hit ? items.find(i => i.el === hit) : null;
        const add = e.shiftKey || e.metaKey || e.ctrlKey;
        if (it || !add) select(it, false, add && !!it);
      }
      drag = null;
      viewport.classList.remove('panning');
    });
    viewport.addEventListener('dblclick', e => {
      const hit = document.elementsFromPoint(e.clientX, e.clientY).find(n => n.classList?.contains('item'));
      if (hit) { const it = items.find(i => i.el === hit); select(it); zoomTo(it, true); }
    });

    window.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
      const [cx, cy] = center();
      if (e.code === 'Space') { document.body.classList.add('space'); e.preventDefault(); return; }
      if (e.shiftKey && e.code === 'Digit1') return fitAll(true);
      if (e.shiftKey && e.code === 'Digit2') return selected && zoomTo(selected, true);
      if (e.shiftKey && e.code === 'Digit0') return zoomAt(1 / view.s, cx, cy);
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); return zoomAt(1.25, cx, cy); }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') { e.preventDefault(); return zoomAt(0.8, cx, cy); }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); return zoomAt(1 / view.s, cx, cy); }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyE') { e.preventDefault(); return openExport(); }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyA') { e.preventDefault(); return selectAll(); }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '=' || e.key === '+') return zoomAt(1.25, cx, cy);
      if (e.key === '-') return zoomAt(0.8, cx, cy);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); return step(1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); return step(-1); }
      if (e.key === 'Enter') return openSelected();
      if (e.key === 'Escape') return select(null);
      if (e.key === '\\') return toggleSidebar();
    });
    window.addEventListener('keyup', e => { if (e.code === 'Space') document.body.classList.remove('space'); });

    /* ---------- TOP BAR ---------- */
    function toggleSidebar() {
      // keeps the content still while the panel slides in/out
      const before = viewport.getBoundingClientRect().left;
      document.body.classList.toggle('no-sidebar');
      requestAnimationFrame(() => setTimeout(() => {
        view.x += before - viewport.getBoundingClientRect().left; apply();
      }, 190));
    }
    $('#sidebarBtn').onclick = toggleSidebar;
    $('#zoomOut').onclick = () => zoomAt(0.8, ...center());
    $('#zoomIn').onclick = () => zoomAt(1.25, ...center());
    zoomVal.onclick = () => zoomAt(1 / view.s, ...center());
    $('#fitBtn').onclick = () => fitAll(true);
    $('#reloadBtn').onclick = () => { bust = Date.now(); render(); poll(); };
    openBtn.onclick = openSelected;
    exportBtn.onclick = openExport;
    $('#hintClose').onclick = () => { $('#hint').remove(); try { localStorage.setItem('ws-hint-off', '1'); } catch {} };
    try { if (localStorage.getItem('ws-hint-off')) $('#hint').remove(); } catch {}

    /* ---------- LIVE RELOAD ---------- */
    let sig = JSON.stringify(WS), polling = false;
    function poll() {
      if (polling || document.hidden) return;
      polling = true;
      REG.readManifest(PROJECT.id, true).then(next => {
        polling = false;
        if (!next) return; // file mid-edit: retry on the next tick
        const n = JSON.stringify(next);
        if (n !== sig) { sig = n; WS = next; build(); }
      });
    }
    setInterval(poll, 2000);

    /* ---------- STARTUP ---------- */
    if (window.innerWidth < 760) document.body.classList.add('no-sidebar');
    // page: the one holding ?b= → ?pg= → last opened → first
    const deep = params.get('b');
    paginate();
    const lastPage = (() => { try { return localStorage.getItem(PAGE_KEY); } catch { return null; } })();
    page = pages.find(p => deep && p.sections.some(s => (s.items || []).some(i => i.id === deep)))
      || pages.find(p => p.title === params.get('pg'))
      || pages.find(p => p.title === lastPage) || pages[0];
    build();
    restoreView(deep);
  }
})();
