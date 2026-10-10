/* =========================================================
   EXAMPLE — an Atelier project manifest
   Copy this folder to projects/<NewProject>/ and register it
   in projects/index.js.

   name        → project name
   logo        → (optional) image shown in the top bar
   cover       → (optional) item id shown on the projects page card
   sections[]  → groups stacked top to bottom
     id, title, note?, x?, y?
     items[]   → boards placed side by side, left to right
       id, title, type: "html" | "image", src, w, h
       status? → "draft" | "review" | "approved" (badge on the canvas)
       rev?    → number to bump when the file changes:
                 Atelier reloads only that board
   src is relative to the project folder; for html w/h = @page.
   The title is also the file name used by export.
   ========================================================= */
window.WORKSPACE = {
  name: "Example",
  sections: [
    {
      id: "intro",
      title: "Welcome",
      note: "1080×1350",
      items: [
        { id: "welcome", title: "Welcome", type: "html", src: "boards/welcome.html", w: 1080, h: 1350 }
      ]
    }
  ]
};
