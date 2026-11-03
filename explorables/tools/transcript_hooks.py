#!/usr/bin/env python3
"""Completion hooks for registered explorable author conversations.

Configured by setup_transcript_hooks.py. Hooks read JSON on stdin and always
allow the agent to finish. Failed saves remain pending and block submission.
Use --recover PAPER to retry those saves, including from a normal terminal.
"""
from __future__ import annotations

import argparse
import contextlib
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import sys

import capture_transcript as capture
import transcript_state as state

ROOT = Path(__file__).resolve().parents[2]
EVENTS = {
    "codex": ("UserPromptSubmit", "Stop"),
    "claude": ("UserPromptSubmit", "Stop", "StopFailure"),
    "antigravity": ("Stop",),
    "opencode": ("UserPromptSubmit", "Stop", "StopFailure"),
}


def environment(harness: str, session: str, env=None) -> dict:
    env = dict(os.environ if env is None else env)
    for key in (*capture.SESSION_VARIABLES.values(), "ANTIGRAVITY_SOURCE_METADATA"):
        env.pop(key, None)
    env[capture.SESSION_VARIABLES[harness]] = session
    return env


def registered_folder(root: Path, env: dict) -> Path | None:
    """Only a previous explicit capture associates a chat with a paper."""
    matches = []
    for folder in sorted((root / "explorables").iterdir()):
        if folder.name.startswith(("_", ".")) or not folder.is_dir():
            continue
        output = capture.destination(folder, env)
        if state.state_path(output).exists():
            state.guard(output)
            state.read(output, *capture.identity(env))
            matches.append(folder)
    if len(matches) > 1:
        raise ValueError("This conversation is registered to more than one paper; resolve that association first.")
    return matches[0] if matches else None


def source_options(harness: str, session: str, payload: dict) -> dict:
    if harness == "claude" and payload.get("transcript_path"):
        path = Path(payload["transcript_path"]).expanduser()
        if not path.is_absolute():
            raise ValueError("Claude's hook transcript_path must be absolute.")
        return {"transcript_path": str(path)}
    if harness == "antigravity" and payload.get("transcriptPath"):
        path = Path(payload["transcriptPath"]).expanduser()
        # Antigravity may pass either transcript_full.jsonl or the sibling
        # compact transcript.jsonl. Use only the full log via the shared
        # adapter, checking the session embedded in the path.
        if (not path.is_absolute() or len(path.parts) < 6
                or path.parts[-5:-1] != ("brain", session, ".system_generated", "logs")
                or path.name not in ("transcript.jsonl", "transcript_full.jsonl")):
            raise ValueError("Antigravity's hook transcriptPath does not match its conversation.")
        return {"app_data_dir": str(path.parents[4])}
    return {}


def expectation(harness: str, event: str, payload: dict, data: dict, root: Path) -> dict:
    if event != "Stop" or data.get("failedGeneration") or (harness == "antigravity" and
                            (payload.get("terminationReason") != "model_stop" or not payload.get("fullyIdle"))):
        return {"kind": "checkpoint"}
    result = {"kind": "settled", "after": data.get("baseline")}
    text = payload.get("last_assistant_message")
    if isinstance(text, str) and text.strip():
        if harness == "claude":
            text = capture.load_extractor(root).adapter_for(harness).clean_message_text(text)
        result.update(kind="text", digest=state.digest(text))
    if harness == "codex" and payload.get("turn_id"):
        result["turnId"] = payload["turn_id"]
        # The runtime turn ID is stronger than a checkpoint's position.
        result.pop("after", None)
    elif harness == "opencode" and data.get("lastPrompt"):
        # OpenCode does not await event callbacks. Its reply can already be
        # persisted when the queued user checkpoint starts; use the actual
        # parent prompt ID instead of excluding everything read at that time.
        result["turnId"] = data["lastPrompt"]
        result.pop("after", None)
    return result


def handle(harness: str, event: str, payload: dict, *, root: Path = ROOT,
           env=None, retry_seconds: float = 8) -> str | None:
    """Return an actionable warning, or None. Never request agent continuation."""
    if harness not in EVENTS or event not in EVENTS[harness]:
        raise ValueError(f"Unsupported transcript hook: {harness}/{event}")
    session = payload.get("conversationId" if harness == "antigravity" else "session_id")
    if not isinstance(session, str) or not session.strip():
        raise ValueError("The hook did not provide an exact conversation ID.")
    active = environment(harness, session, env)
    folder = registered_folder(root, active)
    if folder is None:
        return None
    output = capture.destination(folder, active)
    with state.locked(output):
        data = state.read(output, harness, session)
        # Record an unfinished save before processing payload/source details,
        # so even a malformed source path cannot leave a silently stale ZIP.
        data["error"] = "Transcript hook has not completed."
        state.write(output, data)
        try:
            prompt = payload.get("prompt_id")
            new_prompt = event == "UserPromptSubmit" and (not prompt or prompt != data.get("lastPrompt"))
            if new_prompt or (harness == "antigravity" and event == "Stop"
                              and payload.get("terminationReason") == "model_stop"):
                data["failedGeneration"] = False
            if new_prompt and prompt:
                data["lastPrompt"] = prompt
            if event == "StopFailure":
                # OpenCode emits error followed by idle even if no answer was
                # generated. Keep that idle a checkpoint, including on retry.
                data["failedGeneration"] = True
            data["source"].update(source_options(harness, session, payload))
            expected = expectation(harness, event, payload, data, root)
            if expected not in data["pending"]:
                data["pending"].append(expected)
            state.write(output, data)
            with contextlib.redirect_stdout(io.StringIO()):
                capture.refresh(folder, data, root=root, env=active, retry_seconds=retry_seconds,
                                advance_from_user=(harness == "antigravity" and event == "Stop"))
            if event == "UserPromptSubmit" and new_prompt:
                # A duplicate OpenCode message event must not move the baseline
                # past an assistant that has already started responding.
                data["baseline"] = state.baseline(capture.validate(output.read_bytes()))
            data["lastHook"] = {"event": event, "at": datetime.now(timezone.utc).isoformat(),
                                "status": {"text": "verified", "settled": "source-settled",
                                           "checkpoint": "checkpoint"}[expected["kind"]]}
            state.write(output, data)
            return None
        except (OSError, ValueError) as error:
            data["error"] = str(error)
            state.write(output, data)
            return (f"Explorable transcript save is pending: {error} "
                    f"Retry with python3 explorables/tools/transcript_hooks.py --recover {folder.name}. "
                    "Submission will wait for the saved conversation.")


def recover(folder: Path, *, root: Path = ROOT, env=None) -> None:
    """Refresh every explicitly registered chat, not a guessed recent session."""
    for path in sorted((folder / "transcripts/.capture").glob("*.json")):
        meta = json.loads(path.read_text(encoding="utf-8"))
        active = environment(meta["harness"], meta["session"], env)
        output = capture.destination(folder, active)
        if state.state_path(output) != path:
            raise ValueError(f"Transcript registration has the wrong filename: {path}")
        with state.locked(output):
            data = state.read(output, *capture.identity(active))
            capture.refresh(folder, data, root=root, env=active, retry_seconds=8)
    state.check_submission(folder)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--harness", choices=tuple(EVENTS))
    parser.add_argument("--event")
    parser.add_argument("--owner", help=argparse.SUPPRESS)
    parser.add_argument("--recover", metavar="PAPER")
    args = parser.parse_args(argv)
    if args.recover:
        from package_explorable import choose
        try:
            recover(choose(args.recover, ROOT / "explorables"))
        except (OSError, ValueError, KeyError, TypeError) as error:
            parser.exit(1, f"Transcript recovery failed: {error}\n")
        print("Registered conversations refreshed.")
        return 0
    if not args.harness or not args.event:
        parser.error("hooks require --harness and --event")
    warning = None
    try:
        payload = json.load(sys.stdin)
        if not isinstance(payload, dict):
            raise ValueError("Hook input must be a JSON object.")
        warning = handle(args.harness, args.event, payload)
    except (OSError, ValueError, KeyError, TypeError) as error:
        warning = f"Explorable transcript hook failed: {error}"
    # Stdout is a protocol channel, never extractor reports or chat text.
    response = {"decision": "stop"} if args.harness == "antigravity" and args.event == "Stop" else {}
    if warning:
        print(warning, file=sys.stderr)
        if args.harness in ("codex", "claude", "opencode"):
            response["systemMessage"] = warning
    print(json.dumps(response))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
