"""Measure Google Fonts metrics in Chrome, and optionally check text widths.

usage:
  python3 font_metrics.py "Dela Gothic One" "JetBrains Mono:400"
  python3 font_metrics.py "JetBrains Mono:400" --text "01 / BRAND ESSENCE" --size 20 --width 283.9

Prints, per family[:weight], the ascent (A) and normal line height (A + D) as a
fraction of the font size: the numbers the baseline → top formula needs.
With --text/--size/--width it also prints the rendered width and the letter
spacing that would make it match the original width (a match at 0 confirms
the font; a constant gap per character means tracking).
"""
import argparse
import os
import re
import subprocess
import tempfile

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

ap = argparse.ArgumentParser()
ap.add_argument("fonts", nargs="+")
ap.add_argument("--text")
ap.add_argument("--size", type=float, default=100)
ap.add_argument("--width", type=float)
a = ap.parse_args()

fams = [(f.split(":")[0], f.split(":")[1] if ":" in f else "400") for f in a.fonts]
query = "&".join(f"family={n.replace(' ', '+')}:wght@{w}" for n, w in fams)
blocks, probes = "", []
for i, (n, w) in enumerate(fams):
    blocks += (f'<div id="f{i}" style="position:absolute;font:{w} 1000px \'{n}\';line-height:normal">x'
               f'<span id="s{i}" style="display:inline-block;width:1px;height:0"></span></div>')
    if a.text:
        blocks += f'<span id="t{i}" style="position:absolute;white-space:pre;font:{w} {a.size}px \'{n}\'">{a.text}</span>'
    probes.append(f"document.fonts.load(\"{w} 20px '{n}'\")")
script = f"""Promise.all([{','.join(probes)}]).then(()=>{{const o=[];
for(let i=0;i<{len(fams)};i++){{const D=document.getElementById('f'+i).getBoundingClientRect(),B=document.getElementById('s'+i).getBoundingClientRect();
let r='A='+((B.bottom-D.top)/1000).toFixed(4)+' lineheight='+(D.height/1000).toFixed(4);
const t=document.getElementById('t'+i);if(t){{const w=t.getBoundingClientRect().width;r+=' width='+w.toFixed(1);
{f"const n=[...t.textContent].length;r+=' tracking/char='+(({a.width}-w)/Math.max(n-1,1)).toFixed(2)+'px';" if a.width else ""}}}
o.push(r)}}document.title=o.join(' ## ')}});"""
html = (f'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?{query}&display=block">'
        f"<body>{blocks}<script>{script}</script>")
with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
    f.write(html)
out = subprocess.run([CHROME, "--headless=new", "--virtual-time-budget=8000", "--dump-dom", "file://" + f.name],
                     capture_output=True, text=True).stdout
os.unlink(f.name)
title = re.search(r"<title>([^<]*)", out)
for (n, w), r in zip(fams, (title.group(1) if title else "no result").split(" ## ")):
    print(f"{n}:{w}  {r}")
