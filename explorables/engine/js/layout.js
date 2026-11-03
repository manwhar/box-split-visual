// Where things go on a deck's stage. These are pure functions, so
// explorables/tests/layout.test.mjs can check them without a browser;
// js/deck.js applies them.

/**
 * Fit a stage of w × h pixels into a box of boxW × boxH: the largest scale at
 * which the whole stage still shows, and where the stage's top-left corner
 * goes so that it's centred in the box.
 */
export function fitStage(boxW, boxH, w, h) {
  const scale = Math.min(boxW / w, boxH / h);
  return { scale, left: (boxW - w * scale) / 2, top: (boxH - h * scale) / 2 };
}

/**
 * Fit a widget, at its own size ({width, height}), into a slot on a slide
 * ({x, y, w, h}, in stage pixels): as large as it can be while all of it
 * shows, but enlarged no more than maxScale, and centred across the slot.
 * It goes at the slot's top, right under the slide's heading, or, with
 * align "middle", halfway down the slot.
 */
export function fitWidget(slot, size, maxScale, align = "top") {
  const scale = Math.min(slot.w / size.width, slot.h / size.height, maxScale);
  const y = align === "middle" ? slot.y + (slot.h - size.height * scale) / 2 : slot.y;
  return { scale, x: slot.x + (slot.w - size.width * scale) / 2, y };
}

/** Toy-map demos share a width; the frame fills all remaining slide height. */
export function fillToySlot(slot, width = 1150) {
  const scale = slot.w / width;
  return { scale, x: slot.x, y: slot.y, width, height: slot.h / scale };
}

/**
 * How many pixels a canvas should hold for each of its CSS pixels to stay
 * sharp when it's shown `shownScale` times its own size on a screen with the
 * given devicePixelRatio. A canvas holds a fixed number of pixels, so one
 * enlarged on a slide is blurry unless it's given more. The result is
 * rounded up to the next quarter, so a slightly different scale doesn't
 * resize the canvas, and kept between 1 and `cap`, which bounds the memory a
 * canvas takes (cap² times its own pixels).
 */
export function canvasDetail(devicePixelRatio, shownScale, cap = 4) {
  // The small epsilon keeps a product that is a quarter exactly (2 × 1.125)
  // from being pushed up a step by floating-point error.
  const detail = Math.ceil(devicePixelRatio * shownScale * 4 - 1e-9) / 4;
  return Math.min(cap, Math.max(1, detail));
}

/**
 * What a touch on the stage that moved (dx, dy) pixels in `ms` milliseconds
 * does to the slides: 1 for the next one, -1 for the previous one, 0 for
 * nothing. A quick sideways swipe turns the slide the way a finger turns a
 * page: one to the left brings the next. A tap (a short move), a move that
 * is mostly up or down, or a slow drag, does nothing.
 */
export function swipeStep(dx, dy, ms, { distance = 50, maxMs = 800 } = {}) {
  if (ms > maxMs || Math.abs(dx) < distance || Math.abs(dx) < 1.5 * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
