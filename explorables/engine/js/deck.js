// The slide deck: the runtime every deck shares, the explorables in
// explorables/ and the talk in talk/.
//
// A deck is a page whose stage holds its slides:
//   <div class="viewport"><div class="stage"><div class="frames"></div>
//     <section class="slide" id="…" data-part="…"> … <aside class="notes">…</aside></section>
//   </div></div>
// This module builds the page around the stage (the bar, the slide list and
// the notes drawer, js/chrome.js), then runs the deck. The slide list shows
// a small picture of every slide down the window's left (js/slide-list.js). Every slide is laid
// out on a 1600 × 900 stage, which is scaled to fit the window, so no slide
// ever scrolls. The deck's <title> is its title, and attributes on <html>
// configure it:
//   data-deck-source="slides.html"  the file that holds the slides, which the
//                                   editor saves to (index.html if not given)
//   data-home="../"                 a link back to the gallery of explorables
//   data-published                  a deck on the published site: its notes and
//                                   presenter mode, read-only, but no editor
//   data-audience                   the talk's audience edition: slides only, no
//                                   notes, editor or presenter
//   data-deck="ai-economist"        the deck's name, which what it keeps in the
//                                   browser's storage is kept under (js/storage.js)
//   data-embeds="smallville/embed.js"
//                                   the modules of the embed providers its slides
//                                   use (js/embeds.js), which may read attributes
//                                   of their own, such as Smallville's data-guide
//   data-demo-previews="…"          the module indexing still images of the demos,
//                                   for the presenter's next-slide preview
//   data-problems="3" data-problems-href="../#slug"
//                                   on the local server, how many format problems
//                                   the deck's folder has, and where they're listed
//   data-paper-structure="paper-structure.json" data-paper-title="…"
//   data-paper-source="https://…"   the paper the deck is about: the Paper button
//                                   (R) shows its checked abstract and
//                                   introduction beside the slides (js/paper.js),
//                                   and its Original link goes to the source.
//                                   The panel never loads the PDF, and slides
//                                   don't change what it shows
//
// <div class="play-room"> holds frames of the slide's own, such as the
// interactives of Parable of the Polygons; js/playables.js runs them.
// <div class="slot"> is a place on a slide for what an embed provider shows,
// such as a widget of Smallville Lab's guide: the provider places a frame of
// its own over it (js/embeds.js; generative-agents/embed/embed.js).
import { buildChrome } from "./chrome.js";
import { callEmbeds, embedModules, loadEmbeds } from "./embeds.js";
import { fitStage, fitWidget, fillToySlot, swipeStep } from "./layout.js";
import { initPlayables, resizePlayables, showPlayables } from "./playables.js";
import { initPaper } from "./paper.js";
import { initSlideList } from "./slide-list.js";
import { demoPreview } from "./preview.js";
import { initResizer } from "./panels.js";
import { deckKey, KEYS } from "./storage.js";
import { initAnalytics } from "./analytics.js";
import { initSlideFeedback } from "./feedback.js";

const root = document.documentElement;
const TITLE = document.title.trim() || "Slides";
const W = 1600, H = 900;

const isAudience = root.dataset.presentation === "audience";
// The talk's audience edition shows only the slides.
const audienceEdition = root.hasAttribute("data-audience");
// A published deck (or the audience edition) is static files, with no server
// behind it, and independently navigable, unlike the presenter's pop-out.
const published = root.hasAttribute("data-published") || audienceEdition;
// The editor saves through the local server, so it's only for whoever runs the deck locally.
const authoring = !isAudience && !published;
// The notes and presenter mode are for whoever gives the talk, locally or from the site.
const presenting = !isAudience && !audienceEdition;
// The presenter's pop-out shows only slides, so it has no paper beside them.
const paperStructure = !isAudience && root.dataset.paperStructure;
buildChrome(document, {
  title: TITLE, home: root.dataset.home || "", presenting, authoring,
  // The local server says how many format problems the deck's folder has (tools/decks.py).
  problems: authoring ? { count: Number(root.dataset.problems) || 0, href: root.dataset.problemsHref || "" } : null,
  paper: paperStructure ? { title: root.dataset.paperTitle || "The paper", source: root.dataset.paperSource || "" } : null,
});

const stage = document.querySelector(".stage");
stage.tabIndex = -1;
const viewport = document.querySelector(".viewport");
const slides = [...document.querySelectorAll(".slide")];
let current = -1;
let editor = null;
// The notes drawer: the editor's, which edits the notes, or on a published deck a read-only one (js/notes.js).
let speakerNotes = null;
let presentation = null;
let paper = null; // the panel showing the deck's paper (js/paper.js), if it has one
let slideList = null; // the strip of slide pictures down the left (js/slide-list.js)
let scale = 1;
// The embed providers the slides use, each as the hooks it gave the deck
// (js/embeds.js); loaded below, once the deck can offer them what they need.
let embeds = [];
// Usage analytics and slide feedback are independent (js/analytics.js,
// js/feedback.js): either can fail to start, or be removed, without the other.
// Feedback borrows analytics' reader IDs, and reports
// its widget's use as analytics interactions.
const deckAudience = isAudience || audienceEdition;
let analytics = { slide() {}, mode() {}, track() {}, identity: () => null };
try {
  analytics = initAnalytics({ published, authoring, audience: deckAudience, currentSlide: () => slides[current] });
} catch { console.warn("Usage analytics could not start."); }
let feedback = { slide() {}, setHidden() {} };
try {
  feedback = initSlideFeedback({ published, authoring, audience: deckAudience,
    identity: () => analytics.identity(), onEvent: (action) => analytics.track("feedback", action) });
} catch { console.warn("Slide feedback could not start."); }

/** The capture tool uses the same providers and preview identities as the deck. */
export function previewForCapture(room) {
  return demoPreview(room, embeds);
}

/** Whether something answers at `url`. A no-cors request can't be read, but it only fails if nothing is there. */
async function reachable(url) {
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------- scaling the stage
function fit() {
  const box = viewport.getBoundingClientRect();
  const fitted = fitStage(box.width, box.height, W, H);
  scale = fitted.scale;
  stage.style.transform = `scale(${scale})`;
  stage.style.left = `${fitted.left}px`;
  stage.style.top = `${fitted.top}px`;
  placeFrames();
  resizePlayables();
  editor?.positionSelection();
}

/** A slot's rectangle in stage coordinates (the stage's own 1600 × 900 pixels). */
function slotRect(slot) {
  const r = slot.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  return { x: (r.left - s.left) / scale, y: (r.top - s.top) / scale, w: r.width / scale, h: r.height / scale };
}

// ------------------------------------------------ the embed providers' frames
/** Let each embed provider put its frames over the slide on screen, or hide them. */
function placeFrames() {
  const slide = slides[current];
  if (slide) callEmbeds(embeds, "place", slide);
}

/** A slide key pressed in a frame, which its page passed up because a key there goes to the frame, not the deck. */
function slideKey(key) {
  if (editor?.editing) return;
  if (["ArrowRight", "PageDown"].includes(key)) next();
  else if (["ArrowLeft", "PageUp"].includes(key)) prev();
}

/** The slide has come on screen: let each embed provider load what it shows. */
function prepare(slide) {
  if (presentation?.active) return;
  callEmbeds(embeds, "prepare", slide);
}

/** Put markup into the page beside `anchor` (where: "before" or "after"). */
function insert(html, anchor, where) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  anchor?.[where](template.content);
}

// What the engine offers an embed provider (js/embeds.js lists it).
const embedDeck = Object.freeze({
  root, published, authoring, audience: isAudience,
  slides: () => slides,
  currentSlide: () => slides[current],
  presenterActive: () => Boolean(presentation?.active),
  addFrame({ title, src }) {
    const f = document.createElement("iframe");
    f.title = title;
    f.src = src;
    document.querySelector(".frames").append(f);
    return f;
  },
  slotRect,
  layout: Object.freeze({ fitWidget, fillToySlot }),
  placeFrames,
  slideKey,
  addToBar: (html) => insert(html, document.querySelector(".bar [data-list]"), "before"),
  addPanel: (html) => insert(html, document.querySelector(".progress"), "after"),
  storageKey: (name) => deckKey(name),
  reachable,
});

// ------------------------------------------------------------ navigation
function go(index, { push = true, cause = "jump" } = {}) {
  if (!Number.isInteger(index) || (isAudience && !presentation?.connected)) return;
  const i = Math.max(0, Math.min(slides.length - 1, index));
  if (i === current) return;
  if (current >= 0) {
    slides[current].classList.remove("active");
    slides[current].setAttribute("aria-hidden", "true");
    if (editor?.editing) slideList?.update(slides[current]); // its picture shows any edits made on it
  }
  current = i;
  const slide = slides[i];
  slide.classList.add("active");
  slide.removeAttribute("aria-hidden");
  updateChrome();
  if (push) history.replaceState(null, "", `#${slide.id}`);
  placeFrames();
  showPlayables(presentation?.active ? -1 : i);
  reclaimFocus();
  prepare(slide);
  analytics.slide(slide, cause);
  feedback.slide(slide, i + 1);
  editor?.onSlideChange();
  presentation?.refresh();
}

/** Refresh text and counts without restarting demos or navigating. */
function updateChrome() {
  const slide = slides[current];
  document.querySelector(".part").textContent = slide.dataset.part || "";
  document.querySelector(".counter").textContent = `${current + 1} / ${slides.length}`;
  document.querySelector(".progress").style.width = `${((current + 1) / slides.length) * 100}%`;
  const heading = slide.querySelector("h1, h2")?.textContent.trim() ?? "Slide";
  document.title = heading === TITLE ? TITLE : `${heading} · ${TITLE}`;
  slideList?.showCurrent(slide);
  speakerNotes?.refreshNotes();
}

/**
 * Give the keyboard back to the slides: to the stage when it can take focus
 * (the editor makes it focusable), or else to the page itself.
 */
function focusDeck() {
  if (stage.hasAttribute("tabindex")) stage.focus({ preventScroll: true });
  else document.activeElement?.blur();
}

/**
 * After a slide change, take the keyboard back from whatever the new slide
 * hides: a frame on the last slide that was clicked, or a shared frame that
 * isn't shown on this one. A browser leaves the keyboard in a frame after the
 * frame is hidden, so the next key would go to a page nobody can see, and
 * would be lost if that page doesn't pass it up (explorables/tests/deck-focus-browser.mjs).
 */
function reclaimFocus() {
  const focused = document.activeElement;
  if (!focused || focused === document.body) return;
  // Browsers without checkVisibility() keep the old behavior.
  if (focused.checkVisibility?.({ visibilityProperty: true }) === false) focusDeck();
}

const next = () => go(current + 1, { cause: "next" });
const prev = () => go(current - 1, { cause: "previous" });

function fromHash() {
  const i = slides.findIndex((s) => `#${s.id}` === location.hash);
  go(i >= 0 ? i : 0, { push: false, cause: current < 0 ? "entry" : "history" });
}

// ---------------------------------------------------------- the chrome
function toggleNotes() {
  if (presentation?.active) { document.querySelector("#presenter-notes-text").focus(); return; }
  speakerNotes?.toggleNotes();
}
function toggleFullscreen() {
  const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  request?.catch(() => {}); // Browsers can decline full screen without interrupting navigation.
}

// Controls that Space works itself, as on any page: it clicks a button,
// opens a <summary>'s details, and scrolls past a link rather than follow it.
const SPACE_CONTROLS = 'button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"]';

/** Whether `e` is Space pressed on a control that uses it, so it isn't a slide key. */
function spaceForControl(e) {
  return e.key === " " && Boolean(e.target?.closest?.(SPACE_CONTROLS));
}

// The deck's keys. The slides' own frames pass their keys here too
// (js/playables.js), and the shared frames pass the slide keys up as
// messages (slideKey()), so the keys still work after a click in one.
function onKey(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "") || e.target?.isContentEditable;
  // E ends presenter mode, and does only that: on an author's page it would
  // otherwise go on to the editor's keys and open the editor too.
  if (presentation?.active && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "e") {
    e.preventDefault(); presentation.stop(); return;
  }
  // R can switch from the editor to the paper, but never interrupts typing.
  if (paper && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "r") {
    e.preventDefault(); paper.toggle(); return;
  }
  if (speakerNotes?.handleKey(e)) return; // the editor's keys, or Esc from read-only notes
  if (typing) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Space on a focused button, link or summary, here or in a slide's frame, is for that control.
  if (spaceForControl(e)) return;
  const key = e.key;
  if (["ArrowRight", "PageDown", " "].includes(key)) { e.preventDefault(); next(); }
  else if (["ArrowLeft", "PageUp"].includes(key)) { e.preventDefault(); prev(); }
  else if (key === "Home") go(0);
  else if (key === "End") go(slides.length - 1);
  else if (key === "n" || key === "N") toggleNotes();
  else if (!isAudience && (key === "p" || key === "P")) { e.preventDefault(); presentation?.toggle(); }
  else if (key === "f" || key === "F") toggleFullscreen();
  else if (key === "Escape") document.querySelectorAll(".settings-pop").forEach((box) => box.classList.remove("open"));
}

/**
 * A deck key pressed in the paper's frame (js/paper.js): ← and → change
 * slides, and Escape hands the keys back to the slides, so the arrow keys
 * move through them again instead of scrolling the paper.
 */
function paperKey(key) {
  if (key === "ArrowLeft") prev();
  else if (key === "ArrowRight") next();
  else if (key === "Escape") focusDeck();
}
document.addEventListener("keydown", onKey);
window.addEventListener("hashchange", fromHash);
window.addEventListener("resize", fit);
// The panels around the stage slide open and shut, and can be dragged to a
// new size (deck.css, js/panels.js); refit the slide to the room left as
// they move, not only when the window changes.
new ResizeObserver(() => fit()).observe(viewport);
document.addEventListener("fullscreenchange", fit);
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-notes]")) toggleNotes();
  else if (t.closest("[data-full]")) toggleFullscreen();
  else if (t.closest("[data-prev]")) prev();
  else if (t.closest("[data-next]")) next();
  else if (t.closest("[data-settings]")) toggleSettings(t.closest("[data-settings]"));
  else if (t.closest("[data-retry]")) { callEmbeds(embeds, "retry"); prepare(slides[current]); }
});
/** Open or close the box that a bar button added by an embed provider controls (its aria-controls). */
function toggleSettings(button) {
  const box = document.getElementById(button.getAttribute("aria-controls") || "") ?? document.querySelector(".settings-pop");
  box?.classList.toggle("open");
}

// A quick sideways swipe on the slides, on a touch screen, changes them
// (swipeStep in js/layout.js): to the left for the next, to the right for the
// previous. deck.css leaves sideways moves on the stage to the deck
// (touch-action), so the browser doesn't take them for scrolling. A touch on
// a slide's own frame stays in that frame, and while editing, a touch moves
// what it's on, not the slides.
let touchStart = null;
viewport.addEventListener("pointerdown", (e) => {
  touchStart = e.pointerType === "touch" && e.isPrimary ? { x: e.clientX, y: e.clientY, time: e.timeStamp } : null;
});
viewport.addEventListener("pointerup", (e) => {
  if (!touchStart || e.pointerType !== "touch" || !e.isPrimary) return;
  const step = swipeStep(e.clientX - touchStart.x, e.clientY - touchStart.y, e.timeStamp - touchStart.time);
  touchStart = null;
  if (!step || editor?.editing || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  if (step > 0) next(); else prev();
});
viewport.addEventListener("pointercancel", () => { touchStart = null; });

// The embed providers the slides use, ready before the first slide comes up.
embeds = await loadEmbeds(embedModules(root, document.baseURI), embedDeck);

// The editor, the notes and the presenter are only loaded where they're used:
// an author's page loads the editor (which has the notes) and the presenter, a
// published deck the read-only notes and the presenter, the presenter's pop-out
// only the presenter, and the talk's audience edition none of them.
const { initEditor } = authoring ? await import("./editor.js") : {};
const { initNotes } = presenting && !authoring ? await import("./notes.js") : {};
const { initPresenter, initAudience } = presenting || isAudience ? await import("./presenter.js") : {};

if (authoring) editor = initEditor({
  slides, stage, currentSlide: () => slides[current], fit,
  beforeOpen: () => paper?.toggle(false),
  goTo: (id) => go(slides.findIndex((s) => s.id === id)),
  setOrder: (ids) => {
    const active = slides[current];
    const byId = new Map(slides.map((s) => [s.id, s]));
    // Reorder navigation without moving loaded iframe nodes in the DOM.
    slides.splice(0, slides.length, ...ids.map((id) => byId.get(id)));
    current = slides.indexOf(active);
    if (current >= 0) {
      history.replaceState(null, "", `#${active.id}`);
      showPlayables(current);
    }
  },
  refresh: ({ notesOnly = false, orderChanged = true, slide = slides[current] } = {}) => {
    if (notesOnly) {
      if (current >= 0) speakerNotes?.refreshNotes();
      presentation?.refresh();
      return;
    }
    if (orderChanged) slideList?.refresh();
    else if (slide) slideList?.update(slide);
    if (current >= 0) updateChrome();
    fit();
    presentation?.refresh({ contentChanged: true });
  },
});
speakerNotes = editor ?? (initNotes ? initNotes({ currentSlide: () => slides[current], fit, focusDeck }) : null);
// The notes drawer's top edge and the editor's left edge resize them (js/panels.js).
if (presenting) {
  initResizer({ handle: document.querySelector('.panel-resize[data-resize="notes"]'), name: "notes", side: "bottom",
    property: "--notes-size", key: KEYS.notesHeight });
}
if (authoring) {
  initResizer({ handle: document.querySelector('.panel-resize[data-resize="editor"]'), name: "editor", side: "right",
    property: "--editor-width", key: KEYS.editorWidth });
}
for (const s of slides) s.setAttribute("aria-hidden", "true");
// The audience window shows only the slides, so it has no list of them.
if (!isAudience) slideList = initSlideList({ slides, relayout: fit, embeds });
initPlayables({ slides, stageScale: () => scale, onKey });
const goTo = (id) => { const i = slides.findIndex((slide) => slide.id === id); if (i >= 0) go(i); };
if (isAudience) {
  presentation = initAudience({ currentSlide: () => slides[current], goTo, pause: () => {
    callEmbeds(embeds, "pause");
    showPlayables(-1);
  }, applySlides: (content) => {
    const incoming = content.map(({ id, html }) => {
      const parsed = new DOMParser().parseFromString(html, "text/html").querySelector(".slide");
      if (!parsed || parsed.id !== id) throw new Error("Invalid presentation slide.");
      parsed.querySelectorAll(".notes").forEach((notes) => notes.remove());
      parsed.classList.remove("active");
      parsed.setAttribute("aria-hidden", "true");
      return parsed;
    });
    if (incoming.length !== slides.length || new Set(incoming.map((slide) => slide.id)).size !== slides.length || incoming.some((slide) => !slides.some((old) => old.id === slide.id))) throw new Error("Presentation slides do not match these slides.");
    for (const slide of slides) slide.remove();
    // The embed providers' frames belong to the old slides.
    document.querySelectorAll(".frames > iframe").forEach((frame) => frame.remove());
    callEmbeds(embeds, "reset");
    slides.splice(0, slides.length, ...incoming);
    stage.append(...slides);
    current = -1;
    initPlayables({ slides, stageScale: () => scale, onKey });
  } });
} else if (presenting) {
  presentation = initPresenter({ slides, currentSlide: () => slides[current], goTo, embeds,
    // The slides as the audience sees them: the editor's, with any unsaved edits, or as published.
    getSlides: () => editor ? editor.getSlides() : slides,
    // An app window is opened by the local server, which a published deck doesn't have.
    appWindow: authoring,
    setPresenting: (active, notesWereOpen) => {
      analytics.mode(active);
      feedback.setHidden(active);
      if (active) {
        paper?.toggle(false); // presenter mode lays out the window its own way
        if (editor?.editing) editor.toggle(false);
        speakerNotes.toggleNotes(true);
        slideList?.toggle(false, { remember: false }); // presenter mode lays out the window its own way
        document.querySelectorAll(".settings-pop").forEach((box) => box.classList.remove("open"));
        showPlayables(-1);
        callEmbeds(embeds, "pause");
      } else {
        speakerNotes.toggleNotes(notesWereOpen);
        showPlayables(current);
        prepare(slides[current]);
      }
      fit();
    },
  });
}
paper = initPaper({
  relayout: fit, onKey: paperKey,
  canOpen: () => !presentation?.active,
  beforeOpen: () => { if (editor?.editing) editor.toggle(false); },
});
fit();
if (!isAudience) fromHash();
// The deck is ready: the embed providers may load what their slides will need.
if (!isAudience) callEmbeds(embeds, "start");
