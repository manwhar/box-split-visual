#!/usr/bin/env python3
"""Package one explorable as a ZIP to submit. Python 3.10+, no dependencies.

    python3 explorables/tools/package_explorable.py               # the only explorable
    python3 explorables/tools/package_explorable.py your-paper    # or name its folder

It checks the explorable against the format first (the same check as the
local preview's gallery) and stops on any error. The ZIP, your-paper.zip at
the top of the project, holds one folder named after the paper with the
explorable and its canonical author-conversation JSONL archives in transcripts/.
Missing or invalid transcripts stop packaging. These stay out:

  - hidden files and folders (such as .venv or .DS_Store) and __pycache__;
  - PDFs, since papers are usually under copyright;
  - lab/ and notes/ (decks.SUPPORT_FOLDERS), a paper's supporting work that
    the site never publishes.

It refuses symbolic links, a folder still named rename-to-your-paper, and
anything over MAX_BYTES or MAX_FILES. tools/intake.py applies the same rules
again when a submission arrives.
"""
from __future__ import annotations

import argparse
import io
import os
from pathlib import Path, PurePosixPath
import sys
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import decks  # noqa: E402
import capture_transcript  # noqa: E402
import transcript_state  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXPLORABLES = ROOT / "explorables"
# The starter's template folder (see tools/starter.py). It must be renamed
# after the paper, which becomes the explorable's address on the site.
PAPER_FOLDER = "rename-to-your-paper"
MAX_BYTES = 100 * 1024 * 1024
MAX_FILES = 2000
LEFT_OUT_SUFFIXES = (".pdf",)
# Folders other tools add that never belong in a submission.
LEFT_OUT_NAMES = ("__pycache__", "__MACOSX", "node_modules")


def left_out(relative: PurePosixPath) -> bool:
    """Whether a path inside an explorable's folder stays out of a submission."""
    parts = relative.parts
    return (any(part.startswith(".") or part in LEFT_OUT_NAMES for part in parts)
            or (len(parts) > 1 and parts[0] in decks.SUPPORT_FOLDERS)
            or relative.suffix.lower() in LEFT_OUT_SUFFIXES)


def choose(name: str | None, explorables: Path = EXPLORABLES) -> Path:
    """The folder to package: the one named, or the only explorable there is."""
    candidates = [f for f in sorted(explorables.iterdir()) if f.is_dir() and not f.is_symlink()
                  and not f.name.startswith(("_", ".")) and (f / decks.MANIFEST).is_file()]
    if name:
        matches = [f for f in candidates if f.name == name]
        if not matches:
            raise ValueError(f'There\'s no explorable named "{name}" in {explorables}.')
        return matches[0]
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise ValueError(f"There's no explorable in {explorables} yet.")
    raise ValueError("Name the explorable to package: " + ", ".join(f.name for f in candidates) + ".")


def package_files(folder: Path) -> tuple[dict[str, bytes], list[str]]:
    """The submission's files, by path inside the explorable's folder, and what was left out."""
    with transcript_state.locked(folder / "transcripts/.submission.jsonl"):
        return _package_files(folder)


def _package_files(folder: Path) -> tuple[dict[str, bytes], list[str]]:
    """Collect a snapshot while the caller holds this paper's save lock."""
    if folder.name == PAPER_FOLDER:
        raise ValueError(f'Rename the folder "{PAPER_FOLDER}" after your paper first, in lowercase words '
                         'joined by hyphens, such as "schelling-segregation". Your agent can do it for you.')
    explorable = decks.load(folder)
    errors = [str(p) for p in explorable.problems if p.level == "error"]
    if errors:
        raise ValueError("Fix these first:\n  " + "\n  ".join(errors))
    files, skipped, total = {}, [], 0
    for directory, folders, names in os.walk(folder):
        here = Path(directory)
        # Prune left-out folders before walking into them: a lab's virtualenv can hold thousands of files.
        for name in list(folders):
            relative = PurePosixPath((here / name).relative_to(folder).as_posix())
            if (here / name).is_symlink():
                raise ValueError(f"Submissions can't include symbolic links: {relative}")
            if left_out(relative / "x"):
                folders.remove(name)
                skipped.append(f"{relative}/")
        for name in sorted(names):
            path = here / name
            relative = PurePosixPath(path.relative_to(folder).as_posix())
            if path.is_symlink():
                raise ValueError(f"Submissions can't include symbolic links: {relative}")
            if left_out(relative):
                skipped.append(str(relative))
                continue
            total += path.stat().st_size
            if total > MAX_BYTES:
                raise ValueError(f"The explorable is over {MAX_BYTES // (1024 * 1024)} MB. "
                                 "Leave large data out, or make it smaller.")
            files[relative.as_posix()] = path.read_bytes()
            if len(files) > MAX_FILES:
                raise ValueError(f"The explorable has over {MAX_FILES} files.")
    transcript_state.check_submission(folder, files, locks_held=True)
    capture_transcript.check_submission(files)
    return files, sorted(skipped)


def archive_bytes(slug: str, files: dict[str, bytes]) -> bytes:
    """A ZIP holding one folder named slug, the same bytes every time for the same files."""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo(f"{slug}/{name}", date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    return output.getvalue()


def main(argv=None, explorables: Path = EXPLORABLES) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", nargs="?", help="The explorable's folder name in explorables/")
    parser.add_argument("--output", type=Path, help="Where to write the ZIP (default: FOLDER.zip beside explorables/)")
    args = parser.parse_args(argv)
    try:
        folder = choose(args.folder, explorables)
        # In an agent shell, refresh this exact conversation before collecting
        # the ZIP's bytes. A normal terminal packages the existing archives.
        if folder.name != PAPER_FOLDER and capture_transcript.has_identity():
            capture_transcript.capture(folder, root=explorables.parent)
        # Hold the paper's save lock until the ZIP is written, so a hook can't
        # change its transcripts or register a new chat during this snapshot.
        with transcript_state.locked(folder / "transcripts/.submission.jsonl"):
            files, skipped = _package_files(folder)
            output = args.output or explorables.parent / f"{folder.name}.zip"
            if output.is_symlink():
                raise ValueError(f"Refusing to write through a symbolic link: {output}")
            output.write_bytes(archive_bytes(folder.name, files))
    except (OSError, ValueError) as error:
        parser.exit(1, f"Not packaged. {error}\n")
    print(f"Packaged {len(files)} files: {output}")
    print("Included conversation transcripts: " + ", ".join(name for name in sorted(files)
                                                             if name.startswith("transcripts/")))
    if skipped:
        print("Left out: " + ", ".join(skipped))
    print("Upload this ZIP with the submission form.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
