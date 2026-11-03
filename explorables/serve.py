#!/usr/bin/env python3
"""The local server for the explorables and the talk.

    python3 explorables/serve.py [--port 8790]

Then open http://localhost:8790/explorables/ for the gallery of explorables,
or http://localhost:8790/talk/ for the talk. The server shows the
repository's files to this computer only, and:

- makes each explorable's page from its folder whenever it's asked for
  (tools/decks.py), so a folder dropped into explorables/ is in the gallery
  as soon as the page is reloaded, with any problems in its format listed;
- serves the files an embed provider lends an explorable, such as Smallville
  Lab's pages, from where they live in the repository (tools/embeds.py), the
  same files a published explorable carries;
- saves slides edited in the browser (engine/js/editor.js) to the file that
  holds them, an explorable's slides.html or the talk's index.html, and keeps
  the version before it beside it (.slides.html.bak, .index.html.bak);
- opens a presentation as a Chrome app window on macOS (engine/js/presenter.js).

No dependencies. Any static server shows the slides; only saving, the app
window and the gallery's list of problems need this one.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import html
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import subprocess
import sys
import tempfile
import threading
from urllib.parse import parse_qs, quote, unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent / "tools"))
import decks  # noqa: E402
import embeds  # noqa: E402
try:
    import starter  # noqa: E402
except ImportError:  # the starter project's own copy of this server has no starter to offer
    starter = None

MAX_REQUEST = 4 * 1024 * 1024
# Pages that hold their own slides, rather than being made from a slides.html.
STANDALONE_DECKS = ("talk/index.html",)
SESSION = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
# Folders of explorables/ that aren't decks.
NOT_DECKS = decks.RESERVED


def revision(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def atomic_write(path: Path, content: bytes) -> None:
    """Replace a file all at once, so a failed write never leaves half a file."""
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    temporary = None
    # .index-….tmp for index.html and its backup, .slides-….tmp for slides.html (ignored by git).
    prefix = f".{path.name.lstrip('.').split('.')[0]}-"
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=prefix, suffix=".tmp", delete=False) as output:
            temporary = Path(output.name)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        temporary.chmod(mode)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def validate_app_url(url, origin: str, pages: set[str]) -> str:
    """The launcher opens only a deck's paired presentation page on this server."""
    if not isinstance(url, str) or len(url) > 8192:
        raise ValueError("Invalid presentation address.")
    address = urlsplit(url)
    query = parse_qs(address.query, keep_blank_values=True)
    if (f"{address.scheme}://{address.netloc}" != origin
            or unquote(address.path) not in pages
            or query.get("view") != ["presentation"] or query.get("display") != ["app"]
            or len(query.get("presenter", [])) != 1
            or not SESSION.fullmatch(query["presenter"][0])
            or set(query) - {"view", "display", "presenter", "lab", "recording"}
            or any(len(values) != 1 for values in query.values())):
        raise ValueError("Open the app window from the presenter on this local server.")
    return url


def launch_app_window(url: str) -> None:
    if sys.platform != "darwin":
        raise ValueError("This app-window launcher currently supports Chrome on macOS.")
    # Chrome reuses its running profile. No installation or shell interpolation.
    subprocess.run(["/usr/bin/open", "-na", "Google Chrome", "--args", f"--app={url}",
                    "--window-size=1280,800"], check=True, timeout=10,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@dataclass
class Deck:
    """A deck the editor can save: where it's shown, and the file its slides are in."""
    base: str  # the URL path of its folder, such as /talk/ or /explorables/schelling-segregation/
    source: Path  # the file holding its slides
    explorable: Path | None = None  # an explorable's folder, whose page is made from slides.html

    @property
    def pages(self) -> set[str]:
        return {self.base, self.base + "index.html"}

    @property
    def source_path(self) -> str:
        return self.base + self.source.name


def make_handler(root: Path):
    root = root.resolve()
    explorables = root / "explorables"
    token = secrets.token_urlsafe(32)
    lock = threading.Lock()

    def explorable_folder(name: str) -> Path | None:
        """explorables/<name>, if it's an explorable (including _template, which the gallery leaves out)."""
        if not name or name.startswith(".") or name in NOT_DECKS or "/" in name or "\\" in name:
            return None
        folder = explorables / name
        if folder.is_symlink() or not folder.is_dir() or not (folder / decks.MANIFEST).is_file():
            return None
        return folder if folder.resolve().parent == explorables.resolve() else None

    def deck_at(base: str) -> Deck | None:
        """The deck whose folder is at this URL path."""
        for page in STANDALONE_DECKS:
            if base == f"/{PurePosixPath(page).parent}/" and (root / page).is_file():
                target = root / page
                return Deck(base, target) if target.resolve() == target else None
        match = re.fullmatch(r"/explorables/([^/]+)/", base)
        folder = explorable_folder(match[1]) if match else None
        return Deck(base, folder / decks.SLIDES, folder) if folder else None

    class Handler(SimpleHTTPRequestHandler):
        # Module scripts only run when served as JavaScript, whatever this Python's defaults are.
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript",
                          ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp"}

        def __init__(self, *args, **kwargs):
            self.cache_set = False
            super().__init__(*args, directory=str(root), **kwargs)

        def send_header(self, keyword, value):
            if keyword.lower() == "cache-control":
                self.cache_set = True
            super().send_header(keyword, value)

        def end_headers(self):
            # Edits to the engine or a deck show up on reload; unchanged files still answer 304.
            if not self.cache_set:
                super().send_header("Cache-Control", "no-cache")
            self.cache_set = False
            super().end_headers()

        def local_host(self):
            try:
                host = urlsplit("http://" + self.headers.get("Host", ""))
                return host.hostname in {"localhost", "127.0.0.1"} and host.port == self.server.server_port
            except ValueError:
                return False

        def reply(self, status, data):
            content = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(content)

        def send(self, content: bytes, content_type: str, *, extra=None):
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            for name, value in (extra or {}).items():
                self.send_header(name, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(content)

        def redirect(self, location: str):
            self.send_response(302)
            self.send_header("Location", location)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def deck_headers(self, source: bytes | None = None):
            headers = {"X-Deck-Token": token, "X-Deck-App-Window": "1"}
            if source is not None:
                headers["X-Deck-Revision"] = revision(source)
            return headers

        def do_HEAD(self):
            if not self.route():
                super().do_HEAD()

        def do_GET(self):
            if not self.route():
                super().do_GET()

        def route(self) -> bool:
            """Answer the requests this server makes something for; False for a plain file."""
            if not self.local_host():
                self.reply(403, {"error": "Use this server through localhost or 127.0.0.1."})
                return True
            path = unquote(urlsplit(self.path).path)
            if path in {"/", "/explorables"}:
                self.redirect("/explorables/")
                return True
            if path in {"/explorables/", "/explorables/index.html"}:
                page = decks.gallery(decks.discover(explorables), published=False, engine="engine/")
                self.send(page.encode(), "text/html; charset=utf-8")
                return True
            if starter is not None and path == f"/explorables/{starter.DOWNLOAD}":
                try:
                    bundle = starter.archive_bytes(root)
                except (OSError, ValueError):
                    self.reply(404, {"error": "The starter project can't be made from this checkout."})
                else:
                    self.send(bundle, "application/zip", extra={
                        "Content-Disposition": f'attachment; filename="{starter.NAME}.zip"'})
                return True
            match = re.fullmatch(r"/explorables/([^/]+)(/.*)?", path)
            folder = explorable_folder(match[1]) if match else None
            if folder is not None:
                rest = match[2] or ""
                if not rest:
                    self.redirect(f"/explorables/{quote(match[1])}/")
                    return True
                if rest in {"/", "/index.html"}:
                    self.explorable_page(folder)
                    return True
                if rest == "/" + decks.SLIDES and (folder / decks.SLIDES).is_file():
                    source = (folder / decks.SLIDES).read_bytes()
                    self.send(source, "text/html; charset=utf-8", extra=self.deck_headers(source))
                    return True
                provider = decks.default_registry(explorables).for_reference(rest[1:])
                if provider is not None:
                    self.embed_file(provider, rest[1 + len(provider.prefix):])
                    return True
            for page in STANDALONE_DECKS:
                base = f"/{PurePosixPath(page).parent}/"
                if path in {base, f"/{page}"} and (root / page).is_file():
                    target = root / page
                    if target.resolve() != target:
                        self.reply(403, {"error": "The deck's file is a link. Serve the real file."})
                        return True
                    content = target.read_bytes()
                    self.send(content, "text/html; charset=utf-8", extra=self.deck_headers(content))
                    return True
            return False

        def explorable_page(self, folder: Path):
            registry = decks.default_registry(explorables)
            explorable = decks.load(folder, registry=registry)
            if not explorable.slides:
                problems = "".join(f"<li>{html.escape(str(p))}</li>" for p in explorable.problems)
                page = (f'<!doctype html><meta charset="utf-8"><title>{html.escape(folder.name)}</title>'
                        f'<body style="font: 16px/1.5 system-ui; margin: 40px">'
                        f"<h1>{html.escape(folder.name)} can't be shown yet</h1><ul>{problems}</ul>"
                        '<p><a href="../">Back to the gallery</a></p>')
                self.send(page.encode(), "text/html; charset=utf-8")
                return
            page = decks.page(explorable, published=False, engine="../engine/", home="../", registry=registry)
            self.send(page.encode(), "text/html; charset=utf-8", extra=self.deck_headers())

        def embed_file(self, provider: embeds.Provider, rel: str):
            """A file an embed provider lends the explorable, made or found where it lives."""
            found = provider.module.resolve(rel, {}, published=False)
            if found is None:
                self.send_error(404, f"Not one of the files {provider.prefix} provides")
                return
            content = found if isinstance(found, bytes) else found.read_bytes()
            content_type = "text/html; charset=utf-8" if rel.endswith(".html") else self.guess_type(rel)
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(content)

        def do_POST(self):
            path = unquote(urlsplit(self.path).path)
            match = re.fullmatch(r"(/.*/)(__save|__app-window)", path)
            deck = deck_at(match[1]) if match else None
            if deck is None:
                self.reply(404, {"error": "Unknown editor endpoint."})
                return
            endpoint = match[2]
            origin = f"http://{self.headers.get('Host', '')}"
            if (not self.local_host() or self.headers.get("Origin") != origin
                    or not secrets.compare_digest(self.headers.get("X-Deck-Token", ""), token)):
                self.reply(403, {"error": "Use the controls on this local server."})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                size = 0
            if not 0 < size <= MAX_REQUEST:
                self.reply(413, {"error": "The request is empty or too large."})
                return
            if self.headers.get_content_type() != "application/json":
                self.reply(415, {"error": "Expected JSON."})
                return
            try:
                payload = json.loads(self.rfile.read(size))
                if endpoint == "__app-window":
                    url = validate_app_url(payload.get("url") if isinstance(payload, dict) else None, origin, deck.pages)
                    launch_app_window(url)
                    self.reply(200, {"opened": True})
                    return
                if not isinstance(payload, dict) or not isinstance(payload.get("source"), str):
                    raise ValueError("Missing slide source.")
                updated = payload["source"].encode("utf-8")
                target = deck.source
                with lock:
                    # Check on every save, including if a file became a symlink.
                    if target.resolve() != target or not target.is_file():
                        raise ValueError("The slides' file location changed. Restart the server.")
                    before = target.read_bytes()
                    if payload.get("revision") != revision(before):
                        self.reply(409, {"error": "The slides changed on disk or in another tab. Your draft is kept. "
                                                  "Download it, then reload to get the newer file."})
                        return
                    decks.validate_update(before.decode("utf-8"), payload["source"])
                    if updated != before:
                        atomic_write(target.with_name(f".{target.name}.bak"), before)
                        atomic_write(target, updated)
                self.reply(200, {"revision": revision(updated)})
            except (ValueError, UnicodeError) as error:
                self.reply(400, {"error": str(error)})
            except (subprocess.SubprocessError, OSError):
                if endpoint == "__app-window":
                    self.reply(500, {"error": "Could not open Google Chrome. Check that Chrome is installed, then try again."})
                else:
                    self.reply(500, {"error": "Could not write the slides' file. Your browser draft is still available."})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent,
                        help="Repository to serve (defaults to this script's repository).")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(args.root))
    port = server.server_port
    print(f"Explorables: http://localhost:{port}/explorables/\nTalk:        http://localhost:{port}/talk/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
