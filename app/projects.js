/* =========================================================
   ATELIER — project registry, shared by the canvas and projects.html
   - list:          projects/index.js (window.ATELIER_PROJECTS) or the example
   - readManifest:  loads projects/<id>/manifest.js through a <script>
                    (fetch doesn't work from file://). Every manifest sets
                    window.WORKSPACE, so reads are queued and never overlap.
   - summary:       board/section/status counts of a manifest
   - opened/touch:  when each project was last opened (localStorage)
   - menu:          the top-bar project switcher of the canvas
   ========================================================= */
(() => {
  const { t } = window.ATELIER_I18N;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const list = Array.isArray(window.ATELIER_PROJECTS) && window.ATELIER_PROJECTS.length
    ? window.ATELIER_PROJECTS : [{ id: 'example', name: t('project.example') }];
  const base = id => 'projects/' + id + '/';
  const STATUS = ['draft', 'review', 'approved'];

  let queue = Promise.resolve();
  function readManifest(id, fresh) {
    const run = () => new Promise(resolve => {
      const prev = window.WORKSPACE;
      window.WORKSPACE = null;
      const s = document.createElement('script');
      s.src = base(id) + 'manifest.js' + (fresh ? '?t=' + Date.now() : '');
      s.onload = s.onerror = () => {
        const ws = window.WORKSPACE;
        window.WORKSPACE = prev;
        s.remove();
        resolve(ws && Array.isArray(ws.sections) ? ws : null); // null = missing or mid-edit
      };
      document.head.appendChild(s);
    });
    return (queue = queue.then(run, run));
  }

  function summary(ws) {
    const items = (ws?.sections || []).flatMap(s => s.items || []);
    const status = {};
    items.forEach(i => { if (i.status) { const k = STATUS.includes(i.status) ? i.status : 'other'; status[k] = (status[k] || 0) + 1; } });
    return { boards: items.length, sections: (ws?.sections || []).length, status, items };
  }
  const plural = (n, key) => n === 1 ? t(key + 'One') : t(key, { n });
  const metaText = s => plural(s.boards, 'project.boards') + ' · ' + plural(s.sections, 'project.sections');

  const OPENED_KEY = 'atelier-opened';
  const opened = () => { try { return JSON.parse(localStorage.getItem(OPENED_KEY)) || {}; } catch { return {}; } };
  const touch = id => { try { localStorage.setItem(OPENED_KEY, JSON.stringify({ ...opened(), [id]: Date.now() })); } catch {} };

  // logo from the manifest, or a monogram with a stable tint per project
  const TINTS = ['#0D99FF', '#9747FF', '#14AE5C', '#F24822', '#FFA629', '#0FA3B1', '#E0457B', '#5B6CFF'];
  function thumb(p, ws) {
    if (ws?.logo) return `<span class="pj-logo"><img src="${esc(base(p.id) + ws.logo)}" alt=""></span>`;
    const name = (ws?.name || p.name || p.id).trim();
    const words = name.split(/[\s_-]+/).filter(Boolean);
    const letters = (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
    let h = 0;
    for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `<span class="pj-logo pj-mono" style="--tint:${TINTS[h % TINTS.length]}">${esc(letters)}</span>`;
  }

  /* ---------- TOP-BAR MENU ---------- */
  const ICON_CHECK = '<svg class="pm-check" viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';
  const ICON_GRID = '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>';
  const ICON_SEARCH = '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25 13.5 13.5"/></svg>';

  function menu(btn, current) {
    const projects = list.some(p => p.id === current.id) ? list : [...list, current];
    const data = new Map(); // id → manifest (null = missing), filled when the menu opens
    const el = document.createElement('div');
    el.className = 'pm';
    el.id = 'projMenu';
    el.setAttribute('role', 'menu');
    el.hidden = true;
    const searchable = projects.length > 6;
    el.innerHTML = (searchable
      ? `<label class="pm-search">${ICON_SEARCH}<input type="search" placeholder="${esc(t('project.search'))}" autocomplete="off" spellcheck="false"></label>` : '')
      + `<div class="pm-list"></div><div class="pm-empty" hidden>${esc(t('project.noMatch'))}</div>`
      + `<div class="pm-sep"></div><a class="pm-item pm-all" role="menuitem" href="projects.html">${ICON_GRID}<span>${esc(t('project.all'))}</span><small>${projects.length}</small></a>`;
    document.body.appendChild(el);
    const listEl = el.querySelector('.pm-list'), input = el.querySelector('input'), empty = el.querySelector('.pm-empty');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-controls', el.id);
    btn.setAttribute('aria-expanded', 'false');

    function draw() {
      const q = (input?.value || '').trim().toLowerCase();
      const shown = projects.filter(p => !q || (p.name || p.id).toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
      listEl.innerHTML = shown.map(p => {
        const ws = data.get(p.id);
        const meta = ws === undefined ? '' : ws ? metaText(summary(ws)) : t('project.unavailable');
        return `<a class="pm-item${p.id === current.id ? ' current' : ''}" role="menuitem" href="Atelier.html?p=${encodeURIComponent(p.id)}"`
          + `${p.id === current.id ? ' aria-current="true"' : ''}>${thumb(p, ws)}`
          + `<span class="pm-text"><b>${esc(p.name || p.id)}</b><small>${esc(meta) || '&nbsp;'}</small></span>`
          + `${p.id === current.id ? ICON_CHECK : ''}</a>`;
      }).join('');
      empty.hidden = shown.length > 0;
    }

    const links = () => [...el.querySelectorAll('.pm-item')];
    const isOpen = () => !el.hidden;
    function place() {
      const r = btn.getBoundingClientRect();
      el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + 'px';
      el.style.top = r.bottom + 6 + 'px';
    }
    function open() {
      if (isOpen()) return;
      if (input) input.value = '';
      draw();
      el.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('open');
      place();
      (input || el.querySelector('.pm-item.current') || links()[0])?.focus();
      // refresh names, logos and counts (the current project included)
      projects.forEach(p => readManifest(p.id, true).then(ws => {
        const prev = data.get(p.id);
        data.set(p.id, ws);
        if (isOpen() && JSON.stringify(prev) !== JSON.stringify(ws)) {
          const focused = links().indexOf(document.activeElement);
          draw();
          if (focused >= 0) links()[focused]?.focus();
        }
      }));
    }
    function close(refocus) {
      if (!isOpen()) return;
      el.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('open');
      if (refocus) btn.focus();
    }

    btn.addEventListener('click', () => isOpen() ? close() : open());
    btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(); }
    });
    document.addEventListener('pointerdown', e => {
      if (isOpen() && !el.contains(e.target) && !btn.contains(e.target)) close();
    }, true);
    window.addEventListener('resize', () => isOpen() && place());
    window.addEventListener('blur', () => close());
    input?.addEventListener('input', draw);

    let typed = '', typedT;
    el.addEventListener('keydown', e => {
      e.stopPropagation(); // the canvas shortcuts (arrows, Esc, Enter) stay out of the menu
      const all = links(), i = all.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); return close(true); }
      if (e.key === 'Tab') return close();
      if (e.key === 'ArrowDown') { e.preventDefault(); return all[(i + 1) % all.length]?.focus(); }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        return i <= 0 && input ? input.focus() : all[(i - 1 + all.length) % all.length]?.focus();
      }
      if (e.key === 'Home' && e.target !== input) { e.preventDefault(); return all[0]?.focus(); }
      if (e.key === 'End' && e.target !== input) { e.preventDefault(); return all.at(-1)?.focus(); }
      if (e.key === 'Enter' && e.target === input) { e.preventDefault(); return all[0]?.click(); }
      // type-ahead when there is no search field
      if (!input && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        clearTimeout(typedT);
        typed += e.key.toLowerCase();
        typedT = setTimeout(() => { typed = ''; }, 600);
        all.find(a => a.querySelector('b')?.textContent.toLowerCase().startsWith(typed))?.focus();
      }
    });
  }

  window.ATELIER_REGISTRY = { list, base, readManifest, summary, metaText, opened, touch, thumb, menu, esc };
})();
