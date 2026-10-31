#!/usr/bin/env python3
"""Atelier local server — optional, standard library only.

Serves the Atelier folder on http://localhost and renders exports with
headless Chrome, so PNG/JPG/WEBP/PDF files match the browser pixel for pixel.
One Chrome is started on demand and kept running (driven through the DevTools
protocol), so each board renders in a fresh tab in well under a second.
Atelier.html keeps working from file:// without it; only export (and
"copy image" in the viewer) needs the server.

It also renders the canvas thumbnails (projects/<id>/.thumbs/<item>@<rev>.webp):
on demand while the canvas is served, or in one go with --thumbs, so the
canvas opened from file:// finds them too.

    python3 atelier.py              # http://localhost:4747, opens the browser
    python3 atelier.py --port 8000 --no-open
    python3 atelier.py --thumbs NextWave    # (re)build missing/outdated thumbnails; no id = every project
    python3 atelier.py --install-launcher   # one-click app (macOS, Linux, Windows)

Chrome is auto-detected; set ATELIER_CHROME=/path/to/chrome to override.

Endpoints (used by app/export.js):
    GET /__atelier/ping                         → {"export": bool}, warms Chrome up
    GET /__atelier/render?src=&type=&w=&h=&scale=&format=png|jpg|webp|pdf&quality=
        src/type/w/h repeated → one PDF with a page per board
    GET /__atelier/sheet?src=&type=&w=&h=[&pdf=1] → page wrapping images / several boards
    POST /__atelier/save?base=projects/<id>/&dir=&name=  (body = file) → {"path"}
        keeps a copy of every export in projects/<id>/exports/<dir>/
    GET /__atelier/thumb?base=projects/<id>/&id=&rev=&src=&type=&w=&h= → webp (used by app/app.js)
        cached in projects/<id>/.thumbs/, re-rendered when the board file is newer
"""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
PROJECTS = ROOT / "projects"
MAX_SIDE = 16384  # Chrome/canvas limit per side, in device pixels
THUMB = 640       # longest side of a canvas thumbnail, in pixels (same value in app/app.js)


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
PORT = 4747  # set in main(); the renderer loads boards from this server
PROFILE = Path(tempfile.gettempdir()) / "atelier-chrome"  # its cache keeps web fonts across restarts


class WebSocket:
    """Minimal blocking WebSocket client (RFC 6455), enough to talk to Chrome DevTools."""

    def __init__(self, url, timeout=60):
        u = urlparse(url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\n"
                           "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        self.buf = b""
        while b"\r\n\r\n" not in self.buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("DevTools handshake failed")
            self.buf += chunk
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError("DevTools refused the connection")

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(max(65536, n - len(self.buf)))
            if not chunk:
                raise ConnectionError("DevTools connection closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, text):
        data, mask = text.encode(), os.urandom(4)
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else
                                struct.pack("!BH", 0x80 | 126, n) if n < 65536 else
                                struct.pack("!BQ", 0x80 | 127, n))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        msg = b""
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self._read(8))[0]
            data = self._read(n)  # server frames are never masked
            op = b0 & 0x0F
            if op == 8:
                raise ConnectionError("DevTools connection closed")
            if op in (0, 1, 2):
                msg += data
                if b0 & 0x80:
                    return msg.decode()

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class Browser:
    """One headless Chrome kept alive for the whole session, driven through the
    DevTools protocol. Launching Chrome costs seconds; a new tab costs ~50 ms,
    and several tabs render in parallel."""

    def __init__(self):
        self.proc, self.endpoint, self.lock = None, None, threading.Lock()
        self.size = max(2, min(6, (os.cpu_count() or 4) // 2))  # tabs rendering at once
        self.slots = threading.Semaphore(self.size)

    def start(self):
        with self.lock:
            if self.proc and self.proc.poll() is None:
                return self.endpoint
            try:
                self.endpoint = self._launch(PROFILE)
            except RuntimeError:  # profile busy (another Atelier server): use a throwaway one
                self.endpoint = self._launch(tempfile.mkdtemp(prefix="atelier-chrome-"))
            return self.endpoint

    def _launch(self, profile):
        """Start Chrome on `profile` and return its DevTools host:port."""
        proc = self.proc = subprocess.Popen(
            [CHROME, "--headless=new", "--hide-scrollbars", "--no-first-run",
             "--no-default-browser-check", "--disable-extensions", "--mute-audio",
             "--remote-debugging-port=0", f"--user-data-dir={profile}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors="replace")
        found = []

        def read_stderr():  # also drains stderr so Chrome never blocks on it
            for line in proc.stderr:
                m = re.search(r"DevTools listening on ws://([^/\s]+)/", line)
                if m and not found:
                    found.append(m.group(1))
        threading.Thread(target=read_stderr, daemon=True).start()
        deadline = time.monotonic() + 20
        while not found and proc.poll() is None and time.monotonic() < deadline:
            time.sleep(0.05)
        if not found:
            self.stop()
            raise RuntimeError("Chrome did not start")
        return found[0]

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = None

    def warm(self):
        threading.Thread(target=lambda: self._try(self.start), daemon=True).start()

    @staticmethod
    def _try(fn):
        try:
            fn()
        except Exception:  # noqa: BLE001 — warm-up is best effort
            pass

    def render(self, url, w, h, scale, fmt, quality=90, timeout=60):
        with self.slots:
            try:
                return self._render(self.start(), url, w, h, scale, fmt, quality, timeout)
            except (OSError, ConnectionError):
                self.stop()  # Chrome crashed or hung: restart once
                return self._render(self.start(), url, w, h, scale, fmt, quality, timeout)

    def evaluate(self, url, expression, timeout=30):
        """Load url in a fresh tab and return the (JSON) value of expression."""
        def run(call):
            call("Page.enable")
            call("Page.navigate", "Page.loadEventFired", url=url)
            res = call("Runtime.evaluate", awaitPromise=True, returnByValue=True, expression=expression)
            if "exceptionDetails" in res:
                raise RuntimeError(res["exceptionDetails"].get("text", "evaluation failed"))
            return res["result"].get("value")
        with self.slots:
            return self._tab(self.start(), timeout, run)

    def _render(self, endpoint, url, w, h, scale, fmt, quality, timeout):
        def run(call):
            call("Page.enable")
            call("Emulation.setDeviceMetricsOverride", width=w, height=h,
                 deviceScaleFactor=scale if fmt != "pdf" else 1, mobile=False)
            call("Page.navigate", "Page.loadEventFired", url=url)
            # wait for web fonts and images (iframes included), finish CSS animations, let it paint
            call("Runtime.evaluate", awaitPromise=True, expression=SETTLE_JS)
            if fmt == "pdf":
                res = call("Page.printToPDF", printBackground=True, preferCSSPageSize=True,
                           marginTop=0, marginBottom=0, marginLeft=0, marginRight=0,
                           displayHeaderFooter=False, transferMode="ReturnAsBase64")
            else:
                shot = {"format": "jpeg" if fmt == "jpg" else fmt}
                if fmt != "png":
                    shot["quality"] = quality
                res = call("Page.captureScreenshot", **shot)
            return base64.b64decode(res["data"])
        return self._tab(endpoint, timeout, run)

    @staticmethod
    def _tab(endpoint, timeout, run):
        """Open a tab, hand run() a DevTools `call` for it, close the tab."""
        req = Request(f"http://{endpoint}/json/new?about:blank", method="PUT")
        with urlopen(req, timeout=10) as r:
            target = json.loads(r.read())
        ws = WebSocket(target["webSocketDebuggerUrl"], timeout)
        ids = iter(range(1, 1 << 30))

        def call(method, wait_event=None, **params):
            """Send a command; with wait_event, also wait for that event (before or after the reply)."""
            i, result, seen = next(ids), None, not wait_event
            ws.send(json.dumps({"id": i, "method": method, "params": params}))
            while result is None or not seen:
                m = json.loads(ws.recv())
                if m.get("id") == i:
                    if "error" in m:
                        raise RuntimeError(f"{method}: {m['error'].get('message')}")
                    result = m.get("result", {})
                elif m.get("method") == wait_event:
                    seen = True
            return result

        try:
            return run(call)
        finally:
            ws.close()
            try:
                urlopen(f"http://{endpoint}/json/close/{target['id']}", timeout=5).close()
            except OSError:
                pass


SETTLE_JS = """(async () => {
  const docs = [document];
  for (const f of document.querySelectorAll('iframe')) try { f.contentDocument && docs.push(f.contentDocument); } catch {}
  await Promise.all(docs.map(d => d.fonts && d.fonts.ready));
  await Promise.all(docs.flatMap(d => [...d.images].map(i => i.decode().catch(() => {}))));
  for (const d of docs) for (const a of d.getAnimations?.() || []) try { a.finish(); } catch {}
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
})()"""

BROWSER = Browser()


def sheet_html(items, pdf):
    """Page wrapping one or more items: images get the canvas' object-fit, several
    boards become one PDF with one page per board, each at its own size."""
    css = ["html,body{margin:0;background:transparent}",
           "iframe,img{display:block;border:0;break-after:page}",
           "img{object-fit:cover}"]
    body = []
    for n, (src, kind, w, h) in enumerate(items):
        css.append(f"@page p{n}{{size:{w}px {h}px;margin:0}}")
        style = f"width:{w}px;height:{h}px;page:p{n}"
        url = "/" + quote(src)
        body.append(f'<img src="{url}" style="{style}">' if kind == "image" else
                    f'<iframe src="{url}" style="{style}" scrolling="no"></iframe>')
    if len(items) == 1 and not pdf:
        css.append("html,body{overflow:hidden}")
    return ("<!doctype html><meta charset=utf-8><style>" + "".join(css) + "</style>" + "".join(body))


# window.WORKSPACE of the manifest.js the tab has open (as text)
MANIFEST_JS = """(() => { const window = {}; new Function('window', document.body.innerText)(window);
  return window.WORKSPACE; })()"""


def file_key(v):
    """Item id / rev as a file name part (same rule as fileKey in app/app.js)."""
    return re.sub(r"[^A-Za-z0-9_.-]", "_", str(v))


def board_url(src, kind, w, h):
    base = f"http://127.0.0.1:{PORT}/"
    if kind == "html":
        return base + quote(src)
    return base + "__atelier/sheet?" + urlencode([("src", src), ("type", kind), ("w", w), ("h", h), ("pdf", 0)])


def make_thumb(project, item_id, rev, src, kind, w, h):
    """Path of the item's thumbnail, rendered unless a newer one than the board file exists.
    Returns (path, rendered)."""
    out = project / ".thumbs" / f"{file_key(item_id)}@{file_key(rev)}.webp"
    if out.exists() and out.stat().st_mtime >= (ROOT / src).stat().st_mtime:
        return out, False
    body = BROWSER.render(board_url(src, kind, w, h), w, h, THUMB / max(w, h), "webp", 82)
    out.parent.mkdir(exist_ok=True)
    for old in out.parent.glob(f"{file_key(item_id)}@*.webp"):  # other revs are outdated
        old.unlink(missing_ok=True)
    tmp = out.with_name(out.name + f".{threading.get_ident()}.tmp")
    tmp.write_bytes(body)
    tmp.replace(out)
    return out, True


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
            if CHROME:
                BROWSER.warm()  # the export dialog is opening: start Chrome now
            return self.send_bytes(200, json.dumps({"export": bool(CHROME)}).encode(), "application/json")
        if url.path == "/__atelier/render":
            return self.handle_render(parse_qs(url.query))
        if url.path == "/__atelier/thumb":
            return self.handle_thumb(parse_qs(url.query))
        if url.path == "/__atelier/sheet":
            q = parse_qs(url.query)
            try:
                items = self.items(q)
            except LookupError as e:
                return self.fail(404, str(e))
            except ValueError:
                return self.fail(400, "bad parameters")
            return self.send_bytes(200, sheet_html(items, q.get("pdf") == ["1"]).encode(), "text/html; charset=utf-8")
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/__atelier/save":
            return self.fail(404, "not found")
        q = parse_qs(url.query)
        arg = lambda k: q.get(k, [""])[0]
        clean = lambda v: re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "-", v).strip(" .")
        project = (ROOT / arg("base")).resolve()
        folder, name = clean(arg("dir")), clean(arg("name"))
        if project.parent != PROJECTS or not project.is_dir():
            return self.fail(404, "project not found")
        if not folder or not name:
            return self.fail(400, "bad parameters")
        try:
            size = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self.fail(411, "length required")
        out = project / "exports" / folder / name
        out.parent.mkdir(parents=True, exist_ok=True)
        stem, ext, n = out.stem, out.suffix, 1
        while out.exists():  # never overwrite an earlier export
            n += 1
            out = out.with_name(f"{stem} ({n}){ext}")
        with open(out, "wb") as f:
            left = size
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        if left > 0:
            out.unlink(missing_ok=True)
            return self.fail(400, "upload interrupted")
        self.send_bytes(200, json.dumps({"path": out.relative_to(ROOT).as_posix()}).encode(), "application/json")

    @staticmethod
    def items(q):
        """[(src, type, w, h)] from repeated src/type/w/h parameters; src stays inside projects/."""
        srcs, n = q.get("src", []), len(q.get("src", []))
        kinds = q.get("type", ["html"] * n)
        ws, hs = q.get("w", []), q.get("h", [])
        if not n or not (len(kinds) == len(ws) == len(hs) == n):
            raise ValueError
        out = []
        for src, kind, w, h in zip(srcs, kinds, ws, hs):
            path = (ROOT / src).resolve()
            if PROJECTS not in path.parents or not path.is_file():
                raise LookupError("board not found")
            w, h = int(w), int(h)
            if not (0 < w <= MAX_SIDE and 0 < h <= MAX_SIDE) or kind not in ("html", "image"):
                raise ValueError
            out.append((path.relative_to(ROOT).as_posix(), kind, w, h))
        return out

    def handle_render(self, q):
        if not CHROME:
            return self.fail(501, "Chrome not found (set ATELIER_CHROME)")
        arg = lambda k, d=None: q.get(k, [d])[0]
        try:
            items = self.items(q)
            scale = float(arg("scale", "1"))
            quality = int(arg("quality", "90"))
            fmt = arg("format", "png")
        except LookupError as e:
            return self.fail(404, str(e))
        except (TypeError, ValueError):
            return self.fail(400, "bad parameters")
        if fmt not in ("png", "jpg", "webp", "pdf") or not (0 < scale <= 16 and 1 <= quality <= 100):
            return self.fail(400, "bad parameters")
        if len(items) > 1 and fmt != "pdf":
            return self.fail(400, "several boards only make one PDF")
        src, kind, w, h = items[0]
        if fmt != "pdf" and max(w, h) * scale > MAX_SIDE:
            return self.fail(400, f"image too large (max {MAX_SIDE}px per side)")
        base = f"http://127.0.0.1:{PORT}/"
        if len(items) == 1 and kind == "html":
            url = base + quote(src)
        else:
            sheet = [("src", i[0]) for i in items] + [("type", i[1]) for i in items] + \
                    [("w", i[2]) for i in items] + [("h", i[3]) for i in items]
            url = base + "__atelier/sheet?" + urlencode(sheet + [("pdf", int(fmt == "pdf"))])
        try:
            body = BROWSER.render(url, w, h, scale, fmt, quality)
        except Exception as e:  # noqa: BLE001 — report any Chrome failure to the UI
            return self.fail(500, str(e))
        mime = {"pdf": "application/pdf", "jpg": "image/jpeg", "webp": "image/webp"}.get(fmt, "image/png")
        self.send_bytes(200, body, mime)


    def handle_thumb(self, q):
        if not CHROME:
            return self.fail(501, "Chrome not found (set ATELIER_CHROME)")
        arg = lambda k: q.get(k, [""])[0]
        project = (ROOT / arg("base")).resolve()
        if project.parent != PROJECTS or not project.is_dir():
            return self.fail(404, "project not found")
        try:
            (src, kind, w, h), = self.items(q)
        except LookupError as e:
            return self.fail(404, str(e))
        except ValueError:
            return self.fail(400, "bad parameters")
        if not arg("id"):
            return self.fail(400, "bad parameters")
        try:
            path, _ = make_thumb(project, arg("id"), arg("rev") or "0", src, kind, w, h)
        except Exception as e:  # noqa: BLE001 — the canvas falls back to the live board
            return self.fail(500, str(e))
        self.send_bytes(200, path.read_bytes(), "image/webp")


def build_thumbs(ids):
    """--thumbs: render every missing or outdated thumbnail of the given projects
    (all of them when ids is empty) and remove the ones of deleted boards."""
    if not CHROME:
        sys.exit("Chrome not found (set ATELIER_CHROME)")
    global PORT
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    PORT = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    ids = ids or sorted(p.name for p in PROJECTS.iterdir() if (p / "manifest.js").is_file())
    failed = False
    try:
        for pid in ids:
            project = PROJECTS / pid
            if not (project / "manifest.js").is_file():
                print(f"{pid}: projects/{pid}/manifest.js not found")
                failed = True
                continue
            ws = BROWSER.evaluate(f"http://127.0.0.1:{PORT}/projects/{quote(pid)}/manifest.js", MANIFEST_JS) or {}
            items = [i for s in ws.get("sections") or [] for i in s.get("items") or []]

            def one(i):
                src = (project / i["src"]).resolve().relative_to(ROOT).as_posix()
                return make_thumb(project, i["id"], i.get("rev", 0), src, i.get("type", "html"), int(i["w"]), int(i["h"]))
            done = 0
            with ThreadPoolExecutor(BROWSER.size) as pool:
                futures = [(i, pool.submit(one, i)) for i in items]
                for i, fut in futures:
                    try:
                        done += fut.result()[1]
                    except Exception as e:  # noqa: BLE001 — report and go on with the others
                        print(f"  {i.get('id')}: {e}")
                        failed = True
            keep = {f"{file_key(i['id'])}@{file_key(i.get('rev', 0))}.webp" for i in items}
            for old in (project / ".thumbs").glob("*.webp"):
                if old.name not in keep:
                    old.unlink()
            print(f"{pid}: {len(items)} boards, {done} thumbnails rendered → projects/{pid}/.thumbs/")
    finally:
        BROWSER.stop()
        server.shutdown()
    sys.exit(1 if failed else 0)


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
    ap.add_argument("--thumbs", nargs="*", metavar="ID",
                    help="render the canvas thumbnails of these projects (default: all) and exit")
    args = ap.parse_args()
    if sys.stdout:  # None under pythonw; Windows consoles may not encode "→"
        sys.stdout.reconfigure(errors="replace")

    if args.install_launcher:
        return install_launcher(args.port)
    if args.thumbs is not None:
        return build_thumbs(args.thumbs)

    url = f"http://localhost:{args.port}/Atelier.html"
    if is_running(args.port):  # second launch: reuse the running server
        print(f"Atelier already running → {url}")
        if not args.no_open:
            webbrowser.open(url)
        return

    global PORT
    PORT = args.port
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    print(f"Atelier → {url}")
    print("Export: " + (CHROME or "unavailable — Chrome not found, set ATELIER_CHROME"))
    print("Ctrl+C to stop")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        BROWSER.stop()


if __name__ == "__main__":
    main()
