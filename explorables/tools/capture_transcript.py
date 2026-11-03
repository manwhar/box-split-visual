#!/usr/bin/env python3
"""Save this explorable's exact agent conversation with save-chat-transcript.

    python3 explorables/tools/capture_transcript.py [your-paper]
    python3 explorables/tools/capture_transcript.py [your-paper] --path

Run on each conversational turn and before submission. --path only prints
the destination, for checking a session's freeze boundary before saving.
One archive per exact conversation survives folder renames and chat resumes.
The shared extractor owns normalization, deduplication and atomic writes; it
is standard-library Python and runs inside this process, so capture needs
nothing beyond the Python that runs this script.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import importlib
import io
import json
import os
from pathlib import Path
import sys
import time
from types import ModuleType

import transcript_state as state

ROOT = Path(__file__).resolve().parents[2]
TRANSCRIPTS = "transcripts"
SKILL = Path(".agents/skills/save-chat-transcript")
# The extractor's modules, which import one another by these plain names.
EXTRACTOR_MODULES = ("transcript_archive", "extract_codex_transcript", "extract_opencode_transcript",
                     "extract_claude_transcript", "extract_antigravity_transcript", "extract_transcript")
SESSION_VARIABLES = {
    "codex": "CODEX_THREAD_ID",
    "claude": "CLAUDE_CODE_SESSION_ID",
    "opencode": "T4G_OPENCODE_SESSION_ID",
    "antigravity": "ANTIGRAVITY_CONVERSATION_ID",
}


def identity(env=None) -> tuple[str, str]:
    """Use only an exact active identity, never a recent chat or a folder match."""
    env = os.environ if env is None else env
    candidates = [(harness, env[key]) for harness, key in SESSION_VARIABLES.items() if env.get(key)]
    if not env.get("ANTIGRAVITY_CONVERSATION_ID") and env.get("ANTIGRAVITY_SOURCE_METADATA"):
        try:
            session = json.loads(env["ANTIGRAVITY_SOURCE_METADATA"])["tool"]["conversationId"]
            if isinstance(session, str) and session:
                candidates.append(("antigravity", session))
        except (ValueError, KeyError, TypeError):
            pass
    if len(candidates) != 1:
        raise ValueError("Transcript capture needs exactly one active conversation identity from the AI app. "
                         "Run this command through your agent; do not choose a chat by recency or reconstruct it.")
    return candidates[0]


def has_identity(env=None) -> bool:
    env = os.environ if env is None else env
    return any(env.get(key) for key in (*SESSION_VARIABLES.values(), "ANTIGRAVITY_SOURCE_METADATA"))


def destination(folder: Path, env=None) -> Path:
    harness, session = identity(env)
    # Keep the whole identity's hash: truncating or sanitizing the session ID
    # can make two conversations share a filename.
    digest = hashlib.sha256(session.encode()).hexdigest()
    return folder / TRANSCRIPTS / f"{harness}-{digest}.jsonl"


def validate(content: bytes, name: str = "transcript", *, require_messages: bool = True) -> list[dict]:
    """Check the canonical v1 contract when packaging, independently of the extractor."""
    try:
        records = [json.loads(line) for line in content.decode("utf-8").splitlines() if line.strip()]
    except (ValueError, UnicodeError) as error:
        raise ValueError(f"Invalid transcript {name}: {error}") from error
    if len(records) < (2 if require_messages else 1) or not all(isinstance(record, dict) for record in records):
        raise ValueError(f"Transcript {name} needs metadata and at least one visible message.")
    meta, *events = records
    if (meta.get("schemaVersion") != 1 or meta.get("recordType") != "metadata"
            or meta.get("harness") not in SESSION_VARIABLES
            or not isinstance(meta.get("threadId"), str) or not meta["threadId"]
            or meta.get("captureStatus") not in ("complete", "source-truncated")):
        raise ValueError(f"Invalid transcript metadata in {name}.")
    if "conversationStartedAt" in meta:
        try:
            datetime.fromisoformat(meta["conversationStartedAt"].replace("Z", "+00:00"))
        except (ValueError, TypeError, AttributeError) as error:
            raise ValueError(f"Invalid conversation start timestamp in {name}.") from error
    seen = set()
    for event in events:
        if (event.get("schemaVersion") != 1 or "recordType" in event
                or event.get("harness") != meta["harness"] or event.get("threadId") != meta["threadId"]
                or event.get("captureStatus") not in ("complete", "source-truncated")
                or any(not isinstance(event.get(key), str) or not event[key] for key in ("turnId", "itemId", "text"))
                or event.get("role") not in ("user", "assistant")
                or "phase" not in event or event["phase"] not in (None, "commentary", "final_answer")):
            raise ValueError(f"Invalid or mixed-conversation transcript message in {name}.")
        key = (event["turnId"], event["itemId"])
        if key in seen:
            raise ValueError(f"Duplicate transcript message in {name}: {key}.")
        seen.add(key)
        if event["captureStatus"] == "source-truncated" and meta["captureStatus"] != "source-truncated":
            raise ValueError(f"Transcript {name} must disclose its source-truncated capture.")
    return records


def load_extractor(root: Path = ROOT) -> ModuleType:
    """Import the bundled save-chat-transcript dispatcher from `root`.

    The skill's modules import one another by plain name, so its scripts
    folder goes on sys.path while they load. Modules already imported from a
    different copy of the skill (another project root) are dropped first, so
    the copy under `root` is the one that runs.
    """
    scripts = (root / SKILL / "scripts").resolve()
    if not (scripts / "extract_transcript.py").is_file():
        raise ValueError(f"The bundled save-chat-transcript extractor is missing: {scripts / 'extract_transcript.py'}")
    loaded = sys.modules.get("extract_transcript")
    if loaded is not None and Path(loaded.__file__).resolve().parent != scripts:
        for name in EXTRACTOR_MODULES:
            sys.modules.pop(name, None)
    sys.path.insert(0, str(scripts))
    try:
        return importlib.import_module("extract_transcript")
    finally:
        sys.path.remove(str(scripts))


def _capture_once(folder: Path, *, root: Path = ROOT, env=None, source=None) -> Path:
    env = dict(os.environ if env is None else env)
    output = destination(folder, env)
    for path in (folder, output.parent, output):
        if path.is_symlink():
            raise ValueError(f"Refusing to save a transcript through a symbolic link: {path}")
    if output.exists():
        # An early checkpoint may have run before the first visible message
        # reached the app's history. Permit that archive to recover on retry;
        # packaging still requires at least one visible message.
        meta = validate(output.read_bytes(), str(output), require_messages=False)[0]
        if (meta["harness"], meta["threadId"]) != identity(env):
            raise ValueError(f"The existing transcript belongs to a different conversation: {output}")
    extractor = load_extractor(root)
    # The extractor reports its summary and any diagnostics through its own
    # report(); collect them so they are printed only once capture succeeded.
    out, err = io.StringIO(), io.StringIO()
    try:
        options = source or {}
        extractor.report(extractor.capture("append", str(output), env, **options), out, err)
    except Exception as error:  # noqa: BLE001 - any extractor failure must stop packaging
        raise ValueError("Exact transcript capture failed; no replacement transcript was invented.\n"
                         f"{error}") from error
    meta = validate(output.read_bytes(), str(output))[0]
    if (meta["harness"], meta["threadId"]) != identity(env):
        raise ValueError("The extractor returned a different conversation.")
    if out.getvalue().strip():
        print(out.getvalue().strip())
    if err.getvalue().strip():
        print(err.getvalue().strip(), file=sys.stderr)
    return output


def refresh(folder: Path, data: dict, *, root: Path = ROOT, env=None, retry_seconds: float = 0,
            advance_from_user: bool = False) -> Path:
    """Under the paper's save lock, retry log lag without inventing messages.

    A pending expectation is saved before reading history. If the hook is
    killed, times out, or loses access, the next save can still recover it.
    """
    output = destination(folder, env)
    deadline = time.monotonic() + retry_seconds
    previous = None
    while True:
        try:
            _capture_once(folder, root=root, env=env, source=data["source"])
            content = output.read_bytes()
            records = validate(content, str(output))
            if advance_from_user:
                prior = state.later_anchor(data.get("baseline"), state.baseline_before_user(records), records)
                if prior != data.get("baseline"):
                    for item in data["pending"]:
                        if item.get("kind") != "checkpoint" and item.get("after") == data.get("baseline"):
                            item["after"] = prior
                    data["baseline"] = prior
            state.reconcile(data, records, settled=content == previous)
            previous = content
            if data["pending"]:
                raise ValueError("The completed reply has not reached the exact history source yet.")
            data.pop("error", None)
            state.write(output, data)
            return output
        except (OSError, ValueError) as error:
            data["error"] = str(error)
            state.write(output, data)
            if time.monotonic() >= deadline:
                raise
            time.sleep(min(0.4, max(0, deadline - time.monotonic())))


def capture(folder: Path, *, root: Path = ROOT, env=None) -> Path:
    env = dict(os.environ if env is None else env)
    harness, session = identity(env)
    output = destination(folder, env)
    from transcript_hooks import registered_folder
    registered = registered_folder(root, env)
    if registered is not None and registered != folder:
        raise ValueError(f"This conversation is already registered to {registered.name}; "
                         "use a separate author chat for another paper.")
    with state.locked(output):
        data = state.read(output, harness, session)
        first = data is None
        data = data or state.new(harness, session)
        state.write(output, data)
        refresh(folder, data, root=root, env=env, retry_seconds=2 if data["pending"] else 0)
        if first:
            data["baseline"] = state.baseline(validate(output.read_bytes()))
            state.write(output, data)
        elif not data["pending"]:
            records = validate(output.read_bytes())
            data["baseline"] = state.later_anchor(data.get("baseline"), state.baseline_before_user(records), records)
            state.write(output, data)
    return output


def check_submission(files: dict[str, bytes]) -> list[str]:
    """Require real archives; a submission must not silently lose the conversation."""
    names = sorted(name for name in files if name.startswith(f"{TRANSCRIPTS}/"))
    if not names:
        raise ValueError("No conversation transcript found. Ask your agent to run "
                         "python3 explorables/tools/capture_transcript.py for this explorable, then package again.")
    conversations = set()
    for name in names:
        if len(Path(name).parts) != 2 or not name.endswith(".jsonl"):
            raise ValueError(f"Only canonical JSONL archives belong in {TRANSCRIPTS}/: {name}")
        meta = validate(files[name], name)[0]
        key = (meta["harness"], meta["threadId"])
        if key in conversations:
            raise ValueError(f"More than one transcript contains the same conversation: {name}")
        conversations.add(key)
        if meta["captureStatus"] == "source-truncated":
            print(f"Warning: {name} is source-truncated; some text was not persisted by the AI app.", file=sys.stderr)
    return names


def main(argv=None) -> int:
    from package_explorable import choose

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", nargs="?", help="The explorable's folder name")
    parser.add_argument("--path", action="store_true", help="Print the destination without writing")
    args = parser.parse_args(argv)
    try:
        folder = choose(args.folder, ROOT / "explorables")
        if args.path:
            print(destination(folder))
            return 0
        output = capture(folder, root=ROOT)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Transcript not saved. {error}\n")
    # Keep the checkpoint even if the app protects its settings directory.
    # Installing a hook and successfully saving history are separate outcomes.
    import setup_transcript_hooks
    try:
        setup_transcript_hooks.install(ROOT)
    except (OSError, ValueError) as error:
        print(f"Transcript saved: {output}\nAutomatic hook setup is incomplete: {error}\n"
              "Run python3 explorables/tools/setup_transcript_hooks.py to finish setup; "
              "keep manual recovery captures until the hooks are enabled.", file=sys.stderr)
        return 1
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
