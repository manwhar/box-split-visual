#!/usr/bin/env python3
"""Capture visible OpenCode session messages as canonical transcript JSONL.

    python3 extract_opencode_transcript.py --output <transcript.jsonl> \\
        [--mode full|append] [--session-id <id>] [--cwd <session-directory>] \\
        [--database <opencode.db>] [--command <opencode-executable>]
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
from typing import Any, Callable, Dict, List, Optional

from transcript_archive import (
    event_key,  # noqa: F401  (re-exported for callers of this adapter)
    get,
    home_dir,
    js_trim,
    js_truthy,
    merge_transcript_events,
    normalize_timestamp,
    parse_json,
    read_canonical_transcript as read_canonical_archive,
    to_json,
    write_canonical_transcript,
)

HARNESS = "opencode"
SUMMARY_INDENT = None

# Reads an export for (session_id, cwd, command); tests inject one.
ExportReader = Callable[[str, str, Optional[str]], Dict[str, Any]]


def _attachment_placeholder(part: Any) -> str:
    """Describe an attachment without exposing its filename, path, or data."""
    mime = get(part, "mime")
    if mime is None:
        mime = get(part, "mediaType")
    # A media type that is not a string is treated as unknown.
    mime = mime if isinstance(mime, str) else ""
    if mime.startswith("image/"):
        return "[Image attachment]"
    if mime.startswith("audio/"):
        return "[Audio attachment]"
    return "[File attachment]"


def _stable_part_id(message_id: str, part: Any, index: int) -> str:
    """The part's own ID, or a position-derived one that stays stable on re-export."""
    part_id = get(part, "id")
    return part_id if isinstance(part_id, str) and part_id else f"{message_id}:part-{index + 1}"


def _visible_assistant_phase(role: str, part: Any) -> Optional[str]:
    """The OpenAI phase OpenCode records on assistant text, when it is a known one."""
    if role != "assistant":
        return None
    phase = get(get(get(part, "metadata"), "openai"), "phase")
    return phase if isinstance(phase, str) and phase in ("commentary", "final_answer") else None


def _is_visible_text(part: Any) -> bool:
    text = get(part, "text")
    return (get(part, "type") == "text" and isinstance(text, str) and len(js_trim(text)) > 0
            and get(part, "synthetic") is not True and get(part, "ignored") is not True)


def normalize_open_code_export(export_data: Any, expected_session_id: Optional[str] = None) -> Dict[str, Any]:
    """An OpenCode export as {"metadata", "events"}.

    Only visible text parts are kept; an attachment-only message becomes
    placeholders. Reasoning, tools, patches, snapshots, synthetic or ignored
    text, and compaction summaries are excluded. A user message opens a turn
    and an assistant message joins the turn of its parent.
    """
    if not isinstance(export_data, dict) or not js_truthy(export_data.get("info")):
        raise ValueError("OpenCode export is missing session info")
    thread_id = get(export_data["info"], "id")
    if not isinstance(thread_id, str) or not thread_id:
        raise ValueError("OpenCode export is missing a session ID")
    if expected_session_id and thread_id != expected_session_id:
        raise ValueError(f"OpenCode exported session {thread_id}, expected {expected_session_id}")
    if not isinstance(export_data.get("messages"), list):
        raise ValueError("OpenCode export is missing its messages array")

    events: List[Dict[str, Any]] = []
    for message in export_data["messages"]:
        info = get(message, "info")
        if not js_truthy(info) or not isinstance(get(info, "id"), str):
            continue
        session_id = info.get("sessionID")
        if js_truthy(session_id) and session_id != thread_id:
            raise ValueError(f"OpenCode message {info['id']} belongs to a different session")
        role = info.get("role")
        if role not in ("user", "assistant") or not isinstance(role, str):
            continue
        if role == "assistant" and info.get("summary") is True:
            continue
        turn_id = info["parentID"] if role == "assistant" and js_truthy(info.get("parentID")) else info["id"]
        parts = message["parts"] if isinstance(message.get("parts"), list) else []
        # Positions come from enumerate, not list.index(): two identical parts
        # are distinct objects in JavaScript but equal dicts in Python.
        visible = [(index, part) for index, part in enumerate(parts) if _is_visible_text(part)]

        for index, part in visible:
            events.append(_event(thread_id, turn_id, _stable_part_id(info["id"], part, index), role,
                                 _visible_assistant_phase(role, part), part["text"]))
        if visible:
            continue
        for index, part in enumerate(parts):
            if get(part, "type") != "file" or get(part, "synthetic") is True or get(part, "ignored") is True:
                continue
            events.append(_event(thread_id, turn_id, _stable_part_id(info["id"], part, index), role,
                                 None, _attachment_placeholder(part)))

    metadata: Dict[str, Any] = {
        "schemaVersion": 1,
        "recordType": "metadata",
        "harness": HARNESS,
        "captureStatus": "complete",
        "threadId": thread_id,
    }
    started = normalize_timestamp(get(get(export_data["info"], "time"), "created"))
    if started:
        metadata["conversationStartedAt"] = started
    return {"metadata": metadata, "events": events}


def _event(thread_id: str, turn_id: Any, item_id: str, role: str, phase: Optional[str],
           text: str) -> Dict[str, Any]:
    return {
        "schemaVersion": 1,
        "harness": HARNESS,
        "captureStatus": "complete",
        "threadId": thread_id,
        "turnId": turn_id,
        "itemId": item_id,
        "role": role,
        "phase": phase,
        "text": text,
    }


def merge_events(existing: List[Dict[str, Any]], current: List[Dict[str, Any]], mode: str) -> Dict[str, Any]:
    """The shared merge, without its `changed` list."""
    merge = merge_transcript_events(existing, current, mode)
    return {"merged": merge["merged"], "added": merge["added"], "updated": merge["updated"]}


def read_canonical_transcript(path: str) -> Dict[str, Any]:
    """The shared reader, restricted to OpenCode records."""
    return read_canonical_archive(path, harness=HARNESS)


def read_open_code_session_export(session_id: str, cwd: str, command: Optional[str] = None,
                                  env: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Run the documented `opencode export <session>` command and parse its JSON."""
    env = os.environ if env is None else env
    command = command or env.get("T4G_OPENCODE_BIN") or "opencode"
    try:
        result = subprocess.run([command, "export", session_id], cwd=cwd, capture_output=True,
                                env=env, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError(f"Could not start OpenCode export: {error}") from error
    stdout = result.stdout.decode("utf-8", errors="replace")
    stderr = result.stderr.decode("utf-8", errors="replace")
    if result.returncode != 0:
        raise ValueError(f"OpenCode export failed with exit code {result.returncode}: "
                         f"{js_trim(stderr) or 'no error output'}")
    try:
        return parse_json(stdout)
    except ValueError as error:
        raise ValueError(f"OpenCode export did not return valid JSON: {error}") from error


def _parse_database_json(value: Any, label: str) -> Any:
    try:
        return parse_json(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"OpenCode database contains invalid JSON for {label}: {error}") from error


def open_code_database_candidates(env: Optional[Dict[str, str]] = None) -> List[str]:
    """Where OpenCode keeps its database, in the order they are checked, without repeats."""
    env = os.environ if env is None else env
    home = home_dir(env)
    candidates = [
        env.get("T4G_OPENCODE_DB"),
        os.path.join(env["XDG_DATA_HOME"], "opencode", "opencode.db") if env.get("XDG_DATA_HOME") else None,
        os.path.join(home, ".local", "share", "opencode", "opencode.db"),
        os.path.join(home, "Library", "Application Support", "ai.opencode.desktop", "opencode", "opencode.db")
        if sys.platform == "darwin" else None,
    ]
    return list(dict.fromkeys(candidate for candidate in candidates if candidate))


def resolve_open_code_database(explicit_path: Optional[str] = None,
                               env: Optional[Dict[str, str]] = None) -> Optional[str]:
    """The explicit database if it exists, else the first existing candidate, else None."""
    if explicit_path:
        resolved = os.path.abspath(explicit_path)
        return resolved if os.path.exists(resolved) else None
    return next((candidate for candidate in open_code_database_candidates(env) if os.path.exists(candidate)), None)


def read_open_code_database_export(session_id: str, cwd: str = "", database_path: Optional[str] = None,
                                   env: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Read one exact persisted session, in export shape, without an OpenCode binary.

    The database is opened read-only, so capture can never modify OpenCode's
    own state.
    """
    resolved = resolve_open_code_database(database_path, env)
    if not resolved:
        detail = (f" at {os.path.abspath(database_path)}" if database_path
                  else f"; checked {', '.join(open_code_database_candidates(env))}")
        raise ValueError(f"Could not find the OpenCode database{detail}")

    # A file: URI is the only way to ask sqlite3 for a read-only connection;
    # as_uri() also escapes characters such as "?" and "#" in the path.
    database = sqlite3.connect(f"{Path(os.path.abspath(resolved)).as_uri()}?mode=ro", uri=True)
    try:
        session = database.execute("SELECT id, time_created FROM session WHERE id = ? LIMIT 1",
                                   (session_id,)).fetchone()
        if not session:
            raise ValueError(f"OpenCode database {resolved} does not contain session {session_id}")
        message_rows = database.execute(
            "SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id",
            (session_id,)).fetchall()
        part_rows = database.execute(
            "SELECT id, message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created, id",
            (session_id,)).fetchall()
    finally:
        database.close()

    parts_by_message: Dict[str, List[Dict[str, Any]]] = {}
    for part_id, message_id, _created, data in part_rows:
        part = _parse_database_json(data, f"part {part_id}")
        # Like `{...data, id, messageID, sessionID}`: columns win over the JSON.
        part = dict(part) if isinstance(part, dict) else {}
        part.update(id=part_id, messageID=message_id, sessionID=session_id)
        parts_by_message.setdefault(message_id, []).append(part)

    messages = []
    for message_id, created, data in message_rows:
        info = _parse_database_json(data, f"message {message_id}")
        info = dict(info) if isinstance(info, dict) else {}
        time = info.get("time")
        info.update(id=message_id, sessionID=session_id,
                    time=time if time is not None else {"created": created})
        messages.append({"info": info, "parts": parts_by_message.get(message_id, [])})
    return {"info": {"id": session[0], "time": {"created": session[1]}}, "messages": messages}


def capture_open_code_transcript(session_id: str, output: str, mode: str, cwd: Optional[str] = None,
                                 command: Optional[str] = None, database: Optional[str] = None,
                                 source: Optional[str] = None,
                                 read_session_export: Optional[ExportReader] = None,
                                 env: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Capture one session into a canonical archive and return a summary.

    The local database is preferred; the CLI export is the fallback when no
    database exists. `read_session_export` replaces both, for tests.
    """
    if not session_id:
        raise ValueError("An active OpenCode session ID is required")
    output_path = os.path.abspath(output)
    if os.path.splitext(output_path)[1].lower() != ".jsonl":
        raise ValueError(f"OpenCode transcript output must end in .jsonl; received {to_json(output)}")
    cwd = os.path.abspath(cwd or os.getcwd())
    if read_session_export:
        exported = read_session_export(session_id, cwd, command)
    else:
        resolved = resolve_open_code_database(database, env)
        if database and not resolved:
            raise ValueError(f"Could not find the OpenCode database at {os.path.abspath(database)}")
        if resolved:
            exported = read_open_code_database_export(session_id, cwd, resolved, env)
            source = source or "opencode-sqlite"
        else:
            exported = read_open_code_session_export(session_id, cwd, command, env)
            source = source or "opencode-cli-export"

    current = normalize_open_code_export(exported, session_id)
    existing = read_canonical_transcript(output_path) if mode == "append" else {"metadata": None, "events": []}
    if existing["metadata"] and existing["metadata"]["threadId"] != session_id:
        raise ValueError(f"Existing transcript belongs to {existing['metadata']['threadId']}, not {session_id}")
    if any(event["threadId"] != session_id for event in existing["events"]):
        raise ValueError("Existing transcript contains a different OpenCode session")

    merge = merge_events(existing["events"], current["events"], mode)
    write_canonical_transcript(output_path, current["metadata"], merge["merged"])
    return {
        "source": source or "opencode-cli-export",
        "mode": mode,
        "fetched": len(current["events"]),
        "added": merge["added"],
        "updated": merge["updated"],
        "events": len(merge["merged"]),
        "output": output_path,
    }


def capture_from_environment(output: str, mode: str, env: Optional[Dict[str, str]] = None,
                             session_id: Optional[str] = None, **options: Any) -> Dict[str, Any]:
    """Capture the session named by T4G_OPENCODE_SESSION_ID (or `session_id`)."""
    env = os.environ if env is None else env
    session_id = session_id or env.get("T4G_OPENCODE_SESSION_ID")
    if not session_id:
        raise ValueError("No active OpenCode session ID is available; pass --session-id or run through the "
                         "installed OpenCode session environment hook")
    return capture_open_code_transcript(session_id=session_id, output=output, mode=mode, env=env, **options)


def summary_warnings(summary: Dict[str, Any]) -> List[str]:
    return []


EPILOG = """The session ID defaults to T4G_OPENCODE_SESSION_ID. The extractor reads that
exact session from OpenCode's local database, falling back to the documented
CLI export command only when no database is available. Never infer a session
by recency."""


def main(argv: Optional[List[str]] = None, env: Optional[Dict[str, str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0], epilog=EPILOG, allow_abbrev=False,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mode", default="full", choices=("full", "append"))
    parser.add_argument("--session-id")
    parser.add_argument("--cwd")
    parser.add_argument("--database")
    parser.add_argument("--command")
    args = parser.parse_args(argv)
    try:
        summary = capture_from_environment(args.output, args.mode, env, session_id=args.session_id,
                                           cwd=args.cwd, database=args.database, command=args.command)
    except (OSError, ValueError, sqlite3.Error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(to_json(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
