# Contributing to Atelier

Thanks for helping. Atelier is a small tool on purpose: a canvas made of plain HTML files that opens with a double-click. Every contribution should keep it that way.

## Ground rules

Before you write code, check your idea against these. A change that breaks one of them will not be merged, however nice it is.

1. **No build step.** No bundler, transpiler, TypeScript, or framework. The files in the repo are the files the browser runs.
2. **No dependencies.** No npm packages, no CDN scripts. `atelier.py` uses only the Python standard library. Projects may load Google Fonts; the app itself may not.
3. **Works from `file://`.** Double-clicking `Atelier.html` must keep working. Only export may require the local server.
4. **Quiet chrome, loud work.** The UI stays neutral (grey, white, graphite, one blue). Boards carry the colour.
5. **Files, not formats.** A board is a standalone HTML file; a project is a folder. Don't introduce a format only Atelier can read.

## Getting started

```sh
git clone https://github.com/mattqdev/atelier.git
cd atelier
open Atelier.html          # or double-click it
python3 atelier.py         # optional: serves the folder and enables export
```

Export renders with headless Chrome/Chromium/Edge/Brave. If yours isn't detected, set `ATELIER_CHROME=/path/to/chrome`.

## Where things live

[CLAUDE.md](CLAUDE.md) is the technical map of the repo: folder structure, manifest fields, live reload, export pipeline and how to verify changes. Read it first. In short:

| Path | What |
|---|---|
| `Atelier.html`, `app/app.js`, `app/app.css` | Canvas: pan, zoom, layers, selection, project switch |
| `view.html`, `app/view.js`, `app/view.css` | Single-board viewer |
| `app/export.js` | Export dialog, re-encoding, ZIP |
| `app/i18n.js`, `app/locales/*.js` | UI translations |
| `atelier.py` | Optional local server and render endpoint |
| `projects/example/` | The only versioned project |
| `docs/brand/` | Logo and brand renders (don't edit by hand) |

## Making a change

- **Branch** from `main`: `fix/export-zip-names`, `feat/minimap`, `i18n/de`.
- **Code style:** match the surrounding code — plain ES2020+, no semicolon or formatting wars, small functions, comments only where the *why* isn't obvious. Comments and docs are in English.
- **UI text** is never hard-coded. Use `data-i18n`, `data-i18n-title`, `data-i18n-html` in HTML and `ATELIER_I18N.t('key')` in JS, and add every new key to **all** files in `app/locales/` (`en.js` is the reference).
- **Your projects stay local.** `projects/*` is gitignored except `projects/example/`. Don't force-add personal projects or `projects/index.js`.
- **Keep PRs focused.** One fix or feature per PR. Refactors go in their own PR.

### Verify before you open a PR

1. Open `Atelier.html` from `file://` and `?p=example`; check the console is clean.
2. If you touched the viewer, open `view.html?p=example&b=welcome`.
3. If you touched export or `atelier.py`, run the server and export at least one PNG and one PDF.
4. Take a headless screenshot of what you changed and attach it to the PR. CI runs the same static checks (`node .github/scripts/check.mjs`) and a headless smoke test on every PR:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1600,1000 --virtual-time-budget=5000 --screenshot=out.png "file://$PWD/Atelier.html?p=example"
```

Test in at least one Chromium browser and, for UI changes, Safari or Firefox too.

### Commit messages

Imperative mood, sentence case, no trailing period, under ~70 characters for the subject:

```
Add minimap to the canvas
Fix ZIP names when two boards share a title
```

Add a body when the *why* isn't obvious.

## Adding a language

1. Copy `app/locales/en.js` to `app/locales/<code>.js` and translate the values (keep keys and `{placeholders}` intact).
2. Add its `<script>` to `Atelier.html` and `view.html`, before `app/i18n.js`.
3. Open `Atelier.html?lang=<code>` and check nothing overflows.

## Reporting bugs and ideas

Use the [issue templates](https://github.com/mattqdev/atelier/issues/new/choose). For bugs, say how you opened Atelier (`file://` or `atelier.py`), your browser and OS, and include steps and a screenshot. For ideas, explain the problem first; a proposal that adds a build step or a dependency will be declined.

Security issues: don't open a public issue — follow [SECURITY.md](SECURITY.md). Questions and early ideas are welcome in [Discussions](https://github.com/mattqdev/atelier/discussions). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Brand

The logo and brand assets are in `docs/brand/`. Use them as they are: don't redraw, recolour or retype the logo.
