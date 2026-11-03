#!/usr/bin/env python3
"""Set up the repository's explorable skills. Python 3.10+, no dependencies.

    python3 explorables/tools/setup_skill.py --harness claude
    python3 explorables/tools/setup_skill.py --harness codex --project /path/to/project

Each tool's skill folders in the project become symbolic links to this
repository's .agents/skills, so there is one copy of each skill and edits
reach every tool. Where links are not allowed
(Windows without Developer Mode), the skill's files are copied instead.
Installs stay inside the selected project and never change global agent
settings. Codex, Antigravity and OpenCode read .agents/skills, where this
repository keeps the skills, so for them in this repository the command only
checks them.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[2]
NAME = "create-paper-explorable"
NAMES = (NAME, "package-explorable")
SOURCE = Path(".agents/skills") / NAME
LOCATIONS = {
    "codex": ".agents/skills",
    "claude": ".claude/skills",
    "antigravity": ".agents/skills",
    "opencode": ".agents/skills",
}


def skill_files(root: Path = ROOT, *, name: str = NAME) -> dict[str, bytes]:
    """Only distribute instructions and their Markdown resources, never local logs."""
    if name not in NAMES:
        raise ValueError(f"Unknown explorable skill: {name}")
    source = root / SOURCE.parent / name
    paths = [source / "SKILL.md", *sorted(p for p in (source / "resources").glob("*.md")
                                        if not p.name.startswith("."))]
    files = {}
    for path in paths:
        if path.is_symlink() or not path.resolve().is_relative_to(source.resolve()):
            raise ValueError(f"Skill resources must be ordinary files inside {source}: {path}")
        files[path.relative_to(source).as_posix()] = path.read_bytes()
    for reference in re.findall(r"resources/[a-z0-9-]+\.md", files["SKILL.md"].decode("utf-8")):
        if reference not in files:
            raise ValueError(f"The skill is missing its resource: {reference}")
    return files


def _same_copy(target: Path, files: dict[str, bytes]) -> bool:
    """True when a plain folder holds exactly the skill's files, unchanged."""
    existing = {p.relative_to(target).as_posix(): p for p in target.rglob("*") if p.is_file()}
    return (set(existing) == set(files)
            and not any(p.is_symlink() for p in target.rglob("*"))
            and all(p.read_bytes() == files[n] for n, p in existing.items()))


def _copy(files: dict[str, bytes], target: Path) -> None:
    """Write the skill's files into a fresh folder at target, staged so a failure leaves nothing half-made."""
    with tempfile.TemporaryDirectory(prefix=".explorable-skill-", dir=target.parent) as staging:
        prepared = Path(staging) / target.name
        for name, content in files.items():
            path = prepared / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        prepared.rename(target)


def _remove(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def install(harness: str, project: Path, *, root: Path = ROOT,
            name: str = NAME, replace: bool = False, dry_run: bool = False) -> tuple[Path, str]:
    """Make the skill available to one agent in a project.

    The tool's skill folder becomes a symbolic link to this repository's copy
    (root/.agents/skills/name), so every tool reads the one source and edits to it reach
    all of them. The link is relative, so it keeps working when the project
    and the skill move together, as they do in an unzipped starter project.
    Where the system refuses links (Windows without Developer Mode), the
    skill's files are copied instead; run setup again after the skill changes.

    An existing copy, or a link to somewhere else, is replaced only with
    replace=True, since it may hold someone's edits. Returns the skill's
    location in the project and what happened.
    """
    files = skill_files(root, name=name)
    source = (root / SOURCE.parent / name).resolve()
    project = project.expanduser().resolve()
    if not project.is_dir():
        raise ValueError(f"Project folder does not exist: {project}")
    target = project / LOCATIONS[harness] / name
    # Do not follow an existing harness directory into another location.
    for path in target.parents:
        if path == project:
            break
        if path.is_symlink():
            raise ValueError(f"Refusing to replace or write through a symlink: {path}")
    if target == source:
        return target, "Already available from the repository's source folder"
    if target.is_symlink():
        if target.resolve() == source:
            return target, "Already linked"
        if not replace:
            raise ValueError(f"{target} links to another skill folder. Use --replace to link it to this one.")
    elif target.exists():
        if not target.is_dir():
            raise ValueError(f"The skill destination is not a folder: {target}")
        if not replace:
            if _same_copy(target, files):
                return target, "Already up to date (a copy; use --replace to link it instead)"
            raise ValueError(f"An existing copy of the skill differs at {target}. "
                             "Back up your edits, then use --replace to link it to this repository's skill.")
    exists = target.exists() or target.is_symlink()
    if dry_run:
        return target, "Would replace" if exists else "Would link"
    target.parent.mkdir(parents=True, exist_ok=True)
    # Move an old install aside rather than deleting it first, so a failure
    # below can put it back.
    backup = None
    if exists:
        backup = target.with_name(f".{name}.replaced")
        _remove(backup)
        target.rename(backup)
    try:
        try:
            os.symlink(os.path.relpath(source, target.parent), target, target_is_directory=True)
            status = "Linked"
        except (OSError, ValueError):
            # No permission for links, or (on Windows) a different drive for relpath.
            _copy(files, target)
            status = "Copied (this system does not allow links; run setup again after the skill changes)"
    except BaseException:
        if backup is not None and not (target.exists() or target.is_symlink()):
            backup.rename(target)
            backup = None
        raise
    finally:
        if backup is not None:
            _remove(backup)
    return target, status


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--harness", required=True, choices=list(LOCATIONS))
    parser.add_argument("--project", type=Path, help="Project to install into (default: this repository)")
    parser.add_argument("--dry-run", action="store_true", help="Show the destination without writing files")
    parser.add_argument("--replace", action="store_true", help="Replace an existing, different install")
    args = parser.parse_args(argv)
    try:
        for name in NAMES:
            target, status = install(args.harness, args.project or ROOT, name=name,
                                     replace=args.replace, dry_run=args.dry_run)
            print(f"{status}: {target}")
        print(f"Open this project in your agent and ask it to use {NAME} to build or package-explorable to submit.")
    except (OSError, ValueError) as error:
        parser.exit(1, f"Error: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
