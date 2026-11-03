// The slide list: a strip of small pictures of every slide down the left of
// the window, grouped under the deck's sections, as Keynote, PowerPoint and
// Google Slides show them. The bar's Slides button opens and closes it, and
// js/deck.js narrows the stage beside it rather than covering the slide.
// Hovering over a picture, or reaching it with the keyboard, shows the
// slide's number and title beside it.
//
// Each picture is a copy of its slide, laid out on its own 1600 × 900 stage
// and scaled down, inside a shadow root of its own. The shadow root keeps
// the copies' ids, classes and headings out of the deck's page, so nothing
// that looks for a slide (the deck, the editor, the presenter) finds a copy,
// and it gives each copy the deck's style sheets without the page's rules
// for the bar, the editor or presenter mode. A copy shows no live demo: each
// slot or set of frames shows the demo's still image when the deck indexes
// one (data-demo-previews, as the presenter's next-slide preview uses), and
// otherwise a box that says a demo goes there.
//
// groupByPart() and slideLabel() are pure functions, so
// explorables/tests/slide-list.test.mjs can check them without a browser;
// explorables/tests/slide-list-browser.mjs checks the strip itself.
import { demoSource, loadDemoPreviews, matchingPreview } from "./preview.js";
import { initResizer } from "./panels.js";
import { KEYS } from "./storage.js";

/**
 * How much of the strip's width isn't a picture: the slide's number, the
 * gap after it, the padding at the right and the scroll bar. A picture is
 * the rest (thumbWidth()), so it grows as the strip is dragged wider.
 */
export const LIST_CHROME = 52;
const STAGE_W = 1600;

/** The width of each picture in a strip `listWidth` CSS pixels wide. */
export function thumbWidth(listWidth) {
  return Math.max(40, Math.round(listWidth - LIST_CHROME));
}
const OPEN_KEY = KEYS.slideListOpen; // whether the viewer last left the strip open (js/storage.js)

/**
 * Split the slides into runs that share a section (data-part), in order.
 * Each slide is {id, part, title}; the result is
 * [{part, items: [{id, title, number}]}], numbered from 1 across the deck.
 * A section that comes back later starts a new run, as it would on screen.
 */
export function groupByPart(slides) {
  const groups = [];
  slides.forEach(({ id, part = "", title }, i) => {
    if (!groups.length || groups[groups.length - 1].part !== part) groups.push({ part, items: [] });
    groups[groups.length - 1].items.push({ id, title, number: i + 1 });
  });
  return groups;
}

/** What the strip says about a slide, on hover and to a screen reader: "12 · Its title". */
export function slideLabel({ number, title }) {
  return `${number} · ${title}`;
}

/** A slide's title: its first heading, or its id when it has none. */
export function slideTitle(slide) {
  return slide.querySelector("h1, h2")?.textContent.replace(/\s+/g, " ").trim() || slide.id;
}

/**
 * The deck's style sheets, as sheets a shadow root can adopt. Each keeps its
 * own address, so its relative url()s still resolve. A sheet whose rules
 * can't be read (a font service's, from another origin) is left out; the
 * fonts it declares are the page's, and the copies use them anyway.
 */
function adoptableSheets(doc) {
  const sheets = [];
  const add = (sheet) => {
    let rules;
    try { rules = [...sheet.cssRules]; } catch { return; }
    const own = [];
    for (const rule of rules) {
      // An @import's rules come first, in a sheet of their own (a constructed sheet ignores @import).
      if (rule instanceof CSSImportRule) { if (rule.styleSheet) add(rule.styleSheet); }
      else own.push(rule.cssText);
    }
    const copy = new CSSStyleSheet({ baseURL: sheet.href || doc.baseURI });
    copy.replaceSync(own.join("\n"));
    sheets.push(copy);
  };
  for (const sheet of doc.styleSheets) add(sheet);
  // The picture's own frame: a stage at the slides' size, scaled to the strip,
  // that only ever shows its one slide. --thumb-w and --thumb-scale come from
  // the strip (sizeThumbs() below), and are inherited into the shadow root.
  const frame = new CSSStyleSheet();
  frame.replaceSync(`
    :host { display: block; position: relative; overflow: hidden; width: var(--thumb-w, 168px); height: calc(var(--thumb-w, 168px) * 9 / 16); }
    .stage { position: absolute; left: 0; top: 0; transform: scale(var(--thumb-scale, 0.105)); transform-origin: 0 0; pointer-events: none; }
    .slot, .play-room { position: relative; }
    .thumb-demo { position: absolute; inset: 0; display: grid; place-content: center; border: 4px dashed var(--line); border-radius: 16px; background: var(--surface-2); color: var(--ink-3); font-size: 64px; }
    .thumb-still { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: contain; }
  `);
  sheets.push(frame);
  return sheets;
}

/** The current theme, for picking a demo's light or dark still. */
function theme(doc) {
  return doc.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

/**
 * A copy of `slide` for the strip: shown, inert, with no notes, scripts or
 * frames, and with each demo's place filled by its still (from `stills`, the
 * deck's index of them) or by a box that says a demo goes there.
 */
function slideCopy(slide, doc, stills, embeds) {
  const copy = slide.cloneNode(true);
  copy.classList.add("active");
  copy.removeAttribute("aria-hidden");
  copy.querySelectorAll(".notes, script, .offline").forEach((node) => node.remove());
  copy.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
  [...copy.querySelectorAll(".slot, .play-room")].forEach((room, index) => {
    const still = matchingPreview(stills[slide.id]?.[index], demoSource(room, embeds));
    if (still) {
      const image = doc.createElement("img");
      image.className = "thumb-still";
      image.src = theme(doc) === "dark" ? still.dark : still.light;
      image.alt = "";
      image.loading = "lazy";
      room.replaceChildren(image);
    } else {
      const box = doc.createElement("div");
      box.className = "thumb-demo";
      box.textContent = "Interactive demo";
      room.replaceChildren(box);
    }
  });
  copy.querySelectorAll("iframe, video, audio, canvas").forEach((node) => node.remove());
  const stage = doc.createElement("div");
  stage.className = "stage";
  // A picture is only a picture: the links and buttons copied from the slide
  // can't take the keyboard or a click, so Tab goes from one slide's link in
  // the strip to the next, and a click lands on the strip's own link.
  stage.inert = true;
  stage.append(copy);
  return stage;
}

/**
 * Run the strip in `doc`: fill it from `slides` (the deck's live slide
 * list, which the editor may reorder), and open or close it with the bar's
 * Slides button. `relayout` refits the stage after the strip opens or closes.
 * Returns {toggle(open?, {remember}), refresh(), update(slide), showCurrent(slide)}:
 * refresh() rebuilds the strip after the slides change, update() redraws one
 * slide's picture after it was edited, and showCurrent() marks the slide on
 * screen and scrolls the strip to it.
 */
export function initSlideList({ doc = document, slides, relayout, embeds = [], isNarrow = () => matchMedia("(max-width: 639px)").matches }) {
  const nav = doc.querySelector(".slide-list");
  const button = doc.querySelector("[data-list]");
  const tip = doc.querySelector(".slide-tip");
  if (!nav || !button) return null;
  let sheets = null; // built on first open, once the deck's style sheets have loaded
  let stills = {};
  let built = false; // whether the strip shows the slides as they are now
  let current = null;
  const pictures = new Map(); // slide id -> its picture's shadow host

  loadDemoPreviews(doc).then((index) => { stills = index; if (built) build(); });
  // Switch demo preview stills between light and dark when the system color scheme changes.
  doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => { if (built) build(); });

  // The pictures fill the strip's width, whatever it's dragged to.
  function sizeThumbs() {
    const width = thumbWidth(nav.getBoundingClientRect().width);
    nav.style.setProperty("--thumb-w", `${width}px`);
    nav.style.setProperty("--thumb-scale", String(width / STAGE_W));
  }
  new ResizeObserver(sizeThumbs).observe(nav);
  // Its right edge, dragged, sets its width (js/panels.js).
  initResizer({ doc, handle: doc.querySelector('.panel-resize[data-resize="list"]'), name: "list", side: "left",
    property: "--list-w", key: KEYS.slideListWidth, onResize: () => { hideTip(); relayout(); } });

  function picture(slide) {
    const host = doc.createElement("div");
    host.className = "thumb";
    const root = host.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = sheets;
    root.append(slideCopy(slide, doc, stills, embeds));
    pictures.set(slide.id, host);
    return host;
  }

  function build() {
    sheets ??= adoptableSheets(doc);
    pictures.clear();
    const parts = groupByPart(slides.map((s) => ({ id: s.id, part: s.dataset.part || "", title: slideTitle(s) })));
    const byId = new Map(slides.map((s) => [s.id, s]));
    const children = [];
    for (const { part, items } of parts) {
      const section = doc.createElement("section");
      if (part) {
        const heading = doc.createElement("h3");
        heading.className = "list-part";
        heading.textContent = part;
        heading.title = part; // a long name is cut short to fit the strip
        section.append(heading);
      }
      const list = doc.createElement("ol");
      list.start = items[0].number;
      for (const item of items) {
        const entry = doc.createElement("li"), link = doc.createElement("a");
        link.className = "thumb-link";
        link.href = `#${item.id}`;
        link.dataset.label = slideLabel(item);
        link.setAttribute("aria-label", slideLabel(item));
        const number = doc.createElement("span");
        number.className = "thumb-number";
        number.textContent = item.number;
        number.setAttribute("aria-hidden", "true");
        link.append(number, picture(byId.get(item.id)));
        entry.append(link);
        list.append(entry);
      }
      section.append(list);
      children.push(section);
    }
    nav.replaceChildren(...children);
    built = true;
    if (current) showCurrent(current);
  }

  const isOpen = () => !nav.hidden;

  // `remember: false` closes the strip for now without forgetting that the
  // viewer likes it open (presenter mode closes it to lay out its own view).
  function toggle(open = !isOpen(), { remember = true } = {}) {
    const hadFocus = !open && nav.contains(doc.activeElement);
    nav.hidden = !open;
    doc.body.classList.toggle("list-open", open);
    button.setAttribute("aria-pressed", String(open));
    hideTip();
    if (remember) try { localStorage.setItem(OPEN_KEY, open ? "open" : ""); } catch { /* a convenience only */ }
    if (open && !built) build();
    if (hadFocus) button.focus({ preventScroll: true });
    relayout();
    if (open && current) showCurrent(current);
  }

  function showCurrent(slide) {
    current = slide;
    if (!built) return;
    for (const a of nav.querySelectorAll(".thumb-link")) {
      const here = a.hash === `#${slide.id}`;
      a.setAttribute("aria-current", here ? "true" : "false");
      if (here && isOpen()) a.scrollIntoView({ block: "nearest" });
    }
  }

  // The slide's number and title, beside the picture under the pointer or the keyboard.
  function showTip(link) {
    if (!tip) return;
    tip.textContent = link.dataset.label;
    tip.hidden = false;
    const r = link.querySelector(".thumb").getBoundingClientRect();
    tip.style.left = `${r.right + 10}px`;
    tip.style.top = `${r.top + r.height / 2}px`;
  }
  function hideTip() { if (tip) tip.hidden = true; }
  nav.addEventListener("pointerover", (e) => { const link = e.target.closest(".thumb-link"); if (link) showTip(link); });
  nav.addEventListener("pointerleave", hideTip);
  nav.addEventListener("focusin", (e) => { const link = e.target.closest(".thumb-link"); if (link) showTip(link); });
  nav.addEventListener("focusout", hideTip);
  nav.addEventListener("scroll", hideTip, { passive: true });
  nav.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) { e.preventDefault(); e.stopPropagation(); toggle(false); }
  });
  nav.addEventListener("click", (e) => {
    // A narrow window has no room for the strip beside the slide, and presenter
    // mode lays out the window its own way, so there it covers the view and
    // choosing a slide closes it.
    if (!e.target.closest(".thumb-link")) return;
    if (isNarrow()) toggle(false);
    else if (doc.body.classList.contains("presenter-mode")) toggle(false, { remember: false });
  });
  button.addEventListener("click", () => toggle());

  // Reopen the strip if the viewer left it open, unless the window is too narrow to share.
  let wasOpen = false;
  try { wasOpen = localStorage.getItem(OPEN_KEY) === "open"; } catch { /* storage can be blocked */ }
  if (wasOpen && !isNarrow()) toggle(true);

  return {
    toggle,
    showCurrent,
    /** Rebuild after the slides change: now if the strip is open, or else when it next opens. */
    refresh() { if (isOpen()) build(); else built = false; },
    /** Redraw one slide's picture, as it is now. */
    update(slide) {
      const host = pictures.get(slide.id);
      if (!host) return;
      host.shadowRoot.replaceChildren(slideCopy(slide, doc, stills, embeds));
      const link = host.closest(".thumb-link");
      const number = Number(link?.querySelector(".thumb-number")?.textContent);
      if (link && number) {
        const label = slideLabel({ number, title: slideTitle(slide) });
        link.dataset.label = label;
        link.setAttribute("aria-label", label);
      }
    },
  };
}
