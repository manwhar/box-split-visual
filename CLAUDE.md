# Explorable starter

This folder is a starter project for turning one research paper into an
explorable. The paper's explorable lives in `explorables/rename-to-your-paper/`,
with the user's own context in its `notes/` folder. `explorables/CONTRIBUTING.md`
describes the format.

The `create-paper-explorable` and `package-explorable` skills are in
`.agents/skills/`. Claude Code loads skills from `.claude/skills/`, so on first
use check whether both skills' `SKILL.md` files exist there. If either is
missing, connect the skills:

1. Run `python3 startup.py` from this folder (on Windows, `py startup.py`).
2. If Python isn't available, make the link directly. On macOS or Linux:
   `mkdir -p .claude/skills && for skill in create-paper-explorable package-explorable; do [ -e ".claude/skills/$skill" ] || ln -s "../../.agents/skills/$skill" ".claude/skills/$skill"; done`
   On Windows, in cmd (a junction needs no administrator rights):
   `mkdir .claude\skills` then
   `mklink /J .claude\skills\create-paper-explorable .agents\skills\create-paper-explorable`
   and `mklink /J .claude\skills\package-explorable .agents\skills\package-explorable`

Read the relevant skill's `SKILL.md` and follow it for the user's request:
`create-paper-explorable` to build or revise, `package-explorable` to make a
submission ZIP. You can use either skill by reading it before
slash-command discovery refreshes; do not ask the author to start a new chat
just to make the command appear.

Author conversations are saved with the paper and accompany its submission.
Run `python3 startup.py` to install the project-local transcript hooks even
if the skills are already connected. The link-only fallback above does not
enable transcript capture; it requires Python 3.10 or newer. The skill's first
capture registers the current conversation to its paper; unrelated chats are
not collected.

Handle setup and routine verification yourself. Current Claude Code normally
reloads hook settings automatically. Ask the author to act only when a pending
workspace trust prompt or a diagnosed activation problem requires it; do not
send them through hook menus, startup commands, or restarts when setup is
working. Respect existing disabled-hook settings and managed policy. Do not
claim automatic saving is active just because startup succeeded; follow the
skill's hook verification and recovery guidance while activation is pending.
