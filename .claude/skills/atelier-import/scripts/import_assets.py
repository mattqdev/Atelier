#!/usr/bin/env python3
"""Turn a folder of exported design assets into an Atelier project.

Stdlib only. Scans the given files/folders/zips for png, jpg, gif, webp and
svg files, reads their pixel size, copies them into projects/<id>/sources/
and writes a manifest with one image board per asset.

  python3 import_assets.py <id> <path> [<path>...] [--name "Name"]
          [--scale auto|N] [--group folder|size|flat] [--root DIR]
          [--dry-run] [--force]

--scale auto   reads Figma-style suffixes (Home@2x.png → scale 2), else 1
--group folder one section per subfolder (Figma turns "Page/Frame" names
               into folders), root files in one section; size → one section
               per board size; flat → a single section
--force        overwrite an existing manifest.js (sources are merged)

Prints a JSON report on stdout (boards, skipped files, warnings).
"""
import argparse
import json
import re
import shutil
import struct
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
# when the same asset comes in several formats, keep the most faithful one
FORMAT_RANK = {".svg": 0, ".png": 1, ".webp": 2, ".gif": 3, ".jpg": 4, ".jpeg": 4}
SCALE_RE = re.compile(r"@(\d+(?:\.\d+)?)x$", re.I)
SKIP_NAMES = {".DS_Store", "Thumbs.db"}


def image_size(p: Path):
    """Pixel size of a png/jpg/gif/webp, or the declared size of an svg."""
    b = p.read_bytes()
    if b[1:4] == b"PNG":
        return struct.unpack(">II", b[16:24])
    if b[:3] == b"GIF":
        return struct.unpack("<HH", b[6:10])
    if b[:2] == b"\xff\xd8":
        i = 2
        while i < len(b) - 9:
            if b[i] != 0xFF:
                i += 1
                continue
            m = b[i + 1]
            ln = struct.unpack(">H", b[i + 2:i + 4])[0]
            if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", b[i + 5:i + 9])
                return w, h
            i += 2 + ln
        return None
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        k = b[12:16]
        if k == b"VP8X":
            return 1 + int.from_bytes(b[24:27], "little"), 1 + int.from_bytes(b[27:30], "little")
        if k == b"VP8L":
            n = int.from_bytes(b[21:25], "little")
            return 1 + (n & 0x3FFF), 1 + ((n >> 14) & 0x3FFF)
        if k == b"VP8 ":
            w, h = struct.unpack("<HH", b[26:30])
            return w & 0x3FFF, h & 0x3FFF
        return None
    s = b[:8192].decode("utf-8", "ignore")
    tag = re.search(r"<svg\b[^>]*>", s, re.I | re.S)
    if tag:
        t = tag.group(0)
        w = re.search(r'\swidth=["\']\s*([\d.]+)(px)?\s*["\']', t)
        h = re.search(r'\sheight=["\']\s*([\d.]+)(px)?\s*["\']', t)
        if w and h:
            return round(float(w.group(1))), round(float(h.group(1)))
        vb = re.search(r'viewBox=["\']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)', t)
        if vb:
            return round(float(vb.group(1))), round(float(vb.group(2)))
    return None


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "asset"


def natural(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def collect(paths, tmp: Path):
    """Yield (file, path relative to the source root) for every input file."""
    for raw in paths:
        p = Path(raw).expanduser()
        if p.suffix.lower() == ".zip" and p.is_file():
            out = tmp / slug(p.stem)
            with zipfile.ZipFile(p) as z:
                for m in z.infolist():
                    # refuse absolute paths and parent traversal inside the archive
                    if m.is_dir() or m.filename.startswith("/") or ".." in Path(m.filename).parts:
                        continue
                    z.extract(m, out)
            # a zip that wraps everything in one folder: start inside it
            top = [c for c in out.iterdir() if c.name != "__MACOSX" and not c.name.startswith(".")]
            p = top[0] if len(top) == 1 and top[0].is_dir() else out
        if p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and not any(x.startswith(".") or x == "__MACOSX" for x in f.relative_to(p).parts):
                    yield f, f.relative_to(p)
        elif p.is_file():
            yield p, Path(p.name)
        else:
            print(f"not found: {raw}", file=sys.stderr)


def js(v):
    return json.dumps(v, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("id")
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--name")
    ap.add_argument("--scale", default="auto")
    ap.add_argument("--group", choices=["folder", "size", "flat"], default="folder")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[4]))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    root = Path(a.root).resolve()
    if not (root / "Atelier.html").exists():
        sys.exit(f"{root} is not an Atelier folder (no Atelier.html)")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", a.id):
        sys.exit("project id: letters, digits, - and _ only")
    proj = root / "projects" / a.id
    if (proj / "manifest.js").exists() and not a.force and not a.dry_run:
        sys.exit(f"projects/{a.id}/manifest.js exists: pass --force to replace it")
    name = a.name or a.id

    report = {"project": a.id, "boards": [], "skipped": [], "warnings": []}
    tmp = Path(tempfile.mkdtemp(prefix="atelier-import-"))
    try:
        # ---- scan ----
        found = {}  # (folder, base name) → candidates
        for f, rel in collect(a.paths, tmp):
            ext = f.suffix.lower()
            if f.name in SKIP_NAMES:
                continue
            if ext not in IMAGE_EXT:
                report["skipped"].append({"file": str(rel), "reason": "pdf: render its pages to png first" if ext == ".pdf" else f"unsupported type {ext or '(none)'}"})
                continue
            size = image_size(f)
            if not size or not all(size):
                report["skipped"].append({"file": str(rel), "reason": "could not read the size"})
                continue
            stem = f.stem
            m = SCALE_RE.search(stem)
            scale = float(m.group(1)) if m else 1.0
            if m:
                stem = stem[:m.start()]
            if a.scale != "auto":
                scale = float(a.scale)
            folder = rel.parent.as_posix() if rel.parent != Path(".") else ""
            found.setdefault((folder, stem), []).append(
                {"file": f, "rel": rel, "ext": ext, "px": size, "scale": scale})

        # ---- one board per asset: drop duplicates (other scales / formats) ----
        assets = []
        for (folder, stem), cands in found.items():
            cands.sort(key=lambda c: (FORMAT_RANK[c["ext"]], -c["px"][0] * c["px"][1]))
            best = cands[0]
            for c in cands[1:]:
                report["skipped"].append({"file": str(c["rel"]), "reason": f"duplicate of {best['rel']}"})
            w = round(best["px"][0] / best["scale"])
            h = round(best["px"][1] / best["scale"])
            if best["ext"] != ".svg" and (best["px"][0] / best["scale"]) % 1:
                report["warnings"].append(f"{best['rel']}: {best['px'][0]}px / @{best['scale']:g}x is not whole, rounded to {w}")
            assets.append({**best, "folder": folder, "title": stem.strip(), "w": w, "h": h})

        if not assets:
            sys.exit("no images found")

        # ---- sections ----
        def key(x):
            if a.group == "size":
                return f"{x['w']}×{x['h']}"
            if a.group == "flat":
                return ""
            return x["folder"]
        groups = {}
        for x in sorted(assets, key=lambda x: (natural(x["folder"]), natural(x["title"]))):
            groups.setdefault(key(x), []).append(x)

        sections, used_src, used_ids = [], set(), set()

        def unique(base, used):
            k, n = base, 2
            while k in used:
                k, n = f"{base}-{n}", n + 1
            used.add(k)
            return k

        for g, items in groups.items():
            title = g.split("/")[-1] if g else name
            sizes = sorted({(x["w"], x["h"]) for x in items})
            note = f"{len(items)} boards · " if len(items) > 1 else ""
            note += f"{sizes[0][0]}×{sizes[0][1]}" if len(sizes) == 1 else "mixed sizes"
            sec = {"id": unique(slug(g or name), used_ids), "title": title, "note": note, "items": []}
            for x in items:
                sub = "/".join(slug(p) for p in x["folder"].split("/")) if x["folder"] else ""
                src = unique(f"sources/{sub + '/' if sub else ''}{slug(x['title'])}{x['ext'].replace('.jpeg', '.jpg')}", used_src)
                item = {"id": unique(slug(x["title"]), used_ids), "title": x["title"], "type": "image",
                        "src": src, "w": x["w"], "h": x["h"]}
                sec["items"].append(item)
                report["boards"].append({**item, "from": str(x["rel"]), "px": list(x["px"]), "scale": x["scale"]})
                x["dest"] = proj / src
            sections.append(sec)

        if a.dry_run:
            print(json.dumps(report, indent=2, ensure_ascii=False))
            return

        # ---- write ----
        for x in assets:
            x["dest"].parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(x["file"], x["dest"])
        for d in ("assets", "boards"):
            (proj / d).mkdir(parents=True, exist_ok=True)

        lines = ["/* =========================================================",
                 f"   {name.upper()} — imported from exported design files.",
                 "   One image board per asset; originals copied to sources/.",
                 f"   Paths are relative to projects/{a.id}/.",
                 "   ========================================================= */",
                 "window.WORKSPACE = {", f"  name: {js(name)},", "  sections: ["]
        for si, s in enumerate(sections):
            tw = max(len(js(i["title"])) for i in s["items"])
            lines += ["    {", f"      id: {js(s['id'])},", f"      title: {js(s['title'])},",
                      f"      note: {js(s['note'])},", "      items: ["]
            for ii, i in enumerate(s["items"]):
                t = (js(i["title"]) + ",").ljust(tw + 1)
                lines.append(f"        {{ id: {js(i['id'])}, title: {t} type: \"image\", src: {js(i['src'])}, "
                             f"w: {i['w']}, h: {i['h']} }}" + ("," if ii < len(s["items"]) - 1 else ""))
            lines += ["      ]", "    }" + ("," if si < len(sections) - 1 else "")]
        lines += ["  ]", "};", ""]
        (proj / "manifest.js").write_text("\n".join(lines), encoding="utf-8")

        # ---- register ----
        idx = root / "projects" / "index.js"
        entry = f"  {{ id: {js(a.id)}, name: {js(name)} }}"
        if not idx.exists():
            idx.write_text("/* Atelier project registry (local, not versioned). */\n"
                           f"window.ATELIER_PROJECTS = [\n{entry}\n];\n", encoding="utf-8")
        else:
            src = idx.read_text(encoding="utf-8")
            if not re.search(r"id:\s*[\"']" + re.escape(a.id) + r"[\"']", src):
                head, sep, tail = src.rpartition("];")
                if not sep:
                    report["warnings"].append("projects/index.js: could not find '];', register the project by hand")
                else:
                    head = head.rstrip()
                    comma = "" if head.endswith("[") or head.endswith(",") else ","
                    idx.write_text(f"{head}{comma}\n{entry}\n{sep}{tail}", encoding="utf-8")
        print(json.dumps(report, indent=2, ensure_ascii=False))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
