"""Shared canonical-transcript archive contract.

Every harness adapter normalizes its own source into these records and then
reuses the identity, merge, validation, and atomic-write behavior here.
See ../references/transcript-schema.md for the record specification.

Records are plain dictionaries so their key order, which is part of the
on-disk format, is exactly the order in which they are built.

This module is a port of an earlier Bun/TypeScript implementation, and every
archive it writes must stay byte-for-byte identical to what that version
wrote (scripts/test_parity.py checks this against recorded output). The
JavaScript semantics that decide those bytes — `JSON.stringify`,
`String.prototype.trim`, `Date.parse`, truthiness, and number-to-string
conversion — therefore live here as small helpers that the adapters share,
instead of being approximated with their nearest Python equivalents, which
differ in ways that change output (see each helper).

Python 3.9+ standard library only.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import email.utils
import json
import math
import os
from pathlib import Path
import re
from typing import Any, Dict, Iterable, List, Optional

CAPTURE_STATUSES = ("complete", "context-limited", "source-truncated")

# ---------------------------------------------------------------------------
# JavaScript-compatible primitives
# ---------------------------------------------------------------------------

# Characters JavaScript's String.prototype.trim removes: WhiteSpace (tab,
# vertical tab, form feed, space, no-break space, the byte-order mark, and the
# Unicode Zs category) plus LineTerminator. Python's str.strip() differs in
# both directions — it also strips \x1c-\x1f and \x85, and keeps ﻿ — so
# using it would change which messages count as empty and what text is stored.
JS_WHITESPACE = (
    "\t\n\v\f\r          "
    "        　﻿"
)

# The lines of a file, split exactly as JavaScript's `split(/\r?\n/)` does.
# str.splitlines() would also split on \v, \f, \x1c-\x1e, \x85,   and
#  , all of which can appear inside a JSON string's raw text.
_LINE_BREAK = re.compile(r"\r?\n")

_SURROGATE = re.compile("[\ud800-\udfff]")


def js_trim(text: str) -> str:
    """`text.trim()` with JavaScript's definition of whitespace."""
    return text.strip(JS_WHITESPACE)


def split_lines(text: str) -> List[str]:
    """`text.split(/\\r?\\n/)`: keeps a trailing empty string, like JavaScript."""
    return _LINE_BREAK.split(text)


def is_number(value: Any) -> bool:
    """`typeof value === "number"`; Python's bool is an int, JavaScript's is not."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def is_one(value: Any) -> bool:
    """`value === 1`. Without this, JSON `true` (== 1 in Python) would pass."""
    return is_number(value) and value == 1


def js_truthy(value: Any) -> bool:
    """JavaScript truthiness: unlike Python, empty arrays and objects are truthy."""
    if value is None or value is False:
        return False
    if value is True:
        return True
    if is_number(value):
        return value != 0 and not (isinstance(value, float) and math.isnan(value))
    if isinstance(value, str):
        return value != ""
    return True


def get(value: Any, key: str) -> Any:
    """`value?.[key]`: None for a missing key or for a value that is not an object."""
    return value.get(key) if isinstance(value, dict) else None


def js_number_to_string(value: float) -> str:
    """`String(number)` per ECMAScript Number::toString (shortest round-trip digits).

    Python's repr agrees on the digits but switches to exponent notation at
    different magnitudes and pads exponents ("1e-05" where JavaScript writes
    "0.00001", "1e-07" where it writes "1e-7").
    """
    if isinstance(value, int):
        return str(value)
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    digits_tuple = Decimal(repr(abs(value))).normalize().as_tuple()
    digits = "".join(str(digit) for digit in digits_tuple.digits)
    k = len(digits)
    n = digits_tuple.exponent + k  # position of the decimal point
    if k <= n <= 21:
        body = digits + "0" * (n - k)
    elif 0 < n <= 21:
        body = f"{digits[:n]}.{digits[n:]}"
    elif -6 < n <= 0:
        body = f"0.{'0' * -n}{digits}"
    else:
        exponent = n - 1
        mantissa = digits if k == 1 else f"{digits[0]}.{digits[1:]}"
        body = f"{mantissa}e{'+' if exponent > 0 else '-'}{abs(exponent)}"
    return sign + body


def js_string(value: Any) -> str:
    """`String(value)`, for values interpolated into identifiers and labels."""
    if isinstance(value, str):
        return value
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if is_number(value):
        return js_number_to_string(value)
    if isinstance(value, list):
        return ",".join("" if item is None else js_string(item) for item in value)
    return "[object Object]"


def _plain_numbers(value: Any) -> Any:
    """Integral floats as ints, because JSON.stringify(1.0) is "1", not "1.0"."""
    if isinstance(value, float) and value.is_integer() and abs(value) < 1e21:
        return int(value)
    if isinstance(value, dict):
        return {key: _plain_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_plain_numbers(item) for item in value]
    return value


def to_json(value: Any, indent: Optional[int] = None) -> str:
    """`JSON.stringify(value[, null, indent])`, byte for byte for transcript data.

    json.dumps with ensure_ascii=False already matches JavaScript's escaping of
    quotes, backslashes and control characters (including the lowercase
    \\u00XX form) and, like JavaScript, leaves U+2028/U+2029 and DEL raw. Two
    differences remain and are handled here:

    - Lone UTF-16 surrogates. JSON.parse accepts an escaped lone surrogate
      such as "\\ud83d", and JSON.stringify writes it back as that escape.
      json.dumps would emit the raw code point, which cannot be encoded as
      UTF-8. Surrogates that form a valid pair are first joined (JavaScript
      strings are UTF-16, so a pair is one character there), then any that
      remain are escaped.
    - Integral floats, which JavaScript prints without a fraction.
    """
    separators = (",", ":") if indent is None else (",", ": ")
    text = json.dumps(_plain_numbers(value), ensure_ascii=False, indent=indent,
                      separators=separators, allow_nan=False)
    if _SURROGATE.search(text):
        text = text.encode("utf-16", "surrogatepass").decode("utf-16", "surrogatepass")
        text = _SURROGATE.sub(lambda match: "\\u%04x" % ord(match.group()), text)
    return text


def _reject_constant(name: str) -> Any:
    raise ValueError(f"Unexpected token {name} in JSON")


def parse_json(text: str) -> Any:
    """`JSON.parse`: unlike json.loads, NaN and Infinity are not valid JSON."""
    return json.loads(text, parse_constant=_reject_constant)


def read_text(path: "os.PathLike[str] | str") -> str:
    """`readFileSync(path, "utf8")`: invalid UTF-8 becomes U+FFFD instead of failing."""
    return Path(path).read_bytes().decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Timestamps: Date.parse and Date.prototype.toISOString
# ---------------------------------------------------------------------------

# JavaScriptCore's (Bun's) date-time string format, as measured against
# fixtures/expected/timestamps.json. It is more lenient than ISO 8601: one-digit
# months and days, a space or lowercase "t" separator, "24:00", and day numbers
# past the end of the month (which roll into the next month) are accepted.
_ISO_LIKE = re.compile(
    r"(?P<year>[+-]\d{6}|\d{4})"
    r"(?:-(?P<month>\d{1,2})(?:-(?P<day>\d{1,2}))?)?"
    r"(?:[Tt ](?P<hour>\d{2}):(?P<minute>\d{2})"
    r"(?::(?P<second>\d{2})(?:\.(?P<fraction>\d+))?)?"
    r"(?P<zone>[Zz]|[+-]\d{2}:?\d{2})?)?"
)

# Valid time values span ±8.64e15 ms around the epoch (ECMAScript TimeClip).
_MAX_TIME_MS = 8.64e15
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _iso_from_datetime(moment: datetime) -> Optional[str]:
    """`toISOString()` for years Python can represent; None otherwise."""
    moment = moment.astimezone(timezone.utc)
    return (f"{moment.year:04d}-{moment.month:02d}-{moment.day:02d}T"
            f"{moment.hour:02d}:{moment.minute:02d}:{moment.second:02d}."
            f"{moment.microsecond // 1000:03d}Z")


def iso_from_milliseconds(milliseconds: float) -> Optional[str]:
    """`new Date(milliseconds).toISOString()`, or None for an invalid date.

    Like JavaScript, the fractional part of the time value is truncated
    toward zero. Years outside 1-9999, which JavaScript would print with an
    expanded "+YYYYYY" form, are reported as invalid instead.
    """
    if not math.isfinite(milliseconds) or abs(milliseconds) > _MAX_TIME_MS:
        return None
    try:
        return _iso_from_datetime(_EPOCH + timedelta(milliseconds=math.trunc(milliseconds)))
    except OverflowError:
        return None


def parse_date(value: Any) -> Optional[datetime]:
    """`Date.parse(value)` for the formats harness logs use; None means NaN.

    Accepts the ISO-like forms JavaScriptCore accepts (see _ISO_LIKE) and the
    RFC 2822 form ("Thu, 01 Jan 2026 00:00:00 GMT"). Free-form English dates
    such as "Jan 1 2026", which JavaScriptCore also parses, are rejected: no
    supported harness writes them, and accepting them would mean guessing at
    an engine-specific heuristic. Without a zone, a date alone is UTC and a
    date with a time is local time, as in JavaScript.
    """
    if not isinstance(value, str):
        return None
    match = _ISO_LIKE.fullmatch(value)
    if match:
        parts = match.groupdict()
        year = int(parts["year"])
        month = int(parts["month"] or 1)
        day = int(parts["day"] or 1)
        hour = int(parts["hour"] or 0)
        minute = int(parts["minute"] or 0)
        second = int(parts["second"] or 0)
        milliseconds = int((parts["fraction"] or "0")[:3].ljust(3, "0"))
        if not (1 <= month <= 12 and 1 <= day <= 31 and hour <= 24 and minute <= 59 and second <= 59):
            return None
        if hour == 24 and (minute or second or milliseconds):
            return None
        zone = parts["zone"]
        if zone in ("Z", "z") or (zone is None and parts["hour"] is None):
            tz = timezone.utc
        elif zone is None:
            tz = None  # local time, resolved below
        else:
            digits = zone[1:].replace(":", "")
            offset = timedelta(hours=int(digits[:2]), minutes=int(digits[2:]))
            tz = timezone(offset if zone[0] == "+" else -offset)
        try:
            # Build from the first of the month so that overflowing days and
            # hour 24 roll forward the way JavaScriptCore's parser does.
            moment = datetime(year, month, 1, tzinfo=tz) + timedelta(
                days=day - 1, hours=hour, minutes=minute, seconds=second, milliseconds=milliseconds)
        except (ValueError, OverflowError):
            return None
        if tz is None:
            moment = moment.astimezone()  # interpret the naive time as local time
        return moment
    try:
        moment = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if moment is None:
        return None
    # Without a zone, JavaScript reads the time as local time.
    return moment if moment.tzinfo else moment.astimezone()


def is_iso_timestamp(value: Any) -> bool:
    """`typeof value === "string" && !Number.isNaN(Date.parse(value))`."""
    return parse_date(value) is not None


def iso_from_date_string(value: str) -> Optional[str]:
    """`new Date(value).toISOString()` for a string Date.parse accepts."""
    moment = parse_date(value)
    return None if moment is None else _iso_from_datetime(moment)


def normalize_timestamp(value: Any) -> Optional[str]:
    """A source timestamp as ISO 8601 UTC, or None when it is not a usable time.

    Numbers below 1e10 are seconds since the epoch and larger ones are
    milliseconds; zero, negative, and non-finite numbers are rejected.
    Strings go through Date.parse. Shared by the Codex, OpenCode, and
    Antigravity adapters.
    """
    if is_number(value):
        if not math.isfinite(value) or value <= 0:
            return None
        return iso_from_milliseconds(value * 1000 if value < 10_000_000_000 else value)
    if isinstance(value, str):
        return iso_from_date_string(value)
    return None


# ---------------------------------------------------------------------------
# Records, identity, and merging
# ---------------------------------------------------------------------------

def is_capture_status(value: Any) -> bool:
    return isinstance(value, str) and value in CAPTURE_STATUSES


def event_key(event: Dict[str, Any]) -> str:
    """Stable message identity: the source thread, turn, and item."""
    return f"{event['threadId']}:{event['turnId']}:{event['itemId']}"


def event_content_matches(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    """Whether two records with one identity carry the same captured content."""
    return all(_same(left.get(key), right.get(key)) for key in ("captureStatus", "role", "phase", "text"))


def _same(left: Any, right: Any) -> bool:
    """`left === right` for the JSON scalars records hold."""
    return type(left) is type(right) and left == right


def merge_transcript_events(existing: List[Dict[str, Any]], current: List[Dict[str, Any]],
                            mode: str) -> Dict[str, Any]:
    """Add events with unseen identities and replace ones whose content changed.

    Returns {"merged", "changed", "added", "updated"}; `changed` carries exactly
    the records a caller needs to re-render. Full mode replaces everything.
    """
    if mode == "full":
        return {"merged": current, "changed": current, "added": len(current), "updated": 0}

    merged = list(existing)
    index_by_key = {event_key(event): index for index, event in enumerate(merged)}
    changed: List[Dict[str, Any]] = []
    added = updated = 0
    for event in current:
        key = event_key(event)
        existing_index = index_by_key.get(key)
        if existing_index is None:
            index_by_key[key] = len(merged)
            merged.append(event)
            changed.append(event)
            added += 1
        elif not event_content_matches(merged[existing_index], event):
            merged[existing_index] = event
            changed.append(event)
            updated += 1
    return {"merged": merged, "changed": changed, "added": added, "updated": updated}


def is_transcript_event(value: Any, harness: Optional[str] = None) -> bool:
    """Whether a parsed record is a valid version-1 message record."""
    if not isinstance(value, dict):
        return False
    phase = value.get("phase", ())  # () stands for "absent", which is invalid
    return (
        is_one(value.get("schemaVersion"))
        and isinstance(value.get("harness"), str)
        and (harness is None or value["harness"] == harness)
        # Older archives predate the field and were all complete captures.
        and ("captureStatus" not in value or is_capture_status(value["captureStatus"]))
        and isinstance(value.get("threadId"), str)
        and isinstance(value.get("turnId"), str)
        and isinstance(value.get("itemId"), str)
        and value.get("role") in ("user", "assistant") and isinstance(value.get("role"), str)
        and (phase is None or (isinstance(phase, str) and phase in ("commentary", "final_answer")))
        and isinstance(value.get("text"), str)
    )


def is_transcript_metadata(value: Any, harness: Optional[str] = None) -> bool:
    """Whether a parsed record is a valid version-1 metadata record."""
    if not isinstance(value, dict):
        return False
    return (
        is_one(value.get("schemaVersion"))
        and value.get("recordType") == "metadata"
        and isinstance(value.get("harness"), str)
        and (harness is None or value["harness"] == harness)
        and is_capture_status(value.get("captureStatus"))
        and isinstance(value.get("threadId"), str)
        and ("conversationStartedAt" not in value or is_iso_timestamp(value["conversationStartedAt"]))
    )


def read_canonical_transcript(path: "os.PathLike[str] | str", harness: Optional[str] = None,
                              require_leading_metadata: bool = True) -> Dict[str, Any]:
    """Read an archive as {"metadata", "events"}; a missing file is an empty archive.

    `harness` rejects records produced by a different harness, and
    `require_leading_metadata` requires the metadata record, when present, to
    be the first record.
    """
    path = Path(path)
    if not path.exists():
        return {"metadata": None, "events": []}
    metadata = None
    events: List[Dict[str, Any]] = []
    for index, raw_line in enumerate(split_lines(read_text(path))):
        line = js_trim(raw_line)
        if not line:
            continue
        try:
            value = parse_json(line)
        except ValueError as error:
            raise ValueError(f"Invalid canonical transcript JSONL at {path}:{index + 1}: {error}") from error
        if is_transcript_metadata(value, harness):
            if metadata is not None or (require_leading_metadata and events):
                raise ValueError(f"Transcript metadata must be the first record in {path}:{index + 1}")
            metadata = value
            continue
        if not is_transcript_event(value, harness):
            raise ValueError(f"Invalid canonical transcript event at {path}:{index + 1}")
        events.append(value)
    return {"metadata": metadata, "events": events}


def serialize_canonical_transcript(metadata: Dict[str, Any], events: Iterable[Dict[str, Any]]) -> str:
    """The archive's exact text: one JSON record per line, metadata first."""
    return "\n".join(to_json(record) for record in [metadata, *events]) + "\n"


def validate_canonical_transcript(metadata: Dict[str, Any], events: List[Dict[str, Any]]) -> None:
    """Reject incomplete or internally inconsistent archives before persistence."""
    if not is_transcript_metadata(metadata):
        raise ValueError("Invalid canonical transcript metadata")
    context_limited = ("Context-limited transcript capture is unsupported; "
                       "an exact harness source is required")
    if metadata["captureStatus"] == "context-limited":
        raise ValueError(context_limited)

    identities = set()
    has_truncated_event = False
    for event in events:
        if not is_transcript_event(event):
            raise ValueError("Invalid canonical transcript event")
        if event.get("captureStatus") == "context-limited":
            raise ValueError(context_limited)
        if event["harness"] != metadata["harness"] or event["threadId"] != metadata["threadId"]:
            raise ValueError("Transcript metadata and events must describe one harness conversation")
        identity = event_key(event)
        if identity in identities:
            raise ValueError(f"Duplicate transcript event identity: {identity}")
        identities.add(identity)
        has_truncated_event = has_truncated_event or event.get("captureStatus") == "source-truncated"

    if has_truncated_event and metadata["captureStatus"] != "source-truncated":
        raise ValueError("Transcript metadata must report source-truncated when any event is source-truncated")


def write_atomic(path: "os.PathLike[str] | str", content: str) -> None:
    """Replace the file in one step so a crash cannot leave a partial archive.

    newline="" keeps "\\n" line endings on Windows, where text mode would
    otherwise write "\\r\\n" and change the archive's bytes.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.{os.getpid()}.tmp"
    with open(temporary, "w", encoding="utf-8", newline="") as handle:
        handle.write(content)
    os.replace(temporary, path)


def write_canonical_transcript(path: "os.PathLike[str] | str", metadata: Dict[str, Any],
                               events: List[Dict[str, Any]]) -> None:
    """Validate, then atomically write, one canonical archive."""
    validate_canonical_transcript(metadata, events)
    write_atomic(path, serialize_canonical_transcript(metadata, events))


def classify_assistant_runs(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Classify assistant messages for adapters whose source carries no phase.

    Within each run of consecutive assistant messages, every message but the
    last is narration ("commentary") and the last is the reply the user
    answered ("final_answer"). An adapter that can see more — Claude Code,
    where a tool call after the text proves the turn had not finished —
    should classify from that instead of calling this. Mutates and returns
    `events`.
    """
    for index, event in enumerate(events):
        if event["role"] != "assistant":
            continue
        next_is_assistant = index + 1 < len(events) and events[index + 1]["role"] == "assistant"
        event["phase"] = "commentary" if next_is_assistant else "final_answer"
    return events


def diagnose_transcript(events: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Structural problems detectable from the archive alone, without knowing the harness.

    Each diagnostic is {"code", "message"}. The motivating case: the viewer
    collapses consecutive assistant messages marked `commentary`, so an
    adapter that leaves `phase` unset renders every line of narration around a
    tool call as a standalone reply. That is invisible in the JSONL and only
    shows up when a human opens the viewer, which is how it reached users
    more than once. Checking right after capture turns a silent presentation
    bug into a message on the terminal.
    """
    diagnostics: List[Dict[str, str]] = []

    seen = set()
    for event in events:
        key = event_key(event)
        if key in seen:
            diagnostics.append({
                "code": "duplicate-identity",
                "message": f"More than one record shares the identity {key}; append mode cannot tell them apart.",
            })
        seen.add(key)
        if not js_trim(event["text"]):
            diagnostics.append({"code": "empty-text", "message": f"Record {key} has no visible text."})

    # Whole-transcript check, which the per-turn one below cannot make: an
    # adapter that puts every assistant message in its own turn never produces
    # a multi-assistant turn to inspect, so a total absence of classification
    # is the only visible symptom. A classifier that ran would mark at least
    # one message, so all-null across several messages means it never ran.
    assistant_events = [event for event in events if event["role"] == "assistant"]
    if len(assistant_events) >= 3 and all(event.get("phase") is None for event in assistant_events):
        diagnostics.append({
            "code": "unclassified-transcript",
            "message": (f"None of the {len(assistant_events)} assistant messages carry a phase, so the viewer "
                        "cannot collapse any narration. This adapter does not classify phase at all."),
        })

    # Group by turn in first-seen order (dicts keep insertion order).
    turns: Dict[str, List[Dict[str, Any]]] = {}
    for event in events:
        turns.setdefault(f"{event['threadId']}:{event['turnId']}", []).append(event)

    for key, turn in turns.items():
        assistants = [event for event in turn if event["role"] == "assistant"]
        if len(assistants) < 2:
            continue
        if not any(event.get("phase") == "commentary" for event in assistants):
            diagnostics.append({
                "code": "unclassified-narration",
                "message": (f'Turn {key} has {len(assistants)} assistant messages but none marked "commentary", '
                            "so the viewer will show narration around tool calls as separate replies. "
                            "The adapter for this harness is not classifying phase."),
            })
        last = assistants[-1]
        for event in assistants:
            if event is not last and event.get("phase") == "final_answer":
                diagnostics.append({
                    "code": "misplaced-final-answer",
                    "message": f'Turn {key} marks {event_key(event)} as "final_answer" before the turn ends.',
                })
    return diagnostics


def format_diagnostics(diagnostics: List[Dict[str, str]], path: "os.PathLike[str] | str",
                       leading_blank: bool = False) -> str:
    """The warning both the extractor and the renderer print for diagnostics."""
    lines = [f"{chr(10) if leading_blank else ''}{len(diagnostics)} problem(s) found in {path}:"]
    lines += [f"  [{diagnostic['code']}] {diagnostic['message']}" for diagnostic in diagnostics]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Locations
# ---------------------------------------------------------------------------

def home_dir(env: Optional[Dict[str, str]] = None) -> str:
    """The user's home directory, as Node's os.homedir() finds it ($HOME first)."""
    env = os.environ if env is None else env
    return env.get("HOME") or os.path.expanduser("~")


def transcripts_dir(env: Optional[Dict[str, str]] = None) -> str:
    """Where transcripts go when the caller names no destination.

    `$T4G_HOME/transcripts`, defaulting to `~/.t4g/transcripts`. It is also the
    second place discovery looks. It sits outside any repository on purpose,
    so the writer and the reader must agree on it — hence one definition here
    rather than a copy in each.
    """
    env = os.environ if env is None else env
    return os.path.join(env.get("T4G_HOME") or os.path.join(home_dir(env), ".t4g"), "transcripts")


def canonical_output_path(output: str) -> str:
    """Enforce the documented `.jsonl` destination, replacing a legacy `.md` suffix."""
    if output.endswith(".jsonl"):
        return output
    if output.endswith(".md"):
        return output[: -len(".md")] + ".jsonl"
    return output + ".jsonl"
