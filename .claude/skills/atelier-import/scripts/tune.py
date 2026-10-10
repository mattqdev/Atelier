"""Try several values for one CSS snippet and keep the one closest to the original.

usage: python3 tune.py <board.html> <original.png> <x0,y0,x1,y1> "<exact text in the board>" "<candidate 1>" "<candidate 2>" ...
       [--size W H]

Each candidate replaces the given text in a temporary copy of the board; the
copy is rendered and diffed with the original inside the box (board px). The
mean difference is printed per candidate, best last. Use it for what can't be
read from the source: letter spacing, font weight, a 0.5 px offset, a stroke
width. Example:
  python3 tune.py board.html page-02.png 110,895,1700,930 "letter-spacing: .4px" \
      "letter-spacing: .3px" "letter-spacing: .4px" "letter-spacing: .5px"
"""
import argparse
import os
import subprocess
import tempfile

from PIL import Image, ImageChops

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

ap = argparse.ArgumentParser()
ap.add_argument("board")
ap.add_argument("original")
ap.add_argument("box")
ap.add_argument("old")
ap.add_argument("candidates", nargs="+")
ap.add_argument("--size", nargs=2, type=int, default=(1920, 1080))
a = ap.parse_args()

W, H = a.size
src = open(a.board).read()
if a.old not in src:
    raise SystemExit(f"text not found in the board: {a.old!r}")
orig = Image.open(a.original).convert("RGBA")
ref = Image.alpha_composite(Image.new("RGBA", orig.size, (0, 0, 0, 255)), orig).convert("RGB")
scale = ref.width / W
box = tuple(int(float(v) * scale) for v in a.box.split(","))
ref = ref.crop(box)

results = []
tmp_png = tempfile.mktemp(suffix=".png")
tmp_html = os.path.join(os.path.dirname(os.path.abspath(a.board)), ".__tune.html")  # same folder: relative links keep working
try:
    for cand in a.candidates:
        open(tmp_html, "w").write(src.replace(a.old, cand))
        subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", f"--window-size={W},{H}",
                        f"--force-device-scale-factor={scale}", "--virtual-time-budget=8000",
                        f"--screenshot={tmp_png}", "file://" + tmp_html], capture_output=True)
        ren = Image.open(tmp_png).convert("RGB").resize(orig.size).crop(box)
        h = ImageChops.difference(ren, ref).convert("L").histogram()
        results.append((sum(i * c for i, c in enumerate(h)) / sum(h), cand))
finally:
    for f in (tmp_html, tmp_png):
        if os.path.exists(f):
            os.remove(f)
for score, cand in sorted(results, reverse=True):
    print(f"{score:8.3f}  {cand}")
