// The speaker notes on a published deck: the notes drawer (N), read-only.
//
// On the local server the editor fills the notes drawer with a field that
// edits the current slide's notes and saves them (js/editor.js). A published
// deck has no server to save to, but its notes are there for whoever gives the
// talk from the site: this module shows them in the same drawer, in the same
// place, for the same keys, so presenter mode (js/presenter.js) lays them out
// the same way on both. The notes are each slide's <aside class="notes">, as
// plain text, exactly as the editor shows them.

/** A slide's speaker notes, as the text the drawer shows ("" if it has none). */
export function slideNotes(slide) {
  return slide?.querySelector(".notes")?.textContent ?? "";
}

/**
 * Fill the page's notes drawer with the current slide's notes, read-only.
 *
 *   currentSlide  the slide on screen
 *   fit           refits the slide to the room the drawer leaves it
 *   focusDeck     gives the keyboard back to the slides
 *
 * Returns the calls js/deck.js makes of the editor's notes, so the deck
 * drives either one the same way.
 */
export function initNotes({ currentSlide, fit, focusDeck }) {
  const drawer = document.querySelector(".notes-drawer");
  drawer.id = "presenter-notes";
  drawer.removeAttribute("aria-live");
  drawer.setAttribute("role", "region");
  drawer.setAttribute("aria-label", "Presenter notes");
  drawer.innerHTML = `
    <div class="notes-toolbar"><label for="presenter-notes-text">Presenter notes</label></div>
    <textarea id="presenter-notes-text" readonly placeholder="No notes for this slide." title="Esc returns to slide navigation."></textarea>`;
  const text = drawer.querySelector("textarea");
  const button = document.querySelector("[data-notes]");
  button.setAttribute("aria-controls", drawer.id);
  button.setAttribute("aria-expanded", "false");

  /** Show the current slide's notes, from the top when the slide has changed. */
  function refreshNotes() {
    const slide = currentSlide();
    const value = slideNotes(slide);
    if (text.value !== value) text.value = value;
    if (text.dataset.slideId !== slide?.id) text.scrollTop = 0;
    text.dataset.slideId = slide?.id ?? "";
  }

  /** Open or close the drawer; with no argument, switch it. */
  function toggleNotes(open = !document.body.classList.contains("show-notes")) {
    document.body.classList.toggle("show-notes", open);
    button.setAttribute("aria-expanded", String(open));
    if (open) refreshNotes();
    else if (drawer.contains(document.activeElement)) focusDeck();
    fit();
  }

  /** Esc in the drawer hands the keys back to the slides, so the arrow keys move through them again. */
  function handleKey(event) {
    if (event.key !== "Escape" || !drawer.contains(event.target)) return false;
    event.preventDefault();
    focusDeck();
    return true;
  }

  return { refreshNotes, toggleNotes, handleKey };
}
