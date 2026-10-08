# Atelier

Tool personale di design stile Figma: un canvas HTML statico multi-progetto, mantenuto da Claude. Sostituisce Figma/Paper/Trello. Nessun MCP, nessun build step, nessuna dipendenza (i progetti possono usare Google Fonts).

Si apre con doppio clic su `Atelier.html` (funziona da `file://`). Il menu nella topbar cambia progetto; `Atelier.html?p=<id>` apre un progetto specifico.

## Struttura

```
Atelier.html              → shell del canvas. Non contiene contenuti.
app/app.js|css            → motore (pan/zoom, livelli, selezione, cambio progetto). Toccare solo per nuove funzioni.
app/i18n.js               → traduzioni UI: sceglie la lingua e applica i testi
app/locales/<code>.js     → dizionari (en = riferimento, it)
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

## Lingue (i18n)

Nessun testo dell'interfaccia va scritto a mano in `Atelier.html` o `app.js`: usare una chiave.
- HTML: `data-i18n="chiave"` (testo), `data-i18n-title` (tooltip), `data-i18n-html` (markup fidato, es. `<kbd>`).
- JS: `ATELIER_I18N.t('chiave', { var })`, con segnaposto `{var}` nel testo.
- Ogni chiave nuova va aggiunta in **tutti** i file di `app/locales/`; `en.js` è il riferimento (fallback se manca una chiave).
- Lingua scelta: `?lang=<code>` → ultima scelta (localStorage) → lingua del browser → `en`. Menu con il globo nella topbar.
- Nuova lingua: copia `app/locales/en.js` in `<code>.js`, traduci, aggiungi lo `<script>` in `Atelier.html` prima di `app/i18n.js`.

I contenuti dei progetti (tavole, nomi nel manifest) non passano dall'i18n.

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
5. Campi opzionali dell'item: `status: "draft"|"review"|"approved"` (badge sul canvas e nei livelli) e `rev`.

## Live reload

Atelier rilegge `manifest.js` ogni 2 s: modifiche al manifest appaiono da sole, senza ricaricare. Il contenuto di una tavola invece non viene rilevato: **dopo aver modificato un file di tavola, incrementa `rev` del suo item** (es. `rev: 2`) e Atelier ricarica solo quell'iframe. Il pulsante ricarica della topbar ricarica tutte le tavole.

Link: `Atelier.html?p=<id>&b=<itemId>` apre il progetto zoomato su quella tavola (l'URL si aggiorna da solo con la selezione).

Le sezioni si impilano in verticale in ordine; le tavole si affiancano da sinistra a destra. `x`/`y` su una sezione solo se serve una posizione fissa.

## Verifica

Dopo modifiche, screenshot headless per controllare:
```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=W,H --virtual-time-budget=5000 --screenshot=out.png "file://$PWD/<file>.html"
```
Per il workspace intero usare `Atelier.html?p=<id>` con 1600×1000.
