// Dragging a panel's edge to resize it: the slide list's right edge, the
// editor's left edge and the notes drawer's top edge. (The paper's panel has
// its own, in js/paper.js, with the same feel.) A drag sets the panel's size
// as a CSS variable on <body> (--list-w, --editor-width, --notes-size), which
// deck.css turns into the room the panel takes from the stage. The size is
// kept within a range that leaves the slides room, remembered in this
// browser, and forgotten by a double-click on the edge, which goes back to
// the usual size.
//
// clampSize() and sizeFromPointer() are pure, so explorables/tests/panels.test.mjs
// checks them without a browser; tests/panels-browser.mjs checks the drags.

/** The room a side panel always leaves the slides, in CSS pixels (as js/paper.js's MIN_STAGE). */
export const MIN_STAGE = 360;

/**
 * The ranges each panel's size may take in a window of the given size:
 * {min, max} in CSS pixels. A window too small for the minimum gets the
 * largest size that still leaves the slides their room.
 */
export const LIMITS = {
  list: (win, opposite = 0) => ({ min: 150, max: Math.min(440, win.innerWidth - MIN_STAGE - opposite) }),
  editor: (win, opposite = 0) => ({ min: 260, max: Math.min(640, win.innerWidth - MIN_STAGE - opposite) }),
  notes: (win) => ({ min: 90, max: Math.round(win.innerHeight * 0.6) }),
};

/** `wanted`, kept within {min, max} and rounded to a whole pixel; a range with no room gives its max. */
export function clampSize(wanted, { min, max }) {
  if (max < min) return Math.max(0, Math.round(max));
  return Math.round(Math.min(max, Math.max(min, wanted)));
}

/**
 * The size a panel would have with its edge at the pointer: a panel on the
 * window's left reaches the pointer from x = 0, one on the right from the
 * window's right edge, and one at the bottom from the window's bottom.
 */
export function sizeFromPointer(side, { clientX, clientY }, { innerWidth, innerHeight }) {
  if (side === "left") return clientX;
  if (side === "right") return innerWidth - clientX;
  return innerHeight - clientY;
}

/** Width of an open opposite sidebar, so two sidebars never squeeze the stage below MIN_STAGE. */
function oppositeWidth(doc, side, win) {
  if (win.innerWidth <= 639) return 0;
  const body = doc.body;
  if (side === "left") {
    if (body.classList.contains("editing")) return doc.querySelector(".editor-panel")?.getBoundingClientRect().width || 0;
    if (body.classList.contains("paper-open")) return doc.querySelector(".paper-panel")?.getBoundingClientRect().width || 0;
  } else if (side === "right" && body.classList.contains("list-open")) {
    return doc.querySelector(".slide-list")?.getBoundingClientRect().width || 0;
  }
  return 0;
}

/**
 * Make `handle` resize a panel.
 *
 *   name      which panel: "list", "editor" or "notes" (its LIMITS, and
 *             data-resizing on <body> while dragged)
 *   side      where the panel sits: "left", "right" or "bottom"
 *   property  the CSS variable that holds its size, set on <body>
 *   key       where its size is remembered (localStorage)
 *   onResize  called with the new size after every change, or null for the usual size
 */
export function initResizer({ doc = document, handle, name, side, property, key, onResize = () => {} }) {
  if (!handle) return null;
  const win = doc.defaultView, body = doc.body;
  let wanted = null; // the size the reader chose, before it's kept within the window's range
  const limits = () => LIMITS[name](win, oppositeWidth(doc, side, win));

  function apply() {
    if (wanted === null) body.style.removeProperty(property);
    else body.style.setProperty(property, `${clampSize(wanted, limits())}px`);
    onResize(wanted === null ? null : clampSize(wanted, limits()));
  }

  try {
    const saved = Number(win.localStorage.getItem(key));
    if (saved > 0) { wanted = saved; apply(); }
  } catch { /* storage can be blocked */ }

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    body.classList.add("panel-resizing");
    body.dataset.resizing = name;
    const move = (event) => {
      wanted = clampSize(sizeFromPointer(side, event, win), limits());
      apply();
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      body.classList.remove("panel-resizing");
      delete body.dataset.resizing;
      if (wanted !== null) try { win.localStorage.setItem(key, String(wanted)); } catch { /* not kept */ }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("lostpointercapture", end, { once: true });
  });
  handle.addEventListener("dblclick", () => {
    wanted = null;
    try { win.localStorage.removeItem(key); } catch { /* nothing kept */ }
    apply();
  });
  // A smaller window may no longer have room for the chosen size.
  win.addEventListener("resize", () => { if (wanted !== null) apply(); });
  return { get size() { return wanted; } };
}
