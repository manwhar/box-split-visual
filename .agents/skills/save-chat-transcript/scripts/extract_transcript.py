#!/usr/bin/env python3
"""Detect the active harness and delegate to its exact-history adapter.

    python3 extract_transcript.py [--output <transcript.jsonl>] [--mode full|append]

Without --output the archive is written to
$T4G_HOME/transcripts/<YYYYMMDDHHMM>-<harness>-<session>.jsonl, reusing this
conversation's existing archive when one is already there.

The active harness and conversation identity are detected from the shell
environment. The command fails instead of reconstructing a partial transcript.

Other tools can call capture() directly instead of running this file; it
returns the adapter's summary and the archive's diagnostics and raises on
failure. Python 3.9+ standard library only.
"""
from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
import re
import sqlite3
import sys
from types import ModuleType
from typing import Any, Dict, List, Optional

import extract_antigravity_transcript
import extract_claude_transcript
import extract_codex_transcript
import extract_opencode_transcript
from transcript_archive import (
    canonical_output_path,
    diagnose_transcript,
    format_diagnostics,
    get,
    read_canonical_transcript,
    to_json,
    transcripts_dir,
)

__all__ = ["ADAPTERS", "adapter_for", "capture", "default_output_path", "detect_harness", "session_slug",
           "transcripts_dir"]

# Each adapter module exposes capture_from_environment(output, mode, env),
# summary_warnings(summary), and SUMMARY_INDENT for printing its summary.
ADAPTERS: Dict[str, ModuleType] = {
    "codex": extract_codex_transcript,
    "opencode": extract_opencode_transcript,
    "claude": extract_claude_transcript,
    "antigravity": extract_antigravity_transcript,
}

SESSION_VARIABLES = {
    "codex": "CODEX_THREAD_ID",
    "opencode": "T4G_OPENCODE_SESSION_ID",
    "claude": "CLAUDE_CODE_SESSION_ID",
    "antigravity": "ANTIGRAVITY_CONVERSATION_ID",
}


def _antigravity_conversation_id(env: Dict[str, str]) -> Optional[str]:
    if env.get("ANTIGRAVITY_CONVERSATION_ID"):
        return env["ANTIGRAVITY_CONVERSATION_ID"]
    if not env.get("ANTIGRAVITY_SOURCE_METADATA"):
        return None
    try:
        conversation = get(get(json.loads(env["ANTIGRAVITY_SOURCE_METADATA"]), "tool"), "conversationId")
    except ValueError:
        return None
    return conversation if isinstance(conversation, str) and conversation else None


def detect_harness(env: Optional[Dict[str, str]] = None) -> str:
    """Detect the single active harness from its session identifier.

    This mirrors the detection in
    plugins-core/freeze/skills/check-freeze/scripts/t4g-freeze-state.sh, which
    resolves the freeze boundary from the same four variables. The two are
    deliberately independent — one is a shell script the freeze skills call
    directly — so a harness added to either must be added to both.
    """
    env = os.environ if env is None else env
    candidates = []
    if env.get("CODEX_THREAD_ID"):
        candidates.append("codex")
    if env.get("T4G_OPENCODE_SESSION_ID"):
        candidates.append("opencode")
    if env.get("CLAUDE_CODE_SESSION_ID"):
        candidates.append("claude")
    if _antigravity_conversation_id(env):
        candidates.append("antigravity")
    if not candidates:
        raise ValueError("No exact transcript source is available for the active harness. "
                         "Context reconstruction is intentionally unsupported.")
    if len(candidates) > 1:
        raise ValueError(f"Multiple active harness identities were detected: {', '.join(candidates)}")
    return candidates[0]


def adapter_for(harness: str) -> ModuleType:
    """The adapter module that captures this harness."""
    return ADAPTERS[harness]


def session_slug(harness: str, env: Optional[Dict[str, str]] = None) -> str:
    """Short, filesystem-safe fragment identifying the conversation."""
    env = os.environ if env is None else env
    raw = (_antigravity_conversation_id(env) or "") if harness == "antigravity" \
        else env.get(SESSION_VARIABLES[harness]) or ""
    return re.sub(r"[^A-Za-z0-9]", "", raw)[:12] or "session"


def default_output_path(harness: str, env: Optional[Dict[str, str]] = None,
                        now: Optional[datetime] = None) -> str:
    """Where a transcript goes when the caller names no destination.

    `$T4G_HOME/transcripts/<YYYYMMDDHHMM>-<harness>-<session>.jsonl`, with the
    local time. The timestamp records when the archive was first created, so
    an existing archive for this conversation is reused rather than a second
    one started on the next minute. Without that, `--mode append` with a
    default destination would silently begin a fresh file every run.
    """
    env = os.environ if env is None else env
    directory = transcripts_dir(env)
    suffix = f"-{harness}-{session_slug(harness, env)}.jsonl"
    if os.path.exists(directory):
        existing = sorted(name for name in os.listdir(directory) if name.endswith(suffix))
        if existing:
            return os.path.join(directory, existing[-1])
    return os.path.join(directory, f"{(now or datetime.now()).strftime('%Y%m%d%H%M')}{suffix}")


def capture(mode: str = "append", output: Optional[str] = None,
            env: Optional[Dict[str, str]] = None, **source_options) -> Dict[str, Any]:
    """Capture the active conversation in this process.

    Returns {"harness", "output", "summary", "warnings", "diagnostics"}:
    the adapter's summary, notes it would print on stderr, and the
    structural problems found in the archive just written. Raises ValueError
    (or OSError) instead of writing anything when exact history is unavailable.
    """
    if mode not in ("full", "append"):
        raise ValueError(f'--mode must be "full" or "append"; received {to_json(mode)}')
    env = dict(os.environ if env is None else env)
    harness = detect_harness(env)
    output = canonical_output_path(output) if output else default_output_path(harness, env)
    adapter = adapter_for(harness)
    try:
        summary = adapter.capture_from_environment(output, mode, env, **source_options)
    except sqlite3.Error as error:
        raise ValueError(f"Could not read the OpenCode database: {error}") from error

    # Check the archive that was just written. A phase-classification failure
    # is invisible in the JSONL and only surfaces when a human opens the
    # viewer, so the capture step reports it rather than leaving it to be
    # noticed later.
    diagnostics = diagnose_transcript(read_canonical_transcript(output)["events"])
    return {"harness": harness, "output": output, "summary": summary,
            "warnings": adapter.summary_warnings(summary), "diagnostics": diagnostics}


def report(result: Dict[str, Any], out=None, err=None) -> None:
    """Print a capture result the way the command line does."""
    out, err = out or sys.stdout, err or sys.stderr
    print(to_json(result["summary"], indent=adapter_for(result["harness"]).SUMMARY_INDENT), file=out)
    for warning in result["warnings"]:
        print(warning, file=err)
    if result["diagnostics"]:
        print(format_diagnostics(result["diagnostics"], result["output"], leading_blank=True), file=err)
        print("Report these rather than treating the transcript as clean.", file=err)


def main(argv: Optional[List[str]] = None, env: Optional[Dict[str, str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], allow_abbrev=False,
                                     epilog="\n\n".join(__doc__.split("\n\n")[2:4]),
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output")
    parser.add_argument("--mode", default="full", choices=("full", "append"))
    args = parser.parse_args(argv)
    try:
        result = capture(args.mode, args.output, env)
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    report(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
