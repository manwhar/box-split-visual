#!/usr/bin/env python3
"""Local web UI server for creating 2D Minecraft mockup renders.

Runs with Python 3.10+ standard library only (no third-party packages).
Serves the mockup editor UI, discovers Minecraft textures in ../demo/assets/,
and exports transparent PNG renders alongside editable JSON project files.

Usage:
    py tools/minecraft_mockup.py
    py tools/minecraft_mockup.py --port 8765 --no-browser
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import base64
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import struct
import sys
import threading
import urllib.parse
import webbrowser

TOOLS_DIR = Path(__file__).resolve().parent
UI_DIR = TOOLS_DIR / "ui"
ASSETS_DIR = TOOLS_DIR.parent / "demo" / "assets"

PROJECT_FORMAT = "minecraft-mockup-2d"
EXCLUDED_FILES = frozenset({"paper_front.png"})
BLOCK_TEXELS = 16
MAX_TEXTURE_DIM = 128

VALID_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}")
PROJECT_ID_RE = re.compile(r"[A-Za-z0-9_-]+")

FRIENDLY_LABELS = {
    "grass_block_side": "Grass Block (Side)",
    "oak_log_top": "Oak Log (Top)",
    "torch": "Torch (Side)",
}

KIND_ORDER = {
    "block": 0,
    "multiblock": 1,
    "wall": 2,
    "cutout": 3,
    "decor": 4,
}

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
}


def inspect_png_bytes(data: bytes) -> tuple[int, int, bool] | None:
    """Return (width, height, has_alpha) from PNG bytes, or None if invalid."""
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    ihdr_len = struct.unpack(">I", data[8:12])[0]
    if data[12:16] != b"IHDR" or ihdr_len < 13:
        return None
    width, height = struct.unpack(">II", data[16:24])
    color_type = data[25]
    has_alpha = color_type in (4, 6)
    pos = 8
    while pos + 12 <= len(data):
        chunk_len = struct.unpack(">I", data[pos:pos + 4])[0]
        chunk_type = data[pos + 4:pos + 8]
        if chunk_type == b"tRNS":
            has_alpha = True
            break
        if chunk_type in (b"IDAT", b"IEND"):
            break
        pos += 12 + chunk_len
    return width, height, has_alpha


def inspect_png(path: Path) -> tuple[int, int, bool] | None:
    """Inspect a PNG file on disk without external libraries."""
    try:
        data = path.read_bytes()
    except OSError:
        return None
    return inspect_png_bytes(data)


def read_project_json(path: Path) -> dict | None:
    """Read and validate a mockup project JSON file."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    if isinstance(data, dict) and data.get("format") == PROJECT_FORMAT:
        return data
    return None


def is_mockup_project_stem(stem: str) -> bool:
    """Return True if ASSETS_DIR/<stem>.json is a saved mockup project."""
    json_path = ASSETS_DIR / f"{stem}.json"
    return json_path.is_file() and read_project_json(json_path) is not None


def classify_texture(tex_id: str, width: int, height: int, has_alpha: bool) -> dict:
    """Compute span and rendering metadata for a discovered texture PNG."""
    if width == height and width >= BLOCK_TEXELS:
        span_cols, span_rows = 1, 1
    elif width % BLOCK_TEXELS == 0 and height % BLOCK_TEXELS == 0 and width >= BLOCK_TEXELS and height >= BLOCK_TEXELS:
        span_cols = width // BLOCK_TEXELS
        span_rows = height // BLOCK_TEXELS
    else:
        span_cols = max(1, round(width / BLOCK_TEXELS))
        span_rows = max(1, round(height / BLOCK_TEXELS))

    if tex_id == "torch" or tex_id.endswith("_torch"):
        kind = "decor"
        is_decor = True
        casts_shadow = False
        preserves_bg = True
    elif tex_id == "cobblestone_wall" or tex_id.endswith("_wall"):
        kind = "wall"
        is_decor = False
        casts_shadow = True
        preserves_bg = True
    elif tex_id == "oak_door" or tex_id.endswith("_door") or span_rows > 1 or span_cols > 1:
        kind = "multiblock"
        is_decor = False
        casts_shadow = True
        preserves_bg = has_alpha
    elif has_alpha or width < BLOCK_TEXELS or height < BLOCK_TEXELS:
        kind = "cutout"
        is_decor = False
        casts_shadow = True
        preserves_bg = True
    else:
        kind = "block"
        is_decor = False
        casts_shadow = True
        preserves_bg = False

    label = FRIENDLY_LABELS.get(tex_id, tex_id.replace("_", " ").title())
    return {
        "kind": kind,
        "label": label,
        "spanCols": span_cols,
        "spanRows": span_rows,
        "isDecor": is_decor,
        "castsShadow": casts_shadow,
        "preservesBg": preserves_bg,
    }


def list_textures() -> list[dict]:
    """Discover all usable Minecraft textures in demo/assets/."""
    if not ASSETS_DIR.is_dir():
        return []

    project_stems = {
        p.stem for p in ASSETS_DIR.glob("*.json")
        if read_project_json(p) is not None
    }

    textures = []
    for p in sorted(ASSETS_DIR.glob("*.png"), key=lambda item: item.name.lower()):
        if p.name in EXCLUDED_FILES or p.stem in project_stems:
            continue
        info = inspect_png(p)
        if info is None:
            continue
        width, height, has_alpha = info
        if max(width, height) > MAX_TEXTURE_DIM:
            continue

        meta = classify_texture(p.stem, width, height, has_alpha)
        textures.append({
            "id": p.stem,
            "filename": p.name,
            "url": f"/assets/{urllib.parse.quote(p.name)}",
            "width": width,
            "height": height,
            "hasAlpha": has_alpha,
            **meta,
        })

    textures.sort(key=lambda t: (KIND_ORDER.get(t["kind"], 99), t["label"].lower()))
    return textures


def list_projects() -> list[dict]:
    """Discover all saved mockup JSON projects in demo/assets/."""
    if not ASSETS_DIR.is_dir():
        return []

    projects = []
    for p in sorted(ASSETS_DIR.glob("*.json")):
        data = read_project_json(p)
        if data is None:
            continue
        try:
            stat = p.stat()
            mtime = stat.st_mtime
        except OSError:
            mtime = 0.0
        png_path = ASSETS_DIR / f"{p.stem}.png"
        updated_iso = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
        projects.append({
            "name": p.stem,
            "cols": data.get("cols"),
            "rows": data.get("rows"),
            "mtime": mtime,
            "updatedAt": updated_iso,
            "pngExists": png_path.is_file(),
            "pngUrl": f"/assets/{urllib.parse.quote(p.stem + '.png')}?v={int(mtime)}" if png_path.is_file() else None,
        })

    projects.sort(key=lambda item: item["mtime"], reverse=True)
    for item in projects:
        item.pop("mtime", None)
    return projects


def resolve_safe_child(root: Path, rel_path: str) -> Path | None:
    """Resolve a relative URL subpath safely inside root, rejecting traversal."""
    cleaned = urllib.parse.unquote(rel_path).lstrip("/")
    if not cleaned or "\\" in cleaned or "\x00" in cleaned:
        return None
    root_resolved = root.resolve()
    candidate = (root_resolved / cleaned).resolve()
    try:
        candidate.relative_to(root_resolved)
    except ValueError:
        return None
    return candidate


def sanitize_export_name(raw_name: object) -> str | None:
    """Normalize and validate an export mockup stem name."""
    if not isinstance(raw_name, str):
        return None
    name = raw_name.strip()
    for ext in (".png", ".json"):
        if name.lower().endswith(ext):
            name = name[:-len(ext)]
    name = name.strip()
    if not VALID_NAME_RE.fullmatch(name):
        return None
    return name


class MockupRequestHandler(BaseHTTPRequestHandler):
    """HTTP request handler serving the mockup editor UI and asset APIs."""

    server_version = "MinecraftMockupTool/1.0"

    def log_message(self, format: str, *args: object) -> None:
        # Keep terminal clean unless debugging errors.
        pass

    def _send_bytes(
        self,
        status: int,
        data: bytes,
        content_type: str,
        *,
        no_store: bool = False,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if no_store:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self._send_bytes(status, body, MIME_TYPES[".json"], no_store=True)

    def _send_file(self, path: Path, *, no_store: bool = False) -> None:
        if not path.is_file():
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "File not found"})
            return
        ext = path.suffix.lower()
        content_type = MIME_TYPES.get(ext, "application/octet-stream")
        try:
            data = path.read_bytes()
        except OSError as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
            return
        self._send_bytes(HTTPStatus.OK, data, content_type, no_store=no_store)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path

        if path in ("/", "/index.html"):
            self._send_file(UI_DIR / "index.html", no_store=True)
            return

        if path.startswith("/static/"):
            target = resolve_safe_child(UI_DIR, path[len("/static/"):])
            if target is None:
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "Invalid static path"})
                return
            self._send_file(target, no_store=True)
            return

        if path.startswith("/assets/"):
            target = resolve_safe_child(ASSETS_DIR, path[len("/assets/"):])
            if target is None:
                self._send_json(HTTPStatus.FORBIDDEN, {"error": "Invalid asset path"})
                return
            self._send_file(target, no_store=True)
            return

        if path == "/api/textures":
            self._send_json(HTTPStatus.OK, {"textures": list_textures()})
            return

        if path == "/api/projects":
            self._send_json(HTTPStatus.OK, {"projects": list_projects()})
            return

        if path.startswith("/api/projects/"):
            raw_id = urllib.parse.unquote(path[len("/api/projects/"):]).strip("/")
            if not PROJECT_ID_RE.fullmatch(raw_id):
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid project name"})
                return
            json_path = ASSETS_DIR / f"{raw_id}.json"
            data = read_project_json(json_path)
            if data is None:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": f"Project '{raw_id}' not found"})
                return
            self._send_json(HTTPStatus.OK, data)
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"error": f"Unknown endpoint: {path}"})

    def do_POST(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path != "/api/export":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": f"Unknown endpoint: {parsed.path}"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid Content-Length"})
            return

        if content_length <= 0 or content_length > 25 * 1024 * 1024:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Request body missing or too large"})
            return

        try:
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Invalid JSON body: {exc}"})
            return

        if not isinstance(payload, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Expected JSON object"})
            return

        name = sanitize_export_name(payload.get("name"))
        if not name:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Invalid name. Use 1-80 letters, digits, hyphens, or underscores starting with a letter/digit."},
            )
            return

        png_path = ASSETS_DIR / f"{name}.png"
        json_path = ASSETS_DIR / f"{name}.json"

        # Protect source textures and non-mockup assets (e.g. stone.png, paper_front.png).
        if png_path.exists() and not is_mockup_project_stem(name):
            self._send_json(
                HTTPStatus.CONFLICT,
                {"error": f"Cannot overwrite existing asset '{name}.png'. Pick a different mockup name."},
            )
            return

        png_data_url = payload.get("pngDataUrl")
        if not isinstance(png_data_url, str) or not png_data_url.startswith("data:image/png;base64,"):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Expected pngDataUrl starting with data:image/png;base64,"})
            return

        b64_part = png_data_url.split(",", 1)[1]
        try:
            png_bytes = base64.b64decode(b64_part, validate=True)
        except Exception as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": f"Invalid PNG base64 data: {exc}"})
            return

        png_info = inspect_png_bytes(png_bytes)
        if png_info is None:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Decoded payload is not a valid PNG"})
            return
        width, height, _ = png_info

        project = payload.get("project")
        if not isinstance(project, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Missing project JSON object"})
            return

        project_out = dict(project)
        project_out["format"] = PROJECT_FORMAT
        project_out["version"] = 1
        project_out["name"] = name
        project_out["savedAt"] = datetime.now(timezone.utc).isoformat()

        try:
            ASSETS_DIR.mkdir(parents=True, exist_ok=True)
            png_path.write_bytes(png_bytes)
            json_path.write_text(json.dumps(project_out, indent=2) + "\n", encoding="utf-8")
        except OSError as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"Failed to write files: {exc}"})
            return

        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "name": name,
                "png": png_path.name,
                "json": json_path.name,
                "width": width,
                "height": height,
                "bytes": len(png_bytes),
            },
        )


def bind_server(host: str, requested_port: int | None) -> ThreadingHTTPServer:
    """Bind ThreadingHTTPServer to requested port or first free port near 8765."""
    if requested_port is not None:
        return ThreadingHTTPServer((host, requested_port), MockupRequestHandler)

    for candidate in range(8765, 8800):
        try:
            return ThreadingHTTPServer((host, candidate), MockupRequestHandler)
        except OSError:
            continue
    return ThreadingHTTPServer((host, 0), MockupRequestHandler)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Launch the 2D Minecraft mockup render generator web UI.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=None, help="Bind port (default: 8765 or next available)")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open a browser tab")
    args = parser.parse_args(argv)

    if not UI_DIR.is_dir():
        print(f"Error: UI directory not found at {UI_DIR}", file=sys.stderr)
        return 1

    try:
        server = bind_server(args.host, args.port)
    except OSError as exc:
        print(f"Error binding {args.host}:{args.port}: {exc}", file=sys.stderr)
        return 1

    actual_host, actual_port = server.server_address[:2]
    url = f"http://{actual_host}:{actual_port}/"
    print(f"2D Minecraft Mockup Studio running at {url}")
    print(f"Assets directory: {ASSETS_DIR}")
    print("Press Ctrl+C to stop.")

    if not args.no_browser:
        timer = threading.Timer(0.3, lambda: webbrowser.open(url))
        timer.daemon = True
        timer.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
