// An independent reading resource beside the slides. Only the checked abstract
// and introduction are loaded; slide navigation never changes the reader.
import { KEYS } from "./storage.js";

/** The narrowest the panel gets, and the room it always leaves the slides, in CSS pixels. */
export const MIN_PANEL = 280;
export const MIN_STAGE = 360;
// The panel's width, as its reader last left it, in this browser (js/storage.js).
const WIDTH_KEY = KEYS.paperWidth;

/**
 * Which of the keys pressed in the paper's frame are the deck's: ← and →
 * change slides, R closes the paper, and Escape returns the keys to the
 * slides. Every other key stays with the paper, so ↑, ↓, Page Up, Page Down
 * and the space bar scroll it. Returns the key's name, or null.
 */
export function deckKey({ key, metaKey = false, ctrlKey = false, altKey = false }) {
  if (metaKey || ctrlKey || altKey) return null;
  if (key === "ArrowLeft" || key === "ArrowRight" || key === "Escape") return key;
  if (key === "r" || key === "R") return "r";
  return null;
}

/** Resolve the checked excerpt file; only web addresses are loadable. */
export function readingAddress(search, base) {
  const value = new URLSearchParams(search).get("structure");
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

/** The reader loads the excerpt JSON, never the original PDF. */
export function viewerAddress(viewer, structure, base) {
  const url = new URL(viewer, base);
  url.searchParams.set("structure", new URL(structure, base).href);
  return url.href;
}

/**
 * The panel's width, in CSS pixels: as wide as wanted, but no narrower than
 * MIN_PANEL, and leaving MIN_STAGE for the slides. A window too narrow for
 * both gives the panel all of it (deck.css then lays it over the slides).
 */
export function panelWidth(wanted, windowWidth, oppositeWidth = 0) {
  if (windowWidth < MIN_PANEL + MIN_STAGE) return windowWidth;
  const width = Number.isFinite(wanted) ? wanted : defaultPanelWidth(windowWidth);
  const max = Math.max(MIN_PANEL, windowWidth - MIN_STAGE - oppositeWidth);
  return Math.round(Math.min(max, Math.max(MIN_PANEL, width)));
}

/** Match the editor's default width, including its compact breakpoint (editor.css). */
export function defaultPanelWidth(windowWidth) {
  return panelWidth(windowWidth <= 740 ? 280 : 330, windowWidth);
}

/** Open a persistent reader, with the same sizing and sidebar rules as Edit. */
export function initPaper({ doc = document, relayout, onKey, canOpen = () => true, beforeOpen = () => {} }) {
  const root = doc.documentElement;
  const structure = root.dataset.paperStructure;
  const panel = doc.querySelector(".paper-panel");
  const button = doc.querySelector("button[data-paper]");
  if (!structure || !panel || !button) return null;
  const win = doc.defaultView;
  const view = panel.querySelector(".paper-view");
  const viewer = new URL("../paper.html", import.meta.url).href;
  let open = false, frame = null, ready = false, wanted = null;
  try {
    const saved = Number(win.localStorage.getItem(WIDTH_KEY));
    if (saved > 0) wanted = saved;
  } catch { /* storage can be blocked */ }

  const listWidth = () => (win.innerWidth > 639 && doc.body.classList.contains("list-open"))
    ? (doc.querySelector(".slide-list")?.getBoundingClientRect().width || 0)
    : 0;

  function setWidth() {
    const width = wanted === null
      ? panelWidth(win.innerWidth <= 740 ? 280 : 330, win.innerWidth, listWidth())
      : panelWidth(wanted, win.innerWidth, listWidth());
    doc.body.style.setProperty("--paper-w", `${width}px`);
  }

  function toggle(want = !open) {
    if (want && !canOpen() || want === open) return;
    if (want) beforeOpen();
    open = want;
    panel.hidden = !open;
    button.setAttribute("aria-pressed", String(open));
    doc.body.classList.toggle("paper-open", open);
    if (open) {
      button.focus({ preventScroll: true });
      setWidth();
      if (!frame) {
        frame = doc.createElement("iframe");
        frame.title = "The paper";
        frame.src = viewerAddress(viewer, structure, doc.baseURI);
        view.append(frame);
      }
    } else if (panel.contains(doc.activeElement) || doc.activeElement === frame) {
      // Return focus to the Paper button so it never stays stranded inside a hidden panel.
      button.focus({ preventScroll: true });
    }
    relayout();
  }

  win.addEventListener("message", (e) => {
    if (!frame || e.source !== frame.contentWindow || e.origin !== win.location.origin) return;
    if (e.data?.type === "paper:ready") ready = true;
    else if (e.data?.type === "paper:key") {
      if (e.data.key === "r") toggle(false);
      else if (deckKey(e.data)) onKey(e.data.key);
    }
  });

  doc.addEventListener("click", (e) => {
    const zoom = e.target.closest?.("[data-paper-zoom]");
    if (zoom) {
      if (ready) frame.contentWindow.postMessage({ type: "paper:zoom", by: Number(zoom.dataset.paperZoom) }, win.location.origin);
    } else if (e.target.closest?.("button[data-paper]")) toggle();
    else if (e.target.closest?.("[data-paper-close]")) toggle(false);
  });

  // Dragging the panel's left edge resizes it; double-clicking it goes back to the usual width.
  const handle = panel.querySelector(".paper-resize");
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // only the main button drags, as on the other panels' edges (js/panels.js)
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    doc.body.classList.add("paper-resizing"); // the frame stops taking the pointer, so the drag isn't lost to it
    const move = (event) => {
      wanted = panelWidth(win.innerWidth - event.clientX, win.innerWidth, listWidth());
      setWidth();
      relayout();
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      doc.body.classList.remove("paper-resizing");
      try { win.localStorage.setItem(WIDTH_KEY, String(wanted)); } catch { /* not kept */ }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("lostpointercapture", end, { once: true });
  });
  handle.addEventListener("dblclick", () => {
    wanted = null;
    try { win.localStorage.removeItem(WIDTH_KEY); } catch { /* nothing kept */ }
    setWidth();
    relayout();
  });
  win.addEventListener("resize", () => { if (open) { setWidth(); relayout(); } });

  return { toggle, get isOpen() { return open; } };
}
