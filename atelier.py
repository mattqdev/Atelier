#!/usr/bin/env python3
"""Atelier local server — optional, standard library only.

Serves the Atelier folder on http://localhost and renders exports with
headless Chrome, so PNG/JPG/WEBP/PDF files match the browser pixel for pixel.
Atelier.html keeps working from file:// without it; only export (and
"copy image" in the viewer) needs the server.

    python3 atelier.py              # http://localhost:4747, opens the browser
    python3 atelier.py --port 8000 --no-open
    python3 atelier.py --install-launcher   # one-click app (macOS, Linux, Windows)

Chrome is auto-detected; set ATELIER_CHROME=/path/to/chrome to override.

Endpoints (used by app/export.js):
    GET /__atelier/ping                         → {"export": bool}
    GET /__atelier/render?src=&type=&w=&h=&scale=&format=png|pdf
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
PROJECTS = ROOT / "projects"
MAX_SIDE = 16384  # Chrome/canvas limit per side, in device pixels


def find_chrome():
    env = os.environ.get("ATELIER_CHROME")
    if env:
        return env if Path(env).exists() else None
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


CHROME = find_chrome()
render_lock = threading.Lock()  # one headless Chrome at a time keeps the machine responsive


def run_chrome(cmd, out, timeout=90):
    """Run Chrome until `out` is written. Headless Chrome sometimes lingers
    after writing the file, so stop it once the output stops growing."""
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline, last = time.monotonic() + timeout, -1
    try:
        while proc.poll() is None and time.monotonic() < deadline:
            time.sleep(0.15)
            size = out.stat().st_size if out.exists() else -1
            if size > 0 and size == last:
                break
            last = size
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                proc.kill()


def render(src, kind, w, h, scale, fmt):
    """Render one board with headless Chrome and return the file bytes."""
    with tempfile.TemporaryDirectory(prefix="atelier-") as tmp:
        tmp = Path(tmp)
        if kind == "image":
            # wrap the image in a page the size of the item (same object-fit as the canvas)
            page = tmp / "image.html"
            page.write_text(
                "<!doctype html><meta charset=utf-8><style>"
                f"@page{{size:{w}px {h}px;margin:0}}"
                f"html,body{{margin:0;width:{w}px;height:{h}px;overflow:hidden}}"
                "img{display:block;width:100%;height:100%;object-fit:cover}"
                f"</style><img src=\"{src.as_uri()}\">",
                encoding="utf-8",
            )
            url = page.as_uri()
        else:
            url = src.as_uri()

        out = tmp / ("out.pdf" if fmt == "pdf" else "out.png")
        cmd = [
            CHROME, "--headless=new", "--hide-scrollbars", "--no-first-run",
            "--no-default-browser-check", "--disable-extensions",
            "--virtual-time-budget=5000",
            "--allow-file-access-from-files",
        ]
        if fmt == "pdf":
            cmd += ["--no-pdf-header-footer", f"--print-to-pdf={out}"]
        else:
            cmd += [f"--window-size={w},{h}", f"--force-device-scale-factor={scale}",
                    f"--screenshot={out}"]
        cmd.append(url)
        with render_lock:
            run_chrome(cmd, out)
        if not out.exists():
            raise RuntimeError("Chrome produced no output")
        return out.read_bytes()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # live reload depends on always reading fresh files
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/__atelier/render"):
            sys.stderr.write("render %s\n" % self.path)

    def send_bytes(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def fail(self, code, msg):
        self.send_bytes(code, json.dumps({"error": msg}).encode(), "application/json")

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/__atelier/ping":
            return self.send_bytes(200, json.dumps({"export": bool(CHROME)}).encode(), "application/json")
        if url.path == "/__atelier/render":
            return self.handle_render(parse_qs(url.query))
        return super().do_GET()

    def handle_render(self, q):
        if not CHROME:
            return self.fail(501, "Chrome not found (set ATELIER_CHROME)")
        arg = lambda k, d=None: q.get(k, [d])[0]
        try:
            src = (ROOT / arg("src", "")).resolve()
            w, h = int(arg("w")), int(arg("h"))
            scale = float(arg("scale", "1"))
            fmt = arg("format", "png")
            kind = arg("type", "html")
        except (TypeError, ValueError):
            return self.fail(400, "bad parameters")
        if PROJECTS not in src.parents or not src.is_file():
            return self.fail(404, "board not found")
        if fmt not in ("png", "pdf") or not (0 < w and 0 < h and 0 < scale <= 16):
            return self.fail(400, "bad parameters")
        if fmt == "png" and max(w, h) * scale > MAX_SIDE:
            return self.fail(400, f"image too large (max {MAX_SIDE}px per side)")
        try:
            body = render(src, kind, w, h, scale, fmt)
        except Exception as e:  # noqa: BLE001 — report any Chrome failure to the UI
            return self.fail(500, str(e))
        self.send_bytes(200, body, "application/pdf" if fmt == "pdf" else "image/png")


def is_running(port):
    """True when an Atelier server already answers on `port`."""
    try:
        with urlopen(f"http://127.0.0.1:{port}/__atelier/ping", timeout=1) as r:
            return "export" in json.loads(r.read())
    except (OSError, ValueError):
        return False


LAUNCHER_SCRIPT = """#!/bin/bash
# Generated by `atelier.py --install-launcher`: starts the server if needed and opens Atelier.
PING="http://127.0.0.1:{port}/__atelier/ping"
if ! curl -fs -m 1 "$PING" >/dev/null; then
  nohup {python} {script} --port {port} --no-open >"$HOME/Library/Logs/Atelier.log" 2>&1 &
  disown
  for _ in $(seq 50); do curl -fs -m 1 "$PING" >/dev/null && break; sleep 0.1; done
fi
open "http://localhost:{port}/Atelier.html"
"""

INFO_PLIST = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Atelier</string>
  <key>CFBundleDisplayName</key><string>Atelier</string>
  <key>CFBundleIdentifier</key><string>local.atelier.launcher</string>
  <key>CFBundleExecutable</key><string>Atelier</string>
  <key>CFBundleIconFile</key><string>Atelier</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
"""

DESKTOP_ENTRY = """[Desktop Entry]
Type=Application
Name=Atelier
Comment=Atelier design canvas
Exec={python} {script} --port {port}
Icon={icon}
Terminal=false
Categories=Graphics;Development;
"""


def install_launcher(port):
    """Create a one-click launcher bound to this checkout and this Python."""
    import shlex
    q = lambda p: shlex.quote(str(p))
    script, python = ROOT / "atelier.py", Path(sys.executable)
    if sys.platform == "darwin":
        app = Path.home() / "Applications" / "Atelier.app"
        macos, res = app / "Contents" / "MacOS", app / "Contents" / "Resources"
        macos.mkdir(parents=True, exist_ok=True)
        res.mkdir(parents=True, exist_ok=True)
        exe = macos / "Atelier"
        exe.write_text(LAUNCHER_SCRIPT.format(python=q(python), script=q(script), port=port))
        exe.chmod(0o755)
        (app / "Contents" / "Info.plist").write_text(INFO_PLIST)
        with tempfile.TemporaryDirectory() as tmp:  # icns from the 1024px brand render
            iconset, src = Path(tmp) / "Atelier.iconset", ROOT / "docs" / "brand" / "app-icon-1024.png"
            iconset.mkdir()
            for s in (16, 32, 128, 256, 512):
                for name, px in ((f"icon_{s}x{s}.png", s), (f"icon_{s}x{s}@2x.png", s * 2)):
                    subprocess.run(["sips", "-z", str(px), str(px), str(src), "--out", str(iconset / name)],
                                   check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(res / "Atelier.icns")], check=True)
        app.touch()  # refresh the Finder icon cache
        print(f"Installed {app}\nDrag it to the Dock, or find it with Spotlight.")
    elif sys.platform.startswith("linux"):
        entry = Path.home() / ".local" / "share" / "applications" / "atelier.desktop"
        entry.parent.mkdir(parents=True, exist_ok=True)
        entry.write_text(DESKTOP_ENTRY.format(python=q(python), script=q(script), port=port,
                                              icon=ROOT / "app" / "atelier.svg"))
        print(f"Installed {entry}\nAtelier now appears in your applications menu.")
    elif sys.platform == "win32":
        # Start Menu shortcut running pythonw (no console window); the paths travel as
        # environment variables so PowerShell never has to parse them.
        pythonw = python.with_name("pythonw.exe")
        link = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Atelier.lnk"
        ps = ("$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:A_LINK); "
              "$s.TargetPath = $env:A_EXE; $s.Arguments = $env:A_ARGS; "
              "$s.WorkingDirectory = $env:A_ROOT; $s.IconLocation = $env:A_ICON; $s.Save()")
        env = dict(os.environ, A_LINK=str(link), A_EXE=str(pythonw if pythonw.exists() else python),
                   A_ARGS=f'"{script}" --port {port}', A_ROOT=str(ROOT), A_ICON=str(ROOT / "app" / "atelier.ico"))
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True, env=env)
        print(f"Installed {link}\nAtelier now appears in the Start menu (pin it to the taskbar from there).")
    else:
        sys.exit(f"--install-launcher doesn't support {sys.platform}; run `python3 atelier.py` instead.")


def main():
    ap = argparse.ArgumentParser(description="Atelier local server")
    ap.add_argument("--port", type=int, default=4747)
    ap.add_argument("--no-open", action="store_true", help="don't open the browser")
    ap.add_argument("--install-launcher", action="store_true",
                    help="create a one-click Atelier app for this folder (macOS, Linux, Windows)")
    args = ap.parse_args()
    if sys.stdout:  # None under pythonw; Windows consoles may not encode "→"
        sys.stdout.reconfigure(errors="replace")

    if args.install_launcher:
        return install_launcher(args.port)

    url = f"http://localhost:{args.port}/Atelier.html"
    if is_running(args.port):  # second launch: reuse the running server
        print(f"Atelier already running → {url}")
        if not args.no_open:
            webbrowser.open(url)
        return

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Atelier → {url}")
    print("Export: " + (CHROME or "unavailable — Chrome not found, set ATELIER_CHROME"))
    print("Ctrl+C to stop")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
