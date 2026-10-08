/* =========================================================
   ESEMPIO — manifest di un progetto Atelier
   Copia questa cartella in projects/<NuovoProgetto>/ e
   registrala in projects/index.js.

   name        → nome del progetto
   logo        → (opz.) immagine mostrata nella topbar
   sections[]  → gruppi impilati dall'alto in basso
     id, title, note?, x?, y?
     items[]   → tavole affiancate da sinistra a destra
       id, title, type: "html" | "image", src, w, h
       status? → "draft" | "review" | "approved" (badge sul canvas)
       rev?    → numero da incrementare quando cambia il file:
                 Atelier ricarica da solo solo quella tavola
   src relativi alla cartella del progetto; per html w/h = @page.
   ========================================================= */
window.WORKSPACE = {
  name: "Esempio",
  sections: [
    {
      id: "intro",
      title: "Benvenuto",
      note: "1080×1350",
      items: [
        { id: "welcome", title: "Benvenuto", type: "html", src: "boards/welcome.html", w: 1080, h: 1350 }
      ]
    }
  ]
};
