#!/usr/bin/env python3
"""Discover or render normalized transcript JSONL files.

    python3 render_transcript.py --input <transcript.jsonl> [--output <viewer.html>]
    python3 render_transcript.py --discover <workspace-directory>

Rendering validates the archive and writes a self-contained HTML page with
the transcript embedded, so the page opens in any browser with nothing else
installed. When --output is omitted, the page is written to the active
Antigravity session artifact folder (if available) or the operating
system's temporary directory. Discovery returns JSON metadata for valid
normalized transcripts without exposing message text. Input transcripts are
never changed.

The viewer template (../assets/transcript-viewer.html) also works on its own:
opened directly in a browser, it shows a drop zone and a file picker that
load a transcript JSONL locally, with no renderer at all.

Python 3.9+ standard library only.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import tempfile
from typing import Any, Dict, List, Optional

from transcript_archive import (
    CAPTURE_STATUSES,
    diagnose_transcript,
    format_diagnostics,
    is_iso_timestamp,
    is_one,
    js_trim,
    parse_json,
    read_text,
    split_lines,
    to_json,
    transcripts_dir,
    write_atomic,
)

TEMPLATE = Path(__file__).resolve().parent.parent / "assets" / "transcript-viewer.html"
# The empty state the template ships with; rendering replaces it with the data.
MARKER = '{"name":null,"metadata":null,"events":[]}'


def _optional_status(record: Dict[str, Any]) -> bool:
    """captureStatus is optional, but when present (even null) must be a known status."""
    return "captureStatus" not in record or (
        isinstance(record["captureStatus"], str) and record["captureStatus"] in CAPTURE_STATUSES)


def is_viewable_event(value: Any) -> bool:
    """Whether a record can be shown as a message (looser than the archive writer)."""
    if not isinstance(value, dict):
        return False
    phase = value.get("phase", ())  # () stands for "absent", which is invalid
    return (
        is_one(value.get("schemaVersion"))
        and isinstance(value.get("harness"), str) and len(value["harness"]) > 0
        and _optional_status(value)
        and ("conversationStartedAt" not in value or isinstance(value["conversationStartedAt"], str))
        and isinstance(value.get("threadId"), str)
        and isinstance(value.get("turnId"), str)
        and isinstance(value.get("itemId"), str)
        and isinstance(value.get("role"), str) and value["role"] in ("user", "assistant")
        and (phase is None or isinstance(phase, str))
        and isinstance(value.get("text"), str)
    )


def is_transcript_metadata(value: Any) -> bool:
    """Whether a record is the viewer's metadata record."""
    if not isinstance(value, dict):
        return False
    return (
        is_one(value.get("schemaVersion"))
        and value.get("recordType") == "metadata"
        and isinstance(value.get("harness"), str) and len(value["harness"]) > 0
        and _optional_status(value)
        and isinstance(value.get("threadId"), str)
        and ("conversationStartedAt" not in value or is_iso_timestamp(value["conversationStartedAt"]))
    )


def parse_transcript_document(source: str, source_name: str = "transcript.jsonl") -> Dict[str, Any]:
    """Parse and validate archive text as {"metadata", "events"}.

    Raises ValueError naming the exact line of any malformed record, so
    arbitrary JSONL is never displayed as chat history.
    """
    metadata = None
    events: List[Dict[str, Any]] = []
    for index, raw_line in enumerate(split_lines(source)):
        line = js_trim(raw_line)
        if not line:
            continue
        try:
            value = parse_json(line)
        except ValueError as error:
            raise ValueError(f"Invalid JSON in {source_name}:{index + 1}: {error}") from error
        if is_transcript_metadata(value):
            if metadata is not None or events:
                raise ValueError("Transcript metadata must be the first and only metadata record in "
                                 f"{source_name}:{index + 1}")
            metadata = value
            continue
        if not is_viewable_event(value):
            raise ValueError(f"Invalid normalized transcript event in {source_name}:{index + 1}")
        events.append(value)
    return {"metadata": metadata, "events": events}


def parse_transcript_jsonl(source: str, source_name: str = "transcript.jsonl") -> List[Dict[str, Any]]:
    """Only the events of parse_transcript_document."""
    return parse_transcript_document(source, source_name)["events"]


def safe_embedded_json(value: Any) -> str:
    """JSON that cannot end the <script> it is embedded in or break its parsing.

    "<", ">" and "&" are escaped so message text such as "</script>" stays
    data, and U+2028/U+2029 because older JavaScript engines treat them as
    line breaks inside string literals.
    """
    return (to_json(value)
            .replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("&", "\\u0026")
            .replace(" ", "\\u2028")
            .replace(" ", "\\u2029"))


def render_transcript_html(template: str, name: str, events: List[Dict[str, Any]],
                           metadata: Optional[Dict[str, Any]] = None) -> str:
    """The viewer page with this transcript embedded in place of its empty state.

    The replacement is literal, so message text containing "$$", "$&" or
    "$'" (LaTeX "$$x$$", for one) is embedded exactly as written; a
    pattern-aware replacement such as JavaScript's String.replace would
    rewrite those sequences.
    """
    if MARKER not in template:
        raise ValueError("Transcript viewer template is missing its data marker")
    return template.replace(MARKER, safe_embedded_json({"name": name, "metadata": metadata, "events": events}), 1)


def find_jsonl_files(root_path: str) -> List[str]:
    """Every *.jsonl file under root_path, skipping hidden folders and node_modules.

    Symbolic links are neither followed nor listed, so discovery cannot leave
    the folder it was given. Results are in sorted path order.
    """
    matches: List[str] = []

    def walk(current: str) -> None:
        try:
            entries = sorted(os.scandir(current), key=lambda entry: entry.name)
        except OSError:
            return
        for entry in entries:
            if entry.is_dir(follow_symlinks=False):
                if not entry.name.startswith(".") and entry.name != "node_modules":
                    walk(entry.path)
            elif entry.is_file(follow_symlinks=False) and entry.name.endswith(".jsonl"):
                matches.append(entry.path)

    walk(root_path)
    return matches


def _iso_mtime(path: str) -> str:
    """A file's modification time as `Date.toISOString()` writes it (milliseconds, Z)."""
    milliseconds = os.stat(path).st_mtime_ns // 1_000_000
    moment = datetime.fromtimestamp(milliseconds / 1000, tz=timezone.utc)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{milliseconds % 1000:03d}Z"


def discover_transcripts(root: str, env: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
    """Summaries of every valid transcript under root and in the default archive folder.

    Each summary has the path, a workspace-relative path (absolute outside
    the workspace), message count, harnesses, capture statuses, thread
    count, earliest start time, and modification time — never message text.
    Newest first.
    """
    root_path = os.path.abspath(root)
    search_roots = [root_path]
    # Include the default archive directory unless it already lives under the
    # workspace, so a transcript saved with no --output is still discoverable.
    default_dir = os.path.abspath(transcripts_dir(env))
    if os.path.exists(default_dir) and not default_dir.startswith(root_path + os.sep) and default_dir != root_path:
        search_roots.append(default_dir)

    seen = set()
    candidates = []
    for path in (path for search_root in search_roots for path in find_jsonl_files(search_root)):
        if path in seen:
            continue
        seen.add(path)
        try:
            document = parse_transcript_document(read_text(path), path)
        except (OSError, ValueError):
            continue
        metadata, events = document["metadata"], document["events"]
        if not events:
            continue
        candidate = {
            "path": path,
            # A path outside the workspace stays absolute rather than becoming
            # a long chain of "../" segments.
            "relativePath": os.path.relpath(path, root_path) if path.startswith(root_path + os.sep) else path,
            "events": len(events),
            "harnesses": sorted({value for value in [(metadata or {}).get("harness"),
                                                     *(event["harness"] for event in events)] if value}),
            "captureStatuses": sorted({value or "unspecified" for value in [
                (metadata or {}).get("captureStatus"), *(event.get("captureStatus") for event in events)]}),
            "threads": len({event["threadId"] for event in events}),
        }
        started = _earliest_conversation_start(metadata, events)
        if started:
            candidate["startedAt"] = started
        candidate["modifiedAt"] = _iso_mtime(path)
        candidates.append(candidate)

    # Newest first, then by path. (The original's localeCompare tie-break is
    # approximated with a case-insensitive comparison.)
    candidates.sort(key=lambda item: (item["relativePath"].casefold(), item["relativePath"]))
    candidates.sort(key=lambda item: item["modifiedAt"], reverse=True)
    return candidates


def _earliest_conversation_start(metadata: Optional[Dict[str, Any]], events: List[Dict[str, Any]]) -> Optional[str]:
    values = sorted(value for value in [(metadata or {}).get("conversationStartedAt"),
                                        *(event.get("conversationStartedAt") for event in events)]
                    if isinstance(value, str) and is_iso_timestamp(value))
    return values[0] if values else None


def resolve_default_output_path(input_path: str, conversation_id: Optional[str] = None,
                                custom_app_data_dir: Optional[str] = None,
                                env: Optional[Dict[str, str]] = None) -> str:
    """Where the viewer goes when no --output is given.

    In Antigravity, the active conversation's artifact folder, so the page
    renders in its side pane; otherwise the system temporary directory.
    """
    env = os.environ if env is None else env
    stem = Path(input_path).stem
    active = conversation_id or env.get("ANTIGRAVITY_CONVERSATION_ID")
    if active:
        # Imported here: only this branch needs the Antigravity folder rules.
        from extract_antigravity_transcript import app_data_dirs
        for directory in app_data_dirs(custom_app_data_dir, env):
            artifact_dir = os.path.join(directory, "brain", active)
            if os.path.exists(artifact_dir):
                return os.path.join(artifact_dir, f"{stem}-transcript-viewer.html")
    return os.path.join(tempfile.gettempdir(), f"{stem}-transcript-viewer.html")


def render_file(input_path: str, output_path: Optional[str] = None) -> Dict[str, Any]:
    """Validate a transcript and write its viewer; returns paths, counts and diagnostics."""
    input_path = os.path.abspath(input_path)
    if os.path.splitext(input_path)[1].lower() != ".jsonl":
        raise ValueError(f"--input must use the .jsonl extension; received {to_json(input_path)}")
    resolved_output = os.path.abspath(output_path or resolve_default_output_path(input_path))
    if os.path.splitext(resolved_output)[1].lower() != ".html":
        raise ValueError(f"--output must use the .html extension; received {to_json(output_path)}")

    document = parse_transcript_document(read_text(input_path), input_path)
    metadata, events = document["metadata"], document["events"]
    html = render_transcript_html(read_text(TEMPLATE), Path(input_path).name, events, metadata)
    write_atomic(resolved_output, html)
    return {
        "input": input_path,
        "output": resolved_output,
        "events": len(events),
        "harnesses": list(dict.fromkeys(value for value in [(metadata or {}).get("harness"),
                                                            *(event["harness"] for event in events)] if value)),
        "threads": len({event["threadId"] for event in events}),
        # Not part of the printed summary: reported on stderr instead.
        "diagnostics": diagnose_transcript(events),
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], allow_abbrev=False,
                                     formatter_class=argparse.RawDescriptionHelpFormatter,
                                     epilog="\n\n".join(__doc__.split("\n\n")[1:3]))
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--input")
    group.add_argument("--discover")
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    try:
        if args.discover:
            root = os.path.abspath(args.discover)
            print(to_json({"root": root, "transcripts": discover_transcripts(root)}, indent=2))
            return 0
        result = render_file(args.input, args.output)
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    # Report the same structural problems the capture step checks for, so an
    # archive written before this check existed is still flagged when viewed.
    diagnostics = result.pop("diagnostics")
    if diagnostics:
        print(format_diagnostics(diagnostics, result["input"]), file=sys.stderr)
    print(to_json(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
