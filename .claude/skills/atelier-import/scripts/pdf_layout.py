"""Print the layout of one PDF page extracted by pdf_vectors.swift.

usage: python3 pdf_layout.py <vectors_dir> <page> [--shapes]

Text runs (default): one line per text line with x, baseline, font size,
colour[@opacity] and the text, ready to turn into CSS (see SKILL.md for the
baseline → top formula). Lines of a paragraph after the first have no run of
their own: their baseline is the first one + the PDFKit line spacing.

--shapes: every vector path with its bounding box (control points included,
so curves read slightly large), number of subpaths/segments and paint. Use it
for panels, strokes (a ring of 8 subpaths = a stroke expanded by Figma),
rounded rects (radius = the clip paths in page-N.txt) and icons.
"""
import re
import sys


def shapes(svg):
    for line in svg.splitlines():
        if line.startswith("<!--"):
            print(line)
            continue
        m = re.search(r'd="([^"]*)"', line)
        if not m:
            continue
        n = [float(v) for v in re.findall(r"-?\d+\.\d+", m.group(1))]
        xs, ys = n[0::2], n[1::2]
        paint = re.sub(r'd="[^"]*"', "", line).replace("<path", "").replace("/>", "").strip()
        print(f"[{min(xs):7.1f},{min(ys):7.1f}] {max(xs) - min(xs):7.1f}x{max(ys) - min(ys):6.1f} "
              f"sub={m.group(1).count('M'):3d} segs={len(re.findall('[LC]', m.group(1))):4d} {paint}")


def runs(svg, txt):
    lines = []
    for l in txt.splitlines():
        if l.startswith("--"):
            break
        m = re.match(r"x=([\d.]+) y=([\d.]+) w=([\d.]+) h=([\d.]+) size=([\d.]*) \| (.*)", l)
        if m:
            lines.append((float(m[1]), float(m[2]), float(m[3]), float(m[5] or 0), m[6].rstrip()))
    origins = []
    for p in re.findall(r"<path [^>]*/>", svg):
        d = re.search(r'd="([^"]*)"', p).group(1)
        m = re.match(r"M(-?[\d.]+) (-?[\d.]+) Z", d)
        if m:
            fill = re.search(r'fill="([^"]*)"', p).group(1)
            op = re.search(r'fill-opacity="([^"]*)"', p)
            origins.append((float(m[1]), float(m[2]), fill + (f"@{op.group(1)}" if op else "")))
    for x, y, w, s, t in lines:
        cands = [o for o in origins if abs(o[0] - x) < 1.5 and 0 < o[1] - y < s * 1.2]
        if cands:
            o = min(cands, key=lambda o: o[1] - y)
            print(f"x={x:7.1f} base={o[1]:7.2f} size={s:5.1f} col={o[2]:16s} w={w:7.1f} | {t}")
        else:
            print(f"x={x:7.1f} pdfY={y:7.1f} size={s:5.1f} (follow-on line)  w={w:7.1f} | {t}")


if __name__ == "__main__":
    d, page = sys.argv[1], sys.argv[2]
    svg = open(f"{d}/page-{page}.svg").read()
    if "--shapes" in sys.argv:
        shapes(svg)
    else:
        runs(svg, open(f"{d}/page-{page}.txt").read())
