/* =========================================================
   ATELIER — Figma-style infinite canvas, multi-project
   Reads the registry (app/projects.js → window.ATELIER_REGISTRY),
   picks the project (?p=<id> → last opened → first) and loads
   projects/<id>/manifest.js (window.WORKSPACE), then lays out
   sections and boards. Adding content never requires touching
   this file: the project manifest is enough.
   The manifest is re-read every 2 s: changes show up on their
   own; an item whose `rev` changed reloads only its board.
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
  const STORE_KEY = 'ws-view:' + PROJECT.id;

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
    const viewport = $('#viewport'), world = $('#world'), layers = $('#layers');
    const zoomVal = $('#zoomVal'), openBtn = $('#openBtn'), exportBtn = $('#exportBtn');

    const view = { x: 0, y: 0, s: 1 };
    let items = [];        // { def, section, x, y, w, h, el, layerEl }
    let sections = [];     // { def, x, y, w, h, items }
    const frames = new Map(); // item key → { el, type, url } (reused across rebuilds)
    let selected = null, bust = 0; // selected = primary selection (URL, Open, arrows)
    const picked = new Set();     // every selected item (Shift/⌘-click)

    const store = {
      get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } },
      set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch {} }
    };

    /* ---------- LAYOUT ---------- */
    function layout() {
      items = []; sections = [];
      let cursorY = 0;
      const P = LAYOUT.sectionPad;
      (WS.sections || []).forEach(sec => {
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
      const keep = new Set();
      sections.forEach(sec => {
        const el = document.createElement('div');
        el.className = 'section';
        Object.assign(el.style, { left: sec.x + 'px', top: sec.y + 'px', width: sec.w + 'px', height: sec.h + 'px' });
        el.innerHTML = `<div class="section-title">${esc(sec.def.title)}${sec.def.note ? `<small>${esc(sec.def.note)}</small>` : ''}</div>`;
        world.prepend(el); // sections stay below the boards

        const lb = document.createElement('button');
        lb.className = 'layer l-section';
        lb.innerHTML = `${ICONS.section}<span>${esc(sec.def.title)}</span><span class="meta">${sec.items.length}</span>`;
        lb.onclick = e => {
          // Shift/⌘-click on a section adds all its boards to the selection
          if (e.shiftKey || e.metaKey || e.ctrlKey) return sec.items.forEach(it => picked.has(it) || select(it, true, true));
          select(null); zoomTo(sec, true);
        };
        layers.appendChild(lb);

        sec.items.forEach(it => {
          const d = it.def, url = srcOf(d);
          let key = d.id;
          while (keep.has(key)) key += '*'; // duplicate ids: don't lose the board
          keep.add(key);
          let f = frames.get(key);
          if (!f || f.type !== d.type) {
            f?.el.remove();
            const ie = document.createElement('div');
            ie.className = 'item';
            ie.innerHTML = `<div class="item-label"></div><div class="item-frame">${d.type === 'image'
              ? `<img src="${esc(url)}" draggable="false">`
              : `<iframe src="${esc(url)}" tabindex="-1" scrolling="no"></iframe>`}</div>`;
            world.appendChild(ie);
            f = { el: ie, type: d.type, url };
            frames.set(key, f);
          } else if (f.url !== url) {
            f.el.querySelector('iframe, img').src = url;
            f.url = url;
          }
          const ie = f.el, media = ie.querySelector('iframe, img');
          ie.dataset.id = d.id;
          Object.assign(ie.style, { left: it.x + 'px', top: it.y + 'px', width: it.w + 'px', height: it.h + 'px' });
          ie.querySelector('.item-label').innerHTML = esc(d.title) + badge(d.status);
          d.type === 'image' ? (media.alt = d.title) : (media.title = d.title);
          it.el = ie;

          const li = document.createElement('button');
          li.className = 'layer l-item';
          li.innerHTML = `${ICONS[d.type] || ICONS.html}<span>${esc(d.title)}</span>${d.status ? `<i class="dot st-${STATUS.includes(d.status) ? d.status : 'other'}" title="${esc(STATUS.includes(d.status) ? t('status.' + d.status) : d.status)}"></i>` : ''}`;
          li.onclick = e => {
            if (e.shiftKey || e.metaKey || e.ctrlKey) return select(it, true, true);
            select(it); zoomTo(it, true);
          };
          layers.appendChild(li);
          it.layerEl = li;
        });
      });
      frames.forEach((f, key) => { if (!keep.has(key)) { f.el.remove(); frames.delete(key); } });
      if (!items.length) viewport.insertAdjacentHTML('beforeend',
        `<div class="empty-msg"><div><b>${esc(t('project.empty'))}</b>${esc(t('project.emptyHint'))}</div></div>`);
    }

    // rebuilds the canvas from the manifest, keeping view and selection
    function build() {
      const selId = selected?.def.id, pickedIds = new Set([...picked].map(i => i.def.id));
      selected = null; picked.clear();
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
      moveT = setTimeout(() => { world.style.willChange = 'auto'; }, 150);
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
      if (selected && !quiet) selected.layerEl.scrollIntoView({ block: 'nearest' });
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
    build();
    const saved = store.get(), deep = params.get('b');
    const target = deep && items.find(i => i.def.id === deep);
    if (target && saved?.sel !== deep) {
      select(target); zoomTo(target, false);
    } else if (saved && Number.isFinite(saved.s)) {
      Object.assign(view, { x: saved.x, y: saved.y, s: saved.s });
      const it = items.find(i => i.def.id === saved.sel);
      it ? select(it) : apply();
    } else {
      fitAll(false);
      select(null);
    }
  }
})();
