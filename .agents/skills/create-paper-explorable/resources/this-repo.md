# The Starter Project

Read this when the project contains `explorables/engine/`. `explorables/CONTRIBUTING.md` defines the format; read the section a task needs rather than guessing.

## Where things go

- `explorables/rename-to-your-paper/` is the user's explorable in the starter ZIP, a copy of the slide template (in a full repository clone, copy `explorables/_template/` to `explorables/<your-paper>/`). The paper's PDF goes in this folder.
- Its `notes/` folder holds working context: the user's notes, links, and questions, plus plans, source records, and critique notes made together. It is never packaged or published.
- A runnable recreation of the paper's system goes in `lab/` in the same folder, with its own README. Keep `lab/` self-contained: copy in only the original code it needs (even if a clone already sits in `notes/`), with its license and source, rather than importing from `../notes/` or linking across folders. `lab/` is never packaged.
- `transcripts/` holds exact conversations with the authoring agent. These JSONL archives are included in the submission for feedback and skill improvement, but never published with the presentation.

## Save the author conversation

Once the explorable folder is identified, read the bundled `.agents/skills/save-chat-transcript/SKILL.md` and run `python3 explorables/tools/capture_transcript.py <folder-name>`. This registers the exact active chat to the paper, saves its persisted history, and installs project-local completion hooks. Omit the folder only when there is exactly one explorable. New chats get separate JSONL files; resumed chats update the same archive without duplicates. Registration travels with a renamed paper folder. Do not register unrelated project chats or subagent conversations.

Tell the contributor once that their authoring conversation will accompany their submission. This workflow authorizes the project-local destination; the standalone transcript skill's default location is for other exports. Capture uses the shared Python extractor in `append` mode and requires access to the matching app's exact history. Never replace it with model memory, a summary, or a guessed recent chat.

`startup.py` also installs the hooks. In a repository clone, run `python3 explorables/tools/setup_transcript_hooks.py`. Setup preserves unrelated hooks and settings, and changes nothing globally. Rerun setup after moving the whole project or changing its Python installation.

### Activate saving in the author's app

Handle installation, registration, and routine verification yourself. Give the author a visible UI action only when it is needed; they should not have to track when an internal setup step finishes. When Claude Code or Antigravity loads the hooks automatically, continue the paper work without sending the author through hook menus, startup commands, or restarts. If a required review prompt is already visible, proceed directly to approval. Ask for a restart only when the installed hooks have not loaded. These are the documented controls as of 2026-10-15:

| App | Activation and troubleshooting guidance for the agent |
| --- | --- |
| [Codex](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks) | When **Review hooks** appears, click it, select the two **Save authoring transcript** hooks, and choose **Allow selected**. In the CLI, use `/hooks`. If the installed hooks are not listed, ask the author to reopen Codex. New or changed definitions require approval; project trust alone is insufficient. |
| [Claude Code](https://code.claude.com/docs/en/hooks#workspace-trust) | Settings normally reload automatically, with no separate approval of each hook. Explain workspace trust only if a pending prompt requires the author's action. Use `/hooks` inspection or a restart only to resolve an observed loading problem. |
| [Antigravity](https://antigravity.google/docs/hooks) | Hooks default to enabled; no routine author action is needed. If verification reveals a problem, diagnose it before directing the author to **Settings > Customizations > Hooks** (app), **… > Customizations > Hooks** (IDE), or `/hooks` (CLI). Setup preserves an existing disabled choice. Reopen only if the hooks have not loaded. |
| [OpenCode](https://docs.opencode.ai/docs/plugins/) | Local plugins load automatically at startup. If the transcript plugin was installed during an already-running session and has not loaded, ask the author to reopen OpenCode. No separate hook approval step is documented. |

Leave approval and intentional enable/disable choices to the author. Do not write trust records, bypass review, or override disabled hooks or managed restrictions. Do not repeat the setup request after approval unless a definition changed or there is evidence that activation is still incomplete. Continue the recovery captures below while approval is pending.

**Installation, activation, and a successful save are different states.** Report setup as installed until there is runtime evidence. Check hook execution logs or the exact chat's hidden `transcripts/.capture/` state and its saved JSONL when verifying a save. `lastHook` records the most recent successful event; a prompt checkpoint can replace a prior `Stop` record. A manual capture or prompt checkpoint does not prove that completion saving ran. If a successful completion event has not been observed, say that completion saving is not yet verified; do not invent a test result.

### Capture and recovery

When checking a freeze boundary, `capture_transcript.py <folder> --path` prints the archive path without writing. Check its entire `transcripts/` directory (including hidden capture state), and check the configuration targets listed by `setup_transcript_hooks.py --paths` before setup. These read-only options do not register a chat or install hooks.

| App | Completion hook | Recovery checkpoint |
| --- | --- | --- |
| Codex | `Stop`, verifies the runtime turn ID and final text when supplied | `UserPromptSubmit` |
| Claude Code | `Stop`, verifies final text against persisted history; `StopFailure` saves available history without inventing an error message | `UserPromptSubmit` |
| Antigravity | `Stop`, reads the exact full log, never its abbreviated log | In-turn `capture_transcript.py` |
| OpenCode | Project plugin's `session.idle`; `session.error` saves available history | User `message.updated` |

Completion hooks retry delayed history writes and record unfinished saves durably. They never force the agent to continue talking. Codex and Claude payloads can verify the final reply; Antigravity and OpenCode do not supply that text, so those hooks check for a new assistant message and an unchanged history snapshot across two reads. That is a weaker check, not a crash-proof delivery guarantee.

Keep a recovery capture at the beginning of each user turn and before packaging, including discussion-only turns. If hooks have not been enabled, also capture before the final reply, explaining that this in-turn save cannot contain the future reply. Report capture errors. `python3 explorables/tools/transcript_hooks.py --recover <folder-name>` retries every registered chat from its exact source, including from a terminal; a later save can resolve pending final replies. Do not delete pending state to bypass a failure.

Run the bundled renderer (`python3 .agents/skills/save-chat-transcript/scripts/render_transcript.py --input <archive.jsonl>`) as an independent validation before submission; its HTML is a temporary viewer, not another canonical transcript.

## First steps

1. Once the paper is known, propose a short folder name from its title: lowercase words joined by hyphens, such as `schelling-segregation`. It becomes the explorable's address on the site. After the user agrees, rename the folder (do not copy it) and replace the `TODO` placeholders in its `explorable.json`. Keep this brief, then move on to recreation.
2. To preview, run `python3 explorables/serve.py` and open http://localhost:8790/explorables/. The gallery lists any format problems under the explorable.

## Format by task

| Task | CONTRIBUTING.md section |
| --- | --- |
| Gallery title and description (25 words or fewer) | explorable.json |
| Slides, layouts, speaker notes | slides.html |
| Demos in frames, pausing when hidden, preview images | Demos |
| The Paper panel: the checked abstract and introduction in `paper-structure.json`, each sentence tagged with a role | The paper beside your slides; Sentence roles |
| Recording which passages a slide draws on | Passages on slides |

Before writing a demo's code, read the relevant page in `explorables/_snippets/` (its README lists them): small working pages for a canvas kept sharp with `deck:resolution`, pausing with `deck:visibility`, one page serving several slides by query parameter, a seeded first view, and replaying recorded data. They are tested against the engine. Borrow their code, not their slides: they show mechanics, not how a deck should be ordered, laid out or worded.

The Paper panel is independent of the slides: changing slides never scrolls, highlights, or folds its text. Record a slide's sources as `<aside class="paper">` passages instead of designing per-slide readings.

When tagging sentence roles, tag each sentence by its job in the argument, not its topic. Instantiation is the thing under test and method is the test, so a qualitative or descriptive study has no instantiation. "We introduce X" is an idea when X is a new kind of thing defined by what it does; the artifact built to enable it is the instantiation. CONTRIBUTING gives the remaining rules and examples by paper type.

## Deck shape

The deck presents the paper as a paper first (its problem and big ideas), then demos with one idea each, and closes with open discussion questions that ask for a stance or a personal connection, not recall. Detailed lessons can follow the discussion in an appendix, as The AI Economist's do. The published examples are not in the starter; [Worked examples](worked-examples.md) summarizes what they show.

## Package to submit

Use the bundled `.agents/skills/package-explorable/SKILL.md`. It runs the submission script and gives the author a link to `<folder-name>.zip` at the top of the starter, beside `README.md`. The script checks the presentation and transcripts before writing the ZIP. If transcript saving is blocked, use the capture and recovery guidance above and retry. The ZIP contains the conversation through packaging; the completion hook saves the reply announcing the ZIP afterward, so rerun packaging if that reply must also be in the ZIP.
