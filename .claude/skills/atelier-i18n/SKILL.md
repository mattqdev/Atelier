---
name: atelier-i18n
description: Handle translations of the Atelier app UI: add or rename UI strings, translate them, add a new interface language, or fix missing/hard-coded text in Atelier.html, view.html or app/*.js. Use it whenever a change to the Atelier program adds visible text (buttons, tooltips, dialogs, errors, hints), or the user asks to translate the interface ("aggiungi il francese", "traduci questa label", "add Spanish UI"). Not for board/project content, which is never translated through i18n.
---

# Atelier UI translations

The app has no hard-coded UI text: every string is a key in `app/locales/<code>.js`, with `en.js` as the reference and fallback. CI (`node .github/scripts/check.mjs`) fails if any locale is missing a key, has an extra one, or uses different `{placeholders}`, and if a locale script isn't loaded before `app/i18n.js` in both pages. So every change has to touch **all** locale files at once.

## Using a string

- HTML: `data-i18n="key"` (text), `data-i18n-title="key"` (tooltip), `data-i18n-html="key"` (trusted markup like `<kbd>`, only for strings we write ourselves).
- JS: `ATELIER_I18N.t('key', { var })`, with `{var}` in the string. Never concatenate translated fragments: word order changes between languages, so put the whole sentence in one key with placeholders.
- Text created dynamically after load: build it with `t()`, or call `ATELIER_I18N.apply(root)` on the new nodes.

## Adding or changing keys

1. Pick a key in the existing namespaces (`export.*`, `view.*`, `project.*`, `status.*`…), dot-separated, lower camelCase. Grep `en.js` first: the string may already exist.
2. Add it to `en.js` next to related keys, then to **every** other file in `app/locales/`, in the same position, translated. Ship a real translation for every language, not English copied over: if you're unsure of a term, check how the same locale already says similar things (e.g. "board" → "tavola" in Italian) and stay consistent.
3. Keep the same placeholders and keep `\\` escapes and keyboard symbols (⇧⌘E) as they are.
4. Renaming or removing a key: change it in all locales and in every usage (`grep -rn "old.key" Atelier.html view.html app/`).

## Adding a language

1. Copy `app/locales/en.js` to `app/locales/<code>.js` (ISO 639-1, e.g. `fr`), change the header comment, the object key `.<code>` and `_name` (the language's own name: "Français").
2. Translate every value, keeping keys and placeholders.
3. Add `<script src="app/locales/<code>.js"></script>` in **both** `Atelier.html` and `view.html`, after the other locales and before `app/i18n.js`.
4. Mention the new language where the docs list them (root `CLAUDE.md`: "dictionaries (en = reference, it, …)"; README if it lists languages).

## Verify

```
node .github/scripts/check.mjs
```
Then screenshot the UI in the language you touched, e.g. `Atelier.html?p=example&lang=<code>` at 1600×1000 (command in the root CLAUDE.md) and `view.html?p=example&b=welcome&lang=<code>`. Look for strings left as raw keys and for labels too long for the top bar (German and French run ~30% longer than English).

This is program code: work on a branch and open a PR (main is protected). Comments and commit messages in English.
