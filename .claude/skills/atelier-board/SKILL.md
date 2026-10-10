---
name: atelier-board
description: Create or edit boards (artboards/frames) in an Atelier project: social posts, carousels, stories, slides, brand-manual pages, documents, kanban boards, or any single HTML page placed on the canvas. Use it whenever the user asks to design, add, duplicate, resize, fix or update something inside an Atelier project ("fammi un post per X", "aggiungi una slide", "modifica la cover", "make a carousel about…", "add this png to the canvas"), even if they don't say "board". Covers the HTML file, the manifest entry, the rev bump and the visual check.
---

# Atelier boards

One board = one standalone HTML file of a fixed size, plus one item in the project's `manifest.js`. The manifest is the only thing the canvas reads, and `w`/`h` drive layout, export and PDF. So a board that isn't in the manifest, or whose size doesn't match, is effectively broken even if the HTML looks fine.

## Before designing

1. Find the project (`projects/<id>/`) and read its `CLAUDE.md`: brand rules, reference boards by kind, tone.
2. Open a **reference board of the same kind** (same size and purpose) and its `assets/brand.css`. Starting from it keeps typography, spacing and components consistent across the project, which matters more than any single board looking clever.
3. If the project has no CLAUDE.md or brand, use the `atelier-project` skill first or ask what look they want.

## Board file

Path: `projects/<id>/boards/<section>/<name>.html`, a kebab-case name, numbered when order matters (`03-proposta-1.html`).

```html
<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Board title</title>
<link rel="stylesheet" href="../../assets/brand.css">   <!-- one more ../ per extra subfolder -->
<style>
  @page { size: 1080px 1350px; }
  /* board-specific css only: shared components belong in brand.css */
</style>
</head>
<body>
<section class="page …">
  …
</section>
</body>
</html>
```

- Exactly one `<section class="page">`, and `@page` in px equal to the manifest `w`/`h`.
- Use the brand variables (`var(--…)`), never raw hex. If you need a new shared component, add it to `brand.css` and say so.
- Text must fit the board: there is no scrolling. Respect safe areas for social formats (e.g. Instagram crops a 1080×1350 post to 1080×1080 in the grid, so keep the key content centered).
- Images used by a board go in `assets/` (or are referenced from `sources/`) with relative paths. Everything has to work from `file://`, so no fetch and no absolute paths.
- Content language: whatever the project uses. Board content doesn't go through the UI i18n.

Pure images (png/jpg/svg/webp) don't need an HTML file: add them directly as `type: "image"`, with `w`/`h` = pixel size ÷ export scale.

## Manifest item

```js
{ id: "prop-03", title: "03 · Proposta 1", type: "html", src: "boards/posts/proposte/03-proposta-1.html", w: 1080, h: 1350 }
```

- `id` unique in the project; `title` is shown on the canvas and is the **export file name**, so make it readable.
- `src` relative to the project folder.
- Optional: `status: "draft" | "review" | "approved"` (new boards → `"draft"` unless the user says otherwise, if the project uses statuses), `rev`.
- Placement: sections stack top to bottom, items go left to right in array order. A carousel = one section with its slides in order. Add `note` on the section for format/count ("9 slide · 1080×1350").

## Editing an existing board

The canvas re-reads the manifest every 2 s but **does not watch board files**. After editing a board, bump its `rev` (add `rev: 2`, or increment it) so Atelier reloads that iframe. Without it the user keeps seeing the old version and thinks the edit failed.

Duplicating a board: copy the file, give the new item a new `id` and `title`, and adjust the content.

## Verify

1. `node .claude/skills/atelier-project/scripts/check_project.mjs <id>`: manifest loads, files exist, `@page` = `w`/`h`, ids unique.
2. Screenshot the board itself at its exact size and look at it. Overflow, clipped text and missing fonts only show up visually:
   ```
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
     --window-size=W,H --virtual-time-budget=5000 --screenshot=<scratchpad>/board.png \
     "file://$PWD/projects/<id>/boards/<section>/<name>.html"
   ```
   For several boards, also check `view.html?p=<id>&b=<itemId>` or the whole canvas `Atelier.html?p=<id>` at 1600×1000.
3. Fix and re-check until it looks right, then give the user the link `Atelier.html?p=<id>&b=<itemId>`.

Save screenshots in the scratchpad, not in the project.
