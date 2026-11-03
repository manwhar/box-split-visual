"""Embed providers: something a paper's folder lends to every deck's slides.

Most of what a slide shows is the deck's own: its text, its figures, and its
demos in play-rooms (engine/js/playables.js). An embed provider lends decks
something bigger that lives somewhere else, such as Smallville Lab's guide
widgets and recorded runs, which live in explorables/generative-agents/lab.
The engine knows nothing about any one provider; a provider is a folder

    explorables/<paper>/embed/
      provider.py    what the format check, the local server and the build ask of it (below)
      <module>.js    what the deck runs, imported only by decks that use it
      <style>.css    optional: its slides' looks, linked only by decks that use it

provider.py is a Python module with these names:

    NAME          a short name, such as "smallville"
    PREFIX        where its files appear beside a deck that uses it, such as
                  "smallville/": a slide writes src="smallville/web/guide.html",
                  and the deck's page imports PREFIX + MODULE
    ATTRIBUTES    the attributes of a <div class="slot"> it owns, such as
                  ("data-guide", "data-recording"); a slot with one of them is its
    MODULE        the deck's module, such as "embed.js", served at PREFIX + MODULE
    STYLE         optional: a stylesheet, served at PREFIX + STYLE
    check_slot(slot: Slot) -> None
                  checks one of its slots, reporting problems with slot.error()
                  and slot.warning(), and noting what the deck uses in slot.state
    provides(rel: str) -> bool
                  whether it serves PREFIX + rel, for slides that load its files
    page_attributes(state: dict, *, published: bool) -> list[tuple[str, str | None]]
                  attributes it adds to the <html> of a deck that uses it
    own_files(folder: Path, state: dict) -> list[str]
                  files of the deck's own folder it needs published, such as
                  recorded runs, relative to the folder
    resolve(rel: str, state: dict, *, published: bool) -> Path | bytes | None
                  the local server's copy of PREFIX + rel: a file, made bytes, or
                  None if it has no such file. The server doesn't check the deck
                  for every file it's asked for, so `state` is {} there
    write(destination: Path, state: dict, *, options: dict) -> None
                  the build's copy: writes everything under PREFIX that a
                  published deck using it needs into `destination`; `options`
                  holds the build's settings, such as {"phaser": Path} to build
                  offline

`state` is a dict the provider fills in as its slots are checked, one per
deck, so it can say what that deck uses (Explorable.embeds holds them). A
deck uses a provider if a slot has one of its ATTRIBUTES or a slide loads a
file under its PREFIX. Providers are found by find(); the format check
reports a provider that's missing a name, or two that claim the same
attribute or prefix, in tests/test_embeds.py's terms.

Standard library only.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import importlib.util
from pathlib import Path
import re
from types import ModuleType
from typing import Callable

# The folder in a paper's folder that holds its provider.
FOLDER = "embed"
PROVIDER = "provider.py"
# What every provider defines (STYLE is optional).
REQUIRED = ("NAME", "PREFIX", "ATTRIBUTES", "MODULE", "check_slot", "provides", "page_attributes",
            "own_files", "resolve", "write")
NAME = re.compile(r"[a-z][a-z0-9-]*")


@dataclass
class Slot:
    """One <div class="slot"> a provider is asked to check, with ways to report on it."""
    attrs: dict[str, str]
    at: str  # where it is, such as "Line 12", to start a message with
    slide: str  # the id of the slide it's on
    folder: Path  # the deck's folder
    in_notes: bool
    state: dict  # the provider's notes on this deck, kept between its slots
    error: Callable[[str], None]
    warning: Callable[[str], None]


@dataclass
class Provider:
    """A provider found in a paper's folder: its module, and where it came from."""
    module: ModuleType
    folder: Path  # its embed/ folder

    @property
    def name(self) -> str:
        return self.module.NAME

    @property
    def prefix(self) -> str:
        return self.module.PREFIX

    @property
    def attributes(self) -> tuple[str, ...]:
        return tuple(self.module.ATTRIBUTES)

    @property
    def module_path(self) -> str:
        """The deck module's address, relative to a deck's page."""
        return self.prefix + self.module.MODULE

    @property
    def style_path(self) -> str | None:
        """Its stylesheet's address, relative to a deck's page, if it has one."""
        style = getattr(self.module, "STYLE", None)
        return self.prefix + style if style else None


@dataclass
class Registry:
    """Every provider in an explorables/ folder, and what's wrong with any of them."""
    providers: list[Provider] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    def for_slot(self, attrs: dict[str, str]) -> Provider | None:
        """The provider that owns a slot with these attributes, if one does."""
        return next((p for p in self.providers if any(a in attrs for a in p.attributes)), None)

    def for_reference(self, reference: str) -> Provider | None:
        """The provider whose files a reference such as "smallville/web/guide.html" names, if one does."""
        return next((p for p in self.providers if reference.startswith(p.prefix)), None)

    def named(self, name: str) -> Provider | None:
        return next((p for p in self.providers if p.name == name), None)


def _load(path: Path) -> ModuleType:
    """Import a provider.py by its path, under a name of its own, so two never collide."""
    name = f"explorables_embed_{path.parent.parent.name.replace('-', '_')}"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_cache: dict[Path, Registry] = {}


def find(root: Path) -> Registry:
    """The providers in `root` (an explorables/ folder): every <paper>/embed/provider.py.

    A provider that can't be imported, lacks one of the names above, or claims
    an attribute or prefix another already has, is left out, and the problem
    is listed in the registry's problems. Each folder is read once per process.
    """
    root = root.resolve()
    if root in _cache:
        return _cache[root]
    registry = Registry()
    for path in sorted(root.glob(f"*/{FOLDER}/{PROVIDER}")) if root.is_dir() else []:
        where = path.relative_to(root).as_posix()
        if path.parent.parent.name.startswith(("_", ".")):
            continue
        try:
            module = _load(path)
        except Exception as error:  # a broken provider shouldn't stop every other deck's check
            registry.problems.append(f"{where} can't be loaded: {error}")
            continue
        missing = [name for name in REQUIRED if not hasattr(module, name)]
        if missing:
            registry.problems.append(f"{where} doesn't define {', '.join(missing)}.")
            continue
        provider = Provider(module, path.parent)
        if not NAME.fullmatch(str(provider.name)):
            registry.problems.append(f'{where}: NAME should be a short lowercase name, such as "smallville".')
            continue
        if not (isinstance(provider.prefix, str) and re.fullmatch(r"[a-z][a-z0-9-]*/", provider.prefix)):
            registry.problems.append(f'{where}: PREFIX should be a folder name ending in "/", such as "smallville/".')
            continue
        if not provider.attributes or not all(re.fullmatch(r"data-[a-z][a-z0-9-]*", a) for a in provider.attributes):
            registry.problems.append(f"{where}: ATTRIBUTES should name data-… attributes.")
            continue
        clash = next((other for other in registry.providers if other.name == provider.name
                      or other.prefix == provider.prefix or set(other.attributes) & set(provider.attributes)), None)
        if clash:
            registry.problems.append(f"{where} claims a name, prefix or attribute that {clash.folder.parent.name}'s "
                                     "provider already has.")
            continue
        registry.providers.append(provider)
    _cache[root] = registry
    return registry


def forget() -> None:
    """Read the providers again on the next find(), as tests that make new ones need."""
    _cache.clear()
