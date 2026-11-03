// Frames that belong to a slide: pages from the deck's own folder that play
// right on the slide, such as a student's own demo, or the interactives of
// Parable of the Polygons (schelling-segregation/polygons/play/...). The
// guide's widgets and the lab share one frame each across slides
// (js/deck.js); these are part of their slide's markup instead:
//
//   <div class="play-room" data-max="1.6">     the space the slide gives them
//     <div class="play-set">                     the frames at their own size, side by side
//       <iframe data-src="demo/index.html" width="800" height="385" scrolling="no" title="…"></iframe>
//     </div>
//   </div>
//
// - A frame loads when its slide, or the slide before it, comes up, and then
//   stays loaded, so whatever you did in it is still there when you return.
// - The set is scaled as one to fit its room, enlarged no more than
//   data-max, and centred in it (fitWidget in layout.js). It's refitted
//   whenever the room changes size, so it never overflows and never scrolls.
//
// Every frame is told when its slide comes on screen and goes off it, with
// the message {type: "deck:visibility", visible: true | false}, so a page
// can pause its own animation while nobody sees it:
//   addEventListener("message", (e) => { if (e.data?.type === "deck:visibility") running = e.data.visible; });
// And every frame is told how sharply it's shown, with the message
// {type: "deck:resolution", detail}: how many of the screen's pixels each of
// its CSS pixels covers, rounded up to a quarter and capped (canvasDetail in
// layout.js). A page that draws on a canvas can give the canvas that many
// pixels per CSS pixel, so it stays sharp when the slide enlarges it.
// These messages are all a page hears from the deck. A page written to be
// paused some other way listens for them itself: the Parable's pages load a
// small shim that turns them into the globals the post sets as it scrolls,
// and sharpens their canvases (schelling-segregation/polygons/play/deck-shim.js).
//
// The frames come from the deck's own server, so the deck can also reach
// into them once they've loaded (ready(), below):
// - The deck's keys keep working after a click in a frame.
// - A link meant to replace the whole page (the header's translations have
//   target="_parent") opens in a new tab instead, so it can't end the deck.
// - A frame's data-hide names elements of its page to hide, with a CSS
//   selector, so a slide can leave out part of a page without changing the
//   copy: the title slide hides the header's links to the post's
//   translations, too small to read on a slide.
import { canvasDetail, fitWidget } from "./layout.js";

let slides = [];
let stageScale = () => 1;
let onKey = () => {};
let observer = null;

/**
 * Set up the slides' own frames. deck.js passes its slides, a function that
 * returns the stage's current scale, and its key handler.
 */
export function initPlayables(options) {
  ({ slides, stageScale, onKey } = options);
  // A room changes size when its slide comes up (from nothing, while the
  // slide was hidden) and when the fonts arrive. Resize observers are told
  // before the page is painted, so a set is never seen at the wrong size.
  observer?.disconnect();
  observer = new ResizeObserver((entries) => entries.forEach((entry) => fitRoom(entry.target)));
  for (const room of document.querySelectorAll(".slide .play-room")) observer.observe(room);
}

/** Slide `index` is on screen: load its frames and the next slide's, and run only its own. */
export function showPlayables(index) {
  for (const slide of index < 0 ? [] : [slides[index], slides[index + 1]]) {
    for (const frame of slide?.querySelectorAll("iframe[data-src]") ?? []) load(frame);
  }
  for (const frame of document.querySelectorAll(".slide iframe[data-src]")) {
    setInSight(frame, frame.closest(".slide") === slides[index]);
  }
}

/** The stage has been scaled: give the frames' canvases the pixels for their new size. */
export function resizePlayables() {
  for (const frame of document.querySelectorAll(".slide iframe[data-src][src]")) sharpen(frame);
}

/** Scale a room's set of frames to fit it. */
function fitRoom(room) {
  const set = room.querySelector(".play-set");
  const w = room.clientWidth, h = room.clientHeight;
  if (!set || !w || !h) return; // its slide isn't on screen
  // The set's own size, which its transform doesn't change.
  const size = { width: set.offsetWidth, height: set.offsetHeight };
  const { scale, x, y } = fitWidget({ x: 0, y: 0, w, h }, size, Number(room.dataset.max) || 1, "middle");
  set.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  set.dataset.scale = String(scale);
  for (const frame of set.querySelectorAll("iframe[src]")) sharpen(frame);
}

function load(frame) {
  if (frame.hasAttribute("src")) return;
  frame.addEventListener("load", () => ready(frame));
  frame.src = frame.dataset.src;
}

/** A frame's document, or null if its page is from another server and can't be reached into. */
function page(frame) {
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

/** A frame's page has loaded: hook it up to the deck. */
function ready(frame) {
  // Anything said before the page loaded went to the empty page before it, so it's said again now.
  delete frame.dataset.detail;
  sharpen(frame);
  setInSight(frame, frame.closest(".slide")?.classList.contains("active") ?? false);
  const doc = page(frame);
  if (!doc) return;
  if (frame.dataset.hide) for (const el of doc.querySelectorAll(frame.dataset.hide)) el.style.display = "none";
  doc.addEventListener("keydown", onKey);
  for (const link of doc.querySelectorAll('a[target="_parent"], a[target="_top"]')) {
    link.target = "_blank";
    link.rel = "noopener";
  }
}

/**
 * Run or pause a frame's page: tell it whether its slide is on screen. A
 * frame that hasn't loaded yet hears about it once it has (ready()).
 */
function setInSight(frame, inSight) {
  if (!frame.hasAttribute("src")) return;
  frame.contentWindow?.postMessage({ type: "deck:visibility", visible: inSight }, "*");
}

/**
 * Tell a frame how sharply it's shown (deck:resolution), when that changes:
 * the set's scale on the stage, times the stage's on the screen, times the
 * screen's pixels per CSS pixel.
 */
function sharpen(frame) {
  const shown = Number(frame.closest(".play-set")?.dataset.scale);
  if (!frame.hasAttribute("src") || !shown) return; // not loaded, or its slide hasn't been on screen yet
  const detail = canvasDetail(window.devicePixelRatio || 1, shown * stageScale());
  if (Number(frame.dataset.detail) === detail) return;
  frame.dataset.detail = String(detail);
  frame.contentWindow?.postMessage({ type: "deck:resolution", detail }, "*");
}
