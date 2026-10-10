"""Render a board with headless Chrome and diff it against the original export.

usage: python3 compare.py <board.html> <original.png> <out_prefix> [--size W H] [--crop x0,y0,x1,y1]

The board is rendered at the original's pixel scale (a 3840 px wide png of a
1920 px board → device scale 2), then compared. Prints the mean absolute
difference (0–255) and the share of pixels off by more than 40, and writes:
  <out_prefix>-render.png  the render
  <out_prefix>-diff.png    the original dimmed, with differing pixels in red
  <out_prefix>-pair.png    (with --crop) original above, render below, for a close look
Transparent originals are composited on black. Red outlines along glyph edges
are antialiasing; solid red areas or whole words mean something is off.
"""
import argparse
import os
import subprocess

from PIL import Image, ImageChops

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

ap = argparse.ArgumentParser()
ap.add_argument("board")
ap.add_argument("original")
ap.add_argument("out")
ap.add_argument("--size", nargs=2, type=int, default=(1920, 1080))
ap.add_argument("--crop")
a = ap.parse_args()

W, H = a.size
src = Image.open(a.original).convert("RGBA")
ref = Image.alpha_composite(Image.new("RGBA", src.size, (0, 0, 0, 255)), src).convert("RGB")
scale = ref.width / W
subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", f"--window-size={W},{H}",
                f"--force-device-scale-factor={scale}", "--virtual-time-budget=8000",
                f"--screenshot={a.out}-render.png", "file://" + os.path.abspath(a.board)], capture_output=True)
ren = Image.open(f"{a.out}-render.png").convert("RGB").resize(ref.size)

d = ImageChops.difference(ren, ref).convert("L")
hist = d.histogram()
n = sum(hist)
print(f"mean abs diff {sum(i * c for i, c in enumerate(hist)) / n:.2f}/255 · pixels off by >40: {sum(hist[40:]) / n * 100:.2f}%")

vis = Image.blend(ref, Image.new("RGB", ref.size), 0.6)
vis.paste(Image.new("RGB", ref.size, (255, 40, 40)), mask=d.point(lambda v: 255 if v > 40 else 0))
vis.resize((max(1, int(ref.width / scale)), max(1, int(ref.height / scale)))).save(f"{a.out}-diff.png")

if a.crop:
    box = tuple(int(float(v) * scale) for v in a.crop.split(","))
    c1, c2 = ref.crop(box), ren.crop(box)
    pair = Image.new("RGB", (c1.width, c1.height * 2 + 6), (255, 0, 255))
    pair.paste(c1, (0, 0))
    pair.paste(c2, (0, c1.height + 6))
    pair.save(f"{a.out}-pair.png")
