# OpenCode capture troubleshooting

The dispatcher selects OpenCode when `T4G_OPENCODE_SESSION_ID` is present and
calls `scripts/extract_opencode_transcript.py`. The `t4g-freeze` session-environment
hook injects the exact active session ID into shell commands. The adapter reads
that session from OpenCode's local SQLite store, falling back to the documented
`opencode export <sessionID>` command only when the database is unavailable.

It keeps non-synthetic visible text, source-provided commentary/final-answer
phases, and privacy-safe attachment-only placeholders. It excludes reasoning,
tool data, patches, snapshots, compaction summaries, ignored/synthetic parts,
and attachment paths or payloads.

If the session ID is missing:

1. In an explorable starter, check its bundled
   `.opencode/plugins/explorable-transcripts.js`. It supplies the same exact
   session identity through OpenCode's `shell.env` hook, without global
   setup. The plugin must load in the OpenCode process running this project.
2. Otherwise, check whether `~/.config/opencode/plugins/t4g-freeze.ts` is
   installed. If absent and the Tech4Good skills repository is actually
   available, offer the OpenCode setup described in that repository's README.
   Run global setup only with user approval. It is not available in a
   standalone starter, which relies on the bundled plugin instead.
3. Tell the user to quit and restart OpenCode so the environment hook loads.

Never depend on OpenCode custom-tool discovery, choose a session by recency or
directory, ask the user for a session ID, or reconstruct from current context.
