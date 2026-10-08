/* =========================================================
   ATELIER — UI translations
   Languages live in app/locales/<code>.js (window.ATELIER_LOCALES).
   Language: ?lang=<code> → last choice → browser language → en.
   In HTML: data-i18n (text), data-i18n-html (trusted markup),
   data-i18n-title (tooltip). In JS: t('key', { var }).
   ========================================================= */
(() => {
  const LOCALES = window.ATELIER_LOCALES || {};
  const FALLBACK = 'en', KEY = 'atelier-lang';
  const pick = c => c && (LOCALES[c] ? c : LOCALES[c.slice(0, 2).toLowerCase()] ? c.slice(0, 2).toLowerCase() : null);
  const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  const lang = pick(new URLSearchParams(location.search).get('lang')) || pick(saved)
    || (navigator.languages || [navigator.language]).map(pick).find(Boolean) || FALLBACK;

  const t = (key, vars) => {
    const s = LOCALES[lang]?.[key] ?? LOCALES[FALLBACK]?.[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m) : s;
  };

  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  }

  function setLang(code) {
    try { localStorage.setItem(KEY, code); } catch {}
    const q = new URLSearchParams(location.search);
    if (q.has('lang')) { q.set('lang', code); location.search = q; } else location.reload();
  }

  document.documentElement.lang = lang;
  apply();
  const sel = document.querySelector('#langSel');
  if (sel) {
    const codes = Object.keys(LOCALES);
    sel.innerHTML = codes.map(c => `<option value="${c}">${c.toUpperCase()}</option>`).join('');
    sel.value = lang;
    sel.title = t('lang.change') + ' · ' + LOCALES[lang]._name;
    sel.onchange = () => setLang(sel.value);
    if (codes.length < 2) sel.closest('.lang-pick').hidden = true;
  }

  window.ATELIER_I18N = { lang, t, apply, setLang };
})();
