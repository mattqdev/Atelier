/* =========================================================
   ATELIER — canvas infinito stile Figma, multi-progetto
   Legge il registro (projects/index.js → window.ATELIER_PROJECTS),
   sceglie il progetto (?p=<id> → ultimo aperto → primo) e carica
   projects/<id>/manifest.js (window.WORKSPACE), poi dispone
   sezioni e tavole. Non serve modificare questo file per
   aggiungere contenuti: basta il manifest del progetto.
   ========================================================= */
(() => {
  const { t } = window.ATELIER_I18N;
  const PROJECTS = Array.isArray(window.ATELIER_PROJECTS) && window.ATELIER_PROJECTS.length
    ? window.ATELIER_PROJECTS : [{ id: 'example', name: t('project.example') }];
  const LAST_KEY = 'atelier-last';
  const lastId = (() => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } })();
  const wanted = new URLSearchParams(location.search).get('p');
  const PROJECT = PROJECTS.find(p => p.id === wanted)
    || (!wanted && PROJECTS.find(p => p.id === lastId))
    || (wanted ? { id: wanted, name: wanted } : PROJECTS[0]);
  const BASE = 'projects/' + PROJECT.id + '/';
  const STORE_KEY = 'ws-view:' + PROJECT.id;

  const sel = document.querySelector('#projectSel');
  const listed = PROJECTS.some(p => p.id === PROJECT.id) ? PROJECTS : [...PROJECTS, PROJECT];
  sel.innerHTML = listed.map(p => `<option value="${p.id}">${p.name || p.id}</option>`).join('');
  sel.value = PROJECT.id;
  sel.onchange = () => { location.search = '?p=' + encodeURIComponent(sel.value); };

  const tag = document.createElement('script');
  tag.src = BASE + 'manifest.js';
  tag.onload = () => window.WORKSPACE ? start(window.WORKSPACE) : notFound();
  tag.onerror = notFound;
  document.body.appendChild(tag);

  function notFound() {
    document.title = 'Atelier';
    document.querySelector('#viewport').insertAdjacentHTML('beforeend',
      `<div class="empty-msg"><div><b>${t('project.notFound')}</b>${t('project.missing', { path: BASE + 'manifest.js' })}</div></div>`);
  }

  function start(WS) {
    try { localStorage.setItem(LAST_KEY, PROJECT.id); } catch {}
    const LAYOUT = { sectionPad: 80, itemGap: 80, sectionGap: 220 };
    const ZOOM_MIN = 0.02, ZOOM_MAX = 4;

    const $ = s => document.querySelector(s);
    const viewport = $('#viewport'), world = $('#world'), layers = $('#layers');
    const zoomVal = $('#zoomVal'), openBtn = $('#openBtn');

    const view = { x: 0, y: 0, s: 1 };
    const items = [];      // { def, section, x, y, w, h, el, layerEl }
    const sections = [];   // { def, x, y, w, h, el, layerEl }
    let selected = null;

    const store = {
      get() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } },
      set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch {} }
    };

    /* ---------- LAYOUT ---------- */
    function layout() {
      let cursorY = 0;
      const P = LAYOUT.sectionPad;
      WS.sections.forEach(sec => {
        const sx = sec.x ?? 0, sy = sec.y ?? cursorY;
        let x = sx + P, maxH = 0;
        const secItems = [];
        sec.items.forEach(def => {
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
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    function render() {
      sections.forEach(sec => {
        const el = document.createElement('div');
        el.className = 'section';
        Object.assign(el.style, { left: sec.x + 'px', top: sec.y + 'px', width: sec.w + 'px', height: sec.h + 'px' });
        el.innerHTML = `<div class="section-title">${esc(sec.def.title)}${sec.def.note ? `<small>${esc(sec.def.note)}</small>` : ''}</div>`;
        world.appendChild(el);
        sec.el = el;

        const lb = document.createElement('button');
        lb.className = 'layer l-section';
        lb.innerHTML = `${ICONS.section}<span>${esc(sec.def.title)}</span><span class="meta">${sec.items.length}</span>`;
        lb.onclick = () => { select(null); zoomTo(sec, true); };
        layers.appendChild(lb);

        sec.items.forEach(it => {
          const d = it.def;
          const ie = document.createElement('div');
          ie.className = 'item';
          ie.dataset.id = d.id;
          Object.assign(ie.style, { left: it.x + 'px', top: it.y + 'px', width: it.w + 'px', height: it.h + 'px' });
          const content = d.type === 'image'
            ? `<img src="${esc(BASE + d.src)}" alt="${esc(d.title)}" draggable="false">`
            : `<iframe src="${esc(BASE + d.src)}" title="${esc(d.title)}" tabindex="-1" scrolling="no"></iframe>`;
          ie.innerHTML = `<div class="item-label">${esc(d.title)}</div><div class="item-frame">${content}</div>`;
          world.appendChild(ie);
          it.el = ie;

          const li = document.createElement('button');
          li.className = 'layer l-item';
          li.innerHTML = `${ICONS[d.type] || ICONS.html}<span>${esc(d.title)}</span>`;
          li.onclick = () => { select(it); zoomTo(it, true); };
          layers.appendChild(li);
          it.layerEl = li;
        });
      });
    }

    /* ---------- VISTA ---------- */
    let saveT;
    function apply() {
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
        // interpola la scala in log-space per uno zoom naturale
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
      const xs = sections.flatMap(s => [s.x, s.x + s.w]), ys = sections.flatMap(s => [s.y - 40, s.y + s.h]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    const fitAll = animate => zoomTo(bounds(), animate);

    /* ---------- SELEZIONE ---------- */
    function select(it) {
      if (selected) { selected.el.classList.remove('selected'); selected.layerEl.classList.remove('active'); }
      selected = it;
      if (it) {
        it.el.classList.add('selected');
        it.layerEl.classList.add('active');
        it.layerEl.scrollIntoView({ block: 'nearest' });
      }
      openBtn.disabled = !it;
      apply();
    }
    const openSelected = () => selected && window.open(BASE + selected.def.src, '_blank');

    function step(dir) {
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
      if (!drag.moved) {
        const hit = document.elementsFromPoint(e.clientX, e.clientY).find(n => n.classList?.contains('item'));
        select(hit ? items.find(i => i.el === hit) : null);
      }
      drag = null;
      viewport.classList.remove('panning');
    });
    viewport.addEventListener('dblclick', e => {
      const hit = document.elementsFromPoint(e.clientX, e.clientY).find(n => n.classList?.contains('item'));
      if (hit) { const it = items.find(i => i.el === hit); select(it); zoomTo(it, true); }
    });

    window.addEventListener('keydown', e => {
      if (e.target.closest('input, textarea')) return;
      const [cx, cy] = center();
      if (e.code === 'Space') { document.body.classList.add('space'); e.preventDefault(); return; }
      if (e.shiftKey && e.code === 'Digit1') return fitAll(true);
      if (e.shiftKey && e.code === 'Digit2') return selected && zoomTo(selected, true);
      if (e.shiftKey && e.code === 'Digit0') return zoomAt(1 / view.s, cx, cy);
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); return zoomAt(1.25, cx, cy); }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') { e.preventDefault(); return zoomAt(0.8, cx, cy); }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); return zoomAt(1 / view.s, cx, cy); }
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
      // mantiene fermo il contenuto mentre il pannello entra/esce
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
    $('#reloadBtn').onclick = () => location.reload();
    openBtn.onclick = openSelected;
    $('#hintClose').onclick = () => { $('#hint').remove(); try { localStorage.setItem('ws-hint-off', '1'); } catch {} };
    try { if (localStorage.getItem('ws-hint-off')) $('#hint').remove(); } catch {}

    /* ---------- AVVIO ---------- */
    document.title = WS.name + ' — Atelier';
    if (WS.logo) { const lg = $('#projLogo'); lg.src = BASE + WS.logo; lg.hidden = false; }
    if (window.innerWidth < 760) document.body.classList.add('no-sidebar');
    layout();
    render();
    const saved = store.get();
    if (saved && Number.isFinite(saved.s)) {
      Object.assign(view, { x: saved.x, y: saved.y, s: saved.s });
      const it = items.find(i => i.def.id === saved.sel);
      it ? select(it) : apply();
    } else {
      fitAll(false);
      select(null);
    }
  }
})();
