# Atelier

Canvas di design stile Figma, statico e multi-progetto. Ogni tavola è un file HTML (o un'immagine) disposto su un piano infinito con pan, zoom, livelli e selezione.

- **Apri**: doppio clic su `Atelier.html` (funziona da `file://`, niente server né build).
- **Cambia progetto**: menu nella topbar, oppure `Atelier.html?p=<id>`.
- **Comandi**: trascina/scroll per muoverti · ⌘+scroll o pinch per lo zoom · doppio clic zoom sulla tavola · ←/→ sfoglia · Invio apre · Shift+1 vedi tutto · Shift+2 zoom sulla selezione · `\` livelli.
- **Link a una tavola**: `Atelier.html?p=<id>&b=<itemId>` (l'URL segue la selezione).
- **Live reload**: il manifest viene riletto ogni 2 s; incrementa `rev` su un item per ricaricarne la tavola.

## Progetti

```
projects/index.js          registro: window.ATELIER_PROJECTS = [{ id, name }]
projects/<id>/manifest.js  sezioni e tavole del progetto (window.WORKSPACE)
projects/<id>/boards/      tavole HTML
projects/<id>/assets/      css, logo, font
```

I progetti sono locali e non versionati (`projects/*` in `.gitignore`), tranne `projects/example/`. Per crearne uno: copia `projects/example/`, rinomina, registralo in `projects/index.js`. Senza `projects/index.js` Atelier apre il progetto di esempio.
