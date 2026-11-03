# Add your explorable

An explorable is one research paper, rebuilt as slides you can play with:
the paper's problem and big ideas, then demos where you change an assumption
and see what follows, then questions to discuss. Each one is a folder in
`explorables/`. Add yours, open a pull request, and once it's merged it's
published with the others on the lab's site.

You write the slides and the demos. The shared engine does the rest: the
1600 × 900 stage that scales to any screen, the bar with the slide counter
and the slide list, keyboard navigation, speaker notes, presenter mode, an
editor in the browser, the paper itself in a panel beside your slides, and
the gallery card that links to your explorable.

## Create with an AI collaborator

The repository includes the `create-paper-explorable` agent skill in
`.agents/skills/create-paper-explorable/`. It helps recreate and verify the
full system, derive smaller teaching interactions, and refine them by trying
them. It loads guidance for the current task, including work on an existing
explorable.
See the [setup and examples guide](agent-skill.html) for Codex, Claude Code,
Antigravity, and OpenCode. It starts from the starter project, a ZIP with
this guide, the template and the skill; you can also work in a clone of the
repository.

Codex, Antigravity and OpenCode find the skill in `.agents/skills` on their
own. For Claude Code, link it into `.claude/skills` once, from the top of the
project (the starter's `startup.py` does this for you):

```bash
python3 explorables/tools/setup_skill.py --harness claude
```

Then ask your agent to use `create-paper-explorable`, supplying the paper and
any existing code. The skill is optional; you can also start
directly with the template below.

## Quick start

1. **Copy the template.** Name the copy after your paper, in lowercase
   words joined by hyphens. The name becomes your explorable's address on the
   site.

   ```bash
   cp -r explorables/_template explorables/your-paper
   ```

2. **Describe it** in `explorable.json`: replace every `TODO` (see
   [explorable.json](#explorablejson)).

3. **Preview it** with the local server, from the top of the repository:

   ```bash
   python3 explorables/serve.py
   ```

   Open http://localhost:8790/explorables/. Your explorable is in the
   gallery, with a list of anything that doesn't yet follow the format. The
   server needs only Python 3; nothing to install.

4. **Write your slides** in `slides.html`, and your demos as pages of their
   own (see [slides.html](#slideshtml) and [Demos](#demos)). Reload the page
   to see changes. You can also edit text, sizes and speaker notes in the
   browser: press **E** on your explorable and **Save to file** writes
   `slides.html` for you.

5. **Check it**, then open a pull request:

   ```bash
   python3 explorables/build.py --check --only your-paper
   ```

   The same check runs on every pull request. When it passes and the pull
   request is merged, your explorable is published.

Working on it over several pull requests? Add `"draft": true` to
`explorable.json`. A draft is checked but stays off the published site
until you remove it.

## What your folder holds

```
explorables/your-paper/
├── explorable.json   required: what it is, for its gallery card
├── slides.html       required: your slides
├── style.css         optional: layouts of your own
├── cover.png         optional: the gallery card's picture (any name; see "cover")
├── demo/             your demos, each a web page (any names you like)
├── img/              your figures (any names you like)
├── paper-structure.json  optional: the paper's checked abstract and introduction, for the
│                     panel beside your slides (see "The paper beside your slides")
├── paper.pdf         optional: your copy of the paper, opened by the panel's Original link;
│                     never committed or published
├── previews/         made for you: still images of your demos (see "Demos")
├── tests/            optional: tests of your own; never published
├── lab/              optional: a runnable rebuild of the paper's system; never published
└── notes/            optional: context for your agent and your working notes; never published
```

Everything your slides use must be inside this folder. The site publishes
only what your explorable uses:

- the files your slides, `style.css` and `explorable.json` name, such as
  your figures and cover;
- for each demo page a slide shows, the whole top-level folder it's in
  (`demo/index.html` brings all of `demo/`);
- `previews/`, and anything you list in `"publish"` (see
  [Demos](#demos)).

Never `slides.html` (the published page holds its slides and speaker
notes, without your HTML comments), `tests/`, `lab/`, `notes/`, `embed/`,
hidden files, or PDFs. Each explorable may publish up to 25 MB.

Keep everything for one paper in its folder. If you rebuild the paper's
system as a program people can run, as Smallville Lab does for Generative
Agents, put it in `lab/` with its own README. Use the original authors' code as
a reference: copy in only what the lab needs, with its license and where it
came from, rather than keeping their whole repository. The format check skips
`lab/` and `notes/`, so a lab's virtual environment and training files never
reach the site.

## explorable.json

```json
{
  "format": 1,
  "title": "Dynamic Models of Segregation",
  "description": "How a mild preference for neighbors like you can divide a whole town.",
  "authors": ["Your Name", "Your Partner's Name"],
  "paper": {
    "title": "Dynamic Models of Segregation",
    "authors": "Thomas C. Schelling",
    "year": 1971,
    "venue": "Journal of Mathematical Sociology",
    "url": "https://doi.org/10.1080/0022250X.1971.9989794"
  },
  "cover": "cover.png"
}
```

| Field | Required | What it is |
|---|---|---|
| `format` | yes | The version of this format your folder is written for: `1`. The template already has it; leave it as it is. If the format ever changes, the check says how to update your folder. |
| `title` | yes | Your explorable's title, up to 120 characters; usually the paper's title, shortened. It titles your gallery card and the bar above your slides. |
| `description` | yes | 25 words or fewer for your gallery card: what someone will explore. |
| `authors` | yes | Who made the explorable: a list of names (or `["Anonymous"]` while under anonymous competition review). |
| `byline` | no | Plain text replacing the gallery's default “By …” line when roles need clarification, such as “Original explorable by Vi Hart & Nicky Case. Slide adaptation by David T. Lee.” Keep all contributors in `authors` and document sources in `credits`. |
| `paper.title` | yes | The paper's full title. |
| `paper.authors` | yes | Its authors, as the paper lists them. A card shows a long list as "First author et al." |
| `paper.year` | yes | The year it came out, as a number. |
| `paper.venue` | no | Where it appeared, such as `"ACM CHI"`. |
| `paper.url` | no | A link to it, such as its DOI: `"https://doi.org/…"`. The Paper panel's **Original ↗** link goes here. |
| `paper.pdf` | no | The paper's PDF: an `https://` address of an open copy, such as arXiv's, or `"paper.pdf"` for a copy in your folder. The panel's **Original ↗** link uses it when there's no `url`. See [The paper beside your slides](#the-paper-beside-your-slides). |
| `paper.firstPage` | no | The page number printed on the PDF's first page, if it isn't 1, such as `143` for a journal article. |
| `paper.structure` | no | A local JSON file with the paper's checked abstract and introduction and each sentence's role, which the Paper panel shows; see [The paper beside your slides](#the-paper-beside-your-slides). |
| `cover` | no | An image in your folder for the gallery card, shown 16:9 and cropped to fit. Without one, the card shows the paper's year. |
| `draft` | no | `true` keeps it off the published site. |
| `credits` | no | Whose work you used, such as a figure or a demo, and its license. |
| `tags` | no | A list of words, such as `["sociology", "simulation"]`. |
| `publish` | no | Files and folders your demos load as they run, beyond what your slides name, such as `["data/"]`. See [Demos](#demos). |
| `budgetMB` | no | How many megabytes your finished explorable may publish, including generated pages and embed-provider assets, if it needs more than the usual 25. Only a maintainer raises it, up to 100. |
| `lang` | no | The language of your slides, if not English, such as `"es"`. |

## slides.html

`slides.html` holds only your slides: one `<section>` per slide, with
comments between them if you like. The page around them is made for you.

```html
<section class="slide s-paper-intro" id="the-paper" data-part="The paper">
  <h2>Dynamic Models of Segregation</h2>
  <p class="sub">Thomas Schelling, <span class="num">1971</span>, Journal of Mathematical Sociology</p>
  <ul class="points">
    <li>What the world looked like before the paper.</li>
    <li>The question the paper asks about it.</li>
  </ul>
  <aside class="notes">What you'll say on this slide. The audience never sees this.</aside>
</section>
```

Every slide has:

- **`class="slide"`**, plus a layout class if you use one (below).
- **An `id`**, different on every slide, starting with a letter: the slide's
  address, such as `…/your-paper/#the-paper`. Link between slides with
  `<a href="#the-paper">`.
- **Exactly one `<h2>`** (or `<h1>`), which the slide list shows. If the
  slide shouldn't show it, hide it with `<h2 class="sr-only">`.
- **A `data-part`** (optional): the section the slide is in, shown in the
  bar and used to group the slide list.
- **Speaker notes** (optional), in `<aside class="notes">`. They show in the
  notes drawer (**N**) and in presenter mode, never on the slides. They are
  published with your explorable, so anyone can give the talk from the site:
  write them for another presenter, and keep private reminders in HTML
  comments (`<!-- … -->`), which the site leaves out.
- **The passages of the paper it draws on** (optional), in
  `<aside class="paper">`, a record of its sources that the slide doesn't
  show: see [Passages on slides](#passages-on-slides).

The stage is 1600 × 900 pixels, scaled to fit whatever screen it's on, so
sizes in your slides are stage pixels. Nothing on a slide scrolls, and text
smaller than 24px is hard to read when projected.

### Layouts you can use

Put one of these classes on a slide beside `slide`. Look at the explorables
already here for examples of each.

| Class | What it lays out |
|---|---|
| `s-centered` | A title, centred, with a line under it (`<p class="lede">`). |
| `s-paper-intro` | A paper: its title, `<p class="sub">` with authors and venue, then `<ul class="points">` for the problem it takes on. |
| `s-big-ideas` | One or two `<p class="big-idea">` statements, each with a key phrase in `<mark class="m-sun">`, `m-blue` or `m-rose`. |
| `s-paper` | A figure (`<figure>`) beside its facts (`<div class="facts">`). Add `facts-large` for bigger text beside a smaller figure. |
| `s-full` | One picture filling the slide: `<figure class="full-photo">`, or `full-photo fit` to show all of it. |
| `chapter` | A demo's slide: `<header class="ch-head">` with a number (`<span class="ch-num">`), a title and one line, then the demo filling the rest. |
| `s-big-list` | A heading and a numbered list, `<ol class="share">`, set large. Add `s-discuss` for longer items, such as discussion questions. |

Building blocks that work on any slide: `<div class="card">` (in rows with
`grid-3`, `grid-4` or `duo`; cards take the lab's colours in turn),
`<ol class="big-cards">` (big statements on cards), `<ul class="points">`,
`<p class="kicker">`, `<span class="hl">` (highlighter), `<span class="num">`
(for numbers in text), and `<p class="caveat">`.
`explorables/engine/deck.css` defines them all, with a comment on each.

### Pictures

Put images in your folder and give each its `alt` text (what it shows, for
people who can't see it) and its own `width` and `height`, so the slide keeps
its space while it loads:

```html
<figure><img src="img/figure-1.png" alt="Figure 1: the town of Smallville, with agents at work." width="2121" height="1116"></figure>
```

Write paths relative to your folder (`img/figure-1.png`), never starting
with `/`: the site lives under a sub-address, so `/img/…` would point
outside it.

### Links

A link to another site opens in a new tab, so it doesn't end the
presentation: `<a href="https://…" target="_blank" rel="noopener">`.

## The paper beside your slides

Your slides tell the paper's story in your words, like a talk. Whoever is
watching or reading can check them against the paper's own: **Paper** in
the bar (or **R**) opens a panel beside the slides with the paper's abstract
and introduction as one continuous column of text, each sentence colored by
the move it makes in the paper's argument (see [Sentence roles](#sentence-roles)).
The panel shows checked excerpts that you supply, never the PDF, so it is the
same on your computer and on the published site. A deck without excerpts has
no Paper button.

The reader is independent of the slides: changing slides never scrolls,
highlights or folds its text, and closing and reopening the panel keeps the
reader's place. Paper and Edit use one sidebar: opening either closes the
other and keeps unsaved edits. The paper starts at the editor's width (330px,
or 280px in a compact window) with 16px text; drag its left edge to resize
it, or double-click the edge for the usual width. **− / +** in the panel's
header change the text size, and **Original ↗** opens the paper itself, for
its layout and figures. While the paper has the keyboard, ↑, ↓, Page Up,
Page Down and the space bar scroll it; ← and → still change slides, **R**
closes it, and Escape gives the keys back to the slides.

### Checked excerpts

Add `"structure": "paper-structure.json"` to the manifest's `paper`. That
file holds:

- **`metadata`**: the paper's `title` (required), and optionally its
  `authors` (each with a `name`) and `publication`, shown at the top of the
  panel.
- **`sections`**: the `introduction`, and the `abstract` if the paper has
  one, as sections with those `id`s. No other sections are allowed, so the
  panel never becomes a copy of the whole paper.
- Optionally, **`source`** and **`annotationSource`**: notes on where the text
  was checked and how the roles were assigned.

Each section has `paragraphs`. Each paragraph has `blocks`, with a unique
`id`, original paper `text`, a `role` (see below) and, optionally, a
`subtype`. Paragraphs may supply physical PDF `pages` and `kind: "heading"`
for subheadings (heading blocks have no role). This is a checked
transcription of the section, not a summary; preserve every sentence.
`build.py --check` reports a file that breaks these rules, and the panel
shows an error pointing to **Original ↗** instead of the text. These
excerpts are published with the explorable, so use only text you can share.

### The Original link and the PDF

**Original ↗** goes to the paper's `"url"`, such as its DOI. Without one, it
goes to the paper's PDF, given as `"pdf"` in `explorable.json`'s `"paper"`:

- **An address on the web**, if the paper is openly available, as on arXiv:
  `"pdf": "https://arxiv.org/pdf/2304.03442v2"`. Name the version (`v2`), so
  the pages your slides' passages point to never change. This works on the
  published site too.
- **A copy in your folder**, for any other paper: `"pdf": "paper.pdf"`.
  Papers are usually under copyright, so git leaves PDFs out of the
  repository and the site never publishes them. Your excerpts are published,
  so the published explorable still has the Paper panel, but it leaves out
  the slides' passages, which point into the PDF, and its Original link
  needs a `"url"`.

If the PDF's first page isn't numbered 1, as in a journal, give the number
printed on it as `"firstPage"` (`143`, say), and use the page numbers
printed on the paper everywhere.

### Passages on slides

A slide can also list the passages of the paper it draws on, as a record of
where its claims come from:

```html
<aside class="paper">
  <cite data-page="146" data-find="The distribution is so U-shaped">Neighborhoods are “U-shaped”</cite>
  <cite data-page="147" data-find="kinds of segregation or integration may result">What choices can produce</cite>
</aside>
```

- **`data-page`**: the page it's on, as printed on the paper.
- **`data-find`**: a few distinctive words on that page, exactly as the
  paper has them. Keep it short: they're all the slides should copy of the
  paper.
- **The text**: what the passage is about, in your words.

Slides hide these lists, and the Paper panel doesn't show them. `build.py
--check` checks that each page number is given and isn't before
`"firstPage"`, and warns when `data-find` runs past 12 words or a passage has
no text of its own.

Point to where the paper says what the slide says: its problem and context
on your first slide, the result behind a claim, the section a demo rebuilds.
Not every slide needs a passage.

### Sentence roles

The roles come from the paper structure exercise. They name the moves almost
every paper makes, whatever its field or method, so readers can compare a
systems paper, an interview study and a theory paper with the same seven colors:

| `role` | The question it answers | Optional `subtype` | Color |
|---|---|---|---|
| `context` | What setting or phenomenon are we in, and why does it matter? | | light blue |
| `gap` | What's missing? | `problem` (something can't be done or doesn't work), `question` (something isn't known), `tension` (evidence or assumptions conflict) | rose |
| `idea` | What angle makes the gap addressable? | `insight`, `lens` (a theoretical framing), `hypothesis`, `assumption` (a modeling choice) | pale yellow |
| `instantiation` | What did the authors make that is put to the test? | `system`, `model`, `intervention`, `dataset` | amber |
| `method` | How was the evidence gathered and judged? | | lavender |
| `findings` | What was learned? | | green |
| `implications` | What does it mean beyond this paper, and where does it stop applying? | `design`, `theory`, `policy`, `practice`, `limits` | pale mint |

Hovering over a sentence shows its role's question in the bar under the
legend, with the sentence's subtype beside it, and the sentence's tooltip
names both ("Gap · question"). Use one when it tells a reader something the role alone
doesn't, such as whether a gap is a missing capability or an open question.

The legend stays pinned to the top of the panel while the paper scrolls.
Clicking a role in it leaves only that role's sentences in color and shows the
role's guiding question below the legend; clicking the role again brings every
color back. Seven pale highlights can't all be told apart
at a glance, especially by color-blind readers, so following one role shouldn't
depend on telling two colors apart. The colors themselves were chosen to stay
distinguishable with protanopia, deuteranopia and tritanopia;
`tests/paper-colors.test.mjs` checks every pair, so rerun it if you change them.

Idea and Instantiation share a warm hue, pale yellow then amber, because they
are the same idea twice:
first as an angle, then made concrete as a system, model, intervention or
dataset. Some rules for the cases that are easy to confuse:

- **Instantiation is the thing under test; Method is the test.** In a
  controlled experiment the intervention is the instantiation. In a
  qualitative or descriptive study nothing is being tested, so the paper has
  no instantiation, and that is expected: its contribution is in its
  findings.
- **Why a site or population was chosen is an Idea.** "Drivers are a revealing
  case because the algorithm is their only manager" argues for an angle. Who
  was studied, how many and how they were recruited are Method.
- **A paper's own statement of its aims is a Gap.** "This paper examines
  whether…" states the question.
- **"We introduce X" depends on what X is.** If X is a new kind of thing,
  defined by what it does or makes possible, it is the Idea, and so are
  sentences illustrating what it can do. The concrete thing built to realize
  it is the Instantiation. *Generative Agents* introduces "generative agents:
  computational software agents that simulate believable human behavior"
  (Idea), then writes "to enable generative agents, we describe an
  architecture" (Instantiation). A sentence that says how something works,
  or what was built, is an Instantiation.
- **Tag a contribution list by what each item restates.** "Generative agents,
  believable simulacra of human behavior…" restates the idea; "a novel
  architecture…" is an instantiation; "two evaluations that establish…" is a
  finding.
- **Limitations and scope disclaimers are Implications · limits.** They bound
  where the findings apply. Leaving parts of a phenomenon out of a model
  on purpose is an Idea · assumption.

#### Examples by paper type

The same seven roles hold different things depending on how a paper makes
its case. The first table uses this site's three explorables; open their
**Paper** panels to see every sentence tagged. The second table is made up,
to show paper types the site doesn't have yet.

| Role | Systems: *Generative Agents* | Simulation and machine learning: *The AI Economist* | Formal model: Schelling's *Dynamic Models of Segregation* |
|---|---|---|---|
| Context | Believable proxies of human behavior could power games, rehearsal spaces and prototyping tools. | Economic policy has to balance equality against productivity. | People are separated by sex, age, income, language, color and more. |
| Gap | **problem:** language models simulate behavior at a single moment, but long-term coherence needs memories that grow and fade. | **problem:** theory needs simplifications to stay tractable; empirical work lacks counterfactual data. | **question:** what segregation can individual choices produce, and what can aggregate patterns tell us about motives? **tension:** individual, organized and economic segregation are hard to separate. |
| Idea | Generative agents: software agents that simulate believable human behavior, such as noticing breakfast burning and turning off the stove. **insight:** an agent must retrieve relevant experiences, reflect on them and plan from them. | **insight:** keep early exploration cheap, and let agents and planner adapt to each other gradually. | **lens:** any twofold distinction will do. **assumption:** people may accept mixing yet avoid being in the minority. |
| Instantiation | **system:** the architecture that enables them (a memory stream, reflection and planning), running a town of 25 agents. | **system:** two-level deep reinforcement learning in the Gather-Trade-Build economy. | **model:** a spatial model in which each person defines their own neighborhood, and a model of bounded neighborhoods. |
| Method | Interviewing agents, ablating components, and a two-day simulation of the whole town. | Optimal taxation in a one-step economy and in Gather-Trade-Build, against baselines including the Saez tax model. | None in the introduction: the later sections reason through the models directly. |
| Findings | One agent's plan for a party spreads into invitations, a date and a crowd that shows up; each component matters. | It recovers the theoretically optimal tax in one step, and improves the equality–productivity trade-off by 12% over Saez in a four-agent world. | Movement exaggerates separation, and aggregate patterns rarely reveal individual motives. |
| Implications | **design:** tune agents so users don't form parasocial relationships. **practice:** rehearsing difficult conversations, prototyping social platforms. | **theory:** the Saez model is suboptimal once agents interact. **practice:** quantifying behavioral responses and agent interactions. **limits:** the simulations are not realistic enough to set real policy. | **theory:** a general theory of "tipping" begins to emerge. |

| Role | Qualitative interview study (hypothetical) | Controlled experiment (hypothetical) | Dataset or benchmark (hypothetical) |
|---|---|---|---|
| Context | Ride-hail platforms manage drivers through algorithms instead of people. | People share news headlines online without reading the articles. | Language models are starting to summarize patients' medical records. |
| Gap | **question:** how do workers make sense of a manager they can't see or question? | **question:** does a brief prompt to read before sharing change what people share? | **problem:** summarization benchmarks use news articles, not clinical notes. |
| Idea | **lens:** sensemaking, in which people build folk theories to explain hidden logic. Drivers are a revealing case because the algorithm is their only manager. | **hypothesis:** a moment of friction prompts people to reflect before acting. | **insight:** clinicians' corrections show which summary errors actually matter. |
| Instantiation | None: the study observes drivers rather than testing something the authors made. | **intervention:** a "Read the article first?" prompt shown before sharing. | **dataset:** clinical notes paired with clinician-written summaries and labeled errors. |
| Method | Interviews with 20 drivers in two cities and forum posts, analyzed thematically. | A randomized trial comparing participants who see the prompt with those who don't, measuring how many unread articles they share. | The annotation protocol, agreement between annotators, and baseline models' scores. |
| Findings | Drivers form folk theories about surge pricing and test them deliberately. | Participants who saw the prompt shared fewer unread articles. | Baseline models most often leave out medications. |
| Implications | **design:** make algorithmic decisions legible to workers. **theory:** sensemaking extends to managers that are algorithms. | **policy:** platforms could add small moments of friction. **limits:** one platform, over one week. | **practice:** judge clinical summaries by what they leave out, not by overlap with a reference summary. |

Where a paper's sentences cluster says what kind of contribution it makes.
Systems and simulation papers spend much of their introduction on Idea and
Instantiation: the contribution is the thing they built. Interview studies and
experiments spend it on Method and Findings: the contribution is what was
learned. A formal model leans on Idea (its assumptions) and Findings (what
follows from them). An empty Instantiation row is not a gap in the annotation:
it tells the reader the paper contributes knowledge, not an artifact.

## Demos

A demo is a web page in your folder, made however you like: plain
HTML/JavaScript, a canvas, D3 from a CDN, or a page an AI assistant wrote
for you. A slide shows it in a frame:

```html
<section class="slide chapter" id="try-it" data-part="Explore it">
  <header class="ch-head"><span class="ch-num">1</span><div><h2>Change the bias</h2><p>What happens to the town?</p></div></header>
  <div class="play-room" data-max="1.5"><div class="play-set">
    <iframe data-src="demo/index.html" width="900" height="460" scrolling="no" title="A town whose residents move when unhappy"></iframe>
  </div></div>
</section>
```

- `width` and `height` are the size your page is laid out for. The deck
  scales the frame to fit the space the slide gives it, never more than
  `data-max` times. Several frames in one `play-set` sit side by side and
  scale together.
- Write `data-src`, not `src`. The deck loads a frame when its slide (or the
  one before it) comes up, and keeps it loaded, so whatever someone did in it
  is still there when they come back.
- Give it a `title` saying what it shows, and `scrolling="no"`. Lay your page
  out so nothing in it scrolls either.
- The deck's arrow keys keep working after someone clicks in your demo.
- Your page is told when its slide comes on screen and goes off it. Pause
  any animation while it's hidden:

  ```js
  addEventListener("message", (event) => {
    if (event.data?.type === "deck:visibility") running = event.data.visible;
  });
  ```

  It's also told how sharply it's shown, `{type: "deck:resolution", detail}`:
  how many screen pixels each of its CSS pixels covers. A canvas with
  `detail` times its size in pixels stays sharp when the slide enlarges it.

- A demo can't call a server of yours or a model's API: the site is static
  files. Anything it needs, such as data or a recorded model response, goes
  in your folder. Libraries can come from a CDN over `https://`.
- Keep what a demo loads inside its own folder (`demo/data.json`), and it's
  published with the demo. If it loads files from elsewhere in your folder
  as it runs, such as `../data/`, list them in `explorable.json`, or the
  published demo won't find them:

  ```json
  "publish": ["data/", "sounds/*.mp3"]
  ```

  A name ending in `/` is a whole folder; `*` matches any name.
- Name the controls readers use, so the published site's usage analytics can
  tell them apart: `<button data-analytics-id="run-simulation">`. An `id`
  works too. Only the name and that a control was used are recorded, never a
  value or typed text ([ANALYTICS.md](ANALYTICS.md)).

`_template/demo/index.html` is a small demo that does all of this.
`_snippets/` has a few more small, working demos, each showing one
mechanism: a canvas kept sharp with `deck:resolution`, one page serving
several slides, frames side by side, and replaying recorded data. Its
README lists them; see them running at
http://localhost:8790/explorables/_snippets/.

The slide list (the **Slides** button) and the presenter's next-slide
preview show small pictures of your slides, which can't run your demos.
Until your demos have still images, they show a box saying a demo goes
there. To make the stills, install Playwright and run:

```bash
node explorables/tools/capture-demo-previews.mjs your-paper
```

It opens each slide with a demo, waits for the demo to draw, and saves a
picture of it in your folder's `previews/`. Run it again after you change
what a demo shows at first; until then, a changed demo shows the box again.

## style.css

Add layouts of your own in `style.css`. It's loaded after the shared look,
so you can also change the shared colours for your slides. Scope every rule
to your slides, with a class you put on them. A rule that sets `display` on
a slide must include `.active`, or that slide would show over every other
one:

```css
.slide.active.my-layout { display: grid; grid-template-columns: 1fr 1fr; }
.my-layout .note { font-size: 28px; }
```

## What the check enforces

`python3 explorables/build.py --check` reports two kinds of problem. The
local server's gallery lists the same ones under your explorable, and the
bar above your slides counts them.

An **error** keeps your explorable off the site until it's fixed:

- the folder's name isn't lowercase words joined by hyphens;
- `explorable.json` is missing, isn't valid JSON, is missing a required
  field, or still has a template placeholder;
- `"format"` is missing, or names a newer format than your copy of the
  engine knows (update your copy of the repository);
- `"publish"` names something that isn't in the folder, leads out of it, or
  is never published; or the explorable would publish more than its
  budget (25 MB, or its `"budgetMB"`). The format check counts source files;
  the build also counts generated pages and embed-provider output before
  replacing the previous site;
- `slides.html` is missing, or has no slides, or has something outside a
  slide;
- a slide has no `id`, or two elements share an `id`, or a slide doesn't
  have exactly one `<h2>`;
- a slide has a `<script>`, `<style>`, `<link>` or an `on…=` attribute
  (demos go in frames, styles in `style.css`);
- a link like `href="#…"` names no slide;
- a file a slide or `style.css` uses isn't in your folder, or its path
  starts with `/` or leads out of the folder, or is a PDF (the site never
  publishes PDFs);
- the paper's `"pdf"` isn't an `https://` address or a PDF in your folder,
  or `"firstPage"` isn't a whole number from 1;
- the paper's `"structure"` isn't a JSON file in your folder holding only
  checked abstract and introduction excerpts, as
  [Checked excerpts](#checked-excerpts) describes;
- `class="paper"` is on anything but a slide's `<aside>` of passages, that
  aside holds anything but `<cite>`s, or a passage has no `data-page` or
  one before the paper's first page;
- an image has no `alt`;
- a demo frame in a play-room uses `src`, or has no `width` or `height`;
- a rule in `style.css` sets `display` on a slide without `.active`;
- a file is over 95 MB, or is a symbolic link.

A **warning** is worth fixing, but doesn't stop publishing: text in
`style.css` under 24px, an image without its `width` and `height` or with
different proportions, an empty `alt`, a frame without a `title` or
`scrolling="no"`, a frame outside a play-room, a link to another site
without `target="_blank"`, something loaded over `http://`, a field
`explorable.json` doesn't use (often a misspelling), a file over 20 MB, a
`data-find` of more than 12 words, a passage without a name, and passages
when the paper has no `"pdf"`.

## Making a good explorable

- **The paper first, as a paper:** its problem, then its big ideas, before
  any demo.
- **One idea per slide and per demo.** Say what to try and what to look for.
- **Few words, set large.** Put evidence and details in the speaker notes.
- **Every demo stays live:** someone presenting it will click and drag it in
  front of a room.
- **Close with open questions** that ask for a stance or a personal
  connection, not a check of what people remember.

The [explorable creation skill](../.agents/skills/create-paper-explorable/SKILL.md)
and its resources cover recreating the paper's system, research framing,
interactive lessons, and validation, with worked examples from the explorables
here. The [agent skill guide](agent-skill.html) has setup steps; use the
examples' design choices where they serve your paper and audience.

## Going further

- **Presenting:** press **P** for presenter mode: your notes and the next
  slide on your screen, the slides in a separate window. This works on the
  published site too, so anyone can present your explorable from there; only
  the editor needs the local server. **F** is full
  screen, and **R** opens the paper beside the slides (presenter mode has
  no room for it). In the paper, **↑** and **↓** scroll, **+** and **−**
  zoom (as do the panel's buttons; drag its left edge to widen it), **←**
  and **→** still change slides, and **Esc** hands the keys back to the
  slides.
- **Tests:** put tests of your own in `tests/`, such as
  `tests/model.test.mjs` for your demo's logic (`node --test`), or
  `tests/test_data.py` with Python. They run on every pull request (`npm test`
  runs them on your computer) and aren't published.
- **Smallville Lab:** an explorable can show widgets of Smallville Lab's
  guide and recorded runs of the lab, as `generative-agents/` does. Its
  slots, and how to export a run into your folder, are in
  [README.md](README.md#embed-providers-smallville-lab-in-any-deck).
