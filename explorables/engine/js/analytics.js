// Usage analytics for a deck: how long readers spend on each slide and what
// they do there. analytics-core.js holds the time rules and record format;
// this file connects them to the page. The format and its BigQuery views are
// described in explorables/ANALYTICS.md.
//
// When records are sent:
//   - each finished segment (a slide, panel or mode change; the tab hidden;
//     the page closing) is written once, right away;
//   - the open segment is saved to localStorage every 5 seconds, so a page
//     that dies without sending is recovered by the next page on this browser;
//   - failed writes are retried every minute, when the browser comes back
//     online, and at the next segment end.
// In console mode (authoring and localhost), each finished segment is printed
// instead, and nothing is stored or sent.
import { TimeTracker, Outbox, createIdentity, logId, prepareLog } from "./analytics-core.js";
import { destination, openWriter, safeStorage } from "./collection.js";

const token = value => /^[a-zA-Z0-9_.:-]{1,100}$/.test(value ?? "") ? value : null;

/**
 * The name an interaction records for a control: its data-analytics-id, else
 * its id, data-action or data-field. Links without one are named by where they
 * go (`link-world` for #world, `link-arxiv.org` for another site); other
 * controls fall back to their tag and first class, such as `button.ts-dot`.
 */
export function controlName(el, base = location.href) {
  const named = token(el.dataset?.analyticsId) || token(el.id) || token(el.dataset?.action) || token(el.dataset?.field);
  if (named) return named;
  const tag = el.tagName.toLowerCase();
  if (tag === "a" && el.getAttribute("href")) {
    try {
      const url = new URL(el.getAttribute("href"), base), here = new URL(base);
      const target = url.origin === here.origin && url.pathname === here.pathname && url.hash ? url.hash.slice(1) :
        url.origin === here.origin ? url.pathname.split("/").filter(Boolean).at(-1) ?? "home" : url.hostname;
      const link = token(`link-${target}`.slice(0, 100));
      if (link) return link;
    } catch { /* an unparseable href falls back below */ }
  }
  return token(el.classList?.[0] && `${tag}.${el.classList[0]}`) || tag;
}
// Continuous events (movement, scrolling) are sampled; one per half second
// changes active time by under half a second. Presses and keys always count.
const SAMPLED = new Set(["pointermove", "mousemove", "scroll", "wheel", "touchmove"]);
const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "click", "wheel", "scroll", "touchmove"];
const NOOP = { slide() {}, mode() {}, track() {}, identity: () => null };

/**
 * Start analytics for this page and return the deck's hooks:
 *   slide(slideElement, cause)  a new slide is showing ("entry", "next", ...);
 *   mode(presenting)            presenter mode turned on or off;
 *   track(category, action, data)  record an interaction from elsewhere
 *                               (feedback.js reports its widget this way);
 *   identity()                  the reader's IDs (null where analytics doesn't run).
 * `configuration` and `kind` let tests and the emulator preview pick the destination.
 */
export function initAnalytics({ published, authoring, audience, currentSlide, configuration, kind: forcedKind, now = Date.now }) {
  const root = document.documentElement;
  const environment = { published, authoring, audience, hostname: location.hostname, protocol: location.protocol };
  const kind = forcedKind ?? destination(environment, configuration);
  if (kind === "off" || !root.dataset.contentVersion) return NOOP;
  const development = kind === "console";
  const write = openWriter(kind, configuration ? { configuration } : {});
  const local = safeStorage("localStorage"), session = safeStorage("sessionStorage");
  const deckId = root.dataset.deck, contentVersion = root.dataset.contentVersion;
  // Every reader is recorded, including browsers that send Global Privacy
  // Control or Do Not Track: these logs stay on this site, are never shared,
  // and serve only to understand how the decks are used.
  const prepare = record => prepareLog(record, now());
  const identity = createIdentity({ local, session });
  const outbox = development ? null : new Outbox({ storage: local });
  const tracker = new TimeTracker({ identity, emit: record => {
    if (development) write("logs", logId(record), prepare(record));
    else outbox.put(record);
  } });
  let slideId = null, surface = "slide", mode = "reading", lastActivity = 0;

  function flush({ keepalive = false } = {}) {
    if (development) return;
    outbox.checkpoint(tracker.snapshot(now()));
    outbox.flush(write, prepare, { keepalive }).catch(() => { /* kept for the next attempt */ });
  }
  const context = () => slideId ? { deckId, contentVersion, route: `/${deckId}/`, state: { slideId, surface, mode } } : null;
  tracker.visible = document.visibilityState === "visible";
  outbox?.adoptStale();   // records that earlier pages on this browser couldn't send
  flush();

  function activity(event) {
    if (document.visibilityState !== "visible") return;
    const at = now();
    if (SAMPLED.has(event.type) && at - lastActivity < 500) return;
    lastActivity = at;
    tracker.activity(at);
  }
  const track = (category, action, data = null) => tracker.interaction(category, action, data, now());
  /** A context change (slide, panel, mode) ends the segment; send it right away. */
  function contextChanged() {
    tracker.setContext(context(), now());
    flush();
  }
  function syncSurface() {
    const next = document.body.classList.contains("paper-open") ? "paper" :
      document.body.classList.contains("show-notes") ? "notes" : "slide";
    if (surface === next) return;
    surface = next;
    contextChanged();
  }
  new MutationObserver(syncSurface).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { tracker.hide(now()); flush({ keepalive: true }); }
    else tracker.show(now());
  });
  // A closing page, or one entering the back/forward cache.
  window.addEventListener("pagehide", () => { tracker.hide(now()); flush({ keepalive: true }); });
  window.addEventListener("pageshow", event => {
    if (event.persisted && document.visibilityState === "visible") tracker.show(now());
  });
  window.addEventListener("online", () => flush());
  if (!development) {
    setInterval(() => outbox.checkpoint(tracker.snapshot(now())), 5000);
    setInterval(() => { if (outbox.size) flush(); }, 60000);
  }

  // ----------------------------------------------------- interactions
  /**
   * Listen for activity and interactions in the deck and in each same-origin
   * demo iframe. Interactions are clicks and committed changes on controls,
   * named by data-analytics-id (or an id, data-action or data-field). Typed
   * text, key presses and pointer positions are never recorded.
   */
  function observePage(doc, frame = null) {
    const visible = event => event.isTrusted && slideId &&
      (!frame || (frame.checkVisibility?.({ visibilityProperty: true }) !== false &&
        event.target.checkVisibility?.({ visibilityProperty: true }) !== false));
    for (const name of ACTIVITY_EVENTS) doc.addEventListener(name, event => { if (visible(event)) activity(event); }, { capture: true, passive: true });
    function interaction(event) {
      if (!visible(event) || event.target.closest?.("#explorable-feedback, .notes-drawer")) return;
      const el = event.target.closest?.("[data-analytics-id], button, input, select, canvas, a[href], [role=button], [onclick]");
      if (!el) return;
      // A committed change of a slider, choice or number is recorded, never its value.
      // Text fields aren't recorded at all.
      if (event.type === "change" && !el.matches("input[type=range], input[type=checkbox], input[type=radio], input[type=number], select")) return;
      if (event.type === "click" && el.matches("input, select")) return;
      const controlId = controlName(el, doc.URL);
      track(frame ? "demo" : "control", event.type === "change" ? "change" : "activate", { controlId, demoId: frame ? demoIdentity(frame) : "deck" });
    }
    doc.addEventListener("click", interaction, true);
    doc.addEventListener("change", interaction, true);
    // Parable's two-ended slider predates native range inputs. Record one
    // committed gesture, without its pointer positions or intermediate values.
    let customSlider = null;
    doc.addEventListener("pointerdown", e => { if (frame && visible(e)) customSlider = token(e.target.closest?.(".ds")?.id); }, true);
    doc.addEventListener("pointerup", e => {
      if (customSlider && visible(e)) track("demo", "change", { controlId: customSlider, demoId: demoIdentity(frame) });
      customSlider = null;
    }, true);
  }
  function demoIdentity(frame) {
    return token(currentSlide()?.querySelector(".slot[data-demo]")?.dataset.demo) || token(frame.dataset.analyticsId) ||
      `frame-${[...document.querySelectorAll(".slide.active iframe, .frames iframe.on")].indexOf(frame)}`;
  }
  observePage(document);
  const seenDocuments = new WeakSet(), frames = new WeakSet();
  function attachFrame(frame) {
    function attach() {
      try {
        const doc = frame.contentDocument;
        if (!doc || doc.URL === "about:blank" || doc.readyState !== "complete" || seenDocuments.has(doc)) return;
        seenDocuments.add(doc); observePage(doc, frame);
      } catch { /* Cross-origin demos use the message bridge below. */ }
    }
    if (!frames.has(frame)) { frames.add(frame); frame.addEventListener("load", attach); }
    attach();
  }
  const stage = document.querySelector(".stage");
  const scanFrames = () => stage?.querySelectorAll("iframe").forEach(attachFrame);
  if (stage) new MutationObserver(scanFrames).observe(stage, { childList: true, subtree: true });
  scanFrames();
  // Cross-origin demos may opt in with a small semantic bridge. Accept only the
  // active, known frame, its exact origin, and a fixed action vocabulary.
  window.addEventListener("message", event => {
    const d = event.data;
    if (d?.type !== "explorables:action" || !["change", "run", "reset", "play", "pause", "compare"].includes(d.action) || !token(d.controlId)) return;
    const frame = [...document.querySelectorAll(".slide.active iframe, .frames iframe.on")].find(f => f.contentWindow === event.source);
    if (!frame || event.origin !== new URL(frame.src, location.href).origin || frame.checkVisibility?.({ visibilityProperty: true }) === false) return;
    track("demo", d.action, { controlId: d.controlId, demoId: demoIdentity(frame) });
  });

  return {
    slide(slide, cause = "navigation") {
      const previousSlideId = slideId;
      slideId = slide.id;
      contextChanged();
      scanFrames();
      track("navigation", "slide_enter", { previousSlideId, cause });
    },
    mode(presenting) {
      mode = presenting ? "presenting" : "reading";
      contextChanged();
    },
    track(category, action, data = null) { if (slideId) track(category, action, data); },
    identity: () => identity,
  };
}
