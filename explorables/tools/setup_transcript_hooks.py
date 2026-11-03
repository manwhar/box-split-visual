#!/usr/bin/env python3
"""Install this project's transcript hooks without changing global settings.

Run again after moving the project or changing Python. Existing unrelated
hooks/settings are preserved. Codex still requires approval in its /hooks UI;
this installer never writes trust decisions. --paths only lists edit targets.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import re
import shlex
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OWNER = "explorable-transcripts-v1"
CONFIGS = {"codex": ".codex/hooks.json", "claude": ".claude/settings.local.json",
           "antigravity": ".agents/hooks.json"}
PLUGIN = ".opencode/plugins/explorable-transcripts.js"
EVENTS = {"codex": ("UserPromptSubmit", "Stop"),
          "claude": ("UserPromptSubmit", "Stop", "StopFailure"),
          "antigravity": ("Stop",)}
CODEX_STATUS_MESSAGES = {
    "UserPromptSubmit": "Save authoring transcript before Codex replies",
    "Stop": "Save authoring transcript after Codex replies",
}


def targets(root: Path) -> list[Path]:
    return [root / name for name in (*CONFIGS.values(), PLUGIN)]


def safe_path(path: Path, root: Path) -> None:
    for target in (path, *path.parents):
        if target.is_symlink():
            raise ValueError(f"Refusing to install hooks through a symbolic link: {target}")
        if target == root:
            break


def command(root: Path, harness: str, event: str) -> str:
    args = [sys.executable, "-B", str(root / "explorables/tools/transcript_hooks.py"),
            "--harness", harness, "--event", event, "--owner", OWNER]
    if os.name == "nt":
        # list2cmdline quotes argv, but does not protect a shell command from
        # &, %, or other cmd metacharacters in a checkout/interpreter path.
        # An encoded PowerShell invocation preserves literal Unicode paths.
        script = "& " + " ".join("'" + arg.replace("'", "''") + "'" for arg in args) + "; exit $LASTEXITCODE"
        encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
        return "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " + encoded
    return shlex.join(args)


def owned(handler) -> bool:
    command_text = handler.get("command", "") if isinstance(handler, dict) else ""
    if not isinstance(command_text, str):
        return False
    if command_text.startswith("powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand "):
        try:
            command_text = base64.b64decode(command_text.rsplit(" ", 1)[1], validate=True).decode("utf-16-le")
        except (ValueError, UnicodeError):
            return False
        return "transcript_hooks.py" in command_text and f"'--owner' '{OWNER}'" in command_text
    return "transcript_hooks.py" in command_text and f"--owner {OWNER}" in command_text


def merged(config: dict, root: Path, harness: str) -> dict:
    # Work on a copy: malformed existing config must never be partially edited.
    config = json.loads(json.dumps(config))
    if harness == "antigravity":
        entry = config.setdefault("explorable-transcripts", {})
        if not isinstance(entry, dict):
            raise ValueError("The existing explorable-transcripts hook is not an object.")
        entry.setdefault("enabled", True)
        # Remove owned handlers on retired Antigravity events (PreInvocation fires
        # before every model step in a turn rather than once per user prompt).
        for retired in ("PreInvocation",):
            if retired in entry:
                handlers = entry[retired]
                if not isinstance(handlers, list):
                    raise ValueError(f"Invalid {retired} hook list.")
                kept = [item for item in handlers if not owned(item)]
                if kept:
                    entry[retired] = kept
                else:
                    entry.pop(retired, None)
        for event in EVENTS[harness]:
            handlers = entry.get(event, [])
            if not isinstance(handlers, list):
                raise ValueError(f"Invalid {event} hook list.")
            entry[event] = [item for item in handlers if not owned(item)] + [
                {"type": "command", "command": command(root, harness, event), "timeout": 90}]
        return config
    hooks = config.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError("The existing hooks setting is not an object.")
    for event in EVENTS[harness]:
        entries = hooks.get(event, [])
        if not isinstance(entries, list):
            raise ValueError(f"Invalid {event} hook list.")
        retained = []
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("hooks"), list):
                raise ValueError(f"Invalid {event} hook entry.")
            handlers = [handler for handler in entry["hooks"] if not owned(handler)]
            if handlers:
                retained.append({**entry, "hooks": handlers})
        handler = {"type": "command", "command": command(root, harness, event), "timeout": 90}
        if harness == "codex":
            # Codex also uses this message as the hook's review/settings label.
            handler["statusMessage"] = CODEX_STATUS_MESSAGES[event]
        retained.append({"hooks": [handler]})
        hooks[event] = retained
    return config


def install(root: Path = ROOT) -> list[Path]:
    root = root.absolute()
    updates = {}
    for harness, relative in CONFIGS.items():
        path = root / relative
        safe_path(path, root)
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        if not isinstance(data, dict):
            raise ValueError(f"Hook settings must be an object: {path}")
        updates[path] = json.dumps(merged(data, root, harness), indent=2, ensure_ascii=False) + "\n"
    plugin = root / PLUGIN
    safe_path(plugin, root)
    template = root / "explorables/_starter/opencode-transcripts.js"
    if not template.is_file():
        template = plugin  # The downloaded starter already ships the plugin.
    source = template.read_text(encoding="utf-8")
    if OWNER not in source:
        raise ValueError(f"The bundled OpenCode transcript plugin is missing its ownership marker: {template}")
    if plugin.exists() and "explorable-transcripts" not in plugin.read_text(encoding="utf-8"):
        raise ValueError(f"An unrelated OpenCode plugin already exists at {plugin}; leaving it untouched.")
    # OpenCode loads JavaScript itself; no additional JS runtime is installed.
    updates[plugin] = re.sub(r"^const python = .*; // configured by startup$",
                             lambda _: f"const python = {json.dumps(sys.executable)}; // configured by startup",
                             source, flags=re.MULTILINE)
    changed = []
    for path, content in updates.items():
        if path.exists() and path.read_text(encoding="utf-8") == content:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".transcript-hooks-", dir=path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(content)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        changed.append(path)
    if changed:
        print("Transcript hook files installed. Reopen your AI app to load them. "
              "In Codex, review and trust these commands in /hooks; installation does not grant trust.",
              file=sys.stderr)
    return changed


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paths", action="store_true", help="List targets without writing")
    args = parser.parse_args(argv)
    if args.paths:
        print("\n".join(str(path) for path in targets(ROOT)))
        return 0
    try:
        install()
    except (OSError, ValueError) as error:
        parser.exit(1, f"Transcript hook setup failed: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
