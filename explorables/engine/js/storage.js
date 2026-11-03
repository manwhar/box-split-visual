// What the engine keeps in the browser's storage, and the names it keeps it
// under. Every published deck shares one origin (the lab's GitHub Pages site,
// along with the lab's other repositories' sites), so every name starts with
// "explorables:", and what belongs to one deck also names the deck:
//
//   explorables:slide-list.open          viewer settings, the same on every deck:
//   explorables:slide-list.width         a viewer who widens the slide list or
//   explorables:notes.height             the paper on one deck finds it so on
//   explorables:editor.width             the next
//   explorables:paper.width
//   explorables:SLUG:NAME                what belongs to one deck, such as the
//                                        Smallville Lab address it was told
//
// A deck's slug is its folder's name, which decks.page() puts on <html> as
// data-deck (the talk's page says data-deck="talk"). The editor's drafts are
// kept by the address of the file they're drafts of (js/editor.js), which is
// already one deck's.

const PREFIX = "explorables:";

/** The name of a viewer setting, the same on every deck. */
export function viewerKey(name) {
  return `${PREFIX}${name}`;
}

/**
 * The deck's slug: its data-deck, or else the last folder of its address
 * ("ai-economist" for /site/ai-economist/), or "deck" for a page at the root.
 */
export function deckSlug(root = globalThis.document?.documentElement, path = globalThis.location?.pathname ?? "/") {
  const named = root?.dataset?.deck?.trim();
  if (named) return named;
  const folders = path.replace(/[^/]*$/, "").split("/").filter(Boolean);
  return folders.at(-1) || "deck";
}

/** The name of something that belongs to one deck. */
export function deckKey(name, slug = deckSlug()) {
  return `${PREFIX}${slug}:${name}`;
}

/** The engine's viewer settings, by what they remember. */
export const KEYS = Object.freeze({
  slideListOpen: viewerKey("slide-list.open"),
  slideListWidth: viewerKey("slide-list.width"),
  notesHeight: viewerKey("notes.height"),
  editorWidth: viewerKey("editor.width"),
  paperWidth: viewerKey("paper.width"),
});
