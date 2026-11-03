# Claude Code capture troubleshooting

The dispatcher selects Claude Code when `CLAUDE_CODE_SESSION_ID` is present and
calls `scripts/extract_claude_transcript.py`. The adapter locates exactly one matching
session log under Claude's projects directory; it never selects by recency or
working directory.

Claude Code has no structured-history API, so this adapter parses its internal
log by allowlist. It retains assistant `text` blocks and plain-text user
messages. It excludes reasoning, subagent (`isSidechain`) traffic, attachments,
tool results stored as user records, duplicated `queue-operation` prompts, and
injected system wrappers. Slash commands are restored to the command line the
user ran.

Assistant narration around tool calls is marked `commentary` and the text that
ends a turn is marked `final_answer`, so the viewer can collapse the narration.

A user message that carries only an attachment is preserved as a generic
`[Image attachment]` or `[File attachment]` marker rather than dropped, so the
turn still appears in the archive. The marker never includes a filename, path,
media type, or payload.

A live log may end mid-record. The adapter skips only that final partial line,
reports `truncatedFinalLine`, and captures it on a later append.

If the exact log cannot be found or parsed, report the failure. Claude's manual
`/export` output lacks the role and turn structure required by this archive, so
do not use it or current model context as an automated fallback.
