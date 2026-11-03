# Normalized Transcript JSONL Schema

Store one visible chat message per line. JSONL is the canonical artifact; HTML
is only a rendering of these records.

## Version 1 records

Every newly written archive begins with exactly one conversation metadata
record:

```json
{"schemaVersion":1,"recordType":"metadata","harness":"codex","captureStatus":"complete","threadId":"thread-id","conversationStartedAt":"2026-08-28T12:21:44.000Z"}
```

Metadata fields:

- `schemaVersion`: `1`
- `recordType`: `metadata`
- `harness`: exact source harness
- `captureStatus`: `complete` or `source-truncated`
- `threadId`: exact source conversation identity
- `conversationStartedAt`: optional source timestamp normalized to ISO 8601;
  never infer it from file modification time

Every remaining line is a visible message:

```json
{"schemaVersion":1,"harness":"codex","captureStatus":"complete","threadId":"thread-id","turnId":"turn-id","itemId":"item-id","role":"user","phase":null,"text":"Exact visible text"}
```

Message fields:

- `schemaVersion`: `1`
- `harness`: same value as metadata
- `captureStatus`: `complete` or `source-truncated`
- `threadId`: same value as metadata
- `turnId`: stable source turn identity
- `itemId`: stable source message or content identity
- `role`: `user` or `assistant`
- `phase`: source phase such as `commentary` or `final_answer`, otherwise `null`
- `text`: exact visible message text

Event identity is the tuple `threadId`, `turnId`, and `itemId`. Append mode
adds unseen identities, replaces an existing identity whose captured content
changed, and leaves unchanged identities unduplicated.

The shared writer rejects context-limited captures, invalid records, duplicate
identities, mixed harnesses, mixed conversations, and inconsistent truncation
status before atomically replacing the destination.

Each record is written as compact JSON exactly as JavaScript's
`JSON.stringify` writes it — the format predates the Python implementation and
its bytes are unchanged: UTF-8 with non-ASCII text left as is, control
characters as `\b`, `\t`, `\n`, `\f`, `\r` or lowercase `\u00XX`, U+2028 and
U+2029 left raw, a lone UTF-16 surrogate as its `\uXXXX` escape, and `\n`
between records on every platform. Whitespace trimming, timestamp parsing and
truthiness follow JavaScript as well. `transcript_archive.py` holds these
rules, and `scripts/test_parity.py` checks every fixture against output
recorded from the earlier TypeScript implementation.

Read the matching harness resource for source-specific normalization rules.

## Automatic checks

Both the extractor and the renderer run `diagnose_transcript` over the archive
and print what it finds. The checks are harness-agnostic and derived from the
records alone:

- `unclassified-transcript` — no assistant message anywhere carries a phase, so
  the adapter never classifies at all. This catches adapters that give every
  assistant message its own turn, which the per-turn check below cannot see.
- `unclassified-narration` — a turn holds several assistant messages but none is
  marked `commentary`, so the viewer cannot collapse narration around tool
  calls. This means the adapter is not classifying `phase` for that turn.
- `misplaced-final-answer` — a message is marked `final_answer` before its turn
  ends.
- `duplicate-identity` — two records share `threadId`/`turnId`/`itemId`, which
  append mode cannot tell apart.
- `empty-text` — a record carries no visible text.

These are advisory. Hard invariants that must never reach disk — invalid
records, duplicate identities, mixed harnesses or conversations, inconsistent
truncation status, context-limited capture — are enforced by
`validate_canonical_transcript`, which raises at write time instead.

A new adapter should be run against a real session and produce no diagnostics
before it ships.

An adapter whose source carries no phase and no richer signal can call
`classify_assistant_runs`, which marks every message but the last in a run of
consecutive assistant messages as `commentary`. An adapter that can see more —
Claude Code, where a tool call following the text proves the turn had not
ended — should classify from that instead.
