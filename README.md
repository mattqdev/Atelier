# Atelier

Canvas di design stile Figma, statico e multi-progetto. Ogni tavola è un file HTML (o un'immagine) disposto su un piano infinito con pan, zoom, livelli e selezione.

- **Apri**: doppio clic su `Atelier.html` (funziona da `file://`, niente server né build).
- **Cambia progetto**: menu nella topbar, oppure `Atelier.html?p=<id>`.
- **Comandi**: trascina/scroll per muoverti · ⌘+scroll o pinch per lo zoom · doppio clic zoom sulla tavola · ←/→ sfoglia · Invio apre · Shift+1 vedi tutto · `\` livelli.

## Progetti

```
projects/index.js          registro: window.ATELIER_PROJECTS = [{ id, name }]
projects/<id>/manifest.js  sezioni e tavole del progetto (window.WORKSPACE)
projects/<id>/boards/      tavole HTML
projects/<id>/assets/      css, logo, font
```

I progetti sono locali e non versionati (`projects/*` in `.gitignore`), tranne `projects/example/`. Per crearne uno: copia `projects/example/`, rinomina, registralo in `projects/index.js`. Senza `projects/index.js` Atelier apre il progetto di esempio.
