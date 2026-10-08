# Atelier

Tool personale di design stile Figma: un canvas HTML statico multi-progetto, mantenuto da Claude. Sostituisce Figma/Paper/Trello. Nessun MCP, nessun build step, nessuna dipendenza (i progetti possono usare Google Fonts).

Si apre con doppio clic su `Atelier.html` (funziona da `file://`). Il menu nella topbar cambia progetto; `Atelier.html?p=<id>` apre un progetto specifico.

## Struttura

```
Atelier.html              → shell del canvas. Non contiene contenuti.
app/app.js|css            → motore (pan/zoom, livelli, selezione, cambio progetto). Toccare solo per nuove funzioni.
app/atelier.svg           → icona dell'app
projects/index.js         → registro progetti: [{ id, name }] (locale, gitignored)
projects/<id>/manifest.js → UNICA fonte di verità su cosa appare sul canvas per quel progetto
projects/<id>/assets/     → css/logo/font del progetto
projects/<id>/boards/     → una tavola = un file HTML standalone
projects/<id>/sources/    → file originali dell'utente (pdf, png…): non modificare
projects/<id>/CLAUDE.md   → regole specifiche del progetto (brand, tono)
projects/example/         → progetto demo, l'unico versionato
```

Il repo GitHub (`mattqdev/atelier`, privato) contiene solo il programma: `projects/*` è in `.gitignore` tranne `example/`.

## Nuovo progetto

1. Copia `projects/example/` in `projects/<id>/` (id = nome cartella, senza spazi).
2. Aggiorna `name` (e `logo` opzionale) nel suo `manifest.js`.
3. Aggiungi `{ id, name }` in `projects/index.js`.
4. Se il progetto ha un brand, crea `assets/brand.css` con i token e `projects/<id>/CLAUDE.md` con le regole.

## Aggiungere una tavola

1. Crea `projects/<id>/boards/<sezione>/<nome>.html` partendo da una tavola esistente dello stesso tipo.
2. Ogni tavola: link al css del progetto con percorso relativo, `@page { size: Wpx Hpx; }`, un solo `<section class="page …">`. CSS specifico in un `<style>` locale.
3. Aggiungi l'item nel manifest (`id`, `title`, `type: "html"|"image"`, `src`, `w`, `h`). `src` è relativo alla cartella del progetto; `w/h` devono coincidere con `@page`.
4. Immagini (png/jpg) si aggiungono direttamente con `type: "image"`, senza file HTML.

Le sezioni si impilano in verticale in ordine; le tavole si affiancano da sinistra a destra. `x`/`y` su una sezione solo se serve una posizione fissa.

## Verifica

Dopo modifiche, screenshot headless per controllare:
```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=W,H --virtual-time-budget=5000 --screenshot=out.png "file://$PWD/<file>.html"
```
Per il workspace intero usare `Atelier.html?p=<id>` con 1600×1000.
