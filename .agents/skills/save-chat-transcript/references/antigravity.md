# Antigravity capture troubleshooting

The dispatcher selects Antigravity when `ANTIGRAVITY_CONVERSATION_ID` is
present, or when the same ID is available in `ANTIGRAVITY_SOURCE_METADATA`. It
calls `scripts/extract_antigravity_transcript.py`; the agent does not pass the
conversation ID.

The adapter locates `transcript_full.jsonl` for that exact conversation under
the active app data directory. It does not fall back to the compact
`transcript.jsonl`. App data candidates are provided by
`ANTIGRAVITY_APP_DATA_DIR`, `GEMINI_APP_DATA_DIR`, or the standard
`~/.gemini/antigravity`, `~/.gemini/antigravity-ide`, and `~/.antigravity`
locations.

It keeps visible `USER_INPUT` and `PLANNER_RESPONSE` records, uses stable
step-derived identities, and records the earliest valid source `created_at`
timestamp once in metadata. Source-truncated records remain visibly marked so
the archive never claims content that the harness did not persist.

If the active ID or full log is unavailable, report the failure. Do not ask the
user for an ID, use a step-range shortcut, select another conversation, read
the compact log, or reconstruct from current context.

Antigravity's log carries no commentary/final-answer distinction, so the adapter
derives one from message order: within a run of consecutive assistant messages,
all but the last are narration. The viewer collapses those runs.
