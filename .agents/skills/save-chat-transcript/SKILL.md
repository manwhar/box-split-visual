---
name: save-chat-transcript
description: >
  Saves, exports, or archives the complete current chat transcript as canonical
  JSONL from the harness's exact persisted history, with a human-readable HTML
  viewer. Should trigger when the user asks to save, export, archive, or
  download the current conversation or another workflow invokes
  /save-chat-transcript. Should NOT trigger for summaries or partial
  reconstructions that do not require a transcript artifact.
---

# Save Chat Transcript

Save the complete visible user and assistant history as one canonical JSONL
artifact. Never reconstruct a transcript from the model's current context and
never create a parallel Markdown or durable HTML transcript.

The scripts need only Python 3.9 or later; they use the standard library and
nothing else. On Windows, run them with `py` or `python` where these steps say
`python3`.

The caller supplies:

- **outputPath** — optional. When given, the extractor normalizes it to
  `.jsonl`. When omitted, the archive is written to
  `~/.t4g/transcripts/<YYYYMMDDHHMM>-<harness>-<session>.jsonl`, outside any
  repository, and an existing archive for the same conversation is reused
  rather than a second one started.
- **mode** — `full` for a fresh archive or `append` for an idempotent update

Prefer the default location. Only pass a destination when the user asks for the
transcript at a specific path, and do not place one inside a project unless
they ask for that.

## 1. Extract exact history

Run the following command:

```bash
python3 <path-to-this-skill>/scripts/extract_transcript.py \
  --mode <full-or-append> \
  [--output <outputPath>]
```

The dispatcher detects the active harness and conversation identity from its
session environment, chooses the destination, invokes the correct adapter,
filters non-conversation records, validates one consistent archive, and writes
atomically. It reports the path it used, which is what you must report back. Do not edit
or post-process the resulting JSONL.

The extractor checks the archive it just wrote and prints any structural
problem it finds, such as a harness adapter that failed to mark narration as
`commentary`. These are not fatal, but they are never expected: report them
instead of treating the transcript as clean.

If exact persisted history is unavailable, stop and report the extractor's
error. Do not substitute messages remembered from current context, select a
conversation by recency, or ask the user to provide a session ID.

Read the relevant resource for the current harness:
- Codex: [references/codex.md](references/codex.md)
- OpenCode: [references/opencode.md](references/opencode.md)
- Claude Code: [references/claude-code.md](references/claude-code.md)
- Antigravity: [references/antigravity.md](references/antigravity.md)

Read [references/transcript-schema.md](references/transcript-schema.md) only
when changing or diagnosing the canonical record contract.

## 2. Validate and view

Run the renderer as an independent validation step:

```bash
python3 <path-to-this-skill>/scripts/render_transcript.py \
  --input <actual-jsonl-path>
```

The renderer rejects malformed records and writes a self-contained page to a
temporary directory without changing the JSONL. Pass `--output` only when the
user needs the viewer at a specific location. In Claude Code, place a viewer
intended for in-app reading under the workspace (for example `.t4g/tmp/`),
because a page opened from the system temporary directory becomes a restricted
static snapshot.

Fix validation errors and rerun until the renderer succeeds. Open or share the
temporary viewer only when a human-readable review is useful.

The page embeds the transcript and opens in any browser with nothing else
installed. Without the renderer, `assets/transcript-viewer.html` itself opens
in a browser as an empty viewer: drop a JSONL archive on it, or choose one
with "View another transcript", and it is read locally, never uploaded.

## 3. Report

Report the capture source, added and updated counts, the canonical JSONL path
the extractor chose, the temporary viewer path, and any diagnostic either step
printed. Note that the assistant's current final answer can only
appear after a later append because it does not exist when extraction runs.
