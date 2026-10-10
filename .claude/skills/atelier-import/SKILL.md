---
name: atelier-import
description: Migrate exported design files (from Figma, Paper, Sketch, Canva, Framer, Illustrator…) into a new Atelier project, with every asset placed on the canvas exactly as exported. Use it whenever the user hands over a folder, a zip or a list of png/jpg/svg/webp/gif/pdf files and wants them "in Atelier", or talks about moving, porting, migrating or importing designs, frames, artboards or a Figma file into Atelier. Use it even if they don't say "import" (e.g. "ho esportato tutto da Figma, mettimelo qui").
---

# Import exported designs into Atelier

The goal is a **faithful transposition**: each exported file becomes one board on the canvas, shown at its original design size and pixel-for-pixel identical. Nothing is redrawn, recolored or "improved". The user is moving off another tool and has to trust that what they see in Atelier is what they had there. Rebuilding boards as HTML is a separate, later step, and only when asked.

## Workflow

### 1. Look at the input

List what was handed over (folder, zip, loose files) and note:
- the formats: png, jpg, gif, webp and svg import directly; **pdf** needs its pages rendered first (step 2);
- the scale: Figma adds `@2x` / `@3x` to file names exported at that scale. Without a suffix, a 2160×2700 png is ambiguous (a 1080×1350 frame at 2x, or a 2160×2700 frame?). If many files are exactly 2× or 3× a common format (1080×1350, 1080×1920, 1440×900, 1920×1080, A4 794×1123…), ask the user which scale they exported at, or pass `--scale` if they already said;
- the structure: Figma turns `/` in frame names into subfolders, so subfolders usually mirror pages or groups and become **sections**.

If no project id or name was given, derive them from the folder name and say what you chose. The id is the folder name: letters, digits, `-`, `_`.

### 2. PDFs (only if present)

Render each page to png at 2× so it stays sharp, into a folder named after the pdf (that folder becomes a section). Then pass that folder to the importer instead of the pdf:

```
swift .claude/skills/atelier-import/scripts/pdf_pages.swift "deck.pdf" "<scratchpad>/pdf/Deck"   # macOS, built in
pdftoppm -r 144 -png "deck.pdf" "<scratchpad>/pdf/Deck/page"                                  # elsewhere, if poppler is installed
```

The Swift script uses PDFKit, so it needs no install on a Mac. It takes ~15 s to start and writes `page-01@2x.png`…, so the importer picks up scale 2 by itself. With `pdftoppm`, import that folder with `--scale 2`. Design tools export 1 px as 1 pt, so the board size equals the original frame size. Rename the folder to the title you want for the section ("Deck", not "deck-final-v3"). If no renderer works, tell the user and import the rest.

### 3. Run the importer

```
python3 .claude/skills/atelier-import/scripts/import_assets.py <id> <path>... --name "<Name>" --dry-run
```

`--dry-run` prints the plan (JSON: boards, skipped files, warnings) without writing anything. Read it, then run again without `--dry-run`. The script:
- reads each file's pixel size (stdlib only), divides by the scale → `w`/`h` in the manifest, so @2x files stay sharp on the canvas and in export;
- keeps one board per asset: when the same name comes in several scales or formats it keeps svg > png > webp > gif > jpg, at the highest resolution, and lists the others as skipped;
- copies the files into `projects/<id>/sources/` with url-safe names (the originals elsewhere are never touched) and keeps the original name as the board `title`, which is also the export file name;
- orders boards naturally (`Post 2` before `Post 10`) and writes `manifest.js`;
- registers the project in `projects/index.js`.

Options: `--scale N` forces a scale; `--group size` makes one section per board size (good for a flat folder of mixed formats), `--group flat` a single section; `--force` replaces an existing manifest.

If `projects/<id>/` already exists, don't use `--force` blindly: it replaces the manifest. Ask whether to add to that project or pick a new id. To add to an existing project, import into a temporary id, move the files, and merge the sections by hand.

### 4. Finish the project

- Section titles come from folder names. Rename them in the manifest if they are cryptic (`Frame 12` → keep it; `pg_01_final_v3` → ask or leave it).
- If one of the assets is clearly the logo, set `logo:` in the manifest.
- Create `projects/<id>/CLAUDE.md` with a short note: where the files came from (tool, date), that boards are image imports from `sources/`, and any brand facts the user mentioned. Keep it brief: it's the starting point for future work on this project.

### 5. Verify

```
node .claude/skills/atelier-project/scripts/check_project.mjs <id>
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1600,1000 --virtual-time-budget=5000 --screenshot=<scratchpad>/import.png \
  "file://$PWD/Atelier.html?p=<id>"
```

The check flags aspect ratios that don't match (the canvas uses `object-fit: cover`, so those boards would be cropped) and images smaller than their board (they would be blurry). Look at the screenshot: every asset visible, nothing cropped, sections in a sensible order.

### 6. Report

Tell the user: how many boards in which sections, what was skipped and why (duplicates, unsupported files), the scale you assumed, and the link `Atelier.html?p=<id>`. If anything was ambiguous (scale, grouping), say what you chose and how to change it.

## What not to do

- Don't convert, compress or resize the images: export already lets the user produce PNG/JPG/WEBP/PDF from Atelier at any scale.
- Don't rebuild assets as HTML boards unless asked: it breaks the "exactly as exported" promise. If the user wants editable boards later, that's the job of the `atelier-board` skill, one board at a time, with the image as a reference.
- Don't put imported files in `assets/`: that folder is for files that boards link (css, fonts, logos). Imported designs are originals, so they go in `sources/`.
