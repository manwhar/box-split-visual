"""Slide decks: find the explorables, check their format, and make their pages.

An explorable is a folder in explorables/ that holds at least

  explorable.json   what it is: its title, a one-line description, who made
                    it, and the paper it explores
  slides.html       its slides, each a <section class="slide" id="...">

and anything those slides use: images, demo pages, its own style.css.
explorables/CONTRIBUTING.md describes the format for the people who make
them, and check() enforces it, with a message for each problem that says how
to fix it.

Two programs build pages from these folders. explorables/serve.py, the local
server, makes each page when it's asked for, so a new folder shows up as soon
as it's saved; explorables/build.py writes the static site that GitHub Pages
hosts. Both use page() and gallery(), so a page looks the same in both. A
published page keeps the speaker notes and presenter mode, so anyone can
give the talk from the site, but leaves out the editor, which needs the
local server to save; the server's pages have all three.

A deck can show its paper beside the slides (engine/js/paper.js): the
abstract and introduction from the checked excerpts that explorable.json's
"paper" names in "structure". The panel never loads the PDF, so a deck with
excerpts has it on the local server and the published site alike. The PDF
("pdf") is an https:// address, such as the paper's arXiv copy, or a copy in
the folder. Papers are usually under copyright, so the site never publishes
a PDF, and git leaves them out (explorables/.gitignore); a published page
keeps the slides' passages, which point into the PDF, only when it is an
https:// address.

Slides can also show what a paper's folder lends every deck, such as
Smallville Lab's guide widgets: its embed provider (tools/embeds.py) checks
those slots, and the deck's page imports its module. The engine and these
tools know no provider by name.

Only what a deck uses is published (published_files()): the files its slides,
style.css and explorable.json name, the whole top-level folder of each demo
page they show, what its embed providers need, and whatever explorable.json's
"publish" lists, such as data a demo loads as it runs. What it publishes must
fit its size budget (BUDGET_MB, or "budgetMB").

The talk (talk/index.html) is a deck too, but a page that holds its own
slides. The server saves it with the same rules (slide_spans() and
validate_update()), and talk/tools/export-audience.py publishes it with
PageRewriter.

Standard library only, so it runs on any Python 3.10 or later.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import html
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import struct
from urllib.parse import unquote, urlsplit

import embeds

REPO = Path(__file__).resolve().parents[2]
EXPLORABLES = REPO / "explorables"

MANIFEST = "explorable.json"
# The version of the explorable format this engine reads, which every
# explorable.json names as "format". A change to the engine or the build that
# would break an existing explorable raises it, along with a way to update
# the explorables written for the older one; the check then stops an
# explorable written for a newer format than this copy of the engine knows,
# rather than letting it publish half-working.
FORMAT = 1
# Folders beside a paper's deck for its supporting work: "lab", a runnable
# research rebuild, "notes", planning and critique documents, and "embed". They belong
# to the paper's folder in the repository but not to the explorable, so the
# format check skips them and the site never publishes them (build.py).
# "embed" holds the paper's embed provider (tools/embeds.py), whose files a
# deck that uses it gets in the provider's own folder instead.
SUPPORT_FOLDERS = ("lab", "notes", embeds.FOLDER)
SLIDES = "slides.html"
# Still images of the demos, for the slide list and the presenter's preview
# (tools/capture-demo-previews.mjs makes them; engine/js/preview.js reads the index).
DEMO_PREVIEWS = "previews/index.js"
STYLE = "style.css"

# A folder's name is its address on the site: lowercase words joined by hyphens.
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
# Folders of explorables/ that aren't explorables, and names the site itself
# uses: "downloads" holds the starter project contributors download (tools/starter.py).
RESERVED = frozenset({"engine", "tools", "tests", "downloads"})
SLIDE_ID = re.compile(r"[A-Za-z][A-Za-z0-9_-]*")
# The fonts every deck's look uses (engine/deck.css).
FONTS = ("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600"
         "&family=Nunito:wght@400;600;700;800"
         "&family=Nunito+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,600&display=swap")
# Opens a deck as the presenter's audience window (engine/js/presenter.js)
# before the page is first drawn, so its controls never flash on screen. Both
# the local server's pages and published ones have it, since both have
# presenter mode; the talk's audience edition (data-audience) has neither.
PRESENTATION_FLAG = ('<script>if (!document.documentElement.hasAttribute("data-audience") && '
                     'new URLSearchParams(location.search).get("view") === "presentation") '
                     'document.documentElement.dataset.presentation = "audience";</script>')

# Files bigger than these are hard on visitors, on git and on GitHub Pages.
LARGE_FILE = 20 * 1024 * 1024
HUGE_FILE = 95 * 1024 * 1024
# How much one explorable may publish, in megabytes, unless explorable.json's
# "budgetMB" raises it, up to MAX_BUDGET_MB. Dozens of explorables share one
# GitHub Pages site, which holds at most 1 GB (build.py checks the total).
BUDGET_MB = 25
MAX_BUDGET_MB = 100
# What an explorable's folder never publishes, however it's named: its slides'
# source (its page holds the slides), its tests and its support folders.
PRIVATE = frozenset({SLIDES, "tests", "transcripts", *SUPPORT_FOLDERS})
# Text set smaller than this on a 1600 × 900 slide is hard to read when projected.
MIN_FONT_PX = 24


# ===================================================================== problems
@dataclass(frozen=True)
class Problem:
    """Something wrong with an explorable, for the person who made it.

    An error keeps the explorable off the published site until it's fixed; a
    warning is worth fixing but doesn't.
    """
    level: str  # "error" or "warning"
    file: str  # the file it's in, relative to the explorable's folder
    message: str  # what's wrong and how to fix it

    def __str__(self) -> str:
        return f"{self.level}: {self.file}: {self.message}"


class _Report:
    """Collects problems for one file."""

    def __init__(self, problems: list[Problem], file: str):
        self.problems, self.file = problems, file

    def error(self, message: str) -> None:
        self.problems.append(Problem("error", self.file, message))

    def warning(self, message: str) -> None:
        self.problems.append(Problem("warning", self.file, message))


@dataclass
class Explorable:
    """One explorable's folder, as read from disk, and what's wrong with it."""
    slug: str
    folder: Path
    manifest: dict = field(default_factory=dict)
    slides: str = ""
    problems: list[Problem] = field(default_factory=list)
    # The embed providers its slides use, by name, each with its notes on what
    # they use (tools/embeds.py), in the order the slides first use them.
    embeds: dict[str, dict] = field(default_factory=dict)
    # The files in its folder that its slides and style.css name, relative to it.
    references: set[str] = field(default_factory=set)
    # How many passages of the paper its slides point to (<aside class="paper">).
    passages: int = 0

    @property
    def errors(self) -> list[Problem]:
        return [p for p in self.problems if p.level == "error"]

    @property
    def warnings(self) -> list[Problem]:
        return [p for p in self.problems if p.level == "warning"]

    @property
    def draft(self) -> bool:
        return self.manifest.get("draft") is True

    @property
    def title(self) -> str:
        title = self.manifest.get("title")
        return title.strip() if isinstance(title, str) and title.strip() else self.slug

    @property
    def budget_mb(self) -> float:
        """How many megabytes it may publish: its "budgetMB", or BUDGET_MB."""
        budget = self.manifest.get("budgetMB")
        valid = isinstance(budget, (int, float)) and not isinstance(budget, bool) and 0 < budget <= MAX_BUDGET_MB
        return budget if valid else BUDGET_MB


# ==================================================================== discovery
def default_registry(root: Path = EXPLORABLES) -> embeds.Registry:
    """Embed providers in `root`, plus the repository's own when `root` is another folder."""
    registry = embeds.find(root)
    if root.resolve() == EXPLORABLES.resolve():
        return registry
    fallback = embeds.find(EXPLORABLES)
    providers = list(registry.providers)
    for provider in fallback.providers:
        clash = any(other.name == provider.name or other.prefix == provider.prefix
                    or set(other.attributes) & set(provider.attributes) for other in providers)
        if not clash:
            providers.append(provider)
    return embeds.Registry(providers=providers, problems=list(registry.problems))


def discover(root: Path = EXPLORABLES, *, registry: embeds.Registry | None = None) -> list[Explorable]:
    """Every explorable in `root`, checked, in the order the gallery lists them.

    A folder is an explorable if it holds an explorable.json. Folders whose
    names start with "_" or "." (such as _template) are skipped.
    """
    resolved_registry = registry if registry is not None else default_registry(root)
    found = []
    for folder in sorted(root.iterdir()) if root.is_dir() else []:
        if folder.name.startswith(("_", ".")) or not folder.is_dir() or folder.is_symlink():
            continue
        if (folder / MANIFEST).is_file():
            found.append(load(folder, registry=resolved_registry))
    return sorted(found, key=lambda e: (e.title.casefold(), e.slug))


def load(folder: Path, *, registry: embeds.Registry | None = None) -> Explorable:
    """Read one explorable's folder and check it against the format.

    Its slots are checked by the folder's and repository's embed providers,
    unless `registry` names others.
    """
    registry = registry if registry is not None else default_registry(folder.parent)
    explorable = Explorable(slug=folder.name, folder=folder)
    problems = explorable.problems
    _check_name(folder.name, _Report(problems, folder.name + "/"))
    _check_files(folder, problems)
    explorable.manifest = _load_manifest(folder, _Report(problems, MANIFEST))
    source = folder / SLIDES
    report = _Report(problems, SLIDES)
    if not source.is_file():
        report.error("There's no slides.html. Every explorable needs one, holding its slides.")
        return explorable
    try:
        explorable.slides = source.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        report.error("slides.html isn't UTF-8 text. Save it with the UTF-8 encoding.")
        return explorable
    scan = _check_slides(explorable, report, registry)
    style = folder / STYLE
    if style.is_file():
        _check_style(folder, style, scan, _Report(problems, STYLE), explorable)
    _check_publishing(explorable, registry, _Report(problems, MANIFEST))
    return explorable


def _check_name(name: str, report: _Report) -> None:
    if name.startswith("_"):
        message = 'Folders whose names start with "_" are left out of the gallery and the site.'
        # Only the template is meant to be copied; other "_" folders, such as
        # _snippets, are references whose code is borrowed, not whole decks.
        if name == "_template":
            message += (' To make an explorable from this one, copy it to a folder named after your paper, '
                        'such as "my-paper".')
        report.warning(message)
    elif not SLUG.fullmatch(name):
        report.error(f'The folder\'s name "{name}" is its address on the site, so it can only use lowercase '
                     'letters, digits and single hyphens, such as "schelling-segregation".')
    elif name in RESERVED:
        report.error(f'"{name}" is a name the site uses for itself. Rename the folder.')


def _check_files(folder: Path, problems: list[Problem]) -> None:
    """Links that could lead out of the folder, and files too big to host."""
    # Prune the support folders before walking: a lab's virtualenv and training
    # caches can hold thousands of files, symlinks and multi-gigabyte checkpoints.
    tops = [p for p in folder.iterdir() if not (p.name in SUPPORT_FOLDERS and p.is_dir() and not p.is_symlink())]
    paths = [q for top in tops for q in [top, *(top.rglob("*") if top.is_dir() and not top.is_symlink() else [])]]
    for path in sorted(paths):
        relative = path.relative_to(folder).as_posix()
        report = _Report(problems, relative)
        if path.is_symlink():
            report.error("This is a symbolic link. Put a copy of the file itself in the folder instead.")
            continue
        if not path.is_file():
            continue
        size = path.stat().st_size
        if size > HUGE_FILE:
            report.error(f"This file is {size / 2**20:.0f} MB. GitHub won't take files over 100 MB; "
                         "make it smaller or leave it out.")
        elif size > LARGE_FILE:
            report.warning(f"This file is {size / 2**20:.0f} MB, slow for visitors to load. Make it smaller if you can.")


# ===================================================================== manifest
MANIFEST_FIELDS = {"format", "publish", "budgetMB", "title", "description", "authors", "byline", "paper", "cover", "draft", "credits", "lang", "tags"}
PAPER_FIELDS = {"title", "authors", "year", "venue", "url", "pdf", "firstPage", "structure"}
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
# The most words a "description" may have. A gallery card has room for about
# this many before its tags and byline are pushed down and the card grows
# taller than its neighbors.
DESCRIPTION_WORDS = 25
# The paper structure exercise's sentence roles, and the optional subtypes some
# roles take. They mirror ROLE_LABELS and ROLE_SUBTYPES in
# engine/js/paper-text.js, which the reader uses (a test keeps the two equal).
STRUCTURE_ROLES = ("context", "gap", "idea", "instantiation", "method", "findings", "implications")
STRUCTURE_SUBTYPES = {
    "gap": ("problem", "question", "tension"),
    "idea": ("insight", "lens", "hypothesis", "assumption"),
    "instantiation": ("system", "model", "intervention", "dataset"),
    "implications": ("design", "theory", "policy", "practice", "limits"),
}


def _text(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _load_manifest(folder: Path, report: _Report) -> dict:
    path = folder / MANIFEST
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        report.error("There's no explorable.json. Copy the one in explorables/_template and fill it in.")
        return {}
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        report.error(f"explorable.json isn't valid JSON ({error}). Check for a missing comma or quote.")
        return {}
    if not isinstance(manifest, dict):
        report.error("explorable.json must hold one JSON object, in { }.")
        return {}
    _check_format(manifest.get("format"), report)
    for key in sorted(set(manifest) - MANIFEST_FIELDS):
        report.warning(f'"{key}" isn\'t a field the gallery uses. Check its spelling; the fields are '
                       f'{", ".join(sorted(MANIFEST_FIELDS))}.')
    if not _text(manifest.get("title")):
        report.error('Give the explorable a "title".')
    elif len(manifest["title"]) > 120:
        report.error('The "title" is over 120 characters. Shorten it.')
    if not _text(manifest.get("description")):
        report.error('Give a "description": 25 words or fewer for its card in the gallery.')
    elif (words := len(manifest["description"].split())) > DESCRIPTION_WORDS:
        report.error(f'The "description" has {words} words. Keep it to {DESCRIPTION_WORDS} or fewer, '
                     'so it fits its card in the gallery.')
    authors = manifest.get("authors")
    if not (isinstance(authors, list) and authors and all(_text(a) for a in authors)):
        report.error('List who made the explorable in "authors", such as ["Ada Lovelace"].')
    if "byline" in manifest and not _text(manifest["byline"]):
        report.error('"byline" should be text, or left out.')
    paper = manifest.get("paper")
    if not isinstance(paper, dict):
        report.error('Describe the paper it explores in "paper", with its "title", "authors" and "year".')
    else:
        for key in sorted(set(paper) - PAPER_FIELDS):
            report.warning(f'"paper" has a field "{key}" the gallery doesn\'t use. The fields are '
                           f'{", ".join(sorted(PAPER_FIELDS))}.')
        for key in ("title", "authors"):
            if not _text(paper.get(key)):
                report.error(f'Give the paper\'s "{key}", as text.')
        year = paper.get("year")
        if not (isinstance(year, int) and not isinstance(year, bool) and 1000 <= year <= 2100):
            report.error('Give the year the paper came out as a number, such as "year": 2023.')
        if "venue" in paper and not _text(paper["venue"]):
            report.error('"venue" should be text, such as "ACM UIST", or left out.')
        if "url" in paper and not (isinstance(paper["url"], str) and re.match(r"https?://\S+$", paper["url"])):
            report.error('The paper\'s "url" should be a web address, such as "https://doi.org/…".')
        if "pdf" in paper:
            _check_paper_pdf(folder, paper["pdf"], report)
        if "structure" in paper:
            structure = paper["structure"]
            target, error = _local_file(folder, structure) if isinstance(structure, str) else (None, "not text")
            if error or target is None or not target.is_file() or target.suffix != ".json":
                report.error('"structure" must name a local JSON file containing the paper\'s sentence roles.')
            else:
                _check_paper_structure(target, report)
        first = paper.get("firstPage", 1)
        if not (isinstance(first, int) and not isinstance(first, bool) and first >= 1):
            report.error('"firstPage" should be the page number printed on the PDF\'s first page, such as 143, '
                         "or left out if it's 1.")
    if "cover" in manifest:
        cover = manifest["cover"]
        target, problem = (None, '"cover" should be the name of an image in the folder.') if not _text(cover) \
            else _local_file(folder, cover)
        if problem:
            report.error(f'"cover": {problem}')
        elif target is None or not target.is_file():
            report.error(f'"cover" names {cover}, which isn\'t in the folder.')
        elif target.suffix.lower() not in IMAGE_TYPES:
            report.error(f'"cover" should be an image ({", ".join(sorted(IMAGE_TYPES))}).')
    if "draft" in manifest and not isinstance(manifest["draft"], bool):
        report.error('"draft" should be true or false.')
    if "credits" in manifest and not _text(manifest["credits"]):
        report.error('"credits" should be text, or left out.')
    if "lang" in manifest and not (isinstance(manifest["lang"], str) and re.fullmatch(r"[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*", manifest["lang"])):
        report.error('"lang" should be a language code, such as "en" or "es".')
    if "tags" in manifest and not (isinstance(manifest["tags"], list) and all(_text(t) for t in manifest["tags"])):
        report.error('"tags" should be a list of words, such as ["sociology", "simulation"].')
    # The template's placeholders all start with "TODO".
    for where, value in _strings(manifest):
        if value.strip().startswith("TODO"):
            report.error(f"Replace the template's placeholder in {where}.")
    return manifest


def _check_format(value, report: _Report) -> None:
    """explorable.json's "format": the version of the format it's written for (FORMAT)."""
    if value is None:
        report.error(f'Add "format": {FORMAT} to explorable.json. It says which version of the explorable '
                     "format the folder is written for, so a change to the engine can't silently break it.")
    elif not (isinstance(value, int) and not isinstance(value, bool) and value >= 1):
        report.error(f'"format" should be a whole number, the format\'s version: "format": {FORMAT}.')
    elif value > FORMAT:
        report.error(f'This explorable is written for format {value}, but this copy of the engine only knows '
                     f"format {FORMAT}. Update your copy of the repository (or download a new starter) first.")


def _check_paper_structure(path: Path, report: _Report) -> None:
    """Keep the distributed reader data limited to checked introductory excerpts."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or set(data) - {"source", "metadata", "annotationSource", "sections"}:
            raise ValueError("only source metadata, annotations, and excerpt sections are allowed; remove PDF layout/full-text data")
        if not isinstance(data.get("metadata"), dict) or not _text(data["metadata"].get("title")):
            raise ValueError("include the paper title in metadata")
        sections = data.get("sections")
        if not isinstance(sections, list) or not sections:
            raise ValueError("include the introduction, and the abstract if the paper has one")
        seen_sections, seen_blocks = set(), set()
        for section in sections:
            if not isinstance(section, dict) or section.get("id") not in {"abstract", "introduction"}:
                raise ValueError("only abstract and introduction sections are allowed")
            if section["id"] in seen_sections:
                raise ValueError("section IDs must be unique")
            seen_sections.add(section["id"])
            paragraphs = section.get("paragraphs")
            if not isinstance(paragraphs, list) or not paragraphs:
                raise ValueError("each section needs checked paragraphs")
            for paragraph in paragraphs:
                if not isinstance(paragraph, dict) or not isinstance(paragraph.get("blocks"), list) or not paragraph["blocks"]:
                    raise ValueError("each paragraph needs sentence blocks")
                for block in paragraph["blocks"]:
                    if not isinstance(block, dict) or not _text(block.get("id")) or not _text(block.get("text")):
                        raise ValueError("each block needs its original text and ID")
                    if block["id"] in seen_blocks:
                        raise ValueError("sentence block IDs must be unique")
                    seen_blocks.add(block["id"])
                    heading = paragraph.get("kind") == "heading"
                    if not heading and block.get("role") not in STRUCTURE_ROLES:
                        raise ValueError("each prose block needs a paper structure exercise role: " + ", ".join(STRUCTURE_ROLES))
                    if "subtype" in block and (heading or block["subtype"] not in STRUCTURE_SUBTYPES.get(block.get("role"), ())):
                        allowed = STRUCTURE_SUBTYPES.get(block.get("role"))
                        raise ValueError(f'{block["id"]}: "{block["subtype"]}" is not a subtype of {block.get("role") or "a heading"}'
                                         + (f' (use one of {", ".join(allowed)})' if allowed and not heading else " (it takes none)"))
        if "introduction" not in seen_sections:
            raise ValueError("include the introduction")
    except (OSError, ValueError, TypeError) as error:
        report.error(f'"structure" must contain annotated abstract/introduction excerpts: {error}.')


def _check_paper_pdf(folder: Path, pdf, report: _Report) -> None:
    """The paper's "pdf", which the Paper panel's Original link opens: an https:// address, or a copy in the folder.

    A copy that isn't there is no problem: it's on the computer of whoever
    presents from it, and git leaves it out, so the copy on GitHub never has it.
    """
    if not _text(pdf):
        report.error('The paper\'s "pdf" should be its PDF: an address such as "https://arxiv.org/pdf/2304.03442v2", '
                     'or "paper.pdf" for a copy in the folder.')
        return
    if re.match(r"http://", pdf):
        report.error('The paper\'s "pdf" should be an https:// address. Browsers won\'t load http:// on the published site.')
        return
    if re.match(r"https://", pdf):
        if not re.match(r"https://\S+$", pdf):
            report.error('The paper\'s "pdf" address has a space in it. Check that it\'s the whole address.')
        return
    target, problem = _local_file(folder, pdf)
    if problem:
        report.error(f'The paper\'s "pdf": {pdf} {problem}')
    elif target is None or target.suffix.lower() != ".pdf":
        report.error('The paper\'s "pdf" should name a PDF in the folder, such as "paper.pdf", or be an https:// address.')


def paper_pdf(explorable: Explorable, *, published: bool) -> str | None:
    """The paper's PDF as the explorable's page addresses it, or None if the page names none.

    An https:// address works wherever the explorable is. A copy in the folder
    is only on the computer of whoever put it there, so only the local server's
    page names it; a published page never does.
    """
    paper = explorable.manifest.get("paper")
    pdf = paper.get("pdf") if isinstance(paper, dict) else None
    if not _text(pdf):
        return None
    pdf = pdf.strip()
    if pdf.startswith("https://"):
        return None if re.search(r"\s", pdf) else pdf
    if published or re.match(r"[a-zA-Z][\w+.-]*:|//", pdf):
        return None
    target, problem = _local_file(explorable.folder, pdf)
    if problem or target is None or target.suffix.lower() != ".pdf" or not target.is_file():
        return None
    return pdf


def _strings(value, where="explorable.json"):
    """Every string in a JSON value, with where it is."""
    if isinstance(value, str):
        yield where, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _strings(item, f'"{key}"')
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item, where)


# ======================================================================= slides
VOID = frozenset("area base br col embed hr img input link meta param source track wbr".split())
# Tags that belong to the page the slides go in, which is made for them.
PAGE_TAGS = {
    "script": "Slides can't have scripts. Put an interactive demo in a page of its own and show it in a play-room "
              "(see CONTRIBUTING.md).",
    "style": "Put styles in style.css, beside slides.html.",
    "link": "Put styles in style.css; fonts and the deck's look are added for you.",
    "meta": "slides.html holds only slides; the page around them is made for you.",
    "base": "slides.html holds only slides; the page around them is made for you.",
    "html": "slides.html holds only slides; the page around them is made for you.",
    "head": "slides.html holds only slides; the page around them is made for you.",
    "body": "slides.html holds only slides; the page around them is made for you.",
    "title": "Put the title in explorable.json.",
}


@dataclass
class _Element:
    tag: str
    attrs: dict[str, str]
    classes: list[str]
    slide: str | None  # the id of the slide it's in
    line: int
    in_notes: bool
    in_play_set: bool
    in_paper: bool = False  # inside an <aside class="paper">, the passages of the paper a slide draws on
    in_cite: bool = False  # inside a passage's <cite>, as words set in italics are
    text: str = ""  # a passage's own text (only <cite>s in an <aside class="paper"> keep theirs)


class _SlideScanner(HTMLParser):
    """Walks slides.html, noting each slide and each element in it."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, list[str]]] = []
        self.slide: dict | None = None
        self.slides: list[dict] = []
        self.elements: list[_Element] = []
        self.stray: list[tuple[int, str]] = []  # content outside every slide
        self.nested: list[int] = []  # lines of slides inside other slides
        self.cite: _Element | None = None  # a passage being read, which keeps its text

    def handle_starttag(self, tag, attrs):
        line = self.getpos()[0]
        values = {k: ("" if v is None else v) for k, v in attrs}
        classes = values.get("class", "").split()
        if tag == "section" and "slide" in classes:
            if self.slide is not None:
                self.nested.append(line)
            else:
                self.slide = {"id": values.get("id", ""), "classes": classes, "line": line, "headings": 0,
                              "part": values.get("data-part")}
                self.slides.append(self.slide)
                self.stack = []
        elif self.slide is None:
            self.stray.append((line, f"<{tag}>"))
            if tag not in VOID:
                self.stack.append((tag, classes))
            return
        in_notes = any(t == "aside" and "notes" in c for t, c in self.stack)
        in_play_set = any("play-set" in c for _, c in self.stack)
        in_paper = any("paper" in c for _, c in self.stack)
        in_cite = in_paper and any(t == "cite" for t, _ in self.stack)
        element = _Element(tag, values, classes, self.slide["id"], line, in_notes, in_play_set, in_paper, in_cite)
        self.elements.append(element)
        if tag == "cite" and in_paper:
            self.cite = element
        if tag in {"h1", "h2"} and not in_notes and not in_paper:
            self.slide["headings"] += 1
        if tag not in VOID:
            self.stack.append((tag, classes))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == "cite":
            self.cite = None
        # Close the most recent open element of this kind, and any left open inside it.
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break
        if self.slide is not None and tag == "section" and not self.stack:
            self.slide = None

    def handle_data(self, data):
        if self.cite is not None:
            self.cite.text += data
        if self.slide is None and data.strip():
            self.stray.append((self.getpos()[0], f'the text "{data.strip()[:40]}"'))

    def handle_decl(self, decl):
        self.stray.append((self.getpos()[0], f"<!{decl}>"))


def _check_slides(explorable: Explorable, report: _Report, registry: embeds.Registry) -> _SlideScanner:
    folder, source = explorable.folder, explorable.slides
    scan = _SlideScanner()
    scan.feed(source)
    scan.close()
    if scan.slide is not None:
        report.error(f'The slide that starts on line {scan.slide["line"]} has no </section> to end it.')
    for line, what in scan.stray[:5]:
        report.error(f"Line {line}: {what} is outside every slide. Everything in slides.html goes inside a "
                     '<section class="slide">, except comments.')
    for line in scan.nested:
        report.error(f"Line {line}: a slide is inside another slide. End each slide before starting the next.")
    if not scan.slides:
        report.error('There are no slides. Each slide is a <section class="slide" id="…">.')
        return scan
    ids: dict[str, int] = {}
    for slide in scan.slides:
        where = f'The slide on line {slide["line"]}'
        if not slide["id"]:
            report.error(f'{where} has no id. Give each slide an id, such as id="the-model"; it\'s the slide\'s address.')
        elif not SLIDE_ID.fullmatch(slide["id"]):
            report.error(f'{where} has the id "{slide["id"]}". Ids start with a letter and use only letters, digits, - and _.')
        if slide["headings"] != 1:
            report.error(f'{where} ({slide["id"] or "no id"}) has {slide["headings"]} headings. Give each slide '
                         'exactly one <h2> (or <h1>): the slide list shows it. To hide it, use <h2 class="sr-only">.')
    for element in scan.elements:
        identity = element.attrs.get("id")
        if identity:
            if identity in ids:
                report.error(f'Line {element.line}: the id "{identity}" is also used on line {ids[identity]}. '
                             "Every id must be different.")
            ids.setdefault(identity, element.line)
    slide_ids = {s["id"] for s in scan.slides if s["id"]}
    for element in scan.elements:
        _check_element(element, folder, slide_ids, registry, report, explorable)
    paper = explorable.manifest.get("paper")
    if explorable.passages and not (isinstance(paper, dict) and "pdf" in paper):
        report.warning('Its slides point to passages of the paper, but explorable.json\'s "paper" has no "pdf" '
                       "for their pages to point into, so the published page leaves them out. "
                       "CONTRIBUTING.md says how to add one.")
    return scan


def _check_element(element: _Element, folder: Path, slide_ids: set[str], registry: embeds.Registry,
                   report: _Report, explorable: Explorable) -> None:
    tag, attrs, line = element.tag, element.attrs, element.line
    at = f"Line {line}"
    if tag in PAGE_TAGS:
        report.error(f"{at}: <{tag}>. {PAGE_TAGS[tag]}")
        return
    for name in attrs:
        if name.startswith("on"):
            report.error(f'{at}: the {name}="…" attribute runs a script. Slides can\'t run scripts; '
                         "put interactive parts in a demo page shown in a play-room.")
    # Links between slides, and to files and other sites.
    href = attrs.get("href")
    if tag == "a" and href is not None:
        if href.startswith("#"):
            if href[1:] not in slide_ids:
                report.error(f'{at}: the link to "{href}" goes to no slide. Links within an explorable '
                             "name a slide's id.")
        elif re.match(r"(https?:)?//", href) and attrs.get("target") != "_blank":
            report.warning(f'{at}: the link to {href} would replace the slides. Add target="_blank" '
                           'rel="noopener" so it opens in a new tab.')
    # Every file a slide loads must be in the folder.
    references = [(name, attrs[name]) for name in ("src", "data-src", "poster", "data", "href") if attrs.get(name)]
    references += [("srcset", candidate.split()[0]) for candidate in attrs.get("srcset", "").split(",") if candidate.strip()]
    references += [("style", url) for url in _css_urls(attrs.get("style", ""))]
    for name, reference in references:
        if name == "href" and reference.startswith("#"):
            continue
        provider = registry.for_reference(reference)
        if provider is not None:
            explorable.embeds.setdefault(provider.name, {})
            if not provider.module.provides(urlsplit(reference).path[len(provider.prefix):]):
                report.error(f"{at}: {reference} isn't one of the {provider.prefix} files "
                             f"{provider.folder.parent.name}/{embeds.FOLDER}/ provides.")
            continue
        if re.match(r"(https?:)?//", reference) and name != "href":
            if reference.startswith("http://"):
                report.warning(f"{at}: {reference} loads over http://, which browsers block on an https:// site. Use https://.")
            continue
        target, problem = _local_file(folder, reference)
        if problem:
            report.error(f"{at}: {name}={reference!r} {problem}")
        elif target is not None and target.suffix.lower() == ".pdf":
            report.error(f"{at}: {reference} is a PDF, and the site never publishes PDFs, since papers are usually "
                         'under copyright. Link to the paper\'s own page instead, or name the PDF as "pdf" in '
                         'explorable.json\'s "paper", for the Paper panel\'s Original link.')
        elif target is not None and not target.exists():
            report.error(f"{at}: {reference} isn't in the folder. Check the file's name and place.")
        elif target is not None and not element.in_notes:
            explorable.references.add(target.relative_to(folder.resolve()).as_posix())
    if ("paper" in element.classes or element.in_paper) and not element.in_cite:
        _check_passage(element, report, explorable)
    if tag == "img":
        _check_image(element, folder, report)
    if tag == "iframe":
        _check_frame(element, report)
    if "slot" in element.classes:
        _check_slot(element, folder, registry, report, explorable)


def _check_passage(element: _Element, report: _Report, explorable: Explorable) -> None:
    """A slide's list of the passages of the paper it draws on: <aside class="paper"> with a <cite> for each."""
    attrs, at = element.attrs, f"Line {element.line}"
    if "paper" in element.classes:
        if element.tag != "aside" or element.in_paper:
            report.error(f'{at}: class="paper" is for the <aside> that lists the passages of the paper a slide '
                         "draws on. Give this element another class.")
        return
    if element.tag != "cite":
        report.error(f'{at}: an <aside class="paper"> holds only passages, each a <cite data-page="…" '
                     f'data-find="…">what it says</cite>, not a <{element.tag}>.')
        return
    explorable.passages += 1
    paper = explorable.manifest.get("paper")
    first = paper.get("firstPage", 1) if isinstance(paper, dict) else 1
    page = attrs.get("data-page", "").strip()
    if not re.fullmatch(r"\d+", page) or int(page) < 1:
        report.error(f'{at}: give the passage the page it\'s on, as printed on the paper: data-page="2".')
    elif isinstance(first, int) and not isinstance(first, bool) and int(page) < first:
        report.error(f"{at}: page {page} comes before the paper's first page, {first} (\"firstPage\" in "
                     "explorable.json). Use the page number printed on the paper.")
    words = len(attrs.get("data-find", "").split())
    if words > 12:
        report.warning(f"{at}: data-find has {words} words. A few distinctive words on that page are enough to find "
                       "the passage, and they're all the slides should copy of the paper.")
    if not element.text.strip():
        report.warning(f"{at}: say what the passage is about in the <cite>, such as <cite …>Where segregation "
                       "comes from</cite>, so the slide's record of its sources says what each one is.")


def _check_image(element: _Element, folder: Path, report: _Report) -> None:
    attrs, at = element.attrs, f"Line {element.line}"
    src = attrs.get("src", "")
    if "alt" not in attrs:
        report.error(f'{at}: the image {src} has no alt text. Describe it in alt="…" for people who can\'t see it.')
    elif not attrs["alt"].strip():
        report.warning(f'{at}: the image {src} has an empty alt. Describe it, unless it\'s only decoration.')
    width, height = attrs.get("width"), attrs.get("height")
    if not (width and height):
        report.warning(f'{at}: give the image {src} its width="…" and height="…", so the slide keeps its '
                       "space while it loads.")
        return
    target, problem = _local_file(folder, src)
    if problem or target is None or not target.is_file():
        return
    size = image_size(target)
    try:
        ratio = float(width) / float(height)
    except (ValueError, ZeroDivisionError):
        report.warning(f"{at}: the image's width and height should be numbers of pixels.")
        return
    if size and abs(ratio / (size[0] / size[1]) - 1) > 0.02:
        report.warning(f"{at}: width and height ({width} × {height}) don't have the proportions of {src} "
                       f"({size[0]} × {size[1]}), so it would look stretched.")


def _check_frame(element: _Element, report: _Report) -> None:
    attrs, at = element.attrs, f"Line {element.line}"
    name = attrs.get("data-src") or attrs.get("src") or "a frame"
    if not element.in_play_set:
        report.warning(f'{at}: put the frame {name} in a play-room (<div class="play-room"><div class="play-set">), '
                       "so it's scaled to fit its slide and loads when the slide comes up.")
        return
    if "src" in attrs:
        report.error(f'{at}: write src= as data-src= on frames in a play-room, so {name} loads when its slide comes up.')
    if not attrs.get("data-src"):
        report.error(f"{at}: the frame has no data-src naming the page it shows.")
    for dimension in ("width", "height"):
        if not re.fullmatch(r"\d+", attrs.get(dimension, "")) or int(attrs[dimension]) <= 0:
            report.error(f'{at}: give the frame {name} its {dimension}="…" in pixels, the size its page is laid out for.')
    if len(attrs.get("title", "").strip()) < 10:
        report.warning(f'{at}: give the frame {name} a title="…" saying what it shows, for screen readers.')
    if attrs.get("scrolling") != "no":
        report.warning(f'{at}: add scrolling="no" to the frame {name}; nothing on a slide should scroll.')


def _check_slot(element: _Element, folder: Path, registry: embeds.Registry, report: _Report,
                explorable: Explorable) -> None:
    """A <div class="slot">: a place on a slide for what an embed provider shows (tools/embeds.py)."""
    attrs, at = element.attrs, f"Line {element.line}"
    provider = registry.for_slot(attrs)
    if provider is None:
        if not element.in_notes:
            known = ", ".join(a for p in registry.providers for a in p.attributes) or "none in this copy"
            report.warning(f"{at}: this slot shows nothing. A slot holds what an embed provider shows, named by "
                           f"one of its attributes ({known}); for your own demo, use a play-room.")
        return
    state = explorable.embeds.setdefault(provider.name, {})
    provider.module.check_slot(embeds.Slot(attrs=attrs, at=at, slide=element.slide or "", folder=folder,
                                           in_notes=element.in_notes, state=state,
                                           error=report.error, warning=report.warning))


def _local_file(folder: Path, reference: str) -> tuple[Path | None, str | None]:
    """The file a reference in an explorable points at, or why it can't point there.

    Returns (None, None) for references that aren't files in the folder: other
    sites, e-mail addresses, data: URLs and links within the page.
    """
    reference = reference.strip()
    parts = urlsplit(reference)
    if not reference or reference.startswith("#") or reference.startswith("//"):
        return None, None
    if parts.scheme in {"http", "https", "mailto", "tel", "data"}:
        return None, None
    if parts.scheme:
        return None, f"uses {parts.scheme}:, which a slide can't."
    path = unquote(parts.path)
    if not path:
        return None, None
    if path.startswith("/"):
        return None, ("starts with /, which leads out of the explorable on the published site. "
                      "Write it relative to the folder, such as img/figure.png.")
    root = folder.resolve()
    target = (folder / path).resolve()
    if not target.is_relative_to(root):
        return None, "leads out of the explorable's folder. Copy what it needs into the folder."
    return target, None


# =================================================================== publishing
def _private(relative: str) -> bool:
    """Whether a file of an explorable's folder is never published: hidden, a PDF, or in PRIVATE."""
    parts = PurePosixPath(relative).parts
    return (not parts or parts[0] in PRIVATE or any(part.startswith(".") for part in parts)
            or relative.lower().endswith(".pdf"))


def _files_in(folder: Path, relative: str) -> list[str]:
    """The files at `relative` in an explorable's folder: the file itself, or every file in the folder."""
    target = folder / relative
    if target.is_symlink():
        return []
    if target.is_file():
        return [relative]
    if not target.is_dir():
        return []
    return sorted(p.relative_to(folder).as_posix() for p in target.rglob("*") if p.is_file() and not p.is_symlink())


def _publish_patterns(manifest: dict) -> list[str]:
    """explorable.json's "publish": what the explorable publishes beyond what its slides name."""
    patterns = manifest.get("publish", [])
    return [p.strip() for p in patterns if _text(p)] if isinstance(patterns, list) else []


def _matching(folder: Path, pattern: str) -> list[str]:
    """The files a "publish" pattern names: a file, a folder ending in "/", or a glob such as "data/*.json"."""
    if pattern.endswith("/"):
        return _files_in(folder, pattern.rstrip("/"))
    if any(c in pattern for c in "*?["):
        return sorted(f for p in folder.glob(pattern) for f in _files_in(folder, p.relative_to(folder).as_posix()))
    return _files_in(folder, pattern)


def published_files(explorable: Explorable, registry: embeds.Registry | None = None) -> list[str]:
    """The files of an explorable's folder its published copy holds, relative to the folder.

    The published page holds its slides, so the site needs only what they
    use: the files its slides and style.css name (explorable.references), and
    for each page they show in a frame, the whole top-level folder it's in,
    since a demo loads its own scripts and data (demo/index.html brings demo/);
    explorable.json, style.css, the cover, the paper's checked excerpts and the
    demo previews;
    what its embed providers need (own_files()); and whatever explorable.json's
    "publish" lists. Never anything PRIVATE, hidden, or a PDF.
    """
    registry = registry if registry is not None else embeds.find(EXPLORABLES)
    folder, manifest = explorable.folder, explorable.manifest
    chosen: set[str] = set()
    for relative in explorable.references:
        parts = PurePosixPath(relative).parts
        page = PurePosixPath(relative).suffix.lower() in {".html", ".htm"}
        chosen.update(_files_in(folder, parts[0]) if page and len(parts) > 1 else _files_in(folder, relative))
    # explorable.json is small, and says what the explorable is to anything that reads the site.
    chosen.update(_files_in(folder, MANIFEST))
    chosen.update(_files_in(folder, STYLE))
    paper = manifest.get("paper") if isinstance(manifest.get("paper"), dict) else {}
    for named in (manifest.get("cover"), paper.get("structure")):
        if _text(named):
            target, problem = _local_file(folder, named)
            if target is not None and not problem:
                chosen.update(_files_in(folder, target.relative_to(folder.resolve()).as_posix()))
    if (folder / DEMO_PREVIEWS).is_file():
        chosen.update(_files_in(folder, PurePosixPath(DEMO_PREVIEWS).parts[0]))
    for name, state in explorable.embeds.items():
        provider = registry.named(name)
        if provider is not None:
            chosen.update(provider.module.own_files(folder, state))
    for pattern in _publish_patterns(manifest):
        chosen.update(_matching(folder, pattern))
    return sorted(f for f in chosen if not _private(f))


def published_bytes(explorable: Explorable, registry: embeds.Registry | None = None) -> int:
    """Source bytes to publish; build.py also counts the rendered page and provider output."""
    return sum((explorable.folder / f).stat().st_size for f in published_files(explorable, registry))


def _check_publishing(explorable: Explorable, registry: embeds.Registry, report: _Report) -> None:
    """Validate publishing settings and reject source files already over budget; the build checks the final size."""
    manifest, folder = explorable.manifest, explorable.folder
    patterns = manifest.get("publish")
    if patterns is not None:
        if not (isinstance(patterns, list) and all(_text(p) for p in patterns)):
            report.error('"publish" should be a list of files and folders to publish beyond what the slides name, '
                         'such as ["data/", "sounds/*.mp3"].')
            return
        for pattern in _publish_patterns(manifest):
            if pattern.startswith("/") or ".." in PurePosixPath(pattern).parts:
                report.error(f'"publish" lists {pattern}, which leads out of the folder. Name files inside it.')
            elif _private(pattern.rstrip("/").split("*")[0] or "x"):
                report.error(f'"publish" lists {pattern}, which is never published (slides.html, tests/, '
                             f'{", ".join(f"{name}/" for name in SUPPORT_FOLDERS)}, hidden files and PDFs).')
            elif not _matching(folder, pattern):
                report.error(f'"publish" lists {pattern}, but nothing in the folder matches it.')
    budget = manifest.get("budgetMB")
    if budget is not None and not (isinstance(budget, (int, float)) and not isinstance(budget, bool)
                                   and 0 < budget <= MAX_BUDGET_MB):
        report.error(f'"budgetMB" should be a number of megabytes up to {MAX_BUDGET_MB}, such as 40.')
        return
    size = published_bytes(explorable, registry) / 2**20
    if size > explorable.budget_mb:
        report.error(f"It would publish {size:.1f} MB, over its budget of {explorable.budget_mb:g} MB. Make its "
                     "files smaller, or leave out what it doesn't need. If it really needs more, ask a maintainer "
                     f'to raise "budgetMB" (up to {MAX_BUDGET_MB}).')


# ======================================================================== style
def css_rules(css: str) -> list[tuple[str, str]]:
    """The style rules in a style sheet: (selector, declarations), with at-rules' rules flattened.

    Comments are removed first, and braces inside quoted strings don't count.
    An @media block's rules come out on their own, with the @media prelude
    left off; statements such as @import, and at-rules of declarations such
    as @font-face, have no rule.
    """
    css = re.sub(r"/\*[\s\S]*?\*/", "", css)
    rules, start, i = [], 0, 0
    while i < len(css):
        ch = css[i]
        if ch in "\"'":
            i = _after_string(css, i)
            continue
        if ch == ";" and css[start:i].strip().startswith("@"):
            start = i + 1  # a statement at-rule, such as @import
        elif ch == "{":
            prelude, close = css[start:i].strip(), _closing_brace(css, i)
            body = css[i + 1:close]
            if _closing_brace(body, -1, inner=True) is not None:  # a block of rules, such as @media
                rules += css_rules(body)
            elif not prelude.startswith("@"):
                rules.append((prelude, body.strip()))
            i = start = close + 1
            continue
        i += 1
    return rules


def _after_string(css: str, i: int) -> int:
    """Where the quoted string starting at css[i] ends (just after its closing quote)."""
    quote, j = css[i], i + 1
    while j < len(css) and css[j] != quote:
        j += 2 if css[j] == "\\" else 1
    return j + 1


def _closing_brace(css: str, opening: int, *, inner: bool = False) -> int | None:
    """The } that closes the { at css[opening], skipping strings and nested blocks.

    With inner=True, instead: where the first { of a nested block is in css
    (a block's body), or None if it has none.
    """
    depth, j = 0, opening + 1
    while j < len(css):
        ch = css[j]
        if ch in "\"'":
            j = _after_string(css, j)
            continue
        if ch == "{":
            if inner:
                return j
            depth += 1
        elif ch == "}" and not inner:
            if depth == 0:
                return j
            depth -= 1
        j += 1
    return None if inner else len(css)


def _css_urls(css: str) -> list[str]:
    return [m[1] for m in re.finditer(r"""url\(\s*["']?([^"')]+?)["']?\s*\)""", css)]


def _top_level(text: str, separators: str) -> list[str]:
    """Split at separators that aren't inside parentheses, such as the commas of :is(...)."""
    parts, depth = [""], 0
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if depth == 0 and ch in separators:
            parts.append("")
        else:
            parts[-1] += ch
    return [p.strip() for p in parts if p.strip()]


def displays_inactive_slides(css: str, slide_classes: set[str]) -> list[str]:
    """Selectors that set `display` on a slide by one of its own classes without .active.

    `.slide { display: none }` hides every slide but the one on screen. A rule
    such as `.my-layout { display: grid }` on a slide's class would beat it and
    show that slide over every other one; `.slide.active.my-layout` doesn't.
    """
    found = []
    for selectors, declarations in css_rules(css):
        if not re.search(r"(^|;)\s*display\s*:", declarations):
            continue
        for selector in _top_level(selectors, ","):
            subject = (_top_level(selector, " >+~\n") or [selector])[-1]  # the element the rule styles
            own = any(re.search(rf"\.{re.escape(c)}(?![\w-])", subject) for c in slide_classes)
            if own and not re.search(r"\.active\b", subject):
                found.append(selector)
    return found


def _check_style(folder: Path, style: Path, scan: _SlideScanner, report: _Report, explorable: Explorable) -> None:
    try:
        css = style.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        report.error("style.css isn't UTF-8 text. Save it with the UTF-8 encoding.")
        return
    slide_classes = {c for s in scan.slides for c in s["classes"] if c != "slide"}
    for selector in displays_inactive_slides(css, slide_classes):
        report.error(f'"{selector}" sets display on slides that may not be the one on screen, so they would show '
                     'over it. Add .active to the slide\'s part of the selector, such as ".slide.active.my-layout".')
    for selectors, declarations in css_rules(css):
        size = re.search(r"(?:^|;)\s*font-size\s*:\s*(\d+(?:\.\d+)?)px", declarations)
        if size and float(size[1]) < MIN_FONT_PX:
            report.warning(f'"{selectors}" sets text at {size[1]}px. On a 1600 × 900 slide, text under '
                           f"{MIN_FONT_PX}px is hard to read when projected.")
    for reference in _css_urls(css):
        target, problem = _local_file(folder, reference)
        if problem:
            report.error(f"url({reference}) {problem}")
        elif target is not None and not target.exists():
            report.error(f"url({reference}) isn't in the folder.")
        elif target is not None:
            explorable.references.add(target.relative_to(folder.resolve()).as_posix())


# ======================================================================= images
def image_size(path: Path) -> tuple[float, float] | None:
    """An image's width and height from its own header, or None for a kind this doesn't read."""
    try:
        # Most image headers fit comfortably in the first 64 KB; only read the
        # remainder of the file if a JPEG has a large EXIF/ICC segment before SOF.
        with path.open("rb") as handle:
            data = handle.read(65536)
            rest_read = False
            if data[:2] == b"\xff\xd8":
                i = 2
                while True:
                    if i + 9 >= len(data) and not rest_read:
                        data += handle.read()
                        rest_read = True
                    if i + 9 >= len(data) or data[i] != 0xFF:
                        return None
                    marker = data[i + 1]
                    if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                        height, width = struct.unpack(">HH", data[i + 5:i + 9])
                        return width, height
                    i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    except OSError:
        return None
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10:
        return struct.unpack("<HH", data[6:10])
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X" and len(data) >= 30:
            return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
        if chunk == b"VP8 " and len(data) >= 30:
            width, height = struct.unpack("<HH", data[26:30])
            return width & 0x3FFF, height & 0x3FFF
        if chunk == b"VP8L" and len(data) >= 25:
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        return None
    if path.suffix.lower() == ".svg":
        text = data[:4000].decode("utf-8", "replace")
        box = re.search(r'viewBox="[\d.-]+[ ,]+[\d.-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"', text)
        if box:
            return float(box[1]), float(box[2])
        width, height = re.search(r'<svg[^>]*\swidth="([\d.]+)', text), re.search(r'<svg[^>]*\sheight="([\d.]+)', text)
        if width and height:
            return float(width[1]), float(height[1])
    return None


# ======================================================================== pages
class PageRewriter(HTMLParser):
    """Copy HTML as written, except for what a published page leaves out.

    Elements with a class in `drop` go, with everything inside them (speaker
    notes, for instance), and so do comments, which are notes to authors.
    `rewrite(tag, attrs)`, if given, may return new attributes for a start tag.
    Everything else, including character references, is copied as it was.
    """

    def __init__(self, *, drop=frozenset({"notes"}), rewrite=None):
        super().__init__(convert_charrefs=False)
        self.output: list[str] = []
        self.drop, self.rewrite = set(drop), rewrite
        # Track open tag names inside a dropped element as a stack rather than an
        # integer counter so HTML5 tags with optional end tags (e.g. <p> or <li>)
        # are popped together when their enclosing dropped container closes.
        self.skip: list[str] = []

    def handle_starttag(self, tag, attrs):
        classes = set((dict(attrs).get("class") or "").split())
        if self.skip or classes & self.drop:
            if tag not in VOID:
                self.skip.append(tag)
            return
        values = self.rewrite(tag, dict(attrs)) if self.rewrite else None
        if values is None or values == dict(attrs):
            self.output.append(self.get_starttag_text())
        else:
            self.output.append("<" + tag + "".join(
                f" {key}" if value is None else f' {key}="{html.escape(value, quote=True)}"'
                for key, value in values.items()) + ">")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.skip:
            if tag in self.skip:
                for i in range(len(self.skip) - 1, -1, -1):
                    if self.skip[i] == tag:
                        del self.skip[i:]
                        break
        else:
            self.output.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skip:
            self.output.append(data)

    def handle_entityref(self, name):
        self.handle_data(f"&{name};")

    def handle_charref(self, name):
        self.handle_data(f"&#{name};")

    def handle_comment(self, data):
        pass

    def handle_decl(self, decl):
        self.handle_data(f"<!{decl}>")

    @classmethod
    def apply(cls, source: str, **options) -> str:
        parser = cls(**options)
        parser.feed(source)
        parser.close()
        return "".join(parser.output)


def _attributes(pairs: list[tuple[str, str | None]]) -> str:
    return "".join(f" {k}" if v is None else f' {k}="{html.escape(v, quote=True)}"' for k, v in pairs)


def page(explorable: Explorable, *, published: bool, engine: str = "../engine/", home: str = "../",
         registry: embeds.Registry | None = None) -> str:
    """An explorable's page: its slides in the stage, with the engine's look and runtime.

    A published page (data-published) keeps the speaker notes, which its
    Notes drawer and presenter mode show read-only, but has no editor. The
    local server's page names its slides.html (data-deck-source), so the
    browser's editor can save to it, and says how many problems the folder has. A page
    with the paper's PDF (paper_pdf()) names it, and the Paper panel's Original
    link falls back to it, though the panel itself shows excerpts and never loads it.
    A page with still images of its demos names their index (DEMO_PREVIEWS).
    A page whose slides use embed providers names their modules in
    data-embeds, which the engine imports, links their stylesheets, and takes
    any attributes they add (tools/embeds.py).
    """
    registry = registry if registry is not None else default_registry(explorable.folder.parent)
    providers = [p for p in (registry.named(name) for name in explorable.embeds) if p is not None]
    manifest = explorable.manifest
    title = explorable.title
    # data-deck names what the deck keeps in the browser's storage (engine/js/storage.js).
    attributes: list[tuple[str, str | None]] = [("lang", manifest.get("lang") or "en"), ("data-deck", explorable.slug)]
    # Version the measured explanation, not the visitor's URL or build time.
    version = hashlib.sha256((explorable.slides + json.dumps(manifest, sort_keys=True)).encode()).hexdigest()[:20]
    attributes.append(("data-content-version", version))
    if published:
        attributes.append(("data-published", None))
    else:
        attributes.append(("data-deck-source", SLIDES))
    if home:
        attributes.append(("data-home", home))
    for provider in providers:
        attributes += provider.module.page_attributes(explorable.embeds[provider.name], published=published)
    if providers:
        attributes.append(("data-embeds", " ".join(p.module_path for p in providers)))
    if (explorable.folder / DEMO_PREVIEWS).is_file():
        attributes.append(("data-demo-previews", DEMO_PREVIEWS))
    if not published and explorable.problems:
        attributes += [("data-problems", str(len(explorable.problems))), ("data-problems-href", f"{home}#{explorable.slug}")]
    # Excerpts work without a PDF, including published decks with private local PDFs.
    pdf = paper_pdf(explorable, published=published)
    paper = manifest.get("paper") if isinstance(manifest.get("paper"), dict) else {}
    if pdf:
        attributes.append(("data-paper-pdf", pdf))
        first = paper.get("firstPage", 1)
        if isinstance(first, int) and not isinstance(first, bool) and first > 1:
            attributes.append(("data-paper-first-page", str(first)))
    if _text(paper.get("structure")):
        attributes.append(("data-paper-structure", paper["structure"].strip()))
        source = paper.get("url") or pdf
        if source:
            attributes.append(("data-paper-source", source))
    if (pdf or paper.get("structure")) and _text(paper.get("title")):
        attributes.append(("data-paper-title", paper["title"].strip()))
    styles = [f"{engine}deck.css", f"{engine}feedback.css", *(p.style_path for p in providers if p.style_path)]
    if (explorable.folder / STYLE).is_file():
        styles.append(STYLE)
    if not published:
        styles.append(f"{engine}editor.css")
    styles.append(f"{engine}presenter.css")
    # A published page keeps its speaker notes, so others can give the talk, but
    # drops comments (notes to authors), and the slides' passages unless the PDF they
    # point into is an https:// address it names.
    slides = PageRewriter.apply(explorable.slides, drop=set() if pdf else {"paper"}) if published \
        else explorable.slides
    description = manifest.get("description") if isinstance(manifest.get("description"), str) else ""
    head = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{html.escape(title)}</title>",
        f'<meta name="description" content="{html.escape(description.strip(), quote=True)}">',
        f'<link rel="icon" type="image/svg+xml" href="{html.escape(engine, quote=True)}favicon.svg">',
    ]
    head.append(PRESENTATION_FLAG)
    head += [
        '<link rel="preconnect" href="https://fonts.googleapis.com">',
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
        f'<link rel="stylesheet" href="{html.escape(FONTS, quote=True)}">',
        *(f'<link rel="stylesheet" href="{html.escape(href, quote=True)}">' for href in styles),
    ]
    return (f"<!doctype html>\n<html{_attributes(attributes)}>\n<head>\n" + "\n".join(head) + "\n</head>\n<body>\n"
            '<div class="viewport"><div class="stage">\n<div class="frames"></div>\n'
            f"{slides.strip()}\n</div></div>\n"
            f'<script type="module" src="{html.escape(engine, quote=True)}js/deck.js"></script>\n</body>\n</html>\n')


def short_authors(authors: str) -> str:
    """A paper's authors as a card cites them: one or two names, or the first and "et al."."""
    names = [n.strip() for n in re.split(r",\s*(?:and\s+)?|\s+and\s+|\s*&\s*", authors) if n.strip()]
    return authors.strip() if len(names) <= 2 else f"{names[0]} et al."


def citation(paper: dict) -> str:
    """A paper's citation for its card: its authors, year and venue."""
    if not isinstance(paper, dict):
        return ""
    authors = short_authors(paper["authors"]) if _text(paper.get("authors")) else ""
    parts = [authors] + [str(paper[key]).strip() for key in ("year", "venue") if str(paper.get(key, "")).strip()]
    return " · ".join(part for part in parts if part)


def gallery(explorables: list[Explorable], *, published: bool, engine: str = "engine/") -> str:
    """The gallery: a card for each explorable, linking to it.

    A published gallery lists only what's published. The local server's also
    lists drafts, marked as drafts, and each explorable's problems, so people
    can see what to fix before they share it.
    """
    cards = []
    for e in explorables:
        if published and (e.draft or e.errors):
            continue
        m, paper = e.manifest, e.manifest.get("paper") if isinstance(e.manifest.get("paper"), dict) else {}
        cover = m.get("cover") if isinstance(m.get("cover"), str) and (e.folder / m["cover"]).is_file() else ""
        picture = (f'<img src="{html.escape(e.slug)}/{html.escape(cover, quote=True)}" alt="" loading="lazy">' if cover
                   else f'<span class="cover-year">{html.escape(str(paper.get("year", "")))}</span>')
        authors = m.get("authors") if isinstance(m.get("authors"), list) else []
        byline = m["byline"] if _text(m.get("byline")) else f'By {", ".join(str(a) for a in authors)}'
        raw_tags = m.get("tags") if isinstance(m.get("tags"), list) else []
        tag_items = "".join(f"<li>{html.escape(str(t).strip())}</li>" for t in raw_tags if _text(t))
        tags = f'\n    <ul class="tags">{tag_items}</ul>' if tag_items else ""
        badges = []
        if e.draft:
            badges.append('<span class="badge draft">Draft</span>')
        if not published and e.errors:
            badges.append(f'<span class="badge error">{len(e.errors)} to fix before publishing</span>')
        elif not published and e.warnings:
            badges.append(f'<span class="badge warning">{len(e.warnings)} to check</span>')
        problems = ""
        if not published and e.problems:
            items = "".join(f'<li class="{p.level}"><b>{html.escape(p.file)}</b> {html.escape(p.message)}</li>'
                            for p in e.problems)
            problems = f'<details class="problems"><summary>Problems</summary><ul>{items}</ul></details>'
        # The paper's title, unless the explorable already has it as its own.
        same = str(paper.get("title", "")).strip().casefold() == e.title.casefold()
        paper_title = "" if same else html.escape(str(paper.get("title", "")))
        cards.append(f"""<li class="explorable" id="{html.escape(e.slug)}">
  <a class="cover" href="{html.escape(e.slug)}/" tabindex="-1" aria-hidden="true">{picture}</a>
  <div class="about">
    <h2><a href="{html.escape(e.slug)}/">{html.escape(e.title)}</a></h2>{"".join(badges)}
    <p class="paper"><span class="paper-title">{paper_title}</span> <span class="paper-cite">{html.escape(citation(paper))}</span></p>
    <p class="description">{html.escape(str(m.get("description", "")))}</p>{tags}
    <p class="by">{html.escape(byline)}</p>
    {problems}
  </div>
</li>""")
    empty = "" if cards else '<p class="empty">No explorables yet. explorables/CONTRIBUTING.md says how to add one.</p>'
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Explorable Research</title>
<meta name="description" content="Use these explorable research presentations to explore, critique, and build on research ideas. Each explorable uses interactive slides to deepen understanding and facilitate critical reading.">
<link rel="icon" type="image/svg+xml" href="{html.escape(engine, quote=True)}favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{html.escape(FONTS, quote=True)}">
<link rel="stylesheet" href="{engine}deck.css">
<link rel="stylesheet" href="{engine}gallery.css">
</head>
<body class="gallery">
<header class="gallery-head">
  <h1>Explorable Research</h1>
  <p class="lede">Use these explorable research presentations to explore, critique, and build on research ideas. Each explorable uses interactive slides to deepen understanding and facilitate critical reading.</p>
</header>
<main>
<aside class="create-invitation" aria-labelledby="create-invitation-title">
  <div>
    <p class="invitation-kicker">Make one of your own</p>
    <h2 id="create-invitation-title">Your curiosity. A paper. Something people can play with.</h2>
    <p>Turn a research paper into an explorable and enter the competition. <strong>$500 in prizes · Concepts due Nov 6.</strong></p>
  </div>
  <a href="create.html">Create &amp; compete <span aria-hidden="true">→</span></a>
</aside>
<ul class="explorables">
{chr(10).join(cards)}
</ul>
{empty}
</main>
<footer class="gallery-foot">
  <p>Made by Tech4Good Lab · UC Santa Cruz</p>
  <p><a href="create.html">Create an explorable</a> · A getting-started guide, resources, and the competition.</p>
  <p>We collect anonymous usage data (time on slides, which controls are used) to improve these explorables.</p>
</footer>
</body>
</html>
"""


# ================================================================ saving slides
_TOKENS = re.compile(r'<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?</\1\s*>|</?section\b(?:"[^"]*"|\x27[^\x27]*\x27|[^\x27">])*>', re.I)


def slide_spans(source: str) -> list[tuple[int, int, str]]:
    """Each slide's (start, end, id) in a deck's source, skipping examples in comments, scripts and styles.

    Works on a whole page (the talk's index.html) and on an explorable's slides.html.
    """
    spans = []
    depth = 0
    start = None
    for match in _TOKENS.finditer(source):
        tag = match.group()
        if not re.match(r"</?section\b", tag, re.I):
            continue
        if tag.startswith("</"):
            depth -= 1
            if depth == 0 and start is not None:
                spans.append((start[0], match.end(), start[1]))
                start = None
        else:
            if depth == 0:
                classes = re.search(r'\sclass\s*=\s*(["\x27])(.*?)\1', tag, re.I)
                if classes and "slide" in classes[2].split():
                    identity = re.search(r'\sid\s*=\s*(["\x27])(.*?)\1', tag, re.I)
                    if not identity or not identity[2]:
                        raise ValueError("A slide has no id.")
                    start = (match.start(), identity[2])
            depth += 1
        if depth < 0:
            raise ValueError("Unbalanced slide sections.")
    if depth or not spans or len({s[2] for s in spans}) != len(spans):
        raise ValueError("Missing sections or duplicate slide ids.")
    return spans


def validate_update(before: str, after: str) -> None:
    """Allow a save that changes only the slides' content and order, never their ids or what's around them."""
    old, new = slide_spans(before), slide_spans(after)
    if {s[2] for s in old} != {s[2] for s in new}:
        raise ValueError("Slide ids changed. Reload the page before saving.")

    def outside(source, spans):
        end = 0
        parts = []
        for start, stop, _ in spans:
            parts.append(source[end:start])
            end = stop
        parts.append(source[end:])
        return parts

    if outside(before, old) != outside(after, new):
        raise ValueError("Only slide content and order can be saved by this editor.")
