---
name: atelier-project
description: Create a new Atelier project (a new canvas in the top-bar menu), set up its brand tokens and its project CLAUDE.md, starting from scratch or from material the user provides (brand manual pdf, logo, screenshots, a website). Use it whenever the user wants a new project, client, brand or workspace in Atelier ("nuovo progetto", "apri un progetto per X", "set up a canvas for my client"), or wants to turn brand guidelines into an Atelier brand.css. For migrating a folder of exported designs (rebuilt as editable HTML boards), use atelier-import instead.
---

# New Atelier project

A project is a folder `projects/<id>/` plus one line in `projects/index.js`. What makes it useful later is the brand foundation: every board will link `assets/brand.css` and follow `projects/<id>/CLAUDE.md`, so getting those right once saves every future board from guessing colors and fonts.

## 1. Gather

- **id**: folder name, no spaces (`NextWave`, `acme-2027`). **name**: what the menu shows.
- **Source material**: if the user gave files (pdf brand manual, logo, references), copy them unchanged into `projects/<id>/sources/`. They are the reference and must not be edited later.
- Read the material and extract: palette (hex + role and proportion), fonts (and whether they are on Google Fonts), logo files and variants, graphic elements, tone of voice, recurring formats (post 1080×1350, story 1080×1920, A4 794×1123, slides 1920×1080…).

If there's no brand and the user didn't describe one, ask briefly what the project is for. Don't invent a brand they didn't ask for: a neutral `brand.css` is fine to start.

## 2. Scaffold

1. Copy `projects/example/` to `projects/<id>/`; create `assets/`, `boards/`, `sources/`.
2. In `manifest.js`: set `name` (and `logo: "assets/logo.svg"` if there is one), replace the welcome section with the sections the user needs, or leave a first board (see below).
3. Add `{ id: "<id>", name: "<Name>" }` to `projects/index.js`, keeping its alignment. If the file doesn't exist (fresh clone), create it:
   ```js
   window.ATELIER_PROJECTS = [
     { id: "<id>", name: "<Name>" }
   ];
   ```

## 3. Brand (when there is one)

`assets/brand.css` holds the tokens and the shared components. Model it on an existing branded project if there is one locally (e.g. `projects/*/assets/brand.css`):

```css
@import url("https://fonts.googleapis.com/css2?family=...&display=swap");
:root {
  /* palette: role and proportion in the comment */
  --primary: #034CAD;  /* titles, 30% */
  --f-display: 'Anton', Impact, sans-serif;
  --f-body: 'Archivo', Helvetica, Arial, sans-serif;
  --pad: 65px;
  --logo: url("logo.svg");   /* relative to this css file */
}
* { box-sizing: border-box; margin: 0; padding: 0; }
.page { position: relative; overflow: hidden; width: 100%; height: 100%; }
```

Name tokens by brand name or role, and comment them with role and proportion: boards will use only variables, never raw hex. Fonts: Google Fonts via `@import`; a non-Google font goes in `assets/fonts/` with `@font-face`, otherwise pick the closest Google alternative and say so. Logo: prefer svg; a png with the background removed is fine.

## 4. Project CLAUDE.md

`projects/<id>/CLAUDE.md` is what Claude reads every time it works on this project. Keep it short and concrete, in the same shape as the other projects:

```markdown
# Project <Name>

<one line: what it is, for whom>. Generic rules (structure, manifest, verification) are in the root CLAUDE.md.

## Files
manifest.js · assets/brand.css (tokens + shared components) · assets/logo.svg · boards/<section>/*.html · sources/ (originals: do not modify)

Reference boards by kind: <list as soon as they exist>
Every board: `<link rel="stylesheet" href="../../assets/brand.css">` (one more `../` per extra subfolder).

## Brand
- Colors: <name hex role %> …
- Fonts: <font → use>
- Elements: <graphic devices>
- Tone: <voice, formal/informal address, hashtags>
- Always use the variables in assets/brand.css, never hard-coded hex.
```

Write it in the language the user uses for this project's content.

## 5. First board (optional but recommended)

An empty project shows "No boards yet". If the brand is defined, a cover or a palette/type board is a good first board, and it gives later boards a reference. Follow the `atelier-board` skill.

## 6. Verify

```
node .claude/skills/atelier-project/scripts/check_project.mjs <id>
```
Then a headless screenshot of `Atelier.html?p=<id>` at 1600×1000 (command in the root CLAUDE.md) and look at it. Report the link `Atelier.html?p=<id>` and what you set up.

`projects/*` is gitignored (only `example/` is versioned): new projects stay local, so there's nothing to commit.
