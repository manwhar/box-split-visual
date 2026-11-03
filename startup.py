#!/usr/bin/env python3
"""Get this starter project ready. Run it once, after unzipping:

    python3 startup.py        (on Windows: py startup.py)

It connects the creation and packaging skills to your AI tool. Codex, Antigravity
and OpenCode find them in .agents/skills on their own; Claude Code looks
in .claude/skills, so this links both skills there
(or copies them, where links aren't allowed). Running it again
is safe. It also installs completion hooks that save registered author chats.
Reopen the AI app afterward; Codex additionally requires trust in /hooks.
It changes nothing outside this folder.
"""
import sys

# Checked before anything newer is used, so an old Python gets a clear message.
if sys.version_info < (3, 10):
    sys.exit("This needs Python 3.10 or newer. Install it from https://www.python.org/downloads/ and run this again.")

from pathlib import Path  # noqa: E402

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "explorables" / "tools"))
# pyrefly: ignore[missing-import]
import setup_skill  # noqa: E402
# pyrefly: ignore[missing-import]
import setup_transcript_hooks  # noqa: E402


def main() -> int:
    try:
        for name in setup_skill.NAMES:
            # Check the canonical folder, then connect it for Claude Code.
            setup_skill.install("codex", HERE, root=HERE, name=name)
            target, status = setup_skill.install("claude", HERE, root=HERE, name=name)
            print(f"{name}: {status.lower()}")
        setup_transcript_hooks.install(HERE)
    except (OSError, ValueError) as error:
        print(f"Setup stopped: {error}", file=sys.stderr)
        return 1
    print("The creation and packaging skills are ready for Codex, Antigravity, OpenCode and Claude Code.")
    print()
    print("Next, in your AI app, start a new project with this folder:")
    print(f"    {HERE}")
    print("Then ask it to use the create-paper-explorable skill (in Claude Code, type /create-paper-explorable).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
