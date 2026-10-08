# Atelier

Personal Figma-style design tool: a static, multi-project HTML canvas maintained by Claude. It replaces Figma/Paper/Trello. No MCP, no build step, no dependencies (projects may use Google Fonts).

Open it by double-clicking `Atelier.html` (works from `file://`). The top-bar menu switches project; `Atelier.html?p=<id>` opens a specific one.

## Structure

```
Atelier.html              → canvas shell. Holds no content.
view.html                 → single-board viewer (opened by "Open"): fit, zoom, browse, print, export
atelier.py                → optional local server (stdlib only): serves the folder, renders exports with headless Chrome
app/app.js|css            → canvas engine (pan/zoom, layers, selection, project switch). Touch only for new features.
app/view.js|css           → viewer logic and styles (view.css builds on app.css)
app/export.js             → Figma-style export dialog, re-encoding (JPG/WEBP) and ZIP, shared by canvas and viewer
app/i18n.js               → UI translations: picks the language and applies the strings
app/locales/<code>.js     → dictionaries (en = reference, it)
app/atelier.svg           → app icon / favicon (same as docs/brand/app-icon.svg)
app/atelier-touch.png     → apple-touch-icon, 180×180
docs/brand/               → logo SVGs and PNG renders (README banner, social preview, OG). Rendered from the local brand project: don't edit by hand
projects/index.js         → project registry: [{ id, name }] (local, gitignored)
projects/<id>/manifest.js → SINGLE source of truth for what appears on that project's canvas
projects/<id>/assets/     → project css/logo/fonts
projects/<id>/boards/     → one board = one standalone HTML file
projects/<id>/sources/    → the user's original files (pdf, png…): do not modify
projects/<id>/CLAUDE.md   → project-specific rules (brand, tone)
projects/example/         → demo project, the only versioned one
```

The GitHub repo (`mattqdev/atelier`, private) holds only the program: `projects/*` is in `.gitignore` except `example/`.

Code comments and contributor docs are written in English.

## Languages (i18n)

No UI text is hard-coded in `Atelier.html`, `view.html` or the JS: use a key.
- HTML: `data-i18n="key"` (text), `data-i18n-title` (tooltip), `data-i18n-html` (trusted markup, e.g. `<kbd>`).
- JS: `ATELIER_I18N.t('key', { var })`, with `{var}` placeholders in the string.
- Every new key goes into **all** files in `app/locales/`; `en.js` is the reference (fallback when a key is missing).
- Language: `?lang=<code>` → last choice (localStorage) → browser language → `en`. Globe menu in the top bar.
- New language: copy `app/locales/en.js` to `<code>.js`, translate it, add its `<script>` to `Atelier.html` and `view.html` before `app/i18n.js`.

Project content (boards, names in the manifest) does not go through i18n.

## New project

1. Copy `projects/example/` to `projects/<id>/` (id = folder name, no spaces).
2. Update `name` (and optional `logo`) in its `manifest.js`.
3. Add `{ id, name }` to `projects/index.js`.
4. If the project has a brand, create `assets/brand.css` with the tokens and `projects/<id>/CLAUDE.md` with the rules.

## Adding a board

1. Create `projects/<id>/boards/<section>/<name>.html` starting from an existing board of the same kind.
2. Every board: link to the project css with a relative path, `@page { size: Wpx Hpx; }`, a single `<section class="page …">`. Board-specific CSS goes in a local `<style>`.
3. Add the item to the manifest (`id`, `title`, `type: "html"|"image"`, `src`, `w`, `h`). `src` is relative to the project folder; `w/h` must match `@page` (export and PDF rely on it).
4. Images (png/jpg) are added directly with `type: "image"`, no HTML file.
5. Optional item fields: `status: "draft"|"review"|"approved"` (badge on the canvas and in the layers) and `rev`.

The board `title` is also the exported file name.

## Live reload

Atelier re-reads `manifest.js` every 2 s (canvas and viewer): manifest changes show up by themselves, no reload needed. A board's content is not watched: **after editing a board file, bump its item's `rev`** (e.g. `rev: 2`) and Atelier reloads only that iframe. The top-bar reload button reloads every board.

Links: `Atelier.html?p=<id>&b=<itemId>` opens the project zoomed on that board (the URL updates with the selection); `view.html?p=<id>&b=<itemId>` opens it in the viewer.

Sections stack vertically in order; boards sit side by side left to right. Use `x`/`y` on a section only when it needs a fixed position.

## Export

Export (⇧⌘E on the canvas and in the viewer) needs `python3 atelier.py`: the page must be served over http so it can call `/__atelier/render`, which runs headless Chrome (`--screenshot` with `--force-device-scale-factor` for PNG, `--print-to-pdf` for PDF). JPG/WEBP are re-encoded in the browser; multiple files are zipped in the browser. Opened from `file://`, the dialog explains how to start the server; the viewer's print / save as PDF works without it.

## Verification

After changes, take a headless screenshot to check:
```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=W,H --virtual-time-budget=5000 --screenshot=out.png "file://$PWD/<file>.html"
```
For the whole workspace use `Atelier.html?p=<id>` at 1600×1000; for the viewer `view.html?p=<id>&b=<itemId>`.
Don't pass `--user-data-dir` to headless Chrome: it writes the file but never exits.
