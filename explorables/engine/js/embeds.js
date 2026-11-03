// Embed providers' modules: what a paper's folder lends a deck's slides
// (explorables/tools/embeds.py describes a provider; Smallville Lab's, in
// generative-agents/embed/, is one). The engine knows no provider by name.
// A deck that uses one names its module on <html>, which decks.page() writes
// for an explorable and the talk's page writes for itself:
//
//   <html data-embeds="smallville/embed.js">      addresses, relative to the page, separated by spaces
//
// js/deck.js imports each, and calls its default export with `deck`, what
// the engine offers a provider:
//
//   deck.root                  the page's <html>
//   deck.published             a deck on the published site, or the talk's audience
//                              edition: static files, with no server of its own
//   deck.authoring             a deck on the local server, with the editor
//   deck.audience              the presenter's audience window, which shows only slides
//   deck.slides()              the slides, in order
//   deck.currentSlide()        the slide on screen
//   deck.presenterActive()     whether presenter mode is on, when frames should rest
//   deck.addFrame({title, src})  a new frame in the layer over the slides
//                              (<div class="frames">), hidden until it has
//                              the class "on"; place it with deck.slotRect()
//   deck.slotRect(slot)        a slot's rectangle on the 1600 × 900 stage: {x, y, w, h}
//   deck.layout                fitWidget() and fillToySlot(), from js/layout.js
//   deck.placeFrames()         ask the deck to place every provider's frames again
//   deck.slideKey(key)         a slide key pressed in a frame, which its page passed up
//   deck.addToBar(html)        a control in the bar, before the Slides button; a
//                              button with data-settings and aria-controls="ID"
//                              opens and closes the element with that id
//   deck.addPanel(html)        a box under the bar, such as the one that button opens
//   deck.storageKey(name)      a name for browser storage that's this deck's own (js/storage.js)
//   deck.reachable(url)        whether anything answers at an address
//
// and it returns the hooks the deck calls, any of which it may leave out:
//
//   place(slide)    put its frames over the slide's slots, or hide them; called
//                   whenever the slide on screen or the stage's size changes
//   prepare(slide)  the slide has come on screen: load what it shows
//   pause()         stop anything playing: presenter mode has begun, or the
//                   audience window has paused
//   reset()         the slides have been replaced (the audience window): forget
//                   every frame, which the deck has removed
//   retry()         the viewer asked to try again (a [data-retry] button)
//   start()         the deck is ready, with the first slide on screen: load
//                   anything worth having before its slides come up
//   preview(room)   describe a slot's still image, or return null for a room
//                   this provider doesn't own. Called on inert slide copies
//                   too, so this must not load frames or change the page.
//                   Returns {source, frames?}:
//                     source: a JSON identity that changes with the content
//                     frames: capture instructions [{selector, ready?}]; each
//                       selector finds a visible iframe in the deck document.
//                       ready is an optional standalone function run inside
//                       that frame by the capture tool (including cross-origin
//                       frames). It returns true once the initial view is ready,
//                       false to wait, or throws for an invalid initial state.
//                       It must not close over provider variables. Omit frames
//                       to capture the room's own iframes, or use [] for none.
//
// A provider's own stylesheet, if it has one, is linked on the page by
// decks.page() (or the talk), not loaded here.

/** The provider modules a page names in data-embeds, as absolute addresses. */
export function embedModules(root, base) {
  const named = root?.dataset?.embeds?.trim();
  if (!named) return [];
  return named.split(/\s+/).map((address) => new URL(address, base).href);
}

const HOOKS = ["place", "prepare", "pause", "reset", "retry", "start", "preview"];

/**
 * Import each provider module and start it with `deck`. A module that can't
 * be loaded, or throws as it starts, is reported and left out, so the rest of
 * the deck still works. Returns each provider's hooks.
 */
export async function loadEmbeds(addresses, deck, { importer = (address) => import(address), report = console.error } = {}) {
  const started = [];
  for (const address of addresses) {
    try {
      const module = await importer(address);
      if (typeof module.default !== "function") throw new Error("its default export isn't a function");
      const hooks = (await module.default(deck)) ?? {};
      started.push(Object.fromEntries(HOOKS.filter((name) => typeof hooks[name] === "function").map((name) => [name, hooks[name]])));
    } catch (error) {
      report(`The embed provider ${address} didn't start: ${error.message}`);
    }
  }
  return started;
}

/** Call one hook on every provider that has it. */
export function callEmbeds(embeds, hook, ...args) {
  for (const hooks of embeds) hooks[hook]?.(...args);
}
