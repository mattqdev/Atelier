/* =========================================================
   ATELIER — single-board viewer (view.html?p=<id>&b=<itemId>)
   Opened by the canvas "Open" button. The board always keeps its
   aspect ratio: "Fit" shows it at 100% and shrinks it only when
   the window is smaller (in full screen it fills the screen).
   Actions: browse, zoom, background, full screen, copy link or
   image, open the original file, print / save as PDF, export.
   Like the canvas, it re-reads the manifest every 2 s.
   ========================================================= */
(() => {
  const { t } = window.ATELIER_I18N;
  const EXPORT = window.ATELIER_EXPORT;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = s => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const PROJECTS = Array.isArray(window.ATELIER_PROJECTS) && window.ATELIER_PROJECTS.length
    ? window.ATELIER_PROJECTS : [{ id: 'example', name: t('project.example') }];
  const PROJECT = PROJECTS.find(p => p.id === params.get('p')) || { id: params.get('p') || PROJECTS[0].id };
  const BASE = 'projects/' + PROJECT.id + '/';
  const STATUS = ['draft', 'review', 'approved'];
  const BGS = ['canvas', 'white', 'dark', 'checker'], BG_KEY = 'atelier-view-bg';
  const PAD = 40, ZOOM_MIN = 0.05, ZOOM_MAX = 8;

  const stage = $('#stage'), frame = $('#vFrame'), zoomVal = $('#zoomVal'), toastEl = $('#toast');
  let WS, list = [], cur = -1, media = null, mediaUrl = null;
  const view = { fit: true, s: 1 };

  let toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  const tag = document.createElement('script');
  tag.src = BASE + 'manifest.js';
  tag.onload = () => window.WORKSPACE ? start(window.WORKSPACE) : notFound();
  tag.onerror = notFound;
  document.body.appendChild(tag);

  function notFound() {
    stage.insertAdjacentHTML('beforeend',
      `<div class="empty-msg"><div><b>${esc(t('project.notFound'))}</b>${esc(t('project.missing', { path: BASE + 'manifest.js' }))}</div></div>`);
  }

  function flatten() {
    list = (WS.sections || []).flatMap(sec => (sec.items || []).map(def => ({ def, section: sec })));
  }

  /* ---------- SHOW A BOARD ---------- */
  function show(i) {
    if (!list.length) return;
    cur = (i + list.length) % list.length;
    const { def, section } = list[cur];
    const url = BASE + def.src + (def.rev != null ? '?rev=' + encodeURIComponent(def.rev) : '');
    const tagName = def.type === 'image' ? 'IMG' : 'IFRAME';
    if (!media || media.tagName !== tagName) {
      media?.remove();
      media = document.createElement(tagName);
      if (tagName === 'IFRAME') { media.scrolling = 'no'; media.tabIndex = -1; } else media.draggable = false;
      frame.appendChild(media);
      mediaUrl = null;
    }
    if (mediaUrl !== url) { media.src = url; mediaUrl = url; }
    def.type === 'image' ? (media.alt = def.title) : (media.title = def.title);
    Object.assign(media.style, { width: def.w + 'px', height: def.h + 'px' });
    frame.style.setProperty('--w', def.w + 'px');
    frame.style.setProperty('--h', def.h + 'px');
    $('#pageSize').textContent = `@page { size: ${def.w}px ${def.h}px; margin: 0; }`;

    const st = def.status && (STATUS.includes(def.status) ? def.status : 'other');
    $('#vTitle').textContent = def.title || def.id;
    $('#vMeta').innerHTML = [section.title && esc(section.title), `${def.w} × ${def.h}`,
      st && `<i class="status st-${st}">${esc(st === 'other' ? def.status : t('status.' + st))}</i>`].filter(Boolean).join('<span>·</span>');
    $('#vCount').textContent = t('view.count', { i: cur + 1, n: list.length });
    document.title = (def.title || def.id) + ' — ' + (WS.name || PROJECT.name || PROJECT.id);

    const q = '?p=' + encodeURIComponent(PROJECT.id) + '&b=' + encodeURIComponent(def.id);
    history.replaceState(null, '', location.pathname + q + (params.has('lang') ? '&lang=' + params.get('lang') : ''));
    $('#backBtn').href = 'Atelier.html' + q;
    $('#fileBtn').href = BASE + def.src;
    $('#prevBtn').disabled = $('#nextBtn').disabled = list.length < 2;
    layout();
  }

  /* ---------- ZOOM ---------- */
  function layout() {
    if (cur < 0) return;
    const { w, h } = list[cur].def, fs = !!document.fullscreenElement;
    if (view.fit) {
      const pad = fs ? 0 : PAD * 2;
      const s = Math.min((stage.clientWidth - pad) / w, (stage.clientHeight - pad) / h);
      view.s = Math.max(ZOOM_MIN, fs ? s : Math.min(1, s)); // never stretched beyond 100%, outside full screen
    }
    frame.style.width = w * view.s + 'px';
    frame.style.height = h * view.s + 'px';
    media.style.transform = `scale(${view.s})`;
    zoomVal.textContent = Math.round(view.s * 100) + '%';
    $('#fitBtn').classList.toggle('on', view.fit);
    stage.classList.toggle('can-pan', stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight);
  }

  function zoomTo(s, fit = false) {
    // keep the point at the center of the stage still
    const cx = (stage.scrollLeft + stage.clientWidth / 2) / Math.max(1, stage.scrollWidth);
    const cy = (stage.scrollTop + stage.clientHeight / 2) / Math.max(1, stage.scrollHeight);
    view.fit = fit;
    if (!fit) view.s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));
    layout();
    stage.scrollLeft = cx * stage.scrollWidth - stage.clientWidth / 2;
    stage.scrollTop = cy * stage.scrollHeight - stage.clientHeight / 2;
  }
  const fit = () => zoomTo(0, true);

  stage.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomTo(view.s * Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.0025)));
  }, { passive: false });

  // drag to pan when the board is larger than the window
  let drag = null;
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !stage.classList.contains('can-pan')) return;
    drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop, id: e.pointerId };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('panning');
  });
  stage.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    stage.scrollLeft = drag.l - (e.clientX - drag.x);
    stage.scrollTop = drag.t - (e.clientY - drag.y);
  });
  const endDrag = () => { drag = null; stage.classList.remove('panning'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', () => view.fit ? zoomTo(1) : fit());
  window.addEventListener('resize', () => layout());

  /* ---------- ACTIONS ---------- */
  function setBg(bg) {
    document.body.dataset.bg = BGS.includes(bg) ? bg : BGS[0];
    try { localStorage.setItem(BG_KEY, document.body.dataset.bg); } catch {}
  }
  const cycleBg = () => setBg(BGS[(BGS.indexOf(document.body.dataset.bg) + 1) % BGS.length]);

  const toggleFs = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  document.addEventListener('fullscreenchange', () => {
    document.body.classList.toggle('fs', !!document.fullscreenElement);
    fit();
  });

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
  const copyLink = async () => toast(t(await copyText(location.href) ? 'view.linkCopied' : 'view.copyFailed'));

  async function copyImage() {
    if (await EXPORT.available() !== 'ok') return toast(t('view.needServer'));
    toast(t('view.copying'));
    try { await EXPORT.copyImage(BASE, list[cur].def); toast(t('view.imageCopied')); }
    catch { toast(t('view.copyFailed')); }
  }

  const openExport = () => list.length && EXPORT.open({
    projectName: WS.name || PROJECT.name || PROJECT.id, base: BASE,
    groups: (WS.sections || []).map(s => ({ title: s.title, items: s.items || [] })),
    checked: [list[cur].def.id]
  });

  $('#prevBtn').onclick = () => show(cur - 1);
  $('#nextBtn').onclick = () => show(cur + 1);
  $('#zoomOut').onclick = () => zoomTo(view.s / 1.25);
  $('#zoomIn').onclick = () => zoomTo(view.s * 1.25);
  zoomVal.onclick = () => zoomTo(1);
  $('#fitBtn').onclick = fit;
  $('#bgBtn').onclick = cycleBg;
  $('#fsBtn').onclick = toggleFs;
  $('#linkBtn').onclick = copyLink;
  $('#copyBtn').onclick = copyImage;
  $('#printBtn').onclick = () => window.print();
  $('#exportBtn').onclick = openExport;

  window.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && e.code === 'KeyE') { e.preventDefault(); return openExport(); }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); return zoomTo(view.s * 1.25); }
    if (mod && e.key === '-') { e.preventDefault(); return zoomTo(view.s / 1.25); }
    if (mod && e.key === '0') { e.preventDefault(); return fit(); }
    if (mod || e.altKey) return;
    if (e.shiftKey && e.code === 'Digit1') return fit();
    if (e.shiftKey && e.code === 'Digit0') return zoomTo(1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); return show(cur + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); return show(cur - 1); }
    if (e.key === 'Home') return show(0);
    if (e.key === 'End') return show(list.length - 1);
    if (e.key === '=' || e.key === '+') return zoomTo(view.s * 1.25);
    if (e.key === '-') return zoomTo(view.s / 1.25);
    if (e.key === 'f' || e.key === 'F') return toggleFs();
    if (e.key === 'b' || e.key === 'B') return cycleBg();
  });

  /* ---------- LIVE RELOAD ---------- */
  function poll() {
    if (document.hidden) return;
    window.WORKSPACE = null;
    const s = document.createElement('script');
    s.src = BASE + 'manifest.js?t=' + Date.now();
    s.onload = s.onerror = () => {
      s.remove();
      const next = window.WORKSPACE;
      window.WORKSPACE = WS;
      if (!next || !Array.isArray(next.sections) || JSON.stringify(next) === JSON.stringify(WS)) return;
      const id = list[cur]?.def.id;
      WS = next; flatten();
      const i = list.findIndex(x => x.def.id === id);
      show(i < 0 ? Math.min(cur, list.length - 1) : i);
    };
    document.head.appendChild(s);
  }

  /* ---------- STARTUP ---------- */
  function start(ws) {
    WS = ws;
    let bg = null;
    try { bg = localStorage.getItem(BG_KEY); } catch {}
    setBg(bg);
    flatten();
    if (!list.length) return stage.insertAdjacentHTML('beforeend',
      `<div class="empty-msg"><div><b>${esc(t('project.empty'))}</b>${esc(t('project.emptyHint'))}</div></div>`);
    const want = params.get('b'), i = list.findIndex(x => x.def.id === want);
    if (want && i < 0) toast(t('view.notFound'));
    show(Math.max(0, i));
    setInterval(poll, 2000);
  }
})();
