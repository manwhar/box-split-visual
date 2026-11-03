#!/usr/bin/env python3
"""Extract visible user and assistant messages from a Claude Code session log.

Claude Code has no supported structured-history API, so this adapter reads
the session's own append-only JSONL log. That format is internal and
undocumented, so parsing is strictly allowlist-based: only record shapes
proven to carry conversation content are retained, and everything else —
including record types that do not exist yet — is dropped.

Two traps this guards against, both observed in a live log:
  - Tool results are stored as `type: "user"` records. Keying on the message
    role alone would file every tool result as a user turn.
  - `queue-operation` records carry a second verbatim copy of each submitted
    prompt, so denylist parsing would duplicate every user message.

    python3 extract_claude_transcript.py --output <transcript.jsonl> \\
        [--mode full|append] [--session-id <id>] \\
        [--transcript-path <absolute-jsonl>] [--projects-dir <dir>]
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import sys
from typing import Any, Dict, List, Optional

from transcript_archive import (
    canonical_output_path,
    get,
    home_dir,
    is_iso_timestamp,
    iso_from_date_string,
    js_trim,
    merge_transcript_events,
    parse_json,
    read_canonical_transcript as read_canonical_archive,
    read_text,
    split_lines,
    to_json,
    write_canonical_transcript,
)

HARNESS = "claude"
SOURCE = "claude-session-log"
# The CLI prints this adapter's summary indented; the others print one line.
SUMMARY_INDENT = 2

# Wrapper blocks Claude Code injects into message text. Only these exact
# wrappers are removed. Generic tag stripping is deliberately avoided: a real
# message can legitimately contain angle-bracket placeholders.
INJECTED_WRAPPERS = [
    re.compile(r"<system-reminder>[\s\S]*?</system-reminder>"),
    re.compile(r"<local-command-stdout>[\s\S]*?</local-command-stdout>"),
    re.compile(r"<local-command-stderr>[\s\S]*?</local-command-stderr>"),
]

# A slash-command invocation reaches the log as wrapper tags rather than as
# the text the user typed. Collapse it back to the command line a reader expects.
COMMAND_NAME = re.compile(r"<command-name>([\s\S]*?)</command-name>")
COMMAND_ARGS = re.compile(r"<command-args>([\s\S]*?)</command-args>")
COMMAND_MESSAGE = re.compile(r"<command-message>[\s\S]*?</command-message>")


def collapse_command_invocation(text: str) -> str:
    """A message that is only slash-command wrapper tags, as "/name args"."""
    name = COMMAND_NAME.search(text)
    if not name:
        return text

    remainder = COMMAND_MESSAGE.sub("", text)
    remainder = COMMAND_NAME.sub("", remainder, count=1)
    remainder = js_trim(COMMAND_ARGS.sub("", remainder, count=1))

    # Collapse only a message that is nothing but these wrappers, which is the
    # exact shape Claude Code records for a slash command. Any surrounding prose
    # means the tags are being *discussed* rather than invoked — as happens in
    # a transcript about this very format — and rewriting that would reorder
    # the message and delete content. An archive must fail toward keeping text
    # verbatim, so leave it untouched.
    if remainder:
        return text

    args = COMMAND_ARGS.search(text)
    return " ".join(part for part in (js_trim(name.group(1)), js_trim(args.group(1)) if args else "") if part)


def clean_message_text(text: str) -> str:
    """Remove injected wrappers and collapse a slash command, then trim."""
    cleaned = text
    for wrapper in INJECTED_WRAPPERS:
        cleaned = wrapper.sub("", cleaned)
    return js_trim(collapse_command_invocation(cleaned))


def _attachment_placeholder(block: Any) -> str:
    """Describe an attachment without its filename, path, data URL, or payload.

    Matches the placeholder the OpenCode adapter emits. A media type that is
    not a string is treated as unknown.
    """
    mime = get(get(block, "source"), "media_type")
    mime = mime if isinstance(mime, str) else ""
    if get(block, "type") == "image" or mime.startswith("image/"):
        return "[Image attachment]"
    if mime.startswith("audio/"):
        return "[Audio attachment]"
    return "[File attachment]"


def _block_text(content: Any) -> Optional[str]:
    """The visible text of a message's content, or None when there is none."""
    if isinstance(content, str):
        return clean_message_text(content) or None
    if not isinstance(content, list):
        return None

    # JavaScript's `typeof block === "object"` also admits arrays.
    blocks = [block for block in content if isinstance(block, (dict, list))]
    parts = [get(block, "text") for block in blocks
             if get(block, "type") == "text" and isinstance(get(block, "text"), str)]
    cleaned = clean_message_text("\n".join(parts)) if parts else ""
    if cleaned:
        return cleaned

    # A message can be nothing but an attachment. Dropping it would silently
    # remove a turn from the archive, so record that something was sent
    # without capturing what. Tool traffic is excluded before this point.
    attachments = [block for block in blocks if get(block, "type") in ("image", "document")]
    if attachments:
        return "\n".join(_attachment_placeholder(block) for block in attachments)
    return None


def parse_claude_log(source: str, source_name: str = "session.jsonl") -> Dict[str, Any]:
    """Parse the session log as {"records", "truncatedFinalLine"}.

    The file is appended to while a session runs, so the last record can be
    mid-write and is skipped (truncatedFinalLine is then true); any earlier
    malformed line is a real error.
    """
    lines = split_lines(source)
    records: List[Any] = []
    truncated_final_line = False
    for index, raw_line in enumerate(lines):
        line = js_trim(raw_line)
        if not line:
            continue
        try:
            records.append(parse_json(line))
        except ValueError as error:
            if all(not js_trim(rest) for rest in lines[index + 1:]):
                truncated_final_line = True
                continue
            raise ValueError(f"Invalid JSON in {source_name}:{index + 1}: {error}") from error
    return {"records": records, "truncatedFinalLine": truncated_final_line}


def extract_visible_events(records: List[Any], thread_id: str) -> List[Dict[str, Any]]:
    """Retain only conversation content, as canonical events.

      - assistant records contributing `text` blocks, ignoring `thinking` and
        `tool_use`
      - user records whose content is plain text and which carry no tool result

    Subagent traffic (`isSidechain`) is excluded so an agent's internal work
    does not appear as part of the conversation.
    """
    events: List[Dict[str, Any]] = []
    # Record index each event came from and the turn it joined, so phase can
    # be derived in a second pass once the shape of the whole turn is known.
    source_index: List[int] = []
    turn_of: List[Any] = []
    # Last position in each turn holding assistant activity of any kind,
    # including a tool call that produced no visible text.
    last_assistant_in_turn: Dict[Any, int] = {}
    current_turn_id: Any = None

    for index, record in enumerate(records):
        if not isinstance(record, dict) or record.get("isSidechain") is True:
            continue
        uuid = record.get("uuid")
        if not isinstance(uuid, str) or not uuid:
            continue
        role = {"user": "user", "assistant": "assistant"}.get(record.get("type")) \
            if isinstance(record.get("type"), str) else None
        if not role:
            continue

        if role == "user":
            # A tool result is stored as a user record; it is not conversation.
            # Presence counts, even with a null value (`!== undefined`).
            if "toolUseResult" in record:
                continue
            if record.get("isMeta") is True:
                continue
            # A user prompt opens a turn that its following assistant records join.
            text = _block_text(get(record.get("message"), "content"))
            if not text:
                continue
            prompt_id = record.get("promptId")
            current_turn_id = prompt_id if prompt_id is not None else uuid
            events.append(_event(thread_id, current_turn_id, uuid, role, text))
            source_index.append(index)
            turn_of.append(current_turn_id)
            continue

        turn_id = current_turn_id if current_turn_id is not None else uuid
        last_assistant_in_turn[_turn_key(turn_id)] = index
        text = _block_text(get(record.get("message"), "content"))
        if not text:
            continue
        # Phase is filled in below, once the end of the turn is known.
        events.append(_event(thread_id, turn_id, uuid, role, text))
        source_index.append(index)
        turn_of.append(turn_id)

    # Claude Code records no commentary/final-answer distinction, but it is
    # recoverable: assistant text that still has assistant activity after it
    # in the same turn is narration around tool use, while the text that ends
    # a turn is the answer. The viewer collapses runs of commentary, so
    # without this every "let me check that" line reads as a standalone reply.
    for position, event in enumerate(events):
        if event["role"] != "assistant":
            continue
        last = last_assistant_in_turn.get(_turn_key(turn_of[position]))
        event["phase"] = "commentary" if last is not None and source_index[position] < last else "final_answer"
    return events


def _turn_key(turn_id: Any) -> Any:
    """A dictionary key with JavaScript Map semantics (true is not 1)."""
    return (type(turn_id).__name__, turn_id) if isinstance(turn_id, (str, bool, int, float, type(None))) \
        else ("object", id(turn_id))


def _event(thread_id: str, turn_id: Any, item_id: str, role: str, text: str) -> Dict[str, Any]:
    return {
        "schemaVersion": 1,
        "harness": HARNESS,
        "captureStatus": "complete",
        "threadId": thread_id,
        "turnId": turn_id,
        "itemId": item_id,
        "role": role,
        "phase": None,
        "text": text,
    }


def create_transcript_metadata(thread_id: str, records: List[Any],
                               events: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The archive's metadata record.

    The start time comes from retained conversation records only, so the
    value never depends on an internal record type that may disappear. As in
    the original, the earliest timestamp *string* is chosen, then normalized.
    """
    retained = {event["itemId"] for event in events}
    timestamps = sorted(
        record["timestamp"] for record in records
        if isinstance(record, dict) and isinstance(record.get("uuid"), str) and record["uuid"] in retained
        and is_iso_timestamp(record.get("timestamp"))
    )
    metadata: Dict[str, Any] = {
        "schemaVersion": 1,
        "recordType": "metadata",
        "harness": HARNESS,
        "captureStatus": "complete",
        "threadId": thread_id,
    }
    if timestamps:
        metadata["conversationStartedAt"] = iso_from_date_string(timestamps[0])
    return metadata


def claude_projects_dir(explicit: Optional[str] = None, env: Optional[Dict[str, str]] = None) -> str:
    """`$CLAUDE_CONFIG_DIR/projects`, defaulting to `~/.claude/projects`."""
    if explicit:
        return explicit
    env = os.environ if env is None else env
    return os.path.join(env.get("CLAUDE_CONFIG_DIR") or os.path.join(home_dir(env), ".claude"), "projects")


def resolve_claude_transcript_path(session_id: str, projects_dir: Optional[str] = None,
                                   env: Optional[Dict[str, str]] = None) -> str:
    """Locate the log by session ID rather than reconstructing Claude's directory naming.

    Exactly one match is required: a session is never selected by recency or
    working directory.
    """
    root = claude_projects_dir(projects_dir, env)
    if not os.path.exists(root):
        raise ValueError(f"No Claude projects directory at {root}.")
    matches = []
    for entry in sorted(os.scandir(root), key=lambda item: item.name):
        if not entry.is_dir(follow_symlinks=False):
            continue
        candidate = os.path.join(root, entry.name, f"{session_id}.jsonl")
        if os.path.exists(candidate):
            matches.append(candidate)
    if not matches:
        raise ValueError(f"No Claude session log for {session_id} under {root}.")
    if len(matches) > 1:
        listed = "\n  ".join(matches)
        raise ValueError(f"Multiple Claude session logs for {session_id}:\n  {listed}\n"
                         "Pass --transcript-path to choose one.")
    return matches[0]


def read_canonical_transcript(path: str) -> Dict[str, Any]:
    """The shared reader, restricted to Claude Code records."""
    return read_canonical_archive(path, harness=HARNESS)


def capture_claude_transcript(output: str, mode: str, session_id: str,
                              transcript_path: Optional[str] = None,
                              projects_dir: Optional[str] = None,
                              env: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Capture one session log into a canonical archive and return a summary."""
    log_path = transcript_path or resolve_claude_transcript_path(session_id, projects_dir, env)
    canonical = canonical_output_path(output)
    parsed = parse_claude_log(read_text(log_path), Path(log_path).name)
    records = parsed["records"]

    # Every record carries the session it belongs to. An explicit
    # --transcript-path could point at a different conversation, and because
    # append identity is threadId/turnId/itemId, labelling one log with
    # another session's ID would let two conversations merge into one archive.
    logged = next((record["sessionId"] for record in records if isinstance(record, dict)
                   and isinstance(record.get("sessionId"), str) and record["sessionId"]), None)
    if logged and logged != session_id:
        raise ValueError(f"{log_path} belongs to session {logged}, not {session_id}. "
                         "Pass a matching --session-id, or omit --transcript-path to resolve the log by ID.")

    current = extract_visible_events(records, session_id)
    existing = read_canonical_transcript(canonical)["events"] if mode == "append" else []
    merge = merge_transcript_events(existing, current, mode)
    events = merge["merged"]
    write_canonical_transcript(canonical, create_transcript_metadata(session_id, records, events), events)
    return {
        "source": SOURCE,
        "transcriptPath": log_path,
        "threadId": session_id,
        "output": canonical,
        "mode": mode,
        "added": merge["added"],
        "updated": merge["updated"],
        "total": len(events),
        "truncatedFinalLine": parsed["truncatedFinalLine"],
    }


def summary_warnings(summary: Dict[str, Any]) -> List[str]:
    """Notes to print on stderr after a successful capture."""
    if summary.get("truncatedFinalLine"):
        return ["The session log ended with a partial record, which is expected while a session is active. "
                "It was skipped; a later append captures it."]
    return []


def capture_from_environment(output: str, mode: str, env: Optional[Dict[str, str]] = None,
                             session_id: Optional[str] = None, **options: Any) -> Dict[str, Any]:
    """Capture the session named by CLAUDE_CODE_SESSION_ID (or `session_id`)."""
    env = os.environ if env is None else env
    session_id = session_id or env.get("CLAUDE_CODE_SESSION_ID")
    if not session_id:
        raise ValueError("No Claude session ID is available. Run from a Claude Code Bash tool call with "
                         "CLAUDE_CODE_SESSION_ID set, or pass --session-id explicitly.")
    return capture_claude_transcript(output=output, mode=mode, session_id=session_id, env=env, **options)


EPILOG = """The session ID defaults to CLAUDE_CODE_SESSION_ID, which Claude Code exports
into every Bash tool call. The log is located by that ID under the Claude
projects directory. Never select a session by directory or recency."""


def main(argv: Optional[List[str]] = None, env: Optional[Dict[str, str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0], epilog=EPILOG, allow_abbrev=False,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mode", default="full", choices=("full", "append"))
    parser.add_argument("--session-id")
    parser.add_argument("--transcript-path")
    parser.add_argument("--projects-dir")
    args = parser.parse_args(argv)
    try:
        summary = capture_from_environment(args.output, args.mode, env, session_id=args.session_id,
                                           transcript_path=args.transcript_path, projects_dir=args.projects_dir)
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(to_json(summary, indent=SUMMARY_INDENT))
    for warning in summary_warnings(summary):
        print(warning, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
