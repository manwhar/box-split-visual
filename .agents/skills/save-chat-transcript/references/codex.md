# Codex capture troubleshooting

The dispatcher selects Codex when `CODEX_THREAD_ID` is present and invokes
`scripts/extract_codex_transcript.py`. The adapter uses Codex App Server
`thread/read(includeTurns: true)` for that exact thread.

It keeps exact visible `userMessage` and `agentMessage` text, attachment-safe
placeholders, and source-provided assistant phases. It structurally excludes
reasoning, plans, hooks, commands, file changes, tool calls, and tool output.

If capture fails:

1. Confirm `CODEX_THREAD_ID` and the `codex` executable are available to the
   shell command.
2. Report the App Server error.
3. Do not parse Codex's unstable hook `transcript_path` or rollout JSONL.
4. Do not reconstruct the archive from current model context.
