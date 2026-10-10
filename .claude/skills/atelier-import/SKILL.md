---
name: atelier-import
description: Migrate exported design files (from Figma, Paper, Sketch, Canva, Framer, Illustrator…) into an Atelier project by rebuilding every asset as an editable HTML board that matches the export pixel for pixel. Use it whenever the user hands over a folder, a zip or a list of png/jpg/svg/webp/gif/pdf/html files and wants them "in Atelier", or talks about moving, porting, migrating or importing designs, frames, artboards or a Figma file into Atelier. Use it even if they don't say "import" (e.g. "ho esportato tutto da Figma, mettimelo qui").
---

# Migrate exported designs into Atelier

The goal is a **faithful, editable rebuild**: each exported file becomes one HTML board, at the original design size, that looks exactly like the export and can be edited later (real text, shared tokens, vector shapes). The user is leaving another tool: the export is the spec, not the deliverable. Placing the png on the canvas is not a migration.

"Exactly" is measured, not eyeballed: every board is rendered and diffed against its original (step 5) until only antialiasing is left.

## Workflow

### 1. Look at the input

List what was handed over and note, per file:
- **format**. PDFs from design tools carry vectors, exact text and positions: the best source there is. HTML originals are already code: split or adapt them rather than redrawing. Raster files (png/jpg/webp/gif) have to be measured from pixels.
- **scale**. Figma appends `@2x`/`@3x`. Without a suffix, a 2160×2700 png may be a 1080×1350 frame at 2×: if many files are exactly 2× or 3× a common format, ask.
- **structure**. Subfolders (Figma turns `/` in frame names into folders) become sections.
- **links between assets**. A thumbnail shown inside a manual page, a logo reused everywhere, a product screenshot: build the shared piece once and reuse it (an asset in `assets/`, or the other board embedded with a scaled `<iframe>`).

If no project id or name was given, derive them from the folder name and say what you chose (id = letters, digits, `-`, `_`). If `projects/<id>/` exists, ask before touching it.

### 2. Set up the project and keep the originals

```
python3 .claude/skills/atelier-import/scripts/import_assets.py <id> <path>... --name "<Name>" --dry-run   # then without --dry-run
swift .claude/skills/atelier-import/scripts/pdf_pages.swift "deck.pdf" projects/<id>/sources/pdf-pages     # PDFs: page renders at 2×
```

The importer copies the originals into `projects/<id>/sources/` with url-safe names, reads their sizes (÷ scale → board `w`/`h`) and registers the project. The image manifest it writes is temporary: step 6 replaces it. Copy PDFs and HTML originals into `sources/` by hand. Page renders are references for the diff, not content.

### 3. Read the source data before drawing anything

**PDF from a design tool** (Figma exports text as outlines, plus an invisible text layer):
```
swift .claude/skills/atelier-import/scripts/pdf_vectors.swift deck.pdf <scratch>/vec   # page-N.svg + page-N.txt
python3 .claude/skills/atelier-import/scripts/pdf_layout.py <scratch>/vec 2            # text runs: x, baseline, size, colour, text
python3 .claude/skills/atelier-import/scripts/pdf_layout.py <scratch>/vec 2 --shapes   # panels, strokes, icons, images
```
- Each text run gives the exact baseline (glyph paths start with `M x y Z` at the text origin), size, colour and opacity. Follow-on lines of a paragraph: baseline + the line spacing from PDFKit.
- Logos and icons are vector paths: lift them into `assets/<name>.svg`, shifted into their own box. Never trace a raster when the vector exists.
- `page-N.txt` lists clips (rounded-rect radii, and frames that clip strokes) and embedded images (blurred glows → CSS gradients; screenshots → rebuild them or embed the matching board).

**Raster only**: measure with PIL: bounding boxes by colour (`numpy` masks), word gaps by column scan, colours by sampling flat areas (thin text reads darker than its real colour). Look for a better source before rebuilding a screenshot: the product's own SVG output, the repo's history (`gh api repos/<o>/<r>/commits?path=…`), the website.

**Fonts**: confirm them and find tracking with
```
python3 .claude/skills/atelier-import/scripts/font_metrics.py "Dela Gothic One" "JetBrains Mono:400" --text "01 / BRAND" --size 20 --width 283.9
```
A width that matches at 0 confirms the font; a constant gap per character is letter spacing. The same call prints the ascent `A` and normal line height `A+D` used below. Google Fonts are fine, loaded from `assets/brand.css`.

### 4. Build

1. `assets/brand.css` first: colour tokens with the brand's names, font stack, shared components (page furniture, panels, cards, highlight, pills…). Boards keep only their own positions.
2. Boards follow `atelier-board` (one `<section class="page">`, `@page` = `w`/`h`), with each block absolutely positioned at its Figma coordinates (`.page > * { position: absolute }`). Text stays live text with explicit `<br>` line breaks, so wrapping can't drift.
3. Vertical position from the baseline, for a font size `s` and a line height `L`:
   `top = baseline − (L − (A+D)·s) / 2 − A·s`
   Figma's "auto" line height is CSS `line-height: normal` (`L = (A+D)·s`).
4. Known Figma behaviours:
   - strokes inside a clipping frame show only their inner half → `box-shadow: inset 0 0 0 Npx …`; an expanded stroke ring in `--shapes` tells you the full width;
   - "medium" text looks bolder than 400: check 400/500/600;
   - tracking in % → px; Chrome rounds it at 2×, so let `tune.py` pick the value;
   - transparent backgrounds: `html, body { background: transparent }` on that board.

### 5. Verify every board against its original

```
python3 .claude/skills/atelier-import/scripts/compare.py <board.html> <original.png> <scratch>/b1 [--size W H] [--crop x0,y0,x1,y1]
python3 .claude/skills/atelier-import/scripts/tune.py <board.html> <original.png> x0,y0,x1,y1 "<css in board>" "<try 1>" "<try 2>" …
```
- Aim for a mean difference ≤ ~2/255. Then read the `-diff.png`: red outlines on glyph edges are antialiasing, while solid red areas, whole words or a red frame mean a real error. Check those with `--crop` (original above, render below).
- Use `tune.py` for what the source doesn't state (tracking, weight, a 0.5 px offset, an icon's size). It needs a value that changes something: if every candidate scores the same, the rule isn't being applied.
- Then `node .claude/skills/atelier-project/scripts/check_project.mjs <id>` and a canvas screenshot (`Atelier.html?p=<id>` at 1600×1000).

### 6. Finish

- The manifest lists the HTML boards (`type: "html"`, `src: "boards/…"`, sizes = original design size). The originals stay in `sources/`: they are the reference for future edits.
- If one asset is clearly the logo, set `logo:` (it shows on a white top bar, so use a version that is visible there).
- `projects/<id>/CLAUDE.md`: origin and date, board list, shared files, brand facts read from the material (colours, type, rules), and the rebuild notes a future edit needs (formula constants, quirks such as offsets you had to reproduce).

### 7. Report

Boards per section, the diff score of each (or the range), anything kept as an image and why, what you assumed (scale, grouping) and the link `Atelier.html?p=<id>`.

## What not to do

- Don't ship images of text, or a screenshot as a board background "to be safe": that is an import, not a migration.
- Don't redesign, recolour, "fix" spacing or modernise: reproduce what was exported, quirks included. Improvements come later, when asked, through `atelier-board`.
- Don't modify `sources/`.
- Don't use a raster in a board when the content can be HTML/SVG. The exception is real photographic or painted content with no vector equivalent: put it in `assets/` and say so in the report.
