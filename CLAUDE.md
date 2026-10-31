# Atelier

Personal Figma-style design tool: a static, multi-project HTML canvas maintained by Claude. It replaces Figma/Paper/Trello. No MCP, no build step, no dependencies (projects may use Google Fonts).

Open it by double-clicking `Atelier.html` (works from `file://`). The project menu in the top bar switches project and links to `projects.html` (all projects as cards); `Atelier.html?p=<id>` opens a specific one.

## Structure

```
Atelier.html              → canvas shell. Holds no content.
view.html                 → single-board viewer (opened by "Open"): fit, zoom, browse, print, export
projects.html             → all projects as cards (mini canvas, counts, last opened), from "All projects" in the project menu
atelier.py                → optional local server (stdlib only): serves the folder, renders exports with headless Chrome; `--install-launcher` creates a one-click app (macOS/Linux/Windows)
app/app.js|css            → canvas engine (pan/zoom, layers, selection). Touch only for new features.
app/projects.js           → project registry shared by canvas and projects page: queued manifest reads, counts, last opened, top-bar project menu
app/home.js|css           → projects page logic and styles (home.css builds on app.css)
app/view.js|css           → viewer logic and styles (view.css builds on app.css)
app/export.js             → Figma-style export dialog, re-encoding (JPG/WEBP) and ZIP, shared by canvas and viewer
app/i18n.js               → UI translations: picks the language and applies the strings
app/locales/<code>.js     → dictionaries (en = reference, it)
app/atelier.svg           → app icon / favicon (same as docs/brand/app-icon.svg)
app/atelier-touch.png     → apple-touch-icon, 180×180
app/atelier.ico           → Windows launcher icon (16–256 px, from docs/brand/app-icon-1024.png)
docs/demo.gif             → README demo (frames captured from the app, assembled with ffmpeg)
docs/how-it-works.gif     → README explainer (ask → Claude designs → tweak → export), animated HTML scene rendered with headless Chrome + ffmpeg
.github/                  → CI (workflows/ci.yml + scripts/check.mjs: i18n parity, example manifest, headless smoke/export), issue & PR templates
docs/brand/               → logo SVGs and PNG renders (README banner, social preview, OG). Rendered from the local brand project: don't edit by hand
projects/index.js         → project registry: [{ id, name }] (local, gitignored)
projects/<id>/manifest.js → SINGLE source of truth for what appears on that project's canvas
projects/<id>/assets/     → project css/logo/fonts
projects/<id>/boards/     → one board = one standalone HTML file
projects/<id>/sources/    → the user's original files (pdf, png…): do not modify
projects/<id>/exports/    → a copy of every export, one folder per run (`YYYY-MM-DD HH.MM.SS`), saved by atelier.py: do not modify
projects/<id>/.thumbs/    → canvas thumbnails `<itemId>@<rev>.webp`, rendered by atelier.py (gitignored, safe to delete)
projects/<id>/CLAUDE.md   → project-specific rules (brand, tone)
projects/example/         → demo project, the only versioned one
```

The GitHub repo (`mattqdev/atelier`, private) holds only the program: `projects/*` is in `.gitignore` except `example/`.

Code comments and contributor docs are written in English.

## Languages (i18n)

No UI text is hard-coded in `Atelier.html`, `view.html`, `projects.html` or the JS: use a key.
- HTML: `data-i18n="key"` (text), `data-i18n-title` (tooltip), `data-i18n-html` (trusted markup, e.g. `<kbd>`).
- JS: `ATELIER_I18N.t('key', { var })`, with `{var}` placeholders in the string.
- Every new key goes into **all** files in `app/locales/`; `en.js` is the reference (fallback when a key is missing).
- Language: `?lang=<code>` → last choice (localStorage) → browser language → `en`. Globe menu in the top bar.
- New language: copy `app/locales/en.js` to `<code>.js`, translate it, add its `<script>` to `Atelier.html`, `view.html` and `projects.html` before `app/i18n.js`.

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
6. Optional manifest field `cover: "<itemId>"`: the board shown on the project's card in `projects.html` (default: the first boards of the first section).

The board `title` is also the exported file name.

## Live reload

Atelier re-reads `manifest.js` every 2 s (canvas and viewer): manifest changes show up by themselves, no reload needed. A board's content is not watched: **after editing a board file, bump its item's `rev`** (e.g. `rev: 2`) and Atelier reloads only that iframe. The top-bar reload button reloads every board.

Links: `Atelier.html?p=<id>&b=<itemId>` opens the project zoomed on that board (the URL updates with the selection); `view.html?p=<id>&b=<itemId>` opens it in the viewer.

Sections stack vertically in order; boards sit side by side left to right. Use `x`/`y` on a section only when it needs a fixed position.

## Pages and performance

Big projects get split into pages (like Figma pages): `page: "Drop 01"` on a section starts a page, and the sections after it stay on that page until another `page`. The canvas lays out only the current page (Pages list at the top of the sidebar, `?pg=<title>` in the URL, view remembered per page); the viewer and the projects page still see every board. Without any `page` there is a single page and no Pages list.

On the canvas a board is shown as its thumbnail (`.thumbs/<itemId>@<rev>.webp`, 640 px on the longest side); its real document loads only while it is on screen and big enough that the thumbnail would look soft, and is dropped right after. Served by `atelier.py`, thumbnails are rendered on demand (`/__atelier/thumb`, re-rendered when the board file is newer). From `file://` they must exist on disk: **after creating or editing boards (and bumping `rev`), run `python3 atelier.py --thumbs <id>`** (renders only missing/outdated ones, removes the rest). A board without its thumbnail falls back to loading live near the viewport (at most 40 kept), so a stale `rev` never shows an old image. Past ~40–50 boards on one page, propose splitting it into pages. Sections can be folded in the layers list (remembered per browser).

## Export

Export (⇧⌘E on the canvas and in the viewer) needs `python3 atelier.py`: the page must be served over http so it can call `/__atelier/render`. The server starts one headless Chrome on demand (warmed up when the export dialog opens), keeps it running and drives it through the DevTools protocol: each board renders in a new tab, several in parallel, from `http://127.0.0.1:<port>/…`. Its profile lives in the system temp dir (`atelier-chrome`) so Google Fonts stay cached across restarts. PNG/JPG/WEBP come straight from Chrome when the scaled size is whole pixels, otherwise the PNG is resampled in the browser. The "single PDF" checkbox merges the selected boards into one PDF (repeated `src/type/w/h` params → a wrapper page with one named `@page` per board). Multiple files are zipped in the browser. Every export is also saved, file by file, in `projects/<id>/exports/<date time>/` (`POST /__atelier/save`, never overwrites; ignored by git). Opened from `file://`, the dialog explains how to start the server; the viewer's print / save as PDF works without it.

## Verification

Run `node .github/scripts/check.mjs` (i18n keys/placeholders in every locale, locale scripts loaded, example manifest sizes); CI runs it plus a headless smoke and export test on every push and PR.

After changes, take a headless screenshot to check:
```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=W,H --virtual-time-budget=5000 --screenshot=out.png "file://$PWD/<file>.html"
```
For the whole workspace use `Atelier.html?p=<id>` at 1600×1000; for the viewer `view.html?p=<id>&b=<itemId>`; for the projects page `projects.html`.
Don't pass `--user-data-dir` to headless Chrome: it writes the file but never exits.
