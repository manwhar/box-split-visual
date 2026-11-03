// The page around a deck's stage: the bar above it, the progress line, the
// slide list down its left side (js/slide-list.js), the notes drawer, and for
// a deck with its paper, the panel that shows it (js/paper.js). js/deck.js
// builds it when a deck loads, so the talk and every explorable share one copy
// of this markup and a deck's own HTML is only its slides. An embed provider
// can add a button to the bar, and a box it opens (js/embeds.js).
//
// chromeMarkup() is a pure function of the deck's options, so
// explorables/tests/chrome.test.mjs can check it without a browser.

/** Escape text for use inside HTML, including attribute values. */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * The chrome's HTML, as a string.
 *
 *   title      the deck's title, shown at the left of the bar
 *   home       where the link back to the gallery goes ("" for no link)
 *   presenting whether to offer Notes and Presenter: on the local server and on
 *              the published site, but not in the talk's audience edition
 *   authoring  whether to offer the editor (Edit), which needs the local server;
 *              an author's page also has Notes and Presenter
 *   problems   on the local server, how many format problems the deck's folder
 *              has and where the gallery lists them: {count, href}
 *   paper      the deck's paper, for the Paper button and its panel: {title, source},
 *              its name and original-source link (null without checked excerpts)
 */
export function chromeMarkup({ title, home = "", presenting = false, authoring = false, problems = null, paper = null }) {
  presenting ||= authoring;
  const homeLink = home ? `<a class="home" href="${escapeHtml(home)}" title="All explorables">← All explorables</a>` : "";
  const problemLink = problems?.count > 0
    ? `<a class="problems" href="${escapeHtml(problems.href)}" title="What to fix before this is published">⚠ ${problems.count} ${problems.count === 1 ? "problem" : "problems"}</a>`
    : "";
  const presenterButtons = presenting ? `
  <button type="button" data-notes title="Speaker notes (N)">Notes</button>
  <button type="button" data-presenter title="Presenter mode (P)" aria-pressed="false">Presenter</button>` : "";
  const editButton = authoring ? `
  <button type="button" data-edit title="Edit the slides (E)" aria-pressed="false" aria-controls="deck-editor">Edit</button>` : "";
  const paperButton = paper ? `
  <button type="button" data-paper title="The paper (R)" aria-pressed="false" aria-controls="paper-panel">Paper</button>` : "";
  // The persistent reading frame is loaded by js/paper.js.
  const paperPanel = paper ? `
<aside class="paper-panel" id="paper-panel" aria-label="The paper" hidden>
  <div class="paper-resize" title="Drag to resize. Double-click for the usual width."></div>
  <header class="paper-head">
    <b class="paper-name" title="${escapeHtml(paper.title)}">${escapeHtml(paper.title)}</b>
    <button type="button" data-paper-zoom="-1" title="Smaller text (− in the paper)" aria-label="Smaller text">−</button>
    <button type="button" data-paper-zoom="1" title="Larger text (+ in the paper)" aria-label="Larger text">+</button>
    ${paper.source ? `<a class="paper-file" href="${escapeHtml(paper.source)}" target="_blank" rel="noopener" title="Open the original paper">Original ↗</a>` : ""}
    <button type="button" data-paper-close title="Close the paper (R)" aria-label="Close the paper">×</button>
  </header>
  <div class="paper-view"></div>
</aside>` : "";
  // The notes drawer is filled by the editor on an author's page (js/editor.js),
  // and read-only on a published one (js/notes.js).
  const notes = presenting ? `\n<div class="notes-drawer" aria-live="polite"></div>` : "";
  // The edges a drag resizes (js/panels.js): the slide list's, the notes
  // drawer's wherever there are notes, and on an author's page the editor's.
  const edge = (name, what) => `\n<div class="panel-resize" data-resize="${name}" title="Drag to resize ${what}. Double-click for the usual size."></div>`;
  const edges = edge("list", "the slide list") + (presenting ? edge("notes", "the notes") : "") + (authoring ? edge("editor", "the editor") : "");
  return `<header class="bar">
  ${homeLink}<span class="deck-title">${escapeHtml(title)}</span>${problemLink}
  <span class="part"></span>
  <span class="spacer"></span>
  <button type="button" data-prev title="Previous slide (←)">‹</button>
  <span class="counter"></span>
  <button type="button" data-next title="Next slide (→)">›</button>
  <button type="button" data-list title="All slides" aria-pressed="false" aria-controls="slide-list">☰ Slides</button>${paperButton}${presenterButtons}${editButton}
  <button type="button" data-full title="Full screen (F)">⛶</button>
</header>
<div class="progress"></div>
<nav class="slide-list" id="slide-list" aria-label="All slides" hidden></nav>
<div class="slide-tip" aria-hidden="true" hidden></div>${notes}${paperPanel}${edges}`;
}

/** Put the chrome into the page, before the stage's viewport, unless a page already has its own bar. */
export function buildChrome(doc, options) {
  if (doc.querySelector(".bar")) return;
  const viewport = doc.querySelector(".viewport");
  const template = doc.createElement("template");
  template.innerHTML = chromeMarkup(options);
  if (viewport) viewport.before(template.content);
  else doc.body.prepend(template.content);
}
