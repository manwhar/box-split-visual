#!/usr/bin/env python3
"""Extract user-visible messages from a persisted Codex thread.

The script uses the supported Codex App Server `thread/read` method instead
of parsing Codex's unstable rollout/transcript JSONL files. The canonical
JSONL transcript is the only persisted output and the append/deduplication
source of truth.

    python3 extract_codex_transcript.py --output <transcript.jsonl> \\
        [--mode full|append] [--thread-id <id>] [--timeout-ms <milliseconds>]
"""
from __future__ import annotations

import argparse
import math
import os
import queue
import re
import signal
import subprocess
import sys
import threading
from typing import Any, Dict, List, Optional, Sequence

from transcript_archive import (
    event_key,  # noqa: F401  (re-exported for callers of this adapter)
    get,
    is_number,
    js_string,
    js_trim,
    js_truthy,
    merge_transcript_events,
    normalize_timestamp,
    parse_json,
    read_canonical_transcript as read_canonical_archive,
    serialize_canonical_transcript,  # noqa: F401  (re-exported)
    to_json,
    write_canonical_transcript,
)

HARNESS = "codex"
SOURCE = "codex-app-server"
SUMMARY_INDENT = None
# How much of the app server's stderr is kept for error messages.
STDERR_LIMIT = 16_000


def _as_list(value: Any) -> List[Any]:
    """`value ?? []` for a field that should be an array; anything else is empty."""
    return value if isinstance(value, list) else []


def _user_message_text(content: List[Any]) -> str:
    """The text of a user message, or attachment placeholders when it has none."""
    text = "\n".join(get(part, "text") for part in content
                     if get(part, "type") == "text" and isinstance(get(part, "text"), str))
    if js_trim(text):
        return text

    # Preserve the existence of attachment-only messages without copying local
    # paths, data URLs, or other potentially sensitive attachment metadata.
    attachments = []
    for part in content:
        kind, name = get(part, "type"), get(part, "name")
        if kind in ("image", "localImage"):
            attachments.append("[Image attachment]")
        elif kind in ("audio", "localAudio"):
            attachments.append("[Audio attachment]")
        elif kind == "skill" and js_truthy(name):
            attachments.append(f"[Skill: {js_string(name)}]")
        elif kind == "mention" and js_truthy(name):
            attachments.append(f"[Mention: {js_string(name)}]")
    return "\n".join(attachments)


def extract_visible_events(thread: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Normalize only user-visible chat items.

    Tool calls, reasoning, plans, hook prompts, file changes, and other
    protocol items are excluded structurally. Message text is kept exactly,
    including leading and trailing whitespace.
    """
    events: List[Dict[str, Any]] = []
    for turn in _as_list(get(thread, "turns")):
        for item in _as_list(get(turn, "items")):
            item_id = get(item, "id")
            if not js_truthy(item_id):
                continue
            kind = get(item, "type")
            if kind == "userMessage":
                text = _user_message_text(_as_list(get(item, "content")))
                if not text:
                    continue
                events.append(_event(thread, turn, item_id, "user", None, text))
            elif kind == "agentMessage" and isinstance(get(item, "text"), str):
                text = item["text"]
                if not js_trim(text):
                    continue
                phase = item.get("phase")
                phase = phase if phase in ("commentary", "final_answer") and isinstance(phase, str) else None
                events.append(_event(thread, turn, item_id, "assistant", phase, text))
    return events


def _event(thread: Dict[str, Any], turn: Dict[str, Any], item_id: Any, role: str,
           phase: Optional[str], text: str) -> Dict[str, Any]:
    return {
        "schemaVersion": 1,
        "harness": HARNESS,
        "captureStatus": "complete",
        "threadId": thread.get("id"),
        "turnId": turn.get("id"),
        "itemId": item_id,
        "role": role,
        "phase": phase,
        "text": text,
    }


def create_transcript_metadata(thread: Dict[str, Any]) -> Dict[str, Any]:
    """The archive's metadata record; createdAt is seconds or milliseconds."""
    metadata: Dict[str, Any] = {
        "schemaVersion": 1,
        "recordType": "metadata",
        "harness": HARNESS,
        "captureStatus": "complete",
        "threadId": thread.get("id"),
    }
    created = thread.get("createdAt")
    started = normalize_timestamp(created) if is_number(created) else None
    if started:
        metadata["conversationStartedAt"] = started
    return metadata


def read_canonical_transcript(path: str) -> List[Dict[str, Any]]:
    """The events of an existing Codex archive (the shared reader, events only)."""
    return read_canonical_archive(path, harness=HARNESS)["events"]


class _AppServer:
    """A minimal JSON-RPC client for `codex app-server` over stdin/stdout.

    Responses are read on a background thread so a request can time out
    while the server is silent, and stderr is drained on another so a chatty
    server cannot block on a full pipe. The last STDERR_LIMIT characters of
    stderr are kept to explain failures.
    """

    def __init__(self, command: Sequence[str]):
        try:
            self.process = subprocess.Popen(
                list(command), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, encoding="utf-8", errors="replace", bufsize=1)
        except OSError as error:
            raise ValueError(f"Could not start Codex App Server: {error}") from error
        self.responses: "queue.Queue[Optional[Dict[str, Any]]]" = queue.Queue()
        self.stderr = ""
        self.next_id = 1
        self.readers = [threading.Thread(target=self._read_stdout, daemon=True),
                        threading.Thread(target=self._read_stderr, daemon=True)]
        for reader in self.readers:
            reader.start()

    def _read_stdout(self) -> None:
        for line in self.process.stdout:
            try:
                message = parse_json(line)
            except ValueError:
                continue  # not a protocol message
            if isinstance(message, dict) and is_number(message.get("id")):
                self.responses.put(message)
        self.responses.put(None)  # end of output: the server exited

    def _read_stderr(self) -> None:
        for chunk in self.process.stderr:
            self.stderr = (self.stderr + chunk)[-STDERR_LIMIT:]

    def _detail(self) -> str:
        return f"\n{self.stderr.strip()}" if self.stderr.strip() else ""

    def send(self, message: Dict[str, Any]) -> None:
        try:
            self.process.stdin.write(to_json(message) + "\n")
            self.process.stdin.flush()
        except OSError:
            pass  # the exit is reported when the response never comes

    def request(self, method: str, params: Any, timeout_seconds: float) -> Any:
        request_id = self.next_id
        self.next_id += 1
        self.send({"method": method, "id": request_id, "params": params})
        while True:
            try:
                message = self.responses.get(timeout=timeout_seconds)
            except queue.Empty:
                raise ValueError(f"Timed out waiting for Codex App Server method {method}.{self._detail()}")
            if message is None:
                code = self.process.wait()
                # Node reports either an exit code or the signal that ended the process.
                exit_code = "null" if code < 0 else str(code)
                exit_signal = signal.Signals(-code).name if code < 0 else "null"
                raise ValueError(f"Codex App Server exited before responding "
                                 f"(code {exit_code}, signal {exit_signal}).{self._detail()}")
            if message.get("id") != request_id:
                continue
            error = message.get("error")
            if js_truthy(error):
                code = get(error, "code")
                text = get(error, "message")
                raise ValueError(f"Codex App Server request failed "
                                 f"({'unknown' if code is None else js_string(code)}): "
                                 f"{'unknown error' if text is None else js_string(text)}")
            return message.get("result")

    def close(self) -> None:
        try:
            self.process.stdin.close()
        except OSError:
            pass
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait()
        # The pipes reach end-of-file once the process is gone, which ends the
        # reader threads; only then is it safe to close them.
        for reader in self.readers:
            reader.join(timeout=5)
        for stream in (self.process.stdout, self.process.stderr):
            stream.close()


def read_codex_thread(thread_id: str, command: Optional[Sequence[str]] = None,
                      timeout_ms: float = 15_000) -> Dict[str, Any]:
    """Read one thread through the versioned Codex App Server protocol."""
    server = _AppServer(command or ["codex", "app-server"])
    timeout = timeout_ms / 1000
    try:
        server.request("initialize", {
            "clientInfo": {
                "name": "t4g_save_chat_transcript",
                "title": "Tech4Good Save Chat Transcript",
                "version": "1.0.0",
            },
            "capabilities": None,
        }, timeout)
        server.send({"method": "initialized", "params": {}})
        result = server.request("thread/read", {"threadId": thread_id, "includeTurns": True}, timeout)
        thread = get(result, "thread")
        if not js_truthy(thread) or get(thread, "id") != thread_id or not isinstance(get(thread, "turns"), list):
            raise ValueError("Codex App Server returned an invalid thread/read response")
        return thread
    finally:
        server.close()


_JS_DECIMAL = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[+-]?Infinity")


def _js_number(text: str) -> float:
    """`Number(text)` for decimal input: whitespace-trimmed, "" is 0, else NaN."""
    text = js_trim(text)
    if not text:
        return 0.0
    if re.fullmatch(r"0[xX][0-9a-fA-F]+", text):
        return float(int(text, 16))
    if _JS_DECIMAL.fullmatch(text):
        return float(text.replace("Infinity", "inf"))
    return math.nan


def capture_from_environment(output: str, mode: str, env: Optional[Dict[str, str]] = None,
                             thread_id: Optional[str] = None, timeout_ms: float = 15_000,
                             command: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    """Capture the thread named by CODEX_THREAD_ID (or `thread_id`) and return a summary."""
    env = os.environ if env is None else env
    if not output.endswith(".jsonl"):
        raise ValueError(f"--output must use the .jsonl extension; received {to_json(output)}")
    thread_id = thread_id or env.get("CODEX_THREAD_ID")
    if not thread_id:
        raise ValueError("No Codex thread ID is available. Run from a Codex shell tool with CODEX_THREAD_ID set, "
                         "or pass --thread-id explicitly.")
    thread = read_codex_thread(thread_id, command=command, timeout_ms=timeout_ms)
    metadata = create_transcript_metadata(thread)
    current = extract_visible_events(thread)
    existing = read_canonical_transcript(output) if mode == "append" else []
    merge = merge_transcript_events(existing, current, mode)
    write_canonical_transcript(output, metadata, merge["merged"])
    return {
        "source": SOURCE,
        "mode": mode,
        "fetched": len(current),
        "added": merge["added"],
        "updated": merge["updated"],
        "events": len(merge["merged"]),
        "output": output,
    }


def summary_warnings(summary: Dict[str, Any]) -> List[str]:
    return []


EPILOG = """The thread ID defaults to CODEX_THREAD_ID. The script never parses Codex's
unstable transcript_path/rollout JSONL format."""


def main(argv: Optional[List[str]] = None, env: Optional[Dict[str, str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0], epilog=EPILOG, allow_abbrev=False,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mode", default="full", choices=("full", "append"))
    parser.add_argument("--thread-id")
    parser.add_argument("--timeout-ms", default="15000")
    args = parser.parse_args(argv)
    try:
        timeout_ms = _js_number(args.timeout_ms)
        if not math.isfinite(timeout_ms) or timeout_ms <= 0:
            raise ValueError(f"--timeout-ms must be a positive number; received {to_json(args.timeout_ms)}")
        summary = capture_from_environment(args.output, args.mode, env, thread_id=args.thread_id,
                                           timeout_ms=timeout_ms)
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(to_json(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
