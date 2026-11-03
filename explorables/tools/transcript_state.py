"""Private registration, pending saves and process locks for author transcripts.

State travels with the paper when its folder is renamed. It contains source
locations and message hashes, never another copy of the conversation. It is
hidden inside transcripts/, so submissions and the public site exclude it.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time

SOURCE_FIELDS = {"codex": set(), "claude": {"transcript_path"}, "antigravity": {"app_data_dir"},
                 "opencode": set()}


def valid_anchor(value) -> bool:
    return value is None or (isinstance(value, dict)
                             and all(isinstance(value.get(key), str) and value[key] for key in ("turnId", "itemId"))
                             and isinstance(value.get("digest"), str)
                             and re.fullmatch(r"[a-f0-9]{64}", value["digest"]) is not None)


def digest(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


def state_path(output: Path) -> Path:
    return output.parent / ".capture" / (output.stem + ".json")


def guard(output: Path) -> None:
    for path in (output.parent.parent, output.parent, output,
                 state_path(output).parent, state_path(output), state_path(output).parent / ".save.lock"):
        if path.is_symlink():
            raise ValueError(f"Refusing transcript state through a symbolic link: {path}")


@contextmanager
def locked(output: Path, timeout: float = 25):
    """Serialize saves to this paper, including the entire submission snapshot.

    A shared paper lock also prevents new registrations from appearing halfway
    through packaging. Different papers can still be captured concurrently.
    """
    guard(output)
    path = state_path(output).parent / ".save.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt
            if path.stat().st_size == 0:
                handle.write(b"\0")
                handle.flush()
            def acquire():
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            def release():
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            def acquire():
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            def release():
                fcntl.flock(handle, fcntl.LOCK_UN)
        deadline = time.monotonic() + timeout
        while True:
            try:
                acquire()
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise ValueError(f"Another transcript save is still running: {output}")
                time.sleep(0.05)
        try:
            yield
        finally:
            release()


def read(output: Path, harness: str, session: str) -> dict | None:
    guard(output)
    path = state_path(output)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if (harness not in SOURCE_FIELDS or not isinstance(session, str) or not session
                or not isinstance(data, dict) or data.get("version") != 1
                or data.get("harness") != harness or data.get("session") != session
                or not isinstance(data.get("pending"), list) or not isinstance(data.get("source"), dict)
                or not valid_anchor(data.get("baseline"))):
            raise ValueError("wrong identity or schema")
        if (set(data["source"]) - SOURCE_FIELDS[harness]
                or any(not isinstance(value, str) or not Path(value).is_absolute()
                       for value in data["source"].values())):
            raise ValueError("invalid source location")
        for item in data["pending"]:
            if (not isinstance(item, dict) or item.get("kind") not in ("text", "settled", "checkpoint")
                    or not valid_anchor(item.get("after"))
                    or ("turnId" in item and (not isinstance(item["turnId"], str) or not item["turnId"]))
                    or (item.get("kind") == "text" and
                        (not isinstance(item.get("digest"), str) or not re.fullmatch(r"[a-f0-9]{64}", item["digest"])))):
                raise ValueError("invalid pending save")
        return data
    except (ValueError, UnicodeError) as error:
        raise ValueError(f"Invalid transcript registration {path}: {error}") from error


def write(output: Path, data: dict) -> None:
    guard(output)
    path = state_path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".state-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(data, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def new(harness: str, session: str) -> dict:
    return {"version": 1, "harness": harness, "session": session, "source": {},
            "pending": [], "baseline": None, "error": "Initial capture has not completed."}


def baseline(records: list[dict]) -> dict | None:
    for event in reversed(records[1:]):
        if event["role"] == "assistant":
            return {"turnId": event["turnId"], "itemId": event["itemId"], "digest": digest(event["text"])}
    return None


def baseline_before_user(records: list[dict]) -> dict | None:
    """The last assistant message preceding the latest user message.

    In harnesses configured with a Stop hook only (such as Antigravity), a new
    user turn adds a user message after the previous turn's assistant reply.
    Advancing the baseline to that prior reply ensures the new turn's Stop hook
    waits for the new turn's reply while keeping duplicate Stop deliveries for
    the same turn idempotent.
    """
    events = records[1:]
    last_user = next((i for i in range(len(events) - 1, -1, -1) if events[i]["role"] == "user"), None)
    if last_user is None:
        return None
    for event in reversed(events[:last_user]):
        if event["role"] == "assistant":
            return {"turnId": event["turnId"], "itemId": event["itemId"], "digest": digest(event["text"])}
    return None


def later_anchor(first: dict | None, second: dict | None, records: list[dict]) -> dict | None:
    """Return whichever anchor appears later in `records`."""
    if first is None:
        return second
    if second is None:
        return first
    positions = {(event["turnId"], event["itemId"]): index for index, event in enumerate(records[1:])}
    first_pos = positions.get((first["turnId"], first["itemId"]), -1)
    second_pos = positions.get((second["turnId"], second["itemId"]), -1)
    return second if second_pos >= first_pos else first


def fulfilled(expected: dict, records: list[dict], *, settled: bool = False) -> bool:
    if expected["kind"] == "checkpoint":
        return True
    if expected["kind"] == "settled" and not settled:
        return False
    events = records[1:]
    anchor = expected.get("after")
    start = 0
    if anchor:
        found = False
        for index, event in enumerate(events):
            if (event["turnId"], event["itemId"]) == (anchor["turnId"], anchor["itemId"]):
                # A streaming message may be updated under its existing ID.
                start = index + (digest(event["text"]) == anchor["digest"])
                found = True
                break
        if not found:
            return False
    for event in events[start:]:
        if event["role"] != "assistant" or event["captureStatus"] != "complete":
            continue
        if expected.get("turnId") and event["turnId"] != expected["turnId"]:
            continue
        if expected["kind"] == "text":
            if digest(event["text"]) == expected["digest"]:
                return True
        elif event["phase"] != "commentary":
            # Recovery may run after the next user message has been persisted.
            # That later prompt must not make the previous reply unrecoverable.
            return True
    return False


def reconcile(data: dict, records: list[dict], *, settled: bool = False) -> None:
    data["pending"] = [item for item in data["pending"] if not fulfilled(item, records, settled=settled)]


def check_submission(folder: Path, files: dict[str, bytes] | None = None, *, locks_held: bool = False) -> None:
    """A failed or interrupted hook cannot silently become a stale submission."""
    if not locks_held:
        with locked(folder / "transcripts/.submission.jsonl"):
            return check_submission(folder, files, locks_held=True)
    directory = folder / "transcripts/.capture"
    if directory.is_symlink():
        raise ValueError(f"Refusing transcript state through a symbolic link: {directory}")
    for path in sorted(directory.glob("*.json")):
        output = folder / "transcripts" / (path.stem + ".jsonl")
        try:
            meta = json.loads(path.read_text(encoding="utf-8"))
            data = read(output, meta["harness"], meta["session"])
            expected_name = f"{data['harness']}-{hashlib.sha256(data['session'].encode()).hexdigest()}"
            if path.stem != expected_name:
                raise ValueError("registration filename does not match its conversation")
        except (ValueError, KeyError, TypeError) as error:
            raise ValueError(f"Invalid transcript registration {path}: {error}") from error
        if data["pending"] or data.get("error") or not output.is_file():
            raise ValueError(f"Transcript save is unfinished for {data['harness']} conversation {data['session']}. "
                             f"Run python3 explorables/tools/transcript_hooks.py --recover {folder.name} "
                             "and resolve any capture error before packaging.")
        if files is not None and files.get(f"transcripts/{output.name}") != output.read_bytes():
            raise ValueError("A transcript changed while packaging. Run the packager again to include that save.")
