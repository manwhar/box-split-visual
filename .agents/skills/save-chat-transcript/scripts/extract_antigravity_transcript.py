#!/usr/bin/env python3
"""Normalize visible Antigravity conversation-log entries as transcript JSONL.

    python3 extract_antigravity_transcript.py --output <transcript.jsonl> \\
        [--mode full|append] [--conversation-id <id>] [--app-data-dir <path>]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional

from transcript_archive import (
    classify_assistant_runs,
    event_key,  # noqa: F401  (re-exported for callers of this adapter)
    get,
    home_dir,
    is_number,
    js_string,
    js_trim,
    merge_transcript_events,
    normalize_timestamp,
    parse_json,
    read_canonical_transcript as read_canonical_archive,
    read_text,
    split_lines,
    to_json,
    write_canonical_transcript,
)

HARNESS = "antigravity"
SOURCE = "antigravity-conversation-log"
SUMMARY_INDENT = None

USER_REQUEST = re.compile(r"<USER_REQUEST>([\s\S]*?)</USER_REQUEST>")


def _extract_user_message(content: str) -> Optional[str]:
    """The text inside the first <USER_REQUEST> wrapper, or None."""
    match = USER_REQUEST.search(content)
    if not match:
        return None
    return js_trim(match.group(1)) or None


def _step_key(step: Any) -> Any:
    """A dictionary key with JavaScript Map semantics for a step index.

    1 and 1.0 are one number in JavaScript; true is not 1; distinct objects
    are distinct keys.
    """
    if isinstance(step, bool):
        return ("boolean", step)
    if is_number(step):
        return ("number", float(step))
    if isinstance(step, (str, type(None))):
        return (type(step).__name__, step)
    return ("object", id(step))


def extract_events(entries: List[Any], conversation_id: str) -> List[Dict[str, Any]]:
    """Visible user requests and planner responses, as canonical events.

    Each step is a turn; an entry's ordinal within its step keeps identities
    unique when one step holds several messages. A message containing
    Antigravity's "<truncated" marker is recorded as source-truncated.
    """
    events: List[Dict[str, Any]] = []
    ordinal_by_step: Dict[Any, int] = {}
    for entry in entries:
        content = get(entry, "content")
        if not isinstance(content, str):
            continue
        kind = entry.get("type")
        if kind == "USER_INPUT":
            role, text = "user", _extract_user_message(content)
        elif kind == "PLANNER_RESPONSE":
            role, text = "assistant", js_trim(content) or None
        else:
            continue
        if not text:
            continue

        # A missing step_index interpolates as "undefined", as in JavaScript.
        step = entry["step_index"] if "step_index" in entry else _UNDEFINED
        step_text = "undefined" if step is _UNDEFINED else js_string(step)
        key = ("undefined",) if step is _UNDEFINED else _step_key(step)
        ordinal = ordinal_by_step.get(key, 0) + 1
        ordinal_by_step[key] = ordinal
        events.append({
            "schemaVersion": 1,
            "harness": HARNESS,
            "captureStatus": "source-truncated" if "<truncated" in text else "complete",
            "threadId": conversation_id,
            "turnId": f"step-{step_text}",
            "itemId": f"{kind.lower()}-{step_text}-{ordinal}",
            "role": role,
            "phase": None,
            "text": text,
        })

    # Antigravity's log carries no phase, so classify from message order: the
    # viewer collapses runs of commentary, and without this every line of
    # narration renders as a separate reply.
    return classify_assistant_runs(events)


_UNDEFINED = object()


def create_transcript_metadata(entries: List[Any], conversation_id: str,
                               events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The archive's metadata, with the earliest source time and the truncation status."""
    started = sorted(value for value in (normalize_timestamp(get(entry, "created_at")) for entry in entries)
                     if value)
    truncated = any(event.get("captureStatus") == "source-truncated" for event in events)
    metadata: Dict[str, Any] = {
        "schemaVersion": 1,
        "recordType": "metadata",
        "harness": HARNESS,
        "captureStatus": "source-truncated" if truncated else "complete",
        "threadId": conversation_id,
    }
    if started:
        metadata["conversationStartedAt"] = started[0]
    return metadata


def merge_events(existing: List[Dict[str, Any]], current: List[Dict[str, Any]], mode: str) -> Dict[str, Any]:
    """The shared merge, without its `changed` list."""
    merge = merge_transcript_events(existing, current, mode)
    return {"merged": merge["merged"], "added": merge["added"], "updated": merge["updated"]}


def _parse_jsonl(path: str) -> List[Any]:
    values = []
    for index, line in enumerate(split_lines(read_text(path))):
        if not js_trim(line):
            continue
        try:
            values.append(parse_json(line))
        except ValueError as error:
            raise ValueError(f"Invalid JSONL at {path}:{index + 1}: {error}") from error
    return values


def read_canonical_transcript(path: str) -> Dict[str, Any]:
    """The shared reader, restricted to Antigravity records."""
    return read_canonical_archive(path, harness=HARNESS)


def app_data_dirs(custom_app_data_dir: Optional[str] = None,
                  env: Optional[Dict[str, str]] = None) -> List[str]:
    """Antigravity's possible data folders, in the order they are searched."""
    if custom_app_data_dir:
        return [custom_app_data_dir]
    env = os.environ if env is None else env
    home = home_dir(env)
    candidates = [
        env.get("ANTIGRAVITY_APP_DATA_DIR"),
        env.get("GEMINI_APP_DATA_DIR"),
        os.path.join(home, ".gemini", "antigravity"),
        os.path.join(home, ".gemini", "antigravity-ide"),
        os.path.join(home, ".gemini", "antigravity-cli"),
        os.path.join(home, ".antigravity"),
    ]
    return [directory for directory in candidates if directory]


def resolve_antigravity_transcript_path(conversation_id: str, custom_app_data_dir: Optional[str] = None,
                                        env: Optional[Dict[str, str]] = None) -> str:
    """The conversation's transcript_full.jsonl.

    Never the compact transcript.jsonl beside it, which abbreviates messages.
    When none exists, the primary location is returned so the caller's error
    names where it looked.
    """
    for directory in app_data_dirs(custom_app_data_dir, env):
        full_path = os.path.join(directory, "brain", conversation_id, ".system_generated", "logs",
                                 "transcript_full.jsonl")
        if os.path.exists(full_path):
            return full_path
    primary = custom_app_data_dir or os.path.join(home_dir(env), ".gemini", "antigravity")
    return os.path.join(primary, "brain", conversation_id, ".system_generated", "logs", "transcript_full.jsonl")


def resolve_antigravity_conversation_id(env: Optional[Dict[str, str]] = None) -> Optional[str]:
    """ANTIGRAVITY_CONVERSATION_ID, or the conversation in ANTIGRAVITY_SOURCE_METADATA."""
    env = os.environ if env is None else env
    if env.get("ANTIGRAVITY_CONVERSATION_ID"):
        return env["ANTIGRAVITY_CONVERSATION_ID"]
    if not env.get("ANTIGRAVITY_SOURCE_METADATA"):
        return None
    try:
        conversation = get(get(json.loads(env["ANTIGRAVITY_SOURCE_METADATA"]), "tool"), "conversationId")
    except ValueError:
        return None
    return conversation if isinstance(conversation, str) and conversation else None


def capture_from_environment(output: str, mode: str, env: Optional[Dict[str, str]] = None,
                             conversation_id: Optional[str] = None,
                             app_data_dir: Optional[str] = None) -> Dict[str, Any]:
    """Capture the active Antigravity conversation and return a summary."""
    env = os.environ if env is None else env
    if not output.endswith(".jsonl"):
        raise ValueError(f"--output must use the .jsonl extension; received {to_json(output)}")
    conversation_id = conversation_id or resolve_antigravity_conversation_id(env)
    if not conversation_id:
        raise ValueError("No active Antigravity conversation ID is available; run through the active "
                         "Antigravity shell environment.")
    transcript_path = resolve_antigravity_transcript_path(conversation_id, app_data_dir, env)
    if not os.path.exists(transcript_path):
        raise ValueError(f"Could not read Antigravity transcript at {transcript_path}")

    output_path = os.path.abspath(output)
    entries = _parse_jsonl(transcript_path)
    current = extract_events(entries, conversation_id)
    existing = read_canonical_transcript(output_path) if mode == "append" else {"metadata": None, "events": []}
    if existing["metadata"] and existing["metadata"]["threadId"] != conversation_id:
        raise ValueError(f"Existing transcript belongs to {existing['metadata']['threadId']}, not {conversation_id}")
    if any(event["threadId"] != conversation_id for event in existing["events"]):
        raise ValueError("Existing transcript contains a different Antigravity conversation")

    merge = merge_events(existing["events"], current, mode)
    write_canonical_transcript(output_path, create_transcript_metadata(entries, conversation_id, merge["merged"]),
                               merge["merged"])
    return {
        "source": SOURCE,
        "mode": mode,
        "fetched": len(current),
        "added": merge["added"],
        "updated": merge["updated"],
        "events": len(merge["merged"]),
        "output": output_path,
        "truncated": sum(1 for event in merge["merged"] if event.get("captureStatus") == "source-truncated"),
    }


def summary_warnings(summary: Dict[str, Any]) -> List[str]:
    return []


EPILOG = """The conversation ID defaults to ANTIGRAVITY_CONVERSATION_ID or the current
conversation ID in ANTIGRAVITY_SOURCE_METADATA."""


def main(argv: Optional[List[str]] = None, env: Optional[Dict[str, str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0], epilog=EPILOG, allow_abbrev=False,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--conversation-id")
    parser.add_argument("--output", required=True)
    parser.add_argument("--mode", default="full", choices=("full", "append"))
    parser.add_argument("--app-data-dir")
    args = parser.parse_args(argv)
    try:
        summary = capture_from_environment(args.output, args.mode, env, conversation_id=args.conversation_id,
                                           app_data_dir=args.app_data_dir)
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(to_json(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
